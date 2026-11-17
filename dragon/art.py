"""Kissed dragon artwork + rig (see SPEC.md).

build_layers(A, fx_front=(), fx_head=()) -> full rigged layer list (top first)
static_comp()                            -> dragon at rest, pose P, 512 comp
MOUTH_ORIGIN_F, PAW_TIP                  -> concept coords

Conventions for the A dict (all values in concept coords / percent / degrees):
  master.p / head.p      absolute positions (rest (360,490) / (330,290))
  master.s / body.s      [sx, sy] percent (rest 100)
  head.r wing.r tail.r arm.r hand.r   degrees
  lid.near lid.far mouth.open arm.outline   0..1 ;  pupil.s percent
  turn                   [(frame, w, ease), ...]  w 0 = profile P, 1 = three-quarter F
A track may be a plain value (static) or a motion.track() property.
"""
import copy
import math
import sys

sys.path.insert(0, "/home/user/obeskay/lottie-animator-skill/skills/lottie-animator/scripts")
from motion import *  # noqa: F401,F403,E402
from motion import track, null, layer, group, ellipse, path, fill, stroke, trim, comp, rgba  # noqa: E402

# ---------------------------------------------------------------- palette
OL = "#4A1622"
BODY_A, BODY_B = "#EC685E", "#B8403F"
SNOUT_HI = "#F27F72"
SPOT = "#C1453F"
BELLY, BELLY_D = "#FBC982", "#D18E45"
HORN, HORN_OL = "#FBDE9C", "#5A2A12"
SPIKE = "#8E347F"
WING_R, WING_M, WING_B = "#B9454A", "#F4BF7B", "#5E1420"
EYE_OUT, EYE_RING, EYE_IRIS, EYE_PUPIL = "#301015", "#E6E1DC", "#2A1A30", "#1E1224"
KISS, KISS_L = "#CA3634", "#A92A2C"
TOE = "#E38E95"
MOUTH_IN, TONGUE = "#4A0E14", "#E0606A"

MOUTH_ORIGIN_F = (188, 272)
PAW_TIP = (226, 488)

OP = 180
EYE_N = {"P": (378, 212), "F": (360, 206)}
EYE_F = {"P": (230, 198), "F": (250, 198)}


# ---------------------------------------------------------------- helpers
def smooth(pts, closed=True):
    """Points (x, y[, 'c' = corner]) -> smooth cubic bezier dict."""
    n = len(pts)
    P = [(p[0], p[1]) for p in pts]
    C = [len(p) > 2 and p[2] == "c" for p in pts]
    V, I, O = [], [], []
    for k in range(n):
        p = P[k]
        hp = closed or k > 0
        hn = closed or k < n - 1
        pr = P[(k - 1) % n]
        nx = P[(k + 1) % n]
        if C[k] or not (hp and hn):
            i = ((pr[0] - p[0]) / 3, (pr[1] - p[1]) / 3) if hp else (0, 0)
            o = ((nx[0] - p[0]) / 3, (nx[1] - p[1]) / 3) if hn else (0, 0)
        else:
            dx, dy = nx[0] - pr[0], nx[1] - pr[1]
            L = math.hypot(dx, dy) or 1
            dx, dy = dx / L, dy / L
            lp = math.hypot(p[0] - pr[0], p[1] - pr[1])
            ln = math.hypot(nx[0] - p[0], nx[1] - p[1])
            i = (-dx * lp / 3, -dy * lp / 3)
            o = (dx * ln / 3, dy * ln / 3)
        V.append([round(p[0], 1), round(p[1], 1)])
        I.append([round(i[0], 1), round(i[1], 1)])
        O.append([round(o[0], 1), round(o[1], 1)])
    return {"c": closed, "v": V, "i": I, "o": O}


def lerp(a, b, w):
    if isinstance(a, (int, float)):
        return a + (b - a) * w
    return [lerp(x, y, w) for x, y in zip(a, b)]


def lerp_pts(PA, FA, w):
    out = []
    for a, b in zip(PA, FA):
        q = (a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w)
        out.append(q + tuple(a[2:]))
    return out


def shape_len(sh, upto=None):
    v, i, o = sh["v"], sh["i"], sh["o"]
    n = len(v)
    upto = n if upto is None else upto
    tot = 0.0
    for k in range(upto):
        a, b = v[k], v[(k + 1) % n]
        c1 = (a[0] + o[k][0], a[1] + o[k][1])
        c2 = (b[0] + i[(k + 1) % n][0], b[1] + i[(k + 1) % n][1])
        prev = a
        for s in range(1, 21):
            t = s / 20
            m = 1 - t
            x = m**3 * a[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t**3 * b[0]
            y = m**3 * a[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t**3 * b[1]
            tot += math.hypot(x - prev[0], y - prev[1])
            prev = (x, y)
    return tot


def gfill(s, e, c1, c2, nm="Grad"):
    a, b = rgba(c1), rgba(c2)
    return {"ty": "gf", "nm": nm, "o": {"a": 0, "k": 100}, "r": 1, "bm": 0, "t": 1,
            "s": {"a": 0, "k": list(s)}, "e": {"a": 0, "k": list(e)},
            "g": {"p": 2, "k": {"a": 0, "k": [0, a[0], a[1], a[2], 1, b[0], b[1], b[2]]}}}


def body_grad(off=(0, 0)):
    return gfill((230 - off[0], 180 - off[1]), (580 - off[0], 500 - off[1]), BODY_A, BODY_B, "BodyGrad")


def P_(sh):
    return path(sh)


def G(nm, *items, **kw):
    return group(nm, *items, **kw)


def solid(nm, sh, color):
    return G(nm, P_(sh), fill(color))


def inked(nm, sh, color, w=12, o=100):
    """stroke on top of fill (own outline)."""
    return G(nm, P_(sh), stroke(OL if w and color != "none" else OL, w), fill(color))


def line(nm, sh, color, w=9, cap="round"):
    return G(nm, P_(sh), stroke(color, w, cap=cap))


def outline_pass(nm, sh):
    return G(nm, P_(sh), stroke(OL, 24), fill(OL))


# ---- property helpers ----------------------------------------------------
def _as_prop(v):
    if isinstance(v, dict) and "a" in v and "k" in v:
        return copy.deepcopy(v)
    return {"a": 0, "k": list(v) if isinstance(v, (tuple, list)) else v}


def getA(A, key, rest):
    if key in A and A[key] is not None:
        return _as_prop(A[key])
    return {"a": 0, "k": list(rest) if isinstance(rest, (tuple, list)) else rest}


def _l(v):
    return list(v) if isinstance(v, (list, tuple)) else [v]


def mapp(prop, fn, dim=None):
    """Map keyframe values through fn(scalar-or-list) keeping times and easing."""
    def f(v):
        x = v[0] if (isinstance(v, list) and len(v) == 1) else v
        return fn(x)
    if prop.get("a"):
        ks = []
        for kf in prop["k"]:
            k = dict(kf)
            k["s"] = _l(f(kf["s"]))
            if "e" in k:
                k.pop("e")
            ks.append(k)
        return {"a": 1, "k": ks}
    return {"a": 0, "k": f(prop["k"])}


def to2(prop):
    """scalar-valued percent track -> [v, v] track."""
    def f(x):
        return [x, x] if not isinstance(x, list) else x
    return mapp(prop, f)


def _ease(h, u):
    x1, y1, x2, y2 = h["o"]["x"][0], h["o"]["y"][0], h["i"]["x"][0], h["i"]["y"][0]
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        x = 3 * (1 - m) ** 2 * m * x1 + 3 * (1 - m) * m * m * x2 + m**3
        if x < u:
            lo = m
        else:
            hi = m
    m = (lo + hi) / 2
    return 3 * (1 - m) ** 2 * m * y1 + 3 * (1 - m) * m * m * y2 + m**3


def ev(prop, f):
    """Evaluate a scalar property at frame f."""
    if not prop.get("a"):
        k = prop["k"]
        return k[0] if isinstance(k, list) else k
    ks = prop["k"]
    if f <= ks[0]["t"]:
        return ks[0]["s"][0]
    for a, b in zip(ks, ks[1:]):
        if f < b["t"]:
            if a.get("h"):
                return a["s"][0]
            u = (f - a["t"]) / (b["t"] - a["t"])
            if "o" in a:
                u = _ease(a, u)
            return a["s"][0] + (b["s"][0] - a["s"][0]) * u
    return ks[-1]["s"][0]


def key_times(prop):
    return [k["t"] for k in prop["k"]] if prop.get("a") else []


# ---- turn schedule -------------------------------------------------------
class Turn:
    def __init__(self, sched):
        s = sorted([(int(f), float(w), e or "out") for f, w, e in (sched or [])]) or [(0, 0.0, "out")]
        self.s = s
        self.const = all(abs(w - s[0][1]) < 1e-9 for _, w, _ in s)

    def shifted(self, d):
        t = Turn(None)
        t.s = [(min(f + d, OP), w, e) for f, w, e in self.s]
        t.const = self.const
        return t

    def pose(self, fn):
        """fn(w) -> value (scalar/list/shape).  Returns a property."""
        if self.const:
            return {"a": 0, "k": fn(self.s[0][1])} if not isinstance(fn(0), dict) else \
                {"a": 0, "k": fn(self.s[0][1])}
        fr = list(self.s)
        vals = [fn(w) for _, w, _ in fr]
        keep = []
        for i in range(len(fr)):
            if 0 < i < len(fr) - 1 and vals[i] == vals[i - 1] == vals[i + 1]:
                continue
            keep.append(i)
        args = [(fr[i][0], vals[i], fr[i][2]) for i in keep]
        if len(args) < 2:
            return {"a": 0, "k": vals[0]}
        return track(*args)

    def w_prop(self):
        if self.const:
            return {"a": 0, "k": self.s[0][1]}
        return track(*[(f, w, e) for f, w, e in self.s])

    def w_at(self, f):
        return ev(self.w_prop(), f)


def static_shape(sh):
    return {"a": 0, "k": sh}


# ---------------------------------------------------------------- geometry data
HEAD_P = [
    (156, 226), (158, 206), (172, 189), (198, 176), (226, 160), (250, 150), (272, 152),
    (282, 175), (300, 176), (335, 160), (375, 150), (415, 148), (445, 158), (468, 188),
    (480, 222), (470, 262), (440, 300), (380, 322), (300, 330), (220, 318), (180, 298),
    (160, 272), (152, 247),
]
HEAD_F = [
    (181, 238), (179, 214), (190, 194), (210, 178), (234, 162), (256, 150), (274, 150),
    (284, 174), (302, 174), (336, 158), (376, 148), (416, 146), (446, 156), (469, 187),
    (482, 222), (472, 264), (442, 302), (382, 324), (302, 332), (222, 322), (186, 304),
    (170, 284), (172, 258),
]
MOUTH_P = [(158, 241), (182, 236), (208, 242), (236, 254), (262, 262), (284, 252),
           (300, 243), (318, 256), (336, 266)]
MOUTH_F = [(182, 267), (206, 262), (231, 267), (258, 277), (283, 283), (303, 279),
           (320, 272), (338, 276), (352, 279)]
DROP = [8, 20, 30, 34, 32, 26, 18, 10, 5]

HORN_L = [(227, 154), (225, 128), (228, 110, "c"), (246, 122), (251, 96), (257, 72), (264, 52, "c"),
          (277, 80), (283, 112), (283, 136), (280, 154)]
HORN_R = [(375, 154), (373, 126), (377, 108, "c"), (397, 126), (414, 104), (428, 76), (437, 50, "c"),
          (448, 82), (446, 116), (440, 140), (430, 154)]

BODY = [
    (176, 298), (160, 322), (153, 362), (156, 406), (166, 444), (192, 468), (240, 476),
    (300, 478), (360, 480), (420, 480), (490, 474), (545, 448), (574, 402), (582, 350),
    (572, 306), (542, 276), (505, 250), (478, 228), (440, 266), (380, 296), (300, 308), (225, 304),
]

ARM = [(247, 372), (245, 412), (243, 450), (260, 462), (277, 452), (290, 416), (294, 378),
       (288, 350), (270, 340), (251, 352)]
ARM_LEFT_N = 3   # vertices 0..2 = left edge line


# ---------------------------------------------------------------- pieces
def head_shape(w):
    return smooth(lerp_pts(HEAD_P, HEAD_F, w))


def mouth_line(w):
    return smooth(lerp_pts(MOUTH_P, MOUTH_F, w), closed=False)


def cavity(w, o):
    M = lerp_pts(MOUTH_P, MOUTH_F, w)
    up = [(x, y, "c") if k in (0, 8) else (x, y) for k, (x, y) in enumerate(M)]
    low = [(M[k][0], M[k][1] + DROP[k] * o) for k in range(7, 0, -1)]
    cav = smooth(up + low)
    tg = [(M[k][0], M[k][1] + DROP[k] * o) for k in range(2, 7)]
    tu = [(M[k][0], M[k][1] + DROP[k] * o - (6 + 0.18 * DROP[k]) * o) for k in range(6, 1, -1)]
    tong = smooth(tg + tu)
    return cav, tong


def circle_shape(r, n=1):
    return None


def eye_layers(tag, parent, lidprop, pupilprop, grad_off):
    nm = parent
    # eye body (origin = eye centre, outer radius 48)
    ring = G("Ring " + tag, {"ty": "el", "nm": "e", "d": 1, "p": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [68, 68]}},
             stroke(EYE_RING, 8))
    hl1 = G("Hl " + tag, ellipse(13, p=(-12, -13)), fill("#FFFFFF"))
    hl2 = G("Hl2 " + tag, ellipse(7, p=(11, 12)), fill("#FFFFFF", o=70))
    pupil = G("Pupil " + tag, ellipse(54), fill(EYE_PUPIL), s=pupilprop)
    iris = G("Iris " + tag, ellipse(62), fill(EYE_IRIS))
    disc = G("Disc " + tag, ellipse(96), fill(EYE_OUT))
    eye = layer("Eye " + tag, hl1, hl2, pupil, ring, iris, disc, parent=nm)

    matte = layer("Matte " + tag, G("m", ellipse(95), fill("#FFFFFF")), parent=nm, td=1)

    def lidgrad():
        return body_grad(grad_off)

    up_fill = smooth([(-70, -130, "c"), (70, -130, "c"), (70, 0, "c"), (0, 7), (-70, 0, "c")])
    up_line = smooth([(-70, 0), (0, 7), (70, 0)], closed=False)
    lo_fill = smooth([(-70, 0, "c"), (0, 7), (70, 0, "c"), (70, 130, "c"), (-70, 130, "c")])
    yu = mapp(lidprop, lambda l: [0, -60 + 60 * l])
    yl = mapp(lidprop, lambda l: [0, 60 - 60 * l])
    lid = layer("Lid " + tag,
                G("UpLine", P_(up_line), stroke(OL, 8), p=copy.deepcopy(yu)),
                G("UpFill", P_(up_fill), lidgrad(), p=copy.deepcopy(yu)),
                G("LoFill", P_(lo_fill), lidgrad(), p=copy.deepcopy(yl)),
                parent=nm, tt=1)
    return [matte, lid, eye]


# ---------------------------------------------------------------- wing
def wing_layers():
    sil = smooth([
        (452, 170), (462, 127), (500, 108), (548, 97), (573, 94, "c"), (552, 114), (528, 130, "c"),
        (548, 133), (595, 138), (634, 156), (668, 180, "c"), (652, 191), (632, 207), (618, 228, "c"),
        (588, 225), (568, 238), (557, 244, "c"), (535, 236), (508, 236), (484, 243, "c"), (466, 232),
        (456, 200),
    ])
    lobe = smooth([(452, 170), (462, 127), (500, 108), (548, 97), (573, 94, "c"), (552, 114),
                   (528, 130, "c"), (512, 150), (500, 180), (470, 200)])
    bones = [
        smooth([(520, 168), (500, 205), (486, 238)], closed=False),
        smooth([(534, 160), (547, 200), (557, 238)], closed=False),
        smooth([(543, 166), (582, 196), (617, 226)], closed=False),
        smooth([(548, 148), (600, 152), (640, 163), (662, 178)], closed=False),
    ]
    mem1 = smooth([(524, 172, "c"), (506, 216), (488, 240, "c"), (516, 233), (545, 241, "c"), (536, 205)])
    mem2 = smooth([(541, 168, "c"), (560, 243, "c"), (585, 228), (616, 228, "c"), (580, 198)])
    mem3 = smooth([(550, 152, "c"), (610, 154), (662, 178, "c"), (642, 197), (617, 227, "c"), (585, 197)])
    return [
        G("Bones", *[P_(b) for b in bones], stroke(WING_B, 10)),
        G("Mem1", P_(mem1), fill(WING_M)),
        G("Mem2", P_(mem2), fill(WING_M)),
        G("Mem3", P_(mem3), fill(WING_M)),
        G("Lobe", P_(lobe), fill("#A8424E")),
        G("Leather", P_(sil), stroke(WING_B, 12), fill("#D9595C")),
    ]


# ---------------------------------------------------------------- build
def build_layers(A, fx_front=(), fx_head=()):
    A = A or {}
    T = Turn(A.get("turn"))
    Tl = T.shifted(2)

    master_p = getA(A, "master.p", (360, 490))
    master_s = to2(getA(A, "master.s", (100, 100))) if not isinstance(A.get("master.s"), (list, tuple)) \
        else getA(A, "master.s", (100, 100))
    body_s = to2(getA(A, "body.s", (100, 100))) if not isinstance(A.get("body.s"), (list, tuple)) \
        else getA(A, "body.s", (100, 100))
    head_p = getA(A, "head.p", (330, 290))
    head_r = getA(A, "head.r", 0)
    wing_r = getA(A, "wing.r", 0)
    tail_r = getA(A, "tail.r", 0)
    arm_r = getA(A, "arm.r", 0)
    hand_r = getA(A, "hand.r", 0)
    lid_n = getA(A, "lid.near", 0)
    lid_f = getA(A, "lid.far", 0)
    pupil_s = to2(getA(A, "pupil.s", 100)) if not isinstance(A.get("pupil.s"), (list, tuple)) \
        else getA(A, "pupil.s", (100, 100))
    mopen = getA(A, "mouth.open", 0)
    arm_out = getA(A, "arm.outline", 0)

    # ------------------------------------------------ L0 (behind)
    wing = layer("Wing", *wing_layers(), parent="wing")
    far_foot_path = smooth([(176, 420), (146, 424), (122, 436), (108, 452, "c"), (132, 462),
                            (160, 460), (178, 450)])
    toes_f = [G("t%d" % i, ellipse(9, p=p), fill(TOE)) for i, p in enumerate([(113, 453), (122, 459), (133, 460)])]
    far_foot = layer("Far Foot", *toes_f, inked("ff", far_foot_path, "#C94E48", 12), parent="body")
    back_spike = layer("Back Spike", inked("bs", smooth([(568, 318, "c"), (608, 326, "c"), (590, 356, "c")]), SPIKE, 9),
                       parent="body")
    spk = [
        [(282, 182, "c"), (303, 104, "c"), (336, 170, "c")],
        [(332, 168, "c"), (357, 98, "c"), (400, 154, "c")],
        [(436, 196, "c"), (466, 134, "c"), (490, 200, "c")],
    ]
    spikes = layer("Head Spikes", *[inked("s%d" % i, smooth(s), SPIKE, 6) for i, s in enumerate(spk)], parent="head")
    horn_pL = Tl.pose(lambda w: [12 * w, 0])
    horn_pR = Tl.pose(lambda w: [-10 * w, 0])
    horn_l = layer("Horn L", inked("h", smooth(HORN_L), HORN, 10).copy() if False else
                   G("h", P_(smooth(HORN_L)), stroke(HORN_OL, 10), fill(HORN)), parent="head", p=horn_pL)
    horn_r = layer("Horn R", G("h", P_(smooth(HORN_R)), stroke(HORN_OL, 10), fill(HORN)), parent="head", p=horn_pR)

    # ------------------------------------------------ L1 outline + fills
    head_trk = T.pose(head_shape)
    body_sh = smooth(BODY)
    body_ol = layer("Body Outline", outline_pass("o", body_sh), parent="body")
    head_ol = layer("Head Outline", G("o", {"ty": "sh", "nm": "p", "ks": head_trk}, stroke(OL, 24), fill(OL)),
                    parent="head")
    body_fill = layer("Body Fill", G("f", P_(body_sh), body_grad()), parent="body")
    head_fill = layer("Head Fill", G("f", {"ty": "sh", "nm": "p", "ks": copy.deepcopy(head_trk)}, body_grad()),
                      parent="head")

    # body details
    belly_sh = smooth([(205, 297), (232, 306), (247, 345), (247, 390), (232, 432), (205, 452),
                       (178, 432), (164, 390), (164, 345), (178, 306)])
    stripes = [
        smooth([(166, 322), (205, 334), (246, 322)], closed=False),
        smooth([(164, 362), (205, 376), (247, 362)], closed=False),
        smooth([(168, 404), (205, 420), (246, 408)], closed=False),
    ]
    belly = layer("Belly",
                  *[line("st%d" % i, s, BELLY_D, 7) for i, s in enumerate(stripes)],
                  G("bl", P_(belly_sh), stroke(BELLY_D, 6), fill(BELLY)), parent="body")
    wedge_sh = smooth([(318, 442, "c"), (354, 446), (374, 472, "c"), (308, 474, "c")])
    wedge = layer("Wedge", G("w", P_(wedge_sh), fill(BELLY), stroke(BELLY_D, 5)), parent="body")
    legline = layer("Leg Line", line("l", smooth([(318, 400), (316, 436), (308, 470)], closed=False), OL, 11),
                    parent="body")
    haunch_d = smooth([(486, 355), (452, 374), (420, 410), (394, 452), (384, 462)], closed=False)
    haunch_l = smooth([(474, 386), (446, 410), (420, 440), (410, 452)], closed=False)
    haunch = layer("Haunch", line("hl", haunch_l, "#F9B6A6", 8), line("hd", haunch_d, OL, 11), parent="body")
    spots_xy = [(485, 268, 9), (507, 276, 8), (495, 306, 8), (471, 332, 8), (521, 331, 8),
                (506, 352, 8), (472, 386, 8), (541, 300, 8)]
    spots = layer("Spots", *[G("s%d" % i, ellipse(2 * r, p=(x, y)), fill(SPOT, o=75))
                             for i, (x, y, r) in enumerate(spots_xy)],
                  G("heart", P_(smooth([(360, 392), (350, 384), (352, 377), (360, 380), (368, 377), (370, 384)])),
                    fill(SPOT, o=80)), parent="body")

    # ------------------------------------------------ head details
    # kiss
    up = smooth([(348, 300, "c"), (360, 284), (384, 272), (404, 276), (414, 282), (434, 272), (456, 280),
                 (463, 294, "c"), (440, 300), (414, 298), (388, 305), (366, 306)])
    lo = smooth([(356, 314, "c"), (384, 311), (414, 308), (446, 308), (460, 306, "c"),
                 (452, 328), (428, 346), (396, 348), (370, 336)])
    tex = [smooth([(372, 286), (392, 282)], closed=False), smooth([(432, 284), (450, 288)], closed=False),
           smooth([(380, 330), (402, 338)], closed=False), smooth([(416, 336), (436, 330)], closed=False)]
    kiss = layer("Kiss", *[line("tx%d" % i, t, KISS_L, 4) for i, t in enumerate(tex)],
                 G("lo", P_(lo), fill(KISS)), G("up", P_(up), fill(KISS)),
                 parent="head", p=Tl.pose(lambda w: [-8 * w, 0]))
    hi = layer("Snout Hi", G("h", ellipse((64, 24), p=(0, 0)), fill(SNOUT_HI), r=-18),
               parent="head", p=T.pose(lambda w: lerp([206, 194], [210, 204], w)))
    nostr = layer("Nostrils",
                  G("n1", ellipse((15, 11)), fill(OL), p=T.pose(lambda w: lerp([186, 196], [196, 214], w))),
                  G("n2", ellipse((15, 10)), fill(OL), p=T.pose(lambda w: lerp([240, 201], [224, 208], w))),
                  parent="head")
    ml_trk = T.pose(mouth_line)
    mline = layer("Mouth Line", G("ml", {"ty": "sh", "nm": "p", "ks": ml_trk}, stroke(OL, 12)), parent="head")
    fang = layer("Fang",
                 G("fg", ellipse(6, p=(3, 2)), fill("#FFFFFF")),
                 G("f", P_(smooth([(-11, -8, "c"), (10, -10, "c"), (1, 24, "c")])), stroke(OL, 5), fill(OL)),
                 parent="head", p=T.pose(lambda w: lerp([330, 267], [329, 274], w)))

    # mouth cavity (baked from turn x mouth.open)
    cav_layers = []
    if mopen.get("a"):
        kt = set(key_times(mopen))
        for a, b in zip(mopen["k"], mopen["k"][1:]):
            if a["s"][0] != b["s"][0]:
                t = a["t"] + 3
                while t < b["t"]:
                    kt.add(t)
                    t += 3
        for f, w, _ in T.s:
            if ev(mopen, f) > 0.01:
                kt.add(f)
        kt = sorted(kt)
        cavs, tongs = [], []
        for t in kt:
            c, tg = cavity(T.w_at(t), max(0.0, ev(mopen, t)))
            cavs.append((t, c, "linear"))
            tongs.append((t, tg, "linear"))
        cav_layers = [layer("Mouth Open",
                            G("tongue", {"ty": "sh", "nm": "p", "ks": track(*tongs)}, fill(TONGUE)),
                            G("cav", {"ty": "sh", "nm": "p", "ks": track(*cavs)}, fill(MOUTH_IN)),
                            parent="head")]

    # eyes
    eye_pn = T.pose(lambda w: lerp(list(EYE_N["P"]), list(EYE_N["F"]), w))
    eye_sn = T.pose(lambda w: lerp([100, 100], [104, 104], w))
    eye_pf = T.pose(lambda w: lerp(list(EYE_F["P"]), list(EYE_F["F"]), w))
    eye_sf = T.pose(lambda w: lerp([0, 79], [84, 79], w))
    nullN = null("eye_near", p=eye_pn, a=(0, 0), s=eye_sn, parent="head")
    nullF = null("eye_far", p=eye_pf, a=(0, 0), s=eye_sf, parent="head")
    eyesN = eye_layers("Near", "eye_near", lid_n, pupil_s, EYE_N["P"])
    eyesF = eye_layers("Far", "eye_far", lid_f, copy.deepcopy(pupil_s), EYE_F["F"])

    # ------------------------------------------------ L2
    tail_sh = smooth([(575, 356), (604, 394), (610, 440), (584, 478), (530, 494), (466, 498), (414, 494),
                      (386, 488, "c"), (390, 466, "c"), (434, 458), (484, 450), (536, 437), (570, 410), (584, 382)])
    tail_sp = [[(456, 462, "c"), (480, 426, "c"), (504, 458, "c")],
               [(508, 450, "c"), (528, 414, "c"), (554, 440, "c")]]
    tail_g = gfill((500, 400), (500, 496), "#E0584F", "#F27A6C", "TailGrad")
    tail = layer("Tail",
                 G("tf", P_(tail_sh), stroke(OL, 12), tail_g),
                 *[inked("ts%d" % i, smooth(s), SPIKE, 8) for i, s in enumerate(tail_sp)],
                 parent="tail")

    arm_sh = smooth(ARM)
    e_rest = shape_len(arm_sh, ARM_LEFT_N - 1) / shape_len(arm_sh) * 100.0
    e_rest = round(e_rest, 1)
    arm_e = mapp(arm_out, lambda o: e_rest + (100 - e_rest) * o)
    arm = layer("Arm",
                G("ao", P_(arm_sh), trim(0, arm_e), stroke(OL, 12)),
                G("af", P_(arm_sh), body_grad()),
                parent="arm")
    paw_fill = smooth([(236, 444), (268, 444), (276, 462), (270, 482), (252, 493), (230, 493),
                       (214, 483), (212, 467), (224, 456)])
    paw_line = smooth([(224, 456), (212, 467), (214, 483), (230, 493), (252, 493), (270, 482), (276, 462)],
                      closed=False)
    toes = [G("pt%d" % i, ellipse(s, p=p), fill(TOE)) for i, (p, s) in
            enumerate([((224, 479), 11), ((234, 487), 11), ((246, 488), 10)])]
    hand = layer("Hand",
                 *toes,
                 G("hl", P_(paw_line), stroke(OL, 12)),
                 G("hf", P_(paw_fill), body_grad()),
                 parent="hand")

    # ------------------------------------------------ nulls
    nulls = [
        null("arm", p=(282, 352), a=(282, 352), r=arm_r, parent="body"),
        null("hand", p=(245, 455), a=(245, 455), r=hand_r, parent="arm"),
        null("tail", p=(565, 395), a=(565, 395), r=tail_r, parent="body"),
        null("wing", p=(468, 212), a=(468, 212), r=wing_r, parent="body"),
        nullF, nullN,
        null("head", p=head_p, a=(330, 290), r=head_r, parent="body"),
        null("body", p=(360, 480), a=(360, 480), s=body_s, parent="master"),
        null("master", p=master_p, a=(360, 490), s=master_s, parent="world"),
        null("world", p=(30, 63), a=(0, 0), s=(70, 70)),
    ]
    # fix head null: anchor must equal rest position
    for n in nulls:
        if n["nm"] == "head":
            n["ks"]["a"] = {"a": 0, "k": [330, 290, 0]}
    stack = (
        list(fx_front)
        + [hand, arm, tail]
        + list(fx_head)
        + eyesN + eyesF
        + [fang, mline] + cav_layers + [nostr, kiss, hi, head_fill]
        + [spots, haunch, legline, wedge, belly, body_fill]
        + [head_ol, body_ol]
        + [horn_l, horn_r, spikes, back_spike, wing, far_foot]
        + nulls
    )
    return stack


def build_doc(A=None, fx_front=(), fx_head=()):
    return comp("Kissed Dragon", 512, 512, build_layers(A or {}, fx_front, fx_head), op=OP, fr=60)


def static_comp():
    return build_doc({})
