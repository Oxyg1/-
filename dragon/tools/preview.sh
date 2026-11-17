#!/usr/bin/env bash
# Render filmstrips of a Lottie/TGS JSON on Telegram's dark and light backgrounds.
# Usage: tools/preview.sh FILE.json OUTDIR
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 FILE.json OUTDIR" >&2
  exit 2
fi

FILE="$1"
OUTDIR="$2"
RENDER="/home/user/obeskay/lottie-animator-skill/scripts/render.mjs"
FRAMES="0,15,30,45,60,75,90,105,120,135,150,165,179"

if [ ! -f "$FILE" ]; then
  echo "error: no such file: $FILE" >&2
  exit 1
fi
if [ ! -f "$RENDER" ]; then
  echo "error: renderer not found: $RENDER" >&2
  exit 1
fi

mkdir -p "$OUTDIR"

node "$RENDER" "$FILE" --frames "$FRAMES" --bg "#17212B" --out "$OUTDIR/dark"
node "$RENDER" "$FILE" --frames "$FRAMES" --bg "#FFFFFF" --out "$OUTDIR/light"

echo "dark:  $OUTDIR/dark"
echo "light: $OUTDIR/light"
