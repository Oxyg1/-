#!/bin/bash
# usage: anim/preview.sh OUTDIR   — assemble, pack, check, and render filmstrips (dark + light) and a GIF into OUTDIR
set -e
cd "$(dirname "$0")/.."
OUT=${1:?outdir}; mkdir -p "$OUT"
python3 anim/assemble.py -o "$OUT/kissed-dragon.json"
python3 tools/tgs.py pack "$OUT/kissed-dragon.json" -o "$OUT/kissed-dragon.tgs" | grep -E "gzip size|RESULT"
R=/home/user/obeskay/lottie-animator-skill/scripts/render.mjs
node $R "$OUT/kissed-dragon.json" --frames 0,12,20,28,34,44,50,56,64,76,88,96,100,108,114,120,126,132,140,150,158,166,172,179 --bg "#17212B" --out "$OUT/dark" | grep -E "EMPTY|clipped|off canvas" || true
node $R "$OUT/kissed-dragon.json" --frames 0,34,50,76,100,124,158 --bg "#FFFFFF" --out "$OUT/light" >/dev/null
F=$(python3 -c "print(','.join(str(i) for i in range(0,180,2)))")
node $R "$OUT/kissed-dragon.json" --frames $F --bg "#17212B" --out "$OUT/all" --no-strip >/dev/null
python3 - "$OUT" <<'PY'
import sys, glob
from PIL import Image
o = sys.argv[1]
fs = sorted(glob.glob(o + '/all/frame-*.png'))
ims = [Image.open(f).convert('RGB').resize((384, 384)) for f in fs]
ims[0].save(o + '/preview.gif', save_all=True, append_images=ims[1:], duration=33, loop=0)
print('gif', o + '/preview.gif')
PY
