"""Per-frame fitting spec: landmarks (TPS for the head), explicit shapes, snapping."""
from warp import ellipse_pts as E

HEAD_IDS = ['head', 'jaw', 'mouth_line', 'mouth_cavity', 'tongue', 'teeth_upper_1', 'teeth_upper_2', 'teeth_upper_3',
            'teeth_lower_1', 'teeth_lower_2', 'teeth_lower_3', 'nostril_1', 'nostril_2', 'brow_fold', 'cheek_puff',
            'cheek_puff_far', 'blush', 'eye_far_outer', 'eye_far_ring', 'eye_far_iris', 'eye_far_shine', 'eye_far_lid',
            'eye_far_brow', 'eye_near_outer', 'eye_near_ring', 'eye_near_iris', 'eye_near_shine', 'eye_near_lid',
            'eye_near_brow', 'eye_near_crease', 'chin_highlight']
SNAP_IDS = ['body', 'head', 'jaw', 'horn_left', 'horn_right', 'spike_head_1', 'spike_head_2', 'spike_head_3',
            'spike_back_1', 'wing_lobe', 'wing_main', 'tail', 'foot_front_far', 'leg_front_near', 'leg_front_near_line',
            'hind_leg', 'hind_leg_line', 'mouth_line', 'belly']
# body points that stay put (anchor the TPS so only the head deforms)
FIXED = [(1600, 1000), (1500, 1300), (900, 1300), (400, 1250), (1850, 500), (1300, 1050), (1000, 1150), (1650, 700),
         (700, 1150), (1400, 300), (300, 200), (200, 900)]

K0 = dict(nose=(455, 585), lip=(440, 650), n1=(516, 556), n2=(639, 577), mmid=(700, 695), mback=(930, 720),
          fang=(955, 792), chin=(560, 835), throat=(800, 870), eye=(1092, 605), feye=(478, 512), top=(960, 430),
          hornL=(720, 375), hornR=(1135, 425), cheek=(1260, 720))


def eye_set(prefix, cx, cy, rx, ry, rot=0):
    """outer / ring / iris / shine ellipses for an eye"""
    return {f'{prefix}_outer': E(cx, cy, rx, ry, rot),
            f'{prefix}_ring': E(cx, cy, rx * 0.78, ry * 0.78, rot),
            f'{prefix}_iris': E(cx + rx * 0.04, cy, rx * 0.55, ry * 0.55, rot),
            f'{prefix}_shine': E(cx - rx * 0.18, cy - ry * 0.25, rx * 0.16, ry * 0.12, rot, k=6)}


def lid(cx, cy, rx, ry, level, sag=0.12):
    """upper lid covering the eye down to `level` (0 = open, 1 = closed); lower edge sags slightly"""
    import numpy as np
    yl = cy - ry + 2 * ry * level
    top = [(cx + rx * np.cos(a), cy + ry * np.sin(a)) for a in np.radians(np.linspace(200, 340, 7))]
    half = np.sqrt(max(1e-6, 1 - ((yl - cy) / ry) ** 2)) * rx
    bottom = [(cx + half, yl), (cx, yl + ry * sag), (cx - half, yl)]
    return top + bottom


FRAMES = {
    'K1': dict(tps=None, shapes={'eye_near_lid': lid(1092, 605, 118, 118, 0.42)}),
    'K2': dict(tps=dict(nose=(452, 640), lip=(420, 790), n1=(470, 672), n2=(625, 690), mmid=(700, 820),
                        mback=(985, 790), fang=(958, 862), chin=(570, 945), throat=(800, 960), feye=(530, 540)),
               shapes={'nostril_1': E(467, 672, 15, 23, 0, k=6), **eye_set('eye_far', 532, 540, 30, 55, 10), 'eye_far_lid': lid(532, 540, 30, 55, 0.42),
                       'eye_near_lid': lid(1092, 605, 118, 118, 0.42)}),
    'K3': dict(tps=dict(nose=(440, 650), lip=(430, 770), n1=(468, 672), n2=(622, 688), mmid=(700, 805),
                        mback=(935, 748), fang=(790, 862), chin=(570, 935), throat=(800, 950), feye=(545, 525)),
               shapes={'nostril_1': E(467, 673, 16, 21, -8, k=6), **eye_set('eye_far', 545, 525, 48, 70, 8), **eye_set('eye_near', 1088, 612, 125, 125)}),
}


def eye_closed(prefix, cx, cy, rx, rot):
    """a squeezed-shut eye: everything collapses onto the lid line"""
    d = eye_set(prefix, cx, cy, rx, 7, rot)
    d[f'{prefix}_lid'] = lid(cx, cy, rx, 7, 1.0, sag=0.0)
    return d


WING = (['wing_lobe', 'wing_main'], ['wing_membrane_1', 'wing_membrane_2', 'wing_membrane_3',
                                      'wing_bone_1', 'wing_bone_2', 'wing_bone_3'])
CROWN = (['horn_left', 'horn_right', 'spike_head_1', 'spike_head_2'], ['spike_head_3'])

# --- open-mouth frames share the mouth (the AI kept it consistent) ---
OPEN_MOUTH = {
    'mouth_cavity': [(525, 670), (600, 652), (720, 652), (800, 678), (860, 728), (892, 795), (865, 865), (820, 910),
                     (750, 945), (680, 952), (630, 935), (600, 890), (585, 820), (550, 740)],
    'mouth_line': [(525, 670), (600, 652), (720, 652), (800, 678), (860, 728), (892, 795)],
    'tongue': [(665, 840), (720, 800), (800, 810), (840, 860), (810, 920), (740, 940), (680, 920), (655, 880)],
    'teeth_upper_1': [(635, 666), (662, 664), (650, 698)],
    'teeth_upper_2': [(496, 668), (524, 668), (510, 702)],
    'teeth_upper_3': [(820, 698), (836, 708), (826, 722)],
    'teeth_lower_1': [(616, 940), (646, 940), (630, 890)],
    'teeth_lower_2': [(724, 955), (752, 955), (738, 912)],
    'teeth_lower_3': [(818, 905), (836, 896), (828, 875)],
    'cheek_puff': E(1100, 805, 200, 185),
    'nostril_1': E(515, 572, 11, 24, -12, k=6),
}
OPEN_TPS = dict(nose=(480, 560), lip=(500, 670), n1=(505, 570), n2=(655, 575), mmid=(720, 652), mback=(892, 795),
                fang=(650, 698), chin=(690, 1000), throat=(900, 965), feye=(590, 462), eye=(1012, 548))

FRAMES['K3'] = dict(tps=FRAMES['K3']['tps'], shapes={
    **FRAMES['K3']['shapes'],
    'mouth_line': [(430, 768), (480, 775), (560, 790), (640, 800), (700, 808), (760, 812), (800, 805), (860, 790),
                   (900, 775), (935, 750)],
    'teeth_upper_1': [(762, 818), (812, 820), (790, 862)]})

FRAMES['K4'] = dict(
    register=[CROWN],
    tps=dict(nose=(460, 665), lip=(450, 775), n1=(465, 680), n2=(620, 670), mmid=(650, 780), mback=(800, 810),
             fang=(805, 815), chin=(600, 890), throat=(800, 905), feye=(560, 522), eye=(1025, 540)),
    shapes={'nostril_1': E(468, 680, 12, 26, -15, k=6), 'mouth_line': [(440, 772), (500, 788), (560, 790), (650, 776), (720, 785), (770, 800), (805, 815)],
            'cheek_puff': E(1055, 835, 245, 205), 'cheek_puff_far': E(368, 725, 56, 160),
            **eye_closed('eye_near', 1025, 540, 105, 8), **eye_closed('eye_far', 548, 528, 42, 28),
            'eye_near_brow': [(840, 560), (900, 540), (1000, 530), (1080, 545), (1140, 570)],
            'teeth_upper_1': [(796, 812), (812, 812), (805, 820)]},
    snap_radii=(40, 24, 12))

FRAMES['K5'] = dict(register=[CROWN], tps=OPEN_TPS, snap_radii=(30, 18, 10), shapes={
    **OPEN_MOUTH, **eye_set('eye_near', 1012, 548, 98, 83), 'eye_near_lid': lid(1012, 548, 98, 83, 0.12),
    'eye_near_brow': [(860, 490), (900, 470), (960, 462), (1060, 470), (1120, 500)],
    **eye_set('eye_far', 590, 462, 34, 40), 'eye_far_lid': lid(590, 462, 34, 40, 0.1),
    'eye_far_brow': [(548, 420), (570, 410), (590, 404), (610, 402), (628, 406)]})

FRAMES['K6'] = dict(register=[CROWN], tps=OPEN_TPS, snap_radii=(30, 18, 10), shapes={
    **OPEN_MOUTH, **eye_closed('eye_near', 1005, 552, 92, -4), **eye_closed('eye_far', 578, 468, 26, -10),
    'eye_near_brow': [(870, 500), (930, 480), (990, 475), (1050, 480), (1100, 500)],
    'eye_far_brow': [(548, 440), (565, 432), (582, 428), (600, 430), (615, 436)]})

FRAMES['K7'] = dict(register=[CROWN], tps=dict(OPEN_TPS, feye=(592, 457), eye=(990, 550)),
                    snap_radii=(30, 18, 10), shapes={
    **OPEN_MOUTH, **eye_set('eye_near', 990, 550, 84, 84), **eye_set('eye_far', 592, 457, 42, 44),
    'eye_near_lid': lid(990, 550, 84, 84, 0.06), 'eye_far_lid': lid(592, 457, 42, 44, 0.06),
    'eye_near_brow': [(880, 450), (940, 430), (1000, 424), (1060, 432), (1100, 452)],
    'eye_far_brow': [(552, 402), (572, 392), (592, 388), (612, 390), (630, 398)]})

CLOSED_MOUTH = ['K1', 'K2', 'K3', 'K4', 'K8']
OPEN_MOUTH_FRAMES = ['K5', 'K6', 'K7']

HIND = ['hind_leg', 'hind_leg_line', 'hind_knee']
HIND_PIVOT = (1611.0, 1085.5)     # the frog's rfeet anchor in K0 pixels

FRAMES['K8'] = dict(
    register=[CROWN],
    tps=dict(nose=(515, 665), lip=(500, 780), n1=(525, 670), n2=(690, 700), mmid=(700, 845), mback=(840, 790),
             fang=(688, 858), chin=(630, 930), throat=(850, 960), feye=(595, 512), eye=(995, 580)),
    snap=[s for s in SNAP_IDS if s not in HIND],
    shapes={'nostril_1': E(530, 675, 15, 25, -12, k=6), 'mouth_line': [(500, 780), (560, 812), (600, 830), (650, 842), (700, 845), (750, 836), (780, 825), (840, 790)],
            'teeth_upper_1': [(670, 828), (705, 828), (688, 858)], 'teeth_upper_2': [(512, 800), (530, 805), (522, 838)],
            **eye_set('eye_near', 995, 580, 105, 60), 'eye_near_lid': lid(995, 580, 105, 60, 0.45),
            **eye_set('eye_far', 595, 512, 45, 35), 'eye_far_lid': lid(595, 512, 45, 35, 0.4),
            'eye_near_brow': [(880, 535), (930, 512), (990, 506), (1050, 518), (1095, 545)],
            'eye_far_brow': [(548, 470), (575, 468), (600, 474), (625, 482), (645, 492)],
            'blush': E(1010, 680, 70, 28, k=6)})

import mouth as _m


def _k8_post(P, P0):
    _m.place(P['jaw'], {13: (847, 809), 14: (845, 825), 15: (837, 844), 16: (819, 869), 17: (787, 895), 18: (750, 917), 19: (700, 929),
                         20: (650, 929), 21: (590, 920), 22: (535, 890), 23: (500, 845)})


def _k8_hind(P, P0):
    # raised leg at the cheek: thigh mass + shin column + foot with toes on top (measured on the K8 frame)
    _m.place(P['hind_leg'], {1: (1545, 1060), 2: (1320, 888), 3: (1322, 800), 4: (1238, 746), 5: (1152, 778), 6: (1158, 1100), 7: (1583, 1132)})
    nd = _m.Nodes(P['hind_leg'])
    nd.pos[0] = (1545, 1060)
    nd.out[1] = nd.pos[1] + (120, -5); nd.inn[0] = nd.pos[0] + (-6, -115)
    nd.put()
    _m.place(P['hind_leg_line'], {1: (1312, 842), 2: (1305, 930), 3: (1303, 1030), 4: (1320, 1108), 5: (1380, 1148)})
    _m.similarity(P['hind_knee'], [(1491, 1210), (1519, 1088)], [(1223, 1068), (1223, 955)])
    for _, ps in P['hind_knee'].cmds:
        for pt in ps:
            pt[0] = 1223 + (pt[0] - 1223) * 0.45


FRAMES['K8']['post'] = [_k8_post, _k8_hind]

# --- belly / front leg of the leaning poses (K4 inhale, K8 embarrassed): measured on the storyboard frames
LEG = ['leg_front_near', 'leg_front_near_line']
TOES = ['toe_near_1', 'toe_near_2', 'toe_near_3']
BELLY_K4 = [(480, 885), (600, 865), (720, 865), (810, 900), (880, 1020), (930, 1150), (935, 1270), (870, 1340), (750, 1368),
            (620, 1355), (505, 1300), (445, 1180), (440, 1020)]
STRIPES_K4 = {'belly_stripe_1': [(510, 888), (600, 878), (700, 878), (790, 896)],
              'belly_stripe_2': [(478, 962), (580, 998), (700, 1006), (815, 983)],
              'belly_stripe_3': [(450, 1075), (550, 1120), (690, 1145), (875, 1095)],
              'belly_stripe_4': [(500, 1245), (590, 1270), (690, 1282), (900, 1205)]}


def _rect8(x0, y0, x1, y1):
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    return [(x0, y0), (xm, y0 - 3), (x1, y0), (x1 + 3, ym), (x1, y1), (xm, y1 + 3), (x0, y1), (x0 - 3, ym)]


FRAMES['K4']['translate'] = [(LEG, 258, 18), (TOES, 280, 15)]
FRAMES['K4']['place'] = {'belly': BELLY_K4, 'belly_under': _rect8(1165, 1222, 1237, 1322)}
FRAMES['K4']['shapes'].update(STRIPES_K4)
FRAMES['K4']['place']['cheek_puff_far'] = [(352, 735), (366, 655), (405, 603), (462, 640), (440, 725), (430, 805), (395, 862), (360, 815)]
FRAMES['K8']['translate'] = [(LEG, 258, 18), (TOES, 280, 15)]
FRAMES['K8']['place'] = {'belly': [(x, y if i in (0, 1, 2, 12) else y + 15) for i, (x, y) in enumerate(BELLY_K4)],
                         'belly_under': _rect8(1170, 1232, 1255, 1312)}
FRAMES['K8']['shapes'].update({k: [(x, y + (0 if k == 'belly_stripe_1' else 12)) for x, y in v] for k, v in STRIPES_K4.items()})

def _enclose(cx, cy, rx, ry, rot=0, m=16):
    """post step: route the head contour (A3-A5) around the far eye so the eye sits inside the head silhouette"""
    import numpy as np

    def fn(P, P0):
        c, s = np.cos(np.radians(rot)), np.sin(np.radians(rot))
        pts = {}
        for idx, ang in ((3, 160), (4, 235), (5, 290)):
            a = np.radians(ang)
            x, y = (rx + m) * np.cos(a), (ry + m) * np.sin(a)
            pts[idx] = (cx + c * x - s * y, cy + s * x + c * y)
        _m.place(P['head'], pts)
    return fn


for _k, _eye in {'K2': (532, 540, 30, 55, 10), 'K3': (545, 525, 48, 70, 8), 'K4': (548, 528, 42, 28, 28),
                 'K5': (590, 462, 34, 40), 'K6': (578, 468, 26, 14, -10), 'K7': (592, 457, 42, 44), 'K8': (595, 512, 45, 35)}.items():
    FRAMES[_k].setdefault('post', []).append(_enclose(*_eye))

def _jaw_back(P, P0):
    """jaw corner -> chin underside (A13-A17) with K0's rounded profile scaled to this pose (no boxy chin)"""
    import numpy as np
    k0 = np.array([a for a, _ in _m.Nodes(P0['jaw']).path.anchors()])
    cor = _m.Nodes(P['mouth_line']).pos[-1]
    a18 = _m.Nodes(P['jaw']).pos[17]
    sx = (cor[0] - a18[0]) / (k0[11][0] - k0[17][0]); sy = (a18[1] - cor[1]) / (k0[17][1] - k0[11][1])
    pts = {13 + i: (cor[0] + (k0[12 + i][0] - k0[11][0]) * sx, cor[1] + (k0[12 + i][1] - k0[11][1]) * sy) for i in range(5)}
    _m.place(P['jaw'], pts)


for _k in ('K3', 'K4'):
    FRAMES[_k].setdefault('post', []).append(_jaw_back)

# the wing and the hind leg are driven by the rig (rotation), so frames keep their K0 geometry
for _k, _f in FRAMES.items():
    _f['snap'] = [i for i in _f.get('snap', SNAP_IDS) if i not in ('wing_lobe', 'wing_main') and i not in HIND]
