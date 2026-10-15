"""Готовит ассеты Frog Swing из исходников Nano Banana (game/swing/*.jpe, пурпурный фон).
Ленты (ветка, лес) делаются бесшовными: правый край плавно перетекает в левый.
Запуск:  python tools/cut_swing_assets.py
"""
import os
import numpy as np
from PIL import Image
import cut_jump_assets as J

HERE = os.path.dirname(os.path.abspath(__file__))
J.SRC = os.path.join(HERE, '..', 'swing')

def key_pure_magenta(img, lo, hi):
    # у ленты леса по краям не фон, а сам лес — фон задаём явно чистым пурпуром
    bg = np.array([255., 0., 255.])
    k = np.minimum(img[..., 0], img[..., 2]) - img[..., 1]
    t = k / 255.
    return 1 - np.clip((t - lo) / (hi - lo), 0, 1), bg

def strip(name, target_h, overlap=0.16, lo=0.28, hi=0.62, keep=1.0, pure=False):
    img = J.load(name)
    img = img[:, :int(img.shape[1] * keep)]             # отрезаем край, который не повторяется
    a, bg = key_pure_magenta(img, lo, hi) if pure else J.key_magenta(img, lo, hi)
    a = np.where(a < 0.04, 0, a)
    f = J.unmix(img, a, bg)
    ys = np.where(a.max(axis=1) > 0.06)[0]
    f, a = f[ys.min():ys.max() + 1], a[ys.min():ys.max() + 1]
    h, w = a.shape; ov = int(w * overlap)
    rgba = np.dstack([f * a[..., None], a])            # смешиваем в премультиплицированном виде
    base = rgba[:, :w - ov].copy()
    ramp = np.linspace(0, 1, ov)[None, :, None]
    base[:, :ov] = rgba[:, :ov] * ramp + rgba[:, w - ov:] * (1 - ramp)
    al = base[..., 3:4]; col = np.where(al > 1e-3, base[..., :3] / np.maximum(al, 1e-3), 0)
    out = np.dstack([np.clip(col, 0, 255), al * 255]).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA'); s = target_h / im.height
    im = im.resize((round(im.width * s), target_h), Image.LANCZOS)
    p = os.path.join(J.SRC, name + '.png'); im.save(p, optimize=True)
    print(f'{name:10} {im.size[0]}x{im.size[1]}  {os.path.getsize(p) // 1024} КБ')

if __name__ == '__main__':
    if J.exists('branch'): strip('branch', 120, keep=0.8)
    if J.exists('forest'): strip('forest', 300, lo=0.1, hi=0.32, pure=True)
    for n in ('thorns', 'front'):
        if J.exists(n): strip(n, 160)
    if J.exists('leaves'):
        img = J.load('leaves'); a, bg = J.key_magenta(img); J.finish('leaves', img, a, bg, 220)
