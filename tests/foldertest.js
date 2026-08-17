// Per-client Drive folders: who may open one, and what lands in it.
//
// Two halves. The first drives the real lead drawer in both portals against a
// stubbed API — the button, the sharing list, and the rep who is allowed to
// create a folder but not open it. The second exercises the server module's own
// rules, because "who can see the client's passport scans" is not a question to
// answer by reading the UI.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const LEADS = [{ id: 5, name: 'Ahmed Kamal', phone: '0101234567', lead_status: 'hot', custom_fields: {} }];
const PROFILE = {
  customer: LEADS[0], activities: [], followups: [], deals: [],
  quotations: [{ id: 12, quote_id: 'Q-2026-014', title: 'Seal', created_by: 'admin', created_at: '2026-08-01' }],
  contracts: [], purchaseOrders: [],
};
// The folder as the server would report it: not created yet, then created.
let folderState = { exists: false, name: '', documents: 0, viewers: [], link: '', canOpen: true };
let posted = [], viewerPuts = [];

function api(pathname, method, body) {
  if (/\/folder\/viewers$/.test(pathname)) {
    viewerPuts.push(JSON.parse(body || '{}'));
    folderState = { ...folderState, viewers: JSON.parse(body).viewers };
    return folderState;
  }
  if (/\/folder$/.test(pathname)) {
    if (method === 'POST') {
      posted.push(pathname);
      folderState = { exists: true, name: 'Ahmed Kamal — 0101234567', documents: 4, viewers: folderState.viewers,
                      link: 'https://drive.google.com/drive/folders/abc', canOpen: true,
                      added: ['Quotation Q-2026-014.pdf', 'RFQ MT1.pdf', 'PO PO-1.pdf', 'Contract CT-1.pdf'], failed: [] };
    }
    return folderState;
  }
  if (/customers\/\d+\/profile$|leads\/\d+\/profile$/.test(pathname)) return PROFILE;
  if (/employees-for-tasks$|coworkers$/.test(pathname)) return [{ id: 2, name: 'Sara Ahmed' }, { id: 3, name: 'Omar Nabil' }];
  if (/(leads\/columns|columns\/leads)$/.test(pathname)) return { columns: [
    { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
    { key: 'phone', label: 'Phone', type: 'text', builtin: true, visible: true }] };
  if (/customers$|employee\/leads$/.test(pathname)) return LEADS;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', permissions: {} };
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
        body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
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

  // ── Admin: create, then share ───────────────────────────────────────────────
  {
    folderState = { exists: false, name: '', documents: 0, viewers: [], link: '', canOpen: true };
    posted = []; viewerPuts = [];
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    await page.evaluate(() => navigate('leads'));
    await sleep(500);
    const before = await page.evaluate(async () => {
      await openLeadProfile(5);
      await new Promise(r => setTimeout(r, 400));
      const box = document.getElementById('cf-body');
      return { present: !!document.getElementById('cf-section'),
               text: box ? box.textContent.replace(/\s+/g, ' ').trim() : '',
               hasButton: !!document.getElementById('cf-make') };
    });
    check('admin: the lead profile offers a client folder',
      before.present && before.hasButton && /Create client folder/.test(before.text), JSON.stringify(before.text.slice(0, 90)));

    const after = await page.evaluate(async () => {
      await cfSync();
      await new Promise(r => setTimeout(r, 250));
      const box = document.getElementById('cf-body');
      const link = box.querySelector('a[href*="drive.google.com"]');
      return { text: box.textContent.replace(/\s+/g, ' ').trim(),
               link: link ? link.getAttribute('href') : null,
               viewers: !!document.getElementById('cf-viewers') };
    });
    check('admin: creating it posts to this portal and reports what was filed',
      posted.length === 1 && /\/api\/dashboard\/customers\/5\/folder$/.test(posted[0]), JSON.stringify(posted));
    check('admin: the folder then shows its name, its count and a Drive link',
      /Ahmed Kamal — 0101234567/.test(after.text) && /4 document/.test(after.text)
      && after.link === 'https://drive.google.com/drive/folders/abc', JSON.stringify(after));
    check('admin: and the sharing list, which is the admin\'s alone', after.viewers === true);

    const shared = await page.evaluate(async () => {
      cfAddViewer(2);
      await new Promise(r => setTimeout(r, 250));
      const box = document.getElementById('cf-viewers');
      return { chips: [...box.querySelectorAll('[data-cf-viewer]')].map(c => c.textContent.trim()),
               text: document.getElementById('cf-body').textContent };
    });
    check('admin: naming somebody saves the list to the server',
      viewerPuts.length === 1 && viewerPuts[0].viewers.join() === '2', JSON.stringify(viewerPuts));
    check('admin: the named person appears as a chip',
      shared.chips.some(c => /Sara Ahmed/.test(c)), JSON.stringify(shared.chips));

    const dropped = await page.evaluate(async () => {
      cfDropViewer(2);
      await new Promise(r => setTimeout(r, 250));
      return document.getElementById('cf-body').textContent.replace(/\s+/g, ' ');
    });
    check('admin: removing them leaves the folder admins-only, and says so',
      viewerPuts.length === 2 && viewerPuts[1].viewers.length === 0
      && /Only admins can open this folder/.test(dropped), JSON.stringify(viewerPuts[1]));
    check('admin: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── A rep with the grant but not on the list ────────────────────────────────
  {
    folderState = { exists: true, name: 'Ahmed Kamal — 0101234567', documents: 4, viewers: [], link: '', canOpen: false };
    posted = [];
    const { page, errs } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { leads: true, leadsActions: { view: true, clientFolder: true } } });
    await page.evaluate(() => navigate('leads'));
    await sleep(500);
    const view = await page.evaluate(async () => {
      await openLeadProfile(5);
      await new Promise(r => setTimeout(r, 400));
      const box = document.getElementById('cf-body');
      return { text: box ? box.textContent.replace(/\s+/g, ' ').trim() : '',
               link: box ? !!box.querySelector('a[href*="drive.google.com"]') : false,
               canEditList: !!document.getElementById('cf-viewers') };
    });
    check('rep: sees the folder exists and how much is in it',
      /Ahmed Kamal/.test(view.text) && /4 document/.test(view.text), JSON.stringify(view.text.slice(0, 80)));
    check('rep: gets NO link when the admin has not shared it with them',
      view.link === false && /No access/.test(view.text), JSON.stringify(view));
    check('rep: is never offered the sharing list', view.canEditList === false);
    check('rep: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── A rep without the grant at all ──────────────────────────────────────────
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { leads: true, leadsActions: { view: true, clientFolder: false } } });
    await page.evaluate(() => navigate('leads'));
    await sleep(400);
    const none = await page.evaluate(async () => {
      await openLeadProfile(5);
      await new Promise(r => setTimeout(r, 350));
      return !!document.getElementById('cf-section');
    });
    check('without the grant the section is not rendered at all', none === false);
    await page.close();
  }

  await browser.close();
  srv.close();

  // ── The server's own rules ──────────────────────────────────────────────────
  {
    const SRC = fs.readFileSync('src/routes/client-folder.js', 'utf8');
    // Load the module's pure helpers without booting the app.
    const lift = name => {
      const i = SRC.indexOf('function ' + name + '(');
      if (i < 0) throw new Error('missing ' + name);
      let j = SRC.indexOf('{', i), d = 0;
      for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}' && !--d) return SRC.slice(i, j + 1); }
      throw new Error('unbalanced ' + name);
    };
    const M = new Function(`${lift('clientFolderName')}${lift('emptyFolder')}${lift('readFolder')}${lift('mayOpen')}${lift('folderView')}
      return { clientFolderName, readFolder, mayOpen, folderView };`)();

    check('the folder is named for the client and their phone',
      M.clientFolderName({ name: 'Ahmed Kamal', phone: '0101234567' }) === 'Ahmed Kamal — 0101234567');
    check('characters Drive cannot take are stripped from the name, spaces collapsed',
      M.clientFolderName({ name: 'A/B: "C" <D>', phone: '010/1' }) === 'A B C D — 0101',
      M.clientFolderName({ name: 'A/B: "C" <D>', phone: '010/1' }));
    check('a lead with no folder reads as an empty one, not a crash',
      M.readFolder({}).id === '' && M.readFolder({ client_folder: null }).docs && !M.readFolder({}).viewers.length);

    const folder = { id: 'x', link: 'L', name: 'n', docs: { 'quotation:1': {} }, viewers: [7] };
    check('the admin can always open a folder', M.mayOpen({}, folder) === true);
    check('a NAMED employee can open it', M.mayOpen({ employee: { id: 7 } }, folder) === true);
    check('an unnamed employee cannot, even holding the grant',
      M.mayOpen({ employee: { id: 8 } }, folder) === false);
    check('an empty list means admins only — not everybody',
      M.mayOpen({ employee: { id: 7 } }, { ...folder, viewers: [] }) === false);
    // The one that matters: the link must not reach somebody who may not open it.
    const denied = M.folderView({ employee: { id: 8 } }, folder);
    const allowed = M.folderView({ employee: { id: 7 } }, folder);
    check('a refused viewer is told the folder exists but is given NO link',
      denied.exists === true && denied.documents === 1 && denied.link === '' && denied.canOpen === false,
      JSON.stringify(denied));
    check('an allowed viewer gets the link', allowed.link === 'L' && allowed.canOpen === true);

    check('creating and syncing is one grant, checked on both portals',
      (SRC.match(/requirePerm\('leads', 'clientFolder'\)/g) || []).length === 2
      && /mountClientFolderRoutes\('\/api\/dashboard\/customers', requireAuth\)/.test(SRC)
      && /mountClientFolderRoutes\('\/api\/employee\/leads', requireEmployeeAuth\)/.test(SRC));
    check('the sharing list is admin-only — there is no employee mount for it',
      /router\.put\('\/api\/dashboard\/customers\/:id\/folder\/viewers', requireAuth/.test(SRC)
      && !/employee[\s\S]{0,80}folder\/viewers/.test(SRC));
    check('a document already filed is never uploaded twice',
      /if \(folder\.docs\[d\.key\]\) continue;/.test(SRC));
    check('one unrenderable document does not abandon the rest',
      /catch \(e\) \{[\s\S]{0,200}failed\.push/.test(SRC));
    check('the PDFs come from the same builders the /pdf routes use',
      /ctx\.buildQuotationHtml/.test(SRC) && /ctx\.buildRfqHtml/.test(SRC)
      && /ctx\.buildPurchaseOrderHtml/.test(SRC) && /ctx\.buildContractHtml/.test(SRC)
      && /ctx\.renderQuotationPdf/.test(SRC));
    check('Drive work reuses the supplier module\'s helpers, not a second copy',
      /ctx\.driveAdminToken/.test(SRC) && /ctx\.driveEnsureFolder/.test(SRC)
      && /ctx\.driveUploadFile/.test(SRC) && !/googleapis\.com/.test(SRC));
    check('a database without migration 013 says so instead of 500-ing',
      /013_client_folder\.sql/.test(SRC) && /isMissingColumn/.test(SRC));

    const EMP = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
    check('clientFolder is a real, grantable action with a label',
      /'clientFolder'\]/.test(EMP) && /'leads\.clientFolder': 'Client Drive folders'/.test(EMP));
    // The action is new, and every existing employee already holds leads access.
    // Inheriting it the way meet.view inherited its master would hand the whole
    // team every client's passport scans on the deploy that shipped it.
    check('nobody INHERITS access to client folders — it is granted, never assumed',
      /PERM_ACTION_NEVER_INHERIT = new Set\(\[[^\]]*'leads\.clientFolder'/.test(EMP)
      && /never \? false : \(fallback/.test(EMP) && /never \? false : \(legacy/.test(EMP));
    const MIG = fs.readFileSync('migrations/013_client_folder.sql', 'utf8');
    check('migration 013 adds the column it needs, idempotently',
      /customers ADD COLUMN IF NOT EXISTS client_folder JSONB/.test(MIG));
    const CF = fs.readFileSync('public/assets/client-folder.js', 'utf8');
    check('the section is one shared module, adapted per portal',
      /CFCFG/.test(CF)
      && /CFCFG = \{/.test(fs.readFileSync('public/assets/dashboard.js', 'utf8'))
      && /CFCFG = \{/.test(fs.readFileSync('public/assets/employee.js', 'utf8')));
  }

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
