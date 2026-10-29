// Where the browser the suites drive lives, in one place.
//
//   CHROME_BIN       an explicit path (CI, a developer's own Chrome) — wins over everything
//   installed        the Chromium the dev image ships under /opt/pw-browsers/chromium-<rev>
//   puppeteer's own  the Chrome puppeteer downloaded when it was installed (what CI has)
//
// Nothing else in the repository names a browser path.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

// The newest Chromium under the dev image's browsers directory, or null.
function installedChromium() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(BROWSERS_ROOT).filter(n => /^chromium-\d+$/.test(n));
  } catch (_) {
    return null;
  }
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = path.join(BROWSERS_ROOT, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

// The path to hand to puppeteer.launch({ executablePath }).
function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const installed = installedChromium();
  if (installed) return installed;
  try {
    return require('puppeteer').executablePath();
  } catch (_) {
    return undefined; // puppeteer reports what it could not find, in its own words
  }
}

// For the code that launches puppeteer indirectly (the PDF renderer): puppeteer reads its
// configuration once, when it is required, so this has to run before that require.
function pointPuppeteerAtChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return;
  if (process.env.CHROME_BIN) {
    process.env.PUPPETEER_EXECUTABLE_PATH = process.env.CHROME_BIN;
    return;
  }
  const cache = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
  if (fs.existsSync(path.join(cache, 'chrome'))) return; // puppeteer has a Chrome of its own
  const installed = installedChromium();
  if (installed) process.env.PUPPETEER_EXECUTABLE_PATH = installed;
}

// navigate() inside the page, proving it landed. The suites used to swallow whatever navigate()
// threw ("try { navigate(p) } catch {}"), so a function that was gone, or a page the portal
// bounced somewhere else, made them measure whatever screen happened to be open and stay green.
// This throws instead: navigate() must exist, must not throw, and the page it activates must be
// the one that was asked for (#page-<name> carries .active).
async function gotoPage(page, name) {
  const r = await page.evaluate(n => {
    if (typeof navigate !== 'function') return { ok: false, why: 'navigate() is not defined on this page' };
    try {
      navigate(n);
    } catch (e) {
      return { ok: false, why: 'navigate() threw: ' + String(e) };
    }
    const el = document.querySelector('.page.active');
    return { ok: !!el && el.id === 'page-' + n, why: 'the active page is ' + (el ? '#' + el.id : 'none') };
  }, name);
  if (!r.ok) throw new Error("navigate('" + name + "') did not land: " + r.why);
}

module.exports = { chromePath, installedChromium, pointPuppeteerAtChrome, gotoPage };
