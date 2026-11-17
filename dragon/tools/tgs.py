#!/usr/bin/env python3
"""Telegram animated sticker (.tgs) tooling: check and pack Lottie JSON.

Usage:
  python3 tools/tgs.py check FILE.json|FILE.tgs
  python3 tools/tgs.py pack FILE.json -o OUT.tgs

Python 3 standard library only.
"""
import argparse
import gzip
import json
import sys

CANVAS = 512
FPS = 60
MAX_OP = 180          # 3.0 s at 60 fps
MAX_GZ = 65536        # 64 KB
FORBIDDEN_SHAPE_TYPES = {
    "sr": "star/polygon",
    "rp": "repeater",
    "mm": "merge paths",
    "gs": "gradient stroke",
}


# ---------------------------------------------------------------- helpers

def load(path):
    """Load JSON from a plain .json file or a gzipped .tgs (detected by magic bytes)."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def minify(doc):
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def gzip9(data):
    return gzip.compress(data, compresslevel=9, mtime=0)


def round_floats(obj, nd=3):
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, dict):
        return {k: round_floats(v, nd) for k, v in obj.items()}
    if isinstance(obj, list):
        return [round_floats(v, nd) for v in obj]
    return obj


def walk(obj, path="$"):
    """Yield (path, dict) for every dict in the tree."""
    stack = [(path, obj)]
    while stack:
        p, o = stack.pop()
        if isinstance(o, dict):
            yield p, o
            for k, v in o.items():
                stack.append((f"{p}.{k}", v))
        elif isinstance(o, list):
            for i, v in enumerate(o):
                stack.append((f"{p}[{i}]", v))


def count_keyframes(doc):
    n = 0
    for _, d in walk(doc):
        k = d.get("k")
        if isinstance(k, list):
            n += sum(1 for e in k if isinstance(e, dict) and "t" in e)
    return n


def shape_items_in(items, out):
    """Collect (type, ...) of shape items recursively through group `it` arrays."""
    if not isinstance(items, list):
        return
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append(it.get("ty"))
        if isinstance(it.get("it"), list):
            shape_items_in(it["it"], out)


def layer_label(layer):
    return f"ind={layer.get('ind', '?')} '{layer.get('nm', '')}'"


# ---------------------------------------------------------------- checks

def run_checks(doc):
    """Return (results, info). results: list of (ok, name, detail)."""
    res = []

    def add(ok, name, detail=""):
        res.append((bool(ok), name, detail))

    def fmt_list(items, limit=6):
        items = list(items)
        s = ", ".join(items[:limit])
        if len(items) > limit:
            s += f", ... (+{len(items) - limit})"
        return s

    layers = doc.get("layers") if isinstance(doc.get("layers"), list) else []
    layers = [l for l in layers if isinstance(l, dict)]

    # canvas / timing
    w, h = doc.get("w"), doc.get("h")
    add(w == CANVAS and h == CANVAS, "canvas 512x512", f"w={w} h={h}")
    add(doc.get("fr") == FPS, "frame rate 60", f"fr={doc.get('fr')}")
    add(doc.get("ip") == 0, "in-point ip=0", f"ip={doc.get('ip')}")
    op = doc.get("op")
    op_ok = isinstance(op, (int, float)) and op <= MAX_OP
    dur = f"{op / FPS:.2f} s" if isinstance(op, (int, float)) and FPS else "?"
    add(op_ok, "out-point op<=180 (<=3 s)", f"op={op} ({dur})")

    # assets
    assets = doc.get("assets") or []
    if not isinstance(assets, list):
        assets = []
    images = [a.get("id", "?") for a in assets if isinstance(a, dict) and "p" in a]
    precomps = [a.get("id", "?") for a in assets if isinstance(a, dict) and "p" not in a and "layers" in a]
    add(not images, "no image assets",
        f"{len(assets)} asset(s): {len(images)} image, {len(precomps)} precomp"
        + (f"; image ids: {fmt_list(map(str, images))}" if images else ""))

    # layer-level forbidden features
    def bad_layers(pred):
        return [layer_label(l) for l in layers if pred(l)]

    rules = [
        ("no 3D layers (ddd=1)", lambda l: l.get("ddd") == 1),
        ("no image layers (ty=2)", lambda l: l.get("ty") == 2),
        ("no text layers (ty=5)", lambda l: l.get("ty") == 5),
        ("no layer effects (ef)", lambda l: bool(l.get("ef"))),
        ("no time remap (tm)", lambda l: "tm" in l),
        ("auto-orient off (ao!=1)", lambda l: l.get("ao") == 1),
        ("no time stretch (sr!=1)", lambda l: "sr" in l and l.get("sr") != 1),
    ]
    for name, pred in rules:
        bad = bad_layers(pred)
        add(not bad, name, f"offending: {fmt_list(bad)}" if bad else f"{len(layers)} layers checked")

    # shape items (recursive through group `it` arrays)
    found = []
    for l in layers:
        items = []
        shape_items_in(l.get("shapes"), items)
        for t in items:
            if t in FORBIDDEN_SHAPE_TYPES:
                found.append(f"{FORBIDDEN_SHAPE_TYPES[t]} (ty={t}) in {layer_label(l)}")
    add(not found, "no forbidden shape items (sr, rp, mm, gs)",
        f"found: {fmt_list(sorted(set(found)))}" if found else "none")

    # expressions: a property object whose `x` is an expression string.
    # (Bezier easing handles `o`/`i` also use x, but as number arrays, so they are not expressions.)
    exprs = [p for p, d in walk(doc) if isinstance(d.get("x"), str)]
    add(not exprs, "no expressions (x keys)",
        f"{len(exprs)} found, e.g. {fmt_list(exprs, 3)}" if exprs else "none")

    # required layer fields
    missing = [layer_label(l) + " missing " + "/".join(k for k in ("ip", "op", "st") if k not in l)
               for l in layers if any(k not in l for k in ("ip", "op", "st"))]
    add(layers and not missing, "every layer has ip, op, st",
        f"missing: {fmt_list(missing)}" if missing else f"{len(layers)} layers")

    # parent references
    inds = {l.get("ind") for l in layers if "ind" in l}
    dangling = [f"{layer_label(l)} -> parent {l['parent']}" for l in layers
                if "parent" in l and l["parent"] not in inds]
    add(not dangling, "parent indices resolve",
        f"dangling: {fmt_list(dangling)}" if dangling else f"{len(inds)} indices")

    # size
    raw = minify(doc)
    gz = gzip9(raw)
    add(len(gz) <= MAX_GZ, "gzip size <= 64 KB",
        f"{len(gz) / 1024:.1f} KB ({len(gz)} bytes), limit {MAX_GZ / 1024:.0f} KB")

    info = {
        "layers": len(layers),
        "keyframes": count_keyframes(doc),
        "raw": len(raw),
        "gz": len(gz),
    }
    return res, info


def print_report(res, info):
    print(f"layers: {info['layers']}")
    print(f"keyframes: {info['keyframes']}")
    print(f"size: raw {info['raw'] / 1024:.1f} KB ({info['raw']} bytes), "
          f"gzip-9 {info['gz'] / 1024:.1f} KB ({info['gz']} bytes)")
    print()
    for ok, name, detail in res:
        status = "PASS" if ok else "FAIL"
        line = f"[{status}] {name}"
        if detail:
            line += f" - {detail}"
        print(line)
    n_fail = sum(1 for ok, _, _ in res if not ok)
    print()
    print("RESULT: " + ("ALL PASS" if n_fail == 0 else f"{n_fail} FAIL"))
    return n_fail == 0


# ---------------------------------------------------------------- commands

def cmd_check(args):
    doc = load(args.file)
    res, info = run_checks(doc)
    return 0 if print_report(res, info) else 1


def cmd_pack(args):
    doc = round_floats(load(args.file), 3)
    data = minify(doc)
    gz = gzip9(data)
    with open(args.output, "wb") as f:
        f.write(gz)
    print(f"wrote {args.output} ({len(gz)} bytes, {len(gz) / 1024:.1f} KB)")
    print()
    res, info = run_checks(doc)
    return 0 if print_report(res, info) else 1


def main(argv=None):
    p = argparse.ArgumentParser(description="Telegram .tgs check/pack tool")
    sub = p.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("check", help="run Telegram checks on a .json or .tgs file")
    pc.add_argument("file")
    pc.set_defaults(func=cmd_check)

    pp = sub.add_parser("pack", help="minify, round, gzip into .tgs, then check")
    pp.add_argument("file")
    pp.add_argument("-o", "--output", required=True)
    pp.set_defaults(func=cmd_pack)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
