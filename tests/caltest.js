// The calendar, in both portals, against the real feed shape.
//
// The page used to be an <iframe> of Google's generic embed: a task assigned
// with a due date did not appear on it, and neither did a meeting scheduled
// through the platform, because the page never asked the server for anything.
// These checks are about that — the grid draws what MotoLinker knows, and the
// server hands each portal only what its caller is entitled to.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const pad = n => String(n).padStart(2, '0');
const D = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const at = (h, plusDays) => {
  const x = new Date(today); x.setDate(x.getDate() + (plusDays || 0)); x.setHours(h, 0, 0, 0); return x;
};
const FEED = {
  tasks: [
    { id: 11, title: 'Send the Avatr quote', description: 'Full spec sheet', due_date: D(today),
      status: 'todo', priority: 'high', assignee_ids: ['2'], channel_name: 'Sales' },
    { id: 12, title: 'Chase the shipping agent', due_date: D(at(9, -3)), status: 'todo', priority: 'medium' },
  ],
  meetings: [
    { id: 21, title: 'Weekly sales sync', starts_at: at(10).toISOString(), duration_min: 30,
      attendee_ids: ['2'], meet_link: 'https://meet.google.com/abc-defg-hij', description: 'Pipeline review' },
    { id: 22, title: 'Procurement huddle', starts_at: at(14).toISOString(), duration_min: 45,
      attendee_ids: ['2'], meet_link: 'huddle:3', description: '' },
  ],
  followups: [{ id: 31, due_at: at(16).toISOString(), note: 'Call back about the Q05', customer_id: 9,
                customer_name: 'Monier Samaha' }],
};
let feedCalls = [], meetingPosts = [];

function api(pathname, method, body) {
  if (/\/calendar$/.test(pathname)) { feedCalls.push(pathname); return FEED; }
  if (/\/meetings$/.test(pathname)) {
    if (method === 'POST') { meetingPosts.push(JSON.parse(body || '{}')); return { ok: true, id: 99 }; }
    return FEED.meetings;
  }
  if (/employees-for-tasks$|coworkers$/.test(pathname)) return [{ id: 2, name: 'Sara Ahmed' }];
  if (/chat\/rooms$/.test(pathname)) return [{ id: 3, type: 'group', name: 'Procurement', members: [] }];
  if (/huddle\/live$/.test(pathname)) return [];
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
  if (perms) { await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, perms); await sleep(150); }
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
      perms: { calendar: true, meet: true, meetActions: { view: true, schedule: true }, tasks: true,
               tasksActions: { view: true }, leads: true, leadsActions: { view: true }, chat: true,
               chatActions: { view: true, huddle: true } } },
  ]) {
    feedCalls = []; meetingPosts = [];
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(() => navigate('calendar'));
    await sleep(700);

    const grid = await page.evaluate(() => {
      const host = document.getElementById('ml-calendar');
      return {
        exists: !!host,
        iframe: !!document.querySelector('#page-calendar iframe'),
        days: host ? host.querySelectorAll('.cal-day').length : 0,
        meetings: [...(host ? host.querySelectorAll('.cal-chip.cal-meeting') : [])].map(c => c.textContent.trim()),
        tasks: [...(host ? host.querySelectorAll('.cal-chip.cal-task') : [])].map(c => c.textContent.trim()),
        followups: [...(host ? host.querySelectorAll('.cal-chip.cal-followup') : [])].map(c => c.textContent.trim()),
        overdue: !!(host && host.querySelector('.cal-chip.cal-task.overdue')),
        legend: host ? host.querySelector('.cal-legend').textContent.replace(/\s+/g, ' ').trim() : '',
        today: !!(host && host.querySelector('.cal-day.today')),
      };
    });
    check(`${portal.label}: the calendar is MotoLinker's, not an embedded iframe`,
      grid.exists === true && grid.iframe === false, JSON.stringify({ e: grid.exists, i: grid.iframe }));
    check(`${portal.label}: it asks its own portal for the feed`,
      feedCalls.length >= 1 && feedCalls.every(p => p.startsWith(portal.apiBase)), JSON.stringify(feedCalls));
    check(`${portal.label}: a month is six weeks of days`, grid.days === 42, String(grid.days));
    check(`${portal.label}: the scheduled meetings are on it`,
      grid.meetings.some(t => /Weekly sales sync/.test(t)) && grid.meetings.some(t => /Procurement huddle/.test(t)),
      JSON.stringify(grid.meetings));
    // A busy day shows three and counts the rest, like every calendar does; the
    // day sheet is where the fourth thing lives.
    const busy = await page.evaluate(async () => {
      const more = document.querySelector('#ml-calendar .cal-day.today .cal-more');
      const label = more ? more.textContent.trim() : null;
      if (more) more.click();
      await new Promise(r => setTimeout(r, 200));
      const sheet = document.getElementById('modal-body').textContent.replace(/\s+/g, ' ').trim();
      CALCFG.closeModal();
      return { label, sheet };
    });
    check(`${portal.label}: the task with a due date is on it`,
      grid.tasks.some(t => /Send the Avatr quote/.test(t)) || /Send the Avatr quote/.test(busy.sheet),
      JSON.stringify({ chips: grid.tasks, more: busy.label }));
    check(`${portal.label}: a busy day counts what it could not fit, and the day sheet has it all`,
      /^\+\d+ more$/.test(String(busy.label)) && /Weekly sales sync/.test(busy.sheet)
      && /Send the Avatr quote/.test(busy.sheet), JSON.stringify(busy.label));
    check(`${portal.label}: an overdue task is marked`, grid.overdue === true);
    check(`${portal.label}: the lead follow-up is on it`,
      grid.followups.some(t => /Monier Samaha/.test(t)), JSON.stringify(grid.followups));
    check(`${portal.label}: today is marked and the counts add up`,
      grid.today === true && /2 meetings/.test(grid.legend) && /2 tasks/.test(grid.legend)
      && /1 follow-up/.test(grid.legend), grid.legend);

    // Week view, and stepping through time.
    const nav = await page.evaluate(async () => {
      const title = () => document.querySelector('#ml-calendar .cal-title').textContent.trim();
      const monthTitle = title();
      calStep(1);
      await new Promise(r => setTimeout(r, 400));
      const next = title();
      calToday();
      await new Promise(r => setTimeout(r, 400));
      calView('week');
      await new Promise(r => setTimeout(r, 400));
      return { monthTitle, next, weekDays: document.querySelectorAll('#ml-calendar .cal-day').length,
               weekTitle: title() };
    });
    check(`${portal.label}: stepping a month changes the month`,
      nav.next !== nav.monthTitle, JSON.stringify(nav));
    check(`${portal.label}: the week view is seven days`, nav.weekDays === 7, String(nav.weekDays));

    // A huddle meeting joins in-app; a Meet one opens the link.
    const join = await page.evaluate(async () => {
      calView('month');
      await new Promise(r => setTimeout(r, 400));
      window.__joined = null;
      window.huddleJoinExisting = id => { window.__joined = id; };
      calOpen('meeting', 22);
      await new Promise(r => setTimeout(r, 150));
      const foot = document.getElementById('modal-footer').textContent.replace(/\s+/g, ' ').trim();
      document.querySelector('#modal-footer .btn-primary').click();
      await new Promise(r => setTimeout(r, 150));
      const joined = window.__joined;
      calOpen('meeting', 21);
      await new Promise(r => setTimeout(r, 150));
      const link = document.querySelector('#modal-footer a[href*="meet.google.com"]');
      const href = link ? link.getAttribute('href') : null;
      CALCFG.closeModal();
      return { foot, joined, href };
    });
    check(`${portal.label}: a huddle meeting joins the in-app huddle`,
      /Join huddle/.test(join.foot) && join.joined === 3, JSON.stringify(join));
    check(`${portal.label}: a Meet meeting still opens its link`,
      join.href === 'https://meet.google.com/abc-defg-hij', String(join.href));

    // Scheduling from the calendar, seeded with the day that was clicked.
    const sched = await page.evaluate(async () => {
      calNewEvent('2026-09-15');
      await new Promise(r => setTimeout(r, 400));
      const date = (document.getElementById('mt-date') || {}).value;
      const where = !!document.getElementById('mt-where');
      // Book it as an in-app huddle in the Procurement room.
      document.getElementById('mt-title').value = 'Kickoff';
      document.getElementById('mt-where').value = 'huddle';
      mtWhereChanged();
      const roomShown = document.getElementById('mt-room-wrap').style.display !== 'none';
      await saveMeeting(null);
      await new Promise(r => setTimeout(r, 250));
      return { date, where, roomShown };
    });
    check(`${portal.label}: New event opens the scheduler on the day clicked`,
      sched.date === '2026-09-15' && sched.where === true, JSON.stringify(sched));
    check(`${portal.label}: a meeting can be booked as an in-app huddle`,
      sched.roomShown === true && meetingPosts.length === 1 && meetingPosts[0].meet_link === 'huddle:3'
      && meetingPosts[0].title === 'Kickoff', JSON.stringify(meetingPosts));
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── A rep without the meet grant may look, not book ─────────────────────────
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { calendar: true, meet: true, meetActions: { view: true, schedule: false },
               tasks: true, tasksActions: { view: true } } });
    await page.evaluate(() => navigate('calendar'));
    await sleep(700);
    const ro = await page.evaluate(() => ({
      newEvent: [...document.querySelectorAll('#ml-calendar button')].some(b => /New event/.test(b.textContent)),
      chips: document.querySelectorAll('#ml-calendar .cal-chip').length,
    }));
    check('without meet.schedule there is no New event, but the diary still shows',
      ro.newEvent === false && ro.chips > 0, JSON.stringify(ro));
    await page.close();
  }

  await browser.close();
  srv.close();

  // ── The feed's own rules ────────────────────────────────────────────────────
  {
    const SRC = fs.readFileSync('src/routes/calendar-feed.js', 'utf8');
    check('the feed is mounted for both portals',
      /mountCalendarFeed\('\/api\/dashboard', requireAuth\)/.test(SRC)
      && /mountCalendarFeed\('\/api\/employee', requireEmployeeAuth\)/.test(SRC));
    check('an employee gets THEIR tasks, through the one function that knows who owns what',
      /fetchEmployeeTasks\(emp\.id\)/.test(SRC));
    check('…their meetings, not the company diary',
      /attendee_ids \|\| \[\]\)\.map\(String\)\.includes\(String\(emp\.id\)\)/.test(SRC));
    check('…and their follow-ups', /q\.eq\('assigned_to', emp\.id\)/.test(SRC));
    check('each source is gated on its own permission, so one refusal is not the page',
      /may\('tasks', 'view'\)/.test(SRC) && /may\('meet', 'view'\)/.test(SRC)
      && /may\('leads', 'view'\)/.test(SRC));
    const DASH_HTML = fs.readFileSync('public/dashboard.html', 'utf8');
    const EMP_HTML = fs.readFileSync('public/employee.html', 'utf8');
    check('neither portal still embeds the Google calendar iframe',
      !/calendar\.google\.com\/calendar\/embed/.test(DASH_HTML)
      && !/calendar\.google\.com\/calendar\/embed/.test(EMP_HTML));
    check('both still link out to Google, where the meetings also land',
      /calendar\.google\.com\/calendar\/r/.test(DASH_HTML) && /calendar\.google\.com\/calendar\/r/.test(EMP_HTML));
  }

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
