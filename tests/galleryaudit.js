// The new app's parts are readable under every look.
//
// /dashboard/__gallery shows the design system on one page: the colours, every primitive, the sign-in card and the real frame
// (the rail, the top bar, the phone's bottom bar). This opens it in a real browser, goes round the portals, the eight looks a
// workspace can have and both modes — the page wearing each through the same runtime the app wears a look with — and measures
// every text against what it is drawn on (tools/contrast.js, the measure the classic portals' audit uses): ordinary text 4.5:1,
// large text and meaningful icons 3:1. Anything lower is listed and fails the run unless ALLOWED says why it may.
//
//   node tests/galleryaudit.js --list     print every failure, not the top few
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { chromePath } = require('./helpers/browser');
const { auditPage } = require('../tools/contrast');
const T = require('../public/assets/theme-core.js');

const ROOT = path.join(__dirname, '..');
const LIST = process.argv.includes('--list');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Text that is allowed to fall short, and why. Each entry is matched against the element's signature (tag and classes) and must
// say what makes it exempt. `look` limits an entry to looks it matches.
const ALLOWED = [];

// Black & Gold's dark is the original look — what a workspace that has chosen nothing shows — and is held to what it always was
// rather than to a bar it never met (the classic audit makes the same exception: tests/themeaudit.js). Everything else is held.
const looks = T.PRESET_ORDER.flatMap(p => [[p, 'dark'], [p, 'light']]).filter(([p, m]) => !(p === 'black-gold' && m === 'dark'));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  createFakeSupabase({ employees: [], sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [] }).install();
  const base = await bootApp({ port: process.env.PORT || 3982, env: { ML_WEB_DIST: dist } });
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });

  const failures = [];   // { look, ...finding }
  let measured = 0, passes = 0, specimenTexts = 0;
  const sweep = async (width, matrix, portals) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (/fonts\.g|gstatic/.test(u)) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (/^https?:/.test(u) && !u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width, height: 900 });
    await page.goto(base + '/dashboard/__gallery', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=gallery] [data-part=specimen] [data-part=sidebar]', { timeout: 20000 });
    for (const portal of portals) {
      await page.select('select[name=portal]', portal);
      for (const [preset, mode] of matrix) {
        await page.select('select[name=preset]', preset);
        await page.select('select[name=mode]', mode);
        await page.waitForFunction((p, m) => document.documentElement.dataset.portal === p && document.documentElement.getAttribute('data-mode') === m, { timeout: 5000 }, portal, mode);
        await sleep(120);
        await page.evaluate(() => document.getAnimations().forEach(a => a.cancel()));
        const texts = await page.evaluate(() => [...document.querySelectorAll('[data-part=gallery] *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())).length);
        measured += texts; passes++;
        specimenTexts += await page.evaluate(() => [...document.querySelectorAll('[data-part=specimen] *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()) && e.getBoundingClientRect().height > 2).length);
        for (const f of await page.evaluate(auditPage)) failures.push({ look: `${portal}/${preset}:${mode}${width < 600 ? '@' + width : ''}`, ...f });
      }
    }
    await context.close();
  };
  await sweep(1280, looks, ['admin', 'team']);
  // …and the two looks that differ most, at a phone's width, where the frame draws its drawer and bottom bar
  await sweep(390, [['moto', 'light'], ['cyberpunk', 'dark']], ['admin', 'team']);
  await browser.close();

  // ── judge ──
  const allowedFor = f => ALLOWED.find(a => a.test.test(f.sig) && (!a.look || a.look.test(f.look)));
  const unexplained = failures.filter(f => !allowedFor(f));
  const groups = new Map();
  for (const f of unexplained) {
    const k = `${f.sig} ${f.fg} on ${f.bg} (${f.ratio}:1, needs ${f.need}:1)`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k).add(f.look);
  }
  const lines = [...groups].map(([k, looks]) => `${k}  — ${looks.size} look(s): ${[...looks].slice(0, 3).join(', ')}${looks.size > 3 ? ', …' : ''}`);
  check(`${passes} views of the gallery (${looks.length * 2} looks of the two portals, and two at a phone's width) were measured, ${measured} texts in all`, passes === looks.length * 2 + 4 && measured > passes * 60 && specimenTexts > passes * 20, `${passes} views, ${measured} texts, ${specimenTexts} in the frame`);
  check('every text in every look is readable, or is excused with a reason', unexplained.length === 0, unexplained.length ? '\n      ' + (LIST ? lines : lines.slice(0, 12)).join('\n      ') + (!LIST && lines.length > 12 ? `\n      … and ${lines.length - 12} more kinds (--list shows all)` : '') : '');
  const used = new Set(failures.map(allowedFor).filter(Boolean));
  check('every excuse is still needed, so the list is not hiding anything that got fixed', ALLOWED.every(a => used.has(a)), ALLOWED.filter(a => !used.has(a)).map(a => String(a.test)).join(', '));

  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
