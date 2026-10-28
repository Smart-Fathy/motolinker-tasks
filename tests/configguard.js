// Shared configuration and saved documents that every screen draws: column keys and
// colours, the quotation settings, quote numbers, quotation lines and images.
//
// One employee's input here is rendered in everyone's browser, the admin's included,
// and each of these let it out of its attribute or string:
// - column and option keys went into single-quoted onclick arguments unchecked;
// - option colours went into style="…" raw, and the generic employee settings write
//   accepted ANY key, so a column config could be stored without its sanitiser —
//   and the matching read handed out every key, the admin-password fingerprint too;
// - escJs left & alone, so the literal text &#39; in a quote number became a quote
//   once the browser decoded the attribute, and closed the string;
// - a quotation line's unit and a saved image's src were interpolated raw.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3958';

const POISON_COLS = [
  { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
  { key: "k');window.__pwned=1;('", label: 'Pwn', type: 'text', visible: true },
  { key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true, options: [
    { key: 'cold', label: 'Cold', color: '#000"><img src=x onerror=window.__pwned=2>' },
    { key: "hot');window.__pwned=3;//", label: 'Hot' },
    { key: 'warm', label: 'Warm', color: '#ff8800' },
  ] },
];
const STORED = {
  company_name: 'MotoLinker', payment_terms: '50% upfront',
  nav_config: '{"groups":[]}', admin_pw_version: 'fingerprint-of-the-admin-password',
  leads_columns_config: JSON.stringify(POISON_COLS),
};

const upserts = [];
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  if (init && init.method === 'POST' && init.body) upserts.push({ url, body: JSON.parse(String(init.body)) });
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const one = accept.includes('pgrst.object');
  let out = one ? {} : [];
  if (url.includes('/quotation_settings')) {
    // Answer like PostgREST would ignore nothing: the handler must filter itself too.
    const m = /key=eq\.([^&]+)/.exec(url);
    const rows = Object.entries(STORED).map(([key, value]) => ({ key, value }));
    out = m ? (one ? (rows.find(r => r.key === decodeURIComponent(m[1])) || {}) : rows.filter(r => r.key === decodeURIComponent(m[1]))) : rows;
  }
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

(async () => {
  require(process.cwd() + '/index.js');
  const ctx = require(process.cwd() + '/src/ctx.js');
  const { sanitizeColumns } = require(process.cwd() + '/src/routes/columns.js');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');

  // ── The sanitiser ──
  {
    const clean = sanitizeColumns(POISON_COLS);
    const keys = clean.map(c => c.key), status = clean.find(c => c.key === 'lead_status');
    check('a column key with a quote in it is dropped', !keys.some(k => /'/.test(k)), JSON.stringify(keys));
    check('so is an option key with one', !status.options.some(o => /'/.test(o.key)), JSON.stringify(status.options.map(o => o.key)));
    check('a colour that is not #rrggbb is not kept', !status.options.some(o => o.color && !/^#[0-9a-f]{6}$/.test(o.color)));
    check('ordinary keys, labels with apostrophes and colours survive',
      JSON.stringify(sanitizeColumns([{ key: 'cf_owners_phone', label: "Owner's phone", type: 'text' }, { key: 'lead_status', type: 'select', options: [{ key: 'warm', label: 'Warm', color: '#FF8800' }] }]))
        === JSON.stringify([{ key: 'cf_owners_phone', label: "Owner's phone", type: 'text', builtin: false, visible: true }, { key: 'lead_status', label: 'lead_status', type: 'select', builtin: false, visible: true, options: [{ key: 'warm', label: 'Warm', color: '#ff8800' }] }]));
    check('a saved config passes through unchanged (so reading it back is safe)',
      JSON.stringify(sanitizeColumns(clean)) === JSON.stringify(clean));
  }

  // ── The routes ──
  const base = 'http://127.0.0.1:' + process.env.PORT;
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/push/vapid-public-key'); break; }
    catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  const rep = 'cfg-guard-rep';
  ctx.employeeSessions.set(rep, { id: 7, name: 'Rep', username: 'rep', job_title: 'Sales',
    permissions: normEmpPerms({ quotation: true, quotationActions: { draft: true, history: true, settings: true },
                                leads: true, leadsActions: { view: true, edit: true } }) });
  const call = (method, p, body) => fetch(base + p, { method,
    headers: { Authorization: 'Bearer ' + rep, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  {
    const r = await call('GET', '/api/employee/quotation/settings');
    const s = await r.json();
    check('the rep can read the quotation settings', r.status === 200 && s.company_name === 'MotoLinker', `${r.status} ${JSON.stringify(s)}`);
    check('…and only those: no admin-password fingerprint, nav or column config',
      !('admin_pw_version' in s) && !('nav_config' in s) && !('leads_columns_config' in s), Object.keys(s).join(','));
  }
  {
    upserts.length = 0;
    const r = await call('PUT', '/api/employee/quotation/settings', {
      company_name: 'Acme', nav_config: '{"groups":[{"key":"x"}]}', admin_pw_version: 'mine',
      leads_columns_config: JSON.stringify(POISON_COLS) });
    const written = upserts.filter(u => u.url.includes('quotation_settings')).flatMap(u => [].concat(u.body)).map(e => e.key);
    check('a settings save writes the quotation fields', r.status === 200 && written.includes('company_name'), `${r.status} ${written}`);
    check('…and nothing else: not the nav, not a column config, not the admin fingerprint',
      written.every(k => k === 'company_name'), written.join(','));
  }
  {
    const r = await call('GET', '/api/employee/columns/leads');
    const d = await r.json();
    const cols = (d && d.columns) || [];
    const status = cols.find(c => c.key === 'lead_status') || { options: [] };
    check('a poisoned column config already in the table is cleaned on the way out',
      r.status === 200 && cols.length > 0 && !JSON.stringify(cols).includes('__pwned') && status.options.every(o => !o.color || /^#[0-9a-f]{6}$/.test(o.color)),
      `${r.status} ${JSON.stringify(cols).slice(0, 160)}`);
  }

  // ── The screens ──
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(/auth\/check$/.test(u.pathname) ? { ok: true } : []) });
    }
    if (u.pathname === '/dashboard') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/dashboard.html', 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('ml_admin_token', 'admin-token'));
  await page.goto(`http://127.0.0.1:${port}/dashboard`, { waitUntil: 'networkidle2' }).catch(() => {});

  // A quote number reaches the PDF button exactly as stored, and never runs.
  {
    const out = await page.evaluate(() => {
      const got = [];
      window.viewDocPdf = (...a) => got.push(a[2]);
      const ids = ["Q1&#39;);window.__pwned=4;//", "Q1');window.__pwned=5;//", 'Q1\\\');window.__pwned=6;//', 'Q-2026-0042'];
      for (const id of ids) {
        const box = document.createElement('div');
        box.innerHTML = `<button onclick="viewDocPdf('quotation',7,'${escJs(id)}')">PDF</button>`;
        document.body.appendChild(box);
        try { box.querySelector('button').click(); } catch (_) {}
        box.remove();
      }
      return { ids, got, pwned: window.__pwned || null };
    });
    check('a quote number with &#39; or a quote does not run', !out.pwned, String(out.pwned));
    check('…and the PDF button still gets the number exactly as stored', JSON.stringify(out.got) === JSON.stringify(out.ids), JSON.stringify(out.got));
  }
  // A poisoned option colour cannot add markup to a badge.
  {
    const out = await page.evaluate(() => {
      const E = ColumnsEngine('cfgguard', { base: '/api/dashboard', fetch: apiFetch, builtins: [] });
      const col = { key: 'lead_status', options: [{ key: 'cold', label: 'Cold', color: '#000"><img src=x onerror=window.__pwned=7>' }, { key: 'warm', label: 'Warm', color: '#ff8800' }] };
      const box = document.createElement('div');
      box.innerHTML = E.badgeHtml(col, 'cold') + E.badgeHtml(col, 'warm');
      document.body.appendChild(box);
      const r = { imgs: box.querySelectorAll('img').length, spans: box.querySelectorAll('span').length, warm: box.innerHTML.includes('#ff8800') };
      box.remove();
      return r;
    });
    await new Promise(r => setTimeout(r, 200));
    const pwned = await page.evaluate(() => window.__pwned || null);
    check('a colour with markup in it draws a plain badge', out.imgs === 0 && out.spans === 2 && !pwned, JSON.stringify(out) + ' ' + pwned);
    check('…and a real colour is still used', out.warm);
  }
  // Quotation lines and saved images, through the real quote-builder code.
  {
    await page.evaluate(() => navigate('quotation'));
    await page.waitForSelector('#qt-items', { timeout: 5000 }).catch(() => {});
    const SRC = fs.readFileSync('public/assets/quote.js', 'utf8');
    const from = SRC.indexOf('function imgPreviewWrap(src, onRemove) {');
    const to = SRC.indexOf('\n  }\n', from) + 4;
    const fnSrc = SRC.slice(from, to);
    const out = await page.evaluate(fnSrc => {
      const rows0 = document.querySelectorAll('#qt-items tr').length;
      addPricingRow('Car', '1"><img src=x onerror=window.__pwned=8>', '100');
      const row = [...document.querySelectorAll('#qt-items tr')].pop();
      const imgPreviewWrap = new Function('esc', fnSrc + '; return imgPreviewWrap;')(esc);
      const a = imgPreviewWrap('x" onerror="window.__pwned=9', 'void 0');
      const b = imgPreviewWrap('data:image/png;base64,iVBORw0KGgo=', 'void 0');
      document.body.append(a, b);
      return {
        added: document.querySelectorAll('#qt-items tr').length === rows0 + 1,
        rowImgs: row ? row.querySelectorAll('img').length : -1,
        unitValue: row ? row.querySelector('input[type=number]').getAttribute('value') : null,
        badHasOnerror: a.querySelector('img').hasAttribute('onerror'),
        goodSrc: b.querySelector('img').getAttribute('src'),
      };
    }, fnSrc);
    await new Promise(r => setTimeout(r, 300));
    const pwned = await page.evaluate(() => window.__pwned || null);
    check('a quotation line with markup in its unit adds no element', out.added && out.rowImgs === 0, JSON.stringify(out));
    check('a saved image src cannot add an onerror', !out.badHasOnerror && !pwned, JSON.stringify(out) + ' ' + pwned);
    check('a real saved image is still shown', out.goodSrc === 'data:image/png;base64,iVBORw0KGgo=', String(out.goodSrc));
  }
  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} config and document checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
