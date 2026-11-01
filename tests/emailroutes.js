// My Email, as the server does it — in both portals, which write the same routes twice: the administrator's at /api/email/* and a team
// member's at /api/employee/email/* (status, connect, disconnect, the inbox, one message, send). The one road back from Google is
// shared with Drive and the rest: /api/email/callback tells the flows apart by the `state` each handed out.
//
// The new app's My Email calls these routes as they are. This holds what the screen may rely on: who may ask for what (each grant is its
// own: `email.view` reads the status, the inbox and a message, `email.send` sends, `email.connect` links and unlinks the mailbox), the
// three states a link can be in and what makes a Gmail link unable to send (the administrator's all were, until its connection began to
// ask for it), what the round trip to Google asks for and keeps — and that a return this server did not ask for is turned away rather
// than made the administrator's mailbox — what Google is asked for the inbox, a message and a send, what is kept when a link is renewed
// or let go of, that a link is a person's own, and that every answer is the shape packages/contracts says it is.
// Google is stood in for, so nothing here reaches the network. The viewer's safety against an attacker's message is tests/emailview.js.
const C = require('../packages/contracts');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const S = C.schemas;
const UNCONFIGURED = process.argv.includes('--unconfigured');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plainError = d => !!d && typeof d.error === 'string' && Object.keys(d).length === 1;

const APP = 'https://app.motolinker.test';
const FAR = Date.now() + 86400000;
const GMAIL = 'https://www.googleapis.com/auth/gmail';
const PROFILE = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const SCOPE_ASKED = `${GMAIL}.readonly ${GMAIL}.send ${PROFILE}`;               // what both portals ask for now
const SCOPE_OLD_ADMIN = `${GMAIL}.readonly ${PROFILE}`;                          // what the administrator's connection used to ask for
const link = (access, email, name, over = {}) => ({ access_token: access, refresh_token: access + '-refresh', expiry_date: FAR, email, name, scope: SCOPE_ASKED, ...over });
const row = (key, tokens) => ({ user_key: key, tokens, updated_at: '2026-10-01T00:00:00Z' });

// The links that are made when the app starts (it reads them back from the database as it boots). The people are told apart by what
// their link is:
//   the administrator — made the old way, with no right to send · Ana — a good one · Dee — read-only · Eli — gmail.modify · Fay — no grant
//   recorded · Pip — gmail.compose · Quin — all of Google's mail · Rae — only labels · Gus — run out, and Google will renew it · Hal — run
//   out, and Google will not · Mia — run out, with nothing to renew it with · Ben — a row a disconnect emptied · Ivy — never linked ·
//   Leo — will let go of his · the three with one grant each — a good link (so that what they are refused is the grant, not the link).
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [],
  google_tokens: [
    row('admin_gmail', link('adm-at', 'boss@motolinker.test', 'The Boss', { scope: SCOPE_OLD_ADMIN })),
    row('2_gmail', link('ana-at', 'ana@motolinker.test', 'Ana A.')),
    row('3_gmail', null),
    row('5_gmail', link('dee-at', 'dee@motolinker.test', 'Dee D.', { scope: `${GMAIL}.readonly ${PROFILE}` })),
    row('6_gmail', link('eli-at', 'eli@motolinker.test', 'Eli E.', { scope: `${GMAIL}.readonly ${GMAIL}.modify ${PROFILE}` })),
    row('7_gmail', link('fay-at', 'fay@motolinker.test', 'Fay F.', { scope: undefined })),
    row('8_gmail', link('gus-at', 'gus@motolinker.test', 'Gus G.', { expiry_date: Date.now() - 3600000 })),
    row('9_gmail', link('hal-at', 'hal@motolinker.test', 'Hal H.', { expiry_date: Date.now() - 3600000 })),
    row('13_gmail', link('leo-at', 'leo@motolinker.test', 'Leo L.')),
    row('14_gmail', link('mia-at', 'mia@motolinker.test', 'Mia M.', { expiry_date: Date.now() - 3600000, refresh_token: undefined })),
    row('16_gmail', link('pip-at', 'pip@motolinker.test', 'Pip P.', { scope: `${GMAIL}.readonly ${GMAIL}.compose ${PROFILE}` })),
    row('17_gmail', link('quin-at', 'quin@motolinker.test', 'Quin Q.', { scope: `https://mail.google.com/ ${PROFILE}` })),
    row('18_gmail', link('rae-at', 'rae@motolinker.test', 'Rae R.', { scope: `${GMAIL}.labels ${PROFILE}` })),
    row('21_gmail', link('ov-at', 'ov@motolinker.test', 'Only View')),
    row('22_gmail', link('os-at', 'os@motolinker.test', 'Only Send')),
    row('23_gmail', link('oc-at', 'oc@motolinker.test', 'Only Connect')),
  ],
});
db.install();

// Gmail's side of things, stood in for: the messages it holds, what it was asked and what it answers next.
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const header = (name, value) => ({ name, value });
const MESSAGES = {
  // an HTML message with a text twin, unread
  m1: { id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Hello, could you quote the Seal?', payload: { mimeType: 'multipart/alternative',
    headers: [header('From', 'Mona Buyer <mona@buyer.test>'), header('To', 'sales@motolinker.test'), header('Subject', 'Quote request'), header('Date', 'Tue, 20 Oct 2026 10:00:00 +0000'), header('Message-ID', '<m1@buyer.test>')],
    parts: [{ mimeType: 'text/plain', body: { data: b64('Hello, could you quote the Seal?') } }, { mimeType: 'text/html', body: { data: b64('<p>Hello, <b>could</b> you quote the Seal?</p>') } }] } },
  // plain text, read, with no subject
  m2: { id: 'm2', threadId: 't2', labelIds: ['INBOX'], snippet: 'Just text', payload: { mimeType: 'text/plain',
    headers: [header('From', 'noreply@service.test'), header('To', 'sales@motolinker.test'), header('Date', 'Mon, 19 Oct 2026 09:00:00 +0000')],
    body: { data: b64('Just text, no subject.') } } },
  // the HTML is two levels down (a message with an attachment, as most are)
  m3: { id: 'm3', threadId: 't3', labelIds: ['INBOX'], snippet: 'Invoice attached', payload: { mimeType: 'multipart/mixed',
    headers: [header('From', 'Billing <billing@supplier.test>'), header('To', 'sales@motolinker.test'), header('Subject', 'Invoice 42'), header('Date', 'Sun, 18 Oct 2026 08:00:00 +0000'), header('Message-ID', '<m3@supplier.test>')],
    parts: [{ mimeType: 'multipart/related', parts: [{ mimeType: 'text/html', body: { data: b64('<i>Invoice attached</i>') } }] }, { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'a1' } }] } },
  // the whole message is HTML
  m4: { id: 'm4', threadId: 't4', labelIds: ['INBOX'], snippet: 'Newsletter', payload: { mimeType: 'text/html', headers: [header('From', 'news@list.test'), header('Subject', 'Newsletter')], body: { data: b64('<h1>Newsletter</h1>') } } },
  // text parts only, side by side
  m5: { id: 'm5', threadId: 't5', labelIds: ['INBOX'], snippet: 'Parts', payload: { mimeType: 'multipart/mixed', headers: [header('From', 'a@b.test'), header('Subject', 'Parts')], parts: [{ mimeType: 'text/plain', body: { data: b64('first part') } }] } },
  // nothing in it
  m6: { id: 'm6', threadId: 't6', labelIds: ['INBOX'], snippet: '', payload: { headers: [header('From', 'a@b.test'), header('Subject', 'Empty')] } },
};
const gmail = { list: [], meta: [], full: [], send: [], reply: {} };
const google = { token: [], userinfo: [], reply: {} };
const reset = () => { for (const k of ['list', 'meta', 'full', 'send']) gmail[k].length = 0; gmail.reply = {}; google.token.length = 0; google.userinfo.length = 0; google.reply = {}; };
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
      : { access_token: 'granted-at', refresh_token: 'granted-rt', expires_in: 3600, scope: SCOPE_ASKED, token_type: 'Bearer' });
  }
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
    google.userinfo.push({ auth });
    return jsonReply(google.reply.userinfo || { email: 'granted@motolinker.test', name: 'Granted G.' });
  }
  if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages')) {
    const u = new URL(url);
    if (u.pathname.endsWith('/messages/send') && init.method === 'POST') {
      const sent = { auth, body: JSON.parse(init.body) };
      gmail.send.push(sent);
      return gmail.reply.send ? gmail.reply.send() : jsonReply({ id: 'sent-1', threadId: sent.body.threadId || 'new-thread' });
    }
    const one = /\/messages\/([^/]+)$/.exec(u.pathname);
    if (!one) {
      gmail.list.push({ url: u, auth });
      return gmail.reply.list ? gmail.reply.list() : jsonReply({ messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] });
    }
    const m = MESSAGES[one[1]];
    if (u.searchParams.get('format') === 'metadata') {
      gmail.meta.push({ id: one[1], url: u, auth });
      if (gmail.reply.meta) return gmail.reply.meta(one[1]);
      if (!m) return jsonReply({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
      const wanted = u.searchParams.getAll('metadataHeaders');
      return jsonReply({ id: m.id, labelIds: m.labelIds, snippet: m.snippet, payload: { headers: (m.payload.headers || []).filter(h => wanted.includes(h.name)) } });
    }
    gmail.full.push({ id: one[1], url: u, auth });
    if (gmail.reply.full) return gmail.reply.full(one[1]);
    if (!m) return jsonReply({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
    return jsonReply(m);
  }
  return realFetch(input, init);
};

(async () => {
  const base = await bootApp({ port: process.env.PORT || (UNCONFIGURED ? 4026 : 4025), env: UNCONFIGURED
    ? { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', APP_URL: APP }
    : { GOOGLE_CLIENT_ID: 'client-123', GOOGLE_CLIENT_SECRET: 'secret-456', APP_URL: APP } });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const person = (id, name, perms) => ({
    id, name, username: name.toLowerCase().replace(/\s+/g, ''), email: '', password_hash: ctx.hashPassword(name.toLowerCase().replace(/\s+/g, '') + '-password-1'), job_title: 'Ops',
    permissions: perms, avatar_url: '', status_text: '', status_emoji: '',
  });
  const may = (view, send, connect) => ({ email: true, emailActions: { view, send, connect } });
  const all = may(true, true, true);
  const PEOPLE = [[2, 'Ana'], [3, 'Ben'], [5, 'Dee'], [6, 'Eli'], [7, 'Fay'], [8, 'Gus'], [9, 'Hal'], [10, 'Ivy'], [11, 'Jo'], [12, 'Kai'], [13, 'Leo'], [14, 'Mia'], [16, 'Pip'], [17, 'Quin'], [18, 'Rae']];
  T.employees.push(
    ...PEOPLE.map(([id, name]) => person(id, name, all)),
    person(4, 'Cy', { email: false }),
    person(21, 'Onlyview', may(true, false, false)),
    person(22, 'Onlysend', may(false, true, false)),
    person(23, 'Onlyconnect', may(false, false, true)),
  );
  const call = async (method, path, { token, query, body } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path + (query ? '?' + query : ''), { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch (_) {}
    return { status: r.status, data, text, location: r.headers.get('location') };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const A = '/api/email', E = '/api/employee/email';
  const tok = {};
  for (const n of [...PEOPLE.map(p => p[1]), 'Cy', 'Onlyview', 'Onlysend', 'Onlyconnect']) tok[n] = await signIn(n);
  const settle = () => new Promise(r => setTimeout(r, 120));
  const rowOf = key => T.google_tokens.find(r => r.user_key === key);
  const callbackOf = (code, state) => call('GET', '/api/email/callback', { query: `code=${code}` + (state === undefined ? '' : '&state=' + state) });
  const stateOf = r => new URL(r.location).searchParams.get('state');

  // ═══ A Google project that is not set up here ═══════════════════════════════
  if (UNCONFIGURED) {
    const a = await call('GET', A + '/status', { token: 'adm' });
    const e = await call('GET', E + '/status', { token: tok.Ana });
    check('with no Google project set up, both portals say so (not configured, and nothing else)', same(a.data, { configured: false }) && same(e.data, { configured: false }) && shape(S.GmailStatus, a.data) === true);
    const ca = await call('GET', A + '/connect', { token: 'adm' });
    const ce = await call('GET', E + '/connect', { token: tok.Ana });
    check('…and there is nothing to connect to: the connect route says the client id is missing (400)', ca.status === 400 && /GOOGLE_CLIENT_ID not configured/.test(ca.text) && ce.status === 400 && /GOOGLE_CLIENT_ID not configured/.test(ce.text), `${ca.status} ${ce.status}`);
    const failed = results.filter(r => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }

  // ═══ Who may ask ═════════════════════════════════════════════════════════════
  const ROUTES = [['GET', '/status'], ['GET', '/connect'], ['GET', '/messages'], ['GET', '/messages/m1'], ['POST', '/send', { to: 'a@b.test', subject: 's', body: 'b' }], ['POST', '/disconnect']];
  const refusals = [];
  const refused = [];
  for (const [m, p, body] of ROUTES) {
    const a = await call(m, A + p, { body });
    const b = await call(m, E + p, { body });
    const c = await call(m, A + p, { token: tok.Ana, body });   // a team member's token is not the administrator's
    const d = await call(m, E + p, { token: 'adm', body });     // …nor the other way about
    refusals.push(a, b, c, d);
    if (a.status !== 401 || b.status !== 401 || c.status !== 401 || d.status !== 401) refused.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token', refused.length === 0, refused.join('; '));
  const none = [];
  for (const [m, p, body] of ROUTES) { const r = await call(m, E + p, { token: tok.Cy, body }); refusals.push(r); if (r.status !== 403) none.push(`${m} ${p}: ${r.status}`); }
  check('a team member with the section off is refused every route (403)', none.length === 0, none.join('; '));
  const lone = [];
  const expect = {
    Onlyview: { '/status': 200, '/connect': 403, '/messages': 200, '/messages/m1': 200, '/send': 403, '/disconnect': 403 },
    Onlysend: { '/status': 403, '/connect': 403, '/messages': 403, '/messages/m1': 403, '/send': 200, '/disconnect': 403 },
    Onlyconnect: { '/status': 403, '/connect': 302, '/messages': 403, '/messages/m1': 403, '/send': 403, '/disconnect': 200 },
  };
  for (const [who, routes] of Object.entries(expect)) {
    for (const [p, want] of Object.entries(routes)) {
      const [m, , body] = ROUTES.find(r => r[1] === p);
      const r = await call(m, E + p, { token: tok[who], body });
      if (r.status === 403) refusals.push(r);
      if (r.status !== want) lone.push(`${who} ${m} ${p}: ${r.status} (wanted ${want})`);
    }
  }
  check('each grant is its own: email.view reads the status, the inbox and a message, email.send sends and reads nothing, email.connect links and unlinks the mailbox and reads nothing', lone.length === 0, lone.join('; '));
  check('…and a refusal is always the one plain answer, { error } and nothing else', refusals.length > 30 && refusals.every(r => plainError(r.data)), refusals.filter(r => !plainError(r.data)).map(r => `${r.status} ${r.text}`).slice(0, 3).join(' | '));
  check('…the section off says "Not permitted"; no session says it is not signed in', refusals.filter(r => r.status === 403).every(r => r.data.error === 'Not permitted') && refusals.filter(r => r.status === 401).every(r => typeof r.data.error === 'string' && r.data.error !== 'Not permitted'));
  // (the grants above let go of Onlyconnect's link; that is what that one grant is for)
  const adminAll = [];
  for (const [m, p, body] of ROUTES.filter(r => r[1] !== '/disconnect')) { const r = await call(m, A + p, { token: 'adm', body }); if (![200, 302].includes(r.status)) adminAll.push(`${m} ${p}: ${r.status}`); }
  check('the administrator holds every grant: no route of theirs refuses them', adminAll.length === 0, adminAll.join('; '));
  reset();

  // ═══ What a link says of itself ══════════════════════════════════════════════
  const adminOld = await call('GET', A + '/status', { token: 'adm' });
  check('the administrator\'s link, made before the connection asked to send, is linked and cannot send', same(adminOld.data, { configured: true, connected: true, email: 'boss@motolinker.test', name: 'The Boss', canSend: false }) && shape(S.GmailStatus, adminOld.data) === true, JSON.stringify(adminOld.data));
  const ana = await call('GET', E + '/status', { token: tok.Ana });
  check('a team member\'s own link says who it is and that it can send', same(ana.data, { configured: true, connected: true, email: 'ana@motolinker.test', name: 'Ana A.', canSend: true }) && shape(S.GmailStatus, ana.data) === true, JSON.stringify(ana.data));
  const sends = {};
  for (const n of ['Dee', 'Eli', 'Fay', 'Pip', 'Quin', 'Rae']) sends[n] = (await call('GET', E + '/status', { token: tok[n] })).data;
  check('a link can send with gmail.send, gmail.compose, gmail.modify or all of Google\'s mail; one that was granted only reading (or only labels) cannot; a grant that was never recorded is let through',
    sends.Dee.canSend === false && sends.Rae.canSend === false && sends.Eli.canSend === true && sends.Pip.canSend === true && sends.Quin.canSend === true && sends.Fay.canSend === true, JSON.stringify(Object.fromEntries(Object.entries(sends).map(([k, v]) => [k, v.canSend]))));
  check('…every one of those answers is the shape the contract says (canSend is always there for a link that is made)', Object.values(sends).every(d => shape(S.GmailStatus, d) === true) && shape(S.GmailStatus, { configured: true, connected: true, email: 'x@y.z' }) !== true);
  const ben = await call('GET', E + '/status', { token: tok.Ben });
  const ivy = await call('GET', E + '/status', { token: tok.Ivy });
  check('a team member who never linked a mailbox (no row), or whose row was left empty by a disconnect, is "configured, not connected"', same(ben.data, { configured: true, connected: false }) && same(ivy.data, { configured: true, connected: false }) && shape(S.GmailStatus, ivy.data) === true);
  check('nobody sees another\'s link: each status is its owner\'s alone', ana.data.email !== sends.Dee.email && adminOld.data.email !== ana.data.email);

  // ═══ Going to Google ═════════════════════════════════════════════════════════
  const connectA = await call('GET', A + '/connect', { query: '_t=adm' });
  const ua = connectA.location ? new URL(connectA.location) : null;
  check('connecting sends the browser to Google\'s consent screen — the token in the address is the session (a page change cannot carry a header)',
    connectA.status === 302 && ua && ua.origin + ua.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', `${connectA.status} ${connectA.location}`);
  check('…the administrator\'s asks for the client, a way back to the one callback, a code, offline access, the consent screen every time, and the right to read the inbox AND to send (as the team\'s does) beside who they are',
    ua && ua.searchParams.get('client_id') === 'client-123' && ua.searchParams.get('redirect_uri') === APP + '/api/email/callback' && ua.searchParams.get('response_type') === 'code'
    && ua.searchParams.get('access_type') === 'offline' && ua.searchParams.get('prompt') === 'consent' && ua.searchParams.get('scope') === SCOPE_ASKED, ua && ua.searchParams.get('scope'));
  const connectB = await call('GET', A + '/connect', { query: '_t=adm' });
  const stateA = ua.searchParams.get('state'), stateB = new URL(connectB.location).searchParams.get('state');
  check('…and a state nobody could guess, a new one each time (it is how the way back knows the return is one this server asked for)', /^[0-9a-f]{32}$/.test(stateA) && /^[0-9a-f]{32}$/.test(stateB) && stateA !== stateB);
  const connectE = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const ue = new URL(connectE.location);
  check('a token that is no session is a 401 there as anywhere; a team member\'s connect is the same consent screen, the same scopes, a state of its own',
    (await call('GET', A + '/connect', { query: '_t=nope' })).status === 401 && connectE.status === 302 && ue.searchParams.get('scope') === SCOPE_ASKED && ue.searchParams.get('redirect_uri') === APP + '/api/email/callback' && /^[0-9a-f]{32}$/.test(ue.searchParams.get('state')) && ue.searchParams.get('state') !== stateA, `${connectE.status}`);

  // ═══ The round trip ═════════════════════════════════════════════════════════
  reset();
  const back = await callbackOf('the-code', stateA);
  check('Google sends the browser back to the one callback, and the administrator lands on Email (a 302 to the page\'s own address)', back.status === 302 && back.location === '/dashboard#email', `${back.status} ${back.location}`);
  check('…the code was traded for tokens (the client\'s id and secret, the same way back, the authorisation grant), and who the person is was asked of Google with the new access token',
    google.token.length === 1 && google.token[0].code === 'the-code' && google.token[0].client_id === 'client-123' && google.token[0].client_secret === 'secret-456'
    && google.token[0].redirect_uri === APP + '/api/email/callback' && google.token[0].grant_type === 'authorization_code' && google.userinfo[0].auth === 'Bearer granted-at', JSON.stringify(google.token));
  await settle();
  const rowA = rowOf('admin_gmail');
  check('…and the link is kept where a restart finds it (google_tokens), with who it is, when the access token runs out and what Google actually granted — it replaced the old one',
    rowA.tokens && rowA.tokens.access_token === 'granted-at' && rowA.tokens.refresh_token === 'granted-rt' && rowA.tokens.email === 'granted@motolinker.test' && rowA.tokens.name === 'Granted G.'
    && rowA.tokens.scope === SCOPE_ASKED && rowA.tokens.expiry_date > Date.now() + 3000000 && T.google_tokens.filter(r => r.user_key === 'admin_gmail').length === 1, JSON.stringify(rowA.tokens));
  const nowA = await call('GET', A + '/status', { token: 'adm' });
  check('the administrator is linked as the account Google named, and can send now', same(nowA.data, { configured: true, connected: true, email: 'granted@motolinker.test', name: 'Granted G.', canSend: true }), JSON.stringify(nowA.data));
  check('…Gmail is not Drive: the same return did not make a Drive link', !rowOf('admin_drive') && !T.google_tokens.some(r => /_drive$/.test(r.user_key)), JSON.stringify(T.google_tokens.map(r => r.user_key)));

  reset();
  const rtE = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const backE = await callbackOf('the-code', stateOf(rtE));
  await settle();
  check('a team member lands on the team portal\'s Email, and the link is their own (their id\'s row), replacing the empty one a disconnect had left',
    backE.status === 302 && backE.location === '/employee#email' && rowOf('3_gmail').tokens.access_token === 'granted-at' && T.google_tokens.filter(r => r.user_key === '3_gmail').length === 1, `${backE.status} ${backE.location}`);
  const benNow = await call('GET', E + '/status', { token: tok.Ben });
  const anaStill = await call('GET', E + '/status', { token: tok.Ana });
  check('…Ben is linked and Ana\'s link is what it was', benNow.data.connected === true && benNow.data.email === 'granted@motolinker.test' && anaStill.data.email === 'ana@motolinker.test');

  // a state is good once; a return this server did not ask for is turned away and nothing is traded or kept
  reset();
  const replay = await callbackOf('the-code', stateA);
  const noState = await callbackOf('a-code-from-somewhere-else');
  const strange = await callbackOf('a-code-from-somewhere-else', 'f'.repeat(32));
  const adminAfter = await call('GET', A + '/status', { token: 'adm' });
  check('a return this server did not ask for — no state, a state it never handed out, or one already used — is turned away (400), Google is not asked to trade its code, and the administrator\'s mailbox is as it was',
    [replay, noState, strange].every(r => r.status === 400 && /not one this server handed out/.test(r.text)) && google.token.length === 0 && google.userinfo.length === 0 && adminAfter.data.email === 'granted@motolinker.test' && rowOf('admin_gmail').tokens.access_token === 'granted-at',
    [replay, noState, strange].map(r => `${r.status} ${r.text.slice(0, 40)}`).join(' | '));
  const noCode = await call('GET', '/api/email/callback', { query: 'state=whatever' });
  check('a way back without a code is turned away (400)', noCode.status === 400 && /No code provided/.test(noCode.text), `${noCode.status} ${noCode.text}`);
  // the Drive state and the Gmail state are not the same thing
  reset();
  const driveBegin = await call('GET', '/api/drive/connect', { query: '_t=adm' });
  const driveBack = await callbackOf('drive-code', stateOf(driveBegin));
  await settle();
  check('a state handed out for Drive links Drive and not Gmail (the flows are told apart by their state)', driveBack.location === '/dashboard#drive' && !!rowOf('admin_drive') && rowOf('admin_gmail').tokens.access_token === 'granted-at', `${driveBack.location}`);
  // google says no
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
  const begin = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const refusedBack = await callbackOf('stale', stateOf(begin));
  check('when Google will not trade the code, the person is told so in words, in plain text, and nothing is kept (500)', refusedBack.status === 500 && /^OAuth error: Bad Request/.test(refusedBack.text) && (await call('GET', E + '/status', { token: tok.Ben })).data.email === 'granted@motolinker.test', `${refusedBack.status} ${refusedBack.text}`);
  // two people on the consent screen at once come back to their own links
  reset();
  const bJo = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Jo) });
  const bKai = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Kai) });
  google.reply.userinfo = { email: 'kai@motolinker.test', name: 'Kai K.' };
  const backKai = await callbackOf('c-kai', stateOf(bKai));
  google.reply.userinfo = { email: 'jo@motolinker.test', name: 'Jo J.' };
  const backJo = await callbackOf('c-jo', stateOf(bJo));
  const sJo = await call('GET', E + '/status', { token: tok.Jo });
  const sKai = await call('GET', E + '/status', { token: tok.Kai });
  check('two people on Google\'s consent screen at once, coming back in the other order, each land on their own link', backJo.location === '/employee#email' && backKai.location === '/employee#email' && sJo.data.email === 'jo@motolinker.test' && sKai.data.email === 'kai@motolinker.test', `${sJo.data.email} ${sKai.data.email}`);

  // ═══ The inbox ═══════════════════════════════════════════════════════════════
  reset();
  const inboxA = await call('GET', A + '/messages', { token: 'adm' });
  check('the administrator\'s inbox is a line for each message, in the order Gmail gave, in the shape the contract says: sender, subject (or "(no subject)"), date, snippet, and whether it is unread',
    inboxA.status === 200 && shape(S.GmailMessageList, inboxA.data) === true && inboxA.data.map(m => m.id).join() === 'm1,m2,m3'
    && same(inboxA.data[0], { id: 'm1', subject: 'Quote request', from: 'Mona Buyer <mona@buyer.test>', date: 'Tue, 20 Oct 2026 10:00:00 +0000', snippet: 'Hello, could you quote the Seal?', unread: true })
    && inboxA.data[1].subject === '(no subject)' && inboxA.data[1].unread === false && inboxA.data[1].date === 'Mon, 19 Oct 2026 09:00:00 +0000', JSON.stringify(inboxA.data));
  const l1 = gmail.list[0];
  check('…asked of Gmail as the administrator\'s own account: the 15 newest in the inbox, and each message\'s From, Subject and Date',
    gmail.list.length === 1 && l1.auth === 'Bearer granted-at' && l1.url.searchParams.get('maxResults') === '15' && l1.url.searchParams.get('labelIds') === 'INBOX'
    && gmail.meta.length === 3 && gmail.meta.every(x => x.auth === 'Bearer granted-at' && x.url.searchParams.get('format') === 'metadata' && same(x.url.searchParams.getAll('metadataHeaders'), ['From', 'Subject', 'Date'])), JSON.stringify(gmail.list.map(x => x.url.search)));
  reset();
  const inboxE = await call('GET', E + '/messages', { token: tok.Ana });
  check('a team member\'s inbox is the same call with their own account and the 20 newest — not the administrator\'s', inboxE.status === 200 && shape(S.GmailMessageList, inboxE.data) === true && inboxE.data.length === 3
    && gmail.list[0].auth === 'Bearer ana-at' && gmail.list[0].url.searchParams.get('maxResults') === '20' && gmail.meta.every(x => x.auth === 'Bearer ana-at'));
  reset();
  gmail.reply.list = () => jsonReply({ resultSizeEstimate: 0 });
  const emptyA = await call('GET', A + '/messages', { token: 'adm' });
  const emptyE = await call('GET', E + '/messages', { token: tok.Ana });
  check('an inbox with nothing in it answers a list with nothing in it (Gmail leaves the list out)', same(emptyA.data, []) && same(emptyE.data, []) && gmail.meta.length === 0);
  reset();
  gmail.reply.list = () => jsonReply({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
  const failedA = await call('GET', A + '/messages', { token: 'adm' });
  const failedE = await call('GET', E + '/messages', { token: tok.Ana });
  check('(a known gap: when Gmail refuses the list, the answer is an empty inbox, not Gmail\'s words — the page cannot tell it from an empty one)', failedA.status === 200 && same(failedA.data, []) && failedE.status === 200 && same(failedE.data, []));
  reset();
  gmail.reply.meta = id => (id === 'm2' ? jsonReply({ error: { code: 500, message: 'Backend Error' } }, 500) : jsonReply({ id, labelIds: ['INBOX'], snippet: 's', payload: { headers: [header('From', 'x@y.test'), header('Subject', 'S'), header('Date', 'D')] } }));
  const holey = await call('GET', E + '/messages', { token: tok.Ana });
  check('a message Gmail would not describe comes back with nothing but its id', shape(S.GmailMessageList, holey.data) === true && same(holey.data[1], { id: 'm2', subject: '(no subject)', from: '', date: '', snippet: '', unread: false }), JSON.stringify(holey.data[1]));
  reset();
  const unlinkedList = await call('GET', E + '/messages', { token: tok.Ivy });
  check('a person with no mailbox who asks for the inbox is told so — the team\'s route says it as a server error (500), and Gmail is not asked', unlinkedList.status === 500 && same(unlinkedList.data, { error: 'Gmail not connected' }) && gmail.list.length === 0, `${unlinkedList.status} ${unlinkedList.text}`);

  // ═══ One message ═════════════════════════════════════════════════════════════
  reset();
  const m1 = await call('GET', A + '/messages/m1', { token: 'adm' });
  check('a message opened has its thread, labels, sender, recipient, date and Message-ID, and its HTML where it has HTML (the text twin is not preferred) — in the shape the contract says',
    m1.status === 200 && shape(S.GmailMessage, m1.data) === true && m1.data.threadId === 't1' && same(m1.data.labelIds, ['INBOX', 'UNREAD']) && m1.data.subject === 'Quote request' && m1.data.from === 'Mona Buyer <mona@buyer.test>'
    && m1.data.to === 'sales@motolinker.test' && m1.data.date === 'Tue, 20 Oct 2026 10:00:00 +0000' && m1.data.messageId === '<m1@buyer.test>' && m1.data.body === '<p>Hello, <b>could</b> you quote the Seal?</p>' && m1.data.isHtml === true, JSON.stringify(m1.data));
  check('…asked of Gmail in full, as the administrator\'s own account', gmail.full.length === 1 && gmail.full[0].id === 'm1' && gmail.full[0].url.searchParams.get('format') === 'full' && gmail.full[0].auth === 'Bearer granted-at');
  const kinds = {};
  for (const id of ['m2', 'm3', 'm4', 'm5', 'm6']) kinds[id] = (await call('GET', E + '/messages/' + id, { token: tok.Ana })).data;
  check('plain text is plain text; a whole-HTML message is HTML; text parts are text; a message with nothing in it has an empty body',
    kinds.m2.body === 'Just text, no subject.' && kinds.m2.isHtml === false && kinds.m4.body === '<h1>Newsletter</h1>' && kinds.m4.isHtml === true && kinds.m5.body === 'first part' && kinds.m5.isHtml === false && kinds.m6.body === '' && kinds.m6.isHtml === false && Object.values(kinds).every(d => shape(S.GmailMessage, d) === true), JSON.stringify(kinds.m6));
  check('(a known gap: an HTML body found two levels down, as in most messages with an attachment, is found but not marked as HTML — so it is shown as text)', kinds.m3.body === '<i>Invoice attached</i>' && kinds.m3.isHtml === false, JSON.stringify(kinds.m3));
  check('a message with no subject, no recipient and no Message-ID has them as empty text, not as nothing', kinds.m2.subject === '' && kinds.m2.messageId === '' && kinds.m4.to === '');
  reset();
  const lost = await call('GET', E + '/messages/nope', { token: tok.Ana });
  check('(a known gap: a message Gmail cannot find is not an error — it comes back as a message with nothing in it, and no id)', lost.status === 200 && shape(S.GmailMessage, lost.data) === true && lost.data.id === undefined && lost.data.body === '' && lost.data.subject === '', JSON.stringify(lost.data));
  reset();
  const noOne = await call('GET', E + '/messages/m1', { token: tok.Ivy });
  check('a person with no mailbox who asks for a message is told so (500), and Gmail is not asked', noOne.status === 500 && same(noOne.data, { error: 'Gmail not connected' }) && gmail.full.length === 0);

  // ═══ Sending ═════════════════════════════════════════════════════════════════
  reset();
  const sendA = await call('POST', A + '/send', { token: 'adm', body: { to: 'mona@buyer.test', subject: 'Re: Quote request', body: 'Yes, by Friday.', threadId: 't1', inReplyTo: '<m1@buyer.test>' } });
  const sent = gmail.send[0];
  const mime = sent ? Buffer.from(sent.body.raw, 'base64url').toString('utf8') : '';
  check('a reply is sent as the administrator\'s own account: To, Subject, a plain-text type, In-Reply-To and References for the message it answers, a blank line and the words — in the thread it belongs to',
    sendA.status === 200 && same(sendA.data, { ok: true, id: 'sent-1' }) && shape(S.GmailSent, sendA.data) === true && sent.auth === 'Bearer granted-at' && sent.body.threadId === 't1'
    && mime === 'To: mona@buyer.test\r\nSubject: Re: Quote request\r\nContent-Type: text/plain; charset=utf-8\r\nIn-Reply-To: <m1@buyer.test>\r\nReferences: <m1@buyer.test>\r\n\r\nYes, by Friday.', JSON.stringify(mime));
  reset();
  const sendE = await call('POST', E + '/send', { token: tok.Ana, body: { to: 'new@buyer.test', subject: 'Hello', body: 'A new message.' } });
  const mimeE = gmail.send[0] ? Buffer.from(gmail.send[0].body.raw, 'base64url').toString('utf8') : '';
  check('a new message has no thread and no In-Reply-To, and is sent as the team member\'s own account', sendE.status === 200 && same(sendE.data, { ok: true, id: 'sent-1' }) && gmail.send[0].auth === 'Bearer ana-at' && !('threadId' in gmail.send[0].body)
    && mimeE === 'To: new@buyer.test\r\nSubject: Hello\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nA new message.', JSON.stringify(mimeE));
  check('…words that are not in the alphabet of a mail header travel as they are typed', await (async () => {
    reset();
    const r = await call('POST', E + '/send', { token: tok.Ana, body: { to: 'x@y.test', subject: 'مرحبا', body: 'نص الرسالة' } });
    const m = Buffer.from(gmail.send[0].body.raw, 'base64url').toString('utf8');
    return r.status === 200 && m.endsWith('\r\n\r\nنص الرسالة') && /Subject: مرحبا/.test(m);
  })());
  const missing = [];
  for (const [what, body] of [['to', { subject: 's', body: 'b' }], ['subject', { to: 'a@b.test', body: 'b' }], ['body', { to: 'a@b.test', subject: 's' }], ['everything', {}]]) {
    reset();
    const a = await call('POST', A + '/send', { token: 'adm', body });
    const e = await call('POST', E + '/send', { token: tok.Ana, body });
    if (a.status !== 400 || e.status !== 400 || a.data.error !== 'to, subject and body are required' || e.data.error !== 'to, subject and body are required' || gmail.send.length) missing.push(what);
  }
  check('a message with no recipient, no subject or no words is turned away in both portals (400), and Gmail is not asked', missing.length === 0, missing.join());
  reset();
  gmail.reply.send = () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, 403);
  const refusedSendA = await call('POST', A + '/send', { token: 'adm', body: { to: 'a@b.test', subject: 's', body: 'b' } });
  const refusedSendE = await call('POST', E + '/send', { token: tok.Ana, body: { to: 'a@b.test', subject: 's', body: 'b' } });
  check('when Gmail says no, the page is told Gmail\'s own words (500)', refusedSendA.status === 500 && refusedSendA.data.error === 'Request had insufficient authentication scopes.' && refusedSendE.status === 500 && refusedSendE.data.error === 'Request had insufficient authentication scopes.', JSON.stringify(refusedSendA.data));
  reset();
  const noSend = await call('POST', E + '/send', { token: tok.Ivy, body: { to: 'a@b.test', subject: 's', body: 'b' } });
  check('a person with no mailbox who sends is told so (500), and Gmail is not asked', noSend.status === 500 && same(noSend.data, { error: 'Gmail not connected' }) && gmail.send.length === 0);

  // ═══ A link that has run out ════════════════════════════════════════════════
  reset();
  // (what Google says of the renewed grant replaces what the link knew: here it has narrowed it)
  google.reply.token = () => jsonReply({ access_token: 'refreshed-at', expires_in: 3600, scope: `${GMAIL}.readonly ${PROFILE}` });
  const gusList = await call('GET', E + '/messages', { token: tok.Gus });
  check('an access token that has run out is traded for a new one with the refresh token — and Gmail is asked with the new one',
    gusList.status === 200 && google.token.length === 1 && google.token[0].grant_type === 'refresh_token' && google.token[0].refresh_token === 'gus-at-refresh'
    && google.token[0].client_id === 'client-123' && google.token[0].client_secret === 'secret-456' && gmail.list[0].auth === 'Bearer refreshed-at' && gmail.meta.every(x => x.auth === 'Bearer refreshed-at'), JSON.stringify(google.token));
  await settle();
  const rowGus = rowOf('8_gmail');
  check('…the new one is kept for a restart to find, with who the person is and the refresh token still there', rowGus.tokens.access_token === 'refreshed-at' && rowGus.tokens.refresh_token === 'gus-at-refresh' && rowGus.tokens.email === 'gus@motolinker.test' && rowGus.tokens.expiry_date > Date.now() + 3000000, JSON.stringify(rowGus.tokens));
  const gusStatus = await call('GET', E + '/status', { token: tok.Gus });
  check('…and what Google said of the grant when it renewed it is what the link now knows (a grant that was narrowed can no longer send)', rowGus.tokens.scope === `${GMAIL}.readonly ${PROFILE}` && gusStatus.data.canSend === false, JSON.stringify(gusStatus.data));
  const gusOpen = await call('GET', E + '/messages/m1', { token: tok.Gus });
  check('…and it is not traded again while it holds — a message opened uses it as it is', gusOpen.status === 200 && google.token.length === 1 && gmail.full[0].auth === 'Bearer refreshed-at');
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  gmail.reply.send = () => jsonReply({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
  const halSend = await call('POST', E + '/send', { token: tok.Hal, body: { to: 'a@b.test', subject: 's', body: 'b' } });
  check('a renewal that Google refuses is not reported as such: the old token is tried, and what Gmail says to it is what the page is told (500)',
    halSend.status === 500 && halSend.data.error === 'Invalid Credentials' && google.token.length === 1 && google.token[0].grant_type === 'refresh_token' && gmail.send.length === 1 && gmail.send[0].auth === 'Bearer hal-at', `${halSend.status} ${JSON.stringify(halSend.data)}`);
  reset();
  const miaOpen = await call('GET', E + '/messages/m1', { token: tok.Mia });
  check('a lapsed access token with no refresh token is used as it is: Google is not asked to renew what cannot be renewed', miaOpen.status === 200 && google.token.length === 0 && gmail.full[0].auth === 'Bearer mia-at', JSON.stringify(google.token));

  // ═══ Letting go ═════════════════════════════════════════════════════════════
  reset();
  const leoWas = await call('GET', E + '/status', { token: tok.Leo });
  const leoLet = await call('POST', E + '/disconnect', { token: tok.Leo });
  const leoStatus = await call('GET', E + '/status', { token: tok.Leo });
  const leoList = await call('GET', E + '/messages', { token: tok.Leo });
  await settle();
  check('a member who lets go is unlinked at once — the link is forgotten in the app\'s memory as well as emptied in the table, and answers { ok: true }',
    leoWas.data.connected === true && leoLet.status === 200 && same(leoLet.data, { ok: true }) && shape(S.GoogleDisconnected, leoLet.data) === true && same(leoStatus.data, { configured: true, connected: false })
    && leoList.status === 500 && leoList.data.error === 'Gmail not connected' && gmail.list.length === 0 && rowOf('13_gmail').tokens === null && T.google_tokens.filter(r => r.user_key === '13_gmail').length === 1,
    JSON.stringify([leoStatus.data, leoList.data]));
  check('…it is only the caller\'s own: the other people\'s links stand', ['2_gmail', '5_gmail', '21_gmail', '22_gmail'].every(k => rowOf(k) && rowOf(k).tokens && rowOf(k).tokens.access_token));
  const gone = await call('POST', A + '/disconnect', { token: 'adm' });
  const goneStatus = await call('GET', A + '/status', { token: 'adm' });
  const goneList = await call('GET', A + '/messages', { token: 'adm' });
  const goneOpen = await call('GET', A + '/messages/m1', { token: 'adm' });
  await settle();
  check('the administrator lets go: the same, and its routes say so in their own ways (the inbox 400, a message and a send 500)',
    same(gone.data, { ok: true }) && same(goneStatus.data, { configured: true, connected: false }) && rowOf('admin_gmail').tokens === null && goneList.status === 400 && same(goneList.data, { error: 'Gmail not connected' })
    && goneOpen.status === 500 && same(goneOpen.data, { error: 'Gmail not connected' }) && gmail.list.length === 0, JSON.stringify([goneList.data, goneOpen.data]));
  const again = await call('POST', A + '/disconnect', { token: 'adm' });
  check('…and letting go of a link that is not there is as quiet as letting go of one that is', again.status === 200 && same(again.data, { ok: true }));

  // ═══ The administrator renews a link ════════════════════════════════════════
  reset();
  google.reply.token = body => (body.grant_type === 'refresh_token'
    ? jsonReply({ access_token: 'refreshed-at', expires_in: 3600 })
    : jsonReply({ access_token: 'short-at', refresh_token: 'short-rt', expires_in: 30, scope: SCOPE_ASKED, token_type: 'Bearer' }));
  const beginShort = await call('GET', A + '/connect', { query: '_t=adm' });
  await callbackOf('c-short', stateOf(beginShort));
  google.token.length = 0;
  const shortOpen = await call('GET', A + '/messages/m1', { token: 'adm' });
  await settle();
  check('a message opened on a link about to run out renews it first, with the refresh token, asks Gmail with the new access token, and keeps the new one for a restart',
    shortOpen.status === 200 && google.token.length === 1 && google.token[0].grant_type === 'refresh_token' && google.token[0].refresh_token === 'short-rt' && gmail.full[0].auth === 'Bearer refreshed-at' && rowOf('admin_gmail').tokens.access_token === 'refreshed-at',
    `${shortOpen.status} ${JSON.stringify(google.token)}`);

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (!UNCONFIGURED) {
    const un = spawnSync(process.execPath, [__filename, '--unconfigured'], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
    console.log(un.stdout.trim());
    if (un.status !== 0) { console.log(un.stderr.slice(-800)); }
    process.exit(failed || un.status ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
