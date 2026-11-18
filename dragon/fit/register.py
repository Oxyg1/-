"""Rigid/similarity registration of a group of template paths onto a frame's outline ridge (ICP-like)."""
import numpy as np, snap


def group_samples(paths, ids, ns=16):
    pts, nrm = [], []
    ts = np.linspace(0.04, 0.96, ns)
    for pid in ids:
        for p0, c1, c2, p1 in snap.segments(paths[pid]):
            P = list(map(np.array, (p0, c1, c2, p1)))
            q = snap.bez(*P, ts); d = snap.bez_d(*P, ts)
            n = np.stack([-d[:, 1], d[:, 0]], 1); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
            pts.append(q); nrm.append(n)
    return np.concatenate(pts), np.concatenate(nrm)


def fit_similarity(src, dst, w, allow_scale=True):
    w = w / (w.sum() + 1e-9)
    ms, md = (src * w[:, None]).sum(0), (dst * w[:, None]).sum(0)
    a, b = src - ms, dst - md
    H = (a * w[:, None]).T @ b
    U, S, Vt = np.linalg.svd(H)
    R = (U @ Vt).T
    if np.linalg.det(R) < 0:
        Vt[-1] *= -1; R = (U @ Vt).T
    s = (S.sum() / ((a * a * w[:, None]).sum() + 1e-9)) if allow_scale else 1.0
    s = float(np.clip(s, 0.85, 1.15))
    t = md - s * R @ ms
    return s, R, t


def apply(paths, ids, s, R, t):
    for pid in ids:
        for _, ps in paths[pid].cmds:
            for pt in ps:
                v = s * R @ np.array(pt) + t
                pt[0], pt[1] = v


def register(paths, ids, F, radii=(90, 60, 40, 25), thresh=0.3, allow_scale=True, carry=()):
    """Move `ids` (and `carry`, which follow without voting) by an iterated similarity fit."""
    total = []
    for r in radii:
        for _ in range(3):
            pts, n = group_samples(paths, ids)
            steps = np.linspace(-r, r, int(r) + 1)
            cand = pts[:, None, :] + n[:, None, :] * steps[None, :, None]
            val = snap.sample_field(F, cand.reshape(-1, 2)).reshape(len(pts), len(steps))
            score = val - 0.25 * np.abs(steps)[None, :] / r
            k = score.argmax(1)
            conf = (val[np.arange(len(pts)), k] > thresh).astype(float)
            dst = pts + n * steps[k][:, None]
            if conf.sum() < 10:
                continue
            s, R, t = fit_similarity(pts, dst, conf, allow_scale)
            apply(paths, list(ids) + list(carry), s, R, t)
            total.append((s, np.degrees(np.arctan2(R[1, 0], R[0, 0])), t))
    return total
