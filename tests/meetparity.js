// The new app's Meet page against the classic portals' (the admin's and the team's), value by value — the same method as
// tests/subparity.js and tests/issparity.js (see there): the classic page and the new app opened as the same person, in both
// colour modes and two looks, at a phone's width, two in-betweens and a desktop, and the computed style of every named part
// compared, and the words in them.
//
//   loading     the server is slow to answer: the list gives way to the loader
//   list        three meetings — one with a link, one in a huddle, one with neither — and the Schedule button
//   empty       nothing scheduled
//   sheet       the scheduling sheet, as it opens: title, when, how long, who, where, notes
//   sheetLink   …with "a link I already have" chosen, which asks for the link
//   sheetError  …sent with no title, which says so
//
// The classic page answers a list it could not read with "Nothing scheduled", and the new one says why — that, the Join huddle
// that opens the room in the classic portal, and the Edit that opens the meeting itself are not looks, and are tested in
// apps/web/src/modules/meet. Run with --print to see every difference rather than the first few.
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

// The part each role names, classic and new, for one portal. Positions are held relative to the page's own root (`rel`).
const role = (c, x, text = false, y = 'abs', rel = 'root') => part(c, x, y, rel, text);
const free = (c, x, text = false) => part(c, x, 'abs', null, text);   // the sheet floats over the page: its place is the window's
function rolesFor(who) {
  const P = '#page-meet';
  // (the classic pages carry the assistant's card at the top of the page, hidden, so a child's number is not its place)
  const body = who === 'admin' ? `${P} .page-body` : `${P} > div:has(> .page-title)`;
  const grid = `${P} .page-title + div + div`;
  const card = n => `${grid} > div:nth-child(${n})`;
  const M = '#meet-meetings';
  const list = `${M} > div:nth-child(2)`;
  const row = n => `${list} > div:nth-child(${n})`;
  const N = '[data-part=meetings] ';
  const nrow = n => `[data-part=list] > [data-part=meeting]:nth-child(${n})`;
  const group = (sel, nsel) => [`#modal-body .form-group:has(${sel})`, `[data-part=dialog] [data-part=group]:has(${nsel})`];
  // (the classic page swaps each <select> for a button that follows it, so that is the control that is seen: `shown`)
  const field = (name, sel, nsel, shown = sel) => {
    const [cg, ng] = group(sel, nsel);
    return {
      [name + 'Group']: free(cg, ng),
      [name + 'Label']: free(`${cg} .form-label`, `${ng} [data-part=label]`, true),
      [name]: free(shown, nsel),
    };
  };
  return {
    // (the page the classic portal pads — the team's, by 28px — is the shell's, in the new app)
    root: part(P, '[data-part=page]', 'none'),
    body: role(body, '[data-part=body]'),
    title: role(`${P} .page-title`, '[data-part=heading]', true),
    sub: role(`${P} .page-title + div`, '[data-part=sub]', true),
    cards: role(grid, '[data-part=cards]'),
    card1: role(card(1), '[data-part=card]:nth-child(1)'),
    badge1: role(`${card(1)} > div:nth-child(1)`, '[data-part=card]:nth-child(1) [data-part=badge]'),
    badgeIcon1: role(`${card(1)} > div:nth-child(1) svg`, '[data-part=card]:nth-child(1) [data-part=badge] svg'),
    cardTitle1: role(`${card(1)} > div:nth-child(2) > div:nth-child(1)`, '[data-part=card]:nth-child(1) [data-part=cardTitle]', true),
    cardHint1: role(`${card(1)} > div:nth-child(2) > div:nth-child(2)`, '[data-part=card]:nth-child(1) [data-part=cardHint]', true),
    start: role(`${card(1)} > a.btn`, '[data-part=start]', true),
    startIcon: role(`${card(1)} > a.btn svg`, '[data-part=start] svg'),
    card2: role(card(2), '[data-part=card]:nth-child(2)'),
    badge2: role(`${card(2)} > div:nth-child(1)`, '[data-part=card]:nth-child(2) [data-part=badge]'),
    badgeIcon2: role(`${card(2)} > div:nth-child(1) svg`, '[data-part=card]:nth-child(2) [data-part=badge] svg'),
    cardTitle2: role(`${card(2)} > div:nth-child(2) > div:nth-child(1)`, '[data-part=card]:nth-child(2) [data-part=cardTitle]', true),
    cardHint2: role(`${card(2)} > div:nth-child(2) > div:nth-child(2)`, '[data-part=card]:nth-child(2) [data-part=cardHint]', true),
    joinRow: role(`${card(2)} > div:nth-child(3)`, '[data-part=joinRow]'),
    code: role(who === 'admin' ? '#admin-meet-code' : '#meet-code', '[data-part=code]'),
    joinBtn: role(`${card(2)} > div:nth-child(3) .btn`, '[data-part=joinRow] [data-part=join]', true),
    meetings: role(M, '[data-part=meetings]'),
    loading: role(`${M} .loading`, `${N}[data-part=loading]`, true),
    spinner: role(`${M} .spinner`, `${N}[data-part=loading] > span`),
    listHead: role(`${M} > div:nth-child(1)`, `${N}[data-part=listHead]`),
    listTitle: role(`${M} > div:nth-child(1) > div`, `${N}[data-part=listTitle]`, true),
    schedule: role(`${M} > div:nth-child(1) > button`, `${N}[data-part=schedule]`, true),
    scheduleIcon: role(`${M} > div:nth-child(1) > button svg`, `${N}[data-part=schedule] svg`),
    empty: role(`${M} > div:nth-child(2)`, `${N}[data-part=empty]`, true),
    list: role(list, `${N}[data-part=list]`),
    row1: role(row(1), N + nrow(1)),
    day1: role(`${row(1)} > div:nth-child(1)`, `${N}${nrow(1)} [data-part=day]`),
    weekday1: role(`${row(1)} > div:nth-child(1) > div:nth-child(1)`, `${N}${nrow(1)} [data-part=weekday]`, true),
    date1: role(`${row(1)} > div:nth-child(1) > div:nth-child(2)`, `${N}${nrow(1)} [data-part=date]`, true),
    what1: role(`${row(1)} > div:nth-child(2)`, `${N}${nrow(1)} [data-part=what]`),
    name1: role(`${row(1)} > div:nth-child(2) > div:nth-child(1)`, `${N}${nrow(1)} [data-part=name]`, true),
    meta1: role(`${row(1)} > div:nth-child(2) > div:nth-child(2)`, `${N}${nrow(1)} [data-part=meta]`, true),
    join1: role(`${row(1)} > a.btn`, `${N}${nrow(1)} [data-part=join]`, true),
    edit1: role(`${row(1)} > .btn-outline:nth-of-type(1)`, `${N}${nrow(1)} [data-part=edit]`, true),
    cancel1: role(`${row(1)} > .btn-outline:nth-of-type(2)`, `${N}${nrow(1)} [data-part=cancel]`, true),
    row2: role(row(2), N + nrow(2)),
    name2: role(`${row(2)} > div:nth-child(2) > div:nth-child(1)`, `${N}${nrow(2)} [data-part=name]`, true),
    join2: role(`${row(2)} > button.btn-primary`, `${N}${nrow(2)} [data-part=join]`, true),
    joinIcon2: role(`${row(2)} > button.btn-primary svg`, `${N}${nrow(2)} [data-part=join] svg`),
    row3: role(row(3), N + nrow(3)),
    edit3: role(`${row(3)} > .btn-outline:nth-of-type(1)`, `${N}${nrow(3)} [data-part=edit]`, true),
    cancel3: role(`${row(3)} > .btn-outline:nth-of-type(2)`, `${N}${nrow(3)} [data-part=cancel]`, true),

    curtain: free('#modal-overlay', '[data-part=curtain]'),
    dialog: free('#modal-box', '[data-part=dialog]'),
    head: free('#modal-box .modal-header', '[data-part=dialog] > [data-part=head]'),
    sTitle: free('#modal-title', '[data-part=dialog] > [data-part=head] > [data-part=title]', true),
    close: free('#modal-box .modal-close', '[data-part=dialog] > [data-part=head] > [data-part=close]', true),
    sBody: free('#modal-body', '[data-part=dialog] > [data-part=body]'),
    sFoot: free('#modal-footer', '[data-part=dialog] > [data-part=foot]'),
    ...field('titleF', '#mt-title', '[data-part=titleInput]'),
    trio: free('#modal-body > div:nth-child(2)', '[data-part=dialog] [data-part=trio]'),
    ...field('dateF', '#mt-date', '[data-part=dateInput]'),
    ...field('timeF', '#mt-time', '[data-part=timeInput]'),
    ...field('durationF', '#mt-duration', '[data-part=durationSelect]', '#mt-duration + .bselect-trigger'),
    ...field('attF', '#mt-attendees', '[data-part=attendees]'),
    att1: free('#mt-attendees label:nth-child(1)', '[data-part=attendees] [data-part=attendee]:nth-child(1)', true),
    att1Box: free('#mt-attendees label:nth-child(1) input', '[data-part=attendees] [data-part=attendee]:nth-child(1) input'),
    att2: free('#mt-attendees label:nth-child(2)', '[data-part=attendees] [data-part=attendee]:nth-child(2)', true),
    attHelp: free('#mt-attendees + div', '[data-part=attendeesHelp]', true),
    ...field('whereF', '#mt-where', '[data-part=whereSelect]', '#mt-where + .bselect-trigger'),
    ...field('linkF', '#mt-link', '[data-part=linkInput]'),
    ...field('notesF', '#mt-desc', '[data-part=notesInput]'),
    err: free('#mt-err', '[data-part=dialog] [data-part=error]', true),
    cancelBtn: free('#modal-footer .btn-outline', '[data-part=dialog] > [data-part=foot] > [data-part=cancel]', true),
    submitBtn: free('#modal-footer .btn-primary', '[data-part=dialog] > [data-part=foot] > [data-part=submit]', true),
  };
}

const FORM = [
  'curtain', 'dialog', 'head', 'sTitle', 'close', 'sBody', 'sFoot',
  'titleFGroup', 'titleFLabel', 'titleF', 'trio', 'dateFGroup', 'dateFLabel', 'dateF', 'timeFGroup', 'timeFLabel', 'timeF',
  'durationFGroup', 'durationFLabel', 'durationF', 'attFGroup', 'attFLabel', 'attF', 'att1', 'att1Box', 'att2', 'attHelp',
  'whereFGroup', 'whereFLabel', 'whereF', 'notesFGroup', 'notesFLabel', 'notesF', 'cancelBtn', 'submitBtn',
];
const TOP = ['root', 'body', 'title', 'sub', 'cards', 'card1', 'badge1', 'badgeIcon1', 'cardTitle1', 'cardHint1', 'start', 'startIcon', 'card2', 'badge2', 'badgeIcon2', 'cardTitle2', 'cardHint2', 'joinRow', 'code', 'joinBtn', 'meetings'];
const HEAD = ['listHead', 'listTitle', 'schedule', 'scheduleIcon'];
const ROWS = ['list', 'row1', 'day1', 'weekday1', 'date1', 'what1', 'name1', 'meta1', 'join1', 'edit1', 'cancel1', 'row2', 'name2', 'join2', 'joinIcon2', 'row3', 'edit3', 'cancel3'];
const READS = {
  loading: [...TOP, 'loading', 'spinner'],
  list: [...TOP, ...HEAD, ...ROWS],
  empty: [...TOP, ...HEAD, 'empty'],
  sheet: [...TOP, ...FORM],
  sheetLink: [...TOP, ...FORM, 'linkFGroup', 'linkFLabel', 'linkF'],
  sheetError: [...TOP, ...FORM, 'err'],
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What is scheduled. Times are far from "now" and on the hour, so they read the same in two pages opened a while apart.
const DAY = 24 * 3600e3;
const midnight = Math.ceil(Date.now() / DAY) * DAY;
const when = (days, h, m = 0) => new Date(midnight + days * DAY + h * 3600e3 + m * 60e3).toISOString();
const meetings = () => [
  { id: 1, title: 'Weekly sales sync with the whole showroom team, which is long enough to be cut off at the edge of its row', description: '', starts_at: when(2, 10), duration_min: 45, attendee_ids: ['1', '2'], meet_link: 'https://meet.google.com/abc-defg-hij', calendar_events: {}, created_by: 'admin', created_at: when(-1, 9) },
  { id: 2, title: 'Procurement huddle', description: 'Quotes first', starts_at: when(3, 14, 30), duration_min: 30, attendee_ids: [], meet_link: 'huddle:1', calendar_events: {}, created_by: 'employee_1', created_at: when(-1, 9) },
  { id: 3, title: 'No link yet', description: '', starts_at: when(5, 9), duration_min: 90, attendee_ids: ['1'], meet_link: '', calendar_events: {}, created_by: 'admin', created_at: when(-1, 9) },
];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 3970 });
  db.tables.employees.push({ ...db.tables.employees[0], id: 2, name: 'Sara Ali', username: 'sara', permissions: {} }, { ...db.tables.employees[0], id: 3, name: 'Omar Hassan', username: 'omar', permissions: {} });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const ROLES = rolesFor(p.who);
    db.tables.meetings = meetings();
    db.failing.clear(); db.latency = 0;
    const page = await openPage(browser, base, p, mode, next);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + '.ai-card,[data-part=aiCard]{display:none!important}' });
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=meetings], #meet-meetings') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const reading = async state => {
      const which = Object.fromEntries(READS[state].map(r => [r, ROLES[r]]).filter(([, d]) => d));
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
    const pick = (classic, now) => next ? now : classic;
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    // the classic page swaps each <select> for a button and keeps the select hidden underneath; a person presses the button and the option
    const where = async (value, text) => {
      if (!next) return page.select('#mt-where', value);
      await page.click('[data-part=whereSelect]');
      await page.evaluate(t => { [...document.querySelectorAll('[role=option]')].find(o => o.textContent.startsWith(t)).click(); }, text);
    };
    const rowsSel = pick('#meet-meetings > div:nth-child(2) > div', '[data-part=meetings] [data-part=meeting]');

    // loading: the server is slow, the page is opened, the loader is read before the answer comes
    db.latency = 1500;
    await go('meet');
    await until(s => !!document.querySelector(s), pick('#meet-meetings .loading', '[data-part=meetings] [data-part=loading]'), 'the loader');
    await reading('loading');
    db.latency = 0;

    // list
    await page.waitForFunction((s, want) => document.querySelectorAll(s).length === want, { timeout: 15000, polling: 50 }, rowsSel, 3);
    await reading('list');

    // the sheet
    await click('#meet-meetings > div:nth-child(1) > button', '[data-part=meetings] [data-part=schedule]');
    await until(s => !!document.querySelector(s), pick('#modal-body #mt-title', '[data-part=dialog] [data-part=titleInput]'), 'the sheet');
    await until(s => document.querySelectorAll(s).length >= 3, pick('#mt-attendees label', '[data-part=attendees] [data-part=attendee]'), 'the people to invite');
    await reading('sheet');
    await where('link', 'A link I already have');
    await until(s => !!document.querySelector(s), pick('#mt-link', '[data-part=linkInput]'), 'the link field');
    await reading('sheetLink');
    await where('meet', 'Google Meet');
    await click('#modal-footer .btn-primary', '[data-part=dialog] [data-part=submit]');
    await until(s => { const e = document.querySelector(s); return !!e && e.textContent.trim().length > 0 && getComputedStyle(e).display !== 'none'; }, pick('#mt-err', '[data-part=dialog] [data-part=error]'), 'the error');
    await reading('sheetError');
    await click('#modal-footer .btn-outline', '[data-part=dialog] [data-part=cancel]');
    await until(() => !document.querySelector('#modal-overlay[style*="flex"], [data-part=dialog]'), null, 'the sheet to close');

    // empty (the page is left and come back to, as a person does: it asks again each time it opens)
    db.tables.meetings = [];
    await go('home');
    await until(s => !document.querySelector(s), pick('#page-meet.active', '[data-part=meetPage]'), 'the page to be left');
    await go('meet');
    await until(s => { const c = document.querySelector(s); return !!c && c.textContent.includes('Nothing scheduled'); }, pick('#meet-meetings', '[data-part=meetings]'), 'the empty list');
    await reading('empty');
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
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 600000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
