// The new app's My Email whole: a real server (the real routes, grants, the OAuth round trip and the token table), the built app, a real
// browser. tests/emailroutes.js holds the server's side (who may ask what, what Google is asked and what is kept), apps/web's own tests hold
// the screens against a script, and tests/emparity.js holds the look to the classic portals'. This is the three working together, in both
// portals —
//
//   linking an account: the button, the trip to Google and back (Google is stood in for: its consent screen answers at once, the server
//     trades the code for tokens and asks who the person is of a stand-in too), and the screen the person comes back to
//   a consent that left out the right to send: the page says so, and links again
//   the inbox: a line for each message, the unread ones marked; a message opened, in the portal's own way; HTML drawn in a frame that runs nothing
//   writing: a new email and a reply from the administrator's sheet, a reply from the team's box — what Gmail was sent, and what it said back
//   letting go: the row emptied in the table, the screen asking again, and the answer still there after a reload
//   what each grant gets in the team's page: read, write, link — and a member whose link is older than the right to send
//   what Gmail refusing looks like, and a server with no Google project set up (a second process: the project is read when it starts)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath, pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();

const UNCONFIGURED = process.argv.includes('--unconfigured');
const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webemail-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

const GMAIL = 'https://www.googleapis.com/auth/gmail';
const PROFILE = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const SCOPE_ASKED = `${GMAIL}.readonly ${GMAIL}.send ${PROFILE}`;
const SCOPE_READ_ONLY = `${GMAIL}.readonly ${PROFILE}`;
const FAR = Date.now() + 86400000;
const link = (access, email, name, over = {}) => ({ access_token: access, refresh_token: access + '-refresh', expiry_date: FAR, email, name, scope: SCOPE_ASKED, ...over });

// Gmail, stood in for: the messages it holds
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const header = (name, value) => ({ name, value });
const HOSTILE_HTML = '<p>hello</p><img src="x" onerror="parent.__pwned=1"><script>parent.__pwned=1</script>';
const MESSAGES = {
  m1: { id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Hello, could you quote the Seal?', payload: { mimeType: 'text/html',
    headers: [header('From', 'Mona Buyer <mona@buyer.test>'), header('To', 'sales@motolinker.test'), header('Subject', 'Quote request'), header('Date', 'Tue, 20 Oct 2026 10:00:00 +0000'), header('Message-ID', '<m1@buyer.test>')],
    body: { data: b64('<p>Hello, <b>could</b> you quote the Seal? Tom &amp; Jerry say &quot;hi&quot;</p>') } } },
  m2: { id: 'm2', threadId: 't2', labelIds: ['INBOX'], snippet: 'Just text', payload: { mimeType: 'text/plain',
    headers: [header('From', 'noreply@service.test'), header('To', 'sales@motolinker.test'), header('Subject', 'Re: Service slot'), header('Date', 'Mon, 19 Oct 2026 09:00:00 +0000'), header('Message-ID', '<m2@service.test>')],
    body: { data: b64('Just text, with <b>markup</b> that is only words.') } } },
  m3: { id: 'm3', threadId: 't3', labelIds: ['INBOX'], snippet: 'Hostile', payload: { mimeType: 'text/html',
    headers: [header('From', '"><img src=x onerror=parent.__pwned=1> <evil@x.test>'), header('To', 'sales@motolinker.test'), header('Subject', '"><script>parent.__pwned=1</script>'), header('Date', 'Sun, 18 Oct 2026 08:00:00 +0000'), header('Message-ID', '<m3@evil.test>')],
    body: { data: b64(HOSTILE_HTML) } } },
};
const IDS = ['m1', 'm2', 'm3'];

const ids = { ana: 91, ben: 92, cy: 93, dan: 94, eve: 95, fay: 96 };

(async () => {
  const now = () => new Date().toISOString();
  // (the server reads the table once, as it starts: Ben, Cy and Dan have an account linked already; the others have none)
  const db = createFakeSupabase({
    ...seedTables(parseSchema()),
    google_tokens: [
      { user_key: `${ids.ben}_gmail`, tokens: link('ben-at', 'ben@motolinker.test', 'Ben B.'), updated_at: now() },
      { user_key: `${ids.cy}_gmail`, tokens: link('cy-at', 'cy@motolinker.test', 'Cy C.', { scope: SCOPE_READ_ONLY }), updated_at: now() },
      { user_key: `${ids.dan}_gmail`, tokens: link('dan-at', 'dan@motolinker.test', 'Dan D.'), updated_at: now() },
    ],
  }, { defaults: { google_tokens: () => ({ updated_at: now() }) } });
  db.install();

  // Google, stood in for (the server is in this process, so its calls to Google are answered here)
  const google = { token: [], list: [], full: [], send: [], scope: SCOPE_ASKED, reply: {} };
  const reset = () => { for (const k of ['token', 'list', 'full', 'send']) google[k].length = 0; google.scope = SCOPE_ASKED; google.reply = {}; };
  const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const auth = (init.headers || {}).Authorization;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const body = JSON.parse(init.body); google.token.push(body);
      return jsonReply({ access_token: 'granted-at', refresh_token: 'granted-rt', expires_in: 3600, scope: google.scope, token_type: 'Bearer' });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return jsonReply({ email: 'granted@motolinker.test', name: 'Granted G.' });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages')) {
      const u = new URL(url);
      if (u.pathname.endsWith('/messages/send') && init.method === 'POST') {
        const sent = { auth, body: JSON.parse(init.body) };
        sent.mime = Buffer.from(sent.body.raw, 'base64url').toString('utf8');
        google.send.push(sent);
        return google.reply.send ? google.reply.send() : jsonReply({ id: 'sent-1', threadId: sent.body.threadId || 'new-thread' });
      }
      const one = /\/messages\/([^/]+)$/.exec(u.pathname);
      if (!one) { google.list.push({ auth }); return jsonReply({ messages: IDS.map(id => ({ id })) }); }
      const m = MESSAGES[one[1]];
      if (u.searchParams.get('format') === 'metadata') {
        const wanted = u.searchParams.getAll('metadataHeaders');
        return jsonReply({ id: m.id, labelIds: m.labelIds, snippet: m.snippet, payload: { headers: m.payload.headers.filter(h => wanted.includes(h.name)) } });
      }
      google.full.push({ id: one[1], auth });
      if (google.reply.full) return google.reply.full(one[1]);
      return jsonReply(m);
    }
    return realFetch(input, init);
  };

  const base = await bootApp({ port: process.env.PORT || (UNCONFIGURED ? 4029 : 4028), env: { ML_WEB_DIST: dist, GOOGLE_CLIENT_ID: UNCONFIGURED ? '' : 'client-123', GOOGLE_CLIENT_SECRET: UNCONFIGURED ? '' : 'secret-456' } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const may = (view, send, connect) => ({ email: true, emailActions: { view, send, connect } });
  const perms = { ana: may(true, true, true), ben: may(true, true, false), cy: may(true, true, true), dan: may(true, false, false), eve: may(true, true, false), fay: may(false, false, true) };
  const member = (id, name, p) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: p, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), avatar_url: '', status_text: '', status_emoji: '' });
  T.employees = T.employees.filter(e => !Object.values(ids).includes(e.id)).concat(Object.entries(ids).map(([n, id]) => member(id, n[0].toUpperCase() + n.slice(1), perms[n])));
  const sessionOf = (id, p) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(p), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'we-admin', key: 'ml_admin_token', route: '/dashboard' };
  const team = (token, n) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id: ids[n], p: perms[n] });
  const ANA = team('we-ana', 'ana'), BEN = team('we-ben', 'ben'), CY = team('we-cy', 'cy'), DAN = team('we-dan', 'dan'), EVE = team('we-eve', 'eve'), FAY = team('we-fay', 'fay');
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [ANA, BEN, CY, DAN, EVE, FAY]) ctx.employeeSessions.set(m.token, sessionOf(m.id, m.p));

  const rowOf = key => T.google_tokens.find(x => x.user_key === key);
  const linked = key => { const r = rowOf(key); return !!(r && r.tokens && r.tokens.access_token); };
  const tokensOf = key => { const r = rowOf(key); return r ? r.tokens : undefined; };

  // ── the browser ──────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen = 'email') => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const asked = [];
    const consent = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    page.on('request', r => { if (/\/api\//.test(r.url())) asked.push(r.method() + ' ' + new URL(r.url()).pathname); });
    // Google's consent screen is answered at once, as a person who says yes would: back to the way the server gave, with a code and the state it handed out
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith('https://accounts.google.com/')) {
        const q = new URL(u).searchParams;
        consent.push({ url: u, scope: q.get('scope'), redirect: q.get('redirect_uri'), state: q.get('state') });
        return r.respond({ status: 302, headers: { location: `${q.get('redirect_uri')}?code=the-code&state=${q.get('state')}` } });
      }
      if (!u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); } catch (_) {} }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, asked, consent, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const part = name => `[data-part=${name}]`;
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(el => el.textContent.trim().replace(/\s+/g, ' ')), sel);
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const has = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const attr = (page, sel, a) => page.evaluate((s, a) => { const el = document.querySelector(s); return el ? el.getAttribute(a) : null; }, sel, a);
  const row = n => `${part('inboxRow')}:nth-child(${n})`;
  const settled = page => until(page, () => { const g = document.querySelector('[data-part=emailPage]'); return !!g && !g.querySelector('[data-part=loading]') && g.children.length > 0; }, null);
  const inboxed = async page => { await settled(page); return until(page, () => document.querySelectorAll('[data-part=inboxRow]').length > 0 && !document.querySelector('[data-part=inboxLoading]'), null); };
  const toasted = (page, words) => until(page, w => document.body.innerText.includes(w), words);
  const fill = async (page, sel, value) => { await page.click(sel, { clickCount: 3 }); await page.type(sel, value); };

  if (UNCONFIGURED) {
    // a server with no Google project: the screens say so, in each portal's words, and offer nothing
    const a = await open(ADMIN);
    await settled(a);
    check('with no Google project, the administrator\'s page says what to add and where, and offers no button',
      (await text(a, part('connectTitle'))) === 'Connect Gmail' && /GOOGLE_CLIENT_ID=/.test(await text(a, part('env')) || '') && /GOOGLE_CLIENT_SECRET=/.test(await text(a, part('env')) || '') && !(await has(a, part('connectBtn'))));
    await a.shut();
    const t = await open(ANA);
    await settled(t);
    check('…and the team\'s page says to ask the administrator', (await text(t, part('connectSub'))) === 'Google OAuth is not set up. Contact your admin.' && !(await has(t, part('connectBtn'))));
    await t.shut();
    await browser.close();
    fs.rmSync(dist, { recursive: true, force: true });
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }

  // ═══ 1. the administrator links an account, and reads and writes with it ═════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await settled(page);
    check('with no account linked, the page offers to link one under its own name', (await text(page, part('connectTitle'))) === 'Connect Your Gmail' && (await text(page, part('connectBtn'))) === 'Connect Gmail' && !(await has(page, part('inboxRow'))));
    // (Google, asked to grant what was asked for, grants less: the person left out the right to send)
    google.scope = SCOPE_READ_ONLY;
    await press(page, part('connectBtn'));
    check('the button goes to Google and comes back to the Email screen, linked as the account Google named',
      await until(page, () => !!document.querySelector('[data-part=accountName]'), null) && (await text(page, part('accountName'))) === 'Granted G.' && (await text(page, part('accountEmail'))) === 'granted@motolinker.test',
      `${page.url()} ${await text(page, part('emailPage'))}`);
    check('…Google was asked for reading and sending, with a state the server handed out, and the way back is the one callback it knows',
      page.consent.length === 1 && page.consent[0].scope === SCOPE_ASKED && page.consent[0].redirect === `${base}/api/email/callback` && /^[0-9a-f]{32}$/.test(page.consent[0].state || ''), JSON.stringify(page.consent));
    check('…the server traded the code with the project\'s id and secret, and kept the link in the table where a restart finds it',
      google.token.length === 1 && google.token[0].code === 'the-code' && google.token[0].client_id === 'client-123' && linked('admin_gmail') && tokensOf('admin_gmail').email === 'granted@motolinker.test', JSON.stringify(google.token));
    check('…and the address is the screen\'s own, not the callback\'s', /\/dashboard\/email$/.test(page.url()), page.url());
    // the link that was granted without the right to send
    await inboxed(page);
    check('a link that was granted without the right to send says so, and offers to make it again',
      /Compose and Reply will fail/.test(await text(page, part('reconnectNotice')) || '') && (await text(page, part('reconnect'))) === 'Reconnect');
    google.scope = SCOPE_ASKED;
    await press(page, part('reconnect'));
    check('…which goes to Google again, and comes back with a link that can send, and no notice',
      await until(page, () => !!document.querySelector('[data-part=accountName]') && !document.querySelector('[data-part=reconnectNotice]') && document.querySelectorAll('[data-part=inboxRow]').length > 0, null) && page.consent.length === 2 && page.consent[1].scope === SCOPE_ASKED && tokensOf('admin_gmail').scope === SCOPE_ASKED, JSON.stringify(tokensOf('admin_gmail')));

    // the inbox
    await inboxed(page);
    check('the inbox is a line for each message, as Gmail listed them, the unread one marked',
      (await count(page, part('inboxRow'))) === 3 && (await texts(page, part('rowFrom'))).join('|') === 'Mona Buyer|noreply@service.test|">'
      && (await texts(page, part('rowSubject'))).join('|') === 'Quote request|Re: Service slot|"><script>parent.__pwned=1</script>'
      && (await count(page, part('unreadDot'))) === 1 && (await has(page, `${row(1)} ${part('unreadDot')}`)), await text(page, part('inboxList')));
    check('…asked of Gmail as the account the person linked', google.list.length >= 1 && google.list.every(l => l.auth === 'Bearer granted-at'), JSON.stringify(google.list));
    check('the placeholder stands beside it until a message is chosen', (await text(page, part('placeholderText'))) === 'Select an email to read it');

    // a message of HTML
    await press(page, row(1));
    check('a message opens beside the inbox: subject, who from, to whom',
      await until(page, () => !!document.querySelector('[data-part=message]') && !document.querySelector('[data-part=detailLoading]'), null) && (await text(page, part('messageSubject'))) === 'Quote request'
      && (await text(page, part('messageFrom'))) === 'From: Mona Buyer <mona@buyer.test>' && (await text(page, part('messageTo'))) === 'To: sales@motolinker.test');
    check('…its HTML is drawn in a frame that runs nothing, handed over exactly as Gmail gave it',
      (await attr(page, part('bodyFrame'), 'sandbox')) === 'allow-same-origin' && (await attr(page, part('bodyFrame'), 'srcdoc')) === '<p>Hello, <b>could</b> you quote the Seal? Tom &amp; Jerry say &quot;hi&quot;</p>');
    check('…the frame is made as tall as what is in it', await until(page, () => { const f = document.querySelector('[data-part=bodyFrame]'); return !!f && parseInt(f.style.height) > 40; }, null));
    // a message of text
    await press(page, row(2));
    check('a message of text is drawn as text: markup in it is words',
      await until(page, () => !!document.querySelector('[data-part=bodyText]'), null) && (await text(page, part('bodyText'))) === 'Just text, with <b>markup</b> that is only words.' && !(await has(page, `${part('bodyText')} b`)));
    // a hostile one: nothing in it, in the head or the body, runs
    await press(page, row(3));
    await until(page, () => !!document.querySelector('[data-part=bodyFrame]') && !document.querySelector('[data-part=detailLoading]'), null);
    await sleep(400);
    check('a message whose sender, subject and body are all markup shows them as words and runs none of it',
      (await page.evaluate(() => window.__pwned)) === undefined && (await text(page, part('messageSubject'))) === '"><script>parent.__pwned=1</script>' && (await text(page, part('messageFrom'))).startsWith('From: "><img src=x onerror=parent.__pwned=1>')
      && !(await has(page, `${part('message')} script, ${part('messageHead')} img`)));

    // answering
    await press(page, row(1));
    await until(page, () => { const s = document.querySelector('[data-part=messageSubject]'); return !!s && s.textContent === 'Quote request'; }, null);
    await press(page, part('reply'));
    check('Reply opens the sheet for the sender\'s address, under the subject with Re: in front of it',
      await until(page, () => !!document.querySelector('[data-part=dialog]'), null) && (await page.evaluate(() => [document.querySelector('[data-part=to]').value, document.querySelector('[data-part=subject]').value])).join('|') === 'mona@buyer.test|Re: Quote request');
    await page.type(part('composeBody'), 'Yes, by Friday.');
    google.reply.send = () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, 403);
    await press(page, `${part('dialog')} ${part('send')}`);
    check('when Gmail would not send it, the sheet stays with what was written, and the words are Gmail\'s own',
      await toasted(page, 'Failed to send: ') && /Request had insufficient authentication scopes\./.test(await page.evaluate(() => document.body.innerText)) && (await has(page, part('dialog'))) && (await page.evaluate(() => document.querySelector('[data-part=composeBody]').value)) === 'Yes, by Friday.');
    delete google.reply.send;
    google.send.length = 0;
    await press(page, `${part('dialog')} ${part('send')}`);
    check('sent, the sheet goes away with a message that it went', await toasted(page, 'Email sent successfully!') && !(await has(page, part('dialog'))));
    const sent = google.send[0];
    check('…Gmail was given a reply: to the sender, in the conversation, naming the message it answers, as the account the person linked',
      google.send.length === 1 && sent.auth === 'Bearer granted-at' && sent.body.threadId === 't1'
      && sent.mime === 'To: mona@buyer.test\r\nSubject: Re: Quote request\r\nContent-Type: text/plain; charset=utf-8\r\nIn-Reply-To: <m1@buyer.test>\r\nReferences: <m1@buyer.test>\r\n\r\nYes, by Friday.', JSON.stringify(sent));
    // a new email
    google.send.length = 0;
    await press(page, part('compose'));
    await until(page, () => !!document.querySelector('[data-part=dialog]'), null);
    check('Compose opens a sheet for a new email with nothing in it', (await page.evaluate(() => [document.querySelector('[data-part=to]').value, document.querySelector('[data-part=subject]').value, document.querySelector('[data-part=composeBody]').value].join('|'))) === '||');
    await press(page, `${part('dialog')} ${part('send')}`);
    check('…which wants all three, and says so, and sends nothing', await toasted(page, 'To, subject and message are required') && google.send.length === 0);
    await page.type(part('to'), 'cy@buyer.test');
    await page.type(part('subject'), 'Price list');
    await page.type(part('composeBody'), 'Attached below.');
    await press(page, `${part('dialog')} ${part('send')}`);
    await until(page, () => !document.querySelector('[data-part=dialog]'), null);
    check('…and then sends the email, in no conversation', google.send.length === 1 && !google.send[0].body.threadId && google.send[0].mime.startsWith('To: cy@buyer.test\r\nSubject: Price list\r\n') && google.send[0].mime.endsWith('\r\n\r\nAttached below.'), JSON.stringify(google.send));

    // Refresh starts the page over
    await press(page, part('refresh'));
    check('Refresh asks it all again: the page is the inbox again with no message open',
      await inboxed(page) && !(await has(page, part('message'))) && (await has(page, part('placeholder'))));

    // letting go
    await press(page, part('disconnect'));
    check('Disconnect empties the link in the table and the page asks again, and offers to link one',
      await until(page, () => !!document.querySelector('[data-part=connectBtn]'), null) && !linked('admin_gmail') && tokensOf('admin_gmail') === null, JSON.stringify(tokensOf('admin_gmail')));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await settled(page);
    check('…after a reload as well', !!(await has(page, part('connectBtn'))) && !(await has(page, part('account'))));
    check('none of it needed the app to ask for what it had no right to (no 401), or to go to the classic portal\'s routes',
      page.failures.length === 0 && !page.asked.some(p => p.startsWith('GET /api/dashboard/email')), page.failures.join());
    await page.shut();
  }

  // ═══ 2. a team member links an account, and answers a message ═══════════════════════════════
  reset();
  {
    const page = await open(ANA);
    await settled(page);
    check('the team\'s page says the same in its own words, and offers to link an account', (await text(page, part('connectSub'))) === 'Connect your Google account to access your personal inbox.' && (await text(page, part('connectBtn'))) === 'Connect Gmail');
    await press(page, part('connectBtn'));
    check('the button asks the session is good, goes to Google and comes back to the team portal\'s Email, linked',
      await until(page, () => !!document.querySelector('[data-part=accountName]'), null) && (await text(page, part('accountName'))) === 'Granted G.' && page.asked.includes('GET /api/employee/check'), `${page.url()} ${page.asked.join()}`);
    check('…the link is the member\'s own row in the table (their id), the scope asked for includes sending, and the administrator\'s is untouched',
      linked(`${ANA.id}_gmail`) && !linked('admin_gmail') && page.consent[0].scope === SCOPE_ASKED && /\/employee\/email$/.test(page.url()), JSON.stringify(T.google_tokens.map(r => r.user_key)) + page.url());
    await inboxed(page);
    check('the inbox came through the team\'s own routes', (await count(page, part('inboxRow'))) === 3 && page.asked.includes('GET /api/employee/email/messages') && !page.asked.some(p => /^GET \/api\/email\/(status|messages)/.test(p)), page.asked.join());
    check('…a card, a line for each message, the unread one marked', (await has(page, `${row(1)} ${part('unreadDot')}`)) && (await count(page, part('unreadDot'))) === 1 && !(await has(page, part('message'))));

    await press(page, row(1));
    check('a message opens under the inbox, with a box to answer it in',
      await until(page, () => !!document.querySelector('[data-part=replyBox]'), null) && (await text(page, part('messageSubject'))) === 'Quote request' && (await text(page, part('messageFrom'))) === 'From: Mona Buyer <mona@buyer.test>' && (await attr(page, row(1), 'aria-current')) === 'true');
    await page.type(part('replyBox'), 'Yes, by Friday.');
    google.send.length = 0;
    await press(page, part('send'));
    check('Send Reply sends it to whoever wrote the message, in its conversation, and says it went, clearing the box',
      await until(page, () => /Sent!/.test((document.querySelector('[data-part=send]') || {}).textContent || ''), null) && (await page.evaluate(() => document.querySelector('[data-part=replyBox]').value)) === ''
      && google.send.length === 1 && google.send[0].auth === 'Bearer granted-at' && google.send[0].body.threadId === 't1'
      && google.send[0].mime === 'To: Mona Buyer <mona@buyer.test>\r\nSubject: Re: Quote request\r\nContent-Type: text/plain; charset=utf-8\r\nIn-Reply-To: <m1@buyer.test>\r\nReferences: <m1@buyer.test>\r\n\r\nYes, by Friday.', JSON.stringify(google.send));
    // a reply to a message that is already a reply keeps one Re:
    await press(page, row(2));
    await until(page, () => (document.querySelector('[data-part=messageSubject]') || {}).textContent === 'Re: Service slot' && !!document.querySelector('[data-part=replyBox]'), null);
    check('…and the reply to one that is already a reply does not stack another Re:', await (async () => {
      google.send.length = 0;
      await page.type(part('replyBox'), 'Ten is fine.');
      await press(page, part('send'));
      await until(page, () => /Sent!/.test((document.querySelector('[data-part=send]') || {}).textContent || ''), null);
      return google.send.length === 1 && /^To: noreply@service.test\r\nSubject: Re: Service slot\r\n/.test(google.send[0].mime);
    })(), JSON.stringify(google.send));
    await press(page, part('back'));
    check('Back takes the message away', !(await has(page, part('message'))));
    await press(page, part('disconnect'));
    check('Disconnect lets go of the member\'s account, and the screen offers to link one',
      await until(page, () => !!document.querySelector('[data-part=connectBtn]'), null) && !linked(`${ANA.id}_gmail`) && tokensOf(`${ANA.id}_gmail`) === null);
    check('none of it asked for what the team has no right to (no 401)', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 3. what each grant gets ═══════════════════════════════════════════════════════════════
  reset();
  {
    // Ben: may read and send and may not link an account (his is linked already)
    const ben = await open(BEN);
    await inboxed(ben);
    check('a member who may read and send and not link an account sees the account and the inbox, and no way to let go of it',
      (await text(ben, part('accountName'))) === 'Ben B.' && (await count(ben, part('inboxRow'))) === 3 && !(await has(ben, part('disconnect'))), await text(ben, part('emailPage')));
    check('…the inbox was asked of Gmail as his account, not another\'s', google.list.length >= 1 && google.list.every(l => l.auth === 'Bearer ben-at'), JSON.stringify(google.list));
    await press(ben, row(2));
    await until(ben, () => !!document.querySelector('[data-part=replyBox]'), null);
    check('…and has the box to answer in', !!(await has(ben, part('replyBox'))));
    await ben.shut();
    // Dan: may read and may not send (his account is linked)
    const dan = await open(DAN);
    await inboxed(dan);
    await press(dan, row(1));
    await until(dan, () => !!document.querySelector('[data-part=bodyFrame], [data-part=bodyText]') && !document.querySelector('[data-part=detailLoading]'), null);
    check('a member who may read and not send reads the message and is offered no way to answer it', (await text(dan, part('messageSubject'))) === 'Quote request' && !(await has(dan, part('replyBox'))) && !(await has(dan, part('send'))));
    const sentByDan = await dan.evaluate(async t => (await fetch('/api/employee/email/send', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'a@b.test', subject: 's', body: 'b' }) })).status, DAN.token);
    check('…and the server would have refused him had he asked', sentByDan === 403);
    await dan.shut();
    // Eve: may read and send, may not link, and has no account linked
    const eve = await open(EVE);
    await settled(eve);
    check('…and with no account linked is told to ask, and shown no button',
      (await text(eve, part('connectSub'))) === 'No Google account is linked. Ask your admin to link one for you.' && !(await has(eve, part('connectBtn'))), await text(eve, part('emailPage')));
    await eve.shut();
    // Fay: has the screen with only the right to link, and the status is not hers to see
    const fay = await open(FAY);
    await settled(fay);
    check('a member who has the screen without the right to see the mail is told it is not switched on, and is not told it is not set up',
      (await text(fay, part('connectSub'))) === 'Gmail is not switched on for you. Ask your admin.' && !(await has(fay, part('connectBtn'))) && !(await has(fay, part('error'))), await text(fay, part('emailPage')));
    await fay.shut();
    // Cy: all grants, and a link older than the right to send
    const cy = await open(CY);
    await inboxed(cy);
    check('a member whose link was made before sending was asked for is told so, and told to link again',
      /replies will fail/.test(await text(cy, part('reconnectNotice')) || '') && (await text(cy, part('reconnect'))) === 'Reconnect', await text(cy, part('emailPage')));
    await press(cy, part('reconnect'));
    check('…which goes to Google, asking for the right to send, and comes back with a link that has it',
      await until(cy, () => !!document.querySelector('[data-part=accountName]') && !document.querySelector('[data-part=reconnectNotice]') && document.querySelectorAll('[data-part=inboxRow]').length > 0, null) && cy.consent.length === 1 && cy.consent[0].scope === SCOPE_ASKED && tokensOf(`${CY.id}_gmail`).scope === SCOPE_ASKED && (await text(cy, part('accountName'))) === 'Granted G.', JSON.stringify(cy.consent) + (await text(cy, part('emailPage'))));
    await cy.shut();
  }

  // ═══ 4. Gmail says no ══════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(BEN);
    await inboxed(page);
    google.reply.full = () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, 403);
    await press(page, row(1));
    check('when Gmail would not give a message (the server answers it as a message with nothing in it), the page says so in place of a blank card, and the inbox is still there',
      await until(page, () => !!document.querySelector('[data-part=detailError]'), null) && /did not give this message/.test(await text(page, part('detailError')) || '') && (await count(page, part('inboxRow'))) === 3 && !(await has(page, part('replyBox'))), await text(page, part('emailPage')));
    await page.shut();
  }

  await browser.close();
  // the project is read when the server starts: a second process has none
  const un = spawnSync(process.execPath, [__filename, '--unconfigured'], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
  console.log(un.stdout.trim());
  if (un.status !== 0) console.log(un.stderr.slice(-800));
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) && un.status === 0 ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
