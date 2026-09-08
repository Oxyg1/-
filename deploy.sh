#!/bin/bash
set -e
HOST=root@104.128.142.55
cd "$(dirname "$0")"
rsync -avz --delete \
  --exclude 'server/.env' --exclude 'server/data.json' --exclude 'server/cards/' --exclude 'dist/' \
  ./ "$HOST":/opt/frog/frog/game/
ssh "$HOST" 'systemctl restart swamp && sleep 1 && systemctl status swamp --no-pager -l | head -10'
