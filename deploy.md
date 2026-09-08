# Как обновлять игру на сервере (через GitHub)

## Разовая настройка

**1. Создай пустой репозиторий на GitHub** (в браузере, это может сделать только твой аккаунт):
New repository → имя, например `swamp` → **без** README/gitignore/лицензии (они уже есть
локально) → Create.

**2. Подключи и запушь локальный репозиторий** (уже создан и закоммичен, лежит в `game/`).
На своей машине, в Git Bash из папки `game`:
```bash
git remote add origin git@github.com:Oxyg1/swamp.git
git branch -M main
git push -u origin main
```
SSH-ключ `swampis-deploy` для этого уже добавлен в твой GitHub, push пройдёт без пароля.
(Если имя репозитория будет не `swamp` — подставь своё в URL.)

**3. Заведи серверу свой ключ для чтения репозитория** (отдельный от личного — на сервере
достаточно read-only доступа).
```bash
ssh-keygen -t ed25519 -C "swamp-server" -f ~/.ssh/id_ed25519_deploy -N ""
cat ~/.ssh/id_ed25519_deploy.pub
```
Скопируй вывод. На GitHub: репозиторий `swamp` → Settings → Deploy keys → Add deploy key →
вставь ключ → галку **Allow write access не ставь** (серверу нужно только читать, не пушить).

Пропиши на сервере, чтобы git использовал именно этот ключ для GitHub:
```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/id_ed25519_deploy
  IdentitiesOnly yes
EOF
ssh -T git@github.com   # должен ответить "Hi Oxyg1/swamp! You've successfully authenticated"
```

**4. Превращаем то, что уже развёрнуто, в git-репозиторий на месте** — не переносим папку,
подключаем её к GitHub прямо там, где она лежит сейчас (`/opt/frog/frog/game`), чтобы
`server/.env`, `server/data.json` и systemd-сервис остались как есть.
```bash
cd /opt/frog/frog/game
mv server/.env /tmp/swamp.env.bak   # временно уберём с дороги, чтобы git его не тронул
git init
git remote add origin git@github.com:Oxyg1/swamp.git
git fetch origin
git reset --hard origin/main   # текущие файлы заменятся версией из GitHub — это то же самое, что уже на диске
mv /tmp/swamp.env.bak server/.env   # возвращаем .env на место
```
`.gitignore` уже исключает `server/.env`, `server/data.json`, `server/cards/`, `dist/` —
дальнейшие `git pull` их не тронут, поэтому `.env` можно было и не убирать, но на первом
разе так безопаснее: `reset --hard` иначе может пожаловаться на незакоммиченный файл.

**5. Проверка:**
```bash
systemctl restart swamp
curl -sI http://localhost:8787/
journalctl -u swamp -n 20 --no-pager
```

## Каждое обновление

Вся возня с zip/rsync/scp больше не нужна — только git.

**На своей машине**, после правок в `game/`:
```bash
git add -A
git commit -m "что поменял"
git push
```

**На сервере:**
```bash
cd /opt/frog/frog/game
git pull
systemctl restart swamp
journalctl -u swamp -n 20 --no-pager
```

## Ещё короче — одной командой с сервера

```bash
echo "alias swamp-update='cd /opt/frog/frog/game && git pull && systemctl restart swamp'" >> ~/.bashrc
source ~/.bashrc
```
Дальше после `git push` с локальной машины заходишь по SSH и пишешь `swamp-update`.
