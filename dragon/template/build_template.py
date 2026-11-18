#!/usr/bin/env python3
"""Generator for dragon_template.svg (master topology).

Run:  python3 build_template.py [out.svg]
Everything is expressed as anchor lists; `smooth()` turns anchors into G1 cubic
Beziers (only M, C, Z, absolute, 1 decimal).  The number/order of anchors IS the
rig topology - never reorder or change counts once artists have started tracing.
Also writes parts.json (id, closed, anchors, group) next to the svg for PARTS.md.
"""
import math, json, sys, os

W, H = 2000, 1609
PARTS = []          # (group, id, closed, anchors)
GROUPS = []         # (group, color, [ids])


def _f(v):
    return f"{v:.1f}"


def smooth(pts, closed=True):
    """pts: [(x,y)] or [(x,y,'c')] (c = corner).  Catmull-Rom style G1 handles."""
    n = len(pts)
    P = [(p[0], p[1]) for p in pts]
    corner = [len(p) > 2 and p[2] == 'c' for p in pts]
    if not closed:
        corner[0] = corner[-1] = True

    def tang(i):
        if closed:
            a, b = P[(i - 1) % n], P[(i + 1) % n]
        else:
            a, b = P[max(i - 1, 0)], P[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        return dx / L, dy / L

    segs = n if closed else n - 1
    out = [f"M {_f(P[0][0])} {_f(P[0][1])}"]
    for i in range(segs):
        j = (i + 1) % n
        a, b = P[i], P[j]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        if corner[i]:
            c1 = (a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3)
        else:
            t = tang(i)
            c1 = (a[0] + t[0] * d / 3, a[1] + t[1] * d / 3)
        if corner[j]:
            c2 = (b[0] - (b[0] - a[0]) / 3, b[1] - (b[1] - a[1]) / 3)
        else:
            t = tang(j)
            c2 = (b[0] - t[0] * d / 3, b[1] - t[1] * d / 3)
        out.append(f"C {_f(c1[0])} {_f(c1[1])} {_f(c2[0])} {_f(c2[1])} {_f(b[0])} {_f(b[1])}")
    if closed:
        out.append("Z")
    return " ".join(out)


def ell(cx, cy, rx, ry, rot=0.0, n=8, start=180.0):
    """Ellipse with n anchors (exact-ish kappa handles). Clockwise on screen,
    first anchor at angle `start` (deg, y-up; 180 = left-most)."""
    th = 2 * math.pi / n
    k = 4.0 / 3.0 * math.tan(th / 4)
    cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))

    def pt(a):
        x, y = rx * math.cos(a), -ry * math.sin(a)
        return cx + x * cr - y * sr, cy + x * sr + y * cr

    def dr(a):  # derivative wrt decreasing angle (clockwise)
        x, y = rx * math.sin(a), ry * math.cos(a)
        return x * cr - y * sr, x * sr + y * cr

    a0 = math.radians(start)
    out = []
    for i in range(n):
        a = a0 - i * th
        b = a - th
        p0, p1 = pt(a), pt(b)
        d0, d1 = dr(a), dr(b)
        c1 = (p0[0] + d0[0] * k, p0[1] + d0[1] * k)
        c2 = (p1[0] - d1[0] * k, p1[1] - d1[1] * k)
        if i == 0:
            out.append(f"M {_f(p0[0])} {_f(p0[1])}")
        out.append(f"C {_f(c1[0])} {_f(c1[1])} {_f(c2[0])} {_f(c2[1])} {_f(p1[0])} {_f(p1[1])}")
    out.append("Z")
    return " ".join(out), n


def add(group, pid, pts, closed=True):
    d = smooth(pts, closed)
    PARTS.append(dict(group=group, id=pid, closed=closed, n=len(pts), d=d, pts=pts))


def add_ell(group, pid, *a, **k):
    d, n = ell(*a, **k)
    PARTS.append(dict(group=group, id=pid, closed=True, n=n, d=d))


def C(*xs):
    return list(xs)


def arc(cx, cy, r, angles):
    return [(cx + r * math.cos(math.radians(a)), cy - r * math.sin(math.radians(a))) for a in angles]


def tooth(a, b, tip):
    """5-anchor tooth: base-a, left flank, tip, right flank, base-b (clockwise when tip is below)."""
    def lerp(p, q, t):
        return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
    return [(a[0], a[1], 'c'), lerp(a, tip, 0.55), (tip[0], tip[1], 'c'), lerp(b, tip, 0.55), (b[0], b[1], 'c')]


# --------------------------------------------------------------------------
# K0 geometry
# --------------------------------------------------------------------------
MOUTH = [(445, 654), (505, 639), (586, 642), (661, 660), (730, 690), (780, 720),
         (811, 732), (849, 706), (880, 690), (924, 706), (961, 722), (982, 745)]

EYE = (1086, 611)   # near eye centre

# ---- groups in paint order (back -> front) ------------------------------
# wing_back
add("g_wing_back", "wing_lobe", [
    (1650, 258), (1618, 288), (1575, 330), (1558, 366), (1478, 386), (1418, 432),
    (1396, 500), (1372, 572), (1332, 622), (1292, 600), (1262, 520), (1262, 440),
    (1272, 365), (1312, 322), (1400, 280), (1500, 258), (1585, 244)])

add("g_spikes", "spike_head_3", [(1296, 424), (1350, 440), (1386, 500), (1392, 590), (1352, 612), (1290, 566), (1250, 500)])
add("g_spikes", "spike_back_1", [(1709, 914), (1745, 945), (1752, 1000), (1745, 1066), (1700, 1040), (1670, 985), (1660, 942)])

# tail
add("g_tail", "tail", [
    (1055, 1294), (1130, 1303), (1250, 1322), (1360, 1334), (1460, 1340), (1555, 1318),
    (1620, 1262), (1655, 1190), (1665, 1110), (1670, 1030), (1730, 1055), (1782, 1125),
    (1796, 1210), (1772, 1305), (1715, 1395), (1625, 1448), (1500, 1470), (1380, 1480),
    (1255, 1462), (1180, 1410), (1110, 1345), (1068, 1314)])
add("g_tail", "tail_spike_1", [(1252, 1318, 'c'), (1272, 1292), (1300, 1281), (1318, 1300), (1318, 1322, 'c')])
add("g_tail", "tail_spike_2", [(1358, 1330, 'c'), (1398, 1285), (1428, 1246), (1450, 1285), (1476, 1330, 'c')])
add("g_tail", "tail_spike_3", [(1490, 1294, 'c'), (1525, 1250), (1565, 1196), (1590, 1230), (1608, 1292, 'c')])

# body
add("g_body", "body", [
    (1150, 455), (1230, 470), (1330, 520), (1420, 610), (1480, 700), (1552, 744), (1606, 792),
    (1652, 895), (1676, 985), (1686, 1050), (1680, 1140), (1640, 1230), (1560, 1300),
    (1450, 1345), (1300, 1352), (1150, 1352), (1000, 1356), (900, 1352), (800, 1346),
    (720, 1340), (580, 1334), (460, 1290), (418, 1180), (412, 1080), (414, 990),
    (430, 925), (470, 868), (600, 862), (750, 810), (900, 650), (1020, 520)])
add("g_body", "belly", [
    (547, 862), (640, 858), (690, 900), (703, 980), (703, 1060), (690, 1190), (660, 1260),
    (602, 1298), (545, 1270), (495, 1215), (470, 1130), (462, 1030), (480, 940)])
add("g_body", "belly_under", [
    (915, 1234), (990, 1248), (1060, 1262), (1075, 1300), (1070, 1346), (960, 1354), (872, 1340), (890, 1285)])
add("g_body", "belly_stripe_1", [(520, 891), (580, 906), (640, 921), (699, 927)], False)
add("g_body", "belly_stripe_2", [(472, 976), (540, 1000), (620, 1012), (702, 1016)], False)
add("g_body", "belly_stripe_3", [(474, 1092), (540, 1118), (610, 1134), (678, 1136)], False)
add("g_body", "belly_stripe_4", [(500, 1232), (550, 1256), (600, 1270), (650, 1272)], False)
add("g_body", "heart", [(1038, 1112, 'c'), (1012, 1096), (1020, 1078), (1040, 1084), (1062, 1078),
                        (1078, 1092), (1068, 1112), (1052, 1122)])
for i, (cx, cy, rx, ry, rot) in enumerate([(1462, 792, 27, 29, -15), (1423, 882, 24, 32, 10), (1535, 908, 30, 28, -20),
                                          (1567, 1006, 26, 26, 0), (1506, 1118, 32, 24, 15)], 1):
    PARTS.append(dict(group="g_spots", id=f"spot_{i}", closed=True, n=6, d=ell(cx, cy, rx, ry, rot, n=6)[0]))

# legs
add("g_legs", "foot_front_far", [
    (291, 1236), (330, 1206), (387, 1186), (430, 1192), (470, 1240), (500, 1290), (512, 1335),
    (450, 1354), (366, 1349), (322, 1340), (292, 1296)])
add("g_legs", "toe_far_1", [(318, 1322), (330, 1312), (342, 1322), (330, 1334)])
add("g_legs", "toe_far_2", [(360, 1318), (372, 1308), (386, 1318), (372, 1330)])
add("g_legs", "leg_front_near", [
    (690, 1052), (780, 1030), (860, 1075), (897, 1135), (893, 1235), (880, 1326),
    (800, 1346), (700, 1336), (688, 1280), (682, 1180), (680, 1100)])
add("g_legs", "paw_front_near", [
    (592, 1342), (640, 1316), (690, 1304), (735, 1318), (800, 1330), (870, 1325),
    (884, 1362), (852, 1410), (792, 1448), (725, 1463), (658, 1450), (612, 1414)])
add_ell("g_legs", "toe_near_1", 616, 1378, 12, 17, 20, n=4)
add_ell("g_legs", "toe_near_2", 662, 1414, 12, 14, 10, n=4)
add_ell("g_legs", "toe_near_3", 712, 1432, 12, 13, 0, n=4)
add("g_legs", "hind_leg", [
    (1480, 1040), (1560, 1032), (1622, 1052), (1656, 1105), (1660, 1180), (1640, 1240),
    (1590, 1282), (1520, 1294), (1440, 1296), (1370, 1292), (1310, 1286), (1280, 1284),
    (1250, 1280), (1222, 1270), (1195, 1258), (1160, 1246), (1148, 1234), (1162, 1220),
    (1188, 1208), (1216, 1188), (1250, 1164), (1290, 1136), (1330, 1110), (1380, 1082),
    (1425, 1062), (1452, 1050)])
add("g_legs", "hind_toes", [(1150, 1262), (1160, 1244), (1180, 1250), (1196, 1236), (1214, 1246), (1236, 1236),
                            (1252, 1252), (1270, 1262), (1262, 1288), (1226, 1298), (1190, 1296), (1160, 1284)])

# head
add("g_head", "head", [
    (408, 652), (422, 592), (444, 534), (490, 487), (548, 472), (592, 432), (648, 390),
    (700, 380), (742, 400), (772, 470), (800, 496), (860, 494), (905, 468), (925, 425), (970, 398),
    (1050, 394), (1100, 418), (1140, 462), (1200, 476), (1244, 520), (1262, 590), (1256, 690), (1230, 760), (1130, 800), (1050, 782)] +
    [MOUTH[11], MOUTH[10], MOUTH[9], MOUTH[8], MOUTH[7], MOUTH[6], MOUTH[5], MOUTH[4], MOUTH[3], MOUTH[2], MOUTH[1], MOUTH[0]])
add("g_jaw", "jaw", [MOUTH[0]] + MOUTH[1:] +
    [(992, 770), (985, 805), (960, 838), (900, 862), (800, 880), (700, 880), (600, 868), (520, 846),
     (460, 805), (420, 745), (408, 690)])

# mouth
add("g_mouth", "mouth_line", MOUTH, False)
add("g_mouth", "mouth_cavity", [MOUTH[0] + ('c',)] + MOUTH[1:11] + [MOUTH[11] + ('c',)] +
    [(p[0], p[1] + 3) for p in reversed(MOUTH[1:11])])
# tongue: 6 anchors along the mouth line + 4 returning
add("g_mouth", "tongue", [MOUTH[3] + ('c',), MOUTH[4], MOUTH[5], MOUTH[6], MOUTH[7], MOUTH[8] + ('c',),
                          (MOUTH[7][0], MOUTH[7][1] + 3), (MOUTH[6][0], MOUTH[6][1] + 3),
                          (MOUTH[5][0], MOUTH[5][1] + 3), (MOUTH[4][0], MOUTH[4][1] + 3)])
add("g_mouth", "teeth_upper_1", tooth((925, 712), (982, 740), (955, 792)))   # corner fang (visible in K0)


def parked_tooth(anchor, up):
    x, y = anchor
    return tooth((x - 3, y), (x + 3, y), (x, y + (-5 if up else 5))) if not up else tooth((x + 3, y), (x - 3, y), (x, y - 5))


add("g_mouth", "teeth_upper_2", parked_tooth(MOUTH[2], False))
add("g_mouth", "teeth_upper_3", parked_tooth(MOUTH[3], False))
add("g_mouth", "teeth_lower_1", parked_tooth((MOUTH[4][0], MOUTH[4][1] + 3), True))
add("g_mouth", "teeth_lower_2", parked_tooth((MOUTH[6][0], MOUTH[6][1] + 3), True))
add("g_mouth", "teeth_lower_3", parked_tooth((MOUTH[8][0], MOUTH[8][1] + 3), True))

# nostrils
add_ell("g_nostrils", "nostril_1", 517, 556, 14, 23, 8, n=6)
add_ell("g_nostrils", "nostril_2", 639, 577, 27, 17, -22, n=6)

# cheek puff (flat inside cheek) + far cheek (parked behind snout)
add_ell("g_cheek", "cheek_puff", 1075, 776, 130, 46, 0, n=8)
add_ell("g_cheek", "cheek_puff_far", 478, 560, 12, 6, 0, n=8)

# marks
add("g_marks", "kiss_upper", [
    (990, 912), (1010, 933), (1040, 930), (1075, 912), (1100, 897), (1120, 877), (1146, 868), (1173, 863),
    (1200, 864), (1227, 860), (1255, 862), (1285, 861), (1315, 850), (1320, 830), (1307, 813), (1267, 787),
    (1213, 763), (1173, 767), (1147, 787), (1100, 797), (1060, 803), (1027, 840), (1005, 882)])
add("g_marks", "kiss_lower", [
    (1030, 967), (1073, 937), (1113, 932), (1160, 937), (1200, 930), (1240, 900), (1273, 893),
    (1323, 883), (1327, 907), (1293, 947), (1253, 987), (1213, 1007), (1160, 1027), (1107, 1013), (1053, 987)])
add_ell("g_marks", "blush", 1090, 756, 24, 6, 0, n=6)


# eyes -----------------------------------------------------------------
def eye(prefix, group, c, r_out, r_ring, r_iris, shine_off, shine_r):
    cx, cy = c
    add_ell(group, f"{prefix}_outer", cx, cy, r_out, r_out, 0, n=8)
    add_ell(group, f"{prefix}_ring", cx + 2, cy - 2, r_ring, r_ring, 0, n=8)
    add_ell(group, f"{prefix}_iris", cx, cy - 4, r_iris, r_iris, 0, n=6)
    add_ell(group, f"{prefix}_shine", cx + shine_off[0], cy + shine_off[1], shine_r[0], shine_r[1], -20, n=4)
    # lid: outer arc over the top (6 anchors) + inner arc return (4 anchors) -> thin crescent
    o = arc(cx, cy, r_out, [186, 150, 115, 65, 30, -6])
    ia = arc(cx, cy, r_out - max(r_out * 0.06, 1.0), [28, 68, 112, 152])
    lid = [(o[0][0], o[0][1], 'c')] + o[1:5] + [(o[5][0], o[5][1], 'c')] + ia
    add(group, f"{prefix}_lid", lid)
    br = arc(cx, cy, r_out + max(r_out * 0.1, 1.0), [150, 120, 90, 60, 30])
    add(group, f"{prefix}_brow", br, False)


eye("eye_near", "g_eye_near", EYE, 131, 89, 66, (-25, -48), (30, 20))
eye("eye_far", "g_eye_far", (478, 514), 9, 7, 4.6, (-1.5, -2), (1.6, 1.0))

# wing -----------------------------------------------------------------
def PX(pts, ox=1240, oy=230, sc=1.35):
    return [(round(ox + p[0] / sc, 1), round(oy + p[1] / sc, 1)) + tuple(p[2:]) for p in pts]


add("g_wing", "wing_main", PX([
    (285, 235), (330, 205), (440, 176), (520, 178), (600, 198), (720, 245), (830, 300), (915, 350), (956, 392),
    (940, 415), (880, 435), (810, 470), (755, 515), (738, 560), (752, 610), (725, 632), (690, 622), (640, 590),
    (590, 578), (540, 590), (500, 625), (480, 665), (455, 672), (440, 640), (420, 625), (300, 630), (205, 665),
    (230, 600), (265, 520), (296, 440), (310, 370), (300, 300)]))
add("g_wing", "wing_membrane_1", PX([(350, 392, 'c'), (395, 500), (435, 626, 'c'), (340, 608), (240, 640, 'c'), (300, 520)]))
add("g_wing", "wing_membrane_2", PX([(430, 345, 'c'), (540, 435), (620, 505), (660, 558, 'c'), (575, 578), (490, 598, 'c'), (458, 470)]))
add("g_wing", "wing_membrane_3", PX([(475, 265, 'c'), (600, 285), (740, 325), (890, 380, 'c'), (800, 445), (710, 525, 'c'),
                                    (600, 455), (520, 360)]))
add("g_wing", "wing_bone_1", PX([(385, 305), (415, 420), (445, 540), (470, 650)]), False)
add("g_wing", "wing_bone_2", PX([(440, 262), (500, 350), (600, 470), (740, 608)]), False)
add("g_wing", "wing_bone_3", PX([(440, 250), (560, 262), (720, 320), (895, 385)]), False)

# horns & spikes ---------------------------------------------------------
add("g_spikes", "horn_left", [
    (743, 119), (780, 137), (807, 193), (817, 253), (813, 307), (793, 347), (773, 373), (700, 395),
    (620, 380), (617, 333), (630, 293), (653, 277), (677, 278), (690, 293), (703, 260), (720, 207), (730, 153)])
add("g_spikes", "horn_right", [
    (1260, 140), (1290, 167), (1300, 227), (1280, 287), (1233, 347), (1227, 407), (1193, 460),
    (1140, 480), (1087, 450), (1070, 407), (1087, 360), (1093, 320), (1113, 287), (1137, 275),
    (1157, 287), (1170, 313), (1193, 307), (1220, 260), (1240, 187)])
add("g_spikes", "spike_head_1", [(872, 268), (907, 305), (925, 355), (915, 420), (880, 470), (820, 495), (775, 490),
                                 (765, 430), (782, 372), (820, 310)])
add("g_spikes", "spike_head_2", [(1020, 259), (1055, 288), (1072, 335), (1075, 380), (1030, 400), (960, 395),
                                 (925, 380), (935, 335), (962, 295)])


# --------------------------------------------------------------------------
GROUP_ORDER = [
    ("g_wing_back", "#ff3df2"), ("g_spikes", "#b366ff"), ("g_tail", "#ff9d00"), ("g_body", "#00e5ff"),
    ("g_spots", "#7dff00"), ("g_legs", "#ffe500"), ("g_wing", "#00ff9d"), ("g_head", "#ffffff"),
    ("g_jaw", "#ff5252"), ("g_cheek", "#00b3ff"), ("g_marks", "#ff80ab"), ("g_mouth", "#39ff14"),
    ("g_nostrils", "#ffab00"), ("g_eye_far", "#40c4ff"), ("g_eye_near", "#e040fb"),
]


def build(out):
    seen = set()
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
    for g, col in GROUP_ORDER:
        members = [p for p in PARTS if p['group'] == g]
        lines.append(f'  <g id="{g}" fill="none" stroke="{col}" stroke-width="4" stroke-linejoin="round">')
        for p in members:
            assert p['id'] not in seen, p['id']
            seen.add(p['id'])
            lines.append(f'    <path id="{p["id"]}" d="{p["d"]}"/>')
        lines.append('  </g>')
    assert all(p['group'] in dict(GROUP_ORDER) for p in PARTS)
    lines.append('</svg>')
    open(out, 'w').write("\n".join(lines) + "\n")
    json.dump([{k: p[k] for k in ('group', 'id', 'closed', 'n')} for p in sorted(PARTS, key=lambda p: [g for g, _ in GROUP_ORDER].index(p['group']))],
              open(os.path.join(os.path.dirname(os.path.abspath(out)), 'parts.json'), 'w'), indent=1)
    print(len(PARTS), 'paths', sum(p['n'] for p in PARTS), 'points')


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dragon_template.svg')
    build(out)
