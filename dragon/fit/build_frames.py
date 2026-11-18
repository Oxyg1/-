import mouth, sys, copy, numpy as np, svgio, edges, snap, warp, frames, subprocess
BASE = '../build/K0_snapped.svg'
BASE_ORIG = '../build/K0_snapped.orig.svg'
OUT = '../build/fit'
import os; os.makedirs(OUT, exist_ok=True)


def build(name):
    src, P = svgio.load(BASE)
    P0 = svgio.load(BASE_ORIG)[1]
    spec = frames.FRAMES[name]
    F = edges.ridge_map(f'../ref/storyboard/{name}.jpg')
    import register
    for ids, carry in spec.get('register', []):
        register.register(P, ids, F, radii=(80, 50, 30), carry=carry)
    import math
    for ids, ang, (px, py) in spec.get('rotate', []):
        c, sn = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        for pid in ids:
            for _, ps in P[pid].cmds:
                for pt in ps:
                    dx, dy = pt[0] - px, pt[1] - py
                    pt[0], pt[1] = px + c * dx - sn * dy, py + sn * dx + c * dy
    for ids, dx, dy in spec.get('translate', []):
        for pid in ids:
            for _, ps in P[pid].cmds:
                for pt in ps:
                    pt[0] += dx; pt[1] += dy
    if spec.get('tps'):
        L0 = frames.K0
        keys = list(spec['tps'])
        srcp = [L0[k] for k in keys] + frames.FIXED + [L0[k] for k in ('eye', 'top', 'hornL', 'hornR', 'cheek') if k not in keys]
        dstp = [spec['tps'][k] for k in keys] + frames.FIXED + [L0[k] for k in ('eye', 'top', 'hornL', 'hornR', 'cheek') if k not in keys]
        warp.warp_paths(P, frames.HEAD_IDS, warp.TPS(srcp, dstp))
    for pid, kp in spec.get('shapes', {}).items():
        warp.reshape(P[pid], kp)
    for pid, pts in spec.get('place', {}).items():
        mouth.place(P[pid], {i + 1: p for i, p in enumerate(pts)})
    snap.snap(P, spec.get('snap', frames.SNAP_IDS), F, radii=spec.get('snap_radii', (24, 14, 8)))
    for fn in spec.get('post', []):
        fn(P, P0)
    if name in frames.CLOSED_MOUTH:
        mouth.sync_closed(P, P0, skip=spec.get('shapes', {}))
    if name in frames.OPEN_MOUTH_FRAMES:
        mouth.sync_open(P, spec['shapes']['mouth_cavity'])
    out = f'{OUT}/{name}.svg'
    svgio.save(src, P, out)
    subprocess.run(['node', '../template/tests/svg_overlay.js', out, f'../ref/storyboard/{name}.jpg', f'{OUT}/{name}.png'], check=True)
    from PIL import Image
    im = Image.open(f'{OUT}/{name}.png')
    im.crop((300, 200, 1450, 1100)).save(f'{OUT}/{name}_head.png')
    im.resize((1000, 804)).save(f'{OUT}/{name}_small.png')


for n in sys.argv[1:]:
    build(n)
    print('built', n)
