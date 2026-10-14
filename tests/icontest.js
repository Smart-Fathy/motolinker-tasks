// lucide.createIcons() draws only what is new (chat-extras.js, iconsDrawOnlyNew).
//
// Reported as "Chrome says this page is not responding" on coming back to a tab that
// had been in a huddle. lucide redraws every icon on the page on every call — the SVG
// it draws keeps data-lucide, so the next call matches it again — and a hidden tab
// queues every requestAnimationFrame callback until it is shown, then runs them all
// at once. The huddle re-rendered every 3 s, so 20 minutes away meant ~400 full-page
// redraws in one frame.
//
// The real lucide comes from unpkg at runtime, so this page carries a stand-in that
// behaves the way lucide 1.57 does where it matters: createIcons({ root }) replaces
// every [data-lucide] under root (document by default) with an <svg> that keeps the
// attribute. The fix is the real code, sliced out of chat-extras.js.
const fs = require('fs');
const puppeteer = require('puppeteer');
const http = require('http');

const SRC = fs.readFileSync('public/assets/chat-extras.js', 'utf8');
const from = SRC.indexOf('// ── Icons: draw only what is new');
const to = SRC.indexOf('// ── Self-healing EventSource');
if (from < 0 || to < from) throw new Error('could not slice iconsDrawOnlyNew out of chat-extras.js');
const FIX = SRC.slice(from, to);

const PAGE = `<!doctype html><html><body><div id="app"></div><script>
window.__drawn = 0;
// As lucide 1.57 does it: every [data-lucide] under root, attributes copied across.
window.lucide = {
  createIcons({ root = document, nameAttr = 'data-lucide' } = {}) {
    Array.from(root.querySelectorAll('[' + nameAttr + ']')).forEach(el => {
      const name = el.getAttribute(nameAttr);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const a of Array.from(el.attributes)) svg.setAttribute(a.name, a.value);
      svg.setAttribute('data-lucide', name);
      svg.setAttribute('class', 'lucide lucide-' + name);
      if (el.parentNode) el.parentNode.replaceChild(svg, el);
      window.__drawn++;
    });
  },
};
// A page full of icons, one per row, like a leads table.
const rows = [];
for (let i = 0; i < 300; i++) rows.push('<div class="row"><button><i data-lucide="eye"></i></button></div>');
document.getElementById('app').innerHTML = rows.join('');
lucide.createIcons();
<\/script></body></html>`;

const results = [];
const check = (name, ok, extra) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + name + (extra ? '  ' + extra : '')); };

(async () => {
  const server = http.createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' });

  // The problem, on the unmodified library: a call with nothing new redraws everything.
  const before = await page.evaluate(() => { window.__drawn = 0; lucide.createIcons(); return window.__drawn; });
  check('unpatched, a call with nothing new redraws every icon on the page', before === 300, String(before));

  await page.evaluate(FIX);
  const r = await page.evaluate(() => {
    const out = {};
    const firstSvg = document.querySelector('#app svg');
    window.__drawn = 0; lucide.createIcons();
    out.idle = window.__drawn;
    out.sameSvg = document.querySelector('#app svg') === firstSvg;

    // One new icon in a small box, next to one already drawn.
    const box = document.createElement('div');
    box.innerHTML = '<i data-lucide="mic"></i><i data-lucide="video"></i>';
    document.body.appendChild(box);
    lucide.createIcons();
    window.__drawn = 0;
    box.insertAdjacentHTML('beforeend', '<i data-lucide="phone-off"></i>');
    lucide.createIcons();
    out.oneNew = window.__drawn;
    out.newIsSvg = box.lastElementChild.tagName.toLowerCase() === 'svg';

    // A burst of queued calls — what a hidden tab runs on its return.
    window.__drawn = 0;
    box.insertAdjacentHTML('beforeend', '<i data-lucide="user-plus"></i>');
    for (let i = 0; i < 400; i++) lucide.createIcons();
    out.burst = window.__drawn;

    // A whole page rendered at once still gets every icon.
    const page2 = document.createElement('div');
    page2.innerHTML = Array.from({ length: 60 }, () => '<p><i data-lucide="star"></i></p>').join('');
    document.body.appendChild(page2);
    lucide.createIcons();
    out.pageLeft = page2.querySelectorAll('[data-lucide]:not(svg)').length;
    out.pageDrawn = page2.querySelectorAll('svg[data-lucide]').length;

    // root is honoured: drawing a box leaves placeholders elsewhere alone.
    const a = document.createElement('div'), b = document.createElement('div');
    a.innerHTML = '<i data-lucide="mic"></i>'; b.innerHTML = '<i data-lucide="mic"></i>';
    document.body.append(a, b);
    lucide.createIcons({ root: a });
    out.rootA = a.firstElementChild.tagName.toLowerCase();
    out.rootB = b.firstElementChild.tagName.toLowerCase();
    lucide.createIcons();

    // Installing twice does not wrap twice.
    out.flag = !!lucide.createIcons.drawsOnlyNew;
    return out;
  });
  check('patched, a call with nothing new draws nothing', r.idle === 0, String(r.idle));
  check('…and leaves the drawn icons as they were', r.sameSvg === true);
  check('one new icon redraws only its own box, not the page', r.oneNew > 0 && r.oneNew <= 3 && r.newIsSvg, JSON.stringify(r));
  check('400 calls in a row (a hidden tab coming back) do the work once', r.burst > 0 && r.burst <= 4, String(r.burst));
  check('a page rendered at once still gets every icon', r.pageLeft === 0 && r.pageDrawn === 60, JSON.stringify(r));
  check('root is honoured', r.rootA === 'svg' && r.rootB === 'i', JSON.stringify(r));
  await page.evaluate(FIX);
  const twice = await page.evaluate(() => { const b = document.createElement('div'); b.innerHTML = '<i data-lucide="mic"></i>'; document.body.appendChild(b); window.__drawn = 0; lucide.createIcons(); return window.__drawn; });
  check('loading the fix twice does not wrap it twice', r.flag && twice >= 1 && twice <= 2, String(twice));
  check('no page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  server.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} icon checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
