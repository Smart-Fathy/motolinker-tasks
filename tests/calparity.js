// The new app's Calendar against the classic portals' (the admin's and the team's), value by value — the same method as
// tests/meetparity.js (see there): the classic page and the new app opened as the same person, in both colour modes and two
// looks, at a phone's width, two in-betweens and a desktop, and the computed style of every named part compared, and the words
// in them.
//
//   loading   the server is slow to answer: the grid is drawn empty with "Loading…" under it
//   month     the month: a busy day (three things and "+2 more"), a day with a late task, today, the days of the next month
//   week      the week: every thing on every day
//   day       the busy day's sheet (what "+2 more" opens)
//   meeting   a meeting's sheet
//
// A list the page could not read is an error box in the new app and nothing in the classic one (it only shows an error when the
// network fails), and the edit that opens the meeting itself is not a look: both are tested in apps/web/src/modules/calendar.
// Run with --print to see every difference rather than the first few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, sleep, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {};

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const BUSY = keyOf(TODAY);
const LATE = keyOf(addDays(TODAY, -1));
const NEXT_MONTH = keyOf(new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 5));

// The part each role names, classic and new, for one portal. Positions are held relative to the page's own root (`rel`).
const role = (c, x, text = false, y = 'abs', rel = 'root') => part(c, x, y, rel, text);
const free = (c, x, text = false) => part(c, x, 'abs', null, text);
function rolesFor(who) {
  const P = '#page-calendar';
  const head = `${P} > div:has(a[href*="calendar.google.com"])`;
  const C = '#ml-calendar ';
  const bar = `${C}.cal-bar`;
  const day = key => `${C}.cal-day[ondblclick*="${key}"]`;
  const nday = key => `[data-part=day][data-day="${key}"]`;
  const chip = (key, n) => [`${day(key)} .cal-chip:nth-of-type(${n})`, `${nday(key)} [data-part=chip]:nth-of-type(${n})`];
  const roles = {
    root: part(P, '[data-part=calendarPage]', 'none'),
    head: role(head, '[data-part=head]'),
    heading: role(`${head} > div:first-child > div:nth-child(1)`, '[data-part=heading]', true),
    sub: role(`${head} > div:first-child > div:nth-child(2)`, '[data-part=sub]', true),
    google: role(`${head} a[href*="calendar.google.com"]`, '[data-part=google]', true),
    googleIcon: role(`${head} a[href*="calendar.google.com"] svg`, '[data-part=google] svg'),
    scroll: role(`${P} > div:has(#ml-calendar)`, '[data-part=scroll]'),
    bar: role(bar, '[data-part=bar]'),
    today: role(`${bar} > .cal-nav:nth-child(1)`, '[data-part=today]', true),
    prev: role(`${bar} > .cal-nav:nth-child(2)`, '[data-part=prev]', true),
    next: role(`${bar} > .cal-nav:nth-child(3)`, '[data-part=next]', true),
    barTitle: role(`${bar} > .cal-title`, '[data-part=barTitle]', true),
    legend: role(`${bar} > .cal-legend`, '[data-part=legend]'),
    keyMeeting: role(`${bar} .cal-key.cal-meeting`, '[data-part=key][data-kind=meeting]', true),
    keyTask: role(`${bar} .cal-key.cal-task`, '[data-part=key][data-kind=task]', true),
    keyFollowup: role(`${bar} .cal-key.cal-followup`, '[data-part=key][data-kind=followup]', true),
    views: role(`${bar} > .cal-views`, '[data-part=views]'),
    viewMonth: role(`${bar} .cal-view:nth-child(1)`, '[data-part=view][data-view=month]', true),
    viewWeek: role(`${bar} .cal-view:nth-child(2)`, '[data-part=view][data-view=week]', true),
    newEvent: role(`${bar} > .btn`, '[data-part=newEvent]', true),
    newEventIcon: role(`${bar} > .btn svg`, '[data-part=newEvent] svg'),
    grid: role(`${C}.cal-grid`, '[data-part=grid]'),
    dow1: role(`${C}.cal-dow:nth-child(1)`, '[data-part=dow]:nth-child(1)', true),
    dow7: role(`${C}.cal-dow:nth-child(7)`, '[data-part=dow]:nth-child(7)', true),
    dayBusy: role(day(BUSY), nday(BUSY)),
    numBusy: role(`${day(BUSY)} .cal-daynum`, `${nday(BUSY)} [data-part=daynum]`, true),
    itemsBusy: role(`${day(BUSY)} .cal-items`, `${nday(BUSY)} [data-part=items]`),
    chipMeeting: role(chip(BUSY, 1)[0], chip(BUSY, 1)[1], true),
    chipMeetingIcon: role(chip(BUSY, 1)[0] + ' svg', chip(BUSY, 1)[1] + ' svg'),
    chipHuddle: role(chip(BUSY, 2)[0], chip(BUSY, 2)[1], true),
    chipFollowup: role(chip(BUSY, 3)[0], chip(BUSY, 3)[1], true),
    more: role(`${day(BUSY)} .cal-more`, `${nday(BUSY)} [data-part=more]`, true),
    dayLate: role(day(LATE), nday(LATE)),
    chipLate: role(chip(LATE, 1)[0], chip(LATE, 1)[1], true),
    dayNext: role(day(NEXT_MONTH), nday(NEXT_MONTH)),
    chipNext: role(chip(NEXT_MONTH, 1)[0], chip(NEXT_MONTH, 1)[1], true),
    loading: role(`${C}.cal-loading`, '[data-part=loading]', true),
    spinner: role(`${C}.cal-loading .spinner`, '[data-part=loading] > span'),

    curtain: free('#modal-overlay', '[data-part=curtain]'),
    dialog: free('#modal-box', '[data-part=dialog]'),
    sHead: free('#modal-box .modal-header', '[data-part=dialog] > [data-part=head]'),
    sTitle: free('#modal-title', '[data-part=dialog] > [data-part=head] > [data-part=title]', true),
    close: free('#modal-box .modal-close', '[data-part=dialog] > [data-part=head] > [data-part=close]', true),
    sBody: free('#modal-body', '[data-part=dialog] > [data-part=body]'),
    sFoot: free('#modal-footer', '[data-part=dialog] > [data-part=foot]'),
    daylist: free('#modal-body .cal-daylist', '[data-part=daylist]'),
    dayrow1: free('#modal-body .cal-dayrow:nth-child(1)', '[data-part=dayrow]:nth-child(1)'),
    dayrowChip1: free('#modal-body .cal-dayrow:nth-child(1) .cal-chip', '[data-part=dayrow]:nth-child(1) [data-part=chip]', true),
    dayrowChip5: free('#modal-body .cal-dayrow:nth-child(5) .cal-chip', '[data-part=dayrow]:nth-child(5) [data-part=chip]', true),
    dayrowIcon5: free('#modal-body .cal-dayrow:nth-child(5) .cal-chip svg', '[data-part=dayrow]:nth-child(5) [data-part=chip] svg'),
    detail: free('#modal-body > div', '[data-part=detail]'),
    when: free('#modal-body > div > div:nth-child(1)', '[data-part=when]', true),
    notes: free('#modal-body > div > div:nth-child(2)', '[data-part=notes]', true),
    schedule: free('#modal-footer .btn-primary', '[data-part=dialog] > [data-part=foot] > [data-part=schedule]', true),
    join: free('#modal-footer a.btn-primary', '[data-part=dialog] > [data-part=foot] > [data-part=join]', true),
    edit: free('#modal-footer .btn-outline:nth-of-type(1)', '[data-part=dialog] > [data-part=foot] > [data-part=edit]', true),
    closeBtn: free('#modal-footer .btn-outline:last-of-type', '[data-part=dialog] > [data-part=foot] > [data-part=close]', true),
  };
  if (who === 'admin') {
    Object.assign(roles, {
      tools: role(`${head} > div:nth-child(2)`, '[data-part=tools]'),
      syncStatus: role('#cal-sync-status', '[data-part=syncStatus]', true),
    });
  }
  return roles;
}

const TOP = ['root', 'head', 'heading', 'sub', 'google', 'googleIcon', 'scroll', 'bar', 'today', 'prev', 'next', 'barTitle', 'legend', 'keyMeeting', 'keyTask', 'keyFollowup', 'views', 'viewMonth', 'viewWeek', 'newEvent', 'newEventIcon', 'grid', 'dow1', 'dow7'];
const ADMIN_TOP = ['tools', 'syncStatus'];
const DAYS = ['dayBusy', 'numBusy', 'itemsBusy', 'chipMeeting', 'chipMeetingIcon', 'chipHuddle', 'chipFollowup', 'dayLate', 'chipLate'];
const SHEET = ['curtain', 'dialog', 'sHead', 'sTitle', 'close', 'sBody', 'sFoot'];
const READS = who => {
  const top = who === 'admin' ? [...TOP, ...ADMIN_TOP] : TOP;
  return {
    loading: [...top, 'loading', 'spinner'],
    month: [...top, ...DAYS, 'more'],
    week: [...top, 'dayBusy', 'numBusy', 'itemsBusy', 'chipMeeting', 'chipHuddle', 'chipFollowup'],
    day: [...top, ...SHEET, 'daylist', 'dayrow1', 'dayrowChip1', 'dayrowChip5', 'dayrowIcon5', 'schedule', 'closeBtn'],
    meeting: [...top, ...SHEET, 'detail', 'when', 'join', 'edit', 'closeBtn'],
  };
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What is on the calendar: today is busy (two meetings, a call, a task and a finished task), yesterday has a task that is late.
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const seed = db => {
  const made = at(addDays(TODAY, -3), 9);
  db.tables.meetings = [
    { id: 1, title: 'Weekly sales sync', description: 'Agenda:\n1. Pipeline\n2. Stock', starts_at: at(TODAY, 10, 30), duration_min: 45, attendee_ids: ['1', '2'], meet_link: 'https://meet.google.com/abc-defg-hij', calendar_events: {}, created_by: 'admin', created_at: made },
    { id: 2, title: 'Procurement huddle', description: '', starts_at: at(TODAY, 14), duration_min: 30, attendee_ids: [], meet_link: 'huddle:1', calendar_events: {}, created_by: 'employee_1', created_at: made },
    { id: 3, title: 'Tomorrow\'s review', description: '', starts_at: at(addDays(TODAY, 1), 9), duration_min: 60, attendee_ids: ['1'], meet_link: '', calendar_events: {}, created_by: 'admin', created_at: made },
  ];
  db.tables.lead_followups = [
    { id: 1, customer_id: 1, due_at: at(TODAY, 16), note: 'Call back about the Q05', assigned_to: 1, status: 'pending', reminded: false, created_by: 'admin', created_at: made, completed_at: null },
  ];
  const task = (id, over) => ({ id, title: 'Task ' + id, description: '', channel_id: 'c', channel_name: 'Sales', assignee_id: '1', assignee_ids: ['1'], due_date: BUSY, priority: 'medium', milestone: '', status: 'todo', created_by: 'admin', created_at: made, ...over });
  db.tables.tasks = [
    task(1, { title: 'Send the Avatr quote' }),
    task(2, { title: 'Chase the shipping agent', status: 'done' }),
    task(3, { title: 'Chase the late payment', due_date: LATE }),
    task(4, { title: 'Plan the next month', due_date: NEXT_MONTH }),
  ];
};

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 3971 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const ROLES = rolesFor(p.who);
    const reads = READS(p.who);
    seed(db);
    db.failing.clear(); db.latency = 0;
    const page = await openPage(browser, base, p, mode, next);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=calendarPage], #page-calendar') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const reading = async state => {
      const which = Object.fromEntries(reads[state].map(r => [r, ROLES[r]]).filter(([, d]) => d));
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS_MORE);
        (observed[at] = observed[at] || {})[side] = got;
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };
    const go = to => page.evaluate((next, to) => {
      if (!next) return window.navigate(to);
      document.querySelector(`[data-screen=${to}]`).click();
    }, next, to);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const chips = pick(`#ml-calendar .cal-day[ondblclick*="${BUSY}"] .cal-chip`, `[data-part=day][data-day="${BUSY}"] [data-part=chip]`);
    const closeSheet = async () => {
      await click('#modal-footer .btn-outline:last-of-type', '[data-part=dialog] > [data-part=foot] > [data-part=close]');
      await until(() => !document.querySelector('#modal-overlay[style*="flex"], [data-part=dialog]'), null, 'the sheet to close');
    };

    // loading: the server is slow, the page is opened, the loader is read before the answer comes
    db.latency = 1500;
    await go('calendar');
    await until(s => !!document.querySelector(s), pick('#ml-calendar .cal-loading', '[data-part=loading]'), 'the loader');
    await reading('loading');
    db.latency = 0;

    // month
    await until(s => document.querySelectorAll(s).length === 3, chips, "today's chips");
    await until(s => !document.querySelector(s), pick('#ml-calendar .cal-loading', '[data-part=loading]'), 'the loader to go');
    await reading('month');

    // the day's sheet
    await click(`#ml-calendar .cal-day[ondblclick*="${BUSY}"] .cal-more`, `[data-part=day][data-day="${BUSY}"] [data-part=more]`);
    await until(s => !!document.querySelector(s), pick('#modal-body .cal-daylist', '[data-part=daylist]'), "the day's sheet");
    await reading('day');
    await closeSheet();

    // a meeting's sheet
    await page.evaluate(s => document.querySelector(s).click(), chips + ':nth-of-type(1)');
    await until(s => !!document.querySelector(s), pick('#modal-footer a.btn-primary', '[data-part=dialog] [data-part=join]'), "the meeting's sheet");
    await reading('meeting');
    await closeSheet();

    // week
    await click('#ml-calendar .cal-view:nth-child(2)', '[data-part=view][data-view=week]');
    await until(s => document.querySelectorAll(s).length === 5, chips, "the week's chips");
    await until(s => !document.querySelector(s), pick('#ml-calendar .cal-loading', '[data-part=loading]'), 'the loader to go');
    await reading('week');
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const p of portals) for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${p.who}/${look}/${mode}`.startsWith(ONLY)) continue;
      await scenario(p, mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();

  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const { n, bad } = diff(classic, next, ACCEPTED, stale, PROPS_MORE);
    compared += n;
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!ONLY) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 380000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
