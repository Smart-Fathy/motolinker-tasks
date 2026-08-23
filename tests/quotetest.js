// The quotation sheet: one implementation, both portals, PO/RFQ idiom — and the
// server contract byte-compatible with what the old builder sent.
//
// Two implementations used to exist (~620 lines admin, ~440 employee). What can
// go wrong in this collapse: the portal posting to the other portal's API, the
// multipart field names drifting so the server reads nothing, the FREE toggle or
// exchange recalc breaking silently, or a rep with only history access still
// being offered a draft button.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const SAVED = { id: 9, quote_id: 'Q-2026-014', title: 'Q-2026-014 — Mona', created_by: 'admin',
  customer_id: 2, created_at: '2026-08-01T00:00:00Z',
  data: { id: 'Q-2026-014', date: '2026-08-01', validTo: '2026-08-08', name: 'Mona Said',
    vehicleModel: 'BYD Seal', currency: 'EGP', exchange: '48', issuer: 'Admin', template: 'brand',
    items: [{ name: 'BYD Seal Premium', unit: '1', priceUsd: '30000' }, { name: 'Window tint', unit: '1', priceUsd: 'Free' }],
    logistics: [{ label: 'Ocean Freight', priceUsd: '1200' }],
    customSpecs: [{ key: '', val: 'Incoterms: CIF' }], imageDataUrls: [] } };

let generatePosts = [];
function api(u, method, postData, headers) {
  const p = u.pathname;
  if (/quotation\/generate$/.test(p)) {
    generatePosts.push({ path: p, body: postData || '', ct: headers['content-type'] || '' });
    return { pdf: Buffer.from('%PDF-1.4 fake').toString('base64') };
  }
  if (/quotation\/newid$/.test(p)) return { id: 'Q-2026-099' };
  // The quotation's own configurable fields — the document half of the engine.
  if (/columns\/quote_doc$/.test(p)) return { columns: [
    { key: 'cf_bank', label: 'Financing bank', type: 'select', builtin: false, visible: true,
      options: [{ key: 'cib', label: 'CIB' }, { key: 'cash', label: 'Cash' }] } ] };
  if (/quotations\/9$/.test(p)) return SAVED;
  if (/quotations$/.test(p)) return [SAVED];
  if (/quotation\/settings$/.test(p)) return { company_name: 'MotoLinker' };
  if (/employees-for-tasks$/.test(p)) return [{ id: 1, name: 'Admin' }, { id: 2, name: 'Sara' }];
  if (/lead-options$/.test(p)) return [{ id: 2, name: 'Mona Said', phone: '0101' }];
  if (/coworkers$/.test(p)) return [{ id: 2, name: 'Sara' }];
  if (/dashboard\/customers$/.test(p)) return [{ id: 2, name: 'Mona Said', phone: '0101' }];
  if (/auth\/check$/.test(p)) return { ok: true };
  if (/employee\/check$/.test(p)) return { ok: true, id: 2, name: 'Sara', permissions: {} };
  return [];
}

async function openPortal(browser, { route, file, tokenKey, port, perms }) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify(api(u, req.method(), req.postData(), req.headers())) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => localStorage.setItem(k, 't'), tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(500);
  if (perms) { await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, perms); await sleep(100); }
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', apiBase: '/api/dashboard' },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', apiBase: '/api/employee',
      perms: { quotation: true, quotationActions: { draft: true, history: true, settings: true, delete: true, attachLead: true } } },
  ]) {
    generatePosts = [];
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(() => navigate('quotation'));
    await sleep(400);

    // Open a SAVED quotation into the sheet — everything must round-trip.
    const sheet = await page.evaluate(async () => {
      await editQuotation(9);
      await new Promise(r => setTimeout(r, 300));
      const v = id => (document.getElementById(id) || {}).value;
      return {
        // The sheet is the Draft tab now, not a modal over it.
        open: getComputedStyle(document.getElementById('qt-panel-draft')).display !== 'none'
              && document.getElementById('qt-tab-draft').classList.contains('active'),
        id: v('qt-id'), name: v('qt-name'), exchange: v('qt-exchange'), template: v('qt-template'),
        rows: document.querySelectorAll('#qt-items .qt-item-row').length,
        freeCell: document.querySelectorAll('#qt-items .qt-item-row')[1]?.querySelector('.qt-egp')?.textContent,
        logi0: v('qt-log-usd-0'),
        total: document.getElementById('qt-grand-total')?.textContent,
      };
    });
    check(`${portal.label}: a saved quotation opens in the sheet with every field`,
      sheet.open && sheet.id === 'Q-2026-014' && sheet.name === 'Mona Said' && sheet.rows === 2 && sheet.logi0 === '1200',
      JSON.stringify(sheet));
    check(`${portal.label}: the FREE line renders as Free`, sheet.freeCell === 'Free', String(sheet.freeCell));
    // 30000 * 48 + 1200 * 48 = 1,497,600
    check(`${portal.label}: totals recompute from the exchange rate`,
      sheet.total === (30000 * 48 + 1200 * 48).toLocaleString('en-US'), String(sheet.total));

    const recalced = await page.evaluate(async () => {
      document.getElementById('qt-exchange').value = '50';
      qtRecalcAll();
      return document.getElementById('qt-grand-total').textContent;
    });
    check(`${portal.label}: changing the exchange recomputes every mirror`,
      recalced === (30000 * 50 + 1200 * 50).toLocaleString('en-US'), recalced);

    // The quotation's own configurable fields render on the sheet, and the
    // chosen value must ride the multipart the server already parses.
    const docFields = await page.evaluate(() => {
      const sel = document.querySelector('[data-doc-extras="quote_doc"] [data-cek="cf_bank"]');
      if (sel) sel.value = 'cash';
      return { tag: sel ? sel.tagName : null,
               fieldsBtn: [...document.querySelectorAll('#qt-panel-draft button')]
                 .some(b => /\+ Field/.test(b.textContent)) };
    });
    // The team fills the fields in; only the admin may change what they are —
    // the server refuses employee writes to these configs, so the portal does
    // not offer a doomed button.
    check(`${portal.label}: the quotation carries its configurable document fields`,
      docFields.tag === 'SELECT' && docFields.fieldsBtn === (portal.label === 'admin'),
      JSON.stringify(docFields));

    // Generate: the POST must go to THIS portal's API as multipart with the
    // exact field names the server has always read.
    await page.evaluate(() => generateQuotation());
    await sleep(400);
    check(`${portal.label}: generate posts to its own portal`,
      generatePosts.length === 1 && generatePosts[0].path === `${portal.apiBase}/quotation/generate`,
      JSON.stringify(generatePosts.map(g => g.path)));
    const body = generatePosts[0] ? generatePosts[0].body : '';
    const fields = ['id', 'date', 'validTo', 'name', 'vehicleModel', 'currency', 'exchange', 'issuer',
      'items', 'logistics', 'customSpecs', 'customFields', 'template', 'existingImages', 'quotation_pk'];
    const missing = fields.filter(f => !new RegExp(`name="${f}"`).test(body));
    check(`${portal.label}: the multipart body carries every field the server reads`,
      generatePosts[0] && /multipart\/form-data/.test(generatePosts[0].ct) && missing.length === 0,
      missing.join(',') || generatePosts[0]?.ct);
    check(`${portal.label}: the chosen document-field value is in the body`,
      /name="customFields"[\s\S]{0,60}cf_bank[\s\S]{0,20}cash/.test(body), body.slice(0, 0) || 'no customFields part');
    check(`${portal.label}: editing carries the record id so Generate UPDATES it`,
      /name="quotation_pk"[\s\S]{0,20}9/.test(body));
    const pdfShown = await page.evaluate(() =>
      getComputedStyle(document.getElementById('doc-modal')).display !== 'none'
      && document.getElementById('doc-modal-title').textContent);
    check(`${portal.label}: the PDF previews in the shared document viewer`,
      /Quotation Q-2026-014/.test(String(pdfShown)), String(pdfShown));

    // History renders through the same shared code.
    const hist = await page.evaluate(async () => {
      document.getElementById('doc-modal').style.display = 'none';
      PROCFG.closeModal();
      switchQtTab('history');
      await new Promise(r => setTimeout(r, 300));
      return document.getElementById('qt-history-body').textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
    });
    check(`${portal.label}: history lists the saved quotation`, /Q-2026-014/.test(hist), hist);
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── History-only: reading without drafting ──────────────────────────────────
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { quotation: true, quotationActions: { history: true } } });
    await page.evaluate(() => navigate('quotation'));
    await sleep(200);
    const v = await page.evaluate(async () => {
      switchQtTab('history');
      await new Promise(r => setTimeout(r, 300));
      const vis = sel => [...document.querySelectorAll(sel)].some(el => getComputedStyle(el).display !== 'none' && el.offsetParent !== null);
      return {
        draftBtns: vis('[data-perm="quotation.draft"]'),
        historyText: document.getElementById('qt-history-body').textContent,
        editBtn: /Edit/.test(document.getElementById('qt-history-body').innerHTML),
      };
    });
    check('a history-only rep is offered no draft button anywhere', v.draftBtns === false, String(v.draftBtns));
    check('…but still reads the history', /Q-2026-014/.test(v.historyText));
    check('…with no Edit buttons on the rows', v.editBtn === false);
    await page.close();
  }

  // ── One implementation, no corpses ──────────────────────────────────────────
  {
    const emp = fs.readFileSync('public/assets/employee.js', 'utf8');
    const dash = fs.readFileSync('public/assets/dashboard.js', 'utf8');
    check('the employee duplicate is gone', !/emp-qt-|EMP_LOGISTICS_LABELS|empGenerateQuotation/.test(emp));
    check('the admin builder is gone from dashboard.js',
      !/LOGISTICS_LABELS|function generateQuotation|function addPricingRow/.test(dash));
    check('the static builder panels are gone from both pages',
      !/qt-img-drop|qt-modal/.test(fs.readFileSync('public/dashboard.html', 'utf8'))
      && !/emp-qt-/.test(fs.readFileSync('public/employee.html', 'utf8')));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
