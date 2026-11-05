# Flappy-бот на виджетах Telegram

Игра Flappy прямо в сообщении чата, без Mini App: бот шлёт **виджет** —
маленький HTML (до 4 КБ в сжатом виде), который Telegram запускает внутри пузыря
сообщения ([TelegramMessenger/widget-sandbox](https://github.com/TelegramMessenger/widget-sandbox)).

- `flappy.html` — сама игра: canvas, тап — взмах, трубы, счёт, рекорд на устройстве,
  кнопка «Отправить N» и таблица топ-5. Весит 3831 Б после zlib (лимит сервера 4096).
- `bot.js` — бот (Node 18+, без зависимостей): `/flappy`, `/top`, инлайн-режим,
  одна общая таблица рекордов на все чаты и рекорд каждого чата.

## Запуск

1. Виджеты пока только в **бете Bot API 10.4 на тестовом сервере** Telegram.
   Нужен тестовый аккаунт и бот, созданный у @BotFather **в тестовой среде**
   (как войти в тестовую среду: https://core.telegram.org/bots/webapps#using-bots-in-the-test-environment).
   Для инлайн-режима включи его у BotFather: `/setinline`.
2. `cp widget/.env.example widget/.env` и впиши `BOT_TOKEN`.
3. `node widget/bot.js`
4. Напиши боту `/flappy` (или `@имя_бота` в любом чате).

Это отдельный бот: `server/server.js` уже читает `getUpdates` своим токеном,
а читать обновления одного бота могут только из одного процесса.
Когда виджеты выйдут в обычный Bot API, поменяй в `.env`
`BOT_API=https://api.telegram.org` и `TEST_ENV=0`.

## Как устроено

| | |
|---|---|
| `publicData` (общее для всех копий) | `{top:[[имя,очки,id]], n: игроков, r: ревизия}` |
| `chatData` (этот чат) | `{best}` — рекорд чата |
| запрос виджета → ответ | `score:N` → `{rank, best, top, n, r}` или `{err}` |

Виджет общий (`is_shared`): один `widget_id` на все чаты, бот правит его таблицу
через `editSharedWidgetData`, и её видят все копии, даже пересланные.
Если поменять `flappy.html`, бот сам пришлёт новый виджет при следующем `/flappy`,
рекорды сохранятся (они в `widget/state.json`).

Счёт считает телефон игрока, поэтому накрутить его можно. Бот режет
явную чушь (`MAX_SCORE`, по умолчанию 999).

## Проверка без Telegram

Открой `flappy.html` в браузере: игра работает, таблица показывает пример.
Проверка в настоящей песочнице:
`corepack pnpm tsx packages/core/scripts/sandbox-node.ts путь/к/flappy.html --width 360`
в клоне widget-sandbox.
