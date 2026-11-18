#!/usr/bin/env python3
"""Builds feasibility SVGs (K4, K5, K8) from the master template by only moving
anchors (counts asserted equal).  Output: feasibility/feas_K4.svg ... + overlay helper.
Run from anywhere:  python3 make_feasibility.py"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_template as T
from build_template import smooth, ell, tooth, arc

HERE = os.path.dirname(os.path.abspath(__file__))
P = {p['id']: p for p in T.PARTS}


def pts_of(i):
    return [tuple(q) for q in P[i]['pts']]


def xf(pts, fn):
    out = []
    for q in pts:
        x, y = fn(q[0], q[1])
        out.append((x, y) + tuple(q[2:]))
    return out


def rot(cx, cy, deg, tx=0, ty=0, s=1.0):
    c, sn = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return lambda x, y: (cx + s * ((x - cx) * c - (y - cy) * sn) + tx, cy + s * ((x - cx) * sn + (y - cy) * c) + ty)


def build(name, over, drop=()):
    """over: id -> ('pts', list, closed) | ('ell', args, kwargs)"""
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{T.W}" height="{T.H}" viewBox="0 0 {T.W} {T.H}">']
    for g, col in T.GROUP_ORDER:
        lines.append(f'  <g id="{g}" fill="none" stroke="{col}" stroke-width="4" stroke-linejoin="round">')
        for p in [p for p in T.PARTS if p['group'] == g]:
            d = p['d']
            if p['id'] in over:
                o = over[p['id']]
                if o[0] == 'pts':
                    assert len(o[1]) == p['n'], (p['id'], len(o[1]), p['n'])
                    d = smooth(o[1], p['closed'])
                else:
                    dd, n = ell(*o[1], **o[2])
                    assert n == p['n'], p['id']
                    d = dd
            lines.append(f'    <path id="{p["id"]}" d="{d}"/>')
        lines.append('  </g>')
    lines.append('</svg>')
    os.makedirs(os.path.join(HERE, 'feasibility'), exist_ok=True)
    open(os.path.join(HERE, 'feasibility', name), 'w').write("\n".join(lines) + "\n")


def lid(cx, cy, rx, ry_out, ry_in, rotdeg=0):
    """lid anchors (10) on ellipse arcs: outer arc over the top + inner arc."""
    f = rot(cx, cy, rotdeg)
    def e(r, angs):
        return [f(cx + rx * math.cos(math.radians(a)), cy - r * math.sin(math.radians(a))) for a in angs]
    o = e(ry_out, [186, 150, 115, 65, 30, -6])
    i = e(ry_in, [28, 68, 112, 152])
    return [o[0] + ('c',)] + o[1:5] + [o[5] + ('c',)] + i


def ellp(cx, cy, rx, ry, rotdeg=0, n=8, start=180.0):
    return ('ell', (cx, cy, rx, ry, rotdeg), dict(n=n, start=start))


MOUTH = T.MOUTH
# ----------------------------------------------------------------- K8
over = {}
K8leg = [(1480, 922), (1560, 945), (1622, 1000), (1648, 1070), (1632, 1150), (1585, 1205), (1520, 1232), (1445, 1236),
         (1380, 1220), (1330, 1195), (1280, 1150), (1235, 1128), (1195, 1108), (1178, 1050), (1175, 980), (1172, 910),
         (1160, 850), (1148, 795), (1175, 765), (1225, 748), (1275, 770), (1298, 830), (1300, 900), (1306, 960),
         (1330, 930), (1400, 918)]
over['hind_leg'] = ('pts', K8leg, True)
over['hind_toes'] = ('pts', [(1152, 840), (1156, 805), (1176, 792), (1192, 772), (1215, 782), (1235, 760), (1255, 777),
                             (1276, 772), (1292, 802), (1290, 842), (1225, 852), (1178, 852)], True)
over['blush'] = ellp(1110, 745, 70, 28, -10, n=6)
build('feas_K8.svg', over)

# ----------------------------------------------------------------- K5
over = {}
L5 = [(471, 658), (517, 676), (550, 684), (578, 674), (610, 664), (650, 656), (700, 652), (750, 667), (800, 700),
      (850, 742), (887, 792), (896, 818)]
LL5 = [(601, 910), (607, 950), (630, 985), (665, 1003), (705, 1010), (745, 1003), (785, 985), (822, 958),
       (852, 920), (876, 880), (890, 845), (896, 818)]
hd = pts_of('head')
hd = hd[:-12] + list(reversed(L5))
over['head'] = ('pts', hd, True)
over['mouth_line'] = ('pts', L5, False)
over['jaw'] = ('pts', LL5 + [(930, 840), (925, 905), (890, 965)] +
               [(845, 1015), (790, 1050), (725, 1062), (660, 1055), (610, 1035), (575, 1000), (565, 962), (580, 925)], True)
bot = [(886, 850), (868, 890), (842, 930), (805, 962), (765, 980), (722, 988), (682, 985), (648, 968), (620, 940), (612, 912)]
over['mouth_cavity'] = ('pts', [L5[0] + ('c',)] + L5[1:11] + [L5[11] + ('c',)] + bot, True)
over['tongue'] = ('pts', [(690, 880), (680, 840), (715, 805), (770, 788), (825, 790), (868, 812), (882, 850), (850, 895),
                          (790, 935), (725, 945)], True)
over['teeth_upper_1'] = ('pts', tooth((625, 660), (665, 654), (650, 702)), True)
over['teeth_upper_2'] = ('pts', tooth((498, 676), (530, 684), (512, 716)), True)
over['teeth_upper_3'] = ('pts', T.parked_tooth(L5[8], False), True)
over['teeth_lower_1'] = ('pts', tooth((640, 944), (616, 940), (626, 893)), True)
over['teeth_lower_2'] = ('pts', tooth((765, 958), (722, 955), (738, 908)), True)
over['teeth_lower_3'] = ('pts', T.parked_tooth(LL5[9], True), True)
over['cheek_puff'] = ellp(1030, 785, 190, 175, 0)
# near eye (angry): centre (1017,558)
cx, cy = 1017, 558
over['eye_near_outer'] = ellp(cx, cy, 92, 86, -8)
over['eye_near_ring'] = ellp(cx, cy, 77, 73, -8)
over['eye_near_iris'] = ellp(cx - 10, cy - 2, 38, 42, 0, n=6)
over['eye_near_shine'] = ellp(cx - 15, cy - 25, 8, 11, 0, n=4)
over['eye_near_lid'] = ('pts', lid(cx, cy, 92, 88, 8, rotdeg=-14), True)
over['eye_near_brow'] = ('pts', arc(cx - 5, cy - 8, 104, [165, 130, 95, 60, 25]), False)
fx, fy = 600, 462
over['eye_far_outer'] = ellp(fx, fy, 46, 44, 0)
over['eye_far_ring'] = ellp(fx, fy, 38, 37, 0)
over['eye_far_iris'] = ellp(fx + 4, fy + 6, 21, 24, 0, n=6)
over['eye_far_shine'] = ellp(fx - 2, fy - 6, 6, 8, 0, n=4)
over['eye_far_lid'] = ('pts', lid(fx, fy, 46, 44, 12, rotdeg=-20), True)
over['eye_far_brow'] = ('pts', arc(fx, fy, 56, [160, 130, 95, 60, 30]), False)
over['nostril_2'] = ellp(650, 590, 24, 15, -25, n=6)
over['nostril_1'] = ellp(520, 575, 12, 20, 10, n=6)
build('feas_K5.svg', over)

# ----------------------------------------------------------------- K4
over = {}
def wy(y): return min(max((y - 420) / 220.0, 0), 1)
def wx(x): return min(max((1050 - x) / 450.0, 0), 1)
def warp(x, y):
    w = wy(y) * wx(x)
    return x - 25 * w, y + 130 * w
def warpjaw(x, y):
    w = wx(x) ** 0.7
    return x - 25 * w, y + 120 * w
over['head'] = ('pts', xf(pts_of('head'), warp), True)
over['jaw'] = ('pts', xf(pts_of('jaw'), warpjaw), True)
over['mouth_line'] = ('pts', [(445 + (x - 445) * 0.72 - 20, 792 + (y - 654) * 0.4) for x, y in MOUTH], False)
ml = over['mouth_line'][1]
over['mouth_cavity'] = ('pts', [ml[0] + ('c',)] + ml[1:11] + [ml[11] + ('c',)] + [(p[0], p[1] + 3) for p in reversed(ml[1:11])], True)
over['tongue'] = ('pts', [ml[3] + ('c',), ml[4], ml[5], ml[6], ml[7], ml[8] + ('c',)] + [(ml[k][0], ml[k][1] + 3) for k in (7, 6, 5, 4)], True)
over['teeth_upper_1'] = ('pts', T.parked_tooth(ml[11], False), True)
over['nostril_1'] = ellp(470, 690, 14, 20, 20, n=6)
over['nostril_2'] = ellp(625, 690, 28, 13, -15, n=6)
over['cheek_puff'] = ellp(1055, 840, 250, 210, 0)
over['cheek_puff_far'] = ellp(400, 650, 100, 90, 0)
# eyes squeezed shut
ex, ey = 1030, 588
over['eye_near_outer'] = ellp(ex, ey, 120, 16, -12)
over['eye_near_ring'] = ellp(ex, ey, 100, 5, -12)
over['eye_near_iris'] = ellp(ex, ey, 60, 3, -12, n=6)
over['eye_near_shine'] = ellp(ex, ey, 10, 2, -12, n=4)
over['eye_near_lid'] = ('pts', lid(ex, ey, 124, 26, 8, rotdeg=-12), True)
over['eye_near_brow'] = ('pts', [(ex - 130, ey - 60), (ex - 70, ey - 82), (ex, ey - 90), (ex + 70, ey - 82), (ex + 130, ey - 55)], False)
over['blush'] = ellp(1090, 756, 24, 6, 0, n=6)
for k, (a, b) in dict(outer=(14, 3), ring=(8, 2), iris=(5, 2), shine=(1, 1)).items():
    pass
over['eye_far_lid'] = ('pts', lid(640, 670, 36, 20, 5, rotdeg=-10), True)
over['eye_far_outer'] = ellp(640, 670, 34, 8, -10)
over['eye_far_ring'] = ellp(640, 670, 26, 4, -10)
over['eye_far_iris'] = ellp(640, 670, 14, 2, -10, n=6)
over['eye_far_shine'] = ellp(640, 670, 4, 1, -10, n=4)
over['eye_far_brow'] = ('pts', arc(640, 672, 46, [160, 130, 95, 60, 30]), False)
# belly puffed
bc = (600, 1090)
for pid in ['belly', 'belly_stripe_1', 'belly_stripe_2', 'belly_stripe_3', 'belly_stripe_4']:
    over[pid] = ('pts', xf(pts_of(pid), lambda x, y: (bc[0] + (x - bc[0]) * 1.3 - 40, bc[1] + (y - bc[1]) * 1.12 + 15)), P[pid]['closed'])
# wing raised
wr = rot(1380, 700, -14)
for pid in ['wing_lobe', 'wing_main', 'wing_membrane_1', 'wing_membrane_2', 'wing_membrane_3', 'wing_bone_1', 'wing_bone_2', 'wing_bone_3']:
    over[pid] = ('pts', xf(pts_of(pid), wr), P[pid]['closed'])
build('feas_K4.svg', over)
print('ok')
