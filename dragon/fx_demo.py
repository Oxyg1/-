"""Standalone FX demo -> build/fx_demo.json (512x512, 60fps, 180f)."""
import sys, os
sys.path.insert(0, "/home/user/obeskay/lottie-animator-skill/skills/lottie-animator/scripts")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion import *
import fx

ORIGIN = (190, 282)
WP = [(0, (250, 470)), (108, (250, 470)), (114, (245, 420)), (120, (225, 300)), (124, (150, 285)),
      (130, (225, 300)), (140, (150, 285)), (146, (225, 300)), (156, (250, 440)), (166, (250, 470)), (180, (250, 470))]


def paw(f):
    f = max(0, min(180, f))
    for (a, pa), (b, pb) in zip(WP, WP[1:]):
        if a <= f <= b:
            u = (f - a) / (b - a)
            u = u * u * (3 - 2 * u)
            return (pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u)


def build():
    em = []
    for i, t in enumerate([96, 103, 111, 119, 130]):
        em.append({"t0": t, "pos": (178 + i * 2, 270), "vel": (-2.6, -0.6 - 0.1 * i), "size": 36 + 4 * (i % 3), "life": 68})
    for i, t in enumerate([108, 117, 127, 137, 146, 154]):
        x, y = [(198, 214), (224, 208)][i % 2]
        em.append({"t0": t, "pos": (x, y), "vel": (-1.0, -1.0), "size": 18 + i % 3, "life": 50})
    paw_layer = layer("demo_paw", group("paw", ellipse(46), fill("#E38E95"), stroke("#4A1622", 8)),
                      p=track(*[(f, [round(v, 1) for v in paw(f)], "linear") for f in range(0, 181, 2)]), parent="world")
    snout = layer("demo_head", group("h", ellipse((230, 200), p=(300, 255)), fill("#EC685E")), parent="head")
    layers = [paw_layer] + fx.smoke_layers(em, paw) + fx.spark_layers(ORIGIN) + fx.fire_layers(ORIGIN) + [snout]
    layers += [null("head", parent="world"), null("world", p=(30, 63), s=70)]
    return comp("fx demo", 512, 512, layers, 180)


if __name__ == "__main__":
    d = build()
    os.makedirs("build", exist_ok=True)
    open("build/fx_demo.json", "w").write(dumps(d))
    print("ok")
