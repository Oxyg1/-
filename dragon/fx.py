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
FIRE_LEN, FIRE_HW, FIRE_MOUTH = 210.0, 80.0, 20.0   # tunable: jet length, half width at far end, half width at mouth
SHOVE_SPEED = 10.0   # paw speed (concept px / frame) above which puffs get shoved
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
TOP = [(0.20, 1.00, "p"), (0.35, 0.86, "v"), (0.49, 1.04, "p"), (0.58, 0.88, "v"), (0.67, 1.22, "t"),
       (0.77, 0.90, "v"), (90, 1.00, "c"), (66, 0.99, "c"), (42, 0.86, "c"), (20, 0.97, "c")]
KS = {"p": 1.0, "v": 0.8, "t": 0.75, "c": 1.0}
CAP_X, CAP_RX = 0.80, 0.26


def _smooth(nodes, ks):
    """closed smooth bezier through nodes (handles scaled by neighbour distance)."""
    n = len(nodes)
    ins, outs = [], []
    for i in range(n):
        P, A, B = nodes[i], nodes[i - 1], nodes[(i + 1) % n]
        dx, dy = B[0] - A[0], B[1] - A[1]
        ln = math.hypot(dx, dy) or 1.0
        ux, uy = dx / ln, dy / ln
        lo = math.hypot(B[0] - P[0], B[1] - P[1]) * 0.33 * ks[i]
        li = math.hypot(P[0] - A[0], P[1] - A[1]) * 0.33 * ks[i]
        outs.append([_r(ux * lo), _r(uy * lo)])
        ins.append([_r(-ux * li), _r(-uy * li)])
    return {"c": True, "v": [[_r(x), _r(y)] for x, y in nodes], "i": ins, "o": outs}


def _state(rng):
    def side():
        return [(rng.uniform(-.015, .015), rng.uniform(-.18, .18) if k == "t" else rng.uniform(-.07, .07))
                for _, _, k in TOP]
    return {"top": side(), "bot": side(), "nose": rng.uniform(-.03, .03)}


def _flame(x0, x1, H, hb, st, bend, wave, ph, yoff):
    L = max(x1 - x0, 1.0)
    hp = lambda s: hb + (H - hb) * min(1.0, s / 0.78) ** 0.9

    def pt(s, y):
        yy = y + yoff + bend * s * s + wave * s * math.sin(2.2 * s - ph)
        return (x0 + s * L, yy)

    def side(jit, sg):
        out, kk = [], []
        for (s, f, kind), (js, jf) in zip(TOP, jit):
            if kind == "c":
                ph_ = math.radians(s)
                s2 = CAP_X + CAP_RX * math.cos(ph_) + js * 2
                y = hp(CAP_X) * math.sin(ph_) * (f + jf)
            else:
                s2 = min(s + js, 1.0)
                y = hp(s2) * (f + jf)
            out.append(pt(s2, sg * y)); kk.append(KS[kind])
        return out, kk
    tp, tk = side(st["top"], 1)
    bp, bk = side(st["bot"], -1)
    nodes = [pt(0, hb)] + tp + [pt(CAP_X + CAP_RX + st["nose"], 0)] + bp[::-1] + [pt(0, -hb)]
    ks = [1.0] + tk + [1.0] + bk[::-1] + [1.0]
    return _smooth(nodes, ks)


def _local_to_head(origin, rot, lx, ly):
    a = math.radians(rot)
    return (origin[0] + math.cos(a) * lx - math.sin(a) * ly, origin[1] + math.sin(a) * lx + math.cos(a) * ly)


def _teardrop(k=1.9):
    v = [[14, 0], [0, 12], [-34, 0], [0, -12]]
    i = [[0, -8], [8, 0], [8, 8], [-8, 0]]
    o = [[0, 8], [-10, 0], [8, -8], [10, 0]]
    sc = lambda a: [[_r(x * k), _r(y * k)] for x, y in a]
    return {"c": True, "v": sc(v), "i": sc(i), "o": sc(o)}


def fire_layers(origin, angle_deg=-14, t_on=50, t_full=57, t_off=92, t_end=102):
    rot = 180 + angle_deg
    spec = [  # lenf, widf, xoff, yoff (top = hot core ... last = rim)
        (0.34, 0.24, 20, 7), (0.52, 0.42, 14, 5), (0.70, 0.60, 9, 3.5), (0.86, 0.80, 4, 2), (1.00, 1.00, 0, 0)]
    layers = []
    for idx, (lenf, widf, xoff, yoff) in enumerate(spec):
        k = len(spec) - 1 - idx                      # 0 = rim (outermost)
        rng = random.Random(40 + k * 11)
        states = [_state(rng) for _ in range(4)]
        t_done = int(round(t_end - 1 - 0.7 * k))
        ts = [t_on, t_on + 1, t_on + 2, t_on + 3, t_on + 5, t_full]
        t = t_full + 4 - k % 2
        while t < t_off - 2:
            ts.append(t); t += 4
        t = t_off - (t_off % 2)
        while t < t_done:
            ts.append(t); t += 2
        ts.append(t_done)
        keys = []
        for j, t in enumerate(sorted(set(ts))):
            g = _out((t - t_on - 0.6 * k) / (t_full - t_on), 4)
            q = _inout((t - t_off + 0.7 * k) / (t_end - 1 - t_off)) if t >= t_off - 2 else 0.0
            if t >= t_done:
                q = 1.0
            sf = (1 - q) ** 1.3
            gl = max(g, 0.05)
            L = FIRE_LEN * lenf
            x0 = xoff * gl * (1 - q) + 0.3 * L * q
            x1 = xoff * gl * (1 - q) + L * gl * sf + 0.3 * L * q
            H = max(FIRE_HW * widf * (0.3 + 0.7 * g ** 0.8) * sf ** 0.7, 2.5)
            hb = max(min(FIRE_MOUTH * widf * min(1.0, g * 2.2) * (1 - 0.6 * q) + 1.5, H * .6), 0.8)
            bend = 30 * gl * sf
            wave = 6 * gl * math.sin(0.23 * t + k * 0.9) * sf
            keys.append((t, _flame(x0, max(x1, x0 + 10), H, hb, states[(j + k) % 4], bend, wave, 0.3 * t + k, yoff * gl), "linear"))
        layers.append(layer("fx_fire_%d" % k, group("flame", path(track(*keys)), fill(FIRE[idx])),
                            p=origin, r=rot, parent="head", ip=t_on - 1, op=t_done))
    # flame chunks: break off the far end, rise, curl and shrink away
    blobs = []
    plan = [(61, 0.62, 24, 185, 12), (70, 0.72, 26, 190, -16), (79, 0.66, 26, 185, 14), (87, 0.7, 24, 190, -8),
            (t_off - 1, 0.95, t_end - t_off + 1, 190, 0)]
    for bi, (ts, scl, life, tip, ly) in enumerate(plan):
        a = _local_to_head(origin, rot, tip, ly)
        ang = math.radians(rot)
        end = (a[0] + math.cos(ang) * 22, a[1] + math.sin(ang) * 22 - (62 if bi == 4 else 52))
        mid = (a[0] + math.cos(ang) * 14, a[1] + math.sin(ang) * 14 - 20)
        pk = track((ts, [_r(a[0]), _r(a[1])], "out"), (ts + 6, [_r(mid[0]), _r(mid[1])], "swing"), (ts + life, [_r(end[0]), _r(end[1])]))
        sc = track((ts, [scl * 45] * 2, "out"), (ts + 5, [scl * 100, scl * 95], "in"), (ts + life, [0, 0]))
        rk = track((ts, rot, "out"), (ts + life, rot + 55))
        op = track((ts, 100, "linear"), (ts + life - 3, 100, "linear"), (ts + life, 0))
        grp = [group("hot", path(_teardrop()), fill(FIRE[1]), s=(42, 42), p=(-2, 0)),
               group("mid", path(_teardrop()), fill(FIRE[2]), s=(62, 62), p=(-1, 0)),
               group("blob", path(_teardrop()), fill(FIRE[3]), s=(82, 82)),
               group("rim", path(_teardrop()), fill(FIRE[4]))]
        blobs.append(layer("fx_fire_blob_%d" % bi, *grp, p=pk, s=sc, r=rk, o=op, parent="head", ip=ts, op=ts + life))
    return blobs + layers


# ----------------------------------------------------------------------------- sparks
def spark_layers(origin, angle_deg=-14, t_from=52, t_to=90):
    rng = random.Random(7)
    n = 8
    out = []
    base = math.radians(180 - angle_deg)      # screen direction of the jet (y down)
    for i in range(n):
        t0 = int(round(t_from + (t_to - t_from) * i / (n - 1)))
        life = rng.randint(15, 22)
        ang = base + math.radians(rng.uniform(-16, 16)) * (1 if i % 2 else -1)
        sp = rng.uniform(5.5, 8.5)
        vx, vy = math.cos(ang) * sp, math.sin(ang) * sp
        px = origin[0] + math.cos(base) * rng.uniform(50, 80)
        py = origin[1] + math.sin(base) * rng.uniform(50, 80) - rng.uniform(0, 14)
        pk, sk, ok = [], [], []
        step = 3
        ts = list(range(0, life, step)) + [life]
        x, y = px, py
        prev = 0
        for a in range(life + 1):
            if a in ts:
                pk.append((t0 + a, [_r(x), _r(y)], "linear"))
                u = a / life
                sk.append((t0 + a, [_r(100 * (1.0 - 0.8 * u ** 1.2))] * 2, "linear"))
                ok.append((t0 + a, int(100 * (1 - _clamp((u - 0.55) / 0.45))), "linear"))
            x += vx; y += vy
            vx *= 0.955; vy = vy * 0.955 + 0.16
        rotd = math.degrees(math.atan2(vy, vx))
        sz = rng.uniform(.8, 1.15)
        g = [group("hot", ellipse((9, 6)), fill(FIRE[1]), s=(sz * 100,) * 2),
             group("ember", ellipse((16, 11)), fill(FIRE[3]), s=(sz * 100,) * 2)]
        if i % 3 == 0:  # a few bigger, amber
            g[1] = group("ember", ellipse((19, 13)), fill(FIRE[2]), s=(sz * 100,) * 2)
        out.append(layer("fx_spark_%d" % i, *g, p=track(*pk), s=track(*sk), o=track(*ok), r=rotd,
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
    fl = group("fill", *[ell(dx - 1.8, dy - 2.5, r - 3.2) for dx, dy, r in cl], fill(fillc))
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
                if d < 85:
                    sp = math.hypot(pv[0], pv[1])
                    D = 60 + 40 * (1 - d / 85)
                    p["fly"] = (f, p["x"], p["y"], pv[0] / sp * D, pv[1] / sp * D)
                    p["vx"], p["vy"] = pv[0] / sp * 1.2, pv[1] / sp * 1.2
                    shove = True
                    p["end"] = min(p["end"], f + (17 if not p["child"] else 14))
                    p["shr"] = 9 if not p["child"] else 8
                    if not p["child"]:
                        R = p["size"]
                        n = 3 if R >= 30 else 2
                        ex, ey = p["x"] + p["fly"][3], p["y"] + p["fly"][4]
                        for c in range(n):
                            ang = c / n * 6.28 + p["ph"]
                            ch = _new_puff(f + 8, (ex + math.cos(ang) * R * 0.45, ey + math.sin(ang) * R * 0.45),
                                           (p["vx"] + math.cos(ang) * 0.9, p["vy"] + math.sin(ang) * 0.9 - 0.2),
                                           R * 0.46, 26, rng, False, True)
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
        wk = track(*[(ks[i][0], _r(11 * (S[i] / 100) ** -0.6), "linear") for i in wsel])
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
