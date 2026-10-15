"""Готовит ассеты Frog Swing из исходников Nano Banana (game/swing/*.jpe).

Почти всё нарисовано на пурпурном фоне. Исключения:
• snag — на белом: фон снимаем заливкой от краёв, чтобы не съесть белые блики внутри;
• water — сплошная полоса на белом поле: берём только ряды воды;
• dewdrop — пурпурный квадрат внутри белой рамки: сначала обрезаем по квадрату.
Ленты (ветка, лес, колючки, трава, вода) делаются бесшовными: правый край плавно
перетекает в левый.

Запуск:  python tools/cut_swing_assets.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage
import cut_jump_assets as J

HERE = os.path.dirname(os.path.abspath(__file__))
J.SRC = os.path.join(HERE, '..', 'swing')
SRC = J.SRC

def key_pure_magenta(img, lo, hi):
    # у ленты леса по краям не фон, а сам лес — фон задаём явно чистым пурпуром
    bg = np.array([255., 0., 255.])
    k = np.minimum(img[..., 0], img[..., 2]) - img[..., 1]
    return 1 - np.clip((k / 255. - lo) / (hi - lo), 0, 1), bg

def period(f, a):
    # ищем сдвиг, на котором картинка совпадает сама с собой
    # кандидатов ищем по профилю столбцов (быстро), проверяем по всей картинке
    w = a.shape[1]
    g = np.dstack([f * a[..., None] / 255, a])[::6]                 # каждый 6-й ряд хватает
    prof = g.reshape(g.shape[0] * 0 + g.shape[0], w, 4).transpose(1, 0, 2).reshape(w, -1)
    cand = []
    for p in range(int(w * .3), int(w * .75)):
        cand.append((np.abs(prof[:w - p] - prof[p:]).mean(), p))
    cand.sort()
    best, bp = min((np.abs(g[:, :w - p] - g[:, p:]).mean(), p) for _, p in cand[:5])
    print(f'   период {bp}/{w}  расхождение {best:.3f}')
    return bp if best < .035 else 0

def seamless(f, a, overlap):
    h, w = a.shape; ov = int(w * overlap)
    rgba = np.dstack([f * a[..., None], a])            # смешиваем в премультиплицированном виде
    base = rgba[:, :w - ov].copy()
    ramp = np.linspace(0, 1, ov)[None, :, None]
    base[:, :ov] = rgba[:, :ov] * ramp + rgba[:, w - ov:] * (1 - ramp)
    al = base[..., 3:4]; col = np.where(al > 1e-3, base[..., :3] / np.maximum(al, 1e-3), 0)
    return col, al[..., 0]

def save(name, f, a, target_h=None, target_w=None, pad=0):
    out = np.dstack([np.clip(f, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    s = target_h / im.height if target_h else target_w / im.width
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    if pad:
        o = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0)); o.paste(im, (pad, pad)); im = o
    p = os.path.join(SRC, name + '.png'); im.save(p)
    print(f'{name:10} {im.size[0]}x{im.size[1]}  {os.path.getsize(p) // 1024} KB')

def trim(f, a, rows=True, cols=True):
    ys, xs = np.where(a > 0.06)
    y0, y1 = (ys.min(), ys.max() + 1) if rows else (0, a.shape[0])
    x0, x1 = (xs.min(), xs.max() + 1) if cols else (0, a.shape[1])
    return f[y0:y1, x0:x1], a[y0:y1, x0:x1]

def strip(name, target_h, overlap=0.16, lo=0.28, hi=0.62, keep=1.0, pure=False):
    img = J.load(name)
    img = img[:, :int(img.shape[1] * keep)]             # отрезаем край, который не повторяется
    a, bg = key_pure_magenta(img, lo, hi) if pure else J.key_magenta(img, lo, hi)
    a = np.where(a < 0.04, 0, a)
    f, a = trim(J.unmix(img, a, bg), a, cols=False)
    p = period(f, a)
    if p: f, a = f[:, :p], a[:, :p]                    # узор уже повторяется — берём ровно один период
    else: f, a = seamless(f, a, overlap)
    save(name, f, a, target_h=target_h)

def sprite(name, target, box='w', img=None, lo=0.28, hi=0.62):
    img = J.load(name) if img is None else img
    a, bg = J.key_magenta(img, lo, hi)
    a = np.where(a < 0.04, 0, a)
    f, a = trim(J.unmix(img, a, bg), a)
    save(name, f, a, target_w=target if box == 'w' else None, target_h=target if box == 'h' else None, pad=4)

def snag(name, target_h):
    img = J.load(name)
    # белый фон — только то, что связано с краем картинки
    near = np.linalg.norm(img - 255, axis=2) < 40
    lab, _ = ndimage.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgm = np.isin(lab, list(edge))
    a = 1 - ndimage.gaussian_filter(bgm.astype(float), 1.0)
    a = np.where(bgm & (a < .5), 0, a)
    img = img[:int(img.shape[0] * .86)]; a = a[:img.shape[0]]   # лужу внизу срезаем — коряга уходит в нашу воду
    f, a = trim(img, a)
    save(name, f, a, target_h=target_h, pad=4)

def water(name, target_h):
    img = J.load(name)
    solid = (np.linalg.norm(img - 255, axis=2) > 30).mean(axis=1) > .985
    ys = np.where(solid)[0]
    img = img[ys.min() + 2:ys.max() - 2]
    f, a = seamless(img, np.ones(img.shape[:2]), 0.16)
    save(name, f, a, target_h=target_h)

def dewdrop(name, target):
    img = J.load(name)
    mag = (np.minimum(img[..., 0], img[..., 2]) - img[..., 1]) > 150
    ys, xs = np.where(mag)
    sprite(name, target, img=img[ys.min() + 6:ys.max() - 6, xs.min() + 6:xs.max() - 6])

if __name__ == '__main__':
    if J.exists('branch'): strip('branch', 120, keep=0.8)
    if J.exists('forest'): strip('forest', 300, lo=0.1, hi=0.32, pure=True)
    if J.exists('thorns'): strip('thorns', 110)
    if J.exists('front'): strip('front', 160)
    if J.exists('water'): water('water', 160)
    if J.exists('leaves'): sprite('leaves', 220)
    if J.exists('roots'): sprite('roots', 640, box='h')
    if J.exists('snag'): snag('snag', 640)
    if J.exists('owl'): sprite('owl', 300)
    if J.exists('mushroom'): sprite('mushroom', 220)
    if J.exists('firefly'): sprite('firefly', 200)
    if J.exists('dewdrop'): dewdrop('dewdrop', 140)
    if J.exists('gnat'): sprite('gnat', 96)
