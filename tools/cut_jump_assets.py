"""Готовит ассеты Frog Jump из исходников Nano Banana.

Исходники: game/jump/*.jpe (JPEG без прозрачности, однотонный фон).
Результат: game/jump/*.png — прозрачный фон, обрезанные поля, игровой размер.

Фон вырезается не по точному цвету, а по «похожести на цвет фона» — у части
картинок фон неровный (приглушённая магента со светлым ореолом вокруг предмета).
Цвет полупрозрачного края восстанавливается из уравнения смешивания
C = a*F + (1-a)*B, поэтому розовой или зелёной каймы на границе не остаётся.

Запуск:  python tools/cut_jump_assets.py
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'jump')

def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name + '.jpe')).convert('RGB')).astype(np.float32)

def border_bg(img):
    b = np.concatenate([img[:8].reshape(-1, 3), img[-8:].reshape(-1, 3), img[:, :8].reshape(-1, 3), img[:, -8:].reshape(-1, 3)])
    return np.median(b, axis=0)

def unmix(img, a, bg):
    """Цвет переднего плана из смеси с фоном: F = (C - (1-a)B) / a."""
    a3 = np.clip(a, 1e-3, 1)[..., None]
    f = (img - (1 - a3) * bg) / a3
    return np.clip(f, 0, 255)

def key_magenta(img, lo=0.28, hi=0.62):
    # «пурпурность» — сколько у пикселя одновременно красного И синего сверх зелёного.
    # min(r,b) а не среднее: у красных глаз мошки синего нет, и их не должно съесть
    bg = border_bg(img)
    k = np.minimum(img[..., 0], img[..., 2]) - img[..., 1]
    kb = min(bg[0], bg[2]) - bg[1]
    t = k / kb
    a = 1 - np.clip((t - lo) / (hi - lo), 0, 1)
    return a, bg

def key_green(img, lo=0.25, hi=0.6):
    bg = border_bg(img)
    k = img[..., 1] - np.maximum(img[..., 0], img[..., 2])
    kb = bg[1] - max(bg[0], bg[2])
    t = k / kb
    a = 1 - np.clip((t - lo) / (hi - lo), 0, 1)
    return a, bg

def key_black(img, lo=10, hi=200):
    # белое на чёрном: прозрачность — это яркость, сам цвет — «до затемнения»
    m = img.max(axis=2)
    a = np.clip((m - lo) / (hi - lo), 0, 1)
    return a, np.array([0., 0., 0.])

def finish(name, img, a, bg, target, pad=6, box='w', clean=0.04, unmix_bg=True):
    a = np.where(a < clean, 0, a)
    f = unmix(img, a, bg) if unmix_bg else np.clip(img, 0, 255)
    ys, xs = np.where(a > 0.06)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([f, a * 255]).astype(np.uint8)[y0:y1, x0:x1]
    im = Image.fromarray(rgba, 'RGBA')
    w, h = im.size
    s = target / (w if box == 'w' else h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    out = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    out.paste(im, (pad, pad))
    p = os.path.join(SRC, name + '.png')
    out.save(p, optimize=True)
    print(f'{name:12} {out.size[0]}x{out.size[1]}  {os.path.getsize(p) // 1024} КБ')
    return out

def green_body(name, target, box='h'):
    # Пружина — зелёная с тёмным контуром, а ореол вокруг неё светлый розово-бежевый.
    # Вместо «похожести на фон» оставляем только то, что зелёное или тёмное
    img = load(name)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    ramp = lambda v, a0, a1: np.clip((v - a0) / (a1 - a0), 0, 1)
    a = np.maximum(ramp(g - np.maximum(r, b), -28, 2), ramp(img.max(axis=2), 115, 75))
    finish(name, img, a, np.array([0., 0., 0.]), target, box=box, unmix_bg=False)

def gold_fly(name, target):
    # Золотая мошка нарисована с оранжевым свечением, которое смешалось с розовым
    # фоном в кляксу — по «розовости» её не отделить. Поэтому: тело мошки (тёмный
    # контур, золото, красные глаза, светлые блики) оставляем как есть, а всё
    # остальное считаем светом — чем дальше пиксель от фона, тем ярче — и красим
    # в полупрозрачный золотой ореол.
    img = load(name); bg = border_bg(img)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    ramp = lambda v, a0, a1: np.clip((v - a0) / (a1 - a0), 0, 1)
    body = np.maximum.reduce([ramp(b, 80, 55), ramp(r, 150, 115), ramp(g, 168, 190)])
    glow_ref = np.array([240., 150., 90.])
    gs = np.clip(np.linalg.norm(img - bg, axis=2) / np.linalg.norm(glow_ref - bg), 0, 1)
    a = np.maximum(body, gs * .5 * (1 - body))
    gold = np.array([255., 205., 70.])
    f = img * body[..., None] + gold * (1 - body[..., None])
    finish(name, f, a, np.array([0., 0., 0.]), target, unmix_bg=False)

def water(name, target_h=200, overlap=0.18):
    img = Image.open(os.path.join(SRC, name + '.jpe')).convert('RGB')
    arr = np.asarray(img).astype(np.float32)
    h, w, _ = arr.shape
    ov = int(w * overlap)
    # бесшовный повтор: правый край плавно перетекает в левый
    base = arr[:, :w - ov].copy()
    ramp = np.linspace(0, 1, ov)[None, :, None]
    base[:, :ov] = arr[:, :ov] * ramp + arr[:, w - ov:] * (1 - ramp)
    im = Image.fromarray(base.astype(np.uint8))
    s = target_h / im.height
    im = im.resize((round(im.width * s), target_h), Image.LANCZOS)
    p = os.path.join(SRC, name + '.png')
    im.save(p, optimize=True)
    print(f'{name:12} {im.size[0]}x{im.size[1]}  {os.path.getsize(p) // 1024} КБ')

if __name__ == '__main__':
    for n in ('pad', 'pad_sink', 'pad_rot'):
        img = load(n); a, bg = key_magenta(img); finish(n, img, a, bg, 256)
    for n in ('spring_low', 'spring_high'):
        green_body(n, 120)
    img = load('heron'); a, bg = key_magenta(img); finish('heron', img, a, bg, 240, box='h')
    for n in ('fly_a', 'fly_b'):
        img = load(n); a, bg = key_magenta(img); finish(n, img, a, bg, 112)
    # золотое свечение смешано с фоном в оранжево-розовую кляксу — её убираем,
    # свечение в игре рисуется отдельно и честно прозрачным
    for n in ('fly_gold_a', 'fly_gold_b'):
        gold_fly(n, 112)
    img = load('dragonfly'); a, bg = key_magenta(img); finish('dragonfly', img, a, bg, 200)
    for n in ('lotus_pink', 'lotus_gold', 'lotus_blue'):
        img = load(n); a, bg = key_green(img); finish(n, img, a, bg, 112)
    img = load('bubble'); a, bg = key_black(img, 6, 160); finish('bubble', img, a, bg, 128)
    for n in ('cloud_1', 'cloud_2', 'cloud_3'):
        img = load(n); a, bg = key_black(img, 8, 235); finish(n, img, a, bg, 320)
    water('water')
