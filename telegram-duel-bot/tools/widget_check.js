// Проверка JS виджетов в настоящем Chromium с заглушкой TelegramWidget (окно 320 px, как узкий телефон).
// Запуск:  node tools/widget_check.js [папка_для_скриншотов]
// Это НЕ песочница Telegram (QuickJS + профиль виджета): браузер рисует и исполняет больше, чем клиенты.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', 'duelbot', 'widgets');
const shots = process.argv[2];

const STUB = `
window.__reqs = []; window.__handlers = {}; window.__tx = [];
window.__answer = (d, o) => ({result: null});
window.TelegramWidget = {
  profile: 1, chatData: null, publicData: null, wallet: null, themeParams: {}, colorScheme: 'dark',
  HapticFeedback: {notificationOccurred() {}},
  onEvent(n, f) { (window.__handlers[n] = window.__handlers[n] || []).push(f); },
  ready() {}, watchPublicData() { window.__watched = true; },
  request(d, o) { window.__reqs.push([d, o || null]); const a = window.__answer(d, o); return Promise.resolve(a); },
};
window.__setChat = (s) => { TelegramWidget.chatData = typeof s === 'string' ? s : JSON.stringify(s); (window.__handlers.chatDataChanged || []).forEach(f => f()); };
window.__setPublic = (s) => { TelegramWidget.publicData = JSON.stringify(s); (window.__handlers.publicDataChanged || []).forEach(f => f()); };
`;
const THEME = `<style>:root{--tg-theme-bg-color:#222;--tg-theme-text-color:#eee}body{font-family:sans-serif}</style>`;

async function load(browser, name, init) {
  const page = await browser.newPage({ viewport: { width: 320, height: 420 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const html = fs.readFileSync(path.join(root, name + '.html'), 'utf8');
  await page.setContent(`<!doctype html><html><head>${THEME}<script>${STUB}${init || ''}</script></head><body>${html}</body></html>`);
  // виджет — «голый» HTML; страница выше оборачивает его в body, поэтому <style>/<script> сработают как в боте
  await page.waitForTimeout(50);
  return { page, errors };
}
const txt = (p, sel) => p.$eval(sel, e => e.textContent);
const vis = (p, sel) => p.$eval(sel, e => !e.hidden);
const shot = async (p, n) => shots && p.screenshot({ path: path.join(shots, n + '.png') });

(async () => {
  const browser = await chromium.launch();

  // ---------- дуэль ----------
  {
    const { page: p, errors } = await load(browser, 'duel', `window.__init = true;`);
    // начальное состояние до загрузки скрипта задаём через chatData, поэтому перезагрузим со стартовым состоянием
    await p.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 420 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const html = fs.readFileSync(path.join(root, 'duel.html'), 'utf8');
    await page.setContent(`<!doctype html><html><head>${THEME}<script>${STUB}TelegramWidget.chatData=JSON.stringify({r:1,p:'lobby',o:'@bob'});</script></head><body>${html}</body></html>`);
    await page.waitForTimeout(50);

    // 1. при показе виджет делает одну фоновую заявку «hi»; лобби без кнопки
    assert.deepStrictEqual(await page.evaluate(() => __reqs), [['hi', null]]);
    assert.strictEqual(await txt(page, '#s'), 'Ждём соперника…');
    assert.strictEqual(await vis(page, '#b'), false);
    assert(/против @bob/.test(await txt(page, '#m')));
    await shot(page, '1-lobby');

    // 2. пинг: новый nonce в chat_data → ответ ack:<n>
    await page.evaluate(() => __setChat({ r: 2, p: 'lobby', n: 123456 }));
    await page.waitForTimeout(50);
    assert((await page.evaluate(() => __reqs.map(r => r[0]))).includes('ack:123456'));
    // тот же nonce повторно не шлём
    await page.evaluate(() => __setChat({ r: 3, p: 'lobby', n: 123456 }));
    await page.waitForTimeout(30);
    assert.strictEqual((await page.evaluate(() => __reqs.filter(r => r[0].startsWith('ack:')).length)), 1);

    // 3. «Приготовься…»: кнопка есть, фон тёмный
    await page.evaluate(() => __setChat({ r: 4, p: 'wait' }));
    assert.strictEqual(await txt(page, '#s'), 'Приготовься…');
    assert.strictEqual(await vis(page, '#b'), true);
    assert.strictEqual(await page.evaluate(() => document.body.className), 'p-wait');
    await shot(page, '2-wait');

    // 4. сигнал: экран красный, кнопка «ЖМИ!»
    await page.evaluate(() => __setChat({ r: 5, p: 'go' }));
    assert.strictEqual(await page.evaluate(() => document.body.className), 'p-go');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(196, 22, 15)');
    assert.strictEqual(await txt(page, '#b'), 'ЖМИ!');
    await shot(page, '3-go');

    // 5. устаревшее состояние (меньшая ревизия) игнорируется
    await page.evaluate(() => __setChat({ r: 1, p: 'lobby' }));
    assert.strictEqual(await page.evaluate(() => document.body.className), 'p-go');

    // 6. нажатие: ровно один request('p'), кнопка блокируется до смены фазы
    await page.evaluate(() => { __answer = () => ({ result: '{"e":"принято"}' }); });
    await page.click('#b'); await page.click('#b', { force: true }).catch(() => {});
    await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => __reqs.filter(r => r[0] === 'p').length), 1);
    assert.strictEqual(await page.$eval('#b', e => e.disabled), true);
    assert(/принято/.test(await txt(page, '#m')));

    // 7. итог
    await page.evaluate(() => __setChat({ r: 6, p: 'win', ms: 187, oms: 240, w: 'f', d: 7, rt: 1016, dr: 16 }));
    assert.strictEqual(await txt(page, '#s'), '🏆 Победа!');
    assert(/ты 187 мс, он 240 мс/.test(await txt(page, '#m')));
    assert.strictEqual(await txt(page, '#r'), 'Рейтинг 1016 (+16)');
    await shot(page, '4-win');
    await page.evaluate(() => __setChat({ r: 7, p: 'fs', w: 'fs', rt: 990, dr: -10 }));
    assert.strictEqual(await txt(page, '#s'), '🚫 Фальстарт');
    assert.strictEqual(await txt(page, '#r'), 'Рейтинг 990 (−10)');
    await shot(page, '5-false-start');
    await page.evaluate(() => __setChat({ r: 8, p: 'cancel', w: 'nr' }));
    assert.strictEqual(await txt(page, '#s'), 'Дуэль отменена');
    assert.strictEqual(await txt(page, '#r'), '');                 // без рейтинга строка пустая
    assert.deepStrictEqual(errors, []);
    await page.close();
  }

  // ---------- ставка TON: принять + оплатить ----------
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 420 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const html = fs.readFileSync(path.join(root, 'duel.html'), 'utf8');
    await page.setContent(`<!doctype html><html><head>${THEME}<script>${STUB}
      TelegramWidget.chatData=JSON.stringify({r:1,p:'stake',k:'t',a:'0.5',d:7});
      TelegramWidget.wallet={sendTransaction:(tx,label)=>{__tx.push([tx,label]);return Promise.resolve({result:null});}};
    </script></head><body>${html}</body></html>`);
    await page.waitForTimeout(50);
    assert.strictEqual(await txt(page, '#s'), 'Ставка: 0.5 TON');
    assert.strictEqual(await txt(page, '#b'), 'Принять');
    await shot(page, '6-stake-ton');
    await page.click('#b'); await page.waitForTimeout(50);
    assert.deepStrictEqual(await page.evaluate(() => __reqs.at(-1)), ['join', { wallet: true }]);

    await page.evaluate(() => { __answer = (d) => d === 'pay' ? ({ result: JSON.stringify({ valid_until: 1, network: '-239', messages: [{ address: 'UQ', amount: '500000000' }] }) }) : ({ result: null }); });
    await page.evaluate(() => __setChat({ r: 2, p: 'lose', q: 'o', a: '0.5', d: 7, ms: 300 }));
    assert.strictEqual(await txt(page, '#b'), 'Заплатить 0.5 TON');
    await shot(page, '7-pay');
    await page.click('#b'); await page.waitForTimeout(80);
    assert.deepStrictEqual(await page.evaluate(() => __reqs.at(-1)), ['pay', { wallet: true }]);
    const tx = await page.evaluate(() => __tx);
    assert.strictEqual(tx.length, 1);
    assert.strictEqual(tx[0][1], 'paid:7');
    assert.strictEqual(tx[0][0].messages[0].amount, '500000000');
    assert.deepStrictEqual(errors, []);
    await page.close();
  }

  // ---------- без кошелька ----------
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 420 } });
    const html = fs.readFileSync(path.join(root, 'duel.html'), 'utf8');
    await page.setContent(`<!doctype html><html><head>${THEME}<script>${STUB}TelegramWidget.chatData=JSON.stringify({r:1,p:'lose',q:'o',a:'1',d:3});</script></head><body>${html}</body></html>`);
    await page.waitForTimeout(30);
    await page.click('#b');
    assert(/Нет кошелька/.test(await txt(page, '#m')));
    await page.close();
  }

  // ---------- табло ----------
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 520 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const html = fs.readFileSync(path.join(root, 'leaderboard.html'), 'utf8');
    await page.setContent(`<!doctype html><html><head>${THEME}<script>${STUB}</script></head><body>${html}</body></html>`);
    await page.waitForTimeout(30);
    assert.strictEqual(await page.evaluate(() => window.__watched), true);
    assert(/Пока пусто/.test(await txt(page, '#t')));
    const top = Array.from({ length: 10 }, (_, i) => [i === 0 ? '<b>Хакер</b>' : 'Ковбой ' + i, 20 - i, i, 1200 - 10 * i]);
    await page.evaluate(t => __setPublic({ r: 5, t, l: [['Joe', 'Bill', 187], ['Ann', 'Sam', null]] }), top);
    assert.strictEqual(await page.$$eval('#t .r', e => e.length), 10);
    assert.strictEqual(await page.$eval('#t .r span', e => e.textContent), '<b>Хакер</b>');   // имя — текст, не разметка
    assert.strictEqual(await page.$$eval('#t b', e => e.length), 10);                         // только номера мест
    assert.strictEqual(await page.$eval('#t .r i', e => e.textContent), '1200 · 20–0');
    assert.strictEqual(await page.$$eval('#l .r', e => e.length), 2);
    await shot(page, '8-leaderboard');
    await page.evaluate(() => __setPublic({ r: 4, t: [], l: [] }));                          // устаревшая ревизия
    assert.strictEqual(await page.$$eval('#t .r', e => e.length), 10);
    assert.deepStrictEqual(errors, []);
    await page.close();
  }

  await browser.close();
  console.log('widget checks passed');
})().catch(e => { console.error(e); process.exit(1); });
