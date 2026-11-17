# Kissed Dragon — Telegram animated sticker: production spec

Read this whole file before writing code. The art director (the lead session) reviews
every deliverable **by rendered PNG**, not by code. Quality bar: premium Telegram
animated stickers (smooth, juicy, overlapping action, squash & stretch, clean vector,
thick dark outline). Style reference: `ref/kissed-frog-original.json` (same series,
look at how it is rigged: master null with impact squash, head null, eye swap).

## References

- `ref/concept.png` — the dragon concept (697×561 raster). **The only art source.**
- `ref/concept-grid.png` — same, 2× with a grid (labels every 100 px, lines every 20 px,
  in concept pixels). `ref/c_head.png`, `c_wing.png`, `c_front.png`, `c_tail.png` —
  3× zoomed crops with labelled concept coordinates (yellow labels = concept px).
- `ref/kissed-frog-filmstrip.png` — the original frog sticker, for style/quality.

## Tools

- Skill scripts (Python helpers, linter): `/home/user/obeskay/lottie-animator-skill/skills/lottie-animator/scripts/`
  - `motion.py`: `track`, `layer`, `null`, `group`, `ellipse`, `path`, `bezier`, `fill`,
    `stroke`, `trim`, `comp`, `dumps`, `EASE` (read its docstrings; first item in a list paints on top;
    every keyframe except the last must carry `o`/`i` handles — `track()` does this).
  - `lottie_lint.py file.json` — must report no errors.
- Renderer (npm already installed): `node /home/user/obeskay/lottie-animator-skill/scripts/render.mjs FILE.json --frames 0,30,60 --bg "#17212B" --out DIR`
  (writes per-frame PNGs + `filmstrip.png`; `--onion` for motion trails). **Always Read the PNGs and look.**
- Python 3 + Pillow are available.

## Telegram constraints (hard)

- 512×512 canvas, `fr` 60, `ip` 0, `op` 180 (exactly 3.0 s), seamless loop: frame 180 == frame 0.
- `.tgs` = gzip of the JSON, **≤ 64 KB**. Keep numbers rounded (motion.dumps rounds to 3 dp;
  prefer 1–2 dp for path vertices), avoid redundant keyframes.
- Forbidden: expressions, images/assets, 3D layers (`ddd`), merge paths (`mm`), star/polystar
  (`sr`), gradient strokes (`gs`), repeaters (`rp`), time remap (`tm` on layer), time stretch
  (`sr` ≠ 1 on layer), layer effects (`ef`), auto-orient (`ao` = 1), text layers.
- Allowed: shape layers, nulls, parenting, fills, strokes, linear/radial gradient **fills** (`gf`),
  trim paths, path morphs, alpha track mattes (`td`/`tt`).
- Must read on both Telegram themes: dark (`#17212B`) and light (`#FFFFFF`).

## Coordinate system

All art is authored **in concept-image pixel coordinates** (the 697×561 concept). A root
null `world` maps it to the canvas: `a=(0,0)`, `p=(30,63)`, `s=(70,70)` →
canvas = 0.7·concept + (30,63). The dragon sits right/centre; the left of the canvas is free
for the fire. Every layer is parented (directly or indirectly) to `world`.

For any layer that rotates/scales about a joint, set **anchor = position = the joint, in
concept coords**, so its shapes can keep absolute concept coordinates.

## Palette (sampled from the concept)

| role | hex |
|---|---|
| outline (main contour + inner lines) | `#4A1622` |
| body light (top-left) → body dark (bottom-right), linear gradient fill | `#EC685E` → `#B8403F` |
| snout highlight | `#F27F72` |
| body spots / tail shadow | `#C1453F` |
| belly | `#FBC982`, belly stripes/edge `#D18E45` |
| horn fill / horn outline | `#FBDE9C` / `#5A2A12` |
| spikes (head, back, tail) | `#8E347F`, outline `#4A1622` |
| wing leather (red) / wing membrane (cream) / wing bones | `#B9454A` / `#F4BF7B` / `#5E1420` |
| eye: outer dark disc / grey-white ring / pupil / highlight | `#301015` / `#E6E1DC` / `#2D1B33` / `#FFFFFF` |
| kiss mark (lips) | `#CA3634`, lip split line `#A92A2C` |
| toes / paw pads | `#E38E95` |
| mouth inside / tongue | `#4A0E14` / `#E0606A` |
| fire: rim / outer / mid / core / hot centre | `#E5392A` / `#FF7A1A` / `#FFB52E` / `#FFE27A` / `#FFF6D0` |
| smoke: outline / shade / fill / highlight | `#4A3F55` / `#8D8598` / `#A79FB0` / `#D6D0DC` |

Outline width: **12** concept units for the silhouette, **9** for inner lines (mouth, belly
line, haunch line, bones). Round caps and joins everywhere.

## Outline technique (important)

The concept has a thick outline only on the *outer silhouette*; the head and body are one
continuous mass with no line between them. Do it with **depth levels**:

- Each level = an *outline pass* (the level's silhouettes, filled AND stroked with the
  outline colour, width 24 = 2×12) placed **below** the level's *fill pass* (same paths,
  fill only). Overlapping parts of one level then merge seamlessly.
- Levels, back to front:
  - **L0 (behind)**: wing, horns, spikes, far (left) front foot, back spike near tail root.
    These may simply carry their own stroke (fill + stroke) — their bases get covered by L1.
  - **L1 (main mass)**: body + head share ONE outline pass; then fills; then inner details
    (belly, stripes, spots, haunch line, rear-leg line, cream wedge, kiss, eyes, nostrils,
    mouth line, fang). Head and body use the **same gradient fill in concept coords**
    (`s=(230,180)`, `e=(580,500)`) so the seam is invisible.
  - **L2 (front)**: tail (fill + its own stroke; its spikes tucked under the tail fill),
    near front arm + paw (fill + stroke, see Arm), then FX (fire, sparks, smoke) on top.

## Geometry notes from the concept (concept px)

- **Head (profile, pose P)**: snout tip ≈ (150,215); nostrils dark ovals at (186,196) and
  (240,201); top of snout rises to forehead under the left horn (250,145); small dip behind it
  (≈280,165) where purple spikes stand; head top ≈ y 147 to the right horn base (400,150);
  back of head merges into body around (470,200). Mouth: dark wavy line from (158,240) through
  (200,242), (262,260), (300,242), to (336,266). A small fang hangs at (320–340, 255–285) with
  a white glint. Chin/throat bulges at left (150–185, 240–300) and flows into the chest.
- **Near eye**: centre (378,212). Outer dark disc r≈48, grey-white ring r≈33 (stroke ~7),
  pupil r≈27, small white highlight upper-left.
- **Kiss**: lips on the cheek, upper lip ≈ (350–460, 268–310), lower lip ≈ (360–455, 305–345).
  This is the series' signature — keep it clearly readable.
- **Horns** (cream, brown outline, slight curve, with a small lobe on the front side):
  left horn base (228–276,150) tip (262,58); right horn base (378–438,150) tip (435,55).
- **Spikes** (purple triangles, behind head): ≈ (290,175)-(305,112)-(330,160);
  (338,158)-(358,108)-(392,142); one behind the right horn near the wing (445,180)-(465,140)-(482,190);
  one on the back at (585,330)-(600,345). Tail spikes at ≈(480,455) and (520,430).
- **Body**: big round mass: chest left edge ≈ x 150–165 (y 300–450), bottom ≈ y 475,
  back right edge ≈ x 578 at y 330, back top ≈ (470,185).
- **Belly**: cream oval centre ≈ (205,375), rx≈45, ry≈82, three curved stripes, darker edge.
- **Front legs**: far (left) foot sticks out at (105–175, 415–462) with three pink toes;
  near paw at (215–262, 465–492) with pink toes. Dark line at x≈245, y 365→455 = the near
  arm's left edge. A second dark line (318,400)→(310,460) and a cream wedge (310–370, 440–470)
  = rear leg / underside.
- **Haunch**: dark curved line (480,355)→(400,462) with a light highlight stripe beside it.
- **Tail**: wraps from behind the right side (590,360) down and around the bottom to a point
  near (385,488); in front of the body bottom.
- **Body spots**: small darker circles on the back/side ≈ (485,268),(505,275),(495,305),
  (470,330),(520,330),(505,352),(470,385),(540,300); tiny heart at (360,385).
- **Wing** (behind, attached near (465,215)): a red leathery upper lobe whose tip is
  ≈(578,92); the main wing spreads right to a tip ≈(670,172); bottom edge scalloped with
  3 bays ending ≈(610,228),(568,258),(527,266); cream membranes between dark bones that
  radiate from ≈(530,150).

## Rig (layer names are an API — use exactly these)

```
world (null)                     a=(0,0) p=(30,63) s=70
 └ master (null)                 a=p=(360,490)   squash/stretch + shake (ground pivot)
    └ body (null)                a=p=(360,480)   breathing
       ├ head (null)             a=p=(330,290)   neck pivot: turn tilt, lunge, cough
       │   (head fill/outline, eyes, nostrils, mouth, fang, kiss, horns, head spikes,
       │    mouth-open shape, and the FIRE layers are parented here)
       ├ eye_near (null)         at the near-eye centre, parent head
       ├ eye_far (null)          at the far-eye centre, parent head
       ├ wing (null)             a=p=(468,212)
       ├ tail (null)             a=p=(565,395)
       └ arm (null)              a=p=(282,352)   shoulder
           └ hand (null)         a=p=(245,455)   wrist
 smoke + spark layers are parented to `world` (free in the air, not to master)
```

## Head turn: two poses with morphs

- **P** = profile (as in the concept). **F** = three-quarter toward camera, snout still pointing
  left but foreshortened. In F: snout front pulled right (~+30 px), head top rounder; the near eye
  moves to ≈(360,206) and grows ~4%; the **far eye** becomes visible at ≈(250,198), smaller
  (r≈38) — in P it is hidden (scale-x 0, it rotates into view as scale-x 0→100 while sliding
  right ~20 px); nostrils move to ≈(196,214) and (224,208); mouth line becomes a wider smile
  from ≈(186,266) to (352,278) with the fang at ≈(328,272); left horn shifts +12 px, right horn
  −10 px; kiss shifts −8 px. Morphing paths must have **identical vertex counts/order** in P and F.
- Fire is breathed in pose F, out of the front of the mouth, to the **left and slightly down**.

## Timing (60 fps, 180 frames) — owned by the animator, listed so everyone shares it

| frames | beat |
|---|---|
| 0–12 | idle in P; tiny breathing |
| 12–30 | **turn P→F**: anticipation tilt away (12–16), whip with 1–2 smear frames, settle 30–40; horns/wing/tail follow 2–4 f late; blink during the turn (14–24) |
| 36–50 | inhale: chest up (master s ≈ 98/104), head up & back, eyes squint (lids ~40 %), wing raises |
| 50–94 | **fire**: lunge forward-left, squash impact on master, decaying shake (±2–3 canvas px), mouth open, flame jet grows 50→57, flickers, sparks fly; wing flutters; eyes wide |
| 92–106 | stop: jet pinches off and the last tongue flies away and fades (92–102); mouth closes; hiccup bounce |
| 96–165 | **smoke** from mouth (big puffs) and nostrils (wisps), rising and drifting left |
| 108–150 | embarrassed squint (lids ~45 %); near arm rises (110–122) and **waves twice** in front of the snout (swipes ≈124 and ≈140), hand lags the arm; puffs near the paw get shoved away and break up |
| 150–176 | arm lowers; **turn F→P** with anticipation, blink 158–166; last wisps vanish before 172 |
| 176–180 | hold == frame 0 |

## Module contracts

### `dragon/art.py` (artist)
```python
build_layers(A: dict, fx_front=(), fx_head=()) -> list[dict]   # full rigged layer list, top first
```
`A` holds animation tracks keyed by name (missing key → static rest value). Keys:
`master.p`, `master.s`, `body.s`, `head.p`, `head.r`, `turn` (schedule, see below),
`lid.near`, `lid.far` (0 open … 1 closed), `pupil.s` (percent), `mouth.open` (0…1),
`wing.r`, `tail.r`, `arm.r`, `hand.r`, `arm.outline` (0 = only the left-edge line visible as in
the concept, 1 = full outline when the arm is raised).
`turn` is a schedule `[(frame, w, ease), ...]` with w ∈ {0 (P), 1 (F)}; art.py turns it into
every pose-dependent track (head shape and its outline copy, eyes, nostrils, mouth line, fang,
horns, kiss…). 0…1 parameters are tracks built with `motion.track`; art.py remaps their
keyframe values. `fx_head` layers are inserted parented to `head` above the head details,
`fx_front` layers at the very top.
Also: `static_comp()` → the dragon at rest (pose P) as a full 512 comp, and
`MOUTH_ORIGIN_F` (concept coords, head space) = where fire leaves the mouth in pose F,
`PAW_TIP` (concept coords at rest) for the smoke interaction.
Eyelids: use an alpha track matte (eye disc as matte, a head-coloured lid with a dark lower
edge sliding down) so squints look right.

### `dragon/fx.py` (FX)
```python
fire_layers(origin, angle_deg=-14, t_on=50, t_full=57, t_off=92, t_end=102) -> list[dict]
spark_layers(origin, angle_deg=-14, t_from=52, t_to=90) -> list[dict]
smoke_layers(emitters, paw=None) -> list[dict]
```
Coordinates in concept px. Fire/sparks are parented to `head` (their `parent` field = "head"),
origin in head space. `emitters` = list of dicts `{t0, pos, vel, size, life}`; `paw` = callable
`frame -> (x, y)` in concept coords, or None. Smoke is a small per-frame simulation (buoyancy,
drag, slight curl) baked to position/scale/opacity keyframes every 2–3 frames; when the paw passes
near a puff with speed, the puff gets shoved along the paw's velocity and splits/thins. Every
puff must be fully gone (opacity 0) by frame 172.
Also `fx_demo.py` → a standalone 512 comp showing fire + sparks + smoke on their own.

### `dragon/tools/tgs.py` (tooling)
`python3 tools/tgs.py check FILE.json` (all Telegram rules above, clear PASS/FAIL report incl.
gzip size), `python3 tools/tgs.py pack FILE.json -o FILE.tgs`, and
`tools/preview.sh FILE.json OUTDIR` (filmstrips on `#17212B` and `#FFFFFF`).

### `dragon/animate.py` (animator)
Builds `A` + FX per the timing table, writes `dragon/build/kissed-dragon.json` and `.tgs`.
