"""Keep the mouth parts of a frame on one painted line (closed-mouth poses) without changing any point count.

mouth_line is the master (it is fitted to the painted mouth line); head's lip edge (A26-A37, reversed),
jaw's top edge (A1-A12), the parked cavity/tongue and the parked teeth are re-derived from it.
"""
import numpy as np


class Nodes:
    """anchor / in-handle / out-handle view of a path (arrays are copies; call put() to write back)"""
    def __init__(self, path):
        self.path = path
        self.segs = [ps for c, ps in path.cmds if c == 'C']
        self.m = path.cmds[0][1][0]
        self.n = len(path.anchors())
        n, S = self.n, self.segs
        self.pos = np.array([self.m if i == 0 else S[i - 1][2] for i in range(n)], float)
        self.out = np.array([S[i][0] if i < len(S) else self.pos[i] for i in range(n)], float)
        self.inn = np.array([S[i - 1][1] if i >= 1 else (S[-1][1] if path.closed else self.pos[0]) for i in range(n)], float)

    def put(self):
        n, S, p = self.n, self.segs, self.path
        for i in range(n):
            if i < len(S):
                S[i][0][:] = self.out[i]
            if i >= 1:
                S[i - 1][1][:] = self.inn[i]
                S[i - 1][2][:] = self.pos[i]
            elif p.closed:
                S[-1][1][:] = self.inn[0]
        self.m[:] = self.pos[0]
        if p.closed:
            S[-1][2][:] = self.pos[0]


def _corner(nd, i, j):
    """make the handle at node i that points to node j a chord handle"""
    h = (nd.pos[j] - nd.pos[i]) / 3
    return nd.pos[i] + h


def sync_closed(P, P0, skip=()):
    ml = Nodes(P['mouth_line'])
    # head lip: head[25+j] <-> ml[11-j], handles swap
    h = Nodes(P['head'])
    for j in range(12):
        a, m = 25 + j, 11 - j
        d = ml.pos[m] - h.pos[a]
        if j == 0:
            h.inn[a] += d
        else:
            h.inn[a] = ml.out[m]
        if j == 11:
            h.out[a] += d
        else:
            h.out[a] = ml.inn[m]
        h.pos[a] = ml.pos[m]
    h.put()
    # jaw top edge
    jw = Nodes(P['jaw'])
    for i in range(12):
        d = ml.pos[i] - jw.pos[i]
        jw.inn[i] = jw.inn[i] + d if i == 0 else ml.inn[i]
        jw.out[i] = jw.out[i] + d if i == 11 else ml.out[i]
        jw.pos[i] = ml.pos[i]
    jw.put()
    # cavity: top = ml-1, bottom = ml+1 reversed
    c = Nodes(P['mouth_cavity'])
    up, dn = np.array([0, -1.0]), np.array([0, 1.0])
    for i in range(12):
        c.pos[i] = ml.pos[i] + up; c.inn[i] = ml.inn[i] + up; c.out[i] = ml.out[i] + up
    for k in range(10):               # A13..A22 = ml[10..1]
        m = 10 - k
        c.pos[12 + k] = ml.pos[m] + dn; c.inn[12 + k] = ml.out[m] + dn; c.out[12 + k] = ml.inn[m] + dn
    c.inn[0] = _corner(c, 0, 21); c.out[11] = _corner(c, 11, 12); c.inn[12] = _corner(c, 12, 11); c.out[21] = _corner(c, 21, 0)
    c.put()
    # tongue: top A1-A6 = ml[3..8], bottom A7-A10 = ml[7..4]+1
    t = Nodes(P['tongue'])
    for k in range(6):
        m = 3 + k
        t.pos[k] = ml.pos[m] + up; t.inn[k] = ml.inn[m] + up; t.out[k] = ml.out[m] + up
    for k in range(4):
        m = 7 - k
        t.pos[6 + k] = ml.pos[m] + dn; t.inn[6 + k] = ml.out[m] + dn; t.out[6 + k] = ml.inn[m] + dn
    t.inn[0] = _corner(t, 0, 9); t.out[5] = _corner(t, 5, 6); t.inn[6] = _corner(t, 6, 5); t.out[9] = _corner(t, 9, 0)
    t.put()
    # parked teeth: K0 triangle translated by how far its mouth_line anchor moved
    ml0 = Nodes(P0['mouth_line']).pos
    for pid in ('teeth_upper_2', 'teeth_upper_3', 'teeth_lower_1', 'teeth_lower_2', 'teeth_lower_3'):
        if pid in skip:
            continue
        src = Nodes(P0[pid]); dst = Nodes(P[pid])
        i = int(np.argmin(np.linalg.norm(ml0 - src.pos.mean(0), axis=1)))
        d = ml.pos[i] - ml0[i]
        dst.pos[:] = src.pos + d; dst.inn[:] = src.inn + d; dst.out[:] = src.out + d
        dst.put()


def open_cavity(P, keys, corner=5):
    """place the cavity anchors on the key polyline: A1..A12 evenly along the upper lip (A12 = mouth corner),
    A13..A22 evenly along the lower lip back to the snout end (corner anchors A1/A12 sharp)."""
    import warp
    keys = np.asarray(keys, float)
    def sample(pts, k, ends):
        d = warp._catmull(pts, False, 600)
        L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(d, axis=0), axis=1))])
        s = np.linspace(0, L[-1], k + 2 * (not ends))
        s = s if ends else s[1:-1]
        return np.array([np.interp(s, L, d[:, 0]), np.interp(s, L, d[:, 1])]).T
    up = sample(keys[:corner + 1], 12, True)
    lo = sample(np.vstack([keys[corner:], keys[:1]]), 10, False)
    pos = np.vstack([up, lo])
    c = Nodes(P["mouth_cavity"])
    n = len(pos)
    c.pos[:] = pos
    for i in range(n):
        t = (pos[(i + 1) % n] - pos[i - 1]) / 6
        c.inn[i] = pos[i] - t; c.out[i] = pos[i] + t
    for i, j in ((0, 21), (0, 1), (11, 10), (11, 12)):
        pass
    c.inn[0] = _corner(c, 0, 21); c.out[0] = _corner(c, 0, 1)
    c.inn[11] = _corner(c, 11, 10); c.out[11] = _corner(c, 11, 12)
    c.put()


def sync_open(P, keys=None):
    """open mouth: cavity A1-A12 (upper lip) is the master -> mouth_line and head's lip edge follow it;
    jaw's top edge (A1-A12) follows the cavity's lower lip (A13-A22 reversed); jaw corner edge A13-A15 is interpolated."""
    if keys is not None:
        open_cavity(P, keys)
    cv = Nodes(P['mouth_cavity'])
    ml = Nodes(P['mouth_line'])
    ml.pos[:] = cv.pos[:12]; ml.inn[:] = cv.inn[:12]; ml.out[:] = cv.out[:12]
    ml.put()
    h = Nodes(P['head'])
    for j in range(12):
        a, m = 25 + j, 11 - j
        d = cv.pos[m] - h.pos[a]
        h.inn[a] = h.inn[a] + d if j == 0 else cv.out[m]
        h.out[a] = h.out[a] + d if j == 11 else cv.inn[m]
        h.pos[a] = cv.pos[m]
    h.put()
    jw = Nodes(P['jaw'])
    src = [0] + list(range(21, 11, -1)) + [11]          # jaw[i] <- cavity[src[i]]
    for i, s in enumerate(src):
        rev = s >= 12                                    # bottom edge runs the other way
        d = cv.pos[s] - jw.pos[i]
        if rev:
            ni, no = cv.out[s], cv.inn[s]
        else:
            ni, no = cv.inn[s], cv.out[s]
        jw.inn[i] = jw.inn[i] + d if i == 0 else ni
        jw.out[i] = jw.out[i] + d if i == 11 else no
        jw.pos[i] = cv.pos[s]
    for k in (12, 13, 14, 15):
        u = (k - 11) / 5.0
        jw.pos[k] = jw.pos[11] * (1 - u) + jw.pos[16] * u
    for k in (12, 13, 14, 15):
        t = (jw.pos[k + 1] - jw.pos[k - 1]) / 6
        jw.inn[k] = jw.pos[k] - t; jw.out[k] = jw.pos[k] + t
    jw.out[11] = jw.pos[11] + (jw.pos[12] - jw.pos[11]) / 3
    jw.inn[16] = jw.pos[16] - (jw.pos[16] - jw.pos[15]) / 3
    jw.put()


def place(path, pts, smooth=()):
    """move anchors (1-based index -> (x, y)); handles of the moved anchors and their neighbours are re-derived
    from neighbouring anchors (Catmull tangents) unless the anchor is listed in `smooth`'s complement corners."""
    nd = Nodes(path)
    n = nd.n
    for a, p in pts.items():
        nd.pos[a - 1] = p
    touched = set()
    for a in pts:
        for d in (-1, 0, 1):
            touched.add((a - 1 + d) % n if path.closed else min(max(a - 1 + d, 0), n - 1))
    for i in touched:
        if not path.closed and i in (0, n - 1):
            if i == 0:
                nd.out[0] = nd.pos[0] + (nd.pos[1] - nd.pos[0]) / 3
            else:
                nd.inn[n - 1] = nd.pos[n - 1] - (nd.pos[n - 1] - nd.pos[n - 2]) / 3
            continue
        t = (nd.pos[(i + 1) % n] - nd.pos[i - 1]) / 6
        nd.inn[i] = nd.pos[i] - t; nd.out[i] = nd.pos[i] + t
    nd.put()


def similarity(path, src2, dst2):
    """move every point of `path` by the similarity (rotation+scale+shift) taking the two points src2 onto dst2"""
    (a, b), (c, d) = [np.asarray(p, float) for p in src2], [np.asarray(p, float) for p in dst2]
    zs, zd = complex(*(b - a)), complex(*(d - c))
    k = zd / zs
    for _, ps in path.cmds:
        for pt in ps:
            z = k * complex(pt[0] - a[0], pt[1] - a[1])
            pt[0], pt[1] = c[0] + z.real, c[1] + z.imag
