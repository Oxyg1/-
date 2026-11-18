"""Extract painted regions (eye whites, iris, mouth cavity, tongue, teeth) as ordered contours."""
import numpy as np, cv2

_cache = {}


def load(frame):
    if frame not in _cache:
        bgr = cv2.imread(frame)
        rgb = bgr[..., ::-1].astype(float)
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(float)
        _cache[frame] = (rgb, hsv)
    return _cache[frame]


PRED = {
    'white':  lambda R, G, B, H, S, V: (V > 185) & (S < 70),
    'dark':   lambda R, G, B, H, S, V: (V < 75) & (R >= B - 5),
    'cavity': lambda R, G, B, H, S, V: (V < 110) & (R > B + 10) & (R > G + 15),
    'tongue': lambda R, G, B, H, S, V: (R > 190) & (G > 70) & (G < 160) & (B > 100) & (B < 190),
    'iris':   lambda R, G, B, H, S, V: (V < 120) & (S > 40),
}


def contour(frame, kind, roi, seed=None, open_px=3, close_px=3, n=64, min_area=60):
    rgb, hsv = load(frame)
    x0, y0, x1, y1 = roi
    R, G, B = (rgb[y0:y1, x0:x1, i] for i in range(3))
    H, S, V = (hsv[y0:y1, x0:x1, i] for i in range(3))
    m = PRED[kind](R, G, B, H, S, V).astype(np.uint8) * 255
    if open_px:
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * open_px + 1,) * 2))
    if close_px:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * close_px + 1,) * 2))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cs = [c for c in cs if cv2.contourArea(c) >= min_area]
    if not cs:
        return None
    if seed is not None:
        sx, sy = seed[0] - x0, seed[1] - y0
        inside = [c for c in cs if cv2.pointPolygonTest(c, (float(sx), float(sy)), False) >= 0]
        c = inside[0] if inside else min(cs, key=lambda c: abs(cv2.pointPolygonTest(c, (float(sx), float(sy)), True)))
    else:
        c = max(cs, key=cv2.contourArea)
    pts = c[:, 0, :].astype(float) + [x0, y0]
    # smooth + resample to n points
    k = max(1, len(pts) // 60)
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    sm = np.stack([np.convolve(np.r_[pts[-k:, i], pts[:, i], pts[:k, i]], ker, 'valid') for i in range(2)], 1)
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([sm, sm[:1]]), axis=0), axis=1))]
    s = np.linspace(0, L[-1], n, endpoint=False)
    closed = np.vstack([sm, sm[:1]])
    return np.stack([np.interp(s, L, closed[:, 0]), np.interp(s, L, closed[:, 1])], 1)


def debug(frame, contours, out, crop=None):
    img = cv2.imread(frame)
    for i, c in enumerate(contours):
        if c is None: continue
        col = [(0, 255, 255), (255, 0, 255), (0, 255, 0), (255, 128, 0), (0, 128, 255), (255, 255, 255)][i % 6]
        cv2.polylines(img, [c.astype(np.int32)], True, col, 3)
    if crop:
        x0, y0, x1, y1 = crop
        img = img[y0:y1, x0:x1]
    cv2.imwrite(out, img)
