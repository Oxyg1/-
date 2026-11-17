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
FIRE_LEN, FIRE_HW = 200.0, 55.0
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
def _bez(nodes, bulges, leans):
    n = len(nodes)
    ins = [[0, 0] for _ in range(n)]
    outs = [[0, 0] for _ in range(n)]
    for k in range(n):
        A, B = nodes[k], nodes[(k + 1) % n]
        dx, dy = B[0] - A[0], B[1] - A[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        f1, f2 = leans[k]
        b = bulges[k] * ln
        c1 = (dx * f1 + nx * b, dy * f1 + ny * b)
        c2 = (dx * f2 + nx * b, dy * f2 + ny * b)
        outs[k] = [_r(c1[0]), _r(c1[1])]
        ins[(k + 1) % n] = [_r(c2[0] - dx), _r(c2[1] - dy)]
    return {"c": True, "v": [[_r(x), _r(y)] for x, y in nodes], "i": ins, "o": outs}


def _state(rng, m):
    return {"j": [rng.uniform(-.2, .2) for _ in range(m)], "jb": [rng.uniform(-.2, .2) for _ in range(m)],
            "bm": [rng.uniform(.75, 1.3) for _ in range(m + 1)], "bb": [rng.uniform(.75, 1.3) for _ in range(m + 1)],
            "t1": rng.uniform(-1, 1), "t2": rng.uniform(-1, 1), "tm": rng.uniform(-1, 1),
            "ty": rng.uniform(-1, 1), "bend": rng.uniform(.4, 1.0), "w": rng.uniform(.93, 1.07)}


def _flame(x0, x1, hw, hb, m, st, bulge):
    L = max(x1 - x0, 1.0)
    hp = lambda s: hb + (hw - hb) * min(1.0, s / 0.7) ** 0.75
    bend = lambda s: st["bend"] * 20 * s * s * min(1.0, hw / 30.0)
    P = lambda s, y: (x0 + s * L, y + bend(s))
    top, bot = [P(0, hb * 0.9)], []
    bt, bb = [], []
    hwj = hw * st["w"]
    for k in range(1, m + 1):
        s = (k + st["j"][k - 1]) / (m + 1) * 0.74
        top.append(P(s, hp(s) * 0.76 * st["w"]))
        s = (k + st["jb"][k - 1]) / (m + 1) * 0.74
        bot.append(P(s, -hp(s) * 0.76 / st["w"]))
    top += [P(0.87 + 0.05 * st["t1"], 0.56 * hwj), P(0.78, 0.24 * hwj),
            P(1.0 + 0.05 * st["tm"], 0.07 * hwj * st["ty"]), P(0.78, -0.24 * hwj)]
    bottip = P(0.86 + 0.05 * st["t2"], -0.55 * hwj)
    nodes = top + [bottip] + bot[::-1] + [P(0, -hb * 0.9)]
    n = len(nodes)
    bul, lean = [], []
    nt = m + 1                      # segments base->c1..cm->Ttop  (nt of them)
    for k in range(nt):
        bul.append(bulge * st["bm"][k]); lean.append((0.4, 0.95))
    # Ttop->Dtop, Dtop->M, M->Dbot, Dbot->Tbot, Tbot->c'm
    bul += [-0.2, 0.1, 0.1, -0.2, 0.1 * 1.0]
    lean += [(1 / 3, 2 / 3)] * 4 + [(0.1, 0.65)]
    # bottom cusps back to base
    for k in range(m - 1):
        bul.append(bulge * st["bb"][m - 1 - k]); lean.append((0.1, 0.65))
    bul += [bulge * st["bb"][0], 0.0]
    lean += [(0.1, 0.65), (1 / 3, 2 / 3)]
    assert len(bul) == n, (len(bul), n)
    return _bez(nodes, bul, lean)


def _fire_times(k, t_on, t_full, t_off, t_end):
    ts = [t_on, t_on + 1, t_on + 2, t_on + 3, t_on + 5, t_full]
    t = t_full + 1 + k % 3
    while t < t_off - 1:
        ts.append(t); t += 3
    t = t_off
    while t < t_end:
        ts.append(t); t += 2
    ts.append(t_end)
    return sorted(set(ts))


def _local_to_head(origin, rot, lx, ly):
    a = math.radians(rot)
    return (origin[0] + math.cos(a) * lx - math.sin(a) * ly, origin[1] + math.sin(a) * lx + math.cos(a) * ly)


def _teardrop():
    # blob pointing +x, tail trailing to -x
    return {"c": True, "v": [[14, 0], [0, 12], [-34, 0], [0, -12]],
            "i": [[0, -8], [8, 0], [8, 8], [-8, 0]], "o": [[0, 8], [-10, 0], [8, -8], [10, 0]]}


def fire_layers(origin, angle_deg=-14, t_on=50, t_full=57, t_off=92, t_end=102):
    rot = 180 + angle_deg
    spec = [  # lenf, widf, bumps, xoff, bulge
        (0.34, 0.22, 2, 28, 0.42),
        (0.52, 0.38, 3, 20, 0.46),
        (0.72, 0.58, 4, 12, 0.50),
        (0.90, 0.80, 4, 5, 0.52),
        (1.00, 1.00, 5, 0, 0.55),
    ]
    layers = []
    for idx, (lenf, widf, m, xoff, bulge) in enumerate(spec):
        k = len(spec) - 1 - idx                     # 0 = rim (outermost)
        rng = random.Random(100 + k * 7)
        states = [_state(rng, m) for _ in range(4)]
        keys = []
        for t in _fire_times(k, t_on, t_full, t_off, t_end):
            g = _out((t - t_on - 0.6 * k) / (t_full - t_on), 4)
            q = _inout((t - t_off + 1.4 * k) / (t_end - 1 - t_off))
            gl = max(g, 0.05)
            L = FIRE_LEN * lenf
            x0 = xoff * gl * (1 - q) + 0.9 * L * q
            x1 = xoff * gl * (1 - q) + L * gl * (1 + 0.02 * q) + 0.5
            if t >= t_end:
                q = 1.0
            hw = FIRE_HW * widf * (0.3 + 0.7 * g ** 0.8) * (1 - q) ** 0.7
            hw = max(hw, 0.8)
            hb = max(min(hw * 0.5, 16 * widf + 4), 0.6)
            st = states[(t // 3 + k * 1) % 4]
            keys.append((t, _flame(x0, max(x1, x0 + 1.5), hw, hb, m, st, bulge), "linear"))
        shp = track(*keys)
        layers.append(layer("fx_fire_%d" % k, group("flame", path(shp), fill(FIRE[idx])),
                            p=origin, r=rot, parent="head", ip=t_on - 1, op=t_end + 1))
    # detached flame blobs: break off the tip, fly on and fade
    blobs = []
    for bi, (ts, scl, dist, rise) in enumerate([(61, .55, 50, 14), (69, .7, 58, 18), (77, .6, 52, 12),
                                                (84, .75, 60, 20), (t_off - 1, 1.15, 62, 22)]):
        life = 22 if bi < 4 else t_end - ts + 4
        tip = FIRE_LEN * 0.85
        ks = [(0, (tip, 0), "out"), (life, (tip + dist, rise), "in")]
        pk = [(ts, [_r(v) for v in _local_to_head(origin, rot, *ks[0][1])], "out"),
              (ts + life, [_r(v) for v in _local_to_head(origin, rot, *ks[1][1])])]
        sc = track((ts, [scl * 40] * 2, "out"), (ts + 5, [scl * 100, scl * 85], "swing"),
                   (ts + life, [scl * 18, scl * 12]))
        op = track((ts, 100, "in"), (ts + int(life * .45), 100, "in"), (ts + life, 0))
        # blobs ride in the jet's frame (rotation fixed), position in head space
        grp = [group("hot", path(_teardrop()), fill(FIRE[1]), s=(55, 55), p=(-3, 0)),
               group("blob", path(_teardrop()), fill(FIRE[3]))]
        blobs.append(layer("fx_fire_blob_%d" % bi, *grp, p=track(*pk), s=sc, r=rot, o=op, parent="head",
                           ip=ts, op=ts + life + 1))
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
        g = [group("hot", ellipse((7, 4.5)), fill(FIRE[1]), s=(sz * 100,) * 2),
             group("ember", ellipse((12, 8)), fill(FIRE[3]), s=(sz * 100,) * 2)]
        if i % 3 == 0:  # a few bigger, amber
            g[1] = group("ember", ellipse((14, 10)), fill(FIRE[2]), s=(sz * 100,) * 2)
        out.append(layer("fx_spark_%d" % i, *g, p=track(*pk), s=track(*sk), o=track(*ok), r=rotd,
                         parent="head", ip=t0, op=t0 + life + 1))
    return out


# ----------------------------------------------------------------------------- smoke
CLUSTERS = [  # (dx, dy, r) in units where main circle r = 20
    [(0, 0, 20), (-17, 7, 14), (16, 8, 13.5), (3, -14, 13)],
    [(0, 0, 20), (17, 5, 14.5), (-15, 9, 13), (-4, -15, 12.5)],
    [(0, 0, 19), (-18, 2, 13), (18, 3, 14), (-2, 13, 12)],
]


def _puff_groups(cl, wtrack):
    ell = lambda dx, dy, r, k=1.0: ellipse(r * 2 * k, p=(dx, dy))
    hi = [group("hl", ellipse(11, p=(cl[0][0] - 6, cl[0][1] - 7)), fill(SMOKE_HI)),
          group("hl2", ellipse(7, p=(cl[3][0] - 3, cl[3][1] - 4)), fill(SMOKE_HI))]
    fl = group("fill", *[ell(dx - 1.6, dy - 2.2, r - 3.0) for dx, dy, r in cl], fill(SMOKE_FILL))
    sh = group("shade", *[ell(dx, dy, r) for dx, dy, r in cl], fill(SMOKE_SHADE))
    ol = group("outline", *[ell(dx, dy, r) for dx, dy, r in cl], fill(SMOKE_OUT), stroke(SMOKE_OUT, wtrack))
    return hi + [fl, sh, ol]


def _new_puff(t0, pos, vel, size, life, rng, child=False):
    return {"t0": int(t0), "x": float(pos[0]), "y": float(pos[1]), "vx": float(vel[0]), "vy": float(vel[1]),
            "size": float(size), "end": min(int(t0 + life), LAST_FRAME), "fade": 0.42 * min(life, LAST_FRAME - t0),
            "ph": rng.uniform(0, 6.28), "spin": rng.uniform(-.9, .9), "rot0": rng.uniform(-30, 30),
            "cl": rng.randrange(3), "mir": rng.choice([1, -1]), "keys": [], "split": child, "child": child}


def _sample(p, f):
    age = f - p["t0"]
    dur = max(p["end"] - p["t0"], 1)
    fp = _clamp((f - (p["end"] - p["fade"])) / max(p["fade"], 1))
    R = p["size"] * (0.4 + 0.6 * _out(age / 14.0, 3)) * (1 + 0.12 * (age / dur)) * (1 + 0.5 * fp ** 1.3)
    S = R / 20.0 * 100
    o = 100 * (1 - _inout(fp)) * min(1.0, (age + 1) / 3.0)
    ph = p["ph"] + age * 0.16
    sx, sy = S * (1 + 0.05 * math.sin(ph)), S * (1 - 0.05 * math.sin(ph))
    return [t for t in (f, [_r(p["x"]), _r(p["y"])], [_r(sx), _r(sy)], _r(p["rot0"] + p["spin"] * age), int(round(o)))], S


def smoke_layers(emitters, paw=None):
    rng = random.Random(3)
    puffs = [_new_puff(e["t0"], e["pos"], e["vel"], e["size"], e["life"], rng) for e in emitters]
    for p in puffs:
        p["split"] = False
    wpts = {}
    t_min = min(p["t0"] for p in puffs)
    alive = []
    pending = sorted(puffs, key=lambda p: p["t0"])
    allp = list(puffs)
    for f in range(t_min, LAST_FRAME + 1):
        while pending and pending[0]["t0"] <= f:
            alive.append(pending.pop(0))
        pv = None
        if paw is not None:
            a, b = paw(f), paw(f - 1)
            pv = (a[0] - b[0], a[1] - b[1], a)
        for p in list(alive):
            age = f - p["t0"]
            if age > 0:
                p["vy"] -= 0.030
                p["vx"] += -0.008 + 0.014 * math.sin(0.09 * age + p["ph"])
                p["vx"] *= 0.963; p["vy"] *= 0.963
                p["x"] += p["vx"]; p["y"] += p["vy"]
            shove = False
            if pv and math.hypot(pv[0], pv[1]) > 3:
                d = math.hypot(p["x"] - pv[2][0], p["y"] - pv[2][1])
                if d < 70:
                    w = 1 - d / 70
                    p["vx"] += pv[0] * 0.26 * w + (p["x"] - pv[2][0]) / (d + 1) * 1.2 * w
                    p["vy"] += pv[1] * 0.26 * w + (p["y"] - pv[2][1]) / (d + 1) * 1.2 * w
                    shove = True
            if shove:
                p["end"] = min(p["end"], f + 16); p["fade"] = min(p["fade"], 16)
                if not p["split"] and p["size"] * 0.9 >= 14 and f - p["t0"] > 2:
                    p["split"] = True
                    R = p["size"]
                    for sgn in (1, -1):
                        c = _new_puff(f + 1, (p["x"] + sgn * R * 0.3, p["y"] - R * 0.1),
                                      (p["vx"] * 0.9 + sgn * 0.9 * 1, p["vy"] * 0.9 - 0.6 + sgn * .6),
                                      R * 0.55, 34, rng, True)
                        c["split"] = True
                        c["size"] = R * 0.55
                        pending.append(c); allp.append(c)
                    pending.sort(key=lambda q: q["t0"])
                p["_ks"] = True
            if (f - p["t0"]) % 3 == 0 or shove or f >= p["end"]:
                p["keys"].append(f)
                p.setdefault("rec", []).append(_sample(p, f))
            if f >= p["end"]:
                alive.remove(p)
    out = []
    for n, p in enumerate(allp):
        rec = p.get("rec", [])
        if len(rec) < 2:
            continue
        ks = [r[0] for r in rec]
        S = [r[1] for r in rec]
        pk = track(*[(k[0], k[1], "linear") for k in ks])
        sk = track(*[(k[0], k[2], "linear") for k in ks])
        rk = track(*[(k[0], k[3], "linear") for k in ks])
        ok = track(*[(k[0], k[4], "linear") for k in ks])
        # outline width compensating the layer scale (visible ~5.5 px, mildly growing)
        wsel = [i for i in range(len(rec)) if i % 3 == 0 or i == len(rec) - 1]
        wk = track(*[(ks[i][0], _r(11 * (S[i] / 100) ** -0.6), "linear") for i in wsel]) if len(wsel) > 1 else 14
        cl = CLUSTERS[p["cl"]]
        if p["mir"] < 0:
            cl = [(-dx, dy, r) for dx, dy, r in cl]
        out.append(layer("fx_smoke_%02d" % n, *_puff_groups(cl, wk), p=pk, s=sk, r=rk, o=ok,
                         parent="world", ip=ks[0][0], op=ks[-1][0] + 1))
    return out
