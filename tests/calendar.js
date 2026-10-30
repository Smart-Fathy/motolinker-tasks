// The calendar's feed on the server: everything a person is expected at in a window of time — tasks by their due date, the
// meetings they are in, the leads they promised to call — on the two portals' routes and on /api/v1.
//
// The two portals' routes were one handler mounted twice (src/routes/calendar-feed.js), which asks "is this an employee?" at
// every turn; this holds what they do — which rows, for whom, what each source is asked, what a person without a grant gets,
// what a failing database answers — so that moving that code into src/modules/calendar and putting /api/v1/calendar beside it
// (which knows the person as an actor, and says so when a source could not be read) changes nothing for the classic pages.
// (tests/caltest.js drives the classic page; this is the server under it.)
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

(async () => {
  const DAY = 864e5;
  const day = d => new Date(d).toISOString().slice(0, 10);
  const T0 = Date.UTC(2026, 9, 14, 9, 0, 0);          // Wed 14 Oct 2026, 09:00 UTC: the window is built around it
  const iso = (days, hour = 9) => new Date(T0 + days * DAY + (hour - 9) * 3600e3).toISOString();
  const employee = (id, name, extra = {}) => ({ id, name, username: name.toLowerCase(), email: '', password_hash: 'x', job_title: 'Sales', permissions: {}, avatar_url: '', status_text: '', status_emoji: '', slack_user_id: null, ...extra });
  const everyone = [
    employee(81, 'Ana'),                          // everything she may see: tasks, meetings, and (granted) leads
    employee(82, 'Bo'),                           // no lead follow-ups (no Leads section)
    employee(83, 'Cy'),                           // no tasks
    employee(84, 'Dee'),                          // no meetings
    employee(85, 'Eli', { slack_user_id: 'U85' }),// a task assigned to the old Slack id still counts
    employee(86, 'Fay'),                          // no Calendar section at all
  ];
  const employees = everyone.slice();
  const raw = { 81: { leads: true, leadsActions: { view: true } }, 82: {}, 83: { tasks: false }, 84: { meet: false }, 85: {}, 86: { calendar: false } };
  const task = (id, over = {}) => ({ id, title: 'Task ' + id, description: '', due_date: day(T0), status: 'todo', priority: 'medium', milestone: '', assignee_id: null, assignee_ids: [], channel_name: '', created_at: iso(-10), ...over });
  const seedTasks = () => [
    task(1, { title: 'Send the Avatr quote', description: 'Full spec', due_date: day(T0), assignee_ids: ['81'], priority: 'high', channel_name: 'Sales' }),
    task(2, { title: 'Chase the shipping agent', due_date: day(T0 + 2 * DAY), assignee_id: '81' }),
    task(3, { title: 'Bo only', due_date: day(T0 + 3 * DAY), assignee_ids: ['82'] }),
    task(4, { title: 'No due date', due_date: null, assignee_ids: ['81'] }),
    task(5, { title: 'Far away', due_date: day(T0 + 60 * DAY), assignee_ids: ['81'] }),
    task(6, { title: 'Both of them', due_date: day(T0 + 1 * DAY), assignee_ids: ['81', '82'], status: 'done', milestone: 'Q4' }),
    task(7, { title: 'On the Slack id', due_date: day(T0 + 4 * DAY), assignee_id: 'U85' }),
    task(8, { title: 'Nobody', due_date: day(T0 + 5 * DAY) }),
    task(9, { title: 'Just before the window', due_date: day(T0 - 8 * DAY), assignee_ids: ['81'] }),
  ];
  const meeting = (id, over = {}) => ({ id, title: 'Meeting ' + id, description: '', starts_at: iso(1, 10), duration_min: 30, attendee_ids: [], meet_link: '', calendar_events: {}, created_by: 'admin', created_at: iso(-5), ...over });
  const seedMeetings = () => [
    meeting(1, { title: 'Weekly sales sync', starts_at: iso(1, 10), attendee_ids: ['81'], meet_link: 'https://meet.google.com/abc-defg-hij' }),
    meeting(2, { title: 'Procurement huddle', starts_at: iso(0, 14), attendee_ids: ['82'], meet_link: 'huddle:3', created_by: 'employee_81' }),
    meeting(3, { title: 'Not Ana\'s', starts_at: iso(2, 11), attendee_ids: ['82'], created_by: 'employee_82' }),
    meeting(4, { title: 'Out of the window', starts_at: iso(40, 10), attendee_ids: ['81'] }),
    meeting(5, { title: 'Earlier the same day', starts_at: iso(0, 8), attendee_ids: ['81', '84', '83', '86'] }),
  ];
  const followup = (id, over = {}) => ({ id, customer_id: 1, due_at: iso(1, 16), note: 'Call back', assigned_to: 81, status: 'pending', reminded: false, created_by: 'admin', created_at: iso(-3), completed_at: null, ...over });
  const seedFollowups = () => [
    followup(1, { due_at: iso(1, 16), note: 'Call back about the Q05', customer_id: 1, assigned_to: 81 }),
    followup(2, { due_at: iso(0, 15), note: '', customer_id: 2, assigned_to: 82 }),
    followup(3, { due_at: iso(2, 9), note: 'Nobody\'s', customer_id: 1, assigned_to: null }),
    followup(4, { due_at: iso(1, 9), note: 'Done already', customer_id: 1, assigned_to: 81, status: 'done' }),
    followup(5, { due_at: iso(45, 9), note: 'Far off', customer_id: 1, assigned_to: 81 }),
    followup(6, { due_at: iso(3, 9), note: 'Unknown lead', customer_id: 99, assigned_to: 81 }),
  ];
  const db = createFakeSupabase(
    { employees, sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [], presence: [],
      tasks: seedTasks(), meetings: seedMeetings(), lead_followups: seedFollowups(), customers: [{ id: 1, name: 'Monier Samaha' }, { id: 2, name: 'Layla Hassan' }] },
    { serial: {}, defaults: {} },
  );
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3969 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const reset = () => {
    db.tables.tasks.splice(0, db.tables.tasks.length, ...seedTasks());
    db.tables.meetings.splice(0, db.tables.meetings.length, ...seedMeetings());
    db.tables.lead_followups.splice(0, db.tables.lead_followups.length, ...seedFollowups());
    db.log.length = 0; db.failing.clear();
  };

  ctx.sessions.set('cf-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const TOKEN = { 81: 'cf-ana', 82: 'cf-bo', 83: 'cf-cy', 84: 'cf-dee', 85: 'cf-eli', 86: 'cf-fay' };
  for (const e of everyone) {
    ctx.employeeSessions.set(TOKEN[e.id], { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms(raw[e.id]), createdAt: Date.now() });
  }
  const call = async (path, token) => {
    const r = await fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };
  const queries = (table) => db.log.filter(l => l.method === 'GET' && l.table === table).map(l => decodeURIComponent(l.query));
  const ids = list => (list || []).map(x => x.id);
  const WINDOW = `from=${day(T0)}&to=${day(T0 + 7 * DAY)}`;
  const CLASSIC = { team: '/api/employee/calendar', admin: '/api/dashboard/calendar' };

  // ═══ 1. The classic routes: what they do today ═══════════════════════════════════════════════
  // ── the admin: the company's diary ──
  {
    const r = await call(`${CLASSIC.admin}?${WINDOW}`, 'cf-admin');
    check('the admin gets the window a day wider each side, and the three sources', r.status === 200 && r.body.from === day(T0 - DAY) && r.body.to === day(T0 + 8 * DAY) && Object.keys(r.body).join() === 'from,to,tasks,meetings,followups', JSON.stringify(r.body && [r.body.from, r.body.to, Object.keys(r.body)]));
    check('…tasks by due date inside it, the company\'s whole (nothing without a date, nothing outside)', JSON.stringify(ids(r.body.tasks).sort((a, b) => a - b)) === '[1,2,3,6,7,8]', JSON.stringify(ids(r.body.tasks)));
    check('…asked of the database as: due between the two days, five hundred at most', queries('tasks')[0] === `?select=*&due_date=gte.${day(T0 - DAY)}&due_date=lte.${day(T0 + 8 * DAY)}&limit=500`, queries('tasks')[0]);
    const t1 = r.body.tasks.find(t => t.id === 1);
    check('…each task as the calendar needs it, and no more', JSON.stringify(Object.keys(t1)) === JSON.stringify(['id', 'title', 'description', 'due_date', 'status', 'priority', 'milestone', 'assignee_ids', 'channel_name']) && t1.title === 'Send the Avatr quote' && t1.priority === 'high' && t1.channel_name === 'Sales' && t1.assignee_ids.join() === '81');
    check('…meetings starting inside the window, soonest first, whoever is in them', JSON.stringify(ids(r.body.meetings)) === '[5,2,1,3]', JSON.stringify(ids(r.body.meetings)));
    check('…asked of the database as: starting between the two instants, soonest first, three hundred at most', queries('meetings')[0] === `?select=*&starts_at=gte.${day(T0 - DAY)}T00:00:00.000Z&starts_at=lte.${day(T0 + 8 * DAY)}T00:00:00.000Z&order=starts_at.asc&limit=300`, queries('meetings')[0]);
    check('…a meeting row as stored (the calendar reads its link, length and attendees)', r.body.meetings[1].meet_link === 'huddle:3' && r.body.meetings[2].duration_min === 30 && r.body.meetings[2].attendee_ids.join() === '81');
    check('…pending follow-ups due inside it, soonest first, with the lead\'s name (or none), whoever they are for', JSON.stringify(ids(r.body.followups)) === '[2,1,3,6]' && r.body.followups.map(f => f.customer_name).join('|') === 'Layla Hassan|Monier Samaha|Monier Samaha|', JSON.stringify(r.body.followups));
    check('…asked of the database as: pending, due between the two instants, soonest first, three hundred at most — and the leads\' names in one question', queries('lead_followups')[0] === `?select=*&status=eq.pending&due_at=gte.${day(T0 - DAY)}T00:00:00.000Z&due_at=lte.${day(T0 + 8 * DAY)}T00:00:00.000Z&order=due_at.asc&limit=300` && queries('customers').length === 1 && /^\?select=id,name&id=in\.\(2,1,99\)$/.test(queries('customers')[0].replace(/"/g, '')), `${queries('lead_followups')[0]} | ${queries('customers')}`);
    check('…a follow-up as the calendar needs it', JSON.stringify(Object.keys(r.body.followups[0])) === JSON.stringify(['id', 'due_at', 'note', 'customer_id', 'customer_name']) && r.body.followups[0].note === '');
  }

  // ── a team member: their own ──
  {
    const r = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[81]);
    check('a team member gets their own tasks — by either way a task is assigned — inside the window', r.status === 200 && JSON.stringify(ids(r.body.tasks)) === '[1,6,2]', JSON.stringify(ids(r.body.tasks)));
    check('…the meetings they are in or made, soonest first', JSON.stringify(ids(r.body.meetings)) === '[5,2,1]', JSON.stringify(ids(r.body.meetings)));
    check('…and the follow-ups assigned to them (with the Leads section), pending, in the window', JSON.stringify(ids(r.body.followups)) === '[1,6]', JSON.stringify(ids(r.body.followups)));
    const eli = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[85]);
    check('a task assigned to someone\'s old Slack id is still theirs', JSON.stringify(ids(eli.body.tasks)) === '[7]', JSON.stringify(ids(eli.body.tasks)));
    const bo = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[82]);
    check('each person gets only theirs: Bo has his own tasks and meetings, and no follow-ups without the Leads section — an empty list, not a refusal', bo.status === 200 && JSON.stringify(ids(bo.body.tasks).sort()) === '[3,6]' && JSON.stringify(ids(bo.body.meetings)) === '[2,3]' && bo.body.followups.length === 0, JSON.stringify([ids(bo.body.tasks), ids(bo.body.meetings), bo.body.followups.length]));
    const cy = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[83]);
    check('without the tasks grant there are no tasks (Cy has none he may see), and the rest of the page is still there — the meeting he is in', cy.status === 200 && cy.body.tasks.length === 0 && JSON.stringify(ids(cy.body.meetings)) === '[5]' && cy.body.followups.length === 0, JSON.stringify(cy.body));
    const dee = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[84]);
    check('without the meet grant there are no meetings (Dee is in two), and no refusal', dee.status === 200 && dee.body.meetings.length === 0 && Array.isArray(dee.body.tasks));
    const fay = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[86]);
    check('a person with no Calendar section is not refused either: the feed is gated by its sources, not by the page', fay.status === 200 && JSON.stringify(ids(fay.body.meetings)) === '[5]' && fay.body.tasks.length === 0, JSON.stringify(fay));
  }

  // ── the window, the doors, and a database that fails ──
  {
    const bad = [];
    for (const q of ['from=nope&to=2026-10-20', 'from=2026-10-14&to=nope', 'from=x&to=y']) {
      const r = await call(`${CLASSIC.admin}?${q}`, 'cf-admin');
      if (r.status !== 400 || r.body.error !== 'from and to must be dates') bad.push(`${q}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    check('a window that is not two dates is a 400 that says so', bad.length === 0, bad.join('; '));
    reset();
    const dflt = await call(CLASSIC.admin, 'cf-admin');
    const wide = Date.parse(dflt.body.to) - Date.parse(dflt.body.from);
    check('with no window it is from now for a month, a day wider each side', dflt.status === 200 && Math.abs(Date.parse(dflt.body.from) - (Date.now() - DAY)) < 2 * DAY && wide >= 32 * DAY && wide <= 34 * DAY, JSON.stringify([dflt.body.from, dflt.body.to]));
    const wrong = [];
    for (const [label, token, which] of [['nobody', null, 'team'], ['a token nobody issued', 'cf-nobody', 'team'], ['the admin\'s login', 'cf-admin', 'team'], ['nobody', null, 'admin'], ['an employee\'s login', TOKEN[81], 'admin']]) {
      const got = (await call(`${CLASSIC[which]}?${WINDOW}`, token)).status;
      if (got !== 401) wrong.push(`${which} as ${label}: ${got}`);
    }
    check('nobody, a token nobody issued, and the other portal\'s login are 401 on both portals', wrong.length === 0, wrong.join('; '));
    db.failing.add('meetings');
    const noMeetings = await call(`${CLASSIC.admin}?${WINDOW}`, 'cf-admin');
    check('a source the database cannot read is an empty source, and the page says nothing of it (it cannot tell a quiet month from a failure)', noMeetings.status === 200 && noMeetings.body.meetings.length === 0 && noMeetings.body.tasks.length > 0 && noMeetings.body.followups.length > 0, JSON.stringify(noMeetings.body && [noMeetings.body.tasks.length, noMeetings.body.meetings.length, noMeetings.body.followups.length]));
    db.failing.clear(); db.failing.add('tasks');
    const noTasks = await call(`${CLASSIC.admin}?${WINDOW}`, 'cf-admin');
    check('…and so for tasks', noTasks.status === 200 && noTasks.body.tasks.length === 0 && noTasks.body.meetings.length > 0);
    reset();
  }


  // ═══ 2. /api/v1/calendar: the same feed through the same service, honest about a source it could not read ═══════
  const { schemas } = require(process.cwd() + '/packages/contracts');
  const V1 = '/api/v1/calendar';
  const words = res => JSON.stringify(res.body);
  const noDbWords = res => !/simulated|XX000|PGRST|rows returned/.test(words(res));
  const SOURCES = ['tasks', 'meetings', 'lead_followups', 'customers'];

  // ── the admin: the company's diary ──
  reset();
  {
    const classic = await call(`${CLASSIC.admin}?${WINDOW}`, 'cf-admin');
    const asked = Object.fromEntries(SOURCES.map(t => [t, queries(t)]));
    db.log.length = 0;
    const r = await call(`${V1}?${WINDOW}`, 'cf-admin');
    check('the admin gets the same window and the same three sources', r.status === 200 && r.body.from === classic.body.from && r.body.to === classic.body.to && Object.keys(r.body).join() === 'from,to,tasks,meetings,followups', words(r).slice(0, 200));
    check('…every item is what the contract says it is', schemas.CalendarFeed.safeParse(r.body).success, JSON.stringify(schemas.CalendarFeed.safeParse(r.body).error && schemas.CalendarFeed.safeParse(r.body).error.issues.slice(0, 2)));
    check('…the same tasks, meetings and follow-ups, in the same order', JSON.stringify(ids(r.body.tasks).sort((a, b) => a - b)) === JSON.stringify(ids(classic.body.tasks).sort((a, b) => a - b)) && JSON.stringify(ids(r.body.meetings)) === JSON.stringify(ids(classic.body.meetings)) && JSON.stringify(ids(r.body.followups)) === JSON.stringify(ids(classic.body.followups)) && JSON.stringify(ids(r.body.meetings)) === '[5,2,1,3]', words(r).slice(0, 200));
    check('…asked of the database exactly as the classic page asks', SOURCES.every(t => JSON.stringify(queries(t)) === JSON.stringify(asked[t])) && queries('tasks').length === 1 && queries('customers').length === 1, JSON.stringify(SOURCES.map(t => [t, queries(t).length, asked[t].length])));
    check('…a meeting is a meeting as the Meet page has it: the Google event ids stay on the server', r.body.meetings.every(m => !('calendar_events' in m)) && r.body.meetings[1].meet_link === 'huddle:3' && r.body.meetings[2].attendee_ids.join() === '81');
    check('…and a follow-up carries the lead\'s name, or none for a lead that is gone', r.body.followups.map(f => f.customer_name).join('|') === 'Layla Hassan|Monier Samaha|Monier Samaha|');
    db.tables.tasks.push(task(20, { title: 'Numbers', due_date: day(T0), assignee_ids: [81, '82'] }));
    const numbers = await call(`${V1}?${WINDOW}`, 'cf-admin'), classicNumbers = await call(`${CLASSIC.admin}?${WINDOW}`, 'cf-admin');
    check('who a task is assigned to is always text, even where the row stored numbers (the classic feed hands the row\'s own)', numbers.body.tasks.find(t => t.id === 20).assignee_ids.join() === '81,82' && numbers.body.tasks.find(t => t.id === 20).assignee_ids.every(x => typeof x === 'string') && typeof classicNumbers.body.tasks.find(t => t.id === 20).assignee_ids[0] === 'number' && schemas.CalendarFeed.safeParse(numbers.body).success);
  }

  // ── a team member: their own ──
  reset();
  {
    for (const [who, id] of [['Ana', 81], ['Bo', 82], ['Cy', 83], ['Dee', 84], ['Eli', 85]]) {
      const classic = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[id]);
      const asked = Object.fromEntries(SOURCES.map(t => [t, queries(t)]));
      db.log.length = 0;
      const r = await call(`${V1}?${WINDOW}`, TOKEN[id]);
      const same = r.status === 200 && JSON.stringify(ids(r.body.tasks).sort((a, b) => a - b)) === JSON.stringify(ids(classic.body.tasks).sort((a, b) => a - b)) && JSON.stringify(ids(r.body.meetings)) === JSON.stringify(ids(classic.body.meetings)) && JSON.stringify(ids(r.body.followups)) === JSON.stringify(ids(classic.body.followups));
      check(`${who} gets what the classic page gives them — their tasks, their meetings, their follow-ups — and nothing of anyone else's`, same && schemas.CalendarFeed.safeParse(r.body).success, `${r.status} ${words(r).slice(0, 160)}`);
      if (id === 81) check('…asked of the database exactly as the classic page asks (the employee\'s tasks found both ways)', SOURCES.every(t => JSON.stringify(queries(t)) === JSON.stringify(asked[t])), JSON.stringify(SOURCES.map(t => [t, queries(t).length, asked[t].length])));
      db.log.length = 0;
    }
    const ana = await call(`${V1}?${WINDOW}`, TOKEN[81]);
    check('Ana: the tasks assigned either way, the meetings she is in or made, the follow-ups assigned to her', JSON.stringify(ids(ana.body.tasks)) === '[1,6,2]' && JSON.stringify(ids(ana.body.meetings)) === '[5,2,1]' && JSON.stringify(ids(ana.body.followups)) === '[1,6]', words(ana).slice(0, 200));
    const cy = await call(`${V1}?${WINDOW}`, TOKEN[83]), dee = await call(`${V1}?${WINDOW}`, TOKEN[84]), bo = await call(`${V1}?${WINDOW}`, TOKEN[82]);
    check('each source is gated by what it is, not by the page: no tasks without the tasks grant, no meetings without the meet grant, no follow-ups without Leads — an empty list, not a refusal', cy.status === 200 && cy.body.tasks.length === 0 && cy.body.meetings.length > 0 && dee.status === 200 && dee.body.meetings.length === 0 && Array.isArray(dee.body.tasks) && bo.status === 200 && bo.body.followups.length === 0 && bo.body.tasks.length > 0);
    const fay = await call(`${V1}?${WINDOW}`, TOKEN[86]);
    check('a person with no Calendar section is refused the feed: the page is theirs to open, and the feed is its (the classic routes answered them anyway)', fay.status === 403 && fay.body.error === 'Not permitted', words(fay));
  }

  // ── the window, the doors, and a database that fails ──
  reset();
  {
    const wide = await call(`${V1}?from=${day(T0)}&to=${day(T0 + 7 * DAY)}&_=1699999999`, 'cf-admin');
    check('a parameter the feed does not know (a cache-buster) is ignored', wide.status === 200 && wide.body.from === day(T0 - DAY));
    const instants = await call(`${V1}?from=${encodeURIComponent(new Date(T0).toISOString())}&to=${encodeURIComponent('2026-10-21T09:00:00+02:00')}`, 'cf-admin');
    check('an instant is a window\'s end as well as a day, with or without an offset', instants.status === 200 && instants.body.from === day(T0 - DAY) && instants.body.to === '2026-10-22', words(instants).slice(0, 160));
    const dflt = await call(V1, 'cf-admin');
    const span = Date.parse(dflt.body.to) - Date.parse(dflt.body.from);
    check('with no window it is from now for a month, a day wider each side', dflt.status === 200 && Math.abs(Date.parse(dflt.body.from) - (Date.now() - DAY)) < 2 * DAY && span >= 32 * DAY && span <= 34 * DAY, JSON.stringify([dflt.body.from, dflt.body.to]));
    const bad = [];
    for (const q of ['from=nope&to=2026-10-20', 'from=2026-10-14&to=nope', 'from=x&to=y', 'from=2026-02-30&to=2026-03-02', 'from=2026-10-14T09:00:00&to=2026-10-20', 'from=2026-10-14&from=2026-10-15', 'from=&to=2026-10-20x', 'from[a]=1']) {
      const r = await call(`${V1}?${q}`, 'cf-admin');
      if (r.status !== 400 || r.body.code !== 'invalid' || r.body.error !== 'from and to must be dates' || !Array.isArray(r.body.issues) || !r.body.issues.length) bad.push(`${q}: ${r.status} ${words(r)}`);
    }
    check('a window that is not two dates is a 400 that says so, with what was wrong (the classic route took anything JavaScript can read as a date)', bad.length === 0, bad.join('; '));

    const wrong = [];
    for (const [label, token] of [['nobody', null], ['a token nobody issued', 'cf-nobody']]) {
      const got = (await call(`${V1}?${WINDOW}`, token)).status;
      if (got !== 401) wrong.push(`${label}: ${got}`);
    }
    check('nobody, and a token nobody issued, are 401', wrong.length === 0, wrong.join('; '));

    // a source the database cannot read is said so — not shown as a month with nothing in it
    const down = [];
    for (const table of ['meetings', 'tasks', 'lead_followups', 'customers']) {
      reset(); db.failing.add(table);
      const r = await call(`${V1}?${WINDOW}`, 'cf-admin');
      if (r.status !== 503 || r.body.code !== 'unavailable' || !noDbWords(r)) down.push(`${table}: ${r.status} ${words(r)}`);
    }
    check('as the admin, a database that cannot be asked for the tasks, the meetings, the follow-ups or the leads\' names is a 503 that says so, without its own words (the classic route showed it as an empty source)', down.length === 0, down.join('; '));
    const downFor = [];
    for (const table of ['meetings', 'tasks', 'lead_followups']) {
      reset(); db.failing.add(table);
      const r = await call(`${V1}?${WINDOW}`, TOKEN[81]);
      if (r.status !== 503 || r.body.code !== 'unavailable' || !noDbWords(r)) downFor.push(`${table}: ${r.status} ${words(r)}`);
    }
    check('…and so for a team member, whose tasks are found by asking twice: if either could not be read, the list is not guessed at', downFor.length === 0, downFor.join('; '));
    reset(); db.failing.add('tasks');
    const classicDown = await call(`${CLASSIC.team}?${WINDOW}`, TOKEN[81]);
    check('…where the classic route still shows what it could read', classicDown.status === 200 && classicDown.body.tasks.length === 0 && classicDown.body.meetings.length > 0);
    reset(); db.failing.add('tasks');
    const cyDown = await call(`${V1}?${WINDOW}`, TOKEN[83]);
    check('a source the person is not allowed to see is not asked for, so its failure is not theirs (Cy has no tasks to lose)', cyDown.status === 200 && cyDown.body.tasks.length === 0 && cyDown.body.meetings.length > 0 && queries('tasks').length === 0, `${cyDown.status} ${words(cyDown).slice(0, 120)}`);
    reset();
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
