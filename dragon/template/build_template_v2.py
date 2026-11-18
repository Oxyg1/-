#!/usr/bin/env python3
"""Template v2: the parts the dragon shares with the original Kissed Frog use the frog's own
contours (exact point topology), the rest come from the hand-traced v1 template.

Frog frame 0 is evaluated by lottie-web (frog/extract_frame0.js -> frog/frog_frame0_paths.json,
absolute 512-px coordinates with all layer/group transforms applied), then mapped to K0 pixels:
    x_K0 = 2.76 * x + 264,   y_K0 = 2.76 * y + 156      (silhouette IoU fit 0.964)
Writes dragon_template.svg (v1 kept as dragon_template_v1.svg) and frog/frog_parts.json.
"""
import json, re, os
HERE = os.path.dirname(os.path.abspath(__file__))
S, OX, OY = 2.76, 264.0, 156.0
LAYER = {'L22': 'body', 'L20': 'eyer', 'L19': 'eyel', 'L17': 'rfeet', 'L16': 'rarm', 'L23': 'larm', 'L21': 'kiss', 'L18': 'fold'}

# frog shape (layer name, index among visible unique paths) -> template id, group
FROG_PARTS = {
    ('body', 0):  ('body', 'g_body'),              # whole silhouette (torso + top of head)
    ('body', 2):  ('body_shade', 'g_body'),        # lower-body shade mass
    ('body', 3):  ('back_shade', 'g_body'),        # haunch/back shade
    ('body', 4):  ('body_rim', 'g_body'),          # inner rim line along the back
    ('body', 5):  ('chin_highlight', 'g_body'),
    ('body', 7):  ('spot_6', 'g_spots'),
    ('larm', 0):  ('foot_front_far', 'g_legs'),
    ('rarm', 0):  ('leg_front_near', 'g_legs'),
    ('rarm', 1):  ('leg_front_near_line', 'g_legs'),
    ('rfeet', 0): ('hind_leg', 'g_legs'),          # waves like the frog: rotate about the rfeet anchor
    ('rfeet', 1): ('hind_leg_line', 'g_legs'),
    ('rfeet', 2): ('hind_knee', 'g_legs'),
    ('eyer', 1):  ('eye_near_outer', 'g_eye_near'),
    ('eyer', 2):  ('eye_near_iris', 'g_eye_near'),
    ('eyer', 0):  ('eye_near_crease', 'g_eye_near'),
    ('kiss', 0):  ('kiss_upper', 'g_marks'),
    ('kiss', 1):  ('kiss_lower', 'g_marks'),
    ('fold', 0):  ('brow_fold', 'g_head'),
}
# v1 ids that the frog parts replace or make redundant
DROP = {'body', 'foot_front_far', 'toe_far_1', 'toe_far_2', 'leg_front_near', 'paw_front_near', 'hind_leg', 'hind_toes', 'eye_near_outer',
        'eye_near_iris', 'kiss_upper', 'kiss_lower'}


def tr(d, m):
    a, b, c, dd, e, f = m
    toks = re.findall(r'[MCLZmclz]|-?[\d.]+(?:e-?\d+)?', d)
    out, nums = [], []

    def flush():
        for i in range(0, len(nums), 2):
            x, y = nums[i], nums[i + 1]
            out.append('%.1f %.1f' % ((a * x + c * y + e) * S + OX, (b * x + dd * y + f) * S + OY))
        nums.clear()
    for t in toks:
        if t in 'MCLZmclz':
            flush()
            out.append(t.upper())
        elif True:
            nums.append(float(t))
    flush()
    return ' '.join(out)


def main():
    raw = json.load(open(os.path.join(HERE, 'frog', 'frog_frame0_paths.json')))
    seen, cnt, frog = set(), {}, {}
    for x in raw:
        if not x['vis'] or (x['layer'], x['d']) in seen:
            continue
        seen.add((x['layer'], x['d']))
        n = LAYER[x['layer']]
        i = cnt.get(n, 0); cnt[n] = i + 1
        if (n, i) in FROG_PARTS:
            tid, grp = FROG_PARTS[(n, i)]
            frog[tid] = dict(group=grp, d=tr(x['d'], x['m']), frog_layer=n, frog_layer_ind=int(x['layer'][1:]), frog_index=i)

    v1_path = os.path.join(HERE, 'dragon_template_v1.svg')
    if not os.path.exists(v1_path):
        os.rename(os.path.join(HERE, 'dragon_template.svg'), v1_path)
    svg = open(v1_path).read()
    for tid in DROP:
        svg, k = re.subn(r'\s*<path id="%s" [^>]*/>' % re.escape(tid), '', svg)
        assert k == 1, tid
    # insert frog paths into their groups (after the group's opening tag)
    by_group = {}
    for tid, p in frog.items():
        by_group.setdefault(p['group'], []).append('\n    <path id="%s" d="%s"/>' % (tid, p['d']))
    for grp, items in by_group.items():
        m = re.search(r'<g id="%s"[^>]*>' % grp, svg)
        assert m, grp
        svg = svg[:m.end()] + ''.join(items) + svg[m.end():]
    open(os.path.join(HERE, 'dragon_template.svg'), 'w').write(svg)
    json.dump({k: {kk: vv for kk, vv in v.items() if kk != 'd'} for k, v in frog.items()},
              open(os.path.join(HERE, 'frog', 'frog_parts.json'), 'w'), ensure_ascii=False, indent=1)
    print('frog parts:', len(frog), sorted(frog))


if __name__ == '__main__':
    main()
