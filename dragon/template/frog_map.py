#!/usr/bin/env python3
"""Maps vertices of the original frog Lottie (ref/kissed-frog-original.json, frame 0) onto the template anchors.

Frog canvas (512x512) -> K0 pixels:  x_K0 = 2.92*x + 256,  y_K0 = 2.92*y + 96  (lead's fit; an ICP re-fit on the legs gave
3.02/(228,46) with only ~2 px better residual, so the lead's transform is kept).
Frog layer transforms at frame 0 (layer chain incl. parents + shape-group transforms) are composed before that.

Writes frog_map.json: for every frog shape -> list of (frog vertex k, template id, anchor index (1-based), distance px).
"""
import json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
FROG = os.path.join(HERE, '..', 'ref', 'kissed-frog-original.json')
S, OX, OY = 2.92, 256.0, 96.0
sys.path.insert(0, HERE)

D = json.load(open(FROG))
L = {l['ind']: l for l in D['layers']}


def val(p):
    if p is None:
        return None
    if p.get('a') == 1:
        return p['k'][0]['s']
    return p['k']


def mat(ks):
    a = val(ks.get('a')) or [0, 0, 0]
    p = val(ks.get('p')) or [0, 0, 0]
    s = val(ks.get('s')) or [100, 100, 100]
    r = val(ks.get('r')) or 0
    if isinstance(r, list):
        r = r[0]
    c, sn = math.cos(math.radians(r)), math.sin(math.radians(r))
    T = np.array([[1, 0, p[0]], [0, 1, p[1]], [0, 0, 1.]])
    R = np.array([[c, -sn, 0], [sn, c, 0], [0, 0, 1.]])
    Sc = np.array([[s[0] / 100, 0, 0], [0, s[1] / 100, 0], [0, 0, 1.]])
    A = np.array([[1, 0, -a[0]], [0, 1, -a[1]], [0, 0, 1.]])
    return T @ R @ Sc @ A


def layer_mat(l):
    m = mat(l['ks'])
    return layer_mat(L[l['parent']]) @ m if l.get('parent') else m


def walk(items, m, out, path=()):
    tr = [i for i in items if i['ty'] == 'tr']
    if tr:
        m = m @ mat(dict(a=tr[0].get('a'), p=tr[0].get('p'), s=tr[0].get('s'), r=tr[0].get('r')))
    for i, it in enumerate(items):
        if it['ty'] == 'gr':
            walk(it['it'], m, out, path + (i,))
        elif it['ty'] == 'el':
            out.append((path + (i,), dict(ellipse=(val(it['p']), val(it['s']))), m))
        elif it['ty'] == 'sh':
            k = it['ks']
            v = k['k'][0]['s'][0] if k.get('a') == 1 else k['k']
            out.append((path + (i,), v, m))


def frog_shape(layer_name, path):
    for ind, l in L.items():
        if l['nm'] == layer_name:
            out = []
            walk(l['shapes'], layer_mat(l), out)
            for p, v, m in out:
                if p == tuple(path) and 'v' in v:
                    return [tuple(S * (m @ np.array([*q, 1.]))[:2] + [OX, OY]) for q in v['v']], v.get('c')
    raise KeyError((layer_name, path))


# frog shape -> candidate template ids
SOURCES = [
    ('body', (7, 0), ['body'], 'frog body silhouette (head+torso, 9 vtx, closed); (1,0) is identical, (3,0) is its outline copy'),
    ('body', (5, 0), ['belly', 'belly_under', 'body'], 'belly/underside shape (4 vtx)'),
    ('body', (2, 0, 1, 0), ['jaw'], 'chin shadow (3 vtx)'),
    ('rarm', (0, 0), ['leg_front_near', 'paw_front_near'], 'near front leg+paw outline (open, 9 vtx: down the left edge, toes, up the right edge)'),
    ('larm', (0, 0), ['foot_front_far', 'toe_far_1', 'toe_far_2'], 'far front leg+foot outline (open, 9 vtx)'),
    ('rfeet', (1, 0), ['hind_leg', 'hind_toes'], 'hind leg/foot outline (open, 7 vtx) - this is the layer the frog waves with (anchor 464.06,338.89)'),
    ('rfeet', (2, 0), ['hind_leg', 'hind_toes'], 'hind foot toe line (open, 5 vtx)'),
    ('eyer', (1, 0), ['eye_near_outer', 'eye_near_ring'], 'near eye big disc (4 vtx circle, r=124 frog-px*2.92/2.92)'),
    ('eyer', (0, 0), ['eye_near_iris', 'eye_near_ring'], 'near eye small disc (4 vtx circle) = pupil'),
    ('kiss', (1, 0), ['kiss_upper'], 'upper kiss print (7 vtx closed)'),
    ('kiss', (0, 0), ['kiss_lower'], 'lower kiss print (6 vtx closed)'),
]


def build(parts):
    """parts: template PARTS list with 'pts' (anchor lists) or None for ellipses (we parse d)."""
    import re
    anchors = {}
    for p in parts:
        nums = [float(x) for x in re.findall(r'-?\d+\.?\d*', p['d'].replace('M', ' ').replace('C', ' ').replace('Z', ' '))]
        # anchors = every 6th pair end: first pair after M, then each 3rd pair
        pts = [(nums[0], nums[1])] + [(nums[2 + 6 * k + 4], nums[2 + 6 * k + 5]) for k in range((len(nums) - 2) // 6)]
        if p['closed']:
            pts = pts[:-1]
        assert len(pts) == p['n'], (p['id'], len(pts), p['n'])
        anchors[p['id']] = pts
    res = []
    for lname, path, cands, note in SOURCES:
        verts, closed = frog_shape(lname, path)
        used = set()
        entries = []
        pairs = sorted(((math.hypot(v[0] - a[0], v[1] - a[1]), k, cid, j)
                        for k, v in enumerate(verts) for cid in cands for j, a in enumerate(anchors[cid])))
        done = {}
        for d, k, cid, j in pairs:
            if k in done or (cid, j) in used:
                continue
            done[k] = (cid, j + 1, round(d, 1))
            used.add((cid, j))
        res.append(dict(frog_layer=lname, frog_shape=list(path), note=note, closed=bool(closed), vertices=[
            dict(vertex=k + 1, frog_k0_xy=[round(verts[k][0], 1), round(verts[k][1], 1)], template_id=done[k][0], anchor=done[k][1], dist_px=done[k][2])
            for k in range(len(verts))]))
    return res


def main():
    import build_template as T
    r = build(T.PARTS)
    json.dump(r, open(os.path.join(HERE, 'frog_map.json'), 'w'), indent=1)
    for e in r:
        print(e['frog_layer'], e['frog_shape'], [(v['template_id'], v['anchor'], v['dist_px']) for v in e['vertices']])


def export_svg(out_path):
    """All frog shapes (except the orb* particle layers) in K0 pixel space -> frog_in_k0.svg (reference overlay)."""
    cols = ['#ff4040', '#40ff40', '#4080ff', '#ffff00', '#ff40ff', '#40ffff', '#ff9000', '#a0ff00']
    lines = ['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1609" viewBox="0 0 2000 1609">']
    ci = 0
    for ind, l in L.items():
        if l['ty'] != 4 or l['nm'].startswith('orb'):
            continue
        out = []
        walk(l['shapes'], layer_mat(l), out)
        for p, v, m in out:
            T = lambda q: tuple(S * (m @ np.array([q[0], q[1], 1.]))[:2] + [OX, OY])
            col = cols[ci % len(cols)]
            ci += 1
            pid = f"frog_{l['nm']}_{'-'.join(map(str, p))}".replace(' ', '_')
            if 'ellipse' in v:
                (cx, cy), (sx, sy) = v['ellipse'][0][:2], v['ellipse'][1][:2]
                k = 0.5523
                pts = [(cx, cy - sy / 2), (cx + sx / 2, cy), (cx, cy + sy / 2), (cx - sx / 2, cy)]
                hs = [((k * sx / 2, 0), (-k * sx / 2, 0)), ((0, k * sy / 2), (0, -k * sy / 2)), ((-k * sx / 2, 0), (k * sx / 2, 0)), ((0, -k * sy / 2), (0, k * sy / 2))]
                d = 'M %.1f %.1f' % T(pts[0])
                for a in range(4):
                    b = (a + 1) % 4
                    c1 = T((pts[a][0] + hs[a][0][0], pts[a][1] + hs[a][0][1]))
                    c2 = T((pts[b][0] + hs[b][1][0], pts[b][1] + hs[b][1][1]))
                    d += ' C %.1f %.1f %.1f %.1f %.1f %.1f' % (c1 + c2 + T(pts[b]))
                d += ' Z'
            else:
                n = len(v['v'])
                A = [np.array(q) for q in v['v']]
                d = 'M %.1f %.1f' % T(A[0])
                for a in range(n if v.get('c') else n - 1):
                    b = (a + 1) % n
                    c1 = T(A[a] + np.array(v['o'][a]))
                    c2 = T(A[b] + np.array(v['i'][b]))
                    d += ' C %.1f %.1f %.1f %.1f %.1f %.1f' % (c1 + c2 + T(A[b]))
                if v.get('c'):
                    d += ' Z'
            lines.append(f'  <path id="{pid}" d="{d}" fill="none" stroke="{col}" stroke-width="3"/>')
    lines.append('</svg>')
    open(out_path, 'w').write('\n'.join(lines) + '\n')


def rfeet_pivot():
    l = [l for l in L.values() if l['nm'] == 'rfeet'][0]
    a = val(l['ks']['a'])
    q = layer_mat(l) @ np.array([a[0], a[1], 1.])
    return (S * q[0] + OX, S * q[1] + OY), a


if __name__ == '__main__':
    main()
    export_svg(os.path.join(HERE, 'frog_in_k0.svg'))
    print('rfeet pivot (K0 px), layer-space anchor:', rfeet_pivot())
