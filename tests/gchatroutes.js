// Google Chat, as the server does it — in both portals, which share one set of six routes (one factory, mounted twice): the administrator's at
// /api/dashboard/gchat/* and a team member's at /api/employee/gchat/* (status, connect, disconnect, the spaces, the messages of a space, send).
// The one road back from Google is shared with Drive, Gmail and the rest: /api/email/callback tells the flows apart by the `state` each handed out.
//
// The new app's Google Chat calls these routes as they are. This holds what the screen may rely on: who may ask for what (gchat.view reads, links
// and lets go; gchat.send sends — there is no grant of its own for linking), the states a link can be in (none, lost, linked) and what a linked one
// reaches (spaces, reading, sending: from the scopes Google actually granted, which can be fewer than were asked for), what the round trip to Google
// asks for and keeps, how a way back that failed is told (?gchat_error=), what Google is asked for the spaces, a space's messages and a send, what
// is kept when a link is renewed, lost or let go of, that a link is a person's own, and that every answer is the shape packages/contracts says it
// is. Google is stood in for, so nothing here reaches the network. The suite runs again in smaller processes for what is decided when the app starts
// (Chat not switched on, no client to ask with, no reading asked for, Chat's client falling back to the app's own).
const C = require('../packages/contracts');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const S = C.schemas;
const MODE = ((process.argv.find(a => a.startsWith('--mode=')) || '').slice(7)); // '' | off | word | noclient | noread | fallback
const PORTS = { '': 4030, off: 4031, noclient: 4032, noread: 4033, fallback: 4034, word: 4038 };
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plainError = d => !!d && typeof d.error === 'string' && Object.keys(d).length === 1;

const APP = 'https://app.motolinker.test';
const FAR = Date.now() + 86400000;
const CHAT = 'https://www.googleapis.com/auth/chat';
const PROFILE = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const SCOPE_ASKED = `${CHAT}.spaces.readonly ${CHAT}.messages.create ${CHAT}.messages.readonly ${PROFILE}`;   // what both portals ask for
const SCOPE_NO_READ = `${CHAT}.spaces.readonly ${CHAT}.messages.create ${PROFILE}`;                          // …when reading is not asked for
const link = (access, email, name, over = {}) => ({ access_token: access, refresh_token: access + '-refresh', expiry_date: FAR, email, name, scope: SCOPE_ASKED, ...over });
const row = (key, tokens) => ({ user_key: key, tokens, updated_at: '2026-10-01T00:00:00Z' });
const LAPSED = Date.now() - 3600000;

const CONFIGURED = { GOOGLE_CLIENT_ID: 'client-123', GOOGLE_CLIENT_SECRET: 'secret-456', GOOGLE_CHAT_ENABLED: '1', GOOGLE_CHAT_CLIENT_ID: 'chat-client-789', GOOGLE_CHAT_CLIENT_SECRET: 'chat-secret-000', GOOGLE_CHAT_READ: '', APP_URL: APP };
const ENVS = {
  '': CONFIGURED,
  off: { ...CONFIGURED, GOOGLE_CHAT_ENABLED: '' },                                                    // Google is set up here; Chat is not switched on
  word: { ...CONFIGURED, GOOGLE_CHAT_ENABLED: 'true' },                                               // …and "true" is not "1": the one word that switches it on is 1
  noclient: { ...CONFIGURED, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_CHAT_CLIENT_ID: '', GOOGLE_CHAT_CLIENT_SECRET: '' },   // switched on, with nothing to ask Google with
  noread: { ...CONFIGURED, GOOGLE_CHAT_READ: '0' },                                                   // reading history is not asked for
  fallback: { ...CONFIGURED, GOOGLE_CHAT_CLIENT_ID: '', GOOGLE_CHAT_CLIENT_SECRET: '' },             // Chat has no client of its own: the app's is used
};
const CLIENT = MODE === 'fallback' ? ['client-123', 'secret-456'] : ['chat-client-789', 'chat-secret-000'];

// The links that are made when the app starts (it reads them back from the database as it boots). The people are told apart by what their link is:
//   the administrator — a good one · Ana — a good one · Ben — a row a disconnect emptied · Dee — read only · Eli — send only · Fay — all of "messages" ·
//   Gus — run out, and Google will renew it · Hal — run out, and Google will not · Ivy — never linked · Leo — will let go of his · Mia — run out, with
//   nothing to renew it with · Nia — a grant that was never recorded · Pip — none of Chat's boxes ticked · Quin — the grant under its other name · Sol — the wider spaces scope · Tam — about to run out · Vic — no expiry recorded · Wes — run out, and Google gives the renewal no lifetime · Zed — no row, and will come back from Google with a grant that says nothing of its scope ·
//   Rae — run out, and Google is unwell when asked to renew it · Ivy — no row at all, and goes to Google below · Una — no row at all, and stays so ·
//   Jo and Kai — will come back from Google together · the two with one grant each — a good link (so that what they are refused is the grant).
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [],
  google_tokens: [
    row('admin_gchat', link('adm-at', 'boss@motolinker.test', 'The Boss')),
    row('2_gchat', link('ana-at', 'ana@motolinker.test', 'Ana A.')),
    row('3_gchat', null),
    row('5_gchat', link('dee-at', 'dee@motolinker.test', 'Dee D.', { scope: `${CHAT}.spaces.readonly ${CHAT}.messages.readonly ${PROFILE}` })),
    row('6_gchat', link('eli-at', 'eli@motolinker.test', 'Eli E.', { scope: `${CHAT}.spaces.readonly ${CHAT}.messages.create ${PROFILE}` })),
    row('7_gchat', link('fay-at', 'fay@motolinker.test', 'Fay F.', { scope: `${CHAT}.spaces.readonly ${CHAT}.messages ${PROFILE}` })),
    row('8_gchat', link('gus-at', 'gus@motolinker.test', 'Gus G.', { expiry_date: LAPSED })),
    row('9_gchat', link('hal-at', 'hal@motolinker.test', 'Hal H.', { expiry_date: LAPSED })),
    row('13_gchat', link('leo-at', 'leo@motolinker.test', 'Leo L.')),
    row('14_gchat', link('mia-at', 'mia@motolinker.test', 'Mia M.', { expiry_date: LAPSED, refresh_token: undefined })),
    row('15_gchat', link('nia-at', 'nia@motolinker.test', 'Nia N.', { scope: undefined })),
    row('16_gchat', link('pip-at', 'pip@motolinker.test', 'Pip P.', { scope: PROFILE })),
    row('17_gchat', link('quin-at', 'quin@motolinker.test', 'Quin Q.', { scope: undefined, granted_scopes: `${CHAT}.spaces.readonly ${CHAT}.messages.create ${PROFILE}` })),
    row('18_gchat', link('rae-at', 'rae@motolinker.test', 'Rae R.', { expiry_date: LAPSED })),
    row('21_gchat', link('ov-at', 'ov@motolinker.test', 'Only View')),
    row('22_gchat', link('os-at', 'os@motolinker.test', 'Only Send')),
    row('23_gchat', link('sol-at', 'sol@motolinker.test', 'Sol S.', { scope: `${CHAT}.spaces ${CHAT}.messages.readonly ${PROFILE}` })),
    row('24_gchat', link('tam-at', 'tam@motolinker.test', 'Tam T.', { expiry_date: Date.now() + 30000 })),
    row('25_gchat', link('vic-at', 'vic@motolinker.test', 'Vic V.', { expiry_date: undefined })),
    row('26_gchat', link('wes-at', 'wes@motolinker.test', 'Wes W.', { expiry_date: LAPSED })),
  ],
});
db.install();

// Google Chat's side of things, stood in for: the spaces it holds, the messages of a space (newest first, as Chat gives them), what it was asked
// and what it answers next.
const SPACES = [
  { name: 'spaces/AAA1', displayName: 'Sales team', spaceType: 'SPACE' },
  { name: 'spaces/BBB2', spaceType: 'DIRECT_MESSAGE' },
  { name: 'spaces/CCC3', spaceType: 'GROUP_CHAT' },
  { name: 'spaces/DDD4', displayName: 'Old room', type: 'ROOM' },        // (Chat's older word for the kind)
  { name: 'spaces/EEE5', displayName: 'No kind' },
];
const MESSAGES = [
  { name: 'spaces/AAA1/messages/m3', text: 'Third, from Bo', sender: { displayName: 'Bo B.', name: 'users/22' }, createTime: '2026-10-20T10:03:00Z' },
  { name: 'spaces/AAA1/messages/m2', text: 'Second, from Ana', sender: { displayName: 'Ana A.', name: 'users/11' }, createTime: '2026-10-20T10:02:00Z' },
  { name: 'spaces/AAA1/messages/m1', createTime: '2026-10-20T10:01:00Z' },       // a card: no words, nobody named
];
const chat = { spaces: [], messages: [], post: [], reply: {} };
const google = { token: [], userinfo: [], reply: {} };
const reset = () => { for (const k of ['spaces', 'messages', 'post']) chat[k].length = 0; chat.reply = {}; google.token.length = 0; google.userinfo.length = 0; google.reply = {}; };
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
      : { access_token: 'granted-at', refresh_token: 'granted-rt', expires_in: 3600, scope: MODE === 'noread' ? SCOPE_NO_READ : SCOPE_ASKED, token_type: 'Bearer' });
  }
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
    google.userinfo.push({ auth });
    return jsonReply(google.reply.userinfo || { email: 'granted@motolinker.test', name: 'Granted G.' });
  }
  if (url.startsWith('https://chat.googleapis.com/v1/')) {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1\//, '');
    if (path === 'spaces') {
      chat.spaces.push({ url: u, auth });
      return chat.reply.spaces ? chat.reply.spaces() : jsonReply({ spaces: SPACES });
    }
    const m = /^(spaces\/[^/]+)\/messages$/.exec(path);
    if (m && init.method === 'POST') {
      const posted = { space: m[1], auth, type: (init.headers || {})['Content-Type'], body: JSON.parse(init.body) };
      chat.post.push(posted);
      return chat.reply.post ? chat.reply.post(posted) : jsonReply({ name: m[1] + '/messages/new1', text: posted.body.text });
    }
    if (m) {
      chat.messages.push({ space: m[1], url: u, auth });
      return chat.reply.messages ? chat.reply.messages(m[1]) : jsonReply({ messages: MESSAGES });
    }
  }
  return realFetch(input, init);
};

(async () => {
  const base = await bootApp({ port: process.env.PORT || PORTS[MODE], env: ENVS[MODE] });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const person = (id, name, perms) => ({
    id, name, username: name.toLowerCase().replace(/\s+/g, ''), email: '', password_hash: ctx.hashPassword(name.toLowerCase().replace(/\s+/g, '') + '-password-1'), job_title: 'Ops',
    permissions: perms, avatar_url: '', status_text: '', status_emoji: '',
  });
  const may = (view, send) => ({ gchat: true, gchatActions: { view, send } });
  const all = may(true, true);
  const PEOPLE = [[2, 'Ana'], [3, 'Ben'], [5, 'Dee'], [6, 'Eli'], [7, 'Fay'], [8, 'Gus'], [9, 'Hal'], [10, 'Ivy'], [11, 'Jo'], [12, 'Kai'], [13, 'Leo'], [14, 'Mia'], [15, 'Nia'], [16, 'Pip'], [17, 'Quin'], [18, 'Rae'], [19, 'Una'], [23, 'Sol'], [24, 'Tam'], [25, 'Vic'], [26, 'Wes'], [27, 'Zed']];
  T.employees.push(
    ...PEOPLE.map(([id, name]) => person(id, name, all)),
    person(4, 'Cy', { gchat: false }),
    person(21, 'Onlyview', may(true, false)),
    person(22, 'Onlysend', may(false, true)),
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
  const A = '/api/dashboard/gchat', E = '/api/employee/gchat';
  const tok = {};
  for (const n of [...PEOPLE.map(p => p[1]), 'Cy', 'Onlyview', 'Onlysend']) tok[n] = await signIn(n);
  const settle = () => new Promise(r => setTimeout(r, 120));
  const rowOf = key => T.google_tokens.find(r => r.user_key === key);
  const callbackOf = (code, state) => call('GET', '/api/email/callback', { query: `code=${code}` + (state === undefined ? '' : '&state=' + state) });
  const stateOf = r => new URL(r.location).searchParams.get('state');
  const SP = 'space=' + encodeURIComponent('spaces/AAA1');
  const me = async token => (await call('GET', '/api/v1/me', { token })).data;

  // ═══ Chat not set up here ═══════════════════════════════════════════════════
  if (MODE === 'off' || MODE === 'word' || MODE === 'noclient') {
    const a = await call('GET', A + '/status', { token: 'adm' });
    const e = await call('GET', E + '/status', { token: tok.Ana });
    check('with Chat ' + (MODE === 'off' ? 'not switched on' : MODE === 'word' ? 'asked for in some other word than 1' : 'switched on and nothing to ask Google with') + ', both portals say it is not configured (and nothing else)', same(a.data, { configured: false }) && same(e.data, { configured: false }) && shape(S.GchatStatus, a.data) === true && shape(S.GchatStatus, e.data) === true, JSON.stringify([a.data, e.data]));
    const ca = await call('GET', A + '/connect', { token: 'adm' });
    const ce = await call('GET', E + '/connect', { token: tok.Ana });
    const why = MODE === 'noclient' ? /GOOGLE_CLIENT_ID not configured/ : /Google Chat is not enabled \(set GOOGLE_CHAT_ENABLED=1\)/;
    check('…and there is nothing to connect to: the connect route says why in plain text (400)', ca.status === 400 && ce.status === 400 && why.test(ca.text) && why.test(ce.text), `${ca.status} ${ca.text} | ${ce.status} ${ce.text}`);
    const sp = await call('GET', A + '/spaces', { token: 'adm' });
    const ms = await call('GET', E + '/messages', { token: tok.Ana, query: SP });
    const sd = await call('POST', E + '/messages', { token: tok.Ana, body: { space: 'spaces/AAA1', text: 'hello' } });
    check('…the spaces, the messages and a send all answer "not configured" in their usual places (a 200 with the reason beside nothing), and Chat is not asked',
      sp.status === 200 && same(sp.data, { spaces: [], error: 'not_configured' }) && ms.status === 200 && same(ms.data, { messages: [], error: 'not_configured' }) && sd.status === 200 && same(sd.data, { ok: false, error: 'not_configured' })
      && shape(S.GchatSpaceList, sp.data) === true && shape(S.GchatMessageList, ms.data) === true && shape(S.GchatSent, sd.data) === true && chat.spaces.length + chat.messages.length + chat.post.length === 0, JSON.stringify([sp.data, ms.data, sd.data]));
    const fa = await me('adm'), fe = await me(tok.Ana);
    check('…and the rail is told Chat is not here: the gchat flag of /api/v1/me is off for both', fa.flags.gchat === false && fe.flags.gchat === false, JSON.stringify([fa.flags, fe.flags]));
    const failed = results.filter(r => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }

  // ═══ Who may ask ═════════════════════════════════════════════════════════════
  const ROUTES = [
    { m: 'GET', p: '/status' }, { m: 'GET', p: '/connect' }, { m: 'POST', p: '/disconnect' },
    { m: 'GET', p: '/spaces' }, { m: 'GET', p: '/messages', query: SP }, { m: 'POST', p: '/messages', body: { space: 'spaces/AAA1', text: 'hi' } },
  ];
  const go = (r, prefix, token) => call(r.m, prefix + r.p, { token, query: r.query, body: r.body });
  const refusals = [];
  const refused = [];
  for (const r of ROUTES) {
    const outs = [await go(r, A), await go(r, E), await go(r, A, tok.Ana), await go(r, E, 'adm')];   // nobody, nobody, a team member's token on the administrator's, the other way about
    refusals.push(...outs);
    if (outs.some(o => o.status !== 401)) refused.push(`${r.m} ${r.p}: ${outs.map(o => o.status).join('/')}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token', refused.length === 0, refused.join('; '));
  const none = [];
  for (const r of ROUTES) { const o = await go(r, E, tok.Cy); refusals.push(o); if (o.status !== 403) none.push(`${r.m} ${r.p}: ${o.status}`); }
  check('a team member with the section off is refused every route (403)', none.length === 0, none.join('; '));
  const lone = [];
  const expect = {
    // gchat.view reads the status, the spaces and the messages — and links and lets go: there is no grant of its own for either
    Onlyview: { 'GET /status': 200, 'GET /connect': 302, 'GET /spaces': 200, 'GET /messages': 200, 'POST /messages': 403, 'POST /disconnect': 200 },
    // gchat.send sends, and reads nothing
    Onlysend: { 'GET /status': 403, 'GET /connect': 403, 'GET /spaces': 403, 'GET /messages': 403, 'POST /messages': 200, 'POST /disconnect': 403 },
  };
  for (const [who, routes] of Object.entries(expect)) {
    for (const [key, want] of Object.entries(routes)) {
      const r = ROUTES.find(x => x.m + ' ' + x.p === key);
      const o = await go(r, E, tok[who]);
      if (o.status === 403) refusals.push(o);
      if (o.status !== want) lone.push(`${who} ${key}: ${o.status} (wanted ${want})`);
    }
  }
  check('each grant is its own: gchat.view reads, links and lets go (there is no grant of its own for that), gchat.send sends and reads nothing', lone.length === 0, lone.join('; '));
  check('…and a refusal is always the one plain answer, { error } and nothing else', refusals.length > 30 && refusals.every(r => plainError(r.data)), refusals.filter(r => !plainError(r.data)).map(r => `${r.status} ${r.text}`).slice(0, 3).join(' | '));
  check('…the section off says "Not permitted"; no session says it is not signed in', refusals.filter(r => r.status === 403).every(r => r.data.error === 'Not permitted') && refusals.filter(r => r.status === 401).every(r => typeof r.data.error === 'string' && r.data.error !== 'Not permitted'));
  const adminAll = [];
  for (const r of ROUTES.filter(x => x.p !== '/disconnect')) { const o = await go(r, A, 'adm'); if (![200, 302].includes(o.status)) adminAll.push(`${r.m} ${r.p}: ${o.status}`); }
  check('the administrator holds every grant: no route of theirs refuses them', adminAll.length === 0, adminAll.join('; '));
  reset();

  // ═══ What a link says of itself ══════════════════════════════════════════════
  const flags = await me('adm');
  check('the rail is told Chat is here: the gchat flag of /api/v1/me is on (and the only flag there is)', flags.flags.gchat === true && Object.keys(flags.flags).join() === 'gchat', JSON.stringify(flags.flags));
  const adm = await call('GET', A + '/status', { token: 'adm' });
  const ana = await call('GET', E + '/status', { token: tok.Ana });
  check('a link made with everything asked for says whose it is and that it reaches spaces, reading and sending — the administrator\'s and a team member\'s alike',
    same(adm.data, { configured: true, connected: true, email: 'boss@motolinker.test', name: 'The Boss', caps: { spaces: true, read: true, send: true } })
    && same(ana.data, { configured: true, connected: true, email: 'ana@motolinker.test', name: 'Ana A.', caps: { spaces: true, read: true, send: true } }) && shape(S.GchatStatus, adm.data) === true && shape(S.GchatStatus, ana.data) === true, JSON.stringify([adm.data, ana.data]));
  const caps = {};
  for (const n of ['Dee', 'Eli', 'Fay', 'Nia', 'Pip', 'Quin', 'Sol']) caps[n] = (await call('GET', E + '/status', { token: tok[n] })).data;
  const ca = n => `${caps[n].caps.spaces ? 'S' : '-'}${caps[n].caps.read ? 'R' : '-'}${caps[n].caps.send ? 'W' : '-'}`;
  check('what a link reaches is what Google granted, not what was asked: a read-only grant reads and cannot send, a send-only grant sends and cannot read, "messages" is both, a grant that was never recorded reaches nothing, and so does one with none of Chat\'s boxes ticked',
    ca('Dee') === 'SR-' && ca('Eli') === 'S-W' && ca('Fay') === 'SRW' && ca('Nia') === '---' && ca('Pip') === '---', ['Dee', 'Eli', 'Fay', 'Nia', 'Pip'].map(n => n + ' ' + ca(n)).join(' '));
  check('…the grant under its other name (granted_scopes) counts the same', ca('Quin') === 'S-W');
  check('…and the spaces scope that is not the read-only one (chat.spaces, which Google grants for more than reading) reaches the spaces as well', ca('Sol') === 'SR-', 'Sol ' + ca('Sol'));
  check('…every one of those answers is the shape the contract says (a link that is made always says what it reaches)', Object.values(caps).every(d => shape(S.GchatStatus, d) === true) && shape(S.GchatStatus, { configured: true, connected: true, email: 'x@y.z' }) !== true);
  const ben = await call('GET', E + '/status', { token: tok.Ben });
  const ivy = await call('GET', E + '/status', { token: tok.Ivy });
  check('a team member who never linked Chat (no row), or whose row was left empty by a disconnect, is "configured, not connected"', same(ben.data, { configured: true, connected: false }) && same(ivy.data, { configured: true, connected: false }) && shape(S.GchatStatus, ivy.data) === true);
  check('nobody sees another\'s link: each status is its owner\'s alone', new Set([adm.data.email, ana.data.email, caps.Dee.email, caps.Eli.email]).size === 4);

  // ═══ Going to Google ═════════════════════════════════════════════════════════
  const connectA = await call('GET', A + '/connect', { query: '_t=adm' });
  const ua = connectA.location ? new URL(connectA.location) : null;
  check('connecting sends the browser to Google\'s consent screen — the token in the address is the session (a page change cannot carry a header)',
    connectA.status === 302 && ua && ua.origin + ua.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', `${connectA.status} ${connectA.location}`);
  check('…it asks as Chat\'s own client' + (MODE === 'fallback' ? ' — which, with none of its own, is the app\'s' : '') + ', for a way back to the one callback, a code, offline access, the consent screen every time, and ' + (MODE === 'noread' ? 'the spaces and the right to send, but not to read messages (reading is switched off), beside who they are' : 'the spaces, the right to send AND to read messages, beside who they are'),
    ua && ua.searchParams.get('client_id') === CLIENT[0] && ua.searchParams.get('redirect_uri') === APP + '/api/email/callback' && ua.searchParams.get('response_type') === 'code'
    && ua.searchParams.get('access_type') === 'offline' && ua.searchParams.get('prompt') === 'consent' && ua.searchParams.get('scope') === (MODE === 'noread' ? SCOPE_NO_READ : SCOPE_ASKED), ua && ua.searchParams.get('scope'));
  const connectB = await call('GET', A + '/connect', { query: '_t=adm' });
  const stateA = ua.searchParams.get('state'), stateB = new URL(connectB.location).searchParams.get('state');
  check('…and a state nobody could guess, a new one each time (it is how the way back knows the return is one this server asked for)', /^[0-9a-f]{32}$/.test(stateA) && /^[0-9a-f]{32}$/.test(stateB) && stateA !== stateB);
  const connectE = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const ue = new URL(connectE.location);
  check('a token that is no session is a 401 there as anywhere; a team member\'s connect is the same consent screen, the same scopes, a state of its own',
    (await call('GET', A + '/connect', { query: '_t=nope' })).status === 401 && connectE.status === 302 && ue.searchParams.get('scope') === ua.searchParams.get('scope') && ue.searchParams.get('client_id') === CLIENT[0]
    && ue.searchParams.get('redirect_uri') === APP + '/api/email/callback' && /^[0-9a-f]{32}$/.test(ue.searchParams.get('state')) && ue.searchParams.get('state') !== stateA, `${connectE.status}`);

  if (MODE === 'noread') {
    const back = await callbackOf('c-noread', stateA);
    await settle();
    const nowA = await call('GET', A + '/status', { token: 'adm' });
    check('with reading switched off, what Google grants is what the link reaches: spaces and sending, and not messages', back.location === '/dashboard#gchat' && same(nowA.data.caps, { spaces: true, read: false, send: true }), JSON.stringify(nowA.data));
    const failed = results.filter(r => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }

  // ═══ The round trip ═════════════════════════════════════════════════════════
  reset();
  const back = await callbackOf('the-code', stateA);
  check('Google sends the browser back to the one callback, and the administrator lands on Google Chat (a 302 to the page\'s own address)', back.status === 302 && back.location === '/dashboard#gchat', `${back.status} ${back.location}`);
  check('…the code was traded for tokens (Chat\'s client id and secret, the same way back, the authorisation grant), and who the person is was asked of Google with the new access token',
    google.token.length === 1 && google.token[0].code === 'the-code' && google.token[0].client_id === CLIENT[0] && google.token[0].client_secret === CLIENT[1]
    && google.token[0].redirect_uri === APP + '/api/email/callback' && google.token[0].grant_type === 'authorization_code' && google.userinfo[0].auth === 'Bearer granted-at', JSON.stringify(google.token));
  await settle();
  const rowA = rowOf('admin_gchat');
  check('…and the link is kept where a restart finds it (google_tokens), with who it is, when the access token runs out and what Google actually granted — it replaced the old one',
    rowA.tokens && rowA.tokens.access_token === 'granted-at' && rowA.tokens.refresh_token === 'granted-rt' && rowA.tokens.email === 'granted@motolinker.test' && rowA.tokens.name === 'Granted G.'
    && rowA.tokens.scope === SCOPE_ASKED && rowA.tokens.expiry_date > Date.now() + 3000000 && T.google_tokens.filter(r => r.user_key === 'admin_gchat').length === 1, JSON.stringify(rowA.tokens));
  const nowA = await call('GET', A + '/status', { token: 'adm' });
  check('the administrator is linked as the account Google named', same(nowA.data, { configured: true, connected: true, email: 'granted@motolinker.test', name: 'Granted G.', caps: { spaces: true, read: true, send: true } }), JSON.stringify(nowA.data));
  check('…Chat is not Gmail or Drive: the same return made neither', !rowOf('admin_gmail') && !rowOf('admin_drive') && !T.google_tokens.some(r => /_(gmail|drive)$/.test(r.user_key)), JSON.stringify(T.google_tokens.map(r => r.user_key)));

  reset();
  const rtE = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const backE = await callbackOf('the-code', stateOf(rtE));
  await settle();
  check('a team member lands on the team portal\'s Google Chat, and the link is their own (their id\'s row), replacing the empty one a disconnect had left',
    backE.status === 302 && backE.location === '/employee#gchat' && rowOf('3_gchat').tokens.access_token === 'granted-at' && T.google_tokens.filter(r => r.user_key === '3_gchat').length === 1, `${backE.status} ${backE.location}`);
  const benNow = await call('GET', E + '/status', { token: tok.Ben });
  const anaStill = await call('GET', E + '/status', { token: tok.Ana });
  check('…Ben is linked and Ana\'s link is what it was', benNow.data.connected === true && benNow.data.email === 'granted@motolinker.test' && anaStill.data.email === 'ana@motolinker.test');

  // a grant that Google narrowed is what the link reaches
  reset();
  google.reply.token = () => jsonReply({ access_token: 'narrow-at', refresh_token: 'narrow-rt', expires_in: 3600, scope: `${CHAT}.spaces.readonly ${CHAT}.messages.readonly ${PROFILE}`, token_type: 'Bearer' });
  const beginNarrow = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ivy) });
  await callbackOf('c-narrow', stateOf(beginNarrow));
  await settle();
  const ivyNow = await call('GET', E + '/status', { token: tok.Ivy });
  check('a consent with the box for sending left unticked comes back as a link that reads and cannot send — what Google granted is kept, not what was asked', same(ivyNow.data.caps, { spaces: true, read: true, send: false }) && rowOf('10_gchat').tokens.scope === `${CHAT}.spaces.readonly ${CHAT}.messages.readonly ${PROFILE}`, JSON.stringify(ivyNow.data));

  // a grant that Google says nothing of is not taken to be what was asked
  reset();
  google.reply.token = () => jsonReply({ access_token: 'silent-at', refresh_token: 'silent-rt', expires_in: 3600, token_type: 'Bearer' });
  const beginSilent = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Zed) });
  await callbackOf('c-silent', stateOf(beginSilent));
  await settle();
  const zedNow = await call('GET', E + '/status', { token: tok.Zed });
  check('a consent that comes back with no word of its scope is a link that reaches nothing (it is not taken to be what was asked), and what is kept says so', zedNow.data.connected === true && same(zedNow.data.caps, { spaces: false, read: false, send: false }) && rowOf('27_gchat').tokens.scope === '' && rowOf('27_gchat').tokens.access_token === 'silent-at', JSON.stringify([zedNow.data, rowOf('27_gchat')]));

  // a state is good once; a return this server did not ask for is turned away and nothing is traded or kept
  reset();
  const replay = await callbackOf('the-code', stateA);
  const noState = await callbackOf('a-code-from-somewhere-else');
  const strange = await callbackOf('a-code-from-somewhere-else', 'f'.repeat(32));
  const adminAfter = await call('GET', A + '/status', { token: 'adm' });
  check('a return this server did not ask for — no state, a state it never handed out, or one already used — is turned away (400), Google is not asked to trade its code, and the link is as it was',
    [replay, noState, strange].every(r => r.status === 400 && /not one this server handed out/.test(r.text)) && google.token.length === 0 && google.userinfo.length === 0 && adminAfter.data.email === 'granted@motolinker.test' && rowOf('admin_gchat').tokens.access_token === 'granted-at',
    [replay, noState, strange].map(r => `${r.status} ${r.text.slice(0, 40)}`).join(' | '));
  const noCode = await call('GET', '/api/email/callback', { query: 'state=whatever' });
  check('a way back without a code is turned away (400)', noCode.status === 400 && /No code provided/.test(noCode.text), `${noCode.status} ${noCode.text}`);
  // the Drive state and the Chat state are not the same thing
  reset();
  const driveBegin = await call('GET', '/api/drive/connect', { query: '_t=adm' });
  const driveBack = await callbackOf('drive-code', stateOf(driveBegin));
  await settle();
  check('a state handed out for Drive links Drive and not Chat (the flows are told apart by their state)', driveBack.location === '/dashboard#drive' && !!rowOf('admin_drive') && rowOf('admin_gchat').tokens.access_token === 'granted-at', `${driveBack.location}`);
  // Google says no: the person is sent back to Chat with the reason in the address
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
  const beginBad = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Jo) });
  const badBack = await callbackOf('stale', stateOf(beginBad));
  check('when Google will not trade the code, the person goes back to the team portal with the reason in the address (?gchat_error=…#gchat) and nothing is kept',
    badBack.status === 302 && badBack.location === '/employee?gchat_error=' + encodeURIComponent('Bad Request') + '#gchat' && !rowOf('11_gchat') && (await call('GET', E + '/status', { token: tok.Jo })).data.connected === false, `${badBack.status} ${badBack.location}`);
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_scope', error_description: 'invalid_scope: Some requested scopes cannot be shown' }, 400);
  const beginScope = await call('GET', A + '/connect', { query: '_t=adm' });
  const scopeBack = await callbackOf('stale', stateOf(beginScope));
  const sentence = 'Google rejected the Chat permissions. Enable the Google Chat API and add the chat.* scopes to the OAuth consent screen.';
  check('…the administrator\'s goes back to /dashboard, and a refusal for scopes (the Chat API not enabled, a scope missing from the consent screen) is told in a sentence that says what to do',
    scopeBack.status === 302 && scopeBack.location === '/dashboard?gchat_error=' + encodeURIComponent(sentence) + '#gchat' && (await call('GET', A + '/status', { token: 'adm' })).data.email === 'granted@motolinker.test', `${scopeBack.status} ${scopeBack.location}`);
  reset();
  google.reply.token = () => jsonReply({ error: 'access_denied' }, 400);
  const beginNone = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Jo) });
  const noneBack = await callbackOf('stale', stateOf(beginNone));
  check('…and when Google gives no reason either, the words are "No access token"', noneBack.location === '/employee?gchat_error=' + encodeURIComponent('No access token') + '#gchat', noneBack.location);
  reset();
  const ODD = 'Too many requests & "bad" things? a=b #1 — ünï';
  google.reply.token = () => jsonReply({ error: 'x', error_description: ODD }, 400);
  const beginOdd = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Jo) });
  const oddBack = await callbackOf('stale', stateOf(beginOdd));
  const oddUrl = new URL(oddBack.location, 'https://app.example.com');
  check('…whatever Google\'s words are made of (an ampersand, a hash, an equals sign, a question mark, quotes, letters beyond ASCII) they come back whole in the one parameter, and the way back is still to the screen',
    oddUrl.pathname === '/employee' && oddUrl.hash === '#gchat' && oddUrl.searchParams.get('gchat_error') === ODD && [...oddUrl.searchParams.keys()].length === 1, oddBack.location);
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
  check('two people on Google\'s consent screen at once, coming back in the other order, each land on their own link', backJo.location === '/employee#gchat' && backKai.location === '/employee#gchat' && sJo.data.email === 'jo@motolinker.test' && sKai.data.email === 'kai@motolinker.test', `${sJo.data.email} ${sKai.data.email}`);

  // ═══ The spaces ═════════════════════════════════════════════════════════════
  reset();
  const spA = await call('GET', A + '/spaces', { token: 'adm' });
  check('the spaces are a line for each, in the order Chat gave, with what to call them (a space\'s name; "Direct message" for a conversation of two; "Untitled space" for a group with no name) and Chat\'s word for the kind (its older word where that is all it gave; nothing where it gave none)',
    spA.status === 200 && shape(S.GchatSpaceList, spA.data) === true && same(spA.data, { spaces: [
      { name: 'spaces/AAA1', title: 'Sales team', type: 'SPACE' }, { name: 'spaces/BBB2', title: 'Direct message', type: 'DIRECT_MESSAGE' }, { name: 'spaces/CCC3', title: 'Untitled space', type: 'GROUP_CHAT' },
      { name: 'spaces/DDD4', title: 'Old room', type: 'ROOM' }, { name: 'spaces/EEE5', title: 'No kind', type: '' }] }), JSON.stringify(spA.data));
  const s1 = chat.spaces[0];
  check('…asked of Chat as the administrator\'s own account, for up to 100', chat.spaces.length === 1 && s1.auth === 'Bearer granted-at' && s1.url.searchParams.get('pageSize') === '100', JSON.stringify(chat.spaces.map(x => x.url.search)));
  reset();
  const spE = await call('GET', E + '/spaces', { token: tok.Dee });
  check('a team member\'s spaces are the same call with their own account — not the administrator\'s', spE.status === 200 && spE.data.spaces.length === 5 && chat.spaces[0].auth === 'Bearer dee-at');
  reset();
  chat.reply.spaces = () => jsonReply({});
  const spEmpty = await call('GET', A + '/spaces', { token: 'adm' });
  check('an account with no spaces gets an empty list (Chat leaves the list out)', spEmpty.status === 200 && same(spEmpty.data, { spaces: [] }) && shape(S.GchatSpaceList, spEmpty.data) === true);
  const says = [];
  for (const [what, reply, want] of [
    ['a 403', () => jsonReply({ error: { code: 403, message: 'Google Chat API has not been used in project 1 before.' } }, 403), { error: 'forbidden', detail: 'Google Chat API has not been used in project 1 before.' }],
    ['a 401', () => jsonReply({ error: { code: 401, message: 'Invalid Credentials' } }, 401), { error: 'reconnect', detail: 'Invalid Credentials' }],
    ['a 500', () => jsonReply({ error: { code: 500, message: 'Backend Error' } }, 500), { error: 'failed', detail: 'Backend Error' }],
    ['an answer with no reason', () => new Response('<html>oops</html>', { status: 502 }), { error: 'failed', detail: 'HTTP 502' }],
    ['no answer at all', () => { throw new Error('socket hang up'); }, { error: 'failed', detail: 'socket hang up' }],
  ]) {
    reset(); chat.reply.spaces = reply;
    const r = await call('GET', E + '/spaces', { token: tok.Ana });
    if (r.status !== 200 || !same(r.data, { spaces: [], ...want }) || shape(S.GchatSpaceList, r.data) !== true) says.push(`${what}: ${r.status} ${r.text}`);
  }
  check('when Chat says no, the list is empty and the reason is beside it, in a 200 — forbidden (403), reconnect (401), failed (anything else, even an answer that is not JSON or none at all), with Google\'s own words as the detail', says.length === 0, says.join(' | '));
  reset();
  const spNone = await call('GET', E + '/spaces', { token: tok.Una });
  check('a person with no link who asks for the spaces is told so (not connected), and Chat is not asked', same(spNone.data, { spaces: [], error: 'not_connected' }) && spNone.status === 200 && chat.spaces.length === 0, JSON.stringify(spNone.data));

  // ═══ The messages of a space ═════════════════════════════════════════════════
  reset();
  const msA = await call('GET', A + '/messages', { token: 'adm', query: SP });
  check('a space\'s messages are a line for each, oldest first (Chat gives the newest first), each with its address, its words, who wrote it as Chat names them and when — a message with no words and nobody named has empty text, not nothing',
    msA.status === 200 && shape(S.GchatMessageList, msA.data) === true && same(msA.data, { messages: [
      { id: 'spaces/AAA1/messages/m1', text: '', senderName: '', senderId: '', createTime: '2026-10-20T10:01:00Z' },
      { id: 'spaces/AAA1/messages/m2', text: 'Second, from Ana', senderName: 'Ana A.', senderId: 'users/11', createTime: '2026-10-20T10:02:00Z' },
      { id: 'spaces/AAA1/messages/m3', text: 'Third, from Bo', senderName: 'Bo B.', senderId: 'users/22', createTime: '2026-10-20T10:03:00Z' }] }), JSON.stringify(msA.data));
  const m1 = chat.messages[0];
  check('…asked of Chat for that space as the administrator\'s own account: the 50 newest', chat.messages.length === 1 && m1.space === 'spaces/AAA1' && m1.auth === 'Bearer granted-at' && m1.url.searchParams.get('pageSize') === '50' && m1.url.searchParams.get('orderBy') === 'createTime desc', JSON.stringify(chat.messages.map(x => x.url.search)));
  reset();
  const msE = await call('GET', E + '/messages', { token: tok.Dee, query: 'space=spaces%2FBBB2' });
  check('a team member\'s messages are the same call with their own account, for the space they asked for', msE.status === 200 && msE.data.messages.length === 3 && chat.messages[0].space === 'spaces/BBB2' && chat.messages[0].auth === 'Bearer dee-at');
  const badSpaces = [];
  for (const q of ['', 'space=', 'space=spaces%2F', 'space=AAA1', 'space=spaces%2FAAA%201', 'space=..%2Fspaces%2FAAA1', 'space=spaces%2FAAA1%2Fmessages', 'space=spaces%2FAAA1%3Fx%3D1', 'space=spaces%2FAAA1%0A', 'space=spacesAAA1', 'space=Spaces%2FAAA1', 'space=%2Fspaces%2FAAA1', 'space=spaces%2Fa.b', 'space=spaces%2Fa%2Bb']) {
    reset();
    const r = await call('GET', E + '/messages', { token: tok.Ana, query: q });
    if (r.status !== 200 || !same(r.data, { messages: [], error: 'bad_space' }) || chat.messages.length) badSpaces.push(q || '(none)');
  }
  check('only an address of the shape spaces/<letters, digits, - or _> is asked of Chat — anything else (none, a path, a query, a line break, a dot) is "bad space" in a 200, and Chat is not asked', badSpaces.length === 0, badSpaces.join(' | '));
  const goodSpaces = [];
  for (const id of ['AAA1', 'abc', 'XYZ', '0123', 'a-b', 'a_b', 'A-1_z']) {
    reset();
    const r = await call('GET', E + '/messages', { token: tok.Ana, query: 'space=' + encodeURIComponent('spaces/' + id) });
    if (r.status !== 200 || r.data.error || chat.messages.length !== 1 || chat.messages[0].space !== 'spaces/' + id) goodSpaces.push(id);
  }
  check('…and an address of letters of either case, digits, - and _ is, whichever of them it is made of', goodSpaces.length === 0, goodSpaces.join(' | '));
  const says2 = [];
  for (const [what, reply, want] of [
    ['a 403', () => jsonReply({ error: { code: 403, message: 'The caller does not have permission' } }, 403), { error: 'forbidden', detail: 'The caller does not have permission' }],
    ['a 401', () => jsonReply({ error: { code: 401, message: 'Invalid Credentials' } }, 401), { error: 'reconnect', detail: 'Invalid Credentials' }],
    ['a 404', () => jsonReply({ error: { code: 404, message: 'Requested entity was not found.' } }, 404), { error: 'failed', detail: 'Requested entity was not found.' }],
    ['no answer at all', () => { throw new Error('socket hang up'); }, { error: 'failed', detail: 'socket hang up' }],
  ]) {
    reset(); chat.reply.messages = reply;
    const r = await call('GET', A + '/messages', { token: 'adm', query: SP });
    if (r.status !== 200 || !same(r.data, { messages: [], ...want }) || shape(S.GchatMessageList, r.data) !== true) says2.push(`${what}: ${r.status} ${r.text}`);
  }
  check('when Chat says no to the messages, the list is empty and the reason is beside it, in a 200, as it is for the spaces', says2.length === 0, says2.join(' | '));
  reset();
  chat.reply.messages = () => jsonReply({});
  const msEmpty = await call('GET', A + '/messages', { token: 'adm', query: SP });
  check('a space with no messages gets an empty list (Chat leaves the list out)', msEmpty.status === 200 && same(msEmpty.data, { messages: [] }));
  reset();
  chat.reply.messages = () => jsonReply({ messages: [{ name: 'spaces/AAA1/messages/c1', fallbackText: 'Card fallback', sender: { name: 'users/9' }, updateTime: '2026-10-20T10:09:00Z' }] });
  const cardMsgs = await call('GET', A + '/messages', { token: 'adm', query: SP });
  check('a message of a card (no words of its own, no name for who wrote it, no creation time) is a line with nothing in those places — not its fallback, not its update time', same(cardMsgs.data, { messages: [{ id: 'spaces/AAA1/messages/c1', text: '', senderName: '', senderId: 'users/9', createTime: '' }] }) && shape(S.GchatMessageList, cardMsgs.data) === true, JSON.stringify(cardMsgs.data));
  reset();
  const msEli = await call('GET', E + '/messages', { token: tok.Eli, query: SP });
  check('(the route does not look at what a link reaches — a link granted no reading is still asked, and Chat\'s answer is what comes back; it is the page that does not ask)', msEli.status === 200 && chat.messages.length === 1 && chat.messages[0].auth === 'Bearer eli-at');
  reset();
  const msNone = await call('GET', E + '/messages', { token: tok.Una, query: SP });
  check('a person with no link who asks for messages is told so (not connected), and Chat is not asked', same(msNone.data, { messages: [], error: 'not_connected' }) && chat.messages.length === 0);

  // ═══ Sending ═════════════════════════════════════════════════════════════════
  reset();
  const sendA = await call('POST', A + '/messages', { token: 'adm', body: { space: 'spaces/AAA1', text: '  Yes, by Friday.  ' } });
  check('a message is sent as the administrator\'s own account to the space, trimmed, and the id Chat gave it comes back',
    sendA.status === 200 && same(sendA.data, { ok: true, id: 'spaces/AAA1/messages/new1' }) && shape(S.GchatSent, sendA.data) === true && chat.post.length === 1 && chat.post[0].space === 'spaces/AAA1'
    && chat.post[0].auth === 'Bearer granted-at' && chat.post[0].type === 'application/json' && same(chat.post[0].body, { text: 'Yes, by Friday.' }), JSON.stringify([sendA.data, chat.post]));
  reset();
  const sendE = await call('POST', E + '/messages', { token: tok.Eli, body: { space: 'spaces/BBB2', text: 'Hello' } });
  check('…a team member\'s is sent as their own account', sendE.status === 200 && sendE.data.ok === true && chat.post[0].auth === 'Bearer eli-at' && chat.post[0].space === 'spaces/BBB2');
  reset();
  const long = await call('POST', E + '/messages', { token: tok.Eli, body: { space: 'spaces/AAA1', text: 'x'.repeat(5000) } });
  check('…words past 4,000 characters are cut at 4,000, and what Chat is sent is only the words', long.status === 200 && chat.post[0].body.text === 'x'.repeat(4000) && same(Object.keys(chat.post[0].body), ['text']));
  const turned = [];
  for (const [what, body, error] of [['no space', { text: 'hi' }, 'bad_space'], ['a space that is not an address', { space: 'AAA1', text: 'hi' }, 'bad_space'], ['a path', { space: 'spaces/AAA1/messages', text: 'hi' }, 'bad_space'], ['no slash', { space: 'spacesAAA1', text: 'hi' }, 'bad_space'], ['another case', { space: 'Spaces/AAA1', text: 'hi' }, 'bad_space'], ['a dot', { space: 'spaces/a.b', text: 'hi' }, 'bad_space'], ['a line break', { space: 'spaces/AAA1\n', text: 'hi' }, 'bad_space'], ['a leading slash', { space: '/spaces/AAA1', text: 'hi' }, 'bad_space'], ['a prefix', { space: 'xspaces/AAA1', text: 'hi' }, 'bad_space'], ['nothing after the slash', { space: 'spaces/', text: 'hi' }, 'bad_space'], ['no words', { space: 'spaces/AAA1' }, 'empty'], ['only blanks', { space: 'spaces/AAA1', text: '  \n ' }, 'empty'], ['nothing', {}, 'bad_space']]) {
    reset();
    const a = await call('POST', A + '/messages', { token: 'adm', body });
    const e = await call('POST', E + '/messages', { token: tok.Ana, body });
    if (a.status !== 400 || e.status !== 400 || !same(a.data, { error }) || !same(e.data, { error }) || chat.post.length) turned.push(`${what}: ${a.status}/${e.status} ${a.text}`);
  }
  check('a message to no space, or to something that is not one, or with nothing to say is turned away in both portals (400, and why: bad_space or empty), and Chat is not asked', turned.length === 0, turned.join(' | '));
  const sentTo = [];
  for (const id of ['AAA1', 'abc', 'XYZ', '0123', 'a-b', 'a_b', 'A-1_z']) {
    reset();
    const a = await call('POST', A + '/messages', { token: 'adm', body: { space: 'spaces/' + id, text: 'hi' } });
    const e = await call('POST', E + '/messages', { token: tok.Ana, body: { space: 'spaces/' + id, text: 'hi' } });
    if (a.status !== 200 || e.status !== 200 || a.data.ok !== true || e.data.ok !== true || chat.post.length !== 2 || chat.post.some(p => p.space !== 'spaces/' + id)) sentTo.push(id);
  }
  check('…and a message to an address of letters of either case, digits, - and _ is sent, whichever of them it is made of', sentTo.length === 0, sentTo.join(' | '));
  const says3 = [];
  for (const [what, reply, want] of [
    ['a 403', () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, 403), { ok: false, error: 'forbidden', detail: 'Request had insufficient authentication scopes.' }],
    ['a 401', () => jsonReply({ error: { code: 401, message: 'Invalid Credentials' } }, 401), { ok: false, error: 'reconnect', detail: 'Invalid Credentials' }],
    ['a 500', () => jsonReply({ error: { code: 500, message: 'Backend Error' } }, 500), { ok: false, error: 'failed', detail: 'Backend Error' }],
    ['no answer at all', () => { throw new Error('socket hang up'); }, { ok: false, error: 'failed', detail: 'socket hang up' }],
  ]) {
    reset(); chat.reply.post = reply;
    const r = await call('POST', E + '/messages', { token: tok.Ana, body: { space: 'spaces/AAA1', text: 'hi' } });
    if (r.status !== 200 || !same(r.data, want) || shape(S.GchatSent, r.data) !== true) says3.push(`${what}: ${r.status} ${r.text}`);
  }
  check('when Chat says no to a send, the page is told in a 200: ok false, why (forbidden, reconnect, failed) and Google\'s own words', says3.length === 0, says3.join(' | '));
  reset();
  chat.reply.post = () => jsonReply({});
  const noId = await call('POST', E + '/messages', { token: tok.Ana, body: { space: 'spaces/AAA1', text: 'hi' } });
  check('(a send Chat accepts without naming it is still ok — the id is then missing)', noId.status === 200 && same(noId.data, { ok: true }) && shape(S.GchatSent, noId.data) === true, JSON.stringify(noId.data));
  reset();
  const noReach = await call('POST', E + '/messages', { token: tok.Pip, body: { space: 'spaces/AAA1', text: 'hi' } });
  check('(the route does not look at what a link reaches for a send either — a link granted nothing is still asked, and Chat\'s answer is what comes back; it is the page that does not offer to send)', noReach.status === 200 && noReach.data.ok === true && chat.post.length === 1 && chat.post[0].auth === 'Bearer pip-at');
  reset();
  const noneSend = await call('POST', E + '/messages', { token: tok.Una, body: { space: 'spaces/AAA1', text: 'hi' } });
  check('a person with no link who sends is told so (not connected), and Chat is not asked', noneSend.status === 200 && same(noneSend.data, { ok: false, error: 'not_connected' }) && chat.post.length === 0, JSON.stringify(noneSend.data));

  // ═══ A link that has run out ════════════════════════════════════════════════
  reset();
  // (what Google says of the renewed grant replaces what the link knew: here it has narrowed it)
  google.reply.token = () => jsonReply({ access_token: 'refreshed-at', expires_in: 3600, scope: `${CHAT}.spaces.readonly ${CHAT}.messages.readonly ${PROFILE}` });
  const gusSpaces = await call('GET', E + '/spaces', { token: tok.Gus });
  check('an access token that has run out is traded for a new one with the refresh token, by Chat\'s client — and Chat is asked with the new one',
    gusSpaces.status === 200 && gusSpaces.data.spaces.length === 5 && google.token.length === 1 && google.token[0].grant_type === 'refresh_token' && google.token[0].refresh_token === 'gus-at-refresh'
    && google.token[0].client_id === CLIENT[0] && google.token[0].client_secret === CLIENT[1] && chat.spaces[0].auth === 'Bearer refreshed-at', JSON.stringify(google.token));
  await settle();
  const rowGus = rowOf('8_gchat');
  check('…the new one is kept for a restart to find, with who the person is and the refresh token still there', rowGus.tokens.access_token === 'refreshed-at' && rowGus.tokens.refresh_token === 'gus-at-refresh' && rowGus.tokens.email === 'gus@motolinker.test' && rowGus.tokens.expiry_date > Date.now() + 3000000, JSON.stringify(rowGus.tokens));
  const gusStatus = await call('GET', E + '/status', { token: tok.Gus });
  check('…and what Google said of the grant when it renewed it is what the link now reaches (a grant that was narrowed can no longer send)', rowGus.tokens.scope === `${CHAT}.spaces.readonly ${CHAT}.messages.readonly ${PROFILE}` && same(gusStatus.data.caps, { spaces: true, read: true, send: false }), JSON.stringify(gusStatus.data));
  const gusMessages = await call('GET', E + '/messages', { token: tok.Gus, query: SP });
  check('…and it is not traded again while it holds — the messages are asked of Chat with it as it is', gusMessages.status === 200 && google.token.length === 1 && chat.messages[0].auth === 'Bearer refreshed-at');
  reset();
  google.reply.token = () => jsonReply({ access_token: 'refreshed-at' });   // (no lifetime this time)
  const tamSpaces = await call('GET', E + '/spaces', { token: tok.Tam });
  const vicSpaces = await call('GET', E + '/spaces', { token: tok.Vic });
  const wesSpaces = await call('GET', E + '/spaces', { token: tok.Wes });
  await settle();
  check('…a token with less than a minute left is renewed before it is used (it could run out on its way to Chat), and so is one whose expiry was never recorded',
    tamSpaces.status === 200 && vicSpaces.status === 200 && wesSpaces.status === 200 && same(google.token.map(b => b.refresh_token), ['tam-at-refresh', 'vic-at-refresh', 'wes-at-refresh']) && chat.spaces.length === 3 && chat.spaces.every(c => c.auth === 'Bearer refreshed-at'), JSON.stringify(google.token));
  const wesAt = rowOf('26_gchat').tokens.expiry_date - Date.now();
  check('…and when Google gives a renewed token no lifetime of its own it is taken to last an hour', wesAt > 3500000 && wesAt <= 3600000, String(wesAt));
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  const halBefore = await call('GET', E + '/status', { token: tok.Hal });
  const halSpaces = await call('GET', E + '/spaces', { token: tok.Hal });
  const halStatus = await call('GET', E + '/status', { token: tok.Hal });
  const halAgain = await call('GET', E + '/messages', { token: tok.Hal, query: SP });
  const halSend = await call('POST', E + '/messages', { token: tok.Hal, body: { space: 'spaces/AAA1', text: 'hi' } });
  check('a renewal that Google refuses (the grant was revoked, or an unverified app\'s week is up) is "reconnect": Chat is not asked, the status then says the link is lost, whose it was, and every route says reconnect — the link is only found to be lost when something asks',
    halBefore.data.connected === true && same(halSpaces.data, { spaces: [], error: 'reconnect' }) && same(halStatus.data, { configured: true, connected: false, reconnect: true, email: 'hal@motolinker.test' }) && shape(S.GchatStatus, halStatus.data) === true
    && same(halAgain.data, { messages: [], error: 'reconnect' }) && same(halSend.data, { ok: false, error: 'reconnect' }) && chat.spaces.length + chat.messages.length + chat.post.length === 0 && google.token.length === 1, JSON.stringify([halBefore.data, halSpaces.data, halStatus.data]));
  check('…and that is only known to the running app: what is kept for a restart is the link as it was (a restart tries Google again)', rowOf('9_gchat').tokens.dead === undefined && rowOf('9_gchat').tokens.access_token === 'hal-at', JSON.stringify(rowOf('9_gchat').tokens));
  reset();
  const beginHal = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Hal) });
  await callbackOf('c-hal', stateOf(beginHal));
  await settle();
  const halNow = await call('GET', E + '/status', { token: tok.Hal });
  const halWorks = await call('GET', E + '/spaces', { token: tok.Hal });
  check('…and connecting again replaces the lost link: it is linked, and Chat is asked with the new access token', halNow.data.connected === true && halNow.data.reconnect === undefined && halNow.data.email === 'granted@motolinker.test' && halWorks.data.spaces.length === 5 && chat.spaces[0].auth === 'Bearer granted-at', JSON.stringify(halNow.data));
  reset();
  const miaOpen = await call('GET', E + '/spaces', { token: tok.Mia });
  check('a lapsed access token with no refresh token is used as it is: Google is not asked to renew what cannot be renewed', miaOpen.status === 200 && google.token.length === 0 && chat.spaces[0].auth === 'Bearer mia-at', JSON.stringify(google.token));
  reset();
  google.reply.token = () => jsonReply({ error: 'temporarily_unavailable' }, 503);
  const raeOpen = await call('GET', E + '/spaces', { token: tok.Rae });
  const raeStatus = await call('GET', E + '/status', { token: tok.Rae });
  check('(a known gap: a renewal that fails for any reason but a grant that is gone is not reported — the old token is tried, and Chat\'s answer to it is what comes back; the link is not marked lost)',
    google.token.length === 1 && chat.spaces.length === 1 && chat.spaces[0].auth === 'Bearer rae-at' && raeOpen.status === 200 && raeStatus.data.connected === true && raeStatus.data.reconnect === undefined, `${raeOpen.status} ${JSON.stringify(raeStatus.data)}`);

  // ═══ Letting go ═════════════════════════════════════════════════════════════
  reset();
  const leoWas = await call('GET', E + '/status', { token: tok.Leo });
  const leoLet = await call('POST', E + '/disconnect', { token: tok.Leo });
  const leoStatus = await call('GET', E + '/status', { token: tok.Leo });
  const leoList = await call('GET', E + '/spaces', { token: tok.Leo });
  await settle();
  check('a member who lets go is unlinked at once — the link is forgotten in the app\'s memory as well as emptied in the table, and answers { ok: true }',
    leoWas.data.connected === true && leoLet.status === 200 && same(leoLet.data, { ok: true }) && shape(S.GoogleDisconnected, leoLet.data) === true && same(leoStatus.data, { configured: true, connected: false })
    && same(leoList.data, { spaces: [], error: 'not_connected' }) && chat.spaces.length === 0 && rowOf('13_gchat').tokens === null && T.google_tokens.filter(r => r.user_key === '13_gchat').length === 1, JSON.stringify([leoStatus.data, leoList.data]));
  check('…it is only the caller\'s own: the other people\'s links stand', ['2_gchat', '5_gchat', '6_gchat', '22_gchat'].every(k => rowOf(k) && rowOf(k).tokens && rowOf(k).tokens.access_token));
  const gone = await call('POST', A + '/disconnect', { token: 'adm' });
  const goneStatus = await call('GET', A + '/status', { token: 'adm' });
  const goneList = await call('GET', A + '/spaces', { token: 'adm' });
  await settle();
  check('the administrator lets go: the same', same(gone.data, { ok: true }) && same(goneStatus.data, { configured: true, connected: false }) && rowOf('admin_gchat').tokens === null && same(goneList.data, { spaces: [], error: 'not_connected' }), JSON.stringify([goneStatus.data, goneList.data]));
  const again = await call('POST', A + '/disconnect', { token: 'adm' });
  check('…and letting go of a link that is not there is as quiet as letting go of one that is', again.status === 200 && same(again.data, { ok: true }));

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (!MODE) {
    let bad = failed;
    for (const mode of ['off', 'word', 'noclient', 'noread', 'fallback']) {
      const un = spawnSync(process.execPath, [__filename, '--mode=' + mode], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
      console.log(`\n── ${mode} ──`);
      console.log(un.stdout.trim());
      if (un.status !== 0) { console.log(un.stderr.slice(-800)); bad++; }
    }
    process.exit(bad ? 1 : 0);
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
