# Промо-ролик

`cowboy_duel_promo_4x5_en.mp4` — 1080×1350 (4:5), 21 с, английский, со звуком.

Пересобрать:

```bash
python3 sound.py          # саундтрек → sound.wav (нужен numpy)
node render.js            # кадры → frames/ (нужен playwright)
ffmpeg -framerate 30 -i frames/%04d.png -i sound.wav -c:v libx264 -pix_fmt yuv420p \
  -crf 20 -c:a aac -b:a 160k -shortest -movflags +faststart cowboy_duel_promo_4x5_en.mp4
```

Анимация описана в `promo.html` функцией `render(t)`: тексты и тайминги правятся там.
