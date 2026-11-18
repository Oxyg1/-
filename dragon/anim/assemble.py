#!/usr/bin/env python3
"""Kissed Dragon: morph the traced keyframes (frames_svg/K*.svg) into a Telegram sticker.

K-space (2000x1609 storyboard pixels) -> canvas 512: c = S*k + (OX, OY).
Part geometry morphs between keyframes; the wing and the hind leg are rigged (rotation) like the frog;
fire, sparks and smoke come from fx.py.
"""
import sys, os, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, "/home/user/obeskay/lottie-animator-skill/skills/lottie-animator/scripts")
sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, 'fit'))
from motion import *
import svgio, fx

S, OX, OY = 0.245, 20.0, 75.0
OP = 180
EASE.update({'key': ((0.45, 0.0), (0.25, 1.0)), 'snap': ((0.6, 0.0), (0.15, 1.0)), 'soft': ((0.4, 0.0), (0.4, 1.0))})


def C(p):
    return [round(S * p[0] + OX), round(S * p[1] + OY)]


# ---------------------------------------------------------------- keyframes
KEYS = [(0, 'K0', 'soft'), (10, 'K0', 'key'), (16, 'K1', 'key'), (24, 'K2', 'snap'), (34, 'K3', 'key'),
        (40, 'K3', 'key'), (50, 'K4', 'snap'), (56, 'K5', 'out'), (76, 'K6', 'soft'), (88, 'K6', 'key'),
        (94, 'K5', 'key'), (100, 'K7', 'key'), (114, 'K8', 'soft'), (148, 'K8', 'key'), (158, 'K3', 'key'),
        (166, 'K2', 'key'), (172, 'K1', 'key'), (180, 'K0', 'key')]
FR = {}
for k in range(9):
    FR['K%d' % k] = svgio.load(os.path.join(ROOT, 'frames_svg', 'K%d.svg' % k))[1]
RIGGED_STATIC = {'wing_lobe', 'wing_main', 'wing_membrane_1', 'wing_membrane_2', 'wing_membrane_3',
                 'wing_bone_1', 'wing_bone_2', 'wing_bone_3', 'haunch_leg', 'haunch_leg_line'}
HIND_KEYS = [(0, 'K0', 'soft'), (103, 'K0', 'key'), (113, 'K8', 'snap'), (148, 'K8', 'key'), (158, 'K0', 'key'), (180, 'K0', 'key')]
HIND_PARTS = {'hind_leg', 'hind_leg_line', 'hind_knee'}


def lottie_shape(p):
    anchors = p.anchors()
    segs = [ps for c, ps in p.cmds if c == 'C']
    v = [C(a) for a, _ in anchors]
    n = len(v)
    i_h = [[0, 0] for _ in range(n)]; o_h = [[0, 0] for _ in range(n)]
    for k, (c1, c2, p1) in enumerate(segs):
        a0, a1 = k % n, (k + 1) % n
        cc1, cc2 = C(c1), C(c2)
        o_h[a0] = [round(cc1[0] - v[a0][0]), round(cc1[1] - v[a0][1])]
        if k + 1 < len(segs) or (p.closed and a1 == 0) or not p.closed:
            if a1 < n:
                i_h[a1] = [round(cc2[0] - v[a1][0]), round(cc2[1] - v[a1][1])]
    return {'c': p.closed, 'v': v, 'i': i_h, 'o': o_h}


def size_of(shape):
    xs = [q[0] for q in shape['v']]; ys = [q[1] for q in shape['v']]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


def shape_track(pid):
    keys = HIND_KEYS if pid in HIND_PARTS else KEYS
    vals = [(t, lottie_shape(FR['K0' if pid in RIGGED_STATIC else k][pid.replace('haunch_', 'hind_')]), e) for t, k, e in keys]
    base = vals[0][1]
    moving = any(max(abs(a - b) for va, vb in zip(s['v'], base['v']) for a, b in zip(va, vb)) > 1.2 for _, s, _ in vals)
    if not moving:
        return base, None
    # drop keys equal to both neighbours (holds) to save bytes
    keep = [vals[0]]
    for a, b, c in zip(vals, vals[1:], vals[2:]):
        if not (b[1] == a[1] == c[1]):
            keep.append(b)
    keep.append(vals[-1])
    vis = [(t, 100 if size_of(s) > 6 else 0, 'linear') for t, s, _ in keep]
    o = None
    if any(x[1] == 0 for x in vis):
        o = track(*vis) if len({x[1] for x in vis}) > 1 else 0
    return track(*[(t, s, e) for t, s, e in keep]), o


# ---------------------------------------------------------------- style
OUT, W1, W2 = '#4A1622', 7.5, 4.5        # outline colour, silhouette width, inner-line width (canvas px)
BODY, HEAD = '#E35A50', '#E7614F'
STYLE = {
    # pid: (fill, stroke, width)
    'eye_near_brow': (None, OUT, W2), 'eye_far_brow': (None, OUT, W2),
    'eye_near_lid': (HEAD, OUT, W2), 'eye_far_lid': (HEAD, OUT, W2),
    'eye_near_shine': ('#FFFFFF', None, 0), 'eye_far_shine': ('#FFFFFF', None, 0),
    'eye_near_iris': ('#24142B', None, 0), 'eye_far_iris': ('#24142B', None, 0),
    'eye_near_ring': ('#ECE7E2', None, 0), 'eye_far_ring': ('#ECE7E2', None, 0),
    'eye_near_outer': ('#2B0D14', OUT, W2), 'eye_far_outer': ('#2B0D14', OUT, W2),
    'eye_near_crease': (None, OUT, W2 * 0.8),
    'hind_knee': ('#F0857A', None, 0), 'haunch_leg_line': (None, OUT, W2), 'haunch_leg': (BODY, None, 0), 'hind_leg_line': (None, OUT, W2), 'hind_leg': (BODY, OUT, W1),
    'nostril_1': (OUT, None, 0), 'nostril_2': (OUT, None, 0),
    'mouth_line': (None, OUT, W2 + 0.5),
    'teeth_upper_1': ('#FFF6EC', OUT, 2.2), 'teeth_upper_2': ('#FFF6EC', OUT, 2.2), 'teeth_upper_3': ('#FFF6EC', OUT, 2.2),
    'teeth_lower_1': ('#FFF6EC', OUT, 2.2), 'teeth_lower_2': ('#FFF6EC', OUT, 2.2), 'teeth_lower_3': ('#FFF6EC', OUT, 2.2),
    'tongue': ('#EE7482', None, 0), 'mouth_cavity': ('#4A0E16', OUT, W2),
    'blush': ('#FF8E9E', None, 0), 'brow_fold': (None, OUT, W2 * 0.7),
    'kiss_upper': ('#D8302E', None, 0), 'kiss_lower': ('#D8302E', None, 0),
    'cheek_puff': ('#EC6A5A', OUT, W2), 'cheek_puff_far': ('#EC6A5A', OUT, W2),
    'head': (HEAD, OUT, W1), 'jaw': ('#E05A4C', OUT, W1),
    'horn_left': ('#F7D58A', '#6B3412', W1), 'horn_right': ('#F7D58A', '#6B3412', W1),
    'spike_head_1': ('#8E347F', OUT, W2), 'spike_head_2': ('#8E347F', OUT, W2), 'spike_head_3': ('#8E347F', OUT, W2),
    'toe_near_1': ('#F49BA2', None, 0), 'toe_near_2': ('#F49BA2', None, 0), 'toe_near_3': ('#F49BA2', None, 0),
    'leg_front_near_line': (None, OUT, W2), 'leg_front_near': (BODY, OUT, W1),
    'tail_spike_1': ('#8E347F', OUT, W2), 'tail_spike_2': ('#8E347F', OUT, W2), 'tail_spike_3': ('#8E347F', OUT, W2),
    'tail': ('#DD554B', OUT, W1),
    'belly_stripe_1': (None, '#C9853F', W2 * 0.8), 'belly_stripe_2': (None, '#C9853F', W2 * 0.8),
    'belly_stripe_3': (None, '#C9853F', W2 * 0.8), 'belly_stripe_4': (None, '#C9853F', W2 * 0.8),
    'belly': ('#F8C67C', '#C9853F', W2), 'belly_under': ('#F0B467', None, 0),
    'heart': ('#C8403C', None, 0),
    'spot_1': ('#C8403C', None, 0), 'spot_2': ('#C8403C', None, 0), 'spot_3': ('#C8403C', None, 0),
    'spot_4': ('#C8403C', None, 0), 'spot_5': ('#C8403C', None, 0), 'spot_6': ('#C8403C', None, 0),
    'body_rim': (None, '#F28173', W2), 'back_shade': ('#CF4943', None, 0), 'body_shade': ('#C9443F', None, 0),
    'body': (BODY, OUT, W1), 'foot_front_far': ('#D04E47', OUT, W1), 'spike_back_1': ('#8E347F', OUT, W2),
    'wing_bone_1': (None, '#5E1420', W2), 'wing_bone_2': (None, '#5E1420', W2), 'wing_bone_3': (None, '#5E1420', W2),
    'wing_membrane_1': ('#F6C27E', None, 0), 'wing_membrane_2': ('#F6C27E', None, 0), 'wing_membrane_3': ('#F6C27E', None, 0),
    'wing_main': ('#C2464A', OUT, W1), 'wing_lobe': ('#A93E47', OUT, W1),
}
ORDER = [p for p in STYLE if not p.startswith('haunch_')]
_i = ORDER.index('hind_leg') + 1
ORDER[_i:_i] = ['haunch_leg_line', 'haunch_leg']
WING = [p for p in ORDER if p.startswith('wing_')]
HIND = ['hind_knee', 'hind_leg_line', 'hind_leg']
HAUNCH = ['haunch_leg_line', 'haunch_leg']


# ---------------------------------------------------------------- rig
def kc(x, y):
    return C((x, y))


GROUND = kc(1000, 1440)
WING_PIVOT = kc(1440, 560)
HIND_PIVOT = kc(1560, 1100)

master_s = track((0, [100, 100], 'swing'), (24, [101, 99], 'swing'), (40, [100, 100], 'key'), (50, [97, 105], 'snap'),
                 (56, [106, 94], 'out'), (64, [101, 99], 'swing'), (88, [100, 100], 'key'), (96, [98, 103], 'out'),
                 (102, [102, 98.5], 'swing'), (110, [100, 100], 'swing'), (180, [100, 100]))
shake = [(0, GROUND, 'linear'), (55, GROUND, 'linear')]
for i, t in enumerate(range(56, 92, 2)):
    a = 2.6 * (1 - (t - 56) / 36) ** 1.2
    shake.append((t, [round(GROUND[0] + (a if i % 2 else -a), 1), round(GROUND[1] + (0.5 * a if i % 3 == 0 else -0.4 * a), 1)], 'linear'))
shake += [(92, GROUND, 'linear'), (180, GROUND)]
master = null('master', p=track(*shake), a=GROUND, s=master_s)

wing_r = track((0, 0, 'swing'), (14, -2, 'swing'), (30, 3, 'swing'), (40, 0, 'key'), (50, -10, 'snap'), (56, 6, 'out'),
               *[(t, (-4 if i % 2 else 3), 'swing') for i, t in enumerate(range(62, 92, 5))],
               (94, 0, 'key'), (100, -6, 'out'), (110, 2, 'swing'), (130, -2, 'swing'), (150, 1, 'swing'),
               (164, -3, 'swing'), (180, 0))
wing = null('wing', p=WING_PIVOT, a=WING_PIVOT, r=wing_r, parent='master')

hind_keys = [(0, 0, 'key'), (112, 0, 'key'), (117, -9, 'out')]
t, up = 120, True
while t <= 144:
    hind_keys.append((t, 7 if up else -9, 'swing')); up = not up; t += 4
hind_keys += [(148, 0, 'key'), (180, 0)]
hind = null('hind', p=HIND_PIVOT, a=HIND_PIVOT, r=track(*hind_keys), parent='master')


PAW = kc(1208, 790)
toe_s = track((0, [0, 0], 'key'), (110, [0, 0], 'key'), (114, [115, 115], 'out'), (118, [100, 100], 'swing'),
              (148, [100, 100], 'key'), (152, [0, 0], 'key'), (180, [0, 0]))
TOE_COL = '#F49BA2'
toes = layer('p_paw_toes', *[group('toe%d' % i, ellipse([w, h], p=(PAW[0] + x, PAW[1] + y)), stroke(OUT, W2), fill(BODY))
                             for i, (x, y, w, h) in enumerate([(-13, 3, 11, 13), (0, -3, 12, 15), (13, 3, 11, 13)])],
             p=PAW, a=PAW, s=toe_s, parent='hind')


TAIL = ['tail', 'tail_spike_1', 'tail_spike_2', 'tail_spike_3']
TAIL_PIVOT = kc(1130, 1250)
tail_r = track((0, 0, 'swing'), (20, 1.6, 'swing'), (44, -1.2, 'swing'), (58, 2.4, 'out'), (76, -1.5, 'swing'),
               (96, 2.2, 'out'), (118, -1.6, 'swing'), (140, 1.4, 'swing'), (162, -1, 'swing'), (180, 0))
tail_n = null('tail_rig', p=TAIL_PIVOT, a=TAIL_PIVOT, r=tail_r, parent='master')
HORNS = ['horn_left', 'horn_right', 'spike_head_1', 'spike_head_2', 'spike_head_3']
HORN_PIVOT = kc(900, 480)
horn_r = track((0, 0, 'swing'), (24, 0, 'swing'), (29, -2.5, 'swing'), (36, 1.2, 'swing'), (42, 0, 'swing'), (50, 2, 'snap'),
               (57, -3, 'out'), (66, 0.8, 'swing'), (92, 0, 'swing'), (97, 2.5, 'out'), (104, -1.2, 'swing'), (112, 0.5, 'swing'),
               (125, 0, 'swing'), (160, 0, 'swing'), (166, -1.5, 'swing'), (172, 0.5, 'swing'), (180, 0))
horn_n = null('horn_rig', p=HORN_PIVOT, a=HORN_PIVOT, r=horn_r, parent='master')


def part_layer(pid):
    fill_c, stroke_c, w = STYLE[pid]
    shp, o = shape_track(pid)
    items = [path(shp)]
    if stroke_c:
        items.append(stroke(stroke_c, w))
    if fill_c:
        items.append(fill(fill_c))
    parent = 'wing' if pid in WING else 'hind' if pid in HIND else 'tail_rig' if pid in TAIL else 'horn_rig' if pid in HORNS else 'master'
    lay = layer('p_' + pid, group(pid, *items), parent=parent, **({'o': o} if o is not None else {}))
    return lay


# ---------------------------------------------------------------- FX (fx.py works in concept space)
def to_concept(kx, ky):
    cx, cy = C((kx, ky))
    return ((cx - 30) / 0.7, (cy - 63) / 0.7)


MOUTH = to_concept(560, 790)            # front of the open mouth in K5-K7
FIRE_SCALE = 1.45


def paw_concept(f):
    ang = 0.0
    ks = hind_keys
    for (a, va, _), (b, vb, *_r) in zip(ks, ks[1:]):
        if a <= f <= b:
            u = (f - a) / max(1, b - a); u = u * u * (3 - 2 * u); ang = va + (vb - va) * u; break
    px, py = 1560.0, 1100.0
    m = min(1.0, max(0.0, (f - 103) / 10.0)); m = m * m * (3 - 2 * m)
    if f >= 148:
        m = max(0.0, 1 - (f - 148) / 10.0)
    tip = (1180.0, 1350.0 - 550.0 * m)
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    dx, dy = tip[0] - px, tip[1] - py
    return to_concept(px + c * dx - s * dy, py + s * dx + c * dy)


def fx_layers():
    fire = fx.fire_layers(MOUTH, -12, t_on=55, t_full=60, t_off=91, t_end=100)
    sparks = fx.spark_layers(MOUTH, -12, 58, 88)
    mx, my = MOUTH
    back = to_concept(860, 800)
    nose = to_concept(520, 660)
    cc = lambda x, y: ((x - 30) / 0.7, (y - 63) / 0.7)      # canvas px -> concept
    em = [{'t0': 96, 'pos': (mx, my), 'vel': (-2.4, -0.6), 'size': 46, 'life': 58},
          {'t0': 101, 'pos': (mx + 2, my - 16), 'vel': (-1.9, -0.9), 'size': 36, 'life': 56},
          {'t0': 108, 'pos': cc(262, 292), 'vel': (0.2, -0.5), 'size': 40, 'life': 56},
          {'t0': 114, 'pos': cc(276, 262), 'vel': (0.1, -0.5), 'size': 36, 'life': 52},
          {'t0': 122, 'pos': cc(250, 280), 'vel': (0.2, -0.6), 'size': 32, 'life': 48},
          {'t0': 130, 'pos': cc(284, 280), 'vel': (0.0, -0.3), 'size': 28, 'life': 42}]
    smoke = fx.smoke_layers(em, paw_concept)
    return smoke, sparks + fire


def build():
    smoke, fire = fx_layers()
    head_space = null('head', a=MOUTH, p=[round(30 + 0.7 * MOUTH[0], 1), round(63 + 0.7 * MOUTH[1], 1)], s=70 * FIRE_SCALE)
    world_space = null('world', p=(30, 63), s=70)
    parts = [part_layer(pid) for pid in ORDER]
    eyes = [l for l in parts if l['nm'][2:].startswith(('eye_', 'brow'))]
    rest = [l for l in parts if l not in eyes]
    hind_l = [l for l in rest if l['nm'][2:] in HIND + HAUNCH]
    rest = [l for l in rest if l['nm'][2:] not in HIND + HAUNCH]
    layers = smoke + fire + eyes + [toes] + hind_l + rest + [hind, wing, tail_n, horn_n, master, head_space, world_space]
    return comp('Kissed Dragon', 512, 512, layers, OP, fr=60, bg='#17212B')


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(ROOT, 'build', 'kissed-dragon.json'))
    out = ap.parse_args().out
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    d = build()
    open(out, 'w').write(dumps(d))
    print('wrote', out, os.path.getsize(out), 'bytes')
