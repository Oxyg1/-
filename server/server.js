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
  for (const m of fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/\{n:"([^"]+)",f:"[^"]+",r:([\d.]+)\}/g)) out.push({ n: m[1], r: +m[2] });
  return out;
}
// у каждого вида своя лестница и свой подарок в Telegram
const LADDER = { frog: readLadder('levels.js'), cat: readLadder('cats.js') };
const GIFT = { frog: E.GIFT_NAME || 'Kissed Frog', cat: E.GIFT_NAME_CAT || 'Scared Cat' };
const spOf = u => (u && u.species === 'cat') ? 'cat' : 'frog';
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
    bigBoard: 'Большой пруд 6×6', sub: 'Абонемент пруда', donate: 'Покормить пруд',
    starterDesc: 'Мушка и ускорение ×2 на сутки + 3 диких лягушки', subDesc: 'Мушка, значок и ранний доступ к фонам на 30 дней' },
  cat: { wild3: 'Дикий кот ×3', auto1d: 'Мышка на сутки', autoForever: 'Мышка навсегда',
    bigBoard: 'Большая крыша 6×6', sub: 'Абонемент клуба', donate: 'Поддержать общую цель',
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
    default: if (String(item).startsWith('bd:')) { const th = String(item).slice(3); inv.themes = inv.themes || []; if (!inv.themes.includes(th)) inv.themes.push(th); }
  }
}

/* ---------- DB (json-файл) ---------- */
const DB_FILE = path.join(__dirname, 'data.json');
let db = { users: {}, payments: [], pond: { week: '', count: 0, stars: 0, donors: {} }, digest: { day: '' }, events: [] };
try { if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { log('db read error', e.message); }
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); } catch (e) { log('db write', e.message); } }, 1500); }
process.on('SIGINT', () => { clearTimeout(saveT); try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} process.exit(0); });
function weekKey(d = new Date()) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); }
function pondCheck() { const w = weekKey(); if (db.pond.week !== w) { db.pond = { week: w, count: 0, stars: 0, donors: {} }; } }
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
  const sp = spOf(u);
  // кэш сбрасываем, если игрок сменил вид: искать надо уже другой подарок
  if (u.holderCheckedAt && u.holderSpecies === sp && Date.now() - u.holderCheckedAt < DAY) return;
  u.holderCheckedAt = Date.now(); u.holderSpecies = sp;
  try {
    let offset = '', frogs = [];
    for (let i = 0; i < 5; i++) {
      const r = await tg('getUserGifts', { user_id: +u.id, exclude_unlimited: true, exclude_limited_non_upgradable: true, offset, limit: 100 });
      for (const g of r.gifts || []) {
        if (g.type === 'unique' && g.gift && g.gift.base_name === GIFT[sp]) {
          const model = g.gift.model && g.gift.model.name;
          // игрок может владеть несколькими лягушками — забираем все, вместе с бэкдропами
          frogs.push({
            model, level: levelByName(model, sp), name: g.gift.name, number: g.gift.number,
            rarity: g.gift.model && g.gift.model.rarity_per_mille / 10,
            backdrop: g.gift.backdrop && g.gift.backdrop.name || null,
          });
        }
      }
      offset = r.next_offset || ''; if (!offset) break;
    }
    // дубли по модели схлопываем, самая редкая — первой
    frogs = [...new Map(frogs.map(f => [f.model + '#' + f.number, f])).values()].sort((a, b) => b.level - a.level);
    const top = frogs[0] || null;
    u.holder = top ? { model: top.model, level: top.level, backdrop: top.backdrop, frogs } : null;
    // в чат холдеров зовём один раз и только того, у кого лягушка действительно есть
    if (top && !u.holdersInvited && sp === 'frog') {   // чата холдеров котов пока нет
      u.holdersInvited = Date.now();
      const names = frogs.map(f => f.model).join(', ');
      try {
        await tg('sendMessage', {
          chat_id: +u.id, parse_mode: 'HTML',
          text: `${em('crown')} У тебя есть ${frogs.length > 1 ? 'лягушки' : 'лягушка'}: <b>${names}</b>.\n` +
                `Тебе открыт чат холдеров — туда пускают только владельцев.`,
          reply_markup: { inline_keyboard: [[{ text: 'Чат холдеров', url: CFG.holdersLink }], [{ text: EMO_BTN + 'Играть', url: CFG.appLink }]] },
        });
      } catch (e) { log('holders invite', u.id, e.message); }
    }
  } catch (e) { log('getUserGifts', u.id, e.message); }
}

/* ---------- LEADERBOARD ---------- */
// dev-* — это локальные тестовые входы без подписи Telegram, в общий зачёт они не идут;
// hidden ставится вручную из админки
const isRealPlayer = u => !u.hidden && !String(u.id).startsWith('dev-');
function leaderboard() {
  return Object.values(db.users).filter(u => isRealPlayer(u) && (u.score > 0 || u.maxLv > 1)).sort((a, b) => b.score - a.score || b.maxLv - a.maxLv);
}
function topRows(n = 20) {
  return leaderboard().slice(0, n).map((u, i) => ({ rank: i + 1, id: u.id, name: u.name, sp: spOf(u), maxLv: u.maxLv, score: u.score, holder: u.holder ? u.holder.model : null, sub: (u.inv && u.inv.subUntil || 0) > Date.now() }));
}
function rankOf(id) { const i = leaderboard().findIndex(u => u.id === id); return i < 0 ? null : i + 1; }

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
    const u = getUser(a); pondCheck();
    if (body.species === 'cat' || body.species === 'frog') u.species = body.species;
    const L = ladderOf(u);
    // мерджи — монотонный счётчик. Раньше при рывке дельту только помечали флагом,
    // но сам мердж всё равно принимался целиком — можно было одним запросом заявить
    // maxLv=50 без единого реального слияния. Теперь лишнее не флагом отмечается, а обрезается.
    // Точка отсчёта — не только последний sync, но и момент создания аккаунта: иначе самый
    // первый вызов (u.syncAt ещё не установлен) вообще ничем не ограничен, а отличить его
    // от подделанного первого вызова читера снаружи нечем
    const reportedMerges = Math.max(0, Math.min(+body.merges || 0, 1e7));
    const dt = Math.max(1, (Date.now() - (u.syncAt || u.created || Date.now())) / 1000);
    const maxDelta = Math.ceil(dt * 3 + 30);
    let delta = Math.max(0, reportedMerges - (u.merges || 0));
    if (delta > maxDelta) { u.flags = (u.flags || 0) + 1; delta = maxDelta; }
    u.merges = (u.merges || 0) + delta;
    db.pond.count += delta;
    // maxLv и score не берутся с потолка: механика слияний сама задаёт им верхнюю границу —
    // каждый мердж поднимает лягушку ровно на 1 уровень и добавляет в очки её новый уровень,
    // так что без merges такого maxLv/score попросту не бывает
    const maxLv = Math.max(1, Math.min(+body.maxLv || 1, L.length, u.merges + 1));
    if (maxLv > u.maxLv) { u.maxLv = maxLv; const r = L[maxLv - 1].r; if (r <= 1) db.events.push({ t: Date.now(), id: u.id, name: u.name, lv: maxLv, frog: L[maxLv - 1].n, r, sp: spOf(u) }); }
    const scoreCap = u.merges * L.length;
    u.score = Math.max(u.score || 0, Math.min(+body.score || 0, 1e9, scoreCap));
    u.taps = Math.max(u.taps || 0, Math.min(+body.taps || 0, 1e9));
    u.coins = Math.max(0, Math.min(+body.coins || 0, 1e15)) || 0; // без потолка Infinity бьёт JSON.stringify в null
    u.theme = body.theme || '';
    // дикие лягушки: клиент шлёт не остаток, а сколько штук потратил с прошлой удачной
    // синхронизации (и сам обнуляет свой счётчик после успешного ответа — см. index.html).
    // Раньше слался абсолютный остаток, и «Сбросить прогресс» на клиенте (state.wild=0)
    // выглядел как «потратил всё» и стирал реально купленный за звёзды запас
    const wildUsed = Math.max(0, Math.min(+body.wildUsed || 0, 1e6));
    u.wild = Math.max(0, (u.wild || 0) - wildUsed);
    u.syncAt = Date.now();
    await checkHolder(u, a.real);
    if (u.holder && u.holder.level && u.holder.level <= u.maxLv && !u.holderDone) { u.holderDone = Date.now(); db.events.push({ t: Date.now(), id: u.id, name: u.name, lv: u.holder.level, frog: u.holder.model, r: L[u.holder.level - 1]?.r, own: true, sp: spOf(u) }); }
    save();
    return { ok: true, me: { id: u.id, rank: rankOf(u.id), score: u.score }, top: topRows(20), pond: { count: db.pond.count, goal: CFG.pondGoal, stars: db.pond.stars }, holder: u.holder || null, inv: u.inv || {}, wild: u.wild || 0, appLink: CFG.appLink };
  },
  async leaderboard() { pondCheck(); return { ok: true, top: topRows(50), pond: { count: db.pond.count, goal: CFG.pondGoal } }; },
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
    if (!it) return { ok: false, error: 'Нет такого товара' };
    if (it.once && u.inv && u.inv[it.once]) return { ok: false, error: 'Уже куплено' };
    if (it.backdrop && u.inv && (u.inv.themes || []).includes(it.backdrop)) return { ok: false, error: 'Уже куплено' };
    // для разового товара нельзя создавать второй счёт, пока висит неоплаченный первый —
    // иначе оба можно оплатить (звёзды спишутся дважды), а выдастся всё равно один раз
    const lockKey = it.once || it.backdrop ? `${u.id}:${body.item}` : null;
    if (lockKey) { const until = pendingInvoices.get(lockKey); if (until && until > Date.now()) return { ok: false, error: 'Счёт уже выставлен — заверши его или подожди пару минут' }; }
    let price = it.price;
    if (it.donate) { price = Math.round(+body.amount || 0); if (price < 1 || price > 500) return { ok: false, error: 'Сумма от 1 до 500 звёзд' }; }
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
          holders: all.filter(u => u.holder && (u.holder.frogs || []).length).length,
          merges: all.reduce((s, u) => s + (u.merges || 0), 0),
          stars: paid,
          payments: db.payments.length,
          pond: { count: db.pond.count, goal: CFG.pondGoal, stars: db.pond.stars, week: db.pond.week },
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
          holder: u.holder ? (u.holder.frogs || []).map(f => f.model).join(', ') : '',
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
      Object.assign(u, { maxLv: 1, score: 0, merges: 0, taps: 0, coins: 0, wild: 0 });
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
      if (!SHOP[item] && !item.startsWith('bd:')) return { ok: false, error: 'Нет такого товара' };
      grant(u, item, +body.amount || 0); save();
      return { ok: true, msg: 'Выдано: ' + ((SHOP[item] || {}).title || item) };
    }
    if (act === 'cleanTest') {
      let n = 0;
      for (const id of Object.keys(db.users)) if (String(id).startsWith('dev-')) { delete db.users[id]; n++; }
      save();
      return { ok: true, msg: 'Удалено тестовых аккаунтов: ' + n };
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
  const sp = m.successful_payment; const [item, uid, priceStr] = String(sp.invoice_payload).split(':');
  const stars = +sp.total_amount || +priceStr || 0;
  const a = { id: String(m.from.id), name: m.from.first_name || m.from.username || 'Игрок', username: m.from.username || '', real: true };
  const u = getUser(a); pondCheck();
  grant(u, item, stars);
  pendingInvoices.delete(`${u.id}:${item}`);
  db.payments.push({ t: Date.now(), id: u.id, item, stars, charge: sp.telegram_payment_charge_id, sub: !!sp.subscription_expiration_date, recurring: !!sp.is_recurring });
  save();
  log('payment', u.id, item, stars);
  const it = shopItem(item, spOf(u));
  try { await tg('sendMessage', { chat_id: m.chat.id, text: `${em('star')} Спасибо! ${esc(it ? it.title : item)} активировано. Открой игру — всё уже там.`, parse_mode: 'HTML', reply_markup: playKb(true) }); } catch (e) {}
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
  try { await tg('setMyCommands', { commands: [{ command: 'play', description: 'Играть в SWAMP' }, { command: 'top', description: 'Топ пруда' }] }); } catch (e) {}
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
