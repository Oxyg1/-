#!/usr/bin/env python3
"""Creates test SVGs for count_points.py from the template:
  illustrator_like.svg : relative commands (c/s/l/h/v/q-free), transforms on groups, renamed ids  -> must report OK
  broken.svg           : deliberately damaged                                                       -> must report problems
"""
import re, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, '..', 'dragon_template.svg')).read()
NUM = r'-?\d+\.?\d*'


def parse(d):
    toks = re.findall(r'[MCZ]|' + NUM, d)
    segs, i, start = [], 0, None
    cur = None
    while i < len(toks):
        t = toks[i]
        if t == 'M':
            cur = (float(toks[i + 1]), float(toks[i + 2])); start = cur; i += 3
        elif t == 'C':
            v = list(map(float, toks[i + 1:i + 7])); segs.append(v); i += 7
        elif t == 'Z':
            i += 1
    return start, segs


def fmt(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def to_rel(d, style):
    start, segs = parse(d)
    closed = d.strip().endswith('Z')
    out = ['M%s %s' % (fmt(start[0]), fmt(start[1]))]   # absolute M like Illustrator
    cx, cy = start
    prev = None
    for k, (x1, y1, x2, y2, x, y) in enumerate(segs):
        last = (k == len(segs) - 1)
        straight = abs((x1 - cx) * (y - cy) - (y1 - cy) * (x - cx)) < 1e-6 and abs((x2 - cx) * (y - cy) - (y2 - cy) * (x - cx)) < 1e-6
        if style == 'mix' and straight and abs(y - cy) < 1e-9:
            out.append('h%s' % fmt(x - cx))
        elif style == 'mix' and straight and abs(x - cx) < 1e-9:
            out.append('v%s' % fmt(y - cy))
        elif style == 'mix' and straight:
            out.append('l%s %s' % (fmt(x - cx), fmt(y - cy)))
        elif style == 'mix' and prev and abs((x1 - cx) - (cx - prev[0])) < 0.06 and abs((y1 - cy) - (cy - prev[1])) < 0.06:
            out.append('s%s %s %s %s' % (fmt(x2 - cx), fmt(y2 - cy), fmt(x - cx), fmt(y - cy)))
        else:
            out.append('c%s %s %s %s %s %s' % tuple(fmt(v) for v in (x1 - cx, y1 - cy, x2 - cx, y2 - cy, x - cx, y - cy)))
        prev = (x2, y2)
        cx, cy = x, y
    if closed:
        out.append('z')
    return ''.join(out) if style == 'tight' else ' '.join(out)


def make_ai(txt):
    n = [0]
    def repl(m):
        pid, d = m.group(1), m.group(2)
        n[0] += 1
        k = n[0] % 5
        new = pid
        if k == 1: new = pid + '_2'
        elif k == 2: new = pid.replace('_', '_x5F_')
        elif k == 3: new = pid + '_1_'
        elif k == 4: new = '_x5F_' + pid.upper() if False else pid
        return '<path id="%s" d="%s"/>' % (new, to_rel(d, 'mix' if n[0] % 2 else 'tight'))
    txt = re.sub(r'<path id="([^"]+)" d="([^"]+)"/>', repl, txt)
    txt = txt.replace('<g id="g_head"', '<g transform="translate(12 7) scale(1.01)" id="g_head"')
    txt = re.sub(r' fill="none" stroke="#[0-9a-f]+" stroke-width="4" stroke-linejoin="round"', '', txt)
    return txt


def make_broken(txt):
    # 1) drop one anchor of 'head' (remove its 5th C segment)
    def drop(pid, idx):
        nonlocal txt
        m = re.search(r'(<path id="%s" d=")([^"]+)(")' % pid, txt)
        d = m.group(2)
        parts = re.split(r'(?=C )', d)
        del parts[idx]
        txt = txt[:m.start(2)] + ''.join(parts) + txt[m.end(2):]
    drop('head', 5)
    # 2) add an anchor to eye_near_iris (duplicate a segment)
    m = re.search(r'(<path id="eye_near_iris" d=")([^"]+)(")', txt)
    parts = re.split(r'(?=C )', m.group(2))
    parts.insert(2, parts[2])
    txt = txt[:m.start(2)] + ''.join(parts) + txt[m.end(2):]
    # 3) close an open path (remove nothing, append Z)
    txt = re.sub(r'(<path id="mouth_line" d="[^"]+)(")', r'\1 Z\2', txt)
    # 4) delete a path
    txt = re.sub(r'\s*<path id="nostril_1" [^>]*/>', '', txt)
    # 5) extra unknown path and a duplicate-mapped id
    txt = txt.replace('</svg>', '<path id="Layer_1_stray" d="M 0 0 C 1 1 2 2 3 3 Z"/>\n<path id="tongue_2" d="M 0 0 C 1 1 2 2 3 3 Z"/>\n</svg>')
    return txt


open(os.path.join(HERE, 'illustrator_like.svg'), 'w').write(make_ai(src))
open(os.path.join(HERE, 'broken.svg'), 'w').write(make_broken(src))
print('written')
