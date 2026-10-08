"""Готовит ассеты Flappy Frog из исходников Nano Banana (game/flappy/*.jpe →
*.png с прозрачным фоном). Вырезание фона — то же, что для Frog Jump.

Запуск:  python tools/cut_flappy_assets.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cut_jump_assets as J
J.SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'flappy')
for n, size, box in (('reed_bottom', 160, 'w'), ('reed_top', 160, 'w'), ('heron', 200, 'h')):
    if not J.exists(n): continue
    img = J.load(n); a, bg = J.key_magenta(img); J.finish(n, img, a, bg, size, box=box)
