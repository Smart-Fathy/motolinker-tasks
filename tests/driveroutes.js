// My Drive and My Sheets, as the server does them — in both portals, which write the same five routes twice: the administrator's at
// /api/drive/* and a team member's at /api/employee/drive/* (the Sheets page asks the same status, connect and disconnect as the
// Drive page, and reads the files of one kind: spreadsheets). The one road back from Google is shared: /api/email/callback is where
// every Google consent screen of the app — Drive, Gmail, Chat, Calendar, the team's Google sign-in — sends the browser, and it tells
// them apart by the `state` it handed out.
//
// The new app's two screens call these routes as they are: nothing is written twice that has to be unified for them, and the OAuth
// round trip has to go through the one callback Google has been told about. This holds what the screens may rely on: who may ask for
// what (each grant is its own: `drive.view` reads the status and the files, `drive.connect` links and unlinks the account,
// `sheets.view` reads the spreadsheets), the three states a link can be in and what makes a Drive link unable to upload, what the
// round trip to Google asks for and keeps, that a link is a person's own (nobody sees, lists or lets go of another's), what Google is
// asked for a listing and what happens when it says no — and that every answer is the shape packages/contracts says it is.
// Google is stood in for, so nothing here reaches the network. The upload helpers behind the client files are tests/drivetest.js.
const C = require('../packages/contracts');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const S = C.schemas;
const UNCONFIGURED = process.argv.includes('--unconfigured');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const APP = 'https://app.motolinker.test';
const FAR = Date.now() + 86400000;
const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const SCOPE_READONLY = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email';
const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size)';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const link = (access, email, name, over = {}) => ({ access_token: access, refresh_token: access + '-refresh', expiry_date: FAR, email, name, scope: SCOPE_DRIVE, ...over });

// The links that are made when the app starts (it reads them back from the database as it boots): a link is held in the app's
// memory and in the `google_tokens` table, which is what survives a restart. The people are told apart by what their link is:
//   Ana — a good one · Dee — read-only · Eli — all of Drive · Fay — no grant recorded · Gus — run out, and Google will renew it ·
//   Hal — run out, and Google will not · Ben — a row a disconnect emptied · Ivy — never linked · the three with one grant each —
//   a good link (so that what they are refused is the grant, not the link).
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [],
  google_tokens: [
    { user_key: 'admin_drive', tokens: link('adm-at', 'boss@motolinker.test', 'The Boss'), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '2_drive', tokens: link('ana-at', 'ana@motolinker.test', 'Ana A.'), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '8_drive', tokens: link('gus-at', 'gus@motolinker.test', 'Gus G.', { expiry_date: Date.now() - 3600000 }), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '9_drive', tokens: link('hal-at', 'hal@motolinker.test', 'Hal H.', { expiry_date: Date.now() - 3600000 }), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '21_drive', tokens: link('dv-at', 'dv@motolinker.test', 'Drive Viewer'), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '22_drive', tokens: link('dc-at', 'dc@motolinker.test', 'Drive Connector'), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '23_drive', tokens: link('sv-at', 'sv@motolinker.test', 'Sheets Viewer'), updated_at: '2026-10-01T00:00:00Z' },
    // a link made before uploads were asked for: Google says what it granted, and this grant cannot upload
    { user_key: '5_drive', tokens: link('dee-at', 'dee@motolinker.test', 'Dee D.', { scope: SCOPE_READONLY }), updated_at: '2026-10-01T00:00:00Z' },
    // the whole of Drive was granted: that can upload
    { user_key: '6_drive', tokens: link('eli-at', 'eli@motolinker.test', 'Eli E.', { scope: 'https://www.googleapis.com/auth/drive' }), updated_at: '2026-10-01T00:00:00Z' },
    // made before the grant was recorded: Google is left to be the judge, so it is let through
    { user_key: '7_drive', tokens: link('fay-at', 'fay@motolinker.test', 'Fay F.', { scope: undefined }), updated_at: '2026-10-01T00:00:00Z' },
    // a disconnect leaves a row with nothing in it; the app does not read that as a link
    { user_key: '3_drive', tokens: null, updated_at: '2026-10-01T00:00:00Z' },
    // two whose access tokens ran out: Ida has a refresh token (the spreadsheets renew it), Mia has none (there is nothing to renew with)
    { user_key: '14_drive', tokens: link('ida-at', 'ida@motolinker.test', 'Ida I.', { expiry_date: Date.now() - 3600000 }), updated_at: '2026-10-01T00:00:00Z' },
    { user_key: '15_drive', tokens: link('mia-at', 'mia@motolinker.test', 'Mia M.', { expiry_date: Date.now() - 3600000, refresh_token: undefined }), updated_at: '2026-10-01T00:00:00Z' },
    // one who will let go of theirs, to see that it is gone at once (in the app's memory, not only in the table)
    { user_key: '13_drive', tokens: link('leo-at', 'leo@motolinker.test', 'Leo L.'), updated_at: '2026-10-01T00:00:00Z' },
  ],
});
db.install();

// Google, stood in for: what it was asked and what it answers next.
const google = { token: [], userinfo: [], files: [], reply: {} };
const reset = () => { google.token.length = 0; google.userinfo.length = 0; google.files.length = 0; google.reply = {}; };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    const body = JSON.parse(init.body); google.token.push(body);
    if (google.reply.token) return google.reply.token(body);
    return jsonReply(body.grant_type === 'refresh_token'
      ? { access_token: 'refreshed-at', expires_in: 3600 }
      : { access_token: 'granted-at', refresh_token: 'granted-rt', expires_in: 3600, scope: SCOPE_DRIVE, token_type: 'Bearer' });
  }
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
    google.userinfo.push({ auth: (init.headers || {}).Authorization });
    return jsonReply(google.reply.userinfo || { email: 'granted@motolinker.test', name: 'Granted G.' });
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
    google.files.push({ url: new URL(url), auth: (init.headers || {}).Authorization });
    if (google.reply.files) return google.reply.files();
    return jsonReply({ files: [
      { id: 'f1', name: 'Price list.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-10-20T09:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/f1/view', iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/x', size: '20480' },
      { id: 'f2', name: 'Stock count', mimeType: SHEET, modifiedTime: '2026-10-19T09:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/f2/edit', iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/y' },
      { id: 'f3', name: 'Shared with nobody', mimeType: 'application/pdf', modifiedTime: '2026-10-18T09:00:00.000Z' },
    ] });
  }
  return realFetch(input, init);
};

(async () => {
  const base = await bootApp({ port: process.env.PORT || (UNCONFIGURED ? 4022 : 4021), env: UNCONFIGURED
    ? { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', APP_URL: APP }
    : { GOOGLE_CLIENT_ID: 'client-123', GOOGLE_CLIENT_SECRET: 'secret-456', APP_URL: APP } });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const person = (id, name, perms) => ({
    id, name, username: name.toLowerCase(), email: '', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), job_title: 'Ops',
    permissions: perms, avatar_url: '', status_text: '', status_emoji: '',
  });
  const all = { drive: true, sheets: true, driveActions: { view: true, connect: true }, sheetsActions: { view: true } };
  const only = (section, action) => ({ drive: true, sheets: true, driveActions: { view: false, connect: false }, sheetsActions: { view: false }, [section + 'Actions']: { ...(section === 'drive' ? { view: false, connect: false } : { view: false }), [action]: true } });
  T.employees.push(
    person(2, 'Ana', all), person(3, 'Ben', all), person(4, 'Cy', { drive: false, sheets: false }),
    person(5, 'Dee', all), person(6, 'Eli', all), person(7, 'Fay', all),
    person(8, 'Gus', all), person(9, 'Hal', all), person(10, 'Ivy', all), person(11, 'Jo', all), person(12, 'Kai', all), person(13, 'Leo', all), person(14, 'Ida', all), person(15, 'Mia', all),
    person(21, 'Onlydriveview', only('drive', 'view')),
    person(22, 'Onlydriveconnect', only('drive', 'connect')),
    person(23, 'Onlysheetsview', only('sheets', 'view')),
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
  const A = '/api/drive', E = '/api/employee/drive';
  const tok = {};
  for (const n of ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Leo', 'Ida', 'Mia', 'Onlydriveview', 'Onlydriveconnect', 'Onlysheetsview']) tok[n] = await signIn(n);
  const plainError = d => !!d && typeof d.error === 'string' && Object.keys(d).length === 1;
  const saved = async key => { for (let i = 0; i < 40; i++) { const r = T.google_tokens.find(x => x.user_key === key); if (r) return r; await new Promise(r2 => setTimeout(r2, 25)); } return null; };
  const settle = () => new Promise(r => setTimeout(r, 120));

  // ═══ A Google project that is not set up here ═══════════════════════════════
  if (UNCONFIGURED) {
    const a = await call('GET', A + '/status', { token: 'adm' });
    const e = await call('GET', E + '/status', { token: tok.Ana });
    check('with no Google project set up, both portals say so (not configured, and nothing else)', same(a.data, { configured: false }) && same(e.data, { configured: false }) && shape(S.DriveStatus, a.data) === true);
    const ca = await call('GET', A + '/connect', { token: 'adm' });
    const ce = await call('GET', E + '/connect', { token: tok.Ana });
    check('…and there is nothing to connect to: the connect route says the client id is missing (400)', ca.status === 400 && /GOOGLE_CLIENT_ID not configured/.test(ca.text) && ce.status === 400 && /GOOGLE_CLIENT_ID not configured/.test(ce.text), `${ca.status} ${ce.status}`);
    const failed = results.filter(r => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }

  check('the administrator\'s link, read from the table as the app starts, is the one the upload code reads from the shared context too', !!ctx.driveTokens && ctx.driveTokens.access_token === 'adm-at', JSON.stringify(ctx.driveTokens));

  // ═══ Who may ask ═════════════════════════════════════════════════════════════
  // (disconnect comes last, wherever a link has to be there for the others to be asked of Google)
  const ROUTES = [['GET', '/status'], ['GET', '/connect'], ['GET', '/files'], ['GET', '/sheets'], ['POST', '/disconnect']];
  const refusals = [];   // every 401 and 403 seen, to hold them to one shape
  const refused = [];
  for (const [m, p] of ROUTES) {
    const a = await call(m, A + p);
    const b = await call(m, E + p);
    const c = await call(m, A + p, { token: tok.Ana });    // a team member's token is not the administrator's
    const d = await call(m, E + p, { token: 'adm' });      // …nor the other way about
    refusals.push(a, b, c, d);
    if (a.status !== 401 || b.status !== 401 || c.status !== 401 || d.status !== 401) refused.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token', refused.length === 0, refused.join('; '));
  const none = [];
  for (const [m, p] of ROUTES) { const r = await call(m, E + p, { token: tok.Cy }); refusals.push(r); if (r.status !== 403) none.push(`${m} ${p}: ${r.status}`); }
  check('a team member with the sections off is refused every route (403)', none.length === 0, none.join('; '));
  const lone = [];
  const answered = {};
  const expect = {
    Onlydriveview: { '/status': 200, '/connect': 403, '/files': 200, '/sheets': 403, '/disconnect': 403 },
    Onlydriveconnect: { '/status': 403, '/connect': 302, '/files': 403, '/sheets': 403, '/disconnect': 200 },
    Onlysheetsview: { '/status': 403, '/connect': 403, '/files': 403, '/sheets': 200, '/disconnect': 403 },
  };
  for (const [who, routes] of Object.entries(expect)) {
    for (const [p, want] of Object.entries(routes)) {
      const m = p === '/disconnect' ? 'POST' : 'GET';
      const r = await call(m, E + p, { token: tok[who] });
      answered[who + p] = r;
      if (r.status === 403) refusals.push(r);
      if (r.status !== want) lone.push(`${who} ${m} ${p}: ${r.status} (wanted ${want})`);
    }
  }
  check('each grant is its own: drive.view reads the status and the files, drive.connect links and unlinks the account and reads nothing, sheets.view reads the spreadsheets and nothing else', lone.length === 0, lone.join('; '));
  check('…and a refusal is always the one plain answer, { error } and nothing else', refusals.length > 20 && refusals.every(r => plainError(r.data)), refusals.filter(r => !plainError(r.data)).map(r => `${r.status} ${r.text}`).slice(0, 3).join(' | '));
  check('…the sections off say "Not permitted"; no session says it is not signed in', refusals.filter(r => r.status === 403).every(r => r.data.error === 'Not permitted') && refusals.filter(r => r.status === 401).every(r => typeof r.data.error === 'string' && r.data.error !== 'Not permitted'));
  const adminAll = [];
  const adminAnswers = {};
  for (const [m, p] of ROUTES) { const r = await call(m, A + p, { token: 'adm' }); adminAnswers[p] = r; if (![200, 302].includes(r.status)) adminAll.push(`${m} ${p}: ${r.status}`); }
  check('the administrator holds every grant: no route of theirs refuses them', adminAll.length === 0, adminAll.join('; '));

  // ═══ Letting go ═════════════════════════════════════════════════════════════
  // (the matrix above ended with the administrator's link and the connect-only member's let go)
  await settle();
  const rowAdminGone = T.google_tokens.find(r => r.user_key === 'admin_drive');
  const rowConnGone = T.google_tokens.find(r => r.user_key === '22_drive');
  check('…and the shared context lets go of it too (the upload code would otherwise go on using it)', ctx.driveTokens === null, JSON.stringify(ctx.driveTokens));
  check('letting go answers { ok: true } in both portals', same(adminAnswers['/disconnect'].data, { ok: true }) && same(answered['Onlydriveconnect/disconnect'].data, { ok: true }) && shape(S.GoogleDisconnected, adminAnswers['/disconnect'].data) === true);
  check('…and empties the row instead of deleting it (a restart finds nothing to bring back — a revoked grant would fail every call after that)',
    rowAdminGone && rowAdminGone.tokens === null && rowConnGone && rowConnGone.tokens === null && T.google_tokens.filter(r => r.user_key === 'admin_drive').length === 1);
  const again = await call('POST', A + '/disconnect', { token: 'adm' });
  check('…and letting go of a link that is not there is as quiet as letting go of one that is', again.status === 200 && same(again.data, { ok: true }));
  check('…it is only the caller\'s own: the other people\'s links stand', ['2_drive', '5_drive', '21_drive', '23_drive'].every(k => { const r = T.google_tokens.find(x => x.user_key === k); return r && r.tokens && r.tokens.access_token; }));
  const leoWas = await call('GET', E + '/status', { token: tok.Leo });
  const leoLet = await call('POST', E + '/disconnect', { token: tok.Leo });
  const leoStatus = await call('GET', E + '/status', { token: tok.Leo });
  reset();
  const leoFiles = await call('GET', E + '/files', { token: tok.Leo });
  await settle();
  check('…a member who lets go is unlinked at once — the link is forgotten in the app\'s memory as well as emptied in the table, not only at the next restart',
    leoWas.data.connected === true && leoLet.status === 200 && same(leoStatus.data, { configured: true, connected: false }) && leoFiles.status === 500 && leoFiles.data.error === 'Drive not connected'
    && google.files.length === 0 && T.google_tokens.find(r => r.user_key === '13_drive').tokens === null, JSON.stringify([leoWas.data, leoStatus.data, leoFiles.data]));
  reset();
  const afterF = await call('GET', A + '/files', { token: 'adm' });
  const afterS = await call('GET', A + '/sheets', { token: 'adm' });
  check('…after it there is nothing to list: "Drive not connected" (500) from the administrator\'s routes too, and Google is not asked', afterF.status === 500 && afterF.data.error === 'Drive not connected' && afterS.status === 500 && afterS.data.error === 'Drive not connected' && google.files.length === 0);

  // ═══ What a link says of itself ══════════════════════════════════════════════
  // The administrator's link is gone: it comes back through the real round trip below
  const roundTrip = async (kind, who) => {
    const begin = kind === 'admin'
      ? await call('GET', A + '/connect', { query: '_t=adm' })
      : await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok[who]) });
    const url = new URL(begin.location);
    const back = await call('GET', '/api/email/callback', { query: 'code=the-code&state=' + url.searchParams.get('state') });
    return { begin, url, back };
  };

  const connectA = await call('GET', A + '/connect', { query: '_t=adm' });
  const ua = connectA.location ? new URL(connectA.location) : null;
  check('connecting sends the browser to Google\'s consent screen — the token in the address is the session (a page change cannot carry a header)',
    connectA.status === 302 && ua && ua.origin + ua.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', `${connectA.status} ${connectA.location}`);
  check('…asking for the client, a way back to the one callback, a code, offline access, the consent screen every time, and read access to Drive with the right to create files the app makes (and nothing wider) beside who they are',
    ua && ua.searchParams.get('client_id') === 'client-123' && ua.searchParams.get('redirect_uri') === APP + '/api/email/callback' && ua.searchParams.get('response_type') === 'code'
    && ua.searchParams.get('access_type') === 'offline' && ua.searchParams.get('prompt') === 'consent' && ua.searchParams.get('scope') === SCOPE_DRIVE, ua && [...ua.searchParams.keys()].join());
  const connectB = await call('GET', A + '/connect', { query: '_t=adm' });
  const stateA = ua.searchParams.get('state'), stateB = new URL(connectB.location).searchParams.get('state');
  check('…and a state nobody could guess, a new one each time (it is how the way back knows whose it is)', /^[0-9a-f]{32}$/.test(stateA) && /^[0-9a-f]{32}$/.test(stateB) && stateA !== stateB);
  const bad = await call('GET', A + '/connect', { query: '_t=nope' });
  const connectE = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const ue = new URL(connectE.location);
  check('a token that is no session is a 401 there as anywhere; a team member\'s connect is the same consent screen, the same scopes', bad.status === 401 && connectE.status === 302 && ue.searchParams.get('scope') === SCOPE_DRIVE && ue.searchParams.get('redirect_uri') === APP + '/api/email/callback' && ue.searchParams.get('state') !== stateA, `${bad.status} ${connectE.status}`);

  // The administrator's link is gone (the loop above): not connected, in the shape the contract says
  const gone = await call('GET', A + '/status', { token: 'adm' });
  check('a person with no link is "configured, not connected" — the administrator\'s, with the link let go above', same(gone.data, { configured: true, connected: false }) && shape(S.DriveStatus, gone.data) === true, JSON.stringify(gone.data));
  const ben = await call('GET', E + '/status', { token: tok.Ben });
  const ivy = await call('GET', E + '/status', { token: tok.Ivy });
  check('…and so is a team member who never linked one (no row at all), or whose row was left empty by a disconnect', same(ben.data, { configured: true, connected: false }) && same(ivy.data, { configured: true, connected: false }) && shape(S.DriveStatus, ivy.data) === true);

  const ana = await call('GET', E + '/status', { token: tok.Ana });
  check('a team member\'s own link says who it is and that it can upload', same(ana.data, { configured: true, connected: true, email: 'ana@motolinker.test', name: 'Ana A.', canUpload: true }) && shape(S.DriveStatus, ana.data) === true, JSON.stringify(ana.data));
  const dee = await call('GET', E + '/status', { token: tok.Dee });
  const eli = await call('GET', E + '/status', { token: tok.Eli });
  const fay = await call('GET', E + '/status', { token: tok.Fay });
  check('a link whose grant was read-only cannot upload (so the page can ask for one reconnect, rather than leave it to a client file failing months later); the whole of Drive can; a grant that was never recorded is let through',
    dee.data.canUpload === false && eli.data.canUpload === true && fay.data.canUpload === true, `${dee.data.canUpload} ${eli.data.canUpload} ${fay.data.canUpload}`);
  check('…every one of those answers is the shape the contract says (canUpload is always there for a link that is made)', [dee, eli, fay].every(r => shape(S.DriveStatus, r.data) === true) && shape(S.DriveStatus, { configured: true, connected: true, email: 'x@y.z' }) !== true);
  check('nobody sees another\'s link: Ben, who has none, sees none; Ana\'s email is Ana\'s alone', ben.data.connected === false && dee.data.email === 'dee@motolinker.test' && ana.data.email !== dee.data.email);

  // ═══ The round trip ═════════════════════════════════════════════════════════
  // a link the administrator made with read access alone says it cannot upload, as a member's does
  reset();
  google.reply.token = () => jsonReply({ access_token: 'ro-at', refresh_token: 'ro-rt', expires_in: 3600, scope: SCOPE_READONLY, token_type: 'Bearer' });
  await roundTrip('admin');
  const roA = await call('GET', A + '/status', { token: 'adm' });
  check('a link the administrator made with read access alone says it cannot upload (the page asks for one reconnect)', roA.data.connected === true && roA.data.canUpload === false && shape(S.DriveStatus, roA.data) === true, JSON.stringify(roA.data));
  reset();
  const rtA = await roundTrip('admin');
  check('Google sends the browser back to the one callback, and the administrator lands on Drive (a 302 to the page\'s own address)', rtA.back.status === 302 && rtA.back.location === '/dashboard#drive', `${rtA.back.status} ${rtA.back.location}`);
  check('…the code was traded for tokens (the client\'s id and secret, the same way back, the authorisation grant), and who the person is was asked of Google with the new access token',
    google.token.length === 1 && google.token[0].code === 'the-code' && google.token[0].client_id === 'client-123' && google.token[0].client_secret === 'secret-456'
    && google.token[0].redirect_uri === APP + '/api/email/callback' && google.token[0].grant_type === 'authorization_code' && google.userinfo[0].auth === 'Bearer granted-at', JSON.stringify(google.token));
  const rowA = await saved('admin_drive');
  await settle();
  check('…and the link is kept where a restart finds it (google_tokens), with who it is, when the access token runs out and what Google actually granted',
    rowA.tokens && rowA.tokens.access_token === 'granted-at' && rowA.tokens.refresh_token === 'granted-rt' && rowA.tokens.email === 'granted@motolinker.test' && rowA.tokens.name === 'Granted G.'
    && rowA.tokens.scope === SCOPE_DRIVE && rowA.tokens.expiry_date > Date.now() + 3000000 && rowA.tokens.expiry_date < Date.now() + 3700000, JSON.stringify(rowA.tokens));
  check('…and the shared context has the new one', !!ctx.driveTokens && ctx.driveTokens.access_token === 'granted-at', JSON.stringify(ctx.driveTokens));
  const nowA = await call('GET', A + '/status', { token: 'adm' });
  check('the administrator is connected as the account Google named', same(nowA.data, { configured: true, connected: true, email: 'granted@motolinker.test', name: 'Granted G.', canUpload: true }), JSON.stringify(nowA.data));

  reset();
  const rtE = await roundTrip('team', 'Ben');
  check('a team member lands on the team portal\'s Drive', rtE.back.status === 302 && rtE.back.location === '/employee#drive', `${rtE.back.status} ${rtE.back.location}`);
  const rowE = await saved('3_drive');
  await settle();
  check('…the link is the member\'s own (their id\'s row), and it replaced the empty one a disconnect had left', rowE.tokens && rowE.tokens.access_token === 'granted-at' && T.google_tokens.filter(r => r.user_key === '3_drive').length === 1);
  const benNow = await call('GET', E + '/status', { token: tok.Ben });
  const anaStill = await call('GET', E + '/status', { token: tok.Ana });
  check('…Ben is connected and Ana\'s link is what it was', benNow.data.connected === true && benNow.data.email === 'granted@motolinker.test' && anaStill.data.email === 'ana@motolinker.test');

  // a state is good once: the same way back a second time is not a Drive link any more (it is read as a return that nobody asked for)
  reset();
  google.reply.userinfo = { email: 'someone-else@motolinker.test', name: 'Someone Else' };
  const replay = await call('GET', '/api/email/callback', { query: 'code=the-code&state=' + rtE.url.searchParams.get('state') });
  const benReplayed = await call('GET', E + '/status', { token: tok.Ben });
  check('a state is good once: the same way back a second time does not link another account over the first, or land on Drive',
    replay.location !== '/employee#drive' && benReplayed.data.email === 'granted@motolinker.test', `${replay.status} ${replay.location} ${JSON.stringify(benReplayed.data)}`);
  reset();
  const noCode = await call('GET', '/api/email/callback', { query: 'state=whatever' });
  check('a way back without a code is turned away (400)', noCode.status === 400 && /No code provided/.test(noCode.text), `${noCode.status} ${noCode.text}`);
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
  const begin = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Ben) });
  const refusedBack = await call('GET', '/api/email/callback', { query: 'code=stale&state=' + new URL(begin.location).searchParams.get('state') });
  check('when Google will not trade the code, the person is told so in words, in plain text, and nothing is kept (500)', refusedBack.status === 500 && /^OAuth error: Bad Request/.test(refusedBack.text), `${refusedBack.status} ${refusedBack.text}`);
  const benAfter = await call('GET', E + '/status', { token: tok.Ben });
  check('…the link Ben had is as it was', benAfter.data.email === 'granted@motolinker.test');
  // two people on Google's consent screen at the same time each come back to their own link: the state is the only thing that tells them apart
  reset();
  const bJo = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Jo) });
  const bKai = await call('GET', E + '/connect', { query: '_t=' + encodeURIComponent(tok.Kai) });
  google.reply.userinfo = { email: 'kai@motolinker.test', name: 'Kai K.' };
  const backKai = await call('GET', '/api/email/callback', { query: 'code=c-kai&state=' + new URL(bKai.location).searchParams.get('state') });
  google.reply.userinfo = { email: 'jo@motolinker.test', name: 'Jo J.' };
  const backJo = await call('GET', '/api/email/callback', { query: 'code=c-jo&state=' + new URL(bJo.location).searchParams.get('state') });
  const sJo = await call('GET', E + '/status', { token: tok.Jo });
  const sKai = await call('GET', E + '/status', { token: tok.Kai });
  check('two people on Google\'s consent screen at once, coming back in the other order, each land on their own link', backJo.location === '/employee#drive' && backKai.location === '/employee#drive'
    && sJo.data.email === 'jo@motolinker.test' && sKai.data.email === 'kai@motolinker.test', `${sJo.data.email} ${sKai.data.email}`);

  // ═══ The files ═══════════════════════════════════════════════════════════════
  reset();
  const files = await call('GET', A + '/files', { token: 'adm' });
  const g1 = google.files[0];
  check('the administrator\'s files are Drive\'s own, newest first, in the shape the contract says', files.status === 200 && files.data.length === 3 && files.data[0].id === 'f1' && shape(S.DriveFileList, files.data) === true, shape(S.DriveFileList, files.data));
  check('…asked of Google as the administrator\'s own account: what is not in the bin, newest change first, fifty at a time, these fields',
    g1 && g1.url.pathname === '/drive/v3/files' && g1.auth === 'Bearer granted-at' && g1.url.searchParams.get('q') === 'trashed=false' && g1.url.searchParams.get('orderBy') === 'modifiedTime desc'
    && g1.url.searchParams.get('pageSize') === '50' && g1.url.searchParams.get('fields') === FIELDS, g1 && g1.url.search);
  check('…a file Drive gives no size or link for (a Google document, a file nobody shared) comes with only what it has', files.data[2].size === undefined && files.data[2].webViewLink === undefined && files.data[1].size === undefined);
  reset();
  const sheetsA = await call('GET', A + '/sheets', { token: 'adm' });
  check('the spreadsheets are the same call with one more condition: the type is a Google spreadsheet', sheetsA.status === 200 && google.files[0].url.searchParams.get('q') === `mimeType='${SHEET}' and trashed=false`, google.files[0] && google.files[0].url.searchParams.get('q'));
  reset();
  const filesE = await call('GET', E + '/files', { token: tok.Ana });
  const sheetsE = await call('GET', E + '/sheets', { token: tok.Ana });
  check('a team member\'s files and spreadsheets are the same calls made with their own account — not the administrator\'s', filesE.status === 200 && sheetsE.status === 200 && google.files.length === 2 && google.files.every(f => f.auth === 'Bearer ana-at')
    && google.files[0].url.searchParams.get('q') === 'trashed=false' && google.files[1].url.searchParams.get('q') === `mimeType='${SHEET}' and trashed=false` && shape(S.DriveFileList, filesE.data) === true);
  reset();
  google.reply.files = () => jsonReply({});
  const empty = await call('GET', E + '/files', { token: tok.Ana });
  check('a Drive with nothing in it answers a list with nothing in it (Google leaves the list out)', empty.status === 200 && same(empty.data, []));
  reset();
  google.reply.files = () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } });
  const denied = await call('GET', E + '/files', { token: tok.Ana });
  const deniedA = await call('GET', A + '/sheets', { token: 'adm' });
  check('when Google says no, the page is told Google\'s own words (500)', denied.status === 500 && denied.data.error === 'Request had insufficient authentication scopes.' && deniedA.status === 500 && deniedA.data.error === 'Request had insufficient authentication scopes.', `${denied.status} ${JSON.stringify(denied.data)}`);
  reset();
  const unlinked = await call('GET', E + '/files', { token: tok.Ivy });
  const unlinkedS = await call('GET', E + '/sheets', { token: tok.Ivy });
  check('a person with no link who asks for files is told so (500 — "Drive not connected"), and Google is not asked',
    unlinked.status === 500 && unlinked.data.error === 'Drive not connected' && unlinkedS.status === 500 && unlinkedS.data.error === 'Drive not connected' && google.files.length === 0 && plainError(unlinked.data), `${unlinked.status} ${JSON.stringify(unlinked.data)}`);

  // ═══ A link that has run out ════════════════════════════════════════════════
  reset();
  // (what Google says of the renewed grant replaces what the link knew: here it has narrowed it)
  google.reply.token = () => jsonReply({ access_token: 'refreshed-at', expires_in: 3600, scope: SCOPE_READONLY });
  const gusFiles = await call('GET', E + '/files', { token: tok.Gus });
  check('an access token that has run out is traded for a new one with the refresh token — and Drive is asked with the new one',
    gusFiles.status === 200 && google.token.length === 1 && google.token[0].grant_type === 'refresh_token' && google.token[0].refresh_token === 'gus-at-refresh'
    && google.token[0].client_id === 'client-123' && google.token[0].client_secret === 'secret-456' && google.files.length === 1 && google.files[0].auth === 'Bearer refreshed-at', JSON.stringify(google.token));
  await settle();
  const rowGus = T.google_tokens.find(r => r.user_key === '8_drive');
  check('…the new one is kept for a restart to find, with who the person is and the refresh token still there',
    rowGus.tokens.access_token === 'refreshed-at' && rowGus.tokens.refresh_token === 'gus-at-refresh' && rowGus.tokens.email === 'gus@motolinker.test' && rowGus.tokens.expiry_date > Date.now() + 3000000, JSON.stringify(rowGus.tokens));
  const gusStatus = await call('GET', E + '/status', { token: tok.Gus });
  check('…and what Google said of the grant when it renewed it is what the link now knows (a grant that was narrowed can no longer upload)', rowGus.tokens.scope === SCOPE_READONLY && gusStatus.data.canUpload === false, JSON.stringify(gusStatus.data));
  const gusAgain = await call('GET', E + '/sheets', { token: tok.Gus });
  check('…and it is not traded again while it holds', gusAgain.status === 200 && google.token.length === 1 && google.files.length === 2 && google.files[1].auth === 'Bearer refreshed-at');
  const stillGood = await call('GET', E + '/files', { token: tok.Ana });
  check('a token that is still good is used as it is (Google is not asked for a new one)', stillGood.status === 200 && google.token.length === 1 && google.files[2].auth === 'Bearer ana-at');
  reset();
  const idaSheets = await call('GET', E + '/sheets', { token: tok.Ida });
  await settle();
  const rowIda = T.google_tokens.find(r => r.user_key === '14_drive');
  check('the spreadsheets renew a lapsed access token as the files do, and the new one is kept for a restart',
    idaSheets.status === 200 && google.token.length === 1 && google.token[0].grant_type === 'refresh_token' && google.files.length === 1 && google.files[0].auth === 'Bearer refreshed-at' && rowIda.tokens.access_token === 'refreshed-at', JSON.stringify(google.token));
  reset();
  const miaFiles = await call('GET', E + '/files', { token: tok.Mia });
  check('a lapsed access token with no refresh token is used as it is: Google is not asked to renew what cannot be renewed',
    miaFiles.status === 200 && google.token.length === 0 && google.files.length === 1 && google.files[0].auth === 'Bearer mia-at', JSON.stringify(google.token));
  reset();
  google.reply.token = () => jsonReply({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  google.reply.files = () => jsonReply({ error: { code: 401, message: 'Invalid Credentials' } });
  const hal = await call('GET', E + '/files', { token: tok.Hal });
  check('a renewal that Google refuses is not reported as such: the old token is tried, and what Drive says to it is what the page is told (500)',
    hal.status === 500 && hal.data.error === 'Invalid Credentials' && google.token.length === 1 && google.files.length === 1 && google.files[0].auth === 'Bearer hal-at', `${hal.status} ${JSON.stringify(hal.data)}`);

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (!UNCONFIGURED) {
    const un = spawnSync(process.execPath, [__filename, '--unconfigured'], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
    console.log(un.stdout.trim());
    if (un.status !== 0) { console.log(un.stderr.slice(-800)); }
    process.exit(failed || un.status ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
