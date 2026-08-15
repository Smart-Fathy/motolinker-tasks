// Scheduled meetings: rendered on both Meet pages from one module, calendar
// sync modeled on the task sync, and the permission slicing that makes
// meet.view / meet.schedule real checkboxes.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const MEETINGS = [
  { id: 1, title: 'Weekly sales sync', description: '', starts_at: new Date(Date.now() + 3600e3).toISOString(),
    duration_min: 30, attendee_ids: ['2', '3'], meet_link: 'https://meet.google.com/abc-defg-hij', calendar_events: {}, created_by: 'admin' },
];
let posted = [];
function api(pathname, method, body) {
  if (method === 'POST' && /\/meetings$/.test(pathname)) { posted.push({ pathname, body: JSON.parse(body) }); return { id: 9, ...JSON.parse(body) }; }
  if (/\/meetings$/.test(pathname)) return MEETINGS;
  if (/employees-for-tasks$|coworkers$/.test(pathname)) return [{ id: 2, name: 'Sara' }, { id: 3, name: 'Omar' }];
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
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
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

  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', apiBase: '/api/dashboard' },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', apiBase: '/api/employee',
      perms: { meet: true, meetActions: { view: true, schedule: true } } },
  ]) {
    posted = [];
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(() => navigate('meet'));
    await sleep(500);
    const list = await page.evaluate(() => {
      const box = document.getElementById('meet-meetings');
      return { text: box ? box.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
               join: !!box.querySelector('a[href*="meet.google.com/abc"]'),
               schedule: !![...box.querySelectorAll('button')].find(b => /Schedule a meeting/.test(b.textContent)) };
    });
    check(`${portal.label}: the Meet page lists scheduled meetings`, /Weekly sales sync/.test(String(list.text)), String(list.text));
    check(`${portal.label}: with a working Join link`, list.join === true);
    check(`${portal.label}: and a Schedule button for someone who may`, list.schedule === true);

    const saved = await page.evaluate(async () => {
      await openMeetingForm(null);
      await new Promise(r => setTimeout(r, 200));
      document.getElementById('mt-title').value = 'Handover call';
      document.getElementById('mt-date').value = '2026-08-20';
      document.getElementById('mt-time').value = '15:30';
      document.querySelectorAll('.mt-att')[0].checked = true;
      await saveMeeting(null);
      await new Promise(r => setTimeout(r, 200));
      return true;
    });
    check(`${portal.label}: scheduling posts to its own portal`,
      saved && posted.length === 1 && posted[0].pathname === `${portal.apiBase}/meetings`,
      JSON.stringify(posted.map(p => p.pathname)));
    check(`${portal.label}: with title, ISO start and attendees`,
      posted[0] && posted[0].body.title === 'Handover call'
      && /2026-08-20T/.test(posted[0].body.starts_at) && posted[0].body.attendee_ids.length === 1,
      JSON.stringify(posted[0] && posted[0].body));
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // View without schedule: the list renders, the buttons don't.
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { meet: true, meetActions: { view: true, schedule: false } } });
    await page.evaluate(() => navigate('meet'));
    await sleep(500);
    const v = await page.evaluate(() => {
      const box = document.getElementById('meet-meetings');
      return { listed: /Weekly sales sync/.test(box.textContent),
               schedule: !![...box.querySelectorAll('button')].find(b => /Schedule|Edit|Cancel/.test(b.textContent)) };
    });
    check('a view-only rep sees the list but no scheduling controls', v.listed && !v.schedule, JSON.stringify(v));
    await page.close();
  }

  // ── The task-sync gaps are closed (source assertions) ─────────────────────────
  {
    const EMP = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
    const IDX = fs.readFileSync('index.js', 'utf8');
    const REP = fs.readFileSync('src/routes/reports.js', 'utf8');
    check('an employee-created task syncs to their calendar',
      /runAutomations\('task\.created', taskCtx\(task\)\);[\s\S]{0,250}ctx\.syncTaskToCalendar\(task\)/.test(EMP));
    check('completing an own task re-syncs the event',
      /runAutomations\('task\.completed', taskCtx\(data\)\);\s*\n\s*ctx\.syncTaskToCalendar\(data\)/.test(EMP));
    check('a done task wears its check on the calendar',
      /task\.status === 'done' \? '✓ ' : ''/.test(IDX));
    check("the admin's status change re-syncs too",
      /updates\.status !== undefined\) syncTaskToCalendar\(data\)/.test(REP));
    const MEET = fs.readFileSync('src/routes/meetings.js', 'utf8');
    check('meetings sync per-attendee with a company fallback, like tasks',
      /getEmployeeCalendarToken\(emp\.id\)/.test(MEET) && /conferenceDataVersion=1/.test(MEET)
      && /hangoutLink/.test(MEET));
    check('cancelling a meeting cleans up every calendar event',
      /deleteMeetingEvents/.test(MEET) && /sendUpdates=all/.test(MEET));
    check('attendees are notified',
      /scheduled a meeting/.test(MEET));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
