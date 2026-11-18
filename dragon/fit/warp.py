"""Thin-plate-spline warp of template paths, and procedural re-shaping of a path from key points."""
import numpy as np


class TPS:
    def __init__(self, src, dst, reg=1e-3):
        src, dst = np.asarray(src, float), np.asarray(dst, float)
        self.src = src
        n = len(src)
        K = self._k(np.linalg.norm(src[:, None] - src[None], axis=2))
        P = np.hstack([np.ones((n, 1)), src])
        A = np.zeros((n + 3, n + 3))
        A[:n, :n] = K + reg * np.eye(n) * K.mean()
        A[:n, n:] = P; A[n:, :n] = P.T
        b = np.zeros((n + 3, 2)); b[:n] = dst
        self.w = np.linalg.solve(A, b)

    @staticmethod
    def _k(r):
        with np.errstate(divide='ignore', invalid='ignore'):
            v = r * r * np.log(r)
        return np.nan_to_num(v)

    def __call__(self, pts):
        pts = np.atleast_2d(pts)
        K = self._k(np.linalg.norm(pts[:, None] - self.src[None], axis=2))
        n = len(self.src)
        return K @ self.w[:n] + self.w[n] + pts @ self.w[n + 1:]


def warp_paths(paths, ids, tps):
    for pid in ids:
        for _, ps in paths[pid].cmds:
            for pt in ps:
                pt[0], pt[1] = tps(np.array(pt))[0]


def _catmull(points, closed, samples=400):
    P = np.asarray(points, float)
    if closed:
        P = np.vstack([P[-1], P, P[0], P[1]])
    else:
        P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, samples // (len(P) - 3), endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-2])
    return np.array(out)


def reshape(path, key_points, start_near=None):
    """Replace a path's geometry by a smooth curve through key_points (same anchor count/order).
    Closed paths: rotation/direction chosen to best match the current anchors (keeps morph correspondence)."""
    anchors = path.anchors()
    n = len(anchors)
    cur = np.array([a for a, _ in anchors])
    dense = _catmull(key_points, path.closed)
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    L = np.concatenate([[0], np.cumsum(seg)])
    if path.closed:
        total = L[-1] + np.linalg.norm(dense[-1] - dense[0])
        best = None
        for direction in (1, -1):
            d = dense if direction == 1 else dense[::-1]
            sg = np.linalg.norm(np.diff(d, axis=0), axis=1); LL = np.concatenate([[0], np.cumsum(sg)])
            for shift in np.linspace(0, total, 72, endpoint=False):
                s = (shift + np.arange(n) * total / n) % total
                pts = np.array([np.interp(s, LL, d[:, 0]), np.interp(s, LL, d[:, 1])]).T
                # compare shape order (centred) to current anchors' order
                e = np.linalg.norm((pts - pts.mean(0)) / (np.ptp(pts, 0) + 1) - (cur - cur.mean(0)) / (np.ptp(cur, 0) + 1), axis=1).sum()
                if start_near is not None:
                    e = np.linalg.norm(pts[0] - np.asarray(start_near))
                if best is None or e < best[0]:
                    best = (e, pts)
        new = best[1]
    else:
        s = np.linspace(0, L[-1], n)
        new = np.array([np.interp(s, L, dense[:, 0]), np.interp(s, L, dense[:, 1])]).T
    # handles: tangent from neighbours, length 1/3 of segment
    m = len(new)
    for i, (a, hs) in enumerate(anchors):
        a[0], a[1] = new[i]
    # rebuild control points segment by segment
    segs = [ps for c, ps in path.cmds if c == 'C']
    def tangent(i):
        if path.closed:
            return (new[(i + 1) % m] - new[(i - 1) % m]) / 2
        if i == 0: return new[1] - new[0]
        if i == m - 1: return new[-1] - new[-2]
        return (new[i + 1] - new[i - 1]) / 2
    for k, ps in enumerate(segs):
        i0, i1 = k % m, (k + 1) % m
        p0, p1 = new[i0], new[i1]
        ps[0][0], ps[0][1] = p0 + tangent(i0) / 3
        ps[1][0], ps[1][1] = p1 - tangent(i1) / 3
        ps[2][0], ps[2][1] = p1
    m0 = path.cmds[0][1][0]
    m0[0], m0[1] = new[0]


def ellipse_pts(cx, cy, rx, ry, rot=0, k=12, start_deg=180):
    a = np.radians(start_deg) + np.linspace(0, 2 * np.pi, k, endpoint=False)
    c, s = np.cos(np.radians(rot)), np.sin(np.radians(rot))
    x, y = rx * np.cos(a), ry * np.sin(a)
    return np.stack([cx + c * x - s * y, cy + s * x + c * y], 1)
