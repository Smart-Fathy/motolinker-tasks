#!/usr/bin/env node
/**
 * Autohome.com.cn car config/series page scraper
 * Usage:  node scraper-autohome.js [url] [--out output.json]
 * Default URL: https://www.autohome.com.cn/config/series/7752.html#pvareaid=100134
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const DEFAULT_URL = 'https://www.autohome.com.cn/config/series/7752.html#pvareaid=100134';

const args    = process.argv.slice(2);
const url     = args.find(a => a.startsWith('http')) || DEFAULT_URL;
const outFlag = args.indexOf('--out');
const outFile = outFlag !== -1 ? args[outFlag + 1] : null;

(async () => {
  console.log(`[scraper] Launching browser…`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();

  // Realistic browser headers to avoid bot detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

  // Intercept and capture background XHR/fetch calls — autohome often loads
  // config data as JSON which we can grab directly.
  const interceptedJsonUrls = [];
  page.on('response', async response => {
    const u = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') && (u.includes('config') || u.includes('spec') || u.includes('car'))) {
      interceptedJsonUrls.push(u);
    }
  });

  console.log(`[scraper] Loading: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for the config table — autohome uses .config-list or similar
  const tableSelectors = [
    '.config-table',
    '.config-list',
    '.param-list',
    '.car-param',
    'table.tb-config',
    '.js-config-wrap',
    '.config-wrap',
    '.spec-table',
  ];

  let foundSelector = null;
  for (const sel of tableSelectors) {
    const el = await page.$(sel);
    if (el) { foundSelector = sel; break; }
  }

  if (!foundSelector) {
    // Generic fallback: wait up to 10s for any table
    try {
      await page.waitForSelector('table', { timeout: 10000 });
      foundSelector = 'table';
    } catch (_) {
      console.warn('[scraper] Warning: no table found — will still attempt DOM extraction');
    }
  }

  console.log(`[scraper] Table selector: ${foundSelector || 'none'}`);

  // ── Extract series name and trim levels ─────────────────────────────────────
  const data = await page.evaluate(() => {
    // Helper
    const text = el => (el ? el.textContent.trim().replace(/\s+/g, ' ') : '');

    // Series / model name from page title or heading
    const seriesName =
      text(document.querySelector('h1')) ||
      text(document.querySelector('.car-title')) ||
      text(document.querySelector('.title')) ||
      document.title.replace(/[-_|].*/,'').trim();

    // ── Try to extract the config comparison table ──────────────────────────
    // autohome config pages have a fixed left column (spec names) and N columns
    // (one per trim level). The layout varies by version but falls into two patterns:
    //   A) <table> with <thead> rows for trim names and <tbody> for spec rows
    //   B) A custom div-grid where left-sticky divs are spec names

    let trims   = []; // array of { name, price }
    let specs   = []; // array of { category, name, values: [v0, v1, …] }

    // ── Pattern A: standard <table> ────────────────────────────────────────
    const tables = Array.from(document.querySelectorAll('table'));
    for (const tbl of tables) {
      const rows = Array.from(tbl.querySelectorAll('tr'));
      if (rows.length < 3) continue;

      // First row = trim headers
      const headerCells = Array.from(rows[0].querySelectorAll('th, td'));
      if (headerCells.length < 2) continue;

      const headerTexts = headerCells.map(c => text(c)).filter(Boolean);
      if (trims.length === 0) {
        trims = headerTexts.slice(1).map(name => ({ name, price: '' }));
      }

      // Remaining rows = spec rows
      for (const row of rows.slice(1)) {
        const cells = Array.from(row.querySelectorAll('th, td'));
        if (cells.length < 2) continue;
        const specName = text(cells[0]);
        const values   = cells.slice(1).map(c => text(c));
        // Skip empty rows
        if (!specName && values.every(v => !v)) continue;
        specs.push({ category: '', name: specName, values });
      }

      if (specs.length > 5) break; // found a good table
    }

    // ── Pattern B: autohome-style div layout ───────────────────────────────
    // They often render .config-th for headers and .config-list-item for rows
    if (specs.length === 0) {
      // Trim headers
      const thEls = document.querySelectorAll('.config-th .config-item, .thead .item, .th-car .item');
      if (thEls.length) {
        trims = Array.from(thEls).map(el => ({
          name: text(el.querySelector('.name, .title') || el),
          price: text(el.querySelector('.price') || null),
        }));
      }

      // Row items
      const rowEls = document.querySelectorAll('.config-list-item, .config-row, .param-row, .item-row');
      let currentCategory = '';
      rowEls.forEach(row => {
        // Category separator
        const catEl = row.querySelector('.config-name, .param-name, .cat-title');
        if (row.classList.contains('config-cat') || row.classList.contains('category')) {
          currentCategory = text(row);
          return;
        }
        const specName = text(catEl || row.querySelector('dt, .label') || null);
        const valueCells = row.querySelectorAll('.config-value, .value, dd');
        const values = Array.from(valueCells).map(c => text(c));
        if (specName && values.length) {
          specs.push({ category: currentCategory, name: specName, values });
        }
      });
    }

    // ── Pattern C: collect all visible text rows as a last resort ──────────
    if (specs.length === 0) {
      const rows = document.querySelectorAll('[class*="row"], [class*="item"], [class*="param"]');
      rows.forEach(row => {
        const children = Array.from(row.children);
        if (children.length >= 2) {
          const specName = text(children[0]);
          const values   = children.slice(1).map(c => text(c));
          if (specName && values.some(Boolean)) {
            specs.push({ category: '', name: specName, values });
          }
        }
      });
    }

    // ── Price row (may be separate from specs table) ────────────────────────
    const priceEls = document.querySelectorAll('.price, .car-price, [class*="price"]');
    priceEls.forEach((el, i) => {
      const p = text(el).replace(/[^\d.,万元CNY¥]/g, '').trim();
      if (p && trims[i]) trims[i].price = p;
    });

    return { seriesName, trims, specs, url: location.href };
  });

  await browser.close();

  // ── Build structured output ────────────────────────────────────────────────
  const result = {
    scraped_at:  new Date().toISOString(),
    url:         data.url,
    series_name: data.seriesName,
    trims:       data.trims,
    total_trims: data.trims.length,
    specs:       data.specs,
    total_specs: data.specs.length,
  };

  // Pretty-print to console
  console.log('\n──────────────────────────────────────────────');
  console.log(`Series: ${result.series_name}`);
  console.log(`URL:    ${result.url}`);
  console.log(`Trims (${result.total_trims}):`);
  result.trims.forEach((t, i) => {
    console.log(`  [${i}] ${t.name}${t.price ? '  ' + t.price : ''}`);
  });
  console.log(`Specs rows: ${result.total_specs}`);
  if (result.specs.length) {
    console.log('First 5 spec rows:');
    result.specs.slice(0, 5).forEach(s => {
      console.log(`  ${s.name}: ${s.values.slice(0, 3).join(' | ')}`);
    });
  }
  console.log('──────────────────────────────────────────────');

  // Save JSON
  const dest = outFile || path.join(__dirname, 'autohome-output.json');
  fs.writeFileSync(dest, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n[scraper] Saved → ${dest}`);

  if (result.specs.length === 0) {
    console.warn('\n[scraper] ⚠️  No specs extracted — the page structure may differ.');
    console.warn('           Intercepted JSON URLs (check these for raw API data):');
    interceptedJsonUrls.forEach(u => console.warn('  ' + u));
  }
})().catch(err => {
  console.error('[scraper] Fatal:', err.message);
  process.exit(1);
});
