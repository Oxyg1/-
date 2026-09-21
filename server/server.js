/*  SWAMP — сервер + бот. Node 18+, без зависимостей.
    Запуск:  node server/server.js
    Настройки берутся из переменных окружения или файла server/.env (см. .env.example).
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- CONFIG ---------- */
const ROOT = path.resolve(__dirname, '..');
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();
const E = process.env;
const CFG = {
  token: E.BOT_TOKEN || '',
  appUrl: (E.APP_URL || 'http://localhost:8787').replace(/\/$/, ''),
  chatId: E.CHAT_ID || '',
  chatLink: E.CHAT_LINK || 'https://t.me/FrogGame',
  holdersLink: E.HOLDERS_CHAT_LINK || 'https://t.me/kissed_frog_holders',
  holdersChatId: E.HOLDERS_CHAT_ID || '',
  botUsername: E.BOT_USERNAME || '',
  appName: E.APP_NAME || '',
  port: +(E.PORT || 8787),
  digestHour: +(E.DIGEST_HOUR ?? 18),
  adminId: E.ADMIN_ID || '',
  dev: E.DEV === '1' || !E.BOT_TOKEN,
  pondGoal: +(E.POND_GOAL || 50000),
  adminKey: E.ADMIN_KEY || '',
};
CFG.appLink = CFG.botUsername ? (CFG.appName ? `https://t.me/${CFG.botUsername}/${CFG.appName}?startapp=chat` : `https://t.me/${CFG.botUsername}`) : CFG.chatLink;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- LEVELS (из game/levels.js и game/cats.js) ---------- */
function readLadder(file) {
  const out = [];
  for (const m of fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/\{n:"([^"]+)",f:"([^"]+)",r:([\d.]+)\}/g)) out.push({ n: m[1], f: m[2], r: +m[3] });
  return out;
}
// у каждого вида своя лестница и свой подарок в Telegram
const LADDER = { frog: readLadder('levels.js'), cat: readLadder('cats.js') };
const GIFT = { frog: E.GIFT_NAME || 'Kissed Frog', cat: E.GIFT_NAME_CAT || 'Scared Cat' };
const spOf = u => (u && u.species === 'cat') ? 'cat' : 'frog';
// Уровень и слияния считаются на КАЖДЫЙ вид отдельно: иначе после переключения
// кот унаследовал бы уровень лягушки, а потолок «maxLv <= merges+1» пустил бы
// новичка-кота сразу на 50-й за счёт лягушачьих слияний.
// Очки и общий счётчик слияний остаются сквозными — они про игрока, а не про вид.
function spRec(u) {
  if (!u.bySp) u.bySp = { frog: { maxLv: u.maxLv || 1, merges: u.merges || 0, score: u.score || 0 } };
  const k = spOf(u);
  return u.bySp[k] || (u.bySp[k] = { maxLv: 1, merges: 0, score: 0 });
}
const sumScore = u => Object.values(u.bySp || {}).reduce((s, r) => s + (r.score || 0), 0);
const ladderOf = u => LADDER[spOf(u)];
const LEVELS = LADDER.frog;   // совместимость: где вид не важен, остаётся лягушачья
const levelByName = (name, sp) => LADDER[sp || 'frog'].findIndex(l => l.n.toLowerCase() === String(name).toLowerCase()) + 1;

/* ---------- SHOP ---------- */
const SHOP = {
  starter: { title: 'Стартовый набор', desc: 'Мушка и ускорение ×2 на сутки + 3 диких лягушки', price: 99, once: 'starter' },
  auto1d: { title: 'Мушка на сутки', desc: 'Автотап на 24 часа', price: 50 },
  autoForever: { title: 'Мушка навсегда', desc: 'Автотап без ограничений', price: 490, once: 'autoForever' },
  boost1h: { title: 'Ускорение ×2 на час', desc: 'Двойные монеты с тапа на час', price: 25 },
  boost1d: { title: 'Ускорение ×2 на сутки', desc: 'Двойные монеты с тапа на 24 часа', price: 99 },
  bigBoard: { title: 'Большой пруд 6×6', desc: 'Поле 6×6 навсегда', price: 299, once: 'bigBoard' },
  wild3: { title: 'Дикая лягушка ×3', desc: 'Три джокера для слияния', price: 39 },
  sub: { title: 'Абонемент пруда', desc: 'Мушка, значок и ранний доступ к фонам на 30 дней', price: 199, sub: true },
  donate: { title: 'Покормить пруд', desc: 'Донат в общую цель чата', donate: true },
  war: { title: 'Поддержать сторону', desc: 'Сдвинуть битву видов в свою пользу', warPush: true },
  revive: { title: 'Вернуть серию', desc: 'Продолжить оборвавшуюся бесконечную серию', revive: true },
  // отдельная фикс-цена на возврат, если игрок застал поле уже забитым, ВЕРНУВШИСЬ
  // в приложение — не нарастающая, как у обычного revive: считаем честным не
  // штрафовать за то, что он не видел стоп-экран вживую и не мог отреагировать раньше
  reviveReturn: { title: 'Вернуть серию (при входе)', desc: 'Разовая скидка — поле стало тупиком, пока приложение было закрыто', price: 15 },
  jumpRevive: { title: 'Продолжить прыжок', desc: 'Frog Jump: продолжить забег с той же высоты', price: 10 },
  jumpRevive2: { title: 'Продолжить ещё раз', desc: 'Frog Jump: второе продолжение в этом забеге', price: 25 },
  jumpShield: { title: 'Страховка прыгуна', desc: 'Frog Jump: первое падение не оборвёт забег', price: 15 },
  jumpBoost: { title: 'Разгон', desc: 'Frog Jump: начать забег с половины своего рекорда', price: 20 },
};

/* ---------- ЭМОДЗИ ----------
   Слоты значков в текстах бота. Впиши премиум-ID в .env (EMOJI_FROG=5237... и т.д.) —
   бот подставит <tg-emoji>, иначе останется запасной символ из FB.
   Кастомные эмодзи работают, если у владельца бота есть Premium (сообщения бота в личку,
   группы и супергруппы) либо бот купил доп. юзернейм на Fragment.
   В подписях inline-кнопок кастомные эмодзи невозможны — там только обычный значок EMO_BTN. */
const EMO_ID = {
  frog: E.EMOJI_FROG || '', trophy: E.EMOJI_TROPHY || '', gold: E.EMOJI_GOLD || '',
  silver: E.EMOJI_SILVER || '', bronze: E.EMOJI_BRONZE || '', crown: E.EMOJI_CROWN || '',
  sparkle: E.EMOJI_SPARKLE || '', wave: E.EMOJI_WAVE || '', heart: E.EMOJI_HEART || '',
  star: E.EMOJI_STAR || '',
};
const EMO_FB = { frog: '\u{1F438}', trophy: '\u{1F3C6}', gold: '\u{1F947}', silver: '\u{1F948}', bronze: '\u{1F949}',
  crown: '\u{1F451}', sparkle: '\u2728', wave: '\u{1F30A}', heart: '\u2764\uFE0F', star: '\u2B50' };
const em = k => EMO_ID[k] ? `<tg-emoji emoji-id="${EMO_ID[k]}">${EMO_FB[k]}</tg-emoji>` : EMO_FB[k];
const EMO_BTN = E.EMOJI_BUTTON === '0' ? '' : EMO_FB.frog + ' ';

// у товаров, завязанных на живность, подпись зависит от вида — её видно в окне оплаты Telegram
const SHOP_SP = {
  frog: { wild3: 'Дикая лягушка ×3', auto1d: 'Мушка на сутки', autoForever: 'Мушка навсегда',
    bigBoard: 'Большой пруд 6×6', sub: 'Абонемент пруда', donate: 'Покормить пруд', war: 'Поддержать лягушек',
    starterDesc: 'Мушка и ускорение ×2 на сутки + 3 диких лягушки', subDesc: 'Мушка, значок и ранний доступ к фонам на 30 дней' },
  cat: { wild3: 'Дикий кот ×3', auto1d: 'Мышка на сутки', autoForever: 'Мышка навсегда',
    bigBoard: 'Большая крыша 6×6', sub: 'Абонемент клуба', donate: 'Поддержать общую цель', war: 'Поддержать котов',
    starterDesc: 'Мышка и ускорение ×2 на сутки + 3 диких кота', subDesc: 'Мышка, значок и ранний доступ к фонам на 30 дней' },
};
function shopItem(id, sp) {
  const base = SHOP[id]; if (!base) return null;
  const o = SHOP_SP[sp] || SHOP_SP.frog;
  const it = Object.assign({}, base);
  if (o[id]) it.title = o[id];
  if (id === 'starter') it.desc = o.starterDesc;
  if (id === 'sub') it.desc = o.subDesc;
  return it;
}

// Возврат оборвавшейся серии дорожает с каждым разом внутри одной серии,
// чтобы бесконечно выкупать один и тот же забег было невыгодно
const REVIVE_BASE = 50;
const revivePrice = u => Math.min(500, REVIVE_BASE * Math.pow(2, (((u && u.endless) || {}).cont || 0)));

const BD_PRICE = 59;
const DAY = 86400e3;
function grant(user, item, amount) {
  const inv = user.inv || (user.inv = {});
  const t = Date.now();
  switch (item) {
    case 'auto1d': inv.autoUntil = Math.max(inv.autoUntil || 0, t) + DAY; break;
    case 'autoForever': inv.autoForever = true; break;
    case 'boost1h': inv.boostUntil = Math.max(inv.boostUntil || 0, t) + 3600e3; break;
    case 'boost1d': inv.boostUntil = Math.max(inv.boostUntil || 0, t) + DAY; break;
    case 'bigBoard': inv.bigBoard = true; break;
    case 'wild3': user.wild = (user.wild || 0) + 3; break;
    case 'starter': inv.starter = true; inv.autoUntil = Math.max(inv.autoUntil || 0, t) + DAY; inv.boostUntil = Math.max(inv.boostUntil || 0, t) + DAY; user.wild = (user.wild || 0) + 3; break;
    case 'sub': inv.subUntil = Math.max(inv.subUntil || 0, t) + 30 * DAY; break;
    case 'donate': inv.donated = (inv.donated || 0) + amount; db.pond.stars += amount; db.pond.count += amount * 10; db.pond.donors[user.id] = (db.pond.donors[user.id] || 0) + amount; break;
    case 'jumpRevive': case 'jumpRevive2': { const j = jumpRec(user); j.revPaid = (j.revPaid || 0) + 1; break; }
    case 'jumpShield': { const j = jumpRec(user); j.shield = (j.shield || 0) + 1; break; }
    case 'jumpBoost': { const j = jumpRec(user); j.boost = (j.boost || 0) + 1; break; }
    case 'revive': case 'reviveReturn': { const e = user.endless || (user.endless = {}); e.cont = (e.cont || 0) + 1; inv.reviveLeft = (inv.reviveLeft || 0) + 1; break; }
    case 'war': { warCheck(); const side = spOf(user); warPull(user, side, amount * STARS_PER_PULL); db.war.stars += amount; warBucket(user.id).s += amount; inv.warStars = (inv.warStars || 0) + amount; break; }
    case 'skin': break;   // недостижимо: наряды приходят как 'skin:<слаг>' (см. ниже)
    default: if (String(item).startsWith('skin:')) {
      const j = jumpRec(user), slug = String(item).slice(5);
      if (!j.skins) j.skins = [];
      if (!j.skins.includes(slug)) j.skins.push(slug);
      pendingInvoices.delete(`${user.id}:skin:${slug}`);
      // мошки, которыми сбивали цену, списываем только по факту оплаты
      const d = j.pendDisc;
      if (d && d.slug === slug && Date.now() - d.at < 30 * 60e3) { j.flies = Math.max(0, (j.flies || 0) - d.flies); }
      j.pendDisc = null;
      j.skin = slug;
    } else if (String(item).startsWith('bd:')) { const th = String(item).slice(3); inv.themes = inv.themes || []; if (!inv.themes.includes(th)) inv.themes.push(th); }
  }
}

/* ---------- DB (json-файл) ---------- */
const DB_FILE = path.join(__dirname, 'data.json');
let db = { users: {}, payments: [], pond: { week: '', count: 0, stars: 0, donors: {} }, war: { week: '', frog: 0, cat: 0, stars: 0, by: {}, last: null }, endless: { record: null }, jump: { record: null, secret: '' }, digest: { day: '' }, events: [], broadcast: null };
try { if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { log('db read error', e.message); }
if (!db.jump || typeof db.jump !== 'object') db.jump = { record: null, secret: '' };
// секрет подписи номеров забега: живёт в базе, чтобы пережить перезапуск сервера
if (!db.jump.secret) db.jump.secret = crypto.randomBytes(24).toString('hex');
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); } catch (e) { log('db write', e.message); } }, 1500); }
process.on('SIGINT', () => { clearTimeout(saveT); try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} process.exit(0); });
function weekKey(d = new Date()) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); }
function pondCheck() { const w = weekKey(); if (db.pond.week !== w) { db.pond = { week: w, count: 0, stars: 0, donors: {} }; } }

/* ---------- БИТВА ВИДОВ ----------
   Недельное перетягивание каната: слияние за лягушек двигает шкалу вправо,
   за котов — влево. Двигать можно и звёздами: 1 звезда = STARS_PER_PULL слияний.
   Слияния приходят из того же проверенного delta, что и всё остальное в sync,
   так что накрутка режется там же и отдельной дыры тут не появляется. */
const STARS_PER_PULL = 5;
function warSideOf(b) { return (b && (b.c || 0) > (b.f || 0)) ? 'cat' : 'frog'; }
function warBucket(id) { return db.war.by[id] || (db.war.by[id] = { f: 0, c: 0, s: 0 }); }
function warPull(u, side, n) {
  if (!n) return;
  db.war[side] = (db.war[side] || 0) + n;
  const b = warBucket(u.id);
  b[side === 'frog' ? 'f' : 'c'] += n;
}
function warCheck() {
  const w = weekKey();
  if (db.war.week === w) return;
  // закрываем прошлый сезон: победа, награды участникам, история
  if (db.war.week && (db.war.frog || db.war.cat)) {
    const win = db.war.frog === db.war.cat ? 'draw' : (db.war.frog > db.war.cat ? 'frog' : 'cat');
    db.war.last = { week: db.war.week, frog: db.war.frog, cat: db.war.cat, win };
    for (const id of Object.keys(db.war.by)) {
      const u = db.users[id]; if (!u) continue;
      const b = db.war.by[id];
      if (!((b.f || 0) + (b.c || 0))) continue;      // награждаем только тех, кто реально тянул
      const side = warSideOf(b);
      const won = win === 'draw' || side === win;
      grant(u, won ? 'boost1d' : 'boost1h', 0);
      if (won) u.wild = (u.wild || 0) + 2;
      u.warPending = { week: db.war.week, win, side, frog: db.war.frog, cat: db.war.cat, mine: (b.f || 0) + (b.c || 0) };
    }
  }
  db.war = { week: w, frog: 0, cat: 0, stars: 0, by: {}, last: db.war.last || null };
}
function warTop(n = 5) {
  return Object.keys(db.war.by).map(id => {
    const b = db.war.by[id], u = db.users[id] || {};
    // строка подписана одной стороной (доминирующей) — число рядом должно быть про
    // ЭТУ сторону, а не сумму обеих: иначе тот, кто успел поддержать и тех и тех,
    // видит цифру, которая не сходится с подписью
    const side = warSideOf(b);
    return { id, name: u.name || 'Игрок', sp: side, n: (side === 'cat' ? b.c : b.f) || 0, hidden: !isRealPlayer(u) };
  }).filter(x => x.n > 0 && !x.hidden).sort((a, b) => b.n - a.n).slice(0, n)
    .map(x => ({ name: x.name, sp: x.sp, n: x.n }));
}
const warState = u => ({
  week: db.war.week, frog: db.war.frog || 0, cat: db.war.cat || 0, stars: db.war.stars || 0,
  perStar: STARS_PER_PULL, top: warTop(5), last: db.war.last || null,
  // подпись на клиенте всегда «за <текущий вид>» — цифра должна быть именно про
  // эту сторону, а не сумма обеих (иначе не сходится, если игрок успел поддержать
  // и тех и тех после переключения вида в течение недели)
  mine: u ? (spOf(u) === 'cat' ? (db.war.by[u.id] || {}).c : (db.war.by[u.id] || {}).f) || 0 : 0,
});
const dayKey = () => new Date().toISOString().slice(0, 10);

/* ---------- TELEGRAM API ---------- */
async function tg(method, params) {
  if (!CFG.token) throw new Error('no BOT_TOKEN');
  const r = await fetch(`https://api.telegram.org/bot${CFG.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
function checkInitData(initData) {
  // без токена секрет вырождается в HMAC('WebAppData','') — известную всем константу,
  // и initData можно подделать под любой user.id. Без токена доверять подписи нельзя вообще
  if (!CFG.token) return null;
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash'); if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(CFG.token).digest();
  const h = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (h !== hash) return null;
  if (Date.now() / 1000 - (+p.get('auth_date') || 0) > DAY / 1000) return null;
  try { return JSON.parse(p.get('user') || 'null'); } catch (e) { return null; }
}
function authUser(body, req) {
  if (CFG.token) { const u = checkInitData(body.initData); if (u) return { id: String(u.id), name: u.first_name || u.username || 'Игрок', username: u.username || '', real: true }; }
  if (CFG.dev && body.dev) { const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x').split(',')[0].trim(); const id = 'dev-' + crypto.createHash('md5').update(ip).digest('hex').slice(0, 8); return { id, name: body.name || 'Dev', username: '', real: false }; }
  return null;
}
function getUser(a) {
  const u = db.users[a.id] || (db.users[a.id] = { id: a.id, name: a.name, username: a.username, maxLv: 1, score: 0, merges: 0, taps: 0, coins: 0, inv: {}, wild: 0, created: Date.now() });
  u.name = a.name || u.name; u.username = a.username || u.username; u.lastSeen = Date.now(); return u;
}

/* ---------- HOLDER CHECK (getUserGifts) ---------- */
async function checkHolder(u, real) {
  if (!CFG.token || !real) return;
  if (!u.holderBySp) u.holderBySp = {};
  // холдерство — это факт владения подарком, а не текущий игровой режим: холдер
  // Scared Cat остаётся холдером кота, даже если сейчас играет за лягушек. Поэтому
  // проверяем ОБА подарка за один and тот же вызов getUserGifts, а не только тот,
  // что соответствует активному сейчас виду — иначе кэш под одним видом молча стирал
  // то, что было известно про другой
  if (u.holderCheckedAt && Date.now() - u.holderCheckedAt < DAY) { u.holder = (u.holderBySp[spOf(u)] || {}).data || null; return; }
  try {
    let offset = '', bySp = { frog: [], cat: [] };
    for (let i = 0; i < 5; i++) {
      const r = await tg('getUserGifts', { user_id: +u.id, exclude_unlimited: true, exclude_limited_non_upgradable: true, offset, limit: 100 });
      for (const g of r.gifts || []) {
        if (g.type !== 'unique' || !g.gift) continue;
        for (const sp of ['frog', 'cat']) {
          if (g.gift.base_name !== GIFT[sp]) continue;
          const model = g.gift.model && g.gift.model.name;
          // игрок может владеть несколькими лягушками/котами — забираем все, вместе с бэкдропами
          bySp[sp].push({
            model, level: levelByName(model, sp), name: g.gift.name, number: g.gift.number,
            rarity: g.gift.model && g.gift.model.rarity_per_mille / 10,
            backdrop: g.gift.backdrop && g.gift.backdrop.name || null,
          });
        }
      }
      offset = r.next_offset || ''; if (!offset) break;
    }
    // кэш на сутки ставим только теперь, когда запрос реально прошёл — если бы это
    // стояло до try (как было раньше), одна упавшая проверка (сеть, рейт-лимит
    // Telegram) на сутки замораживала бы «не холдер» для настоящего холдера: сервер
    // отвечал бы null, клиент честно разбирал его персональную лестницу обратно —
    // и выглядело это как «поле 50 уровня сбрасывается на каждый вход»
    u.holderCheckedAt = Date.now();
    for (const sp of ['frog', 'cat']) {
      // дубли по модели схлопываем, самая редкая — первой
      const list = [...new Map(bySp[sp].map(f => [f.model + '#' + f.number, f])).values()].sort((a, b) => b.level - a.level);
      const top = list[0] || null;
      const data = top ? { model: top.model, level: top.level, backdrop: top.backdrop, frogs: list } : null;
      u.holderBySp[sp] = { at: Date.now(), data };
      // в чат холдеров зовём один раз и только того, у кого лягушка действительно есть
      if (top && !u.holdersInvited && sp === 'frog') {   // чата холдеров котов пока нет
        u.holdersInvited = Date.now();
        const names = list.map(f => f.model).join(', ');
        try {
          await tg('sendMessage', {
            chat_id: +u.id, parse_mode: 'HTML',
            text: `${em('crown')} У тебя есть ${list.length > 1 ? 'лягушки' : 'лягушка'}: <b>${names}</b>.\n` +
                  `Тебе открыт чат холдеров — туда пускают только владельцев.`,
            reply_markup: { inline_keyboard: [[{ text: 'Чат холдеров', url: CFG.holdersLink }], [{ text: EMO_BTN + 'Играть', url: CFG.appLink }]] },
          });
        } catch (e) { log('holders invite', u.id, e.message); }
      }
    }
    // легаси-поле для ладдер-персонализации и покупки фонов — те завязаны на ТЕКУЩИЙ
    // вид игрока (переставить лестницу под лягушку нужно по лягушачьему подарку)
    u.holder = (u.holderBySp[spOf(u)] || {}).data || null;
  } catch (e) { log('getUserGifts', u.id, e.message); }
}

/* ---------- LEADERBOARD ---------- */
// dev-* — это локальные тестовые входы без подписи Telegram, в общий зачёт они не идут;
// hidden ставится вручную из админки
const isRealPlayer = u => !u.hidden && !String(u.id).startsWith('dev-');
function leaderboard() {
  return Object.values(db.users).filter(u => isRealPlayer(u) && (u.score > 0 || u.maxLv > 1)).sort((a, b) => b.score - a.score || b.maxLv - a.maxLv);
}
// холдерство — это то, чем игрок реально владеет, а не то, за кого он сейчас играет:
// холдер кота остаётся холдером кота в топе, даже переключившись на лягушек.
// Если владеет обоими — лягушка в приоритете просто как более старый/основной подарок игры
function holderOf(u) {
  const b = u.holderBySp || {};
  if (b.frog && b.frog.data) return { sp: 'frog', data: b.frog.data };
  if (b.cat && b.cat.data) return { sp: 'cat', data: b.cat.data };
  // holderBySp появилось только что и заполняется по мере того, как у игроков
  // проходит собственный sync (проверка раз в 24 часа) — до тех пор он пуст у всех,
  // кто не заходил в игру именно с этого момента. Пока свежих данных нет,
  // не теряем то, что уже знали раньше через старое общее поле u.holder
  if (u.holder) return { sp: spOf(u), data: u.holder };
  return null;
}
function topRows(n = 20) {
  return leaderboard().slice(0, n).map((u, i) => {
    const h = holderOf(u);
    return { rank: i + 1, id: u.id, name: u.name, sp: spOf(u), maxLv: u.maxLv, score: u.score, holder: h ? h.data.model : null, holderSp: h ? h.sp : null, sub: (u.inv && u.inv.subUntil || 0) > Date.now() };
  });
}
// топ серий: у кого дальше всех зашла одна серия в бесконечном режиме
function endlessTop(n = 20) {
  return Object.values(db.users)
    .filter(u => isRealPlayer(u) && u.endless && u.endless.best > 1)
    .sort((a, b) => b.endless.best - a.endless.best || (b.endless.bestScore || 0) - (a.endless.bestScore || 0))
    .slice(0, n)
    .map((u, i) => ({ rank: i + 1, id: u.id, name: u.name, sp: u.endless.bestSp || spOf(u), best: u.endless.best, score: u.endless.bestScore || 0 }));
}
const endlessState = u => ({
  record: db.endless.record || null,
  price: revivePrice(u),
  mine: u && u.endless ? { best: u.endless.best || 0, score: u.endless.bestScore || 0, runs: u.endless.runs || 0 } : null,
});
async function announceRecord(u, best, prev) {
  if (!CFG.token || !CFG.chatId) return;
  const who = esc(u.name || 'Игрок');
  const side = spOf(u) === 'cat' ? 'котами' : 'лягушками';
  const tail = prev && prev.best ? `\nПрошлый рекорд — ${prev.best} уровень (${esc(prev.name || 'игрок')}).` : '';
  await tg('sendMessage', {
    chat_id: CFG.chatId, parse_mode: 'HTML',
    text: `${em('trophy')} <b>Новый рекорд бесконечной серии!</b>\n` +
          `${who} дошёл до <b>${best} уровня</b> за ${side}.${tail}`,
    reply_markup: playKb(), disable_notification: true,
  });
}
function rankOf(id) { const i = leaderboard().findIndex(u => u.id === id); return i < 0 ? null : i + 1; }

/* ---------- FROG JUMP ----------
   Номер забега — подписанный токен {uid, t0, base}, а не запись в памяти: переживает
   перезапуск сервера. Повтор отсекается тем, что t0 каждого принятого забега строго
   больше предыдущего (у игрока забеги идут по очереди).
   base — высота, с которой начат отрезок: после оплаченного продолжения второй отрезок
   стартует с высоты, где оборвался первый, и лимиты считаются только на прирост. */
function jumpRec(u) { return u.jump || (u.jump = { best: 0, flies: 0, runs: 0, total: 0, revPaid: 0, revUsed: 0, lastT0: 0, lastH: 0, lastAt: 0 }); }
const jumpSign = str => crypto.createHmac('sha256', db.jump.secret).update(str).digest('hex').slice(0, 24);
function jumpToken(uid, t0, base) { const p = `${uid}.${t0}.${base}`; return `${p}.${jumpSign(p)}`; }
function jumpParse(tok) {
  const m = String(tok || '').match(/^([^.]+)\.(\d+)\.(\d+)\.([0-9a-f]{24})$/);
  if (!m) return null;
  const p = `${m[1]}.${m[2]}.${m[3]}`;
  const a = Buffer.from(jumpSign(p)), b = Buffer.from(m[4]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { uid: m[1], t0: +m[2], base: +m[3] };
}
/* ---------- НАРЯДЫ ПРЫГУНА ----------
   Наряд — это модель Kissed Frog: та же лягушка, которой играют в слиянии.
   До 2% редкости включительно продаются за мошек (их зарабатывают в самих
   прыжках), всё, что реже, — за звёзды. Мошками можно сбить цену звёздного
   наряда, но не больше чем на 60%: иначе звёзды перестают что-то значить.
   Свой подарок холдера открыт бесплатно — он и так его владелец. */
const SKIN_FLIES_MAX_R = 2;         // редкость, до которой наряд стоит мошек
const FLIES_PER_STAR = 50;          // курс мошек при скидке
const SKIN_DISC_MAX = 0.6;          // больше 60% цены мошками не сбить
function skinAt(i) {
  const L = LADDER.frog[i], lv = i + 1, last = LADDER.frog.length;
  const o = { lv, slug: L.f, name: L.n, r: L.r, flies: 0, stars: 0 };
  if (L.r >= SKIN_FLIES_MAX_R) {
    // Мошек падает много (потолок 900 в час), поэтому наряд должен стоить
    // десятков забегов, иначе половина витрины скупается за вечер и копить
    // становится незачем
    o.flies = Math.round((400 + (6000 - 400) * ((lv - 1) / 24)) / 50) * 50;
  } else {
    // Happy Pepe — вершина лестницы и самый дорогой наряд игры
    o.stars = lv === last ? 499 : Math.round(40 + (350 - 40) * ((lv - 26) / (last - 27)));
  }
  return o;
}
// «Обычная» лягушка есть у всех и всегда: к ней можно вернуться в любой момент
const SKINS = [{ lv: 0, slug: 'original', name: 'Обычная', r: 0, flies: 0, stars: 0, free: true }]
  .concat(LADDER.frog.map((_, i) => skinAt(i)));
const skinBySlug = slug => SKINS.find(s => s.slug === slug) || null;
function holderModels(u) {
  const h = (u.holderBySp && u.holderBySp.frog && u.holderBySp.frog.data) || (spOf(u) === 'frog' ? u.holder : null);
  return ((h && h.frogs) || []).map(f => String(f.model || '').toLowerCase());
}
function skinsFor(u) {
  const j = jumpRec(u), own = j.skins || [], hold = holderModels(u);
  return SKINS.map(s => {
    const holder = hold.includes(s.name.toLowerCase());
    const owned = holder || own.includes(s.slug) || s.slug === 'original';
    const disc = s.stars ? Math.min(Math.floor(s.stars * SKIN_DISC_MAX), Math.floor((j.flies || 0) / FLIES_PER_STAR)) : 0;
    return { ...s, owned, holder, disc, discFlies: disc * FLIES_PER_STAR };
  });
}
function jumpTop(n = 20) {
  return Object.values(db.users)
    .filter(u => isRealPlayer(u) && u.jump && u.jump.best > 0)
    .sort((a, b) => b.jump.best - a.jump.best)
    .slice(0, n)
    .map((u, i) => ({ rank: i + 1, id: u.id, name: u.name, best: u.jump.best }));
}
const jumpState = u => {
  const j = u ? jumpRec(u) : null;
  return {
    record: db.jump.record || null, best: j ? j.best || 0 : 0, flies: j ? j.flies || 0 : 0, runs: j ? j.runs || 0 : 0,
    skin: j ? (j.skin || 'original') : 'original', skins: j ? (j.skins || []) : [],
    shield: j ? (j.shield || 0) : 0, boost: j ? (j.boost || 0) : 0,
    // сколько нарядов игрок может позволить себе прямо сейчас — по этому числу
    // хаб зажигает ненавязчивую точку «появилось что-то новое»
    canBuy: u ? skinsFor(u).filter(s => !s.owned && s.flies && s.flies <= (j.flies || 0)).length : 0,
  };
};
async function announceJumpRecord(u, h, prev) {
  if (!CFG.token || !CFG.chatId) return;
  const tail = prev && prev.best ? `\nПрошлый рекорд — ${prev.best} м (${esc(prev.name || 'игрок')}).` : '';
  await tg('sendMessage', {
    chat_id: CFG.chatId, parse_mode: 'HTML',
    text: `${em('trophy')} <b>Новый рекорд Frog Jump!</b>\n${esc(u.name || 'Игрок')} допрыгал до <b>${h} м</b>.${tail}`,
    reply_markup: playKb(), disable_notification: true,
  });
}

/* ---------- RATE LIMIT (простое скользящее окно в памяти, без зависимостей) ---------- */
const rateBuckets = new Map();
function rateLimited(key, max, windowMs) {
  const t = Date.now();
  let b = rateBuckets.get(key);
  if (!b || t - b.start > windowMs) { b = { start: t, count: 0 }; rateBuckets.set(key, b); }
  b.count++;
  return b.count > max;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of rateBuckets) if (t - b.start > 3600e3) rateBuckets.delete(k); }, 600e3);
// замок на разовые счета: userId:item -> когда истекает. Снимается оплатой или по таймауту
const pendingInvoices = new Map();
setInterval(() => { const t = Date.now(); for (const [k, until] of pendingInvoices) if (until < t) pendingInvoices.delete(k); }, 60e3);
const clientIp = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x').split(',')[0].trim();
// сравнение ключа не должно занимать разное время в зависимости от того, сколько символов совпало —
// иначе тайминг ответа сам по себе подсказывает, где именно ключ подобран верно
function safeKeyEqual(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ---------- API ---------- */
const CARDS = path.join(__dirname, 'cards'); fs.mkdirSync(CARDS, { recursive: true });
const api = {
  async sync(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    const u = getUser(a); pondCheck(); warCheck();
    if (body.species === 'cat' || body.species === 'frog') u.species = body.species;
    const L = ladderOf(u);
    // мерджи — монотонный счётчик. Раньше при рывке дельту только помечали флагом,
    // но сам мердж всё равно принимался целиком — можно было одним запросом заявить
    // maxLv=50 без единого реального слияния. Теперь лишнее не флагом отмечается, а обрезается.
    // Точка отсчёта — не только последний sync, но и момент создания аккаунта: иначе самый
    // первый вызов (u.syncAt ещё не установлен) вообще ничем не ограничен, а отличить его
    // от подделанного первого вызова читера снаружи нечем
    const rec = spRec(u);
    const dt = Math.max(1, (Date.now() - (u.syncAt || u.created || Date.now())) / 1000);
    const maxDelta = Math.ceil(dt * 3 + 30);
    // клиент шлёт не абсолютный итог, а сколько слияний случилось с прошлой удачной
    // синхронизации (тот же принцип, что у wildUsed) — раньше слался абсолютный
    // счётчик, и сервер вычислял дельту вычитанием из своей памяти; если локальное
    // число оказывалось НИЖЕ, чем сервер уже помнил (после переключения вида, сброса
    // прогресса, другого устройства — сейв-то на клиенте свой на каждый вид), дельта
    // уходила в минус, обрезалась до нуля, и слияния переставали засчитываться молча
    let delta = Math.max(0, Math.min(+body.mergesDelta || 0, 1e6));
    if (delta > maxDelta) { u.flags = (u.flags || 0) + 1; delta = maxDelta; }
    rec.merges = (rec.merges || 0) + delta;
    u.merges = (u.merges || 0) + delta;
    db.pond.count += delta;
    warPull(u, spOf(u), delta);   // то же проверенное delta тянет шкалу битвы
    // maxLv и score не берутся с потолка: механика слияний сама задаёт им верхнюю границу —
    // каждый мердж поднимает лягушку ровно на 1 уровень и добавляет в очки её новый уровень,
    // так что без merges такого maxLv/score попросту не бывает
    const maxLv = Math.max(1, Math.min(+body.maxLv || 1, L.length, rec.merges + 1));
    if (maxLv > (rec.maxLv || 1)) { rec.maxLv = maxLv; const r = L[maxLv - 1].r; if (r <= 1) db.events.push({ t: Date.now(), id: u.id, name: u.name, lv: maxLv, frog: L[maxLv - 1].n, r, sp: spOf(u) }); }
    u.maxLv = rec.maxLv || 1;   // в витрине показываем уровень того вида, за который играют сейчас
    const scoreCap = rec.merges * L.length;
    rec.score = Math.max(rec.score || 0, Math.min(+body.score || 0, 1e9, scoreCap));
    u.score = sumScore(u);      // в топе — сумма по всем видам, переключение не обнуляет позицию
    u.taps = Math.max(u.taps || 0, Math.min(+body.taps || 0, 1e9));
    u.coins = Math.max(0, Math.min(+body.coins || 0, 1e15)) || 0; // без потолка Infinity бьёт JSON.stringify в null
    u.theme = body.theme || '';
    // дикие лягушки: клиент шлёт не остаток, а сколько штук потратил с прошлой удачной
    // синхронизации (и сам обнуляет свой счётчик после успешного ответа — см. index.html).
    // Раньше слался абсолютный остаток, и «Сбросить прогресс» на клиенте (state.wild=0)
    // выглядел как «потратил всё» и стирал реально купленный за звёзды запас
    const wildUsed = Math.max(0, Math.min(+body.wildUsed || 0, 1e6));
    u.wild = Math.max(0, (u.wild || 0) - wildUsed);
    // ---- бесконечный режим: результат серии и общий рекорд ----
    const e = u.endless || (u.endless = {});
    if (body.runNew) { e.cont = 0; }   // началась новая серия — счётчик возвратов с нуля
    if (body.runOver) {
      // уровень серии ограничен теми же слияниями: без них такого уровня не бывает
      const best = Math.max(1, Math.min(+body.runBest || 1, rec.merges + 1, 999));
      // очки серии тоже не с потолка: каждое слияние даёт не больше уровня,
      // до которого серия дошла, а слияний в серии не больше, чем всего у вида
      const runScore = Math.max(0, Math.min(+body.runScore || 0, 1e9, rec.merges * best));
      if (best > (e.best || 0)) { e.best = best; e.bestScore = runScore; e.bestAt = Date.now(); e.bestSp = spOf(u); }
      e.runs = (e.runs || 0) + 1;
      const r0 = db.endless.record;
      if (!r0 || best > r0.best) {
        db.endless.record = { id: u.id, name: u.name, sp: spOf(u), best, score: runScore, at: Date.now() };
        if (isRealPlayer(u)) announceRecord(u, best, r0).catch(() => {});
      }
    }
    const reviveUsed = Math.max(0, Math.min(+body.reviveUsed || 0, 100));
    if (reviveUsed && u.inv) u.inv.reviveLeft = Math.max(0, (u.inv.reviveLeft || 0) - reviveUsed);
    u.syncAt = Date.now();
    await checkHolder(u, a.real);
    const doneKey = 'holderDone_' + spOf(u);
    if (u.holder && u.holder.level && u.holder.level <= u.maxLv && !u[doneKey]) { u[doneKey] = Date.now(); db.events.push({ t: Date.now(), id: u.id, name: u.name, lv: u.holder.level, frog: u.holder.model, r: L[u.holder.level - 1]?.r, own: true, sp: spOf(u) }); }
    save();
    // итог прошлого сезона отдаём, пока клиент не подтвердит, что показал его
    if (body.warAck && u.warPending && String(body.warAck) === String(u.warPending.week)) delete u.warPending;
    return { ok: true, me: { id: u.id, rank: rankOf(u.id), score: u.score }, top: topRows(20), pond: { count: db.pond.count, goal: CFG.pondGoal, stars: db.pond.stars }, war: warState(u), warResult: u.warPending || null, endless: endlessState(u), endlessTop: endlessTop(20), jump: jumpState(u), jumpTop: jumpTop(20), holder: u.holder || null, inv: u.inv || {}, wild: u.wild || 0, appLink: CFG.appLink };
  },
  async leaderboard() { pondCheck(); warCheck(); return { ok: true, top: topRows(50), pond: { count: db.pond.count, goal: CFG.pondGoal }, war: warState(null), endlessTop: endlessTop(50), endless: endlessState(null), jumpTop: jumpTop(50), jump: jumpState(null) }; },
  // старт забега (или его продолжения после оплаты) — выдаём подписанный номер
  async jumpStart(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    if (rateLimited('jump:' + a.id, 60, 3600e3)) return { ok: false, error: 'Слишком часто' };
    const u = getUser(a); const j = jumpRec(u);
    let base = 0;
    if (body.cont) {
      // продолжение — за оплату или за страховку, и только сразу после обрыва
      if (Date.now() - (j.lastAt || 0) > 15 * 60e3) return { ok: false, error: 'Забег уже закрыт' };
      if (body.insurance) {
        if (!(j.shield > 0)) return { ok: false, error: 'wait' };
        j.shield--;
      } else {
        if ((j.revPaid || 0) <= (j.revUsed || 0)) return { ok: false, error: 'wait' };
        j.revUsed = (j.revUsed || 0) + 1;
      }
      base = j.lastH || 0;
    } else if (body.boost) {
      // разгон: начинаем сразу с половины личного рекорда
      if (!(j.boost > 0)) return { ok: false, error: 'wait' };
      j.boost--;
      base = Math.floor((j.best || 0) / 2);
    }
    const t0 = Math.max(Date.now(), (j.lastT0 || 0) + 1);
    save();
    return { ok: true, run: jumpToken(u.id, t0, base), base, jump: jumpState(u), jumpTop: jumpTop(10) };
  },
  // каталог нарядов прыгуна
  async jumpSkins(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    const u = getUser(a);
    await checkHolder(u, a.real);
    return { ok: true, skins: skinsFor(u), jump: jumpState(u), perStar: FLIES_PER_STAR };
  },
  // наряд за мошек (звёздные идут обычным счётом через invoice)
  async jumpBuySkin(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    const u = getUser(a); const j = jumpRec(u);
    const s = skinBySlug(String(body.slug || ''));
    if (!s || !s.flies) return { ok: false, error: 'Этот наряд за звёзды' };
    if ((j.skins || []).includes(s.slug)) return { ok: false, error: 'Уже есть' };
    if ((j.flies || 0) < s.flies) return { ok: false, error: `Не хватает мошек: нужно ${s.flies}` };
    j.flies -= s.flies;
    (j.skins || (j.skins = [])).push(s.slug);
    j.skin = s.slug;
    save();
    return { ok: true, jump: jumpState(u), skins: skinsFor(u) };
  },
  async jumpSetSkin(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    const u = getUser(a); const j = jumpRec(u);
    const slug = String(body.slug || 'original');
    if (slug !== 'original') {
      await checkHolder(u, a.real);
      const s = skinsFor(u).find(x => x.slug === slug);
      if (!s || !s.owned) return { ok: false, error: 'Наряд ещё не твой' };
    }
    j.skin = slug; save();
    return { ok: true, jump: jumpState(u) };
  },
  // конец отрезка забега: проверяем правдоподобие, начисляем мошек, обновляем рекорды
  async jumpEnd(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    const u = getUser(a); const j = jumpRec(u);
    const run = jumpParse(body.run);
    if (!run || run.uid !== u.id) return { ok: false, error: 'run' };
    if (run.t0 <= (j.lastT0 || 0)) return { ok: false, error: 'Этот забег уже засчитан' };
    const now = Date.now();
    const sec = Math.max(0, Math.min(+body.ms || 0, now - run.t0 + 3000)) / 1000;
    // потолки с большим запасом: пружины, стрекоза и слияния лотосов дают рывки,
    // но в среднем быстрее ~40 м/с не подняться; мошек на такой высоте тоже конечное число
    const rawH = Math.max(0, Math.round(+body.height || 0));
    const gainCap = Math.round(70 * sec + 300);
    let gain = Math.max(0, rawH - run.base);
    if (gain > gainCap) { u.flags = (u.flags || 0) + 1; gain = gainCap; }
    const h = run.base + gain;
    const fliesCap = Math.round(gain * 0.25 + sec * 2 + 30);
    let flies = Math.max(0, Math.round(+body.flies || 0));
    if (flies > fliesCap) { u.flags = (u.flags || 0) + 1; flies = fliesCap; }
    j.lastT0 = run.t0; j.lastH = h; j.lastAt = now;
    // потолок начисления в час: даже если крутить «старт-конец» в цикле, каждый
    // вызов даёт немного мошек, а за час их всё равно не станет больше этого
    const hour = Math.floor(now / 3600e3);
    if (j.hour !== hour) { j.hour = hour; j.hourFlies = 0; }
    const left = Math.max(0, 900 - (j.hourFlies || 0));
    flies = Math.min(flies, left);
    j.hourFlies = (j.hourFlies || 0) + flies;
    j.flies = (j.flies || 0) + flies;
    j.total = (j.total || 0) + flies;
    if (!run.base) j.runs = (j.runs || 0) + 1;
    const prevBest = j.best || 0;
    const isBest = h > prevBest;
    if (isBest) { j.best = h; j.bestAt = now; }
    let isRecord = false;
    const r0 = db.jump.record;
    if (isRealPlayer(u) && (!r0 || h > r0.best)) {
      isRecord = true;
      db.jump.record = { id: u.id, name: u.name, best: h, at: now };
      if (h >= 200) announceJumpRecord(u, h, r0).catch(() => {});
    }
    save();
    const top = jumpTop(50);
    const rank = top.findIndex(r => r.id === u.id) + 1 || null;
    return { ok: true, height: h, earned: flies, isBest, prevBest, isRecord, rank, jump: jumpState(u), jumpTop: top.slice(0, 20) };
  },
  async invoice(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    const u = getUser(a);
    let it = shopItem(body.item, spOf(u));
    // фон продаётся только тот, который реально стоит на лягушке игрока
    if (!it && String(body.item).startsWith('bd:')) {
      const bd = String(body.item).slice(3);
      await checkHolder(u, a.real);
      const owns = ((u.holder && u.holder.frogs) || []).some(f => f.backdrop === bd);
      if (!owns) return { ok: false, error: 'Этот фон не с твоего подарка' };
      it = { title: `Фон «${bd}»`, desc: `Бэкдроп твоего подарка ${GIFT[spOf(u)]}`, price: BD_PRICE, backdrop: bd };
    }
    // наряд прыгуна: цена по редкости, мошками можно сбить максимум 60%
    if (!it && String(body.item).startsWith('skin:')) {
      const j = jumpRec(u), s = skinBySlug(String(body.item).slice(5));
      if (!s || !s.stars) return { ok: false, error: 'Нет такого наряда' };
      if ((j.skins || []).includes(s.slug)) return { ok: false, error: 'Уже куплено' };
      // пока висит неоплаченный счёт на этот наряд, второй не выставляем:
      // иначе можно оплатить оба и получить один наряд за двойную цену
      const lock = `${u.id}:skin:${s.slug}`;
      const until = pendingInvoices.get(lock);
      if (until && until > Date.now()) return { ok: false, error: 'Счёт уже выставлен — заверши его или подожди пару минут' };
      pendingInvoices.set(lock, Date.now() + 5 * 60e3);
      const maxDisc = Math.min(Math.floor(s.stars * SKIN_DISC_MAX), Math.floor((j.flies || 0) / FLIES_PER_STAR));
      const disc = body.useFlies ? maxDisc : 0;
      j.pendDisc = disc ? { slug: s.slug, flies: disc * FLIES_PER_STAR, at: Date.now() } : null;
      it = { title: `Наряд «${s.name}»`, desc: `Frog Jump: облик ${s.name}, редкость ${String(s.r).replace('.', ',')}%`, price: Math.max(1, s.stars - disc) };
    }
    if (!it) return { ok: false, error: 'Нет такого товара' };
    if (it.once && u.inv && u.inv[it.once]) return { ok: false, error: 'Уже куплено' };
    if (it.backdrop && u.inv && (u.inv.themes || []).includes(it.backdrop)) return { ok: false, error: 'Уже куплено' };
    // для разового товара нельзя создавать второй счёт, пока висит неоплаченный первый —
    // иначе оба можно оплатить (звёзды спишутся дважды), а выдастся всё равно один раз
    const lockKey = it.once || it.backdrop ? `${u.id}:${body.item}` : null;
    if (lockKey) { const until = pendingInvoices.get(lockKey); if (until && until > Date.now()) return { ok: false, error: 'Счёт уже выставлен — заверши его или подожди пару минут' }; }
    let price = it.price;
    if (it.donate || it.warPush) { price = Math.round(+body.amount || 0); if (price < 1 || price > 500) return { ok: false, error: 'Сумма от 1 до 500 звёзд' }; }
    if (body.item === 'revive') price = revivePrice(u);   // цену возврата считает сервер, а не клиент
    // reviveReturn — фикс-цена из SHOP выше, дальше не трогаем
    if (!CFG.token) return { ok: false, error: 'Сервер без BOT_TOKEN: платежи недоступны' };
    const nonce = crypto.randomBytes(4).toString('hex');
    const params = { title: it.title.slice(0, 32), description: it.desc.slice(0, 255), payload: `${body.item}:${u.id}:${price}:${nonce}`, provider_token: '', currency: 'XTR', prices: [{ label: it.title.slice(0, 32), amount: price }] };
    if (it.sub) params.subscription_period = 2592000;
    try {
      const link = await tg('createInvoiceLink', params);
      if (lockKey) pendingInvoices.set(lockKey, Date.now() + 5 * 60e3);
      return { ok: true, link };
    } catch (e) { log('invoice', e.message); return { ok: false, error: 'Не удалось создать счёт' }; }
  },
  async card(body, req) {
    const a = authUser(body, req); if (!a) return { ok: false, error: 'auth' };
    // без лимита можно закидать диск картинками быстрее, чем их успевает подчищать 2-дневная уборка
    if (rateLimited('card:' + a.id, 15, 3600e3)) return { ok: false, error: 'Слишком часто. Попробуй через час' };
    const png = String(body.png || ''); if (png.length < 100 || png.length > 6e6) return { ok: false, error: 'bad image' };
    const buf = Buffer.from(png, 'base64');
    const isPng = buf.slice(1, 4).toString() === 'PNG';
    const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
    if (!isPng && !isJpg) return { ok: false, error: 'not an image' };
    const id = `${a.id}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${isPng ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(CARDS, id), buf);
    const url = `${CFG.appUrl}/cards/${id}`;
    const lv = Math.max(1, Math.min(+body.lv || 1, LEVELS.length)); const L = LEVELS[lv - 1];
    const res = { ok: true, url };
    // карточка рекорда Frog Jump: своя подпись и ссылка, которая открывает сразу прыжки
    const jumpH = Math.max(0, Math.round(+body.jump || 0));
    if (jumpH && body.kind === 'chat' && CFG.token && a.real) {
      try {
        const r = await tg('savePreparedInlineMessage', {
          user_id: +a.id, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: false, allow_bot_chats: false,
          result: { type: 'photo', id: crypto.randomBytes(6).toString('hex'), photo_url: url, thumbnail_url: url, photo_width: 1200, photo_height: 675,
            caption: `Я допрыгал до ${jumpH} м в Frog Jump. Побьёшь?`,
            reply_markup: { inline_keyboard: [[{ text: 'Прыгать в Frog Jump', url: CFG.appLink.replace('startapp=chat', 'startapp=jump') }]] } },
        });
        res.prepared_id = r.id;
      } catch (e) { log('prepared jump', e.message); res.error = e.message; }
      return res;
    }
    if (body.kind === 'chat' && CFG.token && a.real) {
      try {
        const story = false;
        const r = await tg('savePreparedInlineMessage', {
          user_id: +a.id, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: false, allow_bot_chats: false,
          result: { type: 'photo', id: crypto.randomBytes(6).toString('hex'), photo_url: url, thumbnail_url: url, photo_width: story ? 1080 : 1200, photo_height: story ? 1920 : 675,
            // тег tg-emoji тут не сработает: сообщение уходит от лица пользователя через
            // inline-механизм, а не как прямое сообщение бота — Telegram молча подменит его на обычный юникод
            caption: `🐸 Я вырастил ${L.n} — уровень ${lv} из ${LEVELS.length}, редкость ${String(L.r).replace('.', ',')}%

Попробуй тоже 👇`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: EMO_BTN + 'Играть в SWAMP', url: CFG.appLink }]] } },
        });
        res.prepared_id = r.id;
      } catch (e) { log('prepared', e.message); res.error = e.message; }
    }
    // чистим старые карточки (старше 2 дней)
    try { for (const f of fs.readdirSync(CARDS)) { const p = path.join(CARDS, f); if (Date.now() - fs.statSync(p).mtimeMs > 2 * DAY) fs.unlinkSync(p); } } catch (e) {}
    return res;
  },

  /* ---------- АДМИНКА ---------- */
  async admin(body, req) {
    // подбор ключа перебором иначе ничем не ограничен — это публичный HTTP-эндпоинт
    if (rateLimited('admin:' + clientIp(req), 20, 60e3)) return { ok: false, error: 'Слишком много попыток, подожди минуту' };
    // пускаем двумя путями: по ключу из .env либо по своему Telegram ID,
    // если админка открыта прямо из Mini App под аккаунтом владельца.
    // сравнение ключа — константное по времени: обычное === выдаёт тайминг-сигнал о том,
    // сколько символов совпало, чем можно подбирать ключ посимвольно
    const byKey = safeKeyEqual(body.key, CFG.adminKey);
    const tgUser = checkInitData(body.initData);
    const byTg = tgUser && CFG.adminId && String(tgUser.id) === String(CFG.adminId);
    if (!byKey && !byTg) return { ok: false, error: 'Нет доступа' };
    pondCheck();
    const t = Date.now();
    const all = Object.values(db.users);
    const act = body.act || 'stats';

    if (act === 'stats') {
      const paid = db.payments.reduce((s, p) => s + (p.stars || 0), 0);
      return {
        ok: true,
        stats: {
          players: all.filter(isRealPlayer).length,
          test: all.length - all.filter(isRealPlayer).length,
          today: all.filter(u => t - (u.lastSeen || 0) < DAY).length,
          holders: all.filter(u => Object.values(u.holderBySp || {}).some(h => h.data && (h.data.frogs || []).length)).length,
          merges: all.reduce((s, u) => s + (u.merges || 0), 0),
          stars: paid,
          payments: db.payments.length,
          pond: { count: db.pond.count, goal: CFG.pondGoal, stars: db.pond.stars, week: db.pond.week },
          war: { frog: db.war.frog || 0, cat: db.war.cat || 0, stars: db.war.stars || 0, week: db.war.week, last: db.war.last || null, top: warTop(8) },
          endless: { record: db.endless.record || null },
          broadcast: db.broadcast || null,
          adminChatId: CFG.adminId || '',
          digestDay: db.digest.day || '—',
          chatId: CFG.chatId || '', botOn: !!CFG.token,
        },
      };
    }

    if (act === 'players') {
      const rows = all
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .map(u => ({
          id: u.id, name: u.name || '', username: u.username || '',
          maxLv: u.maxLv || 1, score: u.score || 0, coins: u.coins || 0,
          merges: u.merges || 0, taps: u.taps || 0, wild: u.wild || 0,
          holder: Object.values(u.holderBySp || {}).flatMap(h => (h.data && h.data.frogs) || []).map(f => f.model).join(', '),
          sub: (u.inv && u.inv.subUntil || 0) > t,
          spent: db.payments.filter(p => p.id === u.id).reduce((s, p) => s + (p.stars || 0), 0),
          lastSeen: u.lastSeen || 0, created: u.created || 0,
          hidden: !!u.hidden, test: String(u.id).startsWith('dev-'), flags: u.flags || 0,
        }));
      return { ok: true, players: rows };
    }

    if (act === 'payments') {
      return { ok: true, payments: db.payments.slice(-200).reverse().map(p => ({ ...p, name: (db.users[p.id] || {}).name || p.id })) };
    }

    // --- действия, меняющие данные ---
    const u = body.id ? db.users[body.id] : null;
    if (act === 'hide' || act === 'show') {
      if (!u) return { ok: false, error: 'Игрок не найден' };
      u.hidden = act === 'hide'; save();
      return { ok: true, msg: u.hidden ? 'Скрыт из лидерборда' : 'Возвращён в лидерборд' };
    }
    if (act === 'wipe') {
      if (!u) return { ok: false, error: 'Игрок не найден' };
      Object.assign(u, { maxLv: 1, score: 0, merges: 0, taps: 0, coins: 0, wild: 0, bySp: {} });
      save();
      return { ok: true, msg: 'Прогресс обнулён (покупки не тронуты)' };
    }
    if (act === 'delete') {
      if (!u) return { ok: false, error: 'Игрок не найден' };
      delete db.users[body.id]; save();
      return { ok: true, msg: 'Игрок удалён' };
    }
    if (act === 'grant') {
      if (!u) return { ok: false, error: 'Игрок не найден' };
      const item = String(body.item || '');
      if (!SHOP[item] && !item.startsWith('bd:') && !item.startsWith('skin:')) return { ok: false, error: 'Нет такого товара' };
      grant(u, item, +body.amount || 0); save();
      return { ok: true, msg: 'Выдано: ' + ((SHOP[item] || {}).title || item) };
    }
    if (act === 'cleanTest') {
      let n = 0;
      for (const id of Object.keys(db.users)) if (String(id).startsWith('dev-')) { delete db.users[id]; n++; }
      save();
      return { ok: true, msg: 'Удалено тестовых аккаунтов: ' + n };
    }
    if (act === 'warReset') {
      db.war = { week: weekKey(), frog: 0, cat: 0, stars: 0, by: {}, last: db.war.last || null }; save();
      return { ok: true, msg: 'Битва недели обнулена' };
    }
    if (act === 'warEnd') {
      // warCheck() сам закрывает сезон и раздаёт награды, если week не совпадает
      // с текущей неделей — подставляем заведомо несовпадающее значение
      if (!db.war.frog && !db.war.cat) return { ok: false, error: 'Битва ещё пустая — закрывать нечего' };
      db.war.week = ''; warCheck(); save();
      return { ok: true, msg: 'Битва закрыта досрочно, награды выданы' };
    }
    if (act === 'warAdjust') {
      const side = body.side === 'cat' ? 'cat' : 'frog';
      const amount = Math.round(+body.amount || 0);
      if (!amount) return { ok: false, error: 'Укажи сумму (можно отрицательную)' };
      warCheck();
      db.war[side] = Math.max(0, (db.war[side] || 0) + amount);
      save();
      return { ok: true, msg: `${side === 'cat' ? 'Коты' : 'Лягушки'} теперь: ${db.war[side]}` };
    }
    if (act === 'endlessReset') {
      db.endless.record = null; save();
      return { ok: true, msg: 'Рекорд бесконечной серии сброшен' };
    }
    if (act === 'broadcastUploadPhoto') {
      const png = String(body.photo || ''); if (png.length < 100 || png.length > 6e6) return { ok: false, error: 'Пустая или слишком большая картинка' };
      const buf = Buffer.from(png, 'base64');
      const isPng = buf.slice(1, 4).toString() === 'PNG', isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
      if (!isPng && !isJpg) return { ok: false, error: 'Это не PNG и не JPG' };
      const id = `bc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${isPng ? 'png' : 'jpg'}`;
      fs.writeFileSync(path.join(CARDS, id), buf);
      return { ok: true, url: `${CFG.appUrl}/cards/${id}` };
    }
    if (act === 'broadcastTest') {
      const text = String(body.text || '').trim(); if (!text) return { ok: false, error: 'Пустой текст' };
      // шлём туда, кем реально авторизован этот запрос: initData — тому же tg-аккаунту,
      // ключ из .env — на ADMIN_ID; без него тестировать некому
      const target = (checkInitData(body.initData) || {}).id || CFG.adminId;
      if (!target) return { ok: false, error: 'Не знаю, кому слать тест — открой админку из Telegram или задай ADMIN_ID' };
      try { await sendBroadcastOne(target, text, body.photoUrl || null); return { ok: true, msg: 'Тест отправлен себе' }; }
      catch (e) { return { ok: false, error: 'Telegram отказал: ' + e.message }; }   // сюда же прилетит ошибка битого HTML
    }
    if (act === 'broadcastSend') {
      if (db.broadcast && db.broadcast.sending) return { ok: false, error: 'Рассылка уже идёт' };
      const text = String(body.text || '').trim(); if (!text) return { ok: false, error: 'Пустой текст' };
      const ids = all.filter(isRealPlayer).map(u => u.id);
      if (!ids.length) return { ok: false, error: 'Получателей нет' };
      runBroadcast(text, body.photoUrl || null, ids).catch(e => log('broadcast', e.message));
      return { ok: true, total: ids.length };
    }
    if (act === 'broadcastStatus') return { ok: true, broadcast: db.broadcast || null };
    if (act === 'broadcastCancel') {
      if (db.broadcast) db.broadcast.cancel = true;
      return { ok: true, msg: 'Останавливаю после текущей пачки' };
    }
    if (act === 'pondReset') {
      db.pond = { week: weekKey(), count: 0, stars: 0, donors: {} }; save();
      return { ok: true, msg: 'Общий пруд обнулён' };
    }
    if (act === 'digest') {
      try { await sendDigest(true); return { ok: true, msg: 'Отчёт отправлен в чат' }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: false, error: 'Неизвестное действие' };
  },
};

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.tgs': 'application/gzip', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' };
const injectCfg = html => html.replace('<!--CONFIG-->', `<script>window.FROG_CFG=${JSON.stringify({ api: '/api', appLink: CFG.appLink, chat: CFG.chatLink, holders: CFG.holdersLink, pondGoal: CFG.pondGoal })}</script>`);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': type.startsWith('image') ? 'public, max-age=86400' : 'no-store' }); res.end(body); };
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, GET' }); return res.end(); }
      if (!api[name]) return send(404, '{"ok":false,"error":"no route"}');
      let body = {};
      if (req.method === 'POST') { const chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size > 8e6) return send(413, '{"ok":false}'); chunks.push(c); } try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { return send(400, '{"ok":false,"error":"json"}'); } }
      const out = await api[name](body, req);
      return send(200, JSON.stringify(out));
    }
    if (url.pathname === '/admin') {
      const f = path.join(__dirname, 'admin.html');
      if (!fs.existsSync(f)) return send(404, 'admin.html not found', 'text/plain');
      return send(200, fs.readFileSync(f, 'utf8'), MIME['.html']);
    }
    if (url.pathname.startsWith('/cards/')) {
      const f = path.join(CARDS, path.basename(url.pathname)); if (!fs.existsSync(f)) return send(404, 'not found', 'text/plain');
      return send(200, fs.readFileSync(f), f.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
    }
    let p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const f = path.normalize(path.join(ROOT, p)); if (!f.startsWith(ROOT) || f.includes(path.sep + 'server' + path.sep)) return send(403, 'forbidden', 'text/plain');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(404, 'not found', 'text/plain');
    const ext = path.extname(f).toLowerCase();
    if (ext === '.html') return send(200, injectCfg(fs.readFileSync(f, 'utf8')), MIME['.html']);
    return send(200, fs.readFileSync(f), MIME[ext] || 'application/octet-stream');
  } catch (e) { log('http', e.message); send(500, '{"ok":false,"error":"server"}'); }
});
server.listen(CFG.port, () => log(`SWAMP server on :${CFG.port}  app=${CFG.appUrl}  bot=${CFG.token ? 'on' : 'OFF (dev mode)'}`));

/* ---------- BOT ---------- */
const kb = (text, url) => ({ inline_keyboard: [[{ text, url }]] });
// В личке кнопка web_app запускает Mini App гарантированно.
// В группах такие кнопки запрещены Telegram, там остаётся прямая ссылка на приложение.
const playKb = (priv) => ({ inline_keyboard: [[priv
  ? { text: EMO_BTN + 'Играть', web_app: { url: CFG.appUrl } }
  : { text: EMO_BTN + 'Играть', url: CFG.appLink }]] });
function topText(n = 10) {
  const rows = topRows(n);
  if (!rows.length) return 'Пока никто не играл. Будь первым ' + em('frog');
  return rows.map(r => { const L = LADDER[r.sp] || LADDER.frog; const lv = Math.max(1, Math.min(r.maxLv || 1, L.length));
    return `${r.rank <= 3 ? em(['gold', 'silver', 'bronze'][r.rank - 1]) : r.rank + '.'} ${esc(r.name)}${r.holder ? ' ' + em('crown') : ''} — ${L[lv - 1].n} (ур. ${lv}) · ${fmt(r.score)}`; }).join('\n');
}
function warText() {
  warCheck();
  const f = db.war.frog || 0, c = db.war.cat || 0, all = f + c;
  if (!all) return `${em('frog')} Битва недели ещё не началась — первое слияние двинет шкалу.`;
  const pf = Math.round(f / all * 100), pc = 100 - pf;
  // шкала: слева коты, справа лягушки
  const cells = 12, fc = Math.max(0, Math.min(cells, Math.round(f / all * cells)));
  const bar = '▓'.repeat(cells - fc) + '│' + '▒'.repeat(fc);
  const lead = f === c ? 'ровно посередине' : (f > c ? 'лягушки впереди' : 'коты впереди');
  const top = warTop(3).map((x, i) => `${i + 1}. ${esc(x.name)} — ${fmt(x.n)} (${x.sp === 'cat' ? 'коты' : 'лягушки'})`).join('\n');
  return `${em('trophy')} <b>Битва недели: коты против лягушек</b>\n` +
    `<code>${bar}</code>\n` +
    `Коты ${fmt(c)} (${pc}%)  ·  Лягушки ${fmt(f)} (${pf}%)\n` +
    `Сейчас ${lead}.` + (top ? `\n\n${em('sparkle')} Больше всех поддержали:\n${top}` : '');
}
const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
async function onMessage(m) {
  const text = (m.text || '').trim(); const chat = m.chat; const priv = chat.type === 'private';
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/start' && priv) {
    const param = text.split(' ')[1] || '';
    const u0 = db.users[String(m.from.id)];
    const rows = [[{ text: EMO_BTN + 'Играть', web_app: { url: CFG.appUrl + (param ? '?startapp=' + encodeURIComponent(param) : '') } }], [{ text: 'Игровой чат', url: CFG.chatLink }]];
    // ссылку на чат холдеров показываем только тем, у кого бот увидел лягушку
    if (u0 && u0.holder && (u0.holder.frogs || []).length) rows.push([{ text: 'Чат холдеров', url: CFG.holdersLink }]);
    await tg('sendMessage', { chat_id: chat.id, text: `${em('frog')} <b>SWAMP</b>\nЛягушки или коты — выбираешь при первом запуске.\nТапай, призывай новых и соединяй три в ряд.\n\nИгровой чат: ${CFG.chatLink}`, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows } });
  } else if (cmd === '/play' || (cmd === '/start' && !priv)) {
    await tg('sendMessage', { chat_id: chat.id, text: `${em('frog')} <b>SWAMP</b> — кликер + три в ряд с лягушками или котами. Жми и играй прямо здесь.`, parse_mode: 'HTML', reply_markup: playKb(priv) });
  } else if (cmd === '/top') {
    pondCheck();
    await tg('sendMessage', { chat_id: chat.id, text: `${em('trophy')} <b>Топ пруда</b>\n${topText(10)}\n\n${em('wave')} Общий пруд: ${fmt(db.pond.count)} / ${fmt(CFG.pondGoal)}`, parse_mode: 'HTML', reply_markup: playKb(priv) });
  } else if (cmd === '/war') {
    await tg('sendMessage', { chat_id: chat.id, text: warText(), parse_mode: 'HTML', reply_markup: playKb(priv) });
  } else if (cmd === '/digest' && String(m.from.id) === CFG.adminId) {
    await sendDigest(true);
  } else if (cmd === '/admin' && priv && String(m.from.id) === CFG.adminId) {
    // web_app-кнопка, а не обычная ссылка: тогда страница откроется как Mini App
    // и получит initData — по нему /admin узнает тебя и пустит без ключа
    await tg('sendMessage', { chat_id: chat.id, text: 'Панель управления SWAMP:', reply_markup: { inline_keyboard: [[{ text: 'Открыть админку', web_app: { url: CFG.appUrl + '/admin' } }]] } });
  } else if (cmd === '/paysupport' && priv) {
    await tg('sendMessage', { chat_id: chat.id, text: 'По вопросам оплаты напиши админу проекта. Возвраты Stars делаем в течение суток.' });
  }
  if (m.successful_payment) await onPayment(m);
}
async function onPayment(m) {
  const sp = m.successful_payment;
  // payload — это "item:userId:price:nonce", но у фонов сам item уже содержит
  // двоеточие ("bd:НазваниеФона") — наивный split(':') на 4 поля резал его пополам,
  // grant() получал мусорный item "bd" без содержимого и тихо ничего не делал:
  // деньги списывались, а фон не выдавался. Разбираем с конца — три служебных
  // поля всегда фиксированной длины, всё, что осталось спереди, — это item целиком
  const parts = String(sp.invoice_payload).split(':');
  const nonce = parts.pop(); const priceStr = parts.pop(); const payloadUid = parts.pop();
  const item = parts.join(':');
  const stars = +sp.total_amount || +priceStr || 0;
  const a = { id: String(m.from.id), name: m.from.first_name || m.from.username || 'Игрок', username: m.from.username || '', real: true };
  const u = getUser(a); pondCheck();
  grant(u, item, stars);
  pendingInvoices.delete(`${u.id}:${item}`);
  db.payments.push({ t: Date.now(), id: u.id, item, stars, charge: sp.telegram_payment_charge_id, sub: !!sp.subscription_expiration_date, recurring: !!sp.is_recurring });
  save();
  log('payment', u.id, item, stars);
  const it = shopItem(item, spOf(u));
  if (item === 'jumpRevive') return;   // игрок уже продолжает забег — сообщение в личку только отвлечёт
  try { await tg('sendMessage', { chat_id: m.chat.id, text: `${em('star')} Спасибо! ${esc(it ? it.title : item)} активировано. Открой игру — всё уже там.`, parse_mode: 'HTML', reply_markup: playKb(true) }); } catch (e) {}
}
/* ---------- РАССЫЛКА ----------
   Админ пишет текст обычными Telegram-HTML тегами (<b>, <i>, <a href>,
   <tg-emoji emoji-id="…">, ...) — тем же parse_mode:'HTML', которым уже
   пользуются дайджест и уведомления. Никакой отдельной "конвертации" не
   нужно: Telegram сам рендерит эти теги получателю, играть роль конвертера
   тут не требуется, только не сломать то, что админ ввёл, лишним экранированием.
   Фото грузится один раз (см. broadcastUploadPhoto) и потом переиспользуется
   и в тестовой, и в боевой отправке — не гонять несколько мегабайт дважды. */
async function sendBroadcastOne(id, text, photoUrl) {
  const chat_id = +id;
  if (photoUrl) return tg('sendPhoto', { chat_id, photo: photoUrl, caption: text, parse_mode: 'HTML' });
  return tg('sendMessage', { chat_id, text, parse_mode: 'HTML' });
}
async function runBroadcast(text, photoUrl, ids) {
  // 25 сообщений параллельно, затем пауза — эмпирически безопасный темп для
  // рассылки РАЗНЫМ пользователям (лимит Bot API — это в первую очередь про
  // спам В ОДИН чат; разным чатам можно заметно чаще, но топить всё разом
  // в один Promise.all на тысячи получателей всё равно не стоит)
  const BATCH = 25, PAUSE = 1100;
  db.broadcast = { sending: true, done: false, total: ids.length, sent: 0, failed: 0, startedAt: Date.now(), text, cancel: false };
  save();
  for (let i = 0; i < ids.length; i += BATCH) {
    if (db.broadcast.cancel) break;
    const batch = ids.slice(i, i + BATCH);
    await Promise.all(batch.map(async id => {
      try { await sendBroadcastOne(id, text, photoUrl); db.broadcast.sent++; }
      catch (e) { db.broadcast.failed++; }   // чаще всего — бот заблокирован получателем
    }));
    if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, PAUSE));
  }
  db.broadcast.sending = false; db.broadcast.done = true; save();
  log('broadcast done', db.broadcast.sent, '/', db.broadcast.total, 'failed', db.broadcast.failed, db.broadcast.cancel ? '(отменена)' : '');
}
async function sendDigest(force) {
  pondCheck();
  const day = dayKey();
  if (!force && db.digest.day === day) return;
  if (!CFG.chatId) return;
  const since = Date.now() - DAY;
  const ev = db.events.filter(e => e.t > since);
  db.events = db.events.filter(e => e.t > since * 1 - 6 * DAY);
  const rare = ev.filter(e => !e.own).slice(-5).map(e => `• ${esc(e.name)} вырастил <b>${e.frog}</b> (${String(e.r).replace('.', ',')}%)`);
  const own = ev.filter(e => e.own).slice(-5).map(e => `• ${esc(e.name)} добрался до своей <b>${e.frog}</b> ${em('crown')}`);
  const donors = Object.entries(db.pond.donors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, s]) => `${esc((db.users[id] || {}).name || 'Аноним')} ${s}${em('star')}`);
  const pct = Math.min(100, Math.round(db.pond.count / CFG.pondGoal * 100));
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  const text = [`${em('frog')} <b>Пруд за сегодня</b>`, '', `${em('trophy')} <b>Топ-10</b>`, topText(10), '',
    warText() + '\n',
    rare.length ? `${em('sparkle')} <b>Редкие находки</b>\n${rare.join('\n')}\n` : '',
    own.length ? `${em('crown')} <b>Личные финалы</b>\n${own.join('\n')}\n` : '',
    `${em('wave')} <b>Общий пруд недели</b>\n<code>${bar}</code> ${pct}%\n${fmt(db.pond.count)} из ${fmt(CFG.pondGoal)} слияний${pct >= 100 ? ' — цель взята, всем бустер на сутки!' : ''}`,
    donors.length ? `\n${em('heart')} Кормили пруд: ${donors.join(', ')}` : ''].filter(s => s !== '').join('\n');
  try {
    const msg = await tg('sendMessage', { chat_id: CFG.chatId, text, parse_mode: 'HTML', reply_markup: playKb(), disable_notification: true });
    db.digest.day = day; db.digest.msgId = msg.message_id; save();
    if (pct >= 100 && !db.pond.rewarded) { db.pond.rewarded = true; for (const u of Object.values(db.users)) grant(u, 'boost1d', 0); save(); }
  } catch (e) { log('digest', e.message); }
}
async function poll() {
  let offset = 0;
  try { await tg('deleteWebhook', { drop_pending_updates: false }); } catch (e) {}
  try { await tg('setMyCommands', { commands: [{ command: 'play', description: 'Играть в SWAMP' }, { command: 'top', description: 'Топ пруда' }, { command: 'war', description: 'Битва: коты против лягушек' }] }); } catch (e) {}
  while (true) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'pre_checkout_query', 'my_chat_member'] });
      for (const up of ups) {
        offset = up.update_id + 1;
        try {
          if (up.pre_checkout_query) await tg('answerPreCheckoutQuery', { pre_checkout_query_id: up.pre_checkout_query.id, ok: true });
          else if (up.message) await onMessage(up.message);
        } catch (e) { log('update', e.message); }
      }
    } catch (e) { log('poll', e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
}
if (CFG.token) {
  poll();
  setInterval(() => { if (new Date().getUTCHours() === CFG.digestHour) sendDigest(false); }, 60e3);
} else log('BOT_TOKEN не задан: бот и платежи выключены, API работает в dev-режиме');
