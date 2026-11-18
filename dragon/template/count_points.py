#!/usr/bin/env python3
"""count_points.py - compare per-path anchor-point counts of exported SVGs with the template.

Usage:
    python3 count_points.py [--template dragon_template.svg] [--all] [--json] [--quiet]
                            [--tol 0.05] file1.svg [file2.svg ...]

For every file it prints the anchor count of each template id and reports
  * COUNT mismatches (the thing that breaks morphing),
  * closed/open mismatches, subpath-count mismatches,
  * MISSING template ids, EXTRA/unknown ids, DUPLICATE ids that map to the same template id,
  * notes (transforms present, primitives like <ellipse>/<rect> that the exporter did not
    convert to paths, arcs/quadratics, ids that had to be normalised).
Exit status: 0 = all files match the template, 1 = any problem, 2 = usage/IO error.

Robustness
  * path data may use any command: M L H V C S Q T A Z, absolute or relative, implicit
    command repetition, compact numbers ("1.5.5", "-.5", "1e-3"), compact arc flags.
  * A closed path whose last segment returns to the first point (what Illustrator/Figma
    write: "... C ... x0 y0 Z") does NOT count that last point twice.
  * transforms on <g>/<path> are irrelevant for counting and are ignored.
  * ids are normalised before matching: "_x5F_" style escapes (Illustrator) are decoded,
    leading/trailing underscores dropped, a trailing "_<digits>" duplicate suffix
    ("head_2", "head_1_") is stripped when the exact id is not a template id,
    case is ignored.  Fallbacks: data-name / inkscape:label / serif:id attributes, and
    the parent <g> id when the path itself has no usable id.
  * <polygon>, <polyline>, <line>, <rect>, <circle>, <ellipse> are counted as well
    (with a note) in case the exporter converted a shape.
"""
import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

NUM = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
ARITY = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}
SKIP_PARENTS = {'defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'style', 'metadata',
                'title', 'desc', 'linearGradient', 'radialGradient', 'filter'}


class PathInfo:
    __slots__ = ('anchors', 'closed', 'subpaths', 'cmds', 'notes')

    def __init__(self):
        self.anchors = 0
        self.closed = None   # True if every subpath closed, False if none, 'mixed'
        self.subpaths = 0
        self.cmds = set()
        self.notes = []


def parse_path(d, tol=0.05):
    info = PathInfo()
    # tokens, but arcs need flag-aware splitting -> handle by custom reader on the raw string
    s = d
    pos = 0
    n = len(s)
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    last_ctrl = None
    last_cmd = None
    sub_n = 0          # anchors in current subpath
    sub_open = False   # a subpath is in progress
    sub_start_pt = None
    closed_flags = []

    def skip_sep():
        nonlocal pos
        while pos < n and s[pos] in ' ,\t\r\n':
            pos += 1

    def read_num():
        nonlocal pos
        skip_sep()
        m = NUM.match(s, pos)
        if not m:
            raise ValueError(f"expected number at {s[pos:pos+20]!r}")
        pos = m.end()
        return float(m.group(0))

    def read_flag():
        nonlocal pos
        skip_sep()
        if pos < n and s[pos] in '01':
            v = int(s[pos])
            pos += 1
            return v
        raise ValueError("bad arc flag")

    def finish_sub(closed):
        nonlocal sub_n, sub_open
        if not sub_open:
            return
        cnt = sub_n
        if closed and cnt > 1 and math.hypot(cur[0] - sub_start_pt[0], cur[1] - sub_start_pt[1]) <= tol:
            cnt -= 1
        info.anchors += cnt
        info.subpaths += 1
        closed_flags.append(closed)
        sub_open = False
        sub_n = 0

    cmd = None
    while True:
        skip_sep()
        if pos >= n:
            break
        ch = s[pos]
        if ch.isalpha():
            cmd = ch
            pos += 1
            first = True
        else:
            if cmd is None:
                raise ValueError("path data does not start with a command")
            first = False
            if cmd in 'Zz':
                raise ValueError("number after Z")
        C = cmd.upper()
        rel = cmd.islower()
        if C not in ARITY:
            raise ValueError(f"unknown command {cmd}")
        if C != 'M':
            info.cmds.add(C)
        if C == 'Z':
            finish_sub(True)
            cur = start
            last_ctrl = None
            last_cmd = 'Z'
            continue
        # implicit repetition: M -> L
        while True:
            if C == 'A':
                rx, ry, rot = read_num(), read_num(), read_num()
                fa, fs = read_flag(), read_flag()
                x, y = read_num(), read_num()
                if rel:
                    x += cur[0]; y += cur[1]
                pt = (x, y)
            elif C == 'H':
                x = read_num()
                pt = (x + cur[0] if rel else x, cur[1])
            elif C == 'V':
                y = read_num()
                pt = (cur[0], y + cur[1] if rel else y)
            else:
                vals = [read_num() for _ in range(ARITY[C])]
                ox, oy = cur if rel else (0.0, 0.0)
                pt = (vals[-2] + ox, vals[-1] + oy)
            if C == 'M':
                if sub_open:
                    finish_sub(False)
                sub_open = True
                sub_n = 1
                sub_start_pt = pt
                start = pt
                cur = pt
            else:
                if not sub_open:          # drawing right after Z without M
                    sub_open = True
                    sub_n = 1
                    sub_start_pt = start
                sub_n += 1
                info.cmds.add(C)
                cur = pt
            if C == 'M':
                C = 'L'                    # implicit lineto for further pairs
            skip_sep()
            if pos >= n or s[pos].isalpha():
                break
    finish_sub(False)
    if closed_flags:
        info.closed = True if all(closed_flags) else (False if not any(closed_flags) else 'mixed')
    else:
        info.closed = False
    return info


def local(tag):
    return tag.rsplit('}', 1)[-1] if '}' in tag else tag


def attr(el, name):
    """attribute lookup ignoring namespace."""
    for k, v in el.attrib.items():
        if k == name or k.endswith('}' + name):
            return v
    return None


def primitive_info(el, tag):
    info = PathInfo()
    info.subpaths = 1
    if tag in ('polygon', 'polyline'):
        nums = [float(x) for x in NUM.findall(el.get('points', ''))]
        info.anchors = len(nums) // 2
        info.closed = tag == 'polygon'
    elif tag == 'line':
        info.anchors, info.closed = 2, False
    else:   # rect, circle, ellipse
        info.anchors, info.closed = 4, True
    info.notes.append(f'<{tag}> element (not a path) counted as {info.anchors} anchors')
    return info


def decode_id(s):
    s = re.sub(r'_x([0-9A-Fa-f]{2,4})_', lambda m: chr(int(m.group(1), 16)), s)
    return s


def candidates(raw):
    """Yield normalised id candidates, most specific first."""
    s = decode_id(raw).strip()
    s = re.sub(r'\s+', '_', s)
    s = s.strip('_').lower()
    seen = []

    def add(x):
        if x and x not in seen:
            seen.append(x)
    add(s)
    t = s
    for _ in range(3):
        t2 = re.sub(r'(?:_+\d+)$', '', t).strip('_')
        t2 = re.sub(r'_(?:copy|kopie)$', '', t2)
        if t2 == t:
            break
        add(t2)
        t = t2
    # Illustrator "id_1_" / "id_2_" done above; also "id-2"
    t = re.sub(r'-\d+$', '', s)
    add(t)
    return seen


def resolve(el_names, template_ids):
    """el_names: list of raw names. returns (template_id or None, normalised?)."""
    for raw in el_names:
        if not raw:
            continue
        for k, c in enumerate(candidates(raw)):
            if c in template_ids:
                return template_ids[c], (c != raw)
    return None, False


def read_svg(path, tol):
    """returns list of dict(name_candidates, info, has_transform, raw_id, tag)"""
    tree = ET.parse(path)
    root = tree.getroot()
    items = []

    def walk(el, parents, transformed):
        tag = local(el.tag)
        if tag in SKIP_PARENTS:
            return
        tr = transformed or bool(el.get('transform'))
        if tag in ('path', 'polygon', 'polyline', 'line', 'rect', 'circle', 'ellipse'):
            if tag == 'rect' and parents and False:
                pass
            if tag == 'path':
                try:
                    info = parse_path(el.get('d', ''), tol)
                except ValueError as e:
                    info = PathInfo()
                    info.anchors = -1
                    info.notes.append(f'unparsable path data: {e}')
            else:
                info = primitive_info(el, tag)
            names = [el.get('id'), attr(el, 'data-name'), attr(el, 'label'), attr(el, 'id')]
            # parent group names as fallback
            pnames = [p.get('id') for p in reversed(parents)] + [attr(p, 'data-name') for p in reversed(parents)]
            items.append(dict(names=names, pnames=pnames, raw=el.get('id') or '', info=info, transformed=tr, tag=tag,
                              ngroup_children=None))
        for ch in el:
            walk(ch, parents + [el], tr)

    walk(root, [], False)
    return items


def load_template(path, tol):
    items = read_svg(path, tol)
    ids = {}
    order = []
    for it in items:
        raw = it['raw']
        if not raw:
            continue
        ids[raw.lower()] = raw
        order.append(raw)
    tmpl = {}
    for it in items:
        if it['raw']:
            tmpl[it['raw']] = it['info']
    return ids, order, tmpl


def analyse(path, tids, order, tmpl, tol):
    res = dict(file=path, counts={}, errors=[], notes=[], extra=[], missing=[], mismatch=[])
    items = read_svg(path, tol)
    # group-level fallback: only when group directly holds exactly one path
    found = {}
    unknown = []
    for it in items:
        tid, normalised = resolve(it['names'], tids)
        via_group = False
        if tid is None and not it['raw'] and it['pnames']:
            # parent-group fallback (nearest group whose name resolves and which is not a part-group)
            for pn in it['pnames']:
                t2, _ = resolve([pn], tids)
                if t2 is not None:
                    tid, normalised, via_group = t2, True, True
                    break
        if tid is None:
            unknown.append((it['raw'] or '<no id>', it['info'].anchors, it['tag']))
            continue
        if tid in found:
            res['errors'].append(f"DUPLICATE: '{it['raw']}' and '{found[tid][0]}' both map to template id '{tid}'")
            continue
        found[tid] = (it['raw'] or '<group>', it)
        if normalised and not via_group:
            res['notes'].append(f"id '{it['raw']}' matched as '{tid}'")
        if via_group:
            res['notes'].append(f"path without id matched via parent group as '{tid}'")
        if it['info'].notes:
            for nt in it['info'].notes:
                res['notes'].append(f"{tid}: {nt}")
        if it['transformed']:
            res.setdefault('transformed', []).append(tid)
        extra_cmds = it['info'].cmds - {'M', 'C', 'Z'}
        if extra_cmds:
            res.setdefault('noncubic', []).append((tid, ''.join(sorted(extra_cmds))))
    for tid in order:
        t = tmpl[tid]
        if tid not in found:
            res['missing'].append(tid)
            continue
        info = found[tid][1]['info']
        res['counts'][tid] = info.anchors
        if info.anchors != t.anchors:
            res['mismatch'].append((tid, t.anchors, info.anchors))
        if info.closed != t.closed:
            res['errors'].append(f"{tid}: closed/open differs (template {'closed' if t.closed else 'open'}, "
                                 f"file {'closed' if info.closed is True else 'open' if info.closed is False else 'mixed'})")
        if info.subpaths != t.subpaths:
            res['errors'].append(f"{tid}: subpath count differs (template {t.subpaths}, file {info.subpaths})")
    res['extra'] = unknown
    res['total'] = sum(res['counts'].values())
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('files', nargs='+', help='exported SVG files')
    ap.add_argument('--template', default=os.path.join(here, 'dragon_template.svg'))
    ap.add_argument('--all', action='store_true', help='print every id row, not only mismatching ones')
    ap.add_argument('--json', action='store_true', help='machine readable output')
    ap.add_argument('--quiet', action='store_true', help='only print problems')
    ap.add_argument('--tol', type=float, default=0.05, help='closing-point coincidence tolerance (default 0.05)')
    a = ap.parse_args(argv)
    try:
        tids, order, tmpl = load_template(a.template, a.tol)
    except Exception as e:
        print(f"cannot read template {a.template}: {e}", file=sys.stderr)
        return 2
    results = []
    for f in a.files:
        try:
            results.append(analyse(f, tids, order, tmpl, a.tol))
        except Exception as e:
            print(f"cannot read {f}: {e}", file=sys.stderr)
            return 2
    ttotal = sum(t.anchors for t in tmpl.values())
    bad = False
    if a.json:
        out = dict(template=dict(file=a.template, paths=len(order), points=ttotal,
                                 counts={k: tmpl[k].anchors for k in order}),
                   files=[])
        for r in results:
            ok = not (r['mismatch'] or r['missing'] or r['errors'] or r['extra'])
            bad |= not ok
            out['files'].append(dict(r, ok=ok))
        print(json.dumps(out, indent=1))
        return 1 if bad else 0

    print(f"template: {a.template}  ({len(order)} paths, {ttotal} points)")
    for r in results:
        ok = not (r['mismatch'] or r['missing'] or r['errors'] or r['extra'])
        bad |= not ok
        if a.quiet and ok:
            continue
        print(f"\n== {r['file']}  ->  {'OK' if ok else 'PROBLEMS'}  ({len(r['counts'])}/{len(order)} ids found, {r['total']} points)")
        if a.all or r['mismatch']:
            w = max(len(i) for i in order)
            for tid in order:
                if tid in r['counts']:
                    c, t = r['counts'][tid], tmpl[tid].anchors
                    if c != t or a.all:
                        print(f"   {tid:<{w}}  template {t:>3}  file {c:>3}  {'' if c == t else f'MISMATCH ({c - t:+d})'}")
        for tid in r['missing']:
            print(f"   MISSING id: {tid}")
        for raw, n, tag in r['extra']:
            print(f"   EXTRA/unknown id: {raw}  ({tag}, {n} anchors)")
        for e in r['errors']:
            print(f"   ERROR: {e}")
        if r.get('noncubic'):
            nc = r['noncubic']
            allc = ''.join(sorted(set(''.join(c for _, c in nc))))
            print(f"   note: {len(nc)} paths use non-M/C/Z commands [{allc}] (counts are still exact; e.g. "
                  + ', '.join(f"{t}[{c}]" for t, c in nc[:5]) + (' ...' if len(nc) > 5 else '') + ")")
        if r.get('transformed'):
            print(f"   note: transform present on {len(r['transformed'])} paths/groups (ignored for counting)")
        for nt in r['notes'][:50]:
            print(f"   note: {nt}")
        if len(r['notes']) > 50:
            print(f"   note: ... {len(r['notes']) - 50} more")
        if ok:
            print("   all point counts match the template")
    # cross-file summary
    if len(results) > 1:
        print("\nsummary:")
        for r in results:
            ok = not (r['mismatch'] or r['missing'] or r['errors'] or r['extra'])
            print(f"   {'OK     ' if ok else 'PROBLEM'}  {r['file']}")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
