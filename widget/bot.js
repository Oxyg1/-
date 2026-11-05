// Flappy-бот: шлёт в чат игру-виджет (widget/flappy.html) и ведёт одну общую таблицу рекордов.
// Node 18+, без зависимостей, long polling. Как запустить — widget/README.md.
//
//   /start, /flappy — прислать игру; /top — таблица текстом; инлайн: @бот в любом чате.
//   Виджет шлёт запрос score:N → бот обновляет общий рекорд (editSharedWidgetData),
//   рекорд этого чата (editMessageWidgetData) и отвечает таблицей (answerWidgetQuery).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
for (const line of (fs.existsSync(path.join(DIR, '.env')) ? fs.readFileSync(path.join(DIR, '.env'), 'utf8') : '').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('Нет BOT_TOKEN: впиши его в widget/.env (пример в widget/.env.example)'); process.exit(1); }
const BASE = (process.env.BOT_API || 'https://api.telegram.org').replace(/\/+$/, '');
const URL_ = process.env.TEST_ENV === '1' ? `${BASE}/bot${TOKEN}/test` : `${BASE}/bot${TOKEN}`;
const MAX_SCORE = Number(process.env.MAX_SCORE) || 999;
const TOP = 8;

const HTML_FILE = path.join(DIR, 'flappy.html');
const html = () => fs.readFileSync(HTML_FILE, 'utf8');
const htmlHash = () => crypto.createHash('sha1').update(html()).digest('hex').slice(0, 12);

async function api(method, params = {}) {
  for (;;) {
    let body;
    try {
      const res = await fetch(`${URL_}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
      body = await res.json();
    } catch (e) { throw new Error(`${method}: ${String(e.message).split(TOKEN).join('<token>')}`); }
    if (body.ok) return body.result;
    const wait = body.parameters && body.parameters.retry_after;
    if (wait) { await new Promise((r) => setTimeout(r, wait * 1000 + 200)); continue; }
    throw new Error(`${method}: ${body.description}`);
  }
}
const sameIsFine = (e) => { if (!/not modified/i.test(e.message)) throw e; };

// ---- состояние: один общий виджет и рекорды

const STATE_FILE = path.join(DIR, 'state.json');
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const state = Object.assign(
  { id: null, hash: null, bests: {}, chats: {}, r: 0 },
  J(fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : null, {}),
);
let saveTimer = null;
function save() {
  saveTimer = saveTimer || setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  }, 500);
}

const nameOf = (u) => String((u && (u.first_name || u.username)) || 'Игрок').slice(0, 16);
/** [имя, очки, id] по убыванию очков; при равенстве выше тот, кто набрал раньше. */
const top = () => Object.values(state.bests).sort((a, b) => b[1] - a[1] || a[3] - b[3]).slice(0, TOP).map(([n, s, id]) => [n, s, id]);
const publicData = () => JSON.stringify({ top: top(), n: Object.keys(state.bests).length, r: state.r });
const chatData = (chatId) => (state.chats[chatId] ? JSON.stringify({ best: state.chats[chatId] }) : undefined);

/** Общий виджет: одна таблица во всех чатах. Если flappy.html поменялся, шлём новый виджет, рекорды остаются. */
async function sendGame(chat_id) {
  const cd = chatData(String(chat_id));
  if (state.id && state.hash === htmlHash()) {
    return api('sendSharedWidget', { chat_id, widget_id: state.id, ...(cd ? { chat_data: cd } : {}) });
  }
  const sent = await api('sendWidget', {
    chat_id, html: html(), allow_queries: true, is_shared: true, public_data: publicData(),
    caption: 'Flappy: тапай, чтобы лететь', ...(cd ? { chat_data: cd } : {}),
  });
  state.id = sent.widget && sent.widget.id;
  state.hash = htmlHash();
  save();
  return sent;
}

// ---- команды и инлайн

let me;
async function onMessage(m) {
  const c = String(m.text || '').split(/[\s@]/)[0];
  const chat_id = m.chat.id;
  if (c === '/start' || c === '/flappy' || c === '/play') {
    await sendGame(chat_id);
  } else if (c === '/top') {
    const t = top();
    await api('sendMessage', {
      chat_id,
      text: t.length ? '🏆 Рекорды Flappy\n\n' + t.map(([n, s], i) => `${i + 1}. ${n} — ${s}`).join('\n') : 'Рекордов пока нет. /flappy — сыграть',
    });
  } else return;
  console.log(`${c} в ${m.chat.type} ${chat_id}`);
}

async function onInline(q) {
  const content = state.id && state.hash === htmlHash()
    ? { widget_id: state.id }
    : { html: html(), allow_queries: true, is_shared: true, public_data: publicData() };
  await api('answerInlineQuery', {
    inline_query_id: q.id, cache_time: 0, is_personal: true,
    results: [{ type: 'article', id: 'flappy', title: 'Flappy', description: `Одна таблица рекордов на всех · игроков: ${Object.keys(state.bests).length}`, input_message_content: content }],
  });
}

// ---- запросы из виджета

async function onQuery(q, fromCopy) {
  const [kind, arg] = String(q.data).split(':');
  if (kind !== 'score') return { err: 'Неизвестный запрос' };
  const score = Number(arg);
  if (!(Number.isInteger(score) && score >= 1 && score <= MAX_SCORE)) return { err: 'Странный счёт' };
  if (q.widget_id && !state.id) { state.id = q.widget_id; state.hash = htmlHash(); }

  const uid = String(q.from.id);
  const prev = state.bests[uid];
  if (!prev || score > prev[1]) state.bests[uid] = [nameOf(q.from), score, q.from.id, Date.now()];
  else prev[0] = nameOf(q.from);
  state.r++;
  if (state.id) await api('editSharedWidgetData', { widget_id: state.id, public_data: publicData(), cache_time: 10 }).catch(sameIsFine);

  const chat = q.chat && String(q.chat.id);
  if (!fromCopy && chat && !(state.chats[chat] >= score)) {
    const where = q.inline_message_id ? { inline_message_id: q.inline_message_id } : { chat_id: q.chat.id, message_id: q.message_id };
    await api('editMessageWidgetData', { ...where, chat_data: JSON.stringify({ best: score }) }).catch(sameIsFine);
    state.chats[chat] = score;
  }
  const t = top();
  // Таблица идёт и в ответе: копия виджета увидит общую правку не сразу.
  return { rank: t.findIndex((r) => String(r[2]) === uid) + 1, best: state.bests[uid][1], top: t, n: Object.keys(state.bests).length, r: state.r };
}

// ---- цикл

async function main() {
  me = await api('getMe');
  await api('setMyCommands', { commands: [{ command: 'flappy', description: 'Сыграть во Flappy' }, { command: 'top', description: 'Таблица рекордов' }] }).catch(() => {});
  console.log(`Flappy-бот @${me.username} запущен (${URL_.includes('/test') ? 'тестовая среда' : 'боевая среда'}), состояние в ${STATE_FILE}`);
  let offset = 0;
  for (;;) {
    let updates = [];
    try { updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'inline_query', 'widget_query', 'shared_widget_query'] }); }
    catch (e) { console.error(e.message); await new Promise((r) => setTimeout(r, 3000)); continue; }
    for (const u of updates) {
      offset = u.update_id + 1;
      try {
        if (u.message) await onMessage(u.message);
        else if (u.inline_query) await onInline(u.inline_query);
        else if (u.widget_query || u.shared_widget_query) {
          const q = u.widget_query || u.shared_widget_query;
          let answer;
          // Отвечаем на каждый запрос, даже если правка упала, иначе виджет покажет «Бот не ответил».
          try { answer = await onQuery(q, !u.widget_query); }
          catch (e) { console.error(`${q.data}: ${e.message}`); answer = { err: 'Ошибка бота, попробуй ещё' }; }
          save();
          console.log(`${q.data} от ${nameOf(q.from)} → ${JSON.stringify(answer).slice(0, 120)}`);
          await api('answerWidgetQuery', { widget_query_id: q.id, data: JSON.stringify(answer) });
        }
      } catch (e) { console.error(e.message); }
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
