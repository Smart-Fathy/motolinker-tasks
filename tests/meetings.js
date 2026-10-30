// Scheduled meetings on the server: the Meet page's list, the scheduling sheet, and what scheduling does behind the response —
// writes the meeting to the company's Google Calendar and to the calendars attendees connected themselves, and tells the
// attendees — on the two portals' routes and on /api/v1.
//
// The two portals' routes were one set of handlers mounted twice (src/routes/meetings.js); this holds what they do — which
// rows, for whom, what the Google Calendar is asked, who is told what, what a failing database answers — so that moving that
// code into src/modules/meetings and putting /api/v1/meetings beside it (which is strict about what it is sent and honest about
// what went wrong) changes nothing for the classic pages. (tests/meetstest.js drives the classic page; this is the server under it.)
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const NOW = Date.now();
  const at = hours => new Date(NOW + hours * 3600e3).toISOString();
  const employee = (id, name, email = '') => ({ id, name, username: name.toLowerCase(), email, password_hash: 'x', job_title: 'Sales', permissions: {}, avatar_url: '', status_text: '', status_emoji: '' });
  const everyone = [
    employee(61, 'Ana', 'ana@example.com'),    // schedules and attends
    employee(62, 'Bo', 'bo@example.com'),      // may see meetings, not schedule them
    employee(63, 'Cy', 'cy@example.com'),      // has no Meet section at all
    employee(64, 'Dee', 'dee@example.com'),    // an attendee who connected her own Google Calendar
    employee(65, 'Eli', 'eli@example.com'),    // an attendee with an email and no calendar of his own
    employee(66, 'Fay', ''),                   // an attendee with no email
  ];
  const employees = everyone.slice();
  const raw = {
    61: {}, 64: {}, 65: {}, 66: {},
    62: { meet: true, meetActions: { view: true, schedule: false } },
    63: { meet: false },
  };
  const seed = () => [
    { id: 1, title: 'Started yesterday and a half', description: '', starts_at: at(-30), duration_min: 30, attendee_ids: ['61'], meet_link: '', calendar_events: {}, created_by: 'admin', created_at: at(-100) },
    { id: 2, title: 'Started two hours ago', description: 'Still on', starts_at: at(-2), duration_min: 90, attendee_ids: ['61', '62'], meet_link: 'https://meet.google.com/abc-defg-hij', calendar_events: { company: 'ev-2' }, created_by: 'employee_61', created_at: at(-90) },
    { id: 4, title: 'Later this week', description: '', starts_at: at(72), duration_min: 45, attendee_ids: [], meet_link: 'huddle:3', calendar_events: {}, created_by: 'admin', created_at: at(-10) },
    { id: 3, title: 'Tomorrow', description: 'Pipeline', starts_at: at(24), duration_min: 30, attendee_ids: ['62', '64'], meet_link: '', calendar_events: {}, created_by: 'employee_61', created_at: at(-20) },
  ];
  const db = createFakeSupabase(
    { employees, sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [], presence: [], meetings: seed() },
    { serial: { meetings: 100 }, defaults: { notifications: () => ({ read: false }) } },
  );
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3968 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');

  // ── Google, stood in for: the token functions the server asks the context for, and the one Google endpoint it calls itself ──
  const google = { calls: [], company: 'co-token', fail: false, employeeTokens: { 64: 'tok-64' } };
  ctx.getCalendarToken = async () => google.company;
  ctx.getEmployeeCalendarToken = async id => google.employeeTokens[id] || null;
  ctx.upsertCalendarEvent = async (token, body, existingId, invite) => { google.calls.push({ via: 'upsert', token, body, existingId, invite }); return { id: existingId || 'personal-' + token }; };
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (!/^https:\/\/www\.googleapis\.com\/calendar\/v3\//.test(String(url))) return realFetch(url, init);
    const method = (init && init.method) || 'GET';
    google.calls.push({ via: 'fetch', method, url: String(url), token: ((init && init.headers) || {}).Authorization, body: init && init.body ? JSON.parse(init.body) : null });
    if (google.fail) return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 403 });
    if (method === 'DELETE') return new Response('', { status: 204 });
    const id = /\/events\/([^?]+)/.exec(String(url));
    return new Response(JSON.stringify({ id: id ? decodeURIComponent(id[1]) : 'co-ev-' + google.calls.length, hangoutLink: 'https://meet.google.com/minted-by-google' }), { status: 200 });
  };

  const reset = () => {
    db.tables.meetings.splice(0, db.tables.meetings.length, ...seed());
    db.tables.notifications.splice(0);
    db.log.length = 0; db.failing.clear();
    google.calls.length = 0; google.company = 'co-token'; google.fail = false; google.employeeTokens = { 64: 'tok-64' };
  };

  ctx.sessions.set('mt-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const TOKEN = { 61: 'mt-ana', 62: 'mt-bo', 63: 'mt-cy', 64: 'mt-dee', 65: 'mt-eli', 66: 'mt-fay' };
  for (const e of everyone) {
    ctx.employeeSessions.set(TOKEN[e.id], { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms(raw[e.id]), createdAt: Date.now() });
  }
  const call = async (method, path, token, body) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method, headers, body: payload });
    let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };
  const row = id => db.tables.meetings.find(m => m.id === id);
  const queries = (method, table) => db.log.filter(l => l.method === method && l.table === table).map(l => l.query);
  const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); await sleep(40); return fn(); };
  // what scheduling does behind its answer: wait for the calendar writes to have been made
  const synced = (id, ms = 2000) => until(() => { const m = row(id); return m && m.calendar_events && Object.keys(m.calendar_events).length > 0; }, ms);
  const ids = list => list.map(m => m.id);
  const body = (over = {}) => ({ title: 'Weekly sales sync', starts_at: at(48), duration_min: 30, attendee_ids: ['64', '65'], meet_link: '', description: 'Agenda', ...over });

  const CLASSIC = { team: '/api/employee/meetings', admin: '/api/dashboard/meetings' };
  const TEAM = TOKEN[61], ADMIN = 'mt-admin';

  // ═══ 1. The classic routes: what they do today ═══════════════════════════════════════════════
  // ── the list ──
  {
    const ana = await call('GET', CLASSIC.team, TEAM);
    check('a team member lists the upcoming meetings and the recent past, soonest first', ana.status === 200 && JSON.stringify(ids(ana.body)) === '[2,3,4]', JSON.stringify(ana.body && ids(ana.body)));
    check('…a meeting that started a day and a half ago is not among them', !ids(ana.body).includes(1));
    const q = queries('GET', 'meetings')[0] || '';
    const since = decodeURIComponent((/starts_at=gte\.([^&]+)/.exec(q) || [])[1] || '');
    check('…asked of the database as: everything from a day ago on, soonest first, a hundred at most', /^\?select=\*&starts_at=gte\..+&order=starts_at\.asc&limit=100$/.test(q) && Math.abs(Date.parse(since) - (NOW - 24 * 3600e3)) < 60e3, q);
    check('…the rows as they are stored (attendees and link included), whoever is in them', ana.body[0].title === 'Started two hours ago' && ana.body[0].attendee_ids.join() === '61,62' && ana.body[0].meet_link === 'https://meet.google.com/abc-defg-hij' && ana.body[1].created_by === 'employee_61' && ana.body[2].meet_link === 'huddle:3');
    const admin = await call('GET', CLASSIC.admin, ADMIN);
    check('the admin gets the same list', admin.status === 200 && JSON.stringify(ids(admin.body)) === '[2,3,4]');
    const bo = await call('GET', CLASSIC.team, TOKEN[62]);
    check('a team member who may only see them gets it too — all of them, not just the ones they are in', bo.status === 200 && JSON.stringify(ids(bo.body)) === '[2,3,4]');
    const cy = await call('GET', CLASSIC.team, TOKEN[63]);
    check('one without the Meet section is refused', cy.status === 403 && cy.body.error === 'Not permitted', JSON.stringify(cy));
    const wrong = [];
    for (const [label, token, which] of [['nobody', null, 'team'], ['a token nobody issued', 'mt-nobody', 'team'], ['the admin\'s login', ADMIN, 'team'], ['nobody', null, 'admin'], ['an employee\'s login', TEAM, 'admin']]) {
      for (const [method, suffix, b] of [['GET', ''], ['POST', '', body()], ['PUT', '/1', body()], ['DELETE', '/1']]) {
        const got = (await call(method, CLASSIC[which] + suffix, token, b)).status;
        if (got !== 401) wrong.push(`${method} ${CLASSIC[which]}${suffix} as ${label}: ${got}`);
      }
    }
    check('nobody, a token nobody issued, and the other portal\'s login are 401 on every route of both portals', wrong.length === 0, wrong.join('; '));
    check('…and a refused request changes nothing', db.tables.meetings.length === 4 && google.calls.length === 0);
    reset();
    db.failing.add('meetings');
    const down = await call('GET', CLASSIC.team, TEAM);
    check('a database that cannot be asked is a 500 carrying its own words (the classic page shows an empty list)', down.status === 500 && /simulated database failure/.test(down.body.error), JSON.stringify(down));
    reset();
  }

  // ── scheduling ──
  {
    const bad = [];
    for (const [label, b] of [['no title', body({ title: undefined })], ['a blank title', body({ title: '   ' })], ['no body at all', undefined]]) {
      const r = await call('POST', CLASSIC.team, TEAM, b);
      if (r.status !== 400 || r.body.error !== 'Title is required') bad.push(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    check('a meeting needs a title: 400, and nothing is stored', bad.length === 0 && db.tables.meetings.length === 4, bad.join('; '));
    const noTime = [];
    for (const [label, b] of [['no start', body({ starts_at: undefined })], ['an empty start', body({ starts_at: '' })], ['nonsense', body({ starts_at: 'next tuesday' })]]) {
      const r = await call('POST', CLASSIC.team, TEAM, b);
      if (r.status !== 400 || r.body.error !== 'A valid start time is required') noTime.push(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    check('…and a start time that is a date: 400, and nothing is stored', noTime.length === 0 && db.tables.meetings.length === 4 && google.calls.length === 0, noTime.join('; '));

    google.company = null;
    const made = await call('POST', CLASSIC.team, TEAM, body({ title: '  Weekly sales sync  ', description: '  Agenda  ', meet_link: '  https://meet.google.com/xyz  ', attendee_ids: [64, '65', '', 0, null, 'x'] }));
    const stored = row(made.body && made.body.id);
    // (the calendar events are written after the answer, so the stored row may have them and the answer does not)
    const { calendar_events: _was, ...answered } = made.body || {}; const { calendar_events: _is, ...kept } = stored || {};
    check('a team member schedules a meeting: the stored row comes back, under the next id', made.status === 200 && made.body.id === 100 && JSON.stringify(answered) === JSON.stringify(kept), JSON.stringify(made));
    // an attendee that is not text is made into text, so a null is the text "null" (v1 will refuse it); only what is empty is dropped
    check('…its words trimmed, its attendees ids as text with the empty ones dropped, the link as given, and who made it', stored.title === 'Weekly sales sync' && stored.description === 'Agenda' && stored.attendee_ids.join('|') === '64|65|0|null|x' && stored.meet_link === 'https://meet.google.com/xyz' && stored.created_by === 'employee_61', JSON.stringify(stored));
    check('…the time as an ISO instant, and thirty minutes by default for what is not a number', stored.starts_at === new Date(body().starts_at).toISOString() && stored.duration_min === 30);
    const extra = await call('POST', CLASSIC.team, TEAM, { ...body(), id: 999, created_by: 'admin', calendar_events: { company: 'x' }, anything: 'else' });
    check('…what the sheet does not offer (an id, an owner, the calendar\'s event ids) is not taken from it', extra.status === 200 && row(extra.body.id).id === extra.body.id && row(extra.body.id).created_by === 'employee_61' && !row(extra.body.id).anything && !(row(extra.body.id).calendar_events || {}).company);
    const lengths = {};
    for (const d of [1, 4, 5, 30, 480, 481, 9999, 0, 'abc', '45', 45.9, -3]) lengths[String(d)] = (await call('POST', CLASSIC.team, TEAM, body({ duration_min: d }))).body.duration_min;
    check('the duration is a whole number of minutes from 5 to 480, and 30 when it is not a number', JSON.stringify(lengths) === JSON.stringify({ 1: 5, 4: 5, 5: 5, 30: 30, 480: 480, 481: 480, 9999: 480, 0: 30, abc: 30, 45: 45, '45.9': 45, '-3': 5 }), JSON.stringify(lengths));
    const upserts = google.calls.filter(c => c.via === 'upsert');
    check('with no company calendar connected nothing is asked of Google itself, and the only calendar written to is the one an attendee connected', google.calls.filter(c => c.via === 'fetch').length === 0 && upserts.length > 0 && upserts.every(c => c.token === 'tok-64'), JSON.stringify(google.calls.map(c => c.via + ':' + (c.token || ''))));
    const odd = await call('POST', CLASSIC.team, TEAM, body({ attendee_ids: 'not a list', title: 'No list' }));
    check('attendees that are not a list are nobody', odd.status === 200 && odd.body.attendee_ids.length === 0);
    reset();
  }

  // ── the calendars it writes to, behind the answer ──
  {
    const made = await call('POST', CLASSIC.team, TEAM, body({ attendee_ids: ['64', '65', '66'] }));
    await synced(made.body.id);
    const company = google.calls.filter(c => c.via === 'fetch');
    check('the answer does not wait for Google: the row is what was stored, with no calendar events yet', made.status === 200 && Object.keys(made.body.calendar_events || {}).length === 0);
    check('the company\'s calendar is asked to create the event with every attendee who has an email, inviting them', company.length === 1 && company[0].method === 'POST' && company[0].url === 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1' && company[0].token === 'Bearer co-token' && JSON.stringify(company[0].body.attendees) === '[{"email":"dee@example.com"},{"email":"eli@example.com"}]', JSON.stringify(company[0] && company[0].body));
    const ev = company[0].body;
    check('…the event is the meeting: title, notes, when it starts and when it ends', ev.summary === 'Weekly sales sync' && ev.description === 'Agenda' && ev.start.dateTime === made.body.starts_at && ev.end.dateTime === new Date(Date.parse(made.body.starts_at) + 30 * 60000).toISOString());
    check('…and, with no link given, Google is asked to make a Meet link', ev.conferenceData && ev.conferenceData.createRequest.requestId === 'ml-meet-' + made.body.id && ev.conferenceData.createRequest.conferenceSolutionKey.type === 'hangoutsMeet');
    const personal = google.calls.filter(c => c.via === 'upsert');
    check('an attendee who connected her own calendar gets the event written there, without the invitation list or a Meet request', personal.length === 1 && personal[0].token === 'tok-64' && personal[0].existingId === undefined && personal[0].invite === false && !personal[0].body.attendees && !personal[0].body.conferenceData);
    check('…and the Meet link Google made is in the notes of that event, and stored on the meeting', /Meet: https:\/\/meet\.google\.com\/minted-by-google/.test(personal[0].body.description) && row(made.body.id).meet_link === 'https://meet.google.com/minted-by-google');
    check('the event ids are kept, one for the company and one for each personal calendar', JSON.stringify(row(made.body.id).calendar_events) === JSON.stringify({ company: 'co-ev-1', 64: 'personal-tok-64' }), JSON.stringify(row(made.body.id).calendar_events));

    reset();
    const given = await call('POST', CLASSIC.team, TEAM, body({ meet_link: 'https://zoom.example/j/1', attendee_ids: ['65'] }));
    await synced(given.body.id);
    const c2 = google.calls.filter(c => c.via === 'fetch')[0];
    check('a meeting with a link of its own asks for none, and carries the link in its notes', !c2.body.conferenceData && c2.body.description === 'Agenda\nMeet: https://zoom.example/j/1' && row(given.body.id).meet_link === 'https://zoom.example/j/1');

    reset();
    google.fail = true;
    const refused = await call('POST', CLASSIC.team, TEAM, body({ attendee_ids: ['64'] }));
    await sleep(300);
    check('Google refusing the company event does not undo the meeting, and keeps no event id for it', refused.status === 200 && row(refused.body.id) && !(row(refused.body.id).calendar_events || {}).company);

    reset();
    const huddle = await call('POST', CLASSIC.team, TEAM, body({ meet_link: 'huddle:3', attendee_ids: [] }));
    await synced(huddle.body.id);
    const c3 = google.calls.filter(c => c.via === 'fetch')[0];
    check('an in-app huddle is stored as huddle:<room> in the same field, and goes to Google as text like any other link', row(huddle.body.id).meet_link === 'huddle:3' && c3 && c3.body.description === 'Agenda\nMeet: huddle:3' && !c3.body.conferenceData);
    reset();
  }

  // ── telling the attendees ──
  {
    const made = await call('POST', CLASSIC.team, TEAM, body({ attendee_ids: ['61', '62', '64', 'x', '66'], title: 'Standup' }));
    await until(() => db.tables.notifications.length >= 3);
    const told = db.tables.notifications.map(n => n.member_key).sort();
    const starts = new Date(made.body.starts_at).toLocaleString();
    check('every attendee is told except the person who scheduled it (and anything that is not an id is no attendee)', JSON.stringify(told) === JSON.stringify(['employee_62', 'employee_64', 'employee_66', 'employee_x'].sort()), JSON.stringify(told));
    const n = db.tables.notifications.find(x => x.member_key === 'employee_62');
    check('…in the words the classic page has always used, with the link to the Meet page', n && n.type === 'task' && n.title === 'Ana scheduled a meeting' && n.body === `Standup — ${starts}` && n.url === '/employee#meet', JSON.stringify(n));
    reset();
    const byAdmin = await call('POST', CLASSIC.admin, ADMIN, body({ attendee_ids: ['61'] }));
    await until(() => db.tables.notifications.length >= 1);
    check('the admin scheduling is "Admin", and is stored as made by admin', row(byAdmin.body.id).created_by === 'admin' && db.tables.notifications[0].title === 'Admin scheduled a meeting' && db.tables.notifications[0].member_key === 'employee_61');
    reset();
  }

  // ── editing ──
  {
    google.company = null;
    const put = await call('PUT', `${CLASSIC.team}/3`, TEAM, body({ title: 'Moved', attendee_ids: ['65'], description: '' }));
    check('a team member edits a meeting: the stored row comes back changed', put.status === 200 && put.body.id === 3 && put.body.title === 'Moved' && JSON.stringify(row(3)) === JSON.stringify(put.body), JSON.stringify(put));
    check('…whoever made it stays who made it, and the attendees are not told again', row(3).created_by === 'employee_61' && (await sleep(200), db.tables.notifications.length === 0));
    const invalid = await call('PUT', `${CLASSIC.team}/3`, TEAM, body({ title: '' }));
    check('the same two checks apply: a title, and a start that is a date', invalid.status === 400 && invalid.body.error === 'Title is required' && (await call('PUT', `${CLASSIC.team}/3`, TEAM, body({ starts_at: 'x' }))).body.error === 'A valid start time is required');
    const lost = await call('PUT', `${CLASSIC.team}/999`, TEAM, body());
    check('a meeting that is not there is a 500 carrying the database\'s words (the classic page shows "Failed to save.")', lost.status === 500 && /rows returned/.test(lost.body.error), JSON.stringify(lost));
    reset();

    google.company = 'co-token';
    const sync1 = await call('POST', CLASSIC.team, TEAM, body({ attendee_ids: ['64'] }));
    await synced(sync1.body.id);
    google.calls.length = 0;
    await call('PUT', `${CLASSIC.team}/${sync1.body.id}`, TEAM, body({ title: 'Renamed', attendee_ids: ['64'] }));
    await until(() => google.calls.some(c => c.via === 'upsert'));
    const patched = google.calls.filter(c => c.via === 'fetch')[0];
    check('editing writes to the event it already made, rather than making another', patched && patched.method === 'PATCH' && patched.url === 'https://www.googleapis.com/calendar/v3/calendars/primary/events/co-ev-1?sendUpdates=all&conferenceDataVersion=1' && google.calls.filter(c => c.via === 'upsert')[0].existingId === 'personal-tok-64');
    reset();
  }

  // ── cancelling ──
  {
    const made = await call('POST', CLASSIC.team, TEAM, body({ attendee_ids: ['64'] }));
    await synced(made.body.id);
    google.calls.length = 0; db.log.length = 0;
    const del = await call('DELETE', `${CLASSIC.team}/${made.body.id}`, TEAM);
    check('a team member cancels a meeting: ok, and it is gone', del.status === 200 && del.body.ok === true && !row(made.body.id));
    check('…read first, then deleted by id', queries('GET', 'meetings').join() === `?select=*&id=eq.${made.body.id}` && queries('DELETE', 'meetings').join() === `?id=eq.${made.body.id}`, `${queries('GET', 'meetings')} ${queries('DELETE', 'meetings')}`);
    await until(() => google.calls.length >= 2);
    const deletes = google.calls.filter(c => c.method === 'DELETE');
    check('…and its events are removed from the company\'s calendar (telling the invitees) and from each personal one', deletes.length === 2 && deletes.some(c => c.token === 'Bearer co-token' && /events\/co-ev-1\?sendUpdates=all$/.test(c.url)) && deletes.some(c => c.token === 'Bearer tok-64' && /events\/personal-tok-64$/.test(c.url)), JSON.stringify(deletes.map(c => [c.token, c.url])));
    const again = await call('DELETE', `${CLASSIC.team}/${made.body.id}`, TEAM);
    check('cancelling what is already gone is ok too, and writes nothing to Google', again.status === 200 && again.body.ok === true && (await sleep(150), google.calls.filter(c => c.method === 'DELETE').length === 2));
    reset();

    const viewer = await call('DELETE', `${CLASSIC.team}/2`, TOKEN[62]);
    check('one who may only see meetings cannot cancel one, nor schedule or edit one', viewer.status === 403 && viewer.body.error === 'Not permitted' && row(2) && (await call('POST', CLASSIC.team, TOKEN[62], body())).status === 403 && (await call('PUT', `${CLASSIC.team}/2`, TOKEN[62], body())).status === 403 && db.tables.meetings.length === 4);
    const none = await call('DELETE', `${CLASSIC.team}/2`, TOKEN[63]);
    check('…and one without the section can do none of it', none.status === 403 && (await call('POST', CLASSIC.team, TOKEN[63], body())).status === 403 && row(2));
    const adminDel = await call('DELETE', `${CLASSIC.admin}/2`, ADMIN);
    check('the admin cancels any', adminDel.status === 200 && !row(2));
    reset();
    db.failing.add('meetings');
    const down = await call('POST', CLASSIC.team, TEAM, body());
    check('a database that cannot be asked is a 500 carrying its own words for a schedule and a cancel both, and nobody is told', down.status === 500 && /simulated database failure/.test(down.body.error) && (await call('DELETE', `${CLASSIC.team}/2`, TEAM)).status === 500 && db.tables.notifications.length === 0 && google.calls.length === 0);
    reset();
  }

  global.fetch = realFetch;
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
