"""FX for the kissed-dragon sticker: fire jet, sparks, smoke.  All coords = concept px.

fire_layers(origin, angle_deg=-14, t_on=50, t_full=57, t_off=92, t_end=102)  parent "head"
spark_layers(origin, angle_deg=-14, t_from=52, t_to=90)                      parent "head"
smoke_layers(emitters, paw=None)                                             parent "world"
All layer names start with fx_.  Layers are returned top-first (motion.comp order).
"""
import sys, math, random
sys.path.insert(0, "/home/user/obeskay/lottie-animator-skill/skills/lottie-animator/scripts")
from motion import *

FIRE = ["#FFF6D0", "#FFE27A", "#FFB52E", "#FF7A1A", "#E5392A"]      # top -> bottom
SMOKE_OUT, SMOKE_SHADE, SMOKE_FILL, SMOKE_HI = "#4A3F55", "#8D8598", "#A79FB0", "#D6D0DC"
FIRE_LEN, FIRE_HW, FIRE_MOUTH = 165.0, 84.0, 22.0   # tunable: jet length, half width at far end, half width at mouth
SHOVE_SPEED = 5.0   # paw speed (concept px / frame) above which puffs get shoved
LAST_FRAME = 171          # everything must be at opacity 0 by here


def _r(x, n=1):
    return round(x, n)


def _clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def _out(x, p=3):
    return 1 - (1 - _clamp(x)) ** p


def _inout(x):
    x = _clamp(x)
    return x * x * (3 - 2 * x)


# ----------------------------------------------------------------------------- fire
BANDS = [  # (colour, radius factor, shift toward mouth, circles dropped at the far end)   rim -> core
    (FIRE[4], 1.00, 0, 0), (FIRE[3], 0.80, 7, 0), (FIRE[2], 0.62, 13, 1), (FIRE[1], 0.45, 19, 2), (FIRE[0], 0.29, 24, 3)]
NCH = 8      # circles in the main billow chain


def _local_to_head(origin, rot, lx, ly):
    a = math.radians(rot)
    return (origin[0] + math.cos(a) * lx - math.sin(a) * ly, origin[1] + math.sin(a) * lx + math.cos(a) * ly)


def _teardrop(k=1.9):
    v = [[14, 0], [0, 12], [-34, 0], [0, -12]]
    i = [[0, -8], [8, 0], [8, 8], [-8, 0]]
    o = [[0, 8], [-10, 0], [8, -8], [10, 0]]
    sc = lambda a: [[_r(x * k), _r(y * k)] for x, y in a]
    return {"c": True, "v": sc(v), "i": sc(i), "o": sc(o)}


def _chain(rng):
    """base circles (x, y, r) of the rim billow chain, local jet coords (x along the jet, y up)."""
    out = []
    for i in range(NCH):
        s = i / (NCH - 1)
        x = FIRE_LEN * (0.04 + 0.96 * s ** 0.95)
        r = FIRE_MOUTH * 0.95 + (FIRE_HW - FIRE_MOUTH * 0.95) * s ** 0.62
        r *= 1.0 + (0.14 if i % 2 else -0.08) + rng.uniform(-0.04, 0.04)
        y = 20 * s * s + (7 if i % 2 else -5) * s
        out.append((x, y, r))
    return out


def fire_layers(origin, angle_deg=-14, t_on=50, t_full=57, t_off=92, t_end=102):
    rot = 180 + angle_deg
    base = _chain(random.Random(5))
    layers = []
    for k, (col, rf, shift, drop) in enumerate(BANDS):
        rng = random.Random(90 + k)
        circ = [(x - shift, y * (0.9 - 0.1 * k) + 0, r * rf) for x, y, r in base[:NCH - drop]]
        hold0 = t_full + 3
        grp = []
        for i, (cx, cy, cr) in enumerate(circ):
            d = 0.5 * i + 0.3 * k                                   # grow delay along the jet
            ds = t_off - 1 + 1.4 * i / (NCH - 1) - 0.4 * k   # pinch-off starts at the mouth end
            de = ds + 7
            ph = rng.uniform(0, 6.3)

            def pos(t):
                g = _out((t - t_on - d) / (t_full - t_on), 4)
                q = _inout((t - ds) / (de - ds))
                xe = cx * max(g, 0.02)
                return (xe + (0.8 * FIRE_LEN - xe) * q + 70 * q * q, cy * g * (1 - q) + 28 * q)

            def rad(t):
                g = _out((t - t_on - d) / (t_full - t_on), 3)
                q = _clamp((t - ds) / (de - ds))
                fl = 1 + 0.085 * math.sin(0.5 * t + ph) + 0.04 * math.sin(1.7 * t + 2 * ph) if t > t_full else 1
                return max(cr * g * fl * (1 - q ** 1.6) * (1 - 0.3 * q), 0.0)

            tg = [t_on, t_on + 2, t_on + 4, int(math.ceil(t_full + d))]
            pk = sorted(set(tg + [int(ds), int(de)]))
            pk = [t for t in pk if t <= de]
            ts_r = sorted(set(tg + list(range(hold0 + (i + k) % 3, int(ds), 3)) + [int(ds)] + list(range(int(ds) + 2, int(de), 2)) + [int(de)]))
            pt_ = track(*[(t, [_r(v) for v in pos(t)], "linear") for t in pk])
            sz = track(*[(t, [_r(2 * rad(t))] * 2, "linear") for t in ts_r])
            grp.append(ellipse((10, 10), p=pt_))
            grp[-1]["s"] = sz
        layers.append(layer("fx_fire_%d" % k, group("flame", *grp, fill(col)),
                            p=origin, r=rot, parent="head", ip=t_on - 1, op=t_end))
    # licks / detached chunks: rise, curl and shrink away
    plan = [(60, 0.55, 22, 70, 52), (63, 0.6, 22, 100, -58), (68, 0.62, 24, 150, 18), (74, 0.58, 22, 110, 62),
            (78, 0.6, 24, 140, -50), (84, 0.66, 24, 160, 10), (t_off - 2, 0.8, t_end - t_off + 2, 150, 0)]
    blobs = []
    for bi, (ts, scl, life, tip, ly) in enumerate(plan):
        ts = int(ts)
        a = _local_to_head(origin, rot, tip, ly)
        ang = math.radians(rot)
        up = -58 if ly <= 0 else -42
        end = (a[0] + math.cos(ang) * 22, a[1] + math.sin(ang) * 22 + up)
        mid = (a[0] + math.cos(ang) * 14, a[1] + math.sin(ang) * 14 + up * 0.35)
        pk = track((ts, [_r(a[0]), _r(a[1])], "out"), (ts + 6, [_r(mid[0]), _r(mid[1])], "swing"), (ts + life, [_r(end[0]), _r(end[1])]))
        sc = track((ts, [scl * 45] * 2, "out"), (ts + 5, [scl * 100, scl * 95], "in"), (ts + life, [0, 0]))
        rk = track((ts, rot, "out"), (ts + life, rot + (55 if bi % 2 else -40)))
        op = track((ts, 100, "linear"), (ts + life - 3, 100, "linear"), (ts + life, 0))
        grp = [group("hot", path(_teardrop()), fill(FIRE[1]), s=(42, 42), p=(-2, 0)),
               group("mid", path(_teardrop()), fill(FIRE[2]), s=(62, 62), p=(-1, 0)),
               group("blob", path(_teardrop()), fill(FIRE[3]), s=(82, 82)),
               group("rim", path(_teardrop()), fill(FIRE[4]))]
        blobs.append(layer("fx_fire_blob_%d" % bi, *grp, p=pk, s=sc, r=rk, o=op, parent="head", ip=ts, op=ts + life))
    return blobs + layers[::-1]


# ----------------------------------------------------------------------------- sparks
def spark_layers(origin, angle_deg=-14, t_from=52, t_to=90):
    rng = random.Random(11)
    n = 7
    out = []
    base = math.radians(180 - angle_deg)      # screen direction of the jet (y down)
    for i in range(n):
        t0 = int(round(t_from + (t_to - t_from) * i / (n - 1)))
        life = rng.randint(14, 20)
        up = -1 if i % 3 else 1               # mostly up, a few fall
        ang = base + math.radians(rng.uniform(25, 55)) * up
        sp = rng.uniform(4.5, 7.0)
        vx, vy = math.cos(ang) * sp, math.sin(ang) * sp
        d = rng.uniform(70, 125)
        px = origin[0] + math.cos(base) * d
        py = origin[1] + math.sin(base) * d + up * rng.uniform(18, 34)
        pk, sk, ok = [], [], []
        x, y = px, py
        ts = list(range(0, life, 3)) + [life]
        for a_ in range(life + 1):
            if a_ in ts:
                pk.append((t0 + a_, [_r(x), _r(y)], "linear"))
                u = a_ / life
                sk.append((t0 + a_, [_r(100 * (1.0 - 0.75 * u ** 1.3))] * 2, "linear"))
                ok.append((t0 + a_, int(100 * (1 - _clamp((u - 0.6) / 0.4))), "linear"))
            x += vx; y += vy
            vx *= 0.95; vy = vy * 0.95 - 0.10
        sz = rng.uniform(1.0, 1.3)
        g = [group("ember", ellipse((20, 14)), fill(FIRE[2] if i % 2 else FIRE[3]), s=(sz * 100,) * 2),
             group("hot", ellipse((11, 7)), fill(FIRE[0]), s=(sz * 100,) * 2)]
        out.append(layer("fx_spark_%d" % i, *g, p=track(*pk), s=track(*sk), o=track(*ok), r=math.degrees(ang),
                         parent="head", ip=t0, op=t0 + life + 1))
    return out


# ----------------------------------------------------------------------------- smoke
REF = 22.0
CLUSTERS = [[(0, 0, 22), (-21, 10, 13.5), (19, 9, 14)], [(0, 0, 22), (20, 8, 14), (-17, 12, 12)]]


def _mix(a, b, u):
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(int(round(x + (y - x) * u)) for x, y in zip(ca, cb))


def _puff_groups(cl, wtrack, fillc, hic):
    ell = lambda dx, dy, r: ellipse(r * 2, p=(dx, dy))
    hi = [group("hl", ellipse(19, p=(cl[0][0] - 8, cl[0][1] - 9)), fill(hic)),
          group("hl2", ellipse(8, p=(cl[1][0] - 2, cl[1][1] - 4)), fill(hic))]
    fl = group("fill", *[ell(dx - 1.4, dy - 2.0, r - 2.6) for dx, dy, r in cl], fill(fillc))
    sh = group("shade", *[ell(dx, dy, r) for dx, dy, r in cl], fill(SMOKE_SHADE))
    ol = group("outline", *[ell(dx, dy, r) for dx, dy, r in cl], fill(SMOKE_OUT), stroke(SMOKE_OUT, wtrack))
    return hi + [fl, sh, ol]


def _new_puff(t0, pos, vel, size, life, rng, dark=False, child=False):
    end = min(int(t0 + life), LAST_FRAME)
    return {"t0": int(t0), "x": float(pos[0]), "y": float(pos[1]), "vx": float(vel[0]), "vy": float(vel[1]),
            "size": float(size), "end": end, "shr": min(18, 0.35 * (end - t0)), "dark": dark, "child": child,
            "ph": rng.uniform(0, 6.28), "spin": rng.uniform(-.5, .5), "rot0": rng.uniform(-15, 15),
            "cl": rng.randrange(2), "mir": rng.choice([1, -1]), "rec": [], "fly": None, "done": False}


def _sample(p, f):
    age = f - p["t0"]
    dur = max(p["end"] - p["t0"], 1)
    ps = _clamp((f - (p["end"] - p["shr"])) / max(p["shr"], 1))
    R = p["size"] * (0.4 + 0.6 * _out(age / 14.0, 3)) * (1 + 0.1 * age / dur) * (1 - ps * ps)
    S = max(R / REF * 100, 1.0)
    o = 100 * _clamp((p["end"] - f) / 3.0)
    ph = p["ph"] + age * 0.16
    sx, sy = S * (1 + 0.05 * math.sin(ph)), S * (1 - 0.05 * math.sin(ph))
    if p["fly"]:
        e = _clamp(1 - (f - p["fly"][0]) / 4.0)
        sx *= 1 + 0.32 * e; sy *= 1 - 0.24 * e
    rot = p["rot0"] * (1 - _clamp(f - p["t0"] > 0) * 0) + p["spin"] * age
    return [f, [_r(p["x"]), _r(p["y"])], [_r(sx), _r(sy)], _r(rot), int(round(o))], S


def smoke_layers(emitters, paw=None):
    rng = random.Random(3)
    pending = [_new_puff(e["t0"], e["pos"], e["vel"], e["size"], e["life"], rng, e.get("dark", e["size"] >= 30)) for e in emitters]
    allp = list(pending)
    pending.sort(key=lambda p: p["t0"])
    alive = []
    for f in range(min(p["t0"] for p in pending), LAST_FRAME + 1):
        while pending and pending[0]["t0"] <= f:
            alive.append(pending.pop(0))
        pv = None
        if paw is not None:
            a, b = paw(f), paw(f - 1)
            pv = (a[0] - b[0], a[1] - b[1], a)
        for p in list(alive):
            age = f - p["t0"]
            fl = p["fly"]
            if fl and f - fl[0] <= 10:
                u = _out((f - fl[0]) / 10.0, 2.6)
                p["x"] = fl[1] + fl[3] * u; p["y"] = fl[2] + fl[4] * u
            elif age > 0:
                p["vy"] -= 0.030
                p["vx"] += -0.008 + 0.014 * math.sin(0.09 * age + p["ph"])
                p["vx"] *= 0.963; p["vy"] *= 0.963
                p["x"] += p["vx"]; p["y"] += p["vy"]
            shove = False
            if pv and not fl and age > 2 and math.hypot(pv[0], pv[1]) > SHOVE_SPEED:
                d = math.hypot(p["x"] - pv[2][0], p["y"] - pv[2][1])
                if d < 120:
                    sp = math.hypot(pv[0], pv[1])
                    ax, ay = p["x"] - pv[2][0], p["y"] - pv[2][1]
                    al = math.hypot(ax, ay) or 1.0
                    dx, dy = ax / al * 0.9 + pv[0] / sp * 0.3, ay / al * 0.35 + pv[1] / sp * 0.15 + 0.05
                    dl = math.hypot(dx, dy)
                    dx, dy = dx / dl, dy / dl
                    D = 55 + 45 * (1 - d / 120)
                    p["fly"] = (f, p["x"], p["y"], dx * D, dy * D)
                    p["vx"], p["vy"] = dx * 1.2, dy * 1.2
                    shove = True
                    p["end"] = min(p["end"], f + (17 if not p["child"] else 14))
                    p["shr"] = 9 if not p["child"] else 8
                    if not p["child"]:
                        R = p["size"]
                        n = 3 if R >= 34 else 2
                        ex, ey = p["x"] + p["fly"][3], p["y"] + p["fly"][4]
                        for c in range(n):
                            ang = c / n * 6.28 + p["ph"]
                            ch = _new_puff(f + 8, (ex + math.cos(ang) * R * 0.45, ey + math.sin(ang) * R * 0.45),
                                           (p["vx"] + math.cos(ang) * 0.9, p["vy"] + math.sin(ang) * 0.9 - 0.2),
                                           R * 0.56, 26, rng, False, True)
                            pending.append(ch); allp.append(ch)
                        pending.sort(key=lambda q: q["t0"])
            flying = p["fly"] and f - p["fly"][0] <= 10
            if age % 3 == 0 or shove or flying or f >= p["end"]:
                p["rec"].append(_sample(p, f))
            if f >= p["end"]:
                alive.remove(p)
    out = []
    for n, p in enumerate(allp):
        rec = p["rec"]
        if len(rec) < 2:
            continue
        ks = [r[0] for r in rec]
        S = [r[1] for r in rec]
        T = lambda i, e="linear": [(k[0], k[i], e) for k in ks]
        wsel = [i for i in range(len(rec)) if i % 3 == 0 or i == len(rec) - 1]
        wk = track(*[(ks[i][0], _r(min(7.0, 4.2 * (S[i] / 100) ** -0.5)), "linear") for i in wsel])
        cl = CLUSTERS[p["cl"]]
        if p["mir"] < 0:
            cl = [(-dx, dy, r) for dx, dy, r in cl]
        t0 = ks[0][0]
        if p["dark"] and ks[-1][0] - t0 > 28:
            fc = track((t0, rgba(_mix(SMOKE_SHADE, SMOKE_FILL, .25)), "linear"), (t0 + 28, rgba(SMOKE_FILL)))
            hc = track((t0, rgba(_mix(SMOKE_FILL, SMOKE_HI, .1)), "linear"), (t0 + 28, rgba(SMOKE_HI)))
        else:
            fc, hc = SMOKE_FILL, SMOKE_HI
        out.append(layer("fx_smoke_%02d" % n, *_puff_groups(cl, wk, fc, hc), p=track(*T(1)), s=track(*T(2)),
                         r=track(*T(3)), o=track(*T(4)), parent="world", ip=t0, op=ks[-1][0] + 1))
    return out
