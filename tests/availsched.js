// Availability drives the schedule, and reads as 12h.
//
// Two asks, one feature: a task should not land on a day its assignee marked
// off, and the hours people set should read the way this team says the time.
//
//   server — the recurring generator moves a due date off an "off" day, records
//            where it moved from, and leaves it alone when nobody has set a week.
//   UI     — the board and the chat header read 12h, the editor picks 12h while
//            still storing HH:MM, and both task forms warn before they save.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3995';

const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// UTC, exactly as rtToday() and weekStartOf() compute it.
const addUTC = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayIdx = d => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;     // 0 = Monday
const TODAY = new Date().toISOString().slice(0, 10);
const WEEK = addUTC(TODAY, -dayIdx(TODAY));

// Employee 7 is off today and tomorrow, working the day after.
const offWeek = () => {
  const days = Array.from({ length: 7 }, () => ({ status: 'available', from: '10:00', to: '18:00' }));
  days[dayIdx(TODAY)] = { status: 'off' };
  const t1 = addUTC(TODAY, 1);
  if (dayIdx(t1) > dayIdx(TODAY)) days[dayIdx(t1)] = { status: 'off' };   // same week only
  return days;
};

let inserted = [], availRows = [{ member_key: 'employee_7', week_start: WEEK, days: offWeek() }];
let templates = [];

const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const method = ((init && init.method) || 'GET').toUpperCase();
  const body = init && init.body ? JSON.parse(init.body) : null;
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const one = accept.includes('pgrst.object');
  const json = v => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });

  if (url.includes('/rest/v1/availability_weeks')) return json(availRows);
  if (url.includes('/rest/v1/recurring_tasks')) {
    if (method === 'POST') { const row = { id: 99, ...body }; return json(one ? row : [row]); }
    if (method === 'PATCH') return json(one ? templates[0] : templates);
    return json(one ? (templates[0] || {}) : templates);
  }
  if (url.includes('/rest/v1/tasks') && method === 'POST') {
    // A database without migration 018 rejects the extra column; simulate that
    // only when the test asks for it, so the retry path is exercised too.
    if (global.__noMigration && body && body.due_shifted_from !== undefined) {
      return new Response(JSON.stringify({ message: 'column "due_shifted_from" does not exist' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const row = { id: inserted.length + 1, ...body };
    inserted.push(row);
    return json(one ? row : [row]);
  }
  return json(one ? {} : []);
};

require(process.cwd() + '/index.js');
const base = 'http://127.0.0.1:' + process.env.PORT;
const AV = require(process.cwd() + '/src/routes/availability.js');

(async () => {
  await sleep(600);
  const { token } = await (await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  const hit = (m, p, b) => fetch(base + p, { method: m, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: b === undefined ? (m === 'GET' ? undefined : '{}') : JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.text() }));

  // ── The two weekday numbering schemes ─────────────────────────────────────
  // availability days[] is 0 = Monday; the recurring picker is 0 = Sunday. This
  // is the single most likely place for an off-by-one, so it is pinned here.
  check('availability day 0 is Monday', AV.dayIndexOf('2026-08-31') === 0, String(AV.dayIndexOf('2026-08-31')));
  check('…and day 6 is Sunday', AV.dayIndexOf('2026-09-06') === 6, String(AV.dayIndexOf('2026-09-06')));
  check('…while JS getUTCDay calls that same Monday 1',
    new Date('2026-08-31T00:00:00Z').getUTCDay() === 1);
  check('the two agree through (getUTCDay + 6) % 7',
    ['2026-08-31', '2026-09-01', '2026-09-05', '2026-09-06'].every(d =>
      AV.dayIndexOf(d) === (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
  check('dates advance in UTC, not local time', AV.addDaysUTC('2026-12-31', 1) === '2027-01-01', AV.addDaysUTC('2026-12-31', 1));

  // ── nextWorkingDay ────────────────────────────────────────────────────────
  {
    const moved = await AV.nextWorkingDay(['employee_7'], TODAY, 14);
    check('an off day moves to the next day that member works', moved !== TODAY, `${TODAY} -> ${moved}`);
    const dayOf = await AV.availabilityDays(['employee_7'], [moved]);
    check('…and the day it moved to is not itself an off day',
      (dayOf.get(`employee_7|${moved}`) || {}).status !== 'off', JSON.stringify(dayOf.get(`employee_7|${moved}`)));

    const saved = availRows; availRows = [];
    const unknown = await AV.nextWorkingDay(['employee_7'], TODAY, 14);
    check('a member who never set a week is never treated as off', unknown === TODAY, unknown);
    availRows = saved;

    const nobody = await AV.nextWorkingDay([], TODAY, 14);
    check('no assignees means no shift', nobody === TODAY, nobody);
  }

  // ── The recurring generator ───────────────────────────────────────────────
  {
    templates = [{ id: 3, title: 'Weekly stock count', description: '', assignee_id: '7', assignee_ids: ['7'],
      priority: 'medium', milestone: '', recurrence_type: 'weekly', weekdays: [1], interval_days: null,
      due_offset_days: 0, start_date: null, next_run_date: TODAY, last_run_date: null, active: true,
      respect_availability: true }];
    inserted = [];
    const r = await hit('POST', '/api/dashboard/recurring-tasks/3/run-now');
    check('a template still generates its task', r.status === 200 && inserted.length === 1, r.body.slice(0, 90));
    const t = inserted[0] || {};
    check('…due on a day the assignee actually works, not the day they are off',
      t.due_date && t.due_date !== TODAY, `planned ${TODAY}, got ${t.due_date}`);
    check('…and it records where the date moved from',
      t.due_shifted_from === TODAY, JSON.stringify({ from: t.due_shifted_from, to: t.due_date }));

    // Opting out keeps the template's own date.
    templates[0].respect_availability = false;
    inserted = [];
    await hit('POST', '/api/dashboard/recurring-tasks/3/run-now');
    check('a template that opts out keeps the date it asked for',
      inserted[0]?.due_date === TODAY && inserted[0]?.due_shifted_from === undefined,
      JSON.stringify({ due: inserted[0]?.due_date, from: inserted[0]?.due_shifted_from }));
    templates[0].respect_availability = true;

    // A database that has not taken migration 018 must still generate tasks.
    global.__noMigration = true;
    inserted = [];
    const r2 = await hit('POST', '/api/dashboard/recurring-tasks/3/run-now');
    check('a database without migration 018 still generates the task',
      r2.status === 200 && inserted.length === 1 && inserted[0].due_shifted_from === undefined,
      r2.body.slice(0, 80));
    check('…and it still lands on a working day', inserted[0]?.due_date !== TODAY, inserted[0]?.due_date);
    global.__noMigration = false;

    // The template's own flag round-trips through the API.
    const created = await hit('POST', '/api/dashboard/recurring-tasks', {
      title: 'X', assignee_ids: ['7'], recurrence_type: 'interval', interval_days: 7, respect_availability: false });
    check('respect_availability round-trips as false when asked', /"respect_availability":false/.test(created.body), created.body.slice(0, 120));
    const dflt = await hit('POST', '/api/dashboard/recurring-tasks', {
      title: 'Y', assignee_ids: ['7'], recurrence_type: 'interval', interval_days: 7 });
    check('…and defaults to true when the field is absent', /"respect_availability":true/.test(dflt.body), dflt.body.slice(0, 120));
  }

  // ── The screens ───────────────────────────────────────────────────────────
  const EMPS = [{ id: 7, name: 'Karim Zaki' }, { id: 8, name: 'Nourhan Fathy' }];
  const BOARD = { week: WEEK, members: [
    { key: 'admin', name: 'Admin', me: false, days: null },
    { key: 'employee_7', name: 'Karim Zaki', me: false, days: offWeek() },
    { key: 'employee_8', name: 'Nourhan Fathy', me: true, days: null },
  ] };
  let puts = [];
  function api(p, method, body) {
    if (method === 'PUT' && /\/availability$/.test(p)) { puts.push(JSON.parse(body)); return { ok: true }; }
    if (/\/availability$/.test(p)) return BOARD;
    if (/auth\/check$/.test(p)) return { ok: true };
    if (/employee\/check$/.test(p)) return { ok: true, id: 8, name: 'Nourhan Fathy', username: 'nourhan', job_title: 'Sales',
      permissions: { tasks: true, hours: true, availability: true, availabilityActions: { view: true, set: true } } };
    if (/employees-for-tasks$/.test(p) || /employees$/.test(p)) return EMPS;
    if (/recurring-tasks$/.test(p)) return [];
    if (/nav-config$/.test(p)) return { groups: [] };
    if (/nav-favourites$/.test(p)) return { favourites: [] };
    if (/stats$/.test(p)) return { total: 0, done: 0, inProgress: 0, todo: 0, overdue: 0, highPriority: 0, byStatus: {}, byPriority: {} };
    if (/home\/layout$/.test(p)) return { widgets: [] };
    if (/columns/.test(p)) return { columns: [] };
    return [];
  }

  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });

  async function open(portal, width) {
    const page = await browser.newPage();
    await page.setViewport({ width: width || 1280, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};window.Chart=function(){this.destroy=function(){}};window.Chart.register=function(){};' });
      if (u.pathname.startsWith('/api/')) {
        if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
      }
      if (u.pathname === portal.route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(portal.file, 'utf8') });
      const f = path.join('public', u.pathname.replace(/^\//, ''));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
        return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
      }
      req.respond({ status: 404, body: '' });
    });
    await page.evaluateOnNewDocument(k => localStorage.setItem(k, 't'), portal.tokenKey);
    await page.goto(`http://127.0.0.1:${port}${portal.route}`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    return { page, errs };
  }
  const ADMIN = { route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token' };
  const TEAM  = { route: '/employee',  file: 'public/employee.html',  tokenKey: 'ml_emp_token' };

  // 12h everywhere availability is shown, in BOTH portals.
  for (const [label, portal, page_] of [['admin', ADMIN, 'employees'], ['team', TEAM, 'hours']]) {
    const { page, errs } = await open(portal);
    await page.evaluate(p => navigate(p), page_);
    await sleep(900);
    const txt = await page.evaluate(() => document.getElementById('availability-board')?.innerText || '');
    check(`${label}: the board reads 12h`, /10:00 AM – 6:00 PM/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 90));
    check(`${label}: …and never 24h`, !/18:00/.test(txt) && !/10:00–18:00/.test(txt), (txt.match(/\d\d:\d\d/g) || []).join(','));

    const fmt = await page.evaluate(() => [avFmt12('00:30'), avFmt12('12:00'), avFmt12('09:05'), avFmt12('23:59'), avFmt12(''), avFmt12('bad')]);
    check(`${label}: midnight, noon and the edges convert correctly`,
      JSON.stringify(fmt) === JSON.stringify(['12:30 AM', '12:00 PM', '9:05 AM', '11:59 PM', '', '']), JSON.stringify(fmt));

    // The editor picks 12h and still stores HH:MM.
    const ed = await page.evaluate(async () => {
      openAvailabilityEditor();
      await new Promise(r => setTimeout(r, 200));
      const row = document.querySelectorAll('.av-row')[2];
      return { rows: document.querySelectorAll('.av-row').length,
        timeInputs: document.querySelectorAll('.av-row input[type=time]').length,
        ap: [...row.querySelectorAll('.av-t')[0].querySelectorAll('.av-ap option')].map(o => o.value).join(','),
        hours: [...row.querySelectorAll('.av-t')[0].querySelectorAll('.av-h option')].map(o => o.value).join(','),
        carriers: row.querySelectorAll('.av-from, .av-to').length };
    });
    check(`${label}: the editor still has seven day rows`, ed.rows === 7, String(ed.rows));
    check(`${label}: …with no locale-dependent time input left`, ed.timeInputs === 0, String(ed.timeInputs));
    check(`${label}: …hours run 1 to 12 with AM/PM`, ed.hours === '1,2,3,4,5,6,7,8,9,10,11,12' && ed.ap === 'AM,PM', ed.hours + ' | ' + ed.ap);
    check(`${label}: …and each half still carries one HH:MM value`, ed.carriers === 2, String(ed.carriers));

    puts = [];
    const sent = await page.evaluate(async () => {
      const row = document.querySelectorAll('.av-row')[2];
      row.querySelector('.av-status').value = 'available';
      const from = row.querySelectorAll('.av-t')[0];
      from.querySelector('.av-h').value = '9'; from.querySelector('.av-m').value = '30'; from.querySelector('.av-ap').value = 'AM';
      avSyncTime(from.querySelector('.av-h'));
      const to = row.querySelectorAll('.av-t')[1];
      to.querySelector('.av-h').value = '5'; to.querySelector('.av-m').value = '15'; to.querySelector('.av-ap').value = 'PM';
      avSyncTime(to.querySelector('.av-h'));
      const carried = { from: row.querySelector('.av-from').value, to: row.querySelector('.av-to').value };
      await saveAvailability();
      await new Promise(r => setTimeout(r, 200));
      return carried;
    });
    check(`${label}: 9:30 AM and 5:15 PM store as 09:30 and 17:15`,
      sent.from === '09:30' && sent.to === '17:15', JSON.stringify(sent));
    check(`${label}: …and that is what the PUT carries`,
      puts.length === 1 && puts[0].days[2].from === '09:30' && puts[0].days[2].to === '17:15',
      JSON.stringify(puts[0] && puts[0].days[2]));
    check(`${label}: no page errors on the availability screen`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // The admin task form warns and offers the move.
  {
    const { page, errs } = await open(ADMIN);
    await page.evaluate(() => navigate('tasks'));
    await sleep(700);
    await page.evaluate(() => openTaskModal(null));
    await sleep(400);
    const picked = await page.evaluate(async (today) => {
      document.getElementById('t-due').value = today;
      const cb = [...document.querySelectorAll('.t-assignee-cb')].find(c => c.value === '7');
      if (!cb) return { html: 'no assignee checkbox rendered', warn: false, move: '' };
      cb.checked = true;
      taskAssigneePaint();
      await new Promise(r => setTimeout(r, 700));
      const box = document.getElementById('t-avail');
      return { html: box.innerText.replace(/\s+/g, ' '), warn: !!box.querySelector('.t-avail-box.warn'),
               move: box.querySelector('.t-av-move')?.textContent || '' };
    }, TODAY);
    check('the admin form warns when the assignee is off that day',
      picked.warn && /Karim Zaki is off/.test(picked.html), picked.html.slice(0, 110));
    check('…and offers a specific day to move to', /^Move to \w{3}/.test(picked.move.trim()), picked.move);
    check('…while saying the date is still yours to keep', /save it anyway/i.test(picked.html));

    const moved = await page.evaluate(async () => {
      document.querySelector('#t-avail .t-av-move').click();
      await new Promise(r => setTimeout(r, 700));
      return { due: document.getElementById('t-due').value,
               warn: !!document.querySelector('#t-avail .t-avail-box.warn') };
    });
    check('clicking it moves the due date', moved.due !== TODAY && !!moved.due, `${TODAY} -> ${moved.due}`);
    check('…and the warning clears', moved.warn === false);

    // A member who never set a week must not produce a warning.
    const unknown = await page.evaluate(async (today) => {
      document.getElementById('t-due').value = today;
      document.querySelectorAll('.t-assignee-cb').forEach(c => { c.checked = c.value === '8'; });
      taskAssigneePaint();
      await new Promise(r => setTimeout(r, 700));
      return document.getElementById('t-avail').innerHTML;
    }, TODAY);
    check('a member who never set a week raises nothing', unknown.trim() === '', unknown.slice(0, 80));
    check('no page errors on the admin task form', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // The recurring form carries the switch.
  {
    const { page, errs } = await open(ADMIN);
    await page.evaluate(() => navigate('tasks'));
    await sleep(700);
    const rt = await page.evaluate(async () => {
      openRecurringForm(null);
      await new Promise(r => setTimeout(r, 300));
      const cb = document.getElementById('rt-respect-avail');
      return { present: !!cb, on: !!cb?.checked, label: document.querySelector('.rt-avail')?.innerText.replace(/\s+/g, ' ') || '' };
    });
    check('a recurring template offers to follow the assignees\' week', rt.present === true);
    check('…and it is on unless somebody turns it off', rt.on === true);
    check('…explaining that an unset week is never treated as off',
      /not set that week is never treated as off/.test(rt.label), rt.label.slice(0, 120));
    check('no page errors on the recurring form', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // The team form checks the week of the person filing it — on a phone.
  {
    const saved = BOARD.members[2].days;
    BOARD.members[2].days = offWeek();          // Nourhan (me) is off today
    const { page, errs } = await open(TEAM, 390);
    await page.evaluate(() => navigate('tasks'));
    await sleep(700);
    const warned = await page.evaluate(async (today) => {
      openNewTaskModal();
      await new Promise(r => setTimeout(r, 250));
      document.getElementById('nt-due').value = today;
      empDuePaint();
      await new Promise(r => setTimeout(r, 800));
      const box = document.getElementById('nt-avail');
      const btn = box.querySelector('.t-av-move');
      return { warn: !!box.querySelector('.t-avail-box.warn'), text: box.innerText.replace(/\s+/g, ' '),
               tap: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
               wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }, TODAY);
    check('the team form warns on the filer\'s own off day', warned.warn === true, warned.text.slice(0, 110));
    check('…the move button is tappable on a phone', warned.tap >= 44, String(warned.tap));
    check('…and nothing overflows at 390px', warned.wide === false);
    const moved = await page.evaluate(async () => {
      document.querySelector('#nt-avail .t-av-move').click();
      await new Promise(r => setTimeout(r, 700));
      return document.getElementById('nt-due').value;
    });
    check('…and it moves the date it offered', moved !== TODAY && !!moved, `${TODAY} -> ${moved}`);
    check('no page errors on the team task form', !errs.length, errs.slice(0, 2).join(' | '));
    BOARD.members[2].days = saved;
    await page.close();
  }

  // The chat header reads the same hours the board does.
  {
    const HUD = fs.readFileSync('public/assets/huddle.js', 'utf8');
    check('the chat header renders availability through the shared 12h helper',
      /avRange12\(d\.from, d\.to\)/.test(HUD) && !/`\$\{d\.from\}–\$\{d\.to\}`/.test(HUD.replace(/avRange12[^\n]*\n/, '')));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
