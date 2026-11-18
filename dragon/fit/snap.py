"""Snap template contours onto the painted outline of a storyboard frame.

For each path: sample the bezier densely, search along the normal for the outline ridge (prior toward
no move), move anchors by the smoothed average of their samples' offsets, then refit each segment's
handles by regularised least squares to the moved samples. A few rounds with a shrinking radius.
"""
import numpy as np


def bez(p0, c1, c2, p1, t):
    t = t[:, None]
    u = 1 - t
    return u**3 * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t**3 * p1


def bez_d(p0, c1, c2, p1, t):
    t = t[:, None]
    u = 1 - t
    return 3 * u * u * (c1 - p0) + 6 * u * t * (c2 - c1) + 3 * t * t * (p1 - c2)


def sample_field(F, pts):
    h, w = F.shape
    x = np.clip(pts[:, 0], 0, w - 1.001); y = np.clip(pts[:, 1], 0, h - 1.001)
    x0 = x.astype(int); y0 = y.astype(int); fx = x - x0; fy = y - y0
    return (F[y0, x0] * (1 - fx) * (1 - fy) + F[y0, x0 + 1] * fx * (1 - fy) +
            F[y0 + 1, x0] * (1 - fx) * fy + F[y0 + 1, x0 + 1] * fx * fy)


def segments(path):
    segs, prev = [], path.cmds[0][1][0]
    for c, ps in path.cmds[1:]:
        if c == 'C':
            segs.append((prev, ps[0], ps[1], ps[2]))
            prev = ps[2]
    return segs


def snap_path(path, F, radius, thresh=0.25, prior=0.35, ns=14, lam=0.15):
    segs = segments(path)
    if not segs:
        return 0.0
    ts = np.linspace(0.04, 0.96, ns)
    offsets = []      # per segment: (ns,2) target displacement, (ns,) confidence
    steps = np.linspace(-radius, radius, int(2 * radius) + 1)
    for p0, c1, c2, p1 in segs:
        P0, C1, C2, P1 = map(np.array, (p0, c1, c2, p1))
        pts = bez(P0, C1, C2, P1, ts)
        der = bez_d(P0, C1, C2, P1, ts)
        n = np.stack([-der[:, 1], der[:, 0]], 1)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        cand = pts[:, None, :] + n[:, None, :] * steps[None, :, None]
        val = sample_field(F, cand.reshape(-1, 2)).reshape(len(ts), len(steps))
        score = val - prior * np.abs(steps)[None, :] / radius
        k = score.argmax(1)
        conf = (val[np.arange(len(ts)), k] > thresh).astype(float)
        disp = n * steps[k][:, None] * conf[:, None]
        offsets.append((pts, disp, conf))
    # anchor displacement = mean of nearby sample displacements (end of prev seg + start of next seg)
    anchors = path.anchors()
    nA = len(anchors)
    # map: segment i goes from anchor i to anchor i+1 (mod nA when closed and merged)
    A = np.zeros((nA, 2)); W = np.zeros(nA)
    for i, (pts, disp, conf) in enumerate(offsets):
        a0, a1 = i % nA, (i + 1) % nA
        w0 = (1 - ts) ** 2 * conf; w1 = ts ** 2 * conf
        A[a0] += (disp * w0[:, None]).sum(0); W[a0] += w0.sum()
        if i + 1 < nA or path.closed:
            A[a1] += (disp * w1[:, None]).sum(0); W[a1] += w1.sum()
    D = np.where(W[:, None] > 1e-6, A / np.maximum(W, 1e-6)[:, None], 0.0)
    # smooth (closed: circular; open: ends free)
    for _ in range(2):
        Dn = D.copy()
        for i in range(nA):
            nb = [j for j in (i - 1, i + 1) if path.closed or 0 <= j < nA]
            nb = [j % nA for j in nb]
            Dn[i] = 0.6 * D[i] + 0.4 * np.mean([D[j] for j in nb], 0) if nb else D[i]
        D = Dn
    for (a, hs), d in zip(anchors, D):
        for ref in [a] + hs:
            ref[0] += d[0]; ref[1] += d[1]
    # refit handles of each segment to the moved samples
    segs = segments(path)
    cmd_segs = [ps for c, ps in path.cmds if c == 'C']
    B = lambda t: np.stack([(1 - t)**3, 3 * (1 - t)**2 * t, 3 * (1 - t) * t * t, t**3], 1)
    for (pts, disp, conf), (p0, c1, c2, p1), ps in zip(offsets, segs, cmd_segs):
        if conf.sum() < ns * 0.5:
            continue
        tgt = pts + disp
        M = B(ts)
        P0, P1 = np.array(p0), np.array(p1)
        rhs = tgt - np.outer(M[:, 0], P0) - np.outer(M[:, 3], P1)
        G = M[:, 1:3]
        reg = lam * len(ts)
        cur = np.array([c1, c2])
        sol = np.linalg.solve(G.T @ (G * conf[:, None]) + reg * np.eye(2),
                              (G * conf[:, None]).T @ rhs + reg * cur)
        ps[0][0], ps[0][1] = sol[0]
        ps[1][0], ps[1][1] = sol[1]
    return float(np.abs(D).mean())


def snap(paths, ids, F, radii=(36, 22, 12, 8)):
    report = {}
    for r in radii:
        for pid in ids:
            report[pid] = snap_path(paths[pid], F, r)
    return report
