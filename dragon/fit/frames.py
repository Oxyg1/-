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
               shapes={**eye_set('eye_far', 532, 540, 30, 55, 10), 'eye_far_lid': lid(532, 540, 30, 55, 0.42),
                       'eye_near_lid': lid(1092, 605, 118, 118, 0.42)}),
    'K3': dict(tps=dict(nose=(440, 650), lip=(430, 770), n1=(468, 672), n2=(622, 688), mmid=(700, 805),
                        mback=(935, 748), fang=(790, 862), chin=(570, 935), throat=(800, 950), feye=(545, 525)),
               shapes={**eye_set('eye_far', 545, 525, 48, 70, 8), **eye_set('eye_near', 1088, 612, 125, 125)}),
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
    shapes={'mouth_line': [(440, 772), (500, 788), (560, 790), (650, 776), (720, 785), (770, 800), (805, 815)],
            'cheek_puff': E(1055, 835, 245, 205), 'cheek_puff_far': E(390, 725, 70, 165),
            **eye_closed('eye_near', 1025, 540, 105, 8), **eye_closed('eye_far', 560, 520, 45, 15),
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
    'eye_near_brow': [(880, 450), (940, 430), (1000, 424), (1060, 432), (1100, 452)],
    'eye_far_brow': [(552, 402), (572, 392), (592, 388), (612, 390), (630, 398)]})

HIND = ['hind_leg', 'hind_leg_line', 'hind_knee']
HIND_PIVOT = (1611.0, 1085.5)     # the frog's rfeet anchor in K0 pixels

FRAMES['K8'] = dict(
    register=[CROWN], rotate=[(HIND, 55.0, HIND_PIVOT)],
    tps=dict(nose=(515, 665), lip=(500, 780), n1=(525, 670), n2=(690, 700), mmid=(700, 845), mback=(840, 790),
             fang=(688, 858), chin=(630, 930), throat=(850, 960), feye=(595, 512), eye=(995, 580)),
    snap=[s for s in SNAP_IDS if s not in HIND],
    shapes={'mouth_line': [(500, 780), (560, 812), (600, 830), (650, 842), (700, 845), (750, 836), (780, 825), (840, 790)],
            'teeth_upper_1': [(670, 828), (705, 828), (688, 858)], 'teeth_upper_2': [(512, 800), (530, 805), (522, 838)],
            **eye_set('eye_near', 995, 580, 105, 60), 'eye_near_lid': lid(995, 580, 105, 60, 0.45),
            **eye_set('eye_far', 595, 512, 45, 35), 'eye_far_lid': lid(595, 512, 45, 35, 0.4),
            'eye_near_brow': [(880, 535), (930, 512), (990, 506), (1050, 518), (1095, 545)],
            'eye_far_brow': [(548, 470), (575, 468), (600, 474), (625, 482), (645, 492)],
            'blush': E(1010, 680, 70, 28, k=6)})

# the wing and the hind leg are driven by the rig (rotation), so frames keep their K0 geometry
for _k, _f in FRAMES.items():
    _f['snap'] = [i for i in _f.get('snap', SNAP_IDS) if i not in ('wing_lobe', 'wing_main') and i not in HIND]
