// Point puppeteer at a Chrome it can launch, for the suites that print a document to PDF
// (src/lib/docs/render.js) or look at one in a browser.
//
//   require('./helpers/browser').pointPuppeteerAtChrome();   // before puppeteer or the renderer is required
//
// puppeteer reads PUPPETEER_EXECUTABLE_PATH once, when it is loaded, so this has to run first.
// It leaves things alone when the variable is already set or when puppeteer has a Chrome of its own
// (a `chrome` folder in its cache directory). Otherwise it takes the Chromium a Playwright install
// leaves under /opt/pw-browsers: the `chromium` link when there is one, else the newest chromium-N
// folder (chrome-linux/ or chrome-linux64/). Returns the Chrome it settled on, or null when
// puppeteer is left to find its own.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PW_ROOT = '/opt/pw-browsers';

function pointPuppeteerAtChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const cache = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
  if (fs.existsSync(path.join(cache, 'chrome')) || !fs.existsSync(PW_ROOT)) return null;
  const newest = fs.readdirSync(PW_ROOT).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  const candidates = [path.join(PW_ROOT, 'chromium'), ...newest.flatMap(d => ['chrome-linux', 'chrome-linux64'].map(s => path.join(PW_ROOT, d, s, 'chrome')))];
  const exe = candidates.find(p => fs.existsSync(p));
  if (exe) process.env.PUPPETEER_EXECUTABLE_PATH = exe;
  return exe || null;
}

module.exports = { pointPuppeteerAtChrome };
