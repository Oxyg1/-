# Как обновлять игру на сервере

## Разовая настройка (один раз)

**1. Сервис вместо ручного `node server.js`.** Так сервер не умрёт при закрытии SSH
и сам перезапустится при падении.

На сервере:
```bash
cp /opt/frog/frog/game/server/swamp.service /etc/systemd/system/swamp.service
systemctl daemon-reload
systemctl enable --now swamp
systemctl status swamp
```
Если сейчас `node server.js` где-то ещё запущен в терминале вручную — останови его
(`Ctrl+C` в той сессии), иначе два процесса будут спорить за порт 8787.

**2. Проверка:**
```bash
curl -sI http://localhost:8787/
journalctl -u swamp -n 30 --no-pager
```
В логе должна быть строка вида `SWAMP server on :8787 ... bot=on`.

## Каждое обновление

Файлы, которые нельзя перетирать при обновлении: `server/.env` (боевые токены),
`server/data.json` (все игроки и покупки), `server/cards/` (шаренные карточки).
Ниже это учтено через `rsync --exclude`.

**С Windows (Git Bash / WSL), из папки `game`:**
```bash
rsync -avz --delete \
  --exclude 'server/.env' \
  --exclude 'server/data.json' \
  --exclude 'server/cards/' \
  --exclude 'dist/' \
  ./ root@104.128.142.55:/opt/frog/frog/game/
```
Спросит пароль root (или отработает по ключу, если он у тебя настроен).

**Если rsync недоступен** (обычный Git Bash без WSL иногда без него) — через `scp`
папкой целиком, чуть грубее, но рабочий вариант:
```bash
scp -r index.html levels.js backdrops.js build.py icons frogs \
  root@104.128.142.55:/opt/frog/frog/game/
scp server/server.js root@104.128.142.55:/opt/frog/frog/game/server/server.js
```
Так `.env`, `data.json` и `cards/` вообще не участвуют в копировании — их не тронет.

**После заливки — перезапуск на сервере:**
```bash
systemctl restart swamp
journalctl -u swamp -n 20 --no-pager
```

## Короткая версия одной командой

Сохрани на своей машине `deploy.sh` рядом с игрой и просто запускай его при каждом обновлении:

```bash
#!/bin/bash
set -e
HOST=root@104.128.142.55
cd "$(dirname "$0")"
rsync -avz --delete \
  --exclude 'server/.env' --exclude 'server/data.json' --exclude 'server/cards/' --exclude 'dist/' \
  ./ "$HOST":/opt/frog/frog/game/
ssh "$HOST" 'systemctl restart swamp && sleep 1 && systemctl status swamp --no-pager -l | head -10'
```
```bash
chmod +x deploy.sh
./deploy.sh
```
Дальше при каждой правке — просто `./deploy.sh`.
