# Как обновлять SWAMP на сервере

Репозиторий: `https://github.com/Oxyg1/-` — публичный, поэтому **серверу не нужны ни ключи, ни токены**,
он просто скачивает по HTTPS.

---

## Шаг 1 (один раз): отправить код на GitHub

Это делаешь ты со своей машины — авторизация в GitHub только твоя.

```bash
cd путь/к/game
git push -u origin main
```

Сейчас `origin` настроен на HTTPS, Git откроет окно входа в браузере, руками токен вбивать не нужно.
Если у тебя работает SSH и хочется без окна:

```bash
git remote set-url origin git@github.com:Oxyg1/-.git
git push -u origin main
```

## Шаг 2 (один раз): подключить сервер к репозиторию

На сервере, где уже лежит распакованная игра. `.env`, `data.json` и карточки не тронутся —
они в `.gitignore`, а `git` не трогает файлы вне своего учёта.

```bash
cd /opt/frog/frog/game
git init
git remote add origin https://github.com/Oxyg1/-.git
git fetch origin
git reset --hard origin/main
```

Если `reset` ругнётся на незакоммиченный `.env` — временно убери его и верни:
```bash
mv server/.env /tmp/e && git reset --hard origin/main && mv /tmp/e server/.env
```

Проверь, что всё на месте, и подними сервис:
```bash
ls server/admin.html && systemctl restart swamp && systemctl status swamp --no-pager | head -5
```

## Шаг 3: удобная команда на будущее

```bash
echo "alias swamp-update='cd /opt/frog/frog/game && git pull && systemctl restart swamp && journalctl -u swamp -n 15 --no-pager'" >> ~/.bashrc
source ~/.bashrc
```

---

## Дальше каждое обновление — две команды

**У себя:**
```bash
git add -A && git commit -m "что поменял" && git push
```

**На сервере:**
```bash
swamp-update
```

---

## Что ещё нужно дописать в server/.env на сервере

```
ADMIN_KEY=придумай_длинную_случайную_строку
```
Без него админка на `/admin` никого не пустит. Сгенерировать можно прямо на сервере:
```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

## И одну строку в конфиг nginx

Внутри блока `server { }` для `swampis.duckdns.org`:
```nginx
client_max_body_size 20m;
```
Без неё карточки для чата и сторис не долетают до сервера: nginx по умолчанию режет запросы
больше 1 МБ. Потом `nginx -t && systemctl reload nginx`.

---

## Если вообще не хочется связываться с git

Код можно закинуть напрямую, без GitHub, с любой машины, где работает SSH:

```bash
cd путь/к/game
rsync -avz --delete \
  --exclude 'server/.env' --exclude 'server/data.json' --exclude 'server/cards/' --exclude 'dist/' \
  ./ root@104.128.142.55:/opt/frog/frog/game/
ssh root@104.128.142.55 'systemctl restart swamp'
```
Тот же набор исключений: боевой конфиг, база игроков и карточки остаются нетронутыми.
