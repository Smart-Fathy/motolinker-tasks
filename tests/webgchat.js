// The new app's Google Chat whole: a real server (the real routes, grants, the OAuth round trip and the token table), the built app, a real
// browser. tests/gchatroutes.js holds the server's side (who may ask what, what Google is asked and what is kept), apps/web's own tests hold
// the screens against a script, and tests/gcparity.js holds the look to the classic portals'. This is the three working together, in both
// portals —
//
//   linking an account: the button, the trip to Google and back (Google is stood in for: its consent screen answers at once, the server
//     trades the code for tokens and asks who the person is of a stand-in too), and the screen the person comes back to
//   being sent back with a reason (Google would not trade the code): the address says why, the screen says it once, and Try again goes on
//   the spaces and a space opened: its messages, the person's own and another's; writing a message and what Chat was sent
//   what a link reaches: no sending (the line, and the way to link again), no reading (the card, and the way to grant it), a member
//     who may read and may not send
//   what Chat refusing looks like (the organization does not allow it; the link has gone) and a link found to be lost
//   a phone: one pane at a time, and the way back
//   a server with Chat not set up (a second process: it is read when the server starts)
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

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webgchat-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

const CHAT = 'https://www.googleapis.com/auth/chat';
const PROFILE = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const SCOPE_ASKED = `${CHAT}.spaces.readonly ${CHAT}.messages.create ${CHAT}.messages.readonly ${PROFILE}`;
const SCOPE_READ_ONLY = `${CHAT}.spaces.readonly ${CHAT}.messages.readonly ${PROFILE}`;
const SCOPE_SEND_ONLY = `${CHAT}.spaces.readonly ${CHAT}.messages.create ${PROFILE}`;
const FAR = Date.now() + 86400000;
const link = (access, email, name, over = {}) => ({ access_token: access, refresh_token: access + '-refresh', expiry_date: FAR, email, name, scope: SCOPE_ASKED, ...over });

// Google Chat, stood in for: the spaces it holds, and the messages of a space (newest first, as Chat gives them)
const SPACES = [
  { name: 'spaces/AAA1', displayName: 'Sales team', spaceType: 'SPACE' },
  { name: 'spaces/BBB2', spaceType: 'DIRECT_MESSAGE' },
];
const at = m => new Date(2026, 9, 20, 9, m).toISOString();
const MESSAGES = {
  'spaces/AAA1': [
    { name: 'spaces/AAA1/messages/m3', text: '<b>Not bold</b> & on two\nlines', sender: { displayName: 'Bo B.', name: 'users/22' }, createTime: at(47) },
    { name: 'spaces/AAA1/messages/m2', text: 'Thanks, Ana', sender: { displayName: 'Granted G.', name: 'users/11' }, createTime: at(31) },
    { name: 'spaces/AAA1/messages/m1', text: 'Quote sent', sender: { displayName: 'Ben B.', name: 'users/33' }, createTime: at(5) },
  ],
  'spaces/BBB2': [],
};

const PRISTINE = JSON.stringify(MESSAGES);
const ids = { ben: 92, cy: 93, dan: 94, eve: 95, fay: 96, gus: 97, hal: 98, ivy: 99 };

(async () => {
  const now = () => new Date().toISOString();
  // (the server reads the table once, as it starts: Ben, Cy, Dan, Eve and Hal have an account linked already; the others have none)
  const db = createFakeSupabase({
    ...seedTables(parseSchema()),
    google_tokens: [
      { user_key: `${ids.ben}_gchat`, tokens: link('ben-at', 'ben@motolinker.test', 'Ben B.'), updated_at: now() },
      { user_key: `${ids.cy}_gchat`, tokens: link('cy-at', 'cy@motolinker.test', 'Cy C.', { scope: SCOPE_READ_ONLY }), updated_at: now() },
      { user_key: `${ids.dan}_gchat`, tokens: link('dan-at', 'dan@motolinker.test', 'Dan D.', { scope: SCOPE_SEND_ONLY }), updated_at: now() },
      { user_key: `${ids.eve}_gchat`, tokens: link('eve-at', 'eve@motolinker.test', 'Eve E.'), updated_at: now() },
      { user_key: `${ids.hal}_gchat`, tokens: link('hal-at', 'hal@motolinker.test', 'Hal H.', { expiry_date: Date.now() - 3600000 }), updated_at: now() },
    ],
  }, { defaults: { google_tokens: () => ({ updated_at: now() }) } });
  db.install();

  // Google, stood in for (the server is in this process, so its calls to Google are answered here)
  const google = { token: [], spaces: [], messages: [], post: [], scope: SCOPE_ASKED, reply: {} };
  const reset = () => {
    for (const k of ['token', 'spaces', 'messages', 'post']) google[k].length = 0;
    google.scope = SCOPE_ASKED; google.reply = {};
    for (const [space, list] of Object.entries(JSON.parse(PRISTINE))) MESSAGES[space] = list;
  };
  const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const auth = (init.headers || {}).Authorization;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const body = JSON.parse(init.body); google.token.push(body);
      if (google.reply.token) return google.reply.token(body);
      return jsonReply(body.grant_type === 'refresh_token'
        ? { access_token: 'refreshed-at', expires_in: 3600 }
        : { access_token: 'granted-at', refresh_token: 'granted-rt', expires_in: 3600, scope: google.scope, token_type: 'Bearer' });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return jsonReply({ email: 'granted@motolinker.test', name: 'Granted G.' });
    if (url.startsWith('https://chat.googleapis.com/v1/')) {
      const u = new URL(url);
      const p = u.pathname.replace(/^\/v1\//, '');
      if (p === 'spaces') { google.spaces.push({ auth }); return google.reply.spaces ? google.reply.spaces(auth) : jsonReply({ spaces: SPACES }); }
      const m = /^(spaces\/[^/]+)\/messages$/.exec(p);
      if (m && init.method === 'POST') {
        const posted = { auth, space: m[1], body: JSON.parse(init.body) };
        google.post.push(posted);
        if (google.reply.post) return google.reply.post(posted);
        // (a message that Chat took is among the messages from then on)
        (MESSAGES[m[1]] = MESSAGES[m[1]] || []).unshift({ name: m[1] + '/messages/new' + google.post.length, text: posted.body.text, sender: { displayName: google.sender || 'Granted G.', name: 'users/11' }, createTime: new Date().toISOString() });
        return jsonReply({ name: m[1] + '/messages/new' + google.post.length });
      }
      if (m) { google.messages.push({ auth, space: m[1] }); return google.reply.messages ? google.reply.messages(m[1]) : jsonReply({ messages: MESSAGES[m[1]] || [] }); }
    }
    return realFetch(input, init);
  };

  const base = await bootApp({ port: process.env.PORT || (UNCONFIGURED ? 4037 : 4036), env: {
    ML_WEB_DIST: dist, GOOGLE_CLIENT_ID: UNCONFIGURED ? '' : 'client-123', GOOGLE_CLIENT_SECRET: UNCONFIGURED ? '' : 'secret-456',
    GOOGLE_CHAT_ENABLED: UNCONFIGURED ? '' : '1', GOOGLE_CHAT_CLIENT_ID: UNCONFIGURED ? '' : 'chat-client-789', GOOGLE_CHAT_CLIENT_SECRET: UNCONFIGURED ? '' : 'chat-secret-000',
  } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const may = (view, send) => ({ gchat: true, gchatActions: { view, send } });
  const perms = { ben: may(true, true), cy: may(true, true), dan: may(true, true), eve: may(true, false), fay: { gchat: false }, gus: may(true, true), hal: may(true, true), ivy: may(true, true) };
  const member = (id, name, p) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: p, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), avatar_url: '', status_text: '', status_emoji: '' });
  T.employees = T.employees.filter(e => !Object.values(ids).includes(e.id)).concat(Object.entries(ids).map(([n, id]) => member(id, n[0].toUpperCase() + n.slice(1), perms[n])));
  const sessionOf = (id, p) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(p), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'wg-admin', key: 'ml_admin_token', route: '/dashboard' };
  const team = (token, n) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id: ids[n], p: perms[n] });
  const BEN = team('wg-ben', 'ben'), CY = team('wg-cy', 'cy'), DAN = team('wg-dan', 'dan'), EVE = team('wg-eve', 'eve'), FAY = team('wg-fay', 'fay'), GUS = team('wg-gus', 'gus'), HAL = team('wg-hal', 'hal'), IVY = team('wg-ivy', 'ivy');
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [BEN, CY, DAN, EVE, FAY, GUS, HAL, IVY]) ctx.employeeSessions.set(m.token, sessionOf(m.id, m.p));

  const rowOf = key => T.google_tokens.find(x => x.user_key === key);
  const linked = key => { const r = rowOf(key); return !!(r && r.tokens && r.tokens.access_token); };
  const tokensOf = key => { const r = rowOf(key); return r ? r.tokens : undefined; };

  // ── the browser ──────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen = 'gchat', { width = 1100 } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const consent = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    // Google's consent screen is answered at once, as a person who says yes would: back to the way the server gave, with a code and the state it handed out
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith('https://accounts.google.com/')) {
        const q = new URL(u).searchParams;
        consent.push({ url: u, client: q.get('client_id'), scope: q.get('scope'), redirect: q.get('redirect_uri'), state: q.get('state') });
        return r.respond({ status: 302, headers: { location: `${q.get('redirect_uri')}?code=the-code&state=${q.get('state')}` } });
      }
      if (!u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); } catch (_) {} }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, consent, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const part = name => `[data-part=${name}]`;
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(el => el.textContent.trim().replace(/\s+/g, ' ')), sel);
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const has = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const attr = (page, sel, a) => page.evaluate((s, a) => { const el = document.querySelector(s); return el ? el.getAttribute(a) : null; }, sel, a);
  const row = n => `${part('spaceRow')}:nth-child(${n})`;
  const settled = page => until(page, () => { const g = document.querySelector('[data-part=gchatPage]'); return !!g && !g.querySelector('[data-part=listLoading]'); }, null);
  const spaced = async page => { await settled(page); return until(page, () => document.querySelectorAll('[data-part=spaceRow]').length > 0, null); };
  const messaged = page => until(page, () => document.querySelectorAll('[data-part=msg]').length > 0 && !document.querySelector('[data-part=messagesLoading]'), null);
  // (a trip to Google leaves the page and comes back to a new document: the old one is marked, and the new one is the one without the mark)
  const marked = page => page.evaluate(() => { window.__old = true; });
  const returned = page => until(page, () => !window.__old && !!document.querySelector('[data-part=gchatPage]') && !document.querySelector('[data-part=listLoading]'), null);
  const toasted = (page, words) => until(page, w => document.body.innerText.includes(w), words);

  if (UNCONFIGURED) {
    // a server with Chat not set up: the rail has no Google Chat, and the address of the screen goes Home
    const a = await open(ADMIN, 'home');
    check('with Chat not set up, the administrator\'s rail does not offer it', !(await has(a, '[data-screen=gchat]')));
    await a.goto(base + '/dashboard/gchat', { waitUntil: 'domcontentloaded' });
    await a.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await sleep(300);
    check('…and its address goes to Home, not to a page with nothing on it', !(await has(a, part('gchatPage'))) && /\/dashboard\/home$/.test(a.url()), a.url());
    await a.shut();
    const t = await open(BEN, 'home');
    check('…the team\'s rail does not offer it either', !(await has(t, '[data-screen=gchat]')));
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
    check('with no account linked, the page offers to link one under its own name',
      (await text(page, part('stateTitle'))) === 'Connect Google Chat' && (await text(page, part('stateBtn'))) === 'Connect Google Chat' && !(await has(page, part('spaceRow'))) && (await text(page, part('chatRoomsTitle'))) === 'Google Chat');
    await press(page, part('stateBtn'));
    check('the button goes to Google and comes back to the Google Chat screen, with the spaces of the account Google named',
      await spaced(page) && (await texts(page, part('spaceName'))).join('|') === 'Sales team|Direct message', `${page.url()} ${await text(page, part('gchatPage'))}`);
    check('…Google was asked as Chat\'s own client, for the spaces, sending and reading, with a state the server handed out, and the way back is the one callback it knows',
      page.consent.length === 1 && page.consent[0].client === 'chat-client-789' && page.consent[0].scope === SCOPE_ASKED && page.consent[0].redirect === `${base}/api/email/callback` && /^[0-9a-f]{32}$/.test(page.consent[0].state || ''), JSON.stringify(page.consent));
    check('…the server traded the code with Chat\'s client, and kept the link in the table where a restart finds it, with what Google granted',
      google.token.length === 1 && google.token[0].code === 'the-code' && google.token[0].client_id === 'chat-client-789' && linked('admin_gchat') && tokensOf('admin_gchat').email === 'granted@motolinker.test' && tokensOf('admin_gchat').scope === SCOPE_ASKED, JSON.stringify(google.token));
    check('…and the address is the screen\'s own, not the callback\'s', /\/dashboard\/gchat$/.test(page.url()), page.url());
    check('…the spaces were asked of Chat as the account the person linked, and nobody was refused', google.spaces.length >= 1 && google.spaces.every(s => s.auth === 'Bearer granted-at') && page.failures.length === 0, JSON.stringify(google.spaces));
    check('the placeholder stands beside the spaces until one is chosen; a group has the square-cornered circle', (await text(page, part('placeholder'))) === 'Select a space' && (await texts(page, part('spaceAvatar'))).join('|') === 'ST|DM');

    // a space opened
    await press(page, row(1));
    check('a space opens beside the list: its name, its messages oldest first, the person\'s own on the other side, and the box to write in',
      await messaged(page) && (await text(page, part('chatName'))) === 'Sales team' && (await texts(page, part('msgBubble'))).join('|') === 'Quote sent|Thanks, Ana|<b>Not bold</b> & on two lines'
      && (await attr(page, row(1), 'aria-current')) === 'true' && (await has(page, part('chatInput'))), await text(page, part('chatMessages')));
    check('…a message is shown as words, with the lines it was written in, and the writer of the others\' is named',
      !(await has(page, `${part('chatMessages')} b`)) && (await page.evaluate(() => getComputedStyle(document.querySelectorAll('[data-part=msgBubble]')[2]).whiteSpace)) === 'pre-wrap'
      && (await texts(page, part('msgSender'))).join('|') === 'Ben B.|Bo B.', await texts(page, part('msgSender')));
    check('…asked of Chat as the account the person linked', google.messages.length >= 1 && google.messages.every(m => m.auth === 'Bearer granted-at' && m.space === 'spaces/AAA1'), JSON.stringify(google.messages));
    check('the one that is the person\'s own is marked by the name Google gave their link', (await page.evaluate(() => [...document.querySelectorAll('[data-part=msg]')].map(m => m.className.includes('mine')))).join() === 'false,true,false');

    // writing
    google.reply.post = () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, 403);
    await page.type(part('chatInput'), 'Will this go?');
    await page.keyboard.press('Enter');
    check('when Chat would not take a message, the words stay in the box, and the screen says why in Chat\'s own words',
      await toasted(page, 'Could not send: Request had insufficient authentication scopes.') && (await page.evaluate(() => document.querySelector('[data-part=chatInput]').value)) === 'Will this go?' && google.post.length === 1);
    delete google.reply.post;
    google.post.length = 0;
    await page.keyboard.press('Enter');
    check('sent, the box is emptied and the message is among the others', await until(page, () => document.querySelectorAll('[data-part=msg]').length === 4 && document.querySelector('[data-part=chatInput]').value === '', null), await text(page, part('chatMessages')));
    check('…Chat was given the words, for the space that was open, as the account the person linked',
      google.post.length === 1 && google.post[0].auth === 'Bearer granted-at' && google.post[0].space === 'spaces/AAA1' && JSON.stringify(google.post[0].body) === '{"text":"Will this go?"}', JSON.stringify(google.post));
    await page.type(part('chatInput'), 'one');
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    await page.type(part('chatInput'), 'two');
    check('Shift+Enter breaks the line and sends nothing', (await page.evaluate(() => document.querySelector('[data-part=chatInput]').value)) === 'one\ntwo' && google.post.length === 1);
    await page.evaluate(() => { document.querySelector('[data-part=chatInput]').value = ''; });
    // an empty space
    await press(page, row(2));
    check('a space with nothing in it says so', await until(page, () => !!document.querySelector('[data-part=noMessages]'), null) && (await text(page, part('noMessages'))) === 'No messages in this space yet.' && (await text(page, part('chatName'))) === 'Direct message');
    // Refresh
    const before = google.spaces.length;
    await press(page, part('chatRefresh'));
    check('Refresh asks the spaces and the open conversation again', await until(page, n => document.querySelectorAll('[data-part=spaceRow]').length === 2, null) && google.spaces.length > before);
    await page.shut();
  }

  // ═══ 2. a member who has a link that cannot send ═════════════════════════════════════════════
  reset();
  {
    const page = await open(CY);
    await spaced(page);
    await press(page, row(1));
    await messaged(page);
    check('a link that was granted reading and not sending shows the messages, and a line where the box would be, with the way to link again',
      (await count(page, part('msg'))) === 3 && !(await has(page, part('chatInput'))) && (await text(page, part('chatComposer'))) === "Read-only — you didn't grant permission to send. Reconnect");
    await marked(page);
    await press(page, part('readOnlyLink'));
    check('…which goes to Google again and comes back with a link that can send: the box is there',
      await returned(page) && await spaced(page) && page.consent.length === 1 && page.consent[0].scope === SCOPE_ASKED && tokensOf(`${ids.cy}_gchat`).scope === SCOPE_ASKED
      && /\/employee\/gchat$/.test(page.url()), JSON.stringify(page.consent));
    await press(page, row(1));
    await messaged(page);
    check('…and the person can write', await has(page, part('chatInput')));
    await page.shut();
  }

  // ═══ 3. a link that cannot read ══════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(DAN);
    await spaced(page);
    google.messages.length = 0;
    await press(page, row(1));
    check('a link that was granted sending and not reading says the history is not shared, offers to grant it, and does not ask Chat for the messages',
      await until(page, () => !!document.querySelector('[data-part=stateCard]'), null) && (await text(page, part('stateTitle'))) === 'Message history not shared' && (await text(page, part('stateBtn'))) === 'Grant read access' && (await has(page, part('chatInput')))
      && google.messages.length === 0);
    await marked(page);
    await press(page, part('stateBtn'));
    check('…and granting it goes to Google, and the messages are there when the person is back',
      await returned(page) && await spaced(page) && page.consent.length === 1 && tokensOf(`${ids.dan}_gchat`).scope === SCOPE_ASKED);
    await page.shut();
  }

  // ═══ 4. a member who may read and may not write ══════════════════════════════════════════════
  reset();
  {
    const page = await open(EVE);
    await spaced(page);
    await press(page, row(1));
    await messaged(page);
    check('a member who may read and may not send is told their admin has not granted sending, and is offered no way to link again',
      (await text(page, part('chatComposer'))) === 'Read-only — your admin has not granted sending.' && !(await has(page, part('chatInput'))) && !(await has(page, part('readOnlyLink'))));
    await page.shut();
    const gone = await open(FAY, 'home');
    check('a member without the section has no Google Chat in their rail', !(await has(gone, '[data-screen=gchat]')));
    await gone.goto(base + '/employee/gchat', { waitUntil: 'domcontentloaded' });
    await gone.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await sleep(300);
    check('…and its address goes Home, not to a page with nothing on it', !(await has(gone, part('gchatPage'))) && /\/employee\/home$/.test(gone.url()), gone.url());
    await gone.shut();
  }

  // ═══ 5. a member links an account — and once Google would not take the code ═══════════════════
  reset();
  {
    const page = await open(GUS);
    await settled(page);
    check('a member with no account linked is offered to link one', (await text(page, part('stateTitle'))) === 'Connect Google Chat' && (await text(page, part('stateBtn'))) === 'Connect Google Chat');
    google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
    await press(page, part('stateBtn'));
    check('when Google will not trade the code, the member is sent back with the reason: the card says it, and the address has been cleaned of it',
      await until(page, () => !!document.querySelector('[data-part=stateCard]') && document.querySelector('[data-part=stateTitle]').textContent === "Couldn't connect Google Chat", null)
      && (await text(page, part('stateBody'))) === 'Bad Request' && (await text(page, part('stateBtn'))) === 'Try again' && !/gchat_error/.test(page.url()) && !linked(`${ids.gus}_gchat`), page.url());
    google.reply = {};
    await press(page, part('stateBtn'));
    check('Try again goes to Google, and this time the member comes back linked',
      await spaced(page) && page.consent.length === 2 && linked(`${ids.gus}_gchat`) && tokensOf(`${ids.gus}_gchat`).email === 'granted@motolinker.test', JSON.stringify(page.consent));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await spaced(page);
    check('…and the reason is not shown again on the next visit', !(await has(page, part('stateCard'))));
    await page.shut();
  }

  // ═══ 6. Chat saying no, and a link found to be lost ═══════════════════════════════════════════
  reset();
  {
    google.reply.spaces = () => jsonReply({ error: { code: 403, message: 'Google Chat API has not been used in project 1 before.' } }, 403);
    const page = await open(BEN);
    check('when the organization will not let the app use Chat, the screen says so and offers nothing',
      await until(page, () => !!document.querySelector('[data-part=stateCard]'), null) && (await text(page, part('stateTitle'))) === 'Google Chat unavailable'
      && (await text(page, part('stateBody'))) === "Google Chat isn't available for your organization. A Workspace admin needs to allow this app." && !(await has(page, part('stateBtn'))));
    await page.shut();
    reset();
    google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    const lost = await open(HAL);
    check('a link whose renewal Google refuses is told as an expired session, with the way to make it again',
      await until(lost, () => !!document.querySelector('[data-part=stateCard]'), null) && (await text(lost, part('stateBody'))) === 'Your Google session expired.' && (await text(lost, part('stateBtn'))) === 'Reconnect');
    await lost.reload({ waitUntil: 'domcontentloaded' });
    await lost.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    check('…and on the next visit the link is known to be lost: the screen says so from the start',
      await until(lost, () => !!document.querySelector('[data-part=stateCard]'), null) && (await text(lost, part('stateTitle'))) === 'Reconnect Google Chat');
    google.reply = {};
    await press(lost, part('stateBtn'));
    check('…and reconnecting replaces it: the member is linked again and the spaces are there', await spaced(lost) && tokensOf(`${ids.hal}_gchat`).access_token === 'granted-at');
    await lost.shut();
  }

  // ═══ 7. a phone: one pane at a time ══════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(IVY, 'gchat', { width: 390 });
    await settled(page);
    await press(page, part('stateBtn'));
    await spaced(page);
    check('on a phone the list of spaces is shown alone, and the conversation is not drawn',
      (await has(page, part('spaceRow'))) && (await page.evaluate(() => document.querySelector('[data-part=chatMain]').checkVisibility())) === false && (await page.evaluate(() => document.querySelector('[data-part=chatRooms]').checkVisibility())) === true);
    await press(page, row(1));
    await messaged(page);
    check('…a space opened takes the whole page, with a way back to the list',
      (await page.evaluate(() => document.querySelector('[data-part=chatRooms]').checkVisibility())) === false && (await page.evaluate(() => document.querySelector('[data-part=chatMain]').checkVisibility())) === true && (await page.evaluate(() => document.querySelector('[data-part=chatBack]').checkVisibility())) === true);
    const back = await page.evaluate(() => {
      const b = document.querySelector('[data-part=chatBack]'), cs = getComputedStyle(b), r = b.getBoundingClientRect(), g = b.querySelector('svg').getBoundingClientRect();
      return { bg: cs.backgroundColor, border: cs.borderTopWidth + '/' + cs.borderLeftWidth, color: cs.color, nameColor: getComputedStyle(document.querySelector('[data-part=chatName]')).color, cursor: cs.cursor, w: r.width, h: r.height,
        offX: Math.round(Math.abs(g.left + g.width / 2 - (r.left + r.width / 2))), offY: Math.round(Math.abs(g.top + g.height / 2 - (r.top + r.height / 2))),
        header: document.querySelector('[data-part=chatHeader]').getBoundingClientRect().height, nameH: document.querySelector('[data-part=chatName]').getBoundingClientRect().height };
    });
    check('…the way back is drawn plain (no fill, no border, the text colour, a hand), is a touch target with its arrow in the middle of it, and takes no height from the header',
      back.bg === 'rgba(0, 0, 0, 0)' && back.border === '0px/0px' && back.color === back.nameColor && back.cursor === 'pointer' && back.w >= 38 && back.h >= 38 && back.offX <= 1 && back.offY <= 1 && back.header <= back.nameH + 20, JSON.stringify(back));
    await press(page, part('chatBack'));
    check('…and the way back shows the list again', (await page.evaluate(() => document.querySelector('[data-part=chatRooms]').checkVisibility())) === true && (await page.evaluate(() => document.querySelector('[data-part=chatMain]').checkVisibility())) === false);
    await press(page, row(1));
    await messaged(page);
    await page.setViewport({ width: 1100, height: 900 });
    await sleep(100);
    check('on a desktop, with a space open, the back button is there and is not drawn', await page.evaluate(() => { const b = document.querySelector('[data-part=chatBack]'); return b !== null && !b.checkVisibility(); }));
    await page.shut();
  }

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  fs.rmSync(dist, { recursive: true, force: true });
  if (!UNCONFIGURED) {
    const un = spawnSync(process.execPath, [__filename, '--unconfigured'], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
    console.log(un.stdout.trim());
    if (un.status !== 0) console.log(un.stderr.slice(-800));
    process.exit(failed || un.status ? 1 : 0);
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
