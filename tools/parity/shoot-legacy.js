#!/usr/bin/env node
// Photographs every page of both legacy portals — the parity baseline for the new app.
//
// The plan (README: "Migrating to one codebase") ports the portals module by module, and
// "looks the same" has to be shown, not asserted. This takes the pictures to show it against: both
// portals booted on demo data (tests/helpers/demo-data.js), every page they have — the list is read
// from the page, not typed here — in light and dark, at desktop and phone width, plus the sign-in
// screens. A page that will not open (it bounced to Home) is a problem in the report, not a
// picture of Home under its name.
//
//   node tools/parity/shoot-legacy.js                          52 pages × light/dark × 1440/390 → .parity/legacy
//   node tools/parity/shoot-legacy.js --out /tmp/shots --only admin --pages home,tasks
//   node tools/parity/shoot-legacy.js --modes dark --widths 1440
//   node tools/parity/shoot-legacy.js --stub-cdn               offline: no icons, no charts (lucide and Chart.js are stubbed)
//   node tools/parity/shoot-legacy.js --ui next                the same, with the new app's switch on (ml_ui=next)
//
// Not part of tests/run.sh: it produces pictures, not a verdict. CI can upload the folder as an artifact.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { bootDemo } = require('../../tests/helpers/demo-data');
const { chromePath, gotoPage } = require('../../tests/helpers/browser');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = name => argv.includes('--' + name);

const OUT = path.resolve(opt('out', path.join(__dirname, '..', '..', '.parity', 'legacy')));
const ONLY = opt('only', '');
const PAGES = opt('pages', '');
const MODES = opt('modes', 'light,dark').split(',');
const WIDTHS = opt('widths', '1440,390').split(',').map(Number);
const UI = opt('ui', 'legacy');
const STUB_CDN = flag('stub-cdn');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openPage(browser, { who, route, key, token }, { mode, width, signedIn, base }) {
  const page = await browser.newPage();
  const phone = width < 600;
  await page.setViewport({ width, height: phone ? 844 : 900, isMobile: phone, hasTouch: phone });
  await page.setBypassServiceWorker(true);
  if (STUB_CDN) {
    await page.setRequestInterception(true);
    page.on('request', req => (/unpkg|jsdelivr|fonts\.g|gstatic/.test(req.url()) ? req.respond({ status: 200, contentType: 'text/plain', body: '' }) : req.continue()));
  }
  await page.setCookie({ name: 'ml_ui', value: UI, url: base });
  await page.evaluateOnNewDocument((key, token, mode, signedIn, stub) => {
    if (stub) {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
    }
    if (signedIn) localStorage.setItem(key, token); else localStorage.removeItem(key);
    localStorage.setItem('ml_mode', mode);
    localStorage.setItem('ml_pwa_dismissed', '1');
    const Real = Date, FIXED = Real.UTC(2026, 2, 4, 10, 0, 0);
    window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
    window.Date.UTC = Real.UTC; window.Date.parse = Real.parse;
  }, key, token, mode, signedIn, STUB_CDN);
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  if (signedIn) {
    await page.waitForFunction(() => {
      const app = document.getElementById('app'), layout = document.getElementById('layout');
      return (app && app.style.display === 'block') || (layout && getComputedStyle(layout).display !== 'none');
    }, { timeout: 20000 }).catch(() => {});
  }
  await sleep(800);
  return page;
}

async function photograph(page, file) {
  await page.evaluate(() => {
    document.getAnimations().forEach(a => a.cancel());
    const b = document.getElementById('pwa-install-banner'); if (b) b.remove();
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
}

(async () => {
  const { base, portals } = await bootDemo({ port: Number(opt('port', process.env.PORT || 3969)) });
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const shots = [], problems = [], pageLists = {};
  for (const portal of portals) {
    if (ONLY && ONLY !== portal.who) continue;
    for (const mode of MODES) for (const width of WIDTHS) {
      const dir = `${portal.who}/${mode}-${width}`;
      // the sign-in screen
      const out = await openPage(browser, portal, { mode, width, signedIn: false, base });
      await photograph(out, path.join(OUT, dir, 'signin.png'));
      shots.push({ portal: portal.who, mode, width, page: 'signin', file: `${dir}/signin.png` });
      await out.close();
      // every page the portal has
      const page = await openPage(browser, portal, { mode, width, signedIn: true, base });
      const names = await page.evaluate(() => [...document.querySelectorAll('.page')].map(p => p.id).filter(id => id.startsWith('page-')).map(id => id.slice(5)));
      pageLists[portal.who] = names;
      for (const name of names) {
        if (PAGES && !PAGES.split(',').includes(name)) continue;
        try {
          await gotoPage(page, name);
        } catch (e) {
          problems.push({ portal: portal.who, mode, width, page: name, problem: e.message });
          continue;
        }
        await sleep(700);
        await photograph(page, path.join(OUT, dir, name + '.png'));
        shots.push({ portal: portal.who, mode, width, page: name, file: `${dir}/${name}.png` });
      }
      await page.close();
      console.log(`${dir}: ${names.length} pages`);
    }
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ ui: UI, modes: MODES, widths: WIDTHS, pages: pageLists, shots, problems }, null, 2) + '\n');
  const counts = Object.entries(pageLists).map(([w, l]) => `${w} ${l.length}`).join(', ');
  console.log(`${shots.length} pictures in ${OUT} (pages: ${counts}); ${problems.length} page(s) would not open`);
  for (const p of problems) console.log(`  ✗ ${p.portal} ${p.mode}-${p.width} ${p.page}: ${p.problem}`);
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
