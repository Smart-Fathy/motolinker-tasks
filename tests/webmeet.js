// The new app's Meet page and Calendar, whole: a real server (the real routes, the Google Calendar writing and the notifications, an
// in-memory database with Google stood in for), the built app, a real browser. tests/meetings.js and tests/calendar.js hold the
// server's side (what each route answers, to whom, and what scheduling does behind the answer); apps/web's own tests hold the
// screens against a script; tests/meetparity.js and tests/calparity.js hold the look to the classic pages'. This is the three
// working together —
//
//   the admin schedules a meeting from the Meet page: stored, written to the company's Google Calendar with its invitees, the
//   attendees told; edits it (the event is patched, nobody told again) and cancels it (the event is removed)
//   a team member schedules from the Calendar — a double-click on a day — and it is on that day without a reload, and on the Meet page
//   the Calendar draws tasks, meetings and follow-ups; a busy day opens whole; a meeting opens with its Join; Edit opens that meeting
//   somebody who may only see meetings sees them and is offered nothing to change, and the server refuses when asked anyway
//   somebody who may not see them gets the cards and no list (the server is not asked), and the Calendar without meetings
//   a huddle is joined in the classic portal, at its room; Join opens the link
//   a server that cannot read says so; the classic routes see what the app did; #meet and #calendar open the pages
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-meet-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
  const days = n => new Date(TODAY.getTime() + n * DAY);
  const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const db = createFakeSupabase(seedTables(parseSchema()), {
    serial: { meetings: 100 },
    defaults: { notifications: () => ({ read: false }) },
  });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3972, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  // ── Google, stood in for: the token functions the server asks the context for, and the one Google endpoint it calls itself ──
  const google = { calls: [] };
  ctx.getCalendarToken = async () => 'co-token';
  ctx.getEmployeeCalendarToken = async () => null;
  ctx.upsertCalendarEvent = async (token, body, existingId) => ({ id: existingId || 'personal-' + token });
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (!/^https:\/\/www\.googleapis\.com\/calendar\/v3\//.test(String(url))) return realFetch(url, init);
    const method = (init && init.method) || 'GET';
    google.calls.push({ method, url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (method === 'DELETE') return new Response('', { status: 204 });
    const id = /\/events\/([^?]+)/.exec(String(url));
    return new Response(JSON.stringify({ id: id ? decodeURIComponent(id[1]) : 'co-ev-' + google.calls.length, hangoutLink: 'https://meet.google.com/minted-by-google' }), { status: 200 });
  };

  // ── the people ───────────────────────────────────────────────────────────────────────────
  //   Ana  schedules (the default), and may see leads     Bo  may see meetings, not schedule     Cy  may not see them at all
  const RAW = { 81: { leads: true, leadsActions: { view: true } }, 82: { meet: true, meetActions: { view: true, schedule: false } }, 83: { meet: true, meetActions: { view: false, schedule: false } } };
  const person = (id, name) => ({ ...db.tables.employees[0], id, name, username: name.toLowerCase(), job_title: 'Sales', permissions: RAW[id], email: name.toLowerCase() + '@example.com' });
  db.tables.employees = db.tables.employees.filter(e => !RAW[e.id]).concat([person(81, 'Ana'), person(82, 'Bo'), person(83, 'Cy')]);
  const PEOPLE = {
    admin: { portal: 'admin', token: 'wm-admin', key: 'ml_admin_token', route: '/dashboard' },
    ana: { portal: 'team', token: 'wm-ana', key: 'ml_emp_token', route: '/employee', id: 81 },
    bo: { portal: 'team', token: 'wm-bo', key: 'ml_emp_token', route: '/employee', id: 82 },
    cy: { portal: 'team', token: 'wm-cy', key: 'ml_emp_token', route: '/employee', id: 83 },
  };
  ctx.sessions.set(PEOPLE.admin.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const p of Object.values(PEOPLE)) if (p.id) {
    const e = db.tables.employees.find(x => x.id === p.id);
    ctx.employeeSessions.set(p.token, { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms(RAW[e.id]), createdAt: Date.now() });
  }

  const seed = () => {
    const made = at(days(-3), 9);
    db.tables.meetings.splice(0, db.tables.meetings.length,
      { id: 1, title: 'Weekly sales sync', description: 'Agenda', starts_at: at(days(2), 10), duration_min: 45, attendee_ids: ['81', '82'], meet_link: 'https://meet.google.com/abc-defg-hij', calendar_events: { company: 'co-ev-1' }, created_by: 'admin', created_at: made },
      { id: 2, title: 'Procurement huddle', description: '', starts_at: at(TODAY, 14), duration_min: 30, attendee_ids: ['81'], meet_link: 'huddle:1', calendar_events: {}, created_by: 'employee_81', created_at: made },
      { id: 3, title: 'Late morning check-in', description: '', starts_at: at(TODAY, 11), duration_min: 30, attendee_ids: ['81'], meet_link: '', calendar_events: {}, created_by: 'admin', created_at: made });
    db.tables.tasks.splice(0, db.tables.tasks.length,
      { id: 1, title: 'Send the Avatr quote', description: '', channel_id: 'c', channel_name: 'Sales', assignee_id: '81', assignee_ids: ['81'], due_date: keyOf(TODAY), priority: 'high', milestone: '', status: 'todo', created_by: 'admin', created_at: made },
      { id: 2, title: 'Chase the shipping agent', description: '', channel_id: 'c', channel_name: 'Sales', assignee_id: '81', assignee_ids: ['81'], due_date: keyOf(TODAY), priority: 'medium', milestone: '', status: 'done', created_by: 'admin', created_at: made });
    db.tables.lead_followups.splice(0, db.tables.lead_followups.length,
      { id: 1, customer_id: 1, due_at: at(TODAY, 16), note: 'Call back', assigned_to: 81, status: 'pending', reminded: false, created_by: 'admin', created_at: made, completed_at: null });
    db.tables.customers.splice(0, db.tables.customers.length, { id: 1, name: 'Monier Samaha' });
    db.tables.notifications.splice(0);
    db.failing.clear(); db.latency = 0;
    google.calls.length = 0;
  };
  seed();
  const meeting = id => db.tables.meetings.find(m => m.id === id);
  const titled = t => db.tables.meetings.find(m => m.title === t);
  const told = member => db.tables.notifications.filter(n => n.member_key === member);
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, url) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const requests = [];
    page.on('request', r => { if (/\/api\/v1\/(meetings|calendar)/.test(r.url())) requests.push({ method: r.method(), url: r.url().replace(base, '') }); });
    page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(); });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => {
      window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; };
      window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; };
    });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + (url || '/home'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { requests, dialogs: [], shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel);
  const where = page => page.evaluate(() => location.pathname);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const type = async (page, sel, words) => { await page.click(sel); await page.keyboard.type(words); };
  const toasts = page => page.evaluate(() => [...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent.trim()));
  const names = page => page.evaluate(() => [...document.querySelectorAll('[data-part=meeting] [data-part=name]')].map(e => e.textContent.trim()));
  const rowOf = (page, title) => page.evaluate(t => { const r = [...document.querySelectorAll('[data-part=meeting]')].find(e => e.querySelector('[data-part=name]').textContent === t); if (!r) return null; return [...r.querySelectorAll('button,a')].map(b => b.textContent.trim()); }, title);
  const pressIn = (page, title, part) => page.evaluate((t, p) => { const r = [...document.querySelectorAll('[data-part=meeting]')].find(e => e.querySelector('[data-part=name]').textContent === t); r.querySelector(`[data-part=${p}]`).click(); }, title, part);
  // a date or a time is set the way the browser does it: through the element's own setter, so that the page hears an input
  const setValue = (page, sel, value) => page.evaluate((s, v) => { const el = document.querySelector(s); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, value);
  const choose = async (page, sel, option) => { await press(page, sel); await page.evaluate(o => [...document.querySelectorAll('[role=option]')].find(x => x.textContent === o).click(), option); };
  const tick = (page, name) => page.evaluate(n => { [...document.querySelectorAll('[data-part=attendee]')].find(l => l.textContent.trim() === n).querySelector('input').click(); }, name);
  const api = async (method, urlPath, token, body) => {
    const r = await fetch(base + urlPath, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text();
    let json = null; try { json = JSON.parse(raw); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };
  const OUT = day => `[data-part=day][data-day="${keyOf(day)}"]`;
  const chipTexts = (page, day) => page.evaluate(s => [...document.querySelectorAll(s + ' [data-part=chip]')].map(e => e.textContent.trim()), OUT(day));

  // ═══ 1. the admin schedules, edits and cancels, from the Meet page ═══════════════════════
  {
    seed();
    const page = await open(PEOPLE.admin, '/meet');
    check('the admin opens Meet: the cards, and the upcoming meetings soonest first', await until(page, () => document.querySelectorAll('[data-part=meeting]').length === 3) && (await names(page)).join('|') === 'Late morning check-in|Procurement huddle|Weekly sales sync' && await where(page) === '/dashboard/meet', (await names(page)).join('|'));
    check('…asked of /api/v1 once, and the classic route is not asked', page.requests.filter(r => r.method === 'GET' && r.url === '/api/v1/meetings').length === 1 && !page.requests.some(r => /dashboard\/meetings/.test(r.url)), JSON.stringify(page.requests));

    const when = days(4);
    await press(page, '[data-part=schedule]');
    check('"Schedule a meeting" opens the sheet, with the people to invite', await until(page, () => document.querySelectorAll('[data-part=attendee]').length >= 3) && await text(page, '[role=dialog] [data-part=title]') === 'Schedule a meeting');
    await type(page, '[data-part=titleInput]', 'Quarterly review');
    await setValue(page, '[data-part=dateInput]', keyOf(when));
    await setValue(page, '[data-part=timeInput]', '14:15');
    await choose(page, '[data-part=durationSelect]', '90 min');
    await tick(page, 'Ana'); await tick(page, 'Bo');
    await type(page, '[data-part=notesInput]', 'Numbers first');
    await press(page, '[role=dialog] [data-part=submit]');
    check('scheduling stores the meeting as filled in, made by the admin', await waitFor(() => { const m = titled('Quarterly review'); return m && m.created_by === 'admin' && m.duration_min === 90 && m.attendee_ids.join() === '81,82' && m.description === 'Numbers first' && m.starts_at === new Date(when.getFullYear(), when.getMonth(), when.getDate(), 14, 15).toISOString(); }), JSON.stringify(titled('Quarterly review')));
    check('…the person is told, the sheet is gone, and the meeting is in the list', await until(page, () => /lands on every attendee/.test(document.querySelector('[data-part=toast]')?.textContent || '')) && !(await page.$('[role=dialog]')) && await until(page, () => document.querySelectorAll('[data-part=meeting]').length === 4) && (await names(page)).includes('Quarterly review'));
    const made = titled('Quarterly review');
    check('…behind the answer, the company\'s Google Calendar is asked for the event, inviting the attendees, with a Meet link to make', await waitFor(() => google.calls.some(c => c.method === 'POST' && c.body.summary === 'Quarterly review')) && (() => { const c = google.calls.find(x => x.body && x.body.summary === 'Quarterly review'); return JSON.stringify(c.body.attendees) === '[{"email":"ana@example.com"},{"email":"bo@example.com"}]' && c.body.conferenceData.createRequest.requestId === 'ml-meet-' + made.id; })(), JSON.stringify(google.calls.map(c => [c.method, c.url])));
    check('…the event\'s id and the link Google made are kept on the meeting', await waitFor(() => meeting(made.id).calendar_events.company === 'co-ev-' + (google.calls.findIndex(c => c.body && c.body.summary === 'Quarterly review') + 1) && meeting(made.id).meet_link === 'https://meet.google.com/minted-by-google'), JSON.stringify(meeting(made.id)));
    check('…and each attendee is told by the admin\'s name, with the link to the Meet page', await waitFor(() => told('employee_81').length === 1 && told('employee_82').length === 1) && told('employee_81')[0].title === 'Admin scheduled a meeting' && told('employee_81')[0].url === '/employee#meet', JSON.stringify(db.tables.notifications.map(n => [n.member_key, n.title])));

    // edit
    google.calls.length = 0; db.tables.notifications.splice(0);
    await pressIn(page, 'Quarterly review', 'edit');
    check('Edit opens the meeting as it stands', await until(page, () => document.querySelector('[role=dialog] [data-part=titleInput]')?.value === 'Quarterly review') && await text(page, '[role=dialog] [data-part=title]') === 'Edit meeting' && await text(page, '[data-part=durationSelect]') === '90 min' && await page.evaluate(() => [...document.querySelectorAll('[data-part=attendee] input')].filter(i => i.checked).length) === 2);
    await page.click('[data-part=titleInput]', { clickCount: 3 });
    await page.keyboard.type('Quarterly review (moved)');
    await press(page, '[role=dialog] [data-part=submit]');
    check('saving stores the change and says calendars re-sync', await waitFor(() => meeting(made.id).title === 'Quarterly review (moved)') && await until(page, () => /calendars re-sync/.test(document.querySelector('[data-part=toast]')?.textContent || '')));
    check('…the event is patched rather than made again, and nobody is told again', await waitFor(() => google.calls.some(c => c.method === 'PATCH' && /events\/co-ev-/.test(c.url))) && google.calls.every(c => c.method !== 'POST') && (await sleep(200), db.tables.notifications.length === 0), JSON.stringify(google.calls.map(c => [c.method, c.url])));
    check('…and the list shows the new name', await until(page, () => [...document.querySelectorAll('[data-part=meeting] [data-part=name]')].some(e => e.textContent === 'Quarterly review (moved)')));

    // cancel
    google.calls.length = 0;
    await pressIn(page, 'Quarterly review (moved)', 'cancel');
    check('Cancel asks first, then removes the meeting', await waitFor(() => !meeting(made.id)) && page.dialogs.includes('Cancel this meeting? Calendar events are removed for everyone.') && await until(page, () => document.querySelectorAll('[data-part=meeting]').length === 3));
    check('…and its event is removed from the company\'s Google Calendar', await waitFor(() => google.calls.some(c => c.method === 'DELETE' && /events\/co-ev-/.test(c.url))), JSON.stringify(google.calls.map(c => [c.method, c.url])));
    await page.shut();
  }

  // ═══ 2. a team member schedules from the Calendar ════════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.ana, '/calendar');
    const quiet = t => t.replace(/^\d\d:\d\d\s?(AM|PM)?\s*/, '');
    check('Ana opens the Calendar: today has her meetings and her call in the order they happen, and the tasks behind "+2 more"', await until(page, s => document.querySelectorAll(s + ' [data-part=chip]').length === 3, OUT(TODAY)) && (await chipTexts(page, TODAY)).map(quiet).join('|') === 'Late morning check-in|Procurement huddle|Monier Samaha' && await text(page, `${OUT(TODAY)} [data-part=more]`) === '+2 more', JSON.stringify(await chipTexts(page, TODAY)));
    const first = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1); first.setDate(first.getDate() - first.getDay());
    const last = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0); last.setDate(last.getDate() + (6 - last.getDay()));
    const shown = iso => { const d = new Date(iso); return d >= first && d <= new Date(last.getTime() + DAY - 1); };
    const expectedMeetings = db.tables.meetings.filter(m => m.attendee_ids.includes('81') && shown(m.starts_at)).length;
    check('…the legend counts what is on show', (await page.evaluate(() => [...document.querySelectorAll('[data-part=key]')].map(e => e.textContent))).join('|') === `${expectedMeetings} meetings|2 tasks|1 follow-up`, (await page.evaluate(() => [...document.querySelectorAll('[data-part=key]')].map(e => e.textContent))).join('|') + ` (wanted ${expectedMeetings} meetings)`);
    check('…the feed was asked of /api/v1 for the weeks of the month', page.requests.some(r => /^\/api\/v1\/calendar\?from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/.test(r.url)) && !page.requests.some(r => /\/api\/employee\/calendar/.test(r.url)), JSON.stringify(page.requests));

    await press(page, '[data-part=next]');
    const target = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 15);
    check('Next goes to the next month, asking for it', await until(page, s => !!document.querySelector(s), OUT(target)) && page.requests.some(r => r.url.startsWith('/api/v1/calendar?from=') && r.url !== page.requests[0].url));
    await page.evaluate(s => { const el = document.querySelector(s); el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }, OUT(target));
    check('a double-click on a day opens the scheduling sheet on that day, at ten', await until(page, () => !!document.querySelector('[role=dialog] [data-part=titleInput]')) && await page.evaluate(() => document.querySelector('[data-part=dateInput]').value) === keyOf(target) && await page.evaluate(() => document.querySelector('[data-part=timeInput]').value) === '10:00');
    await type(page, '[data-part=titleInput]', 'Showroom walk-through');
    await press(page, '[role=dialog] [data-part=submit]');
    check('scheduling stores the meeting under her name', await waitFor(() => { const m = titled('Showroom walk-through'); return m && m.created_by === 'employee_81'; }));
    check('…and it is on that day of the calendar without a reload', await until(page, s => [...document.querySelectorAll(s + ' [data-part=chip]')].some(e => /Showroom walk-through/.test(e.textContent)), OUT(target)), JSON.stringify(await chipTexts(page, target)));
    await page.goto(base + '/employee/meet', { waitUntil: 'domcontentloaded' });
    check('…and in her list on the Meet page', await until(page, () => [...document.querySelectorAll('[data-part=meeting] [data-part=name]')].some(e => e.textContent === 'Showroom walk-through')));
    await page.shut();
  }

  // ═══ 3. the Calendar: a busy day, a meeting, the huddle, the task ════════════════════════
  {
    seed();
    db.tables.tasks.push({ id: 3, title: 'Plan the week', description: '', channel_id: 'c', channel_name: 'Sales', assignee_id: '81', assignee_ids: ['81'], due_date: keyOf(TODAY), priority: 'low', milestone: '', status: 'todo', created_by: 'admin', created_at: at(days(-3), 9) });
    const page = await open(PEOPLE.admin, '/calendar');
    check('the admin\'s calendar is the company\'s: a busy day shows three things and "+3 more"', await until(page, s => document.querySelectorAll(s + ' [data-part=chip]').length === 3, OUT(TODAY)) && await text(page, `${OUT(TODAY)} [data-part=more]`) === '+3 more', await text(page, `${OUT(TODAY)} [data-part=more]`));
    await press(page, `${OUT(TODAY)} [data-part=more]`);
    check('"+3 more" opens the whole day, named by its day', await until(page, () => document.querySelectorAll('[role=dialog] [data-part=chip]').length === 6) && /,/.test(await text(page, '[role=dialog] [data-part=title]') || ''));
    await press(page, '[role=dialog] [data-part=dayrow]:nth-child(2) [data-part=chip]');
    check('a meeting in it opens with when, how long and how many, and Join', await until(page, () => document.querySelector('[role=dialog] [data-part=title]')?.textContent === 'Procurement huddle') && /30 min · 1 attendee\(s\)/.test(await text(page, '[data-part=detail]') || '') && /audio in MotoLinker/.test(await text(page, '[data-part=huddleNote]') || ''));
    await press(page, '[role=dialog] [data-part=join]');
    check('Join huddle opens the huddle\'s room in the classic portal, in a new tab, and the sheet goes', JSON.stringify(await page.evaluate(() => window.__opened)) === '[["/legacy/dashboard?chat=1","_blank","noopener"]]' && await until(page, () => !document.querySelector('[role=dialog]')), JSON.stringify(await page.evaluate(() => window.__opened)));
    await press(page, `${OUT(TODAY)} [data-part=chip]:nth-of-type(1)`);
    await until(page, () => !!document.querySelector('[role=dialog] [data-part=edit]'));
    await press(page, '[role=dialog] [data-part=edit]');
    check('Edit from the Calendar opens that meeting itself — its name, not a blank sheet', await until(page, () => document.querySelector('[role=dialog] [data-part=titleInput]')?.value === 'Late morning check-in') && await text(page, '[role=dialog] [data-part=title]') === 'Edit meeting');
    await press(page, '[role=dialog] [data-part=cancel]');
    await until(page, () => !document.querySelector('[role=dialog]'));
    await press(page, `${OUT(TODAY)} [data-part=more]`);
    await until(page, () => !!document.querySelector('[role=dialog] [data-part=chip][data-kind=task]'));
    await press(page, '[role=dialog] [data-part=chip][data-kind=task]');
    check('a task goes to Tasks', await until(page, () => location.pathname === '/dashboard/tasks'), await where(page));
    await page.shut();

    const week = await open(PEOPLE.admin, '/calendar');
    await until(week, s => document.querySelectorAll(s + ' [data-part=chip]').length === 3, OUT(TODAY));
    await press(week, '[data-part=view][data-view=week]');
    check('the week shows everything on every day, and asks for the week', await until(week, () => document.querySelectorAll('[data-part=day]').length === 7) && await until(week, s => document.querySelectorAll(s + ' [data-part=chip]').length === 6, OUT(TODAY)) && !(await week.$('[data-part=more]')) && week.requests.some(r => /^\/api\/v1\/calendar\?from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/.test(r.url)));
    await week.shut();
  }

  // ═══ 4. somebody who may only see meetings ═══════════════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.bo, '/meet');
    check('Bo sees the upcoming meetings, can join them, and is offered nothing to schedule, change or cancel', await until(page, () => document.querySelectorAll('[data-part=meeting]').length === 3) && !(await page.$('[data-part=schedule]')) && !(await page.$('[data-part=edit]')) && !(await page.$('[data-part=meeting] [data-part=cancel]')) && JSON.stringify(await rowOf(page, 'Weekly sales sync')) === '["Join"]', JSON.stringify(await rowOf(page, 'Weekly sales sync')));
    await page.goto(base + '/employee/calendar', { waitUntil: 'domcontentloaded' });
    check('…nor a New event on the Calendar', await until(page, () => document.querySelectorAll('[data-part=day]').length >= 28) && !(await page.$('[data-part=newEvent]')));
    const refused = await api('POST', '/api/v1/meetings', PEOPLE.bo.token, { title: 'Sneaky', starts_at: new Date(Date.now() + DAY).toISOString() });
    const refusedPut = await api('PUT', '/api/v1/meetings/1', PEOPLE.bo.token, { title: 'Sneaky', starts_at: new Date(Date.now() + DAY).toISOString() });
    const refusedDel = await api('DELETE', '/api/v1/meetings/1', PEOPLE.bo.token);
    check('…and the server refuses when asked anyway, changing nothing', refused.status === 403 && refusedPut.status === 403 && refusedDel.status === 403 && !titled('Sneaky') && meeting(1) && meeting(1).title === 'Weekly sales sync', JSON.stringify([refused.status, refusedPut.status, refusedDel.status]));
    await page.shut();
  }

  // ═══ 5. somebody who may not ═════════════════════════════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.cy, '/meet');
    check('Cy gets the cards and no list — and the server is not asked for one', await page.waitForSelector('[data-part=cards]').then(() => true) && await sleep(400) === undefined && !(await page.$('[data-part=listHead]')) && !page.requests.some(r => r.url === '/api/v1/meetings'), JSON.stringify(page.requests));
    db.tables.tasks.push({ id: 9, title: 'Cy\'s own task', description: '', channel_id: 'c', channel_name: 'Sales', assignee_id: '83', assignee_ids: ['83'], due_date: keyOf(TODAY), priority: 'low', milestone: '', status: 'todo', created_by: 'admin', created_at: at(days(-3), 9) });
    await page.goto(base + '/employee/calendar', { waitUntil: 'domcontentloaded' });
    check('…the Calendar is theirs, with their task and not the meetings they may not see (nor the calls of a Leads section they do not have)', await until(page, s => document.querySelectorAll(s + ' [data-part=chip]').length === 1, OUT(TODAY)) && (await page.evaluate(s => [...document.querySelectorAll(s + ' [data-part=chip]')].map(e => e.getAttribute('data-kind') + ':' + e.textContent.trim()), OUT(TODAY))).join() === "task:Cy's own task");
    const refused = await api('GET', '/api/v1/meetings', PEOPLE.cy.token);
    check('…and the server refuses the list', refused.status === 403, JSON.stringify(refused));
    await page.shut();
  }

  // ═══ 6. a server that cannot read; the classic routes; the links ═════════════════════════
  {
    seed();
    db.failing.add('meetings');
    const page = await open(PEOPLE.ana, '/meet');
    check('a server that cannot read the meetings says so, rather than "nothing scheduled", which would be untrue', await until(page, () => /unavailable right now/.test(document.querySelector('[data-part=meetings]')?.textContent || ''), null, 30000) && !/Nothing scheduled/.test(await text(page, '[data-part=meetings]') || ''));
    await page.goto(base + '/employee/calendar', { waitUntil: 'domcontentloaded' });
    check('…and so does the Calendar, rather than showing a month with nothing in it', await until(page, () => /unavailable right now/.test(document.querySelector('[data-part=error]')?.textContent || ''), null, 30000));
    db.failing.clear();
    await page.shut();

    seed();
    const classic = await api('GET', '/api/employee/meetings', PEOPLE.ana.token);
    check('the classic route sees the same meetings (one service)', classic.status === 200 && classic.body.length === 3 && classic.body.some(m => m.title === 'Weekly sales sync'));
    const link = await open(PEOPLE.ana, '');
    await link.goto(base + '/employee#meet', { waitUntil: 'domcontentloaded' });
    check('a link to #meet, as the notifications carry, opens the Meet page', await until(link, () => location.pathname === '/employee/meet' && !!document.querySelector('[data-part=meetPage]')), await where(link));
    await link.goto(base + '/employee#calendar', { waitUntil: 'domcontentloaded' });
    check('…and #calendar the Calendar', await until(link, () => location.pathname === '/employee/calendar' && !!document.querySelector('[data-part=calendarPage]')), await where(link));
    await link.shut();
  }

  global.fetch = realFetch;
  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
