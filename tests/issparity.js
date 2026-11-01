// The new app's Issues centre against the classic team portal's, value by value — the same method as tests/subparity.js and
// tests/notifparity.js (see there): the classic page and the new app opened as the same person, in both colour modes and two
// looks, at a phone's width, two in-betweens and a desktop, and the computed style of every named part compared, and the words
// in them. (The admin portal never had this page; it gets the team's, so there is nothing of the admin's to compare it to.)
//
//   loading        the server is slow to answer: the queue gives way to the loader
//   queue          three tickets, two of them open and one resolved, nothing picked
//   filter         the "Open" chip pressed
//   threadLoading  a ticket picked, its conversation still on its way
//   ticket         a ticket and its conversation: replies, one with a file; the reply box
//   solved         a resolved ticket nobody has answered
//   empty          nothing in the queue
//   error          the server could not be asked
//
// The error's words are the server's: the classic page prints what the database said, the new one what /api/v1 says, so the
// error is compared by its look and not by its words.
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

// The part each role names, classic and new. Positions are held relative to the page's own root (`rel`).
const P = '#page-issues ';
const D = '#iss-detail ';
const role = (c, x, text = false, y = 'abs', rel = 'root') => part(c, x, y, rel, text);
const ROLES = {
  root: part('#page-issues', '[data-part=page]', 'none'),
  head: role(P + '.iss-head', '[data-part=head]'),
  title: role(P + '.iss-head h2', '[data-part=heading]', true),
  sub: role('#iss-sub', '[data-part=sub]', true),
  chips: role('#issues-filter', '[data-part=chips]'),
  chipAll: role('#issues-filter .rq-chip:nth-child(1)', '[data-part=chip][data-value=""]', true),
  chipOpen: role('#issues-filter .rq-chip:nth-child(2)', '[data-part=chip][data-value=open]', true),
  chipResolved: role('#issues-filter .rq-chip:nth-child(3)', '[data-part=chip][data-value=resolved]', true),
  countAll: role('#iss-n-all', '[data-part=chip][data-value=""] [data-part=count]', true),
  countOpen: role('#iss-n-open', '[data-part=chip][data-value=open] [data-part=count]', true),
  countResolved: role('#iss-n-resolved', '[data-part=chip][data-value=resolved] [data-part=count]', true),
  dotOpen: role('#issues-filter .iss-dot.open', '[data-part=chip][data-value=open] [data-part=dot]'),
  dotDone: role('#issues-filter .iss-dot.done', '[data-part=chip][data-value=resolved] [data-part=dot]'),
  split: role(P + '.iss-split', '[data-part=split]'),
  list: role('#issues-list', '[data-part=list]'),
  loading: role('#issues-list .loading', '[data-part=list] [data-part=loading]', true),
  spinner: role('#issues-list .spinner', '[data-part=list] [data-part=loading] > span'),
  empty: role('#issues-list .empty', '[data-part=list] [data-part=empty]', true),
  card1: role('#issues-list .iss-card:nth-child(1)', '[data-part=card]:nth-child(1)'),
  stripe1: role('#issues-list .iss-card:nth-child(1) .iss-stripe', '[data-part=card]:nth-child(1) [data-part=stripe]'),
  cardMain1: role('#issues-list .iss-card:nth-child(1) .iss-card-main', '[data-part=card]:nth-child(1) [data-part=cardMain]'),
  cardTitle1: role('#issues-list .iss-card:nth-child(1) .iss-card-title', '[data-part=card]:nth-child(1) [data-part=cardTitle]', true),
  cardMeta1: role('#issues-list .iss-card:nth-child(1) .iss-card-meta', '[data-part=card]:nth-child(1) [data-part=cardMeta]', true),
  pill1: role('#issues-list .iss-card:nth-child(1) .rq-pill', '[data-part=card]:nth-child(1) [data-part=pill]', true),
  pillDot1: role('#issues-list .iss-card:nth-child(1) .rq-pill i', '[data-part=card]:nth-child(1) [data-part=pill] i'),
  card2: role('#issues-list .iss-card:nth-child(2)', '[data-part=card]:nth-child(2)'),
  cardTitle2: role('#issues-list .iss-card:nth-child(2) .iss-card-title', '[data-part=card]:nth-child(2) [data-part=cardTitle]', true),
  card3: role('#issues-list .iss-card:nth-child(3)', '[data-part=card]:nth-child(3)'),
  stripe3: role('#issues-list .iss-card:nth-child(3) .iss-stripe', '[data-part=card]:nth-child(3) [data-part=stripe]'),
  pill3: role('#issues-list .iss-card:nth-child(3) .rq-pill', '[data-part=card]:nth-child(3) [data-part=pill]', true),
  detail: role('#iss-detail', '[data-part=detail]'),
  paneEmpty: role(D + '.iss-empty', '[data-part=paneEmpty]', true),
  paneIcon: role(D + '.iss-empty svg', '[data-part=paneEmpty] svg'),
  paneText: role(D + '.iss-empty span', '[data-part=paneEmpty] > span', true),
  dHead: role(D + '.iss-d-head', '[data-part=dHead]'),
  dTitle: role(D + '.iss-d-title', '[data-part=dTitle]', true),
  dPill: role(D + '.iss-d-head .rq-pill', '[data-part=dHead] [data-part=pill]', true),
  dBy: role(D + '.iss-d-by', '[data-part=dBy]'),
  av: role(D + '.iss-av', '[data-part=av]', true),
  dName: role(D + '.iss-d-by strong', '[data-part=dBy] strong', true),
  dWhen: role(D + '.iss-d-when', '[data-part=dBy] strong + span', true),
  dBody: role(D + '.iss-d-body', '[data-part=dBody]', true),
  attach: role(D + '> a.ce-link', '[data-part=detail] > [data-part=link]', true),
  attachIcon: role(D + '> a.ce-link svg', '[data-part=detail] > [data-part=link] svg'),
  solved: role(D + '.iss-d-solved', '[data-part=dSolved]', true),
  solvedIcon: role(D + '.iss-d-solved svg', '[data-part=dSolved] svg'),
  dSep: role(D + '.iss-d-sep', '[data-part=dSep]'),
  dLabel: role(D + '.iss-d-label', '[data-part=dLabel]', true),
  thread: role('#iss-comments', '[data-part=thread]'),
  threadLoader: role('#iss-comments .loading', '[data-part=thread] [data-part=loading]'),
  threadSpinner: role('#iss-comments .spinner', '[data-part=thread] [data-part=loading] > span'),
  msg1: role('#iss-comments .iss-msg:nth-child(1)', '[data-part=thread] [data-part=msg]:nth-child(1)'),
  msgHead1: role('#iss-comments .iss-msg:nth-child(1) .iss-msg-head', '[data-part=thread] [data-part=msg]:nth-child(1) [data-part=msgHead]'),
  msgAuthor1: role('#iss-comments .iss-msg:nth-child(1) .iss-msg-head strong', '[data-part=thread] [data-part=msg]:nth-child(1) [data-part=msgHead] strong', true),
  msgWhen1: role('#iss-comments .iss-msg:nth-child(1) .iss-msg-head span', '[data-part=thread] [data-part=msg]:nth-child(1) [data-part=msgHead] span', true),
  msgBody1: role('#iss-comments .iss-msg:nth-child(1) .iss-msg-body', '[data-part=thread] [data-part=msg]:nth-child(1) [data-part=msgBody]', true),
  msg2: role('#iss-comments .iss-msg:nth-child(2)', '[data-part=thread] [data-part=msg]:nth-child(2)'),
  msgBody2: role('#iss-comments .iss-msg:nth-child(2) .iss-msg-body', '[data-part=thread] [data-part=msg]:nth-child(2) [data-part=msgBody]', true),
  msgLink2: role('#iss-comments .iss-msg:nth-child(2) a.ce-link', '[data-part=thread] [data-part=msg]:nth-child(2) [data-part=link]', true),
  msgLinkIcon2: role('#iss-comments .iss-msg:nth-child(2) a.ce-link svg', '[data-part=thread] [data-part=msg]:nth-child(2) [data-part=link] svg'),
  none: role('#iss-comments .iss-none', '[data-part=thread] [data-part=none]', true),
  reply: role(D + '.iss-reply', '[data-part=reply]'),
  replyInput: role('#iss-reply-input', '[data-part=reply] textarea'),
  replyRow: role(D + '.iss-reply-row', '[data-part=replyRow]'),
  send: role(D + '.iss-reply-row .btn-primary', '[data-part=send]', true),
  toggle: role(D + '.iss-reply-row .btn-outline', '[data-part=toggle]', true),
};
const CHROME = ['root', 'head', 'title', 'sub', 'chips', 'chipAll', 'chipOpen', 'chipResolved', 'countAll', 'countOpen', 'countResolved', 'dotOpen', 'dotDone', 'split', 'list', 'detail'];
const CARDS = ['card1', 'stripe1', 'cardMain1', 'cardTitle1', 'cardMeta1', 'pill1', 'pillDot1', 'card2', 'cardTitle2', 'card3', 'stripe3', 'pill3'];
const TICKET = ['dHead', 'dTitle', 'dPill', 'dBy', 'av', 'dName', 'dWhen', 'dBody', 'attach', 'attachIcon', 'solved', 'solvedIcon', 'dSep', 'dLabel', 'thread', 'reply', 'replyInput', 'replyRow', 'send', 'toggle'];
// What a state reads: the parts it shows (a part that is not there on either side is not compared, one that is on one side only is a failure)
const READS = {
  loading: [...CHROME, 'loading', 'spinner', 'paneEmpty', 'paneIcon', 'paneText'],
  queue: [...CHROME, ...CARDS, 'paneEmpty', 'paneIcon', 'paneText'],
  filter: [...CHROME, ...CARDS],
  threadLoading: [...CHROME, ...CARDS, ...TICKET, 'threadLoader', 'threadSpinner'],
  ticket: [...CHROME, ...CARDS, ...TICKET, 'msg1', 'msgHead1', 'msgAuthor1', 'msgWhen1', 'msgBody1', 'msg2', 'msgBody2', 'msgLink2', 'msgLinkIcon2'],
  solved: [...CHROME, ...CARDS, ...TICKET, 'none'],
  empty: [...CHROME, 'empty', 'paneEmpty', 'paneIcon', 'paneText'],
  error: [...CHROME, 'empty', 'paneEmpty'],
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What the team reported. Times are far from "now" so they read the same in two pages opened a while apart.
const at = (d, h = 9) => new Date(Date.UTC(2026, 8, d, h, 30)).toISOString();
const issues = () => [
  { id: 3, title: 'The showroom Wi-Fi keeps dropping, and the card machine cannot reach the bank when it does, which is why we lose sales', description: 'Since Monday.\nIt happens every hour or so, for about ten minutes at a time.\n\nAn engineer needs to look at the router.', file_url: 'https://cdn.example.com/router.png', reporter_id: 41, reporter_name: 'Sara Ali', status: 'open', created_at: at(21), resolved_at: null, resolved_by: '' },
  { id: 2, title: 'Cannot log hours', description: '', file_url: '', reporter_id: 42, reporter_name: 'Omar', status: 'open', created_at: at(14), resolved_at: null, resolved_by: '' },
  { id: 1, title: 'Printer jammed', description: 'Paper stuck in tray 2.', file_url: '', reporter_id: 41, reporter_name: 'Sara Ali', status: 'resolved', created_at: at(3), resolved_at: at(4, 15), resolved_by: 'Admin' },
];
const comments = () => [
  { id: 1, issue_id: 3, author_key: 'employee_41', author_name: 'Sara Ali', body: 'It happened again just now.', file_url: '', file_name: '', file_size: null, file_type: '', created_at: at(22) },
  { id: 2, issue_id: 3, author_key: 'admin', author_name: 'Admin', body: 'Looking into it.\nCan you send the router\'s log?', file_url: 'https://cdn.example.com/router.log', file_name: 'router.log', file_size: 2048, file_type: 'text/plain', created_at: at(22, 11) },
  { id: 3, issue_id: 3, author_key: 'employee_41', author_name: 'Sara Ali', body: '', file_url: '/files/photo.png', file_name: 'photo.png', file_size: 90000, file_type: 'image/png', created_at: at(22, 12) },
];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 3964 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  const team = portals.find(p => p.who === 'team');

  const observed = {};   // `${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (mode, side, key) => {
    const next = side === 'next';
    db.tables.issues = issues();
    db.tables.issue_comments = comments();
    db.failing.clear(); db.latency = 0;
    const page = await openPage(browser, base, team, mode, next);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    // (the classic pages carry the assistant's card at the top of the page; the assistant moves into the new app with its own batch,
    // and the card is not a part of this page)
    await page.addStyleTag({ content: STILL + '.ai-card,[data-part=aiCard]{display:none!important}' });
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(e => { throw new Error(`team/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]}`); });
    const reading = async state => {
      const which = Object.fromEntries(READS[state].map(r => [r, ROLES[r]]).filter(([, d]) => d));
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS_MORE);
        if (state === 'error') for (const r of Object.values(got)) if (r) delete r._text;
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
    const chip = value => click(`#issues-filter .rq-chip[data-value="${value}"]`, `[data-part=chip][data-value="${value}"]`);
    const cards = () => pick('#issues-list .iss-card', '[data-part=card]');

    // loading: the server is slow, the page is opened, the loader is read before the answer comes
    db.latency = 1500;
    await go('issues');
    await until(s => !!document.querySelector(s), pick('#issues-list .loading', '[data-part=list] [data-part=loading]'), 'the loader');
    await reading('loading');
    db.latency = 0;

    // queue
    await page.waitForFunction((s, want) => document.querySelectorAll(s).length === want, { timeout: 15000, polling: 50 }, cards(), 3);
    await reading('queue');

    // filter
    await chip('open');
    await page.waitForFunction((s, want) => document.querySelectorAll(s).length === want, { timeout: 15000, polling: 50 }, cards(), 2);
    await reading('filter');
    await chip('');
    await page.waitForFunction((s, want) => document.querySelectorAll(s).length === want, { timeout: 15000, polling: 50 }, cards(), 3);

    // a ticket, its conversation still on the way — and then arrived
    db.latency = 1500;
    await click('#issues-list .iss-card:nth-child(1)', '[data-part=card]:nth-child(1)');
    await until(s => !!document.querySelector(s), pick('#iss-comments .loading', '[data-part=thread] [data-part=loading]'), "the conversation's loader");
    await reading('threadLoading');
    db.latency = 0;
    await page.waitForFunction(s => document.querySelectorAll(s).length === 3, { timeout: 15000, polling: 50 }, pick('#iss-comments .iss-msg', '[data-part=thread] [data-part=msg]'));
    await reading('ticket');

    // a resolved ticket nobody has answered
    await click('#issues-list .iss-card:nth-child(3)', '[data-part=card]:nth-child(3)');
    await until(s => !!document.querySelector(s), pick('#iss-comments .iss-none', '[data-part=thread] [data-part=none]'), 'the empty conversation');
    await reading('solved');

    // empty
    db.tables.issues = [];
    await go('home');
    await go('issues');
    await until(s => { const c = document.querySelector(s); return !!c && c.textContent.includes('No issues here'); }, pick('#issues-list', '[data-part=list]'), 'the empty queue');
    await reading('empty');

    // error
    db.failing.add('issues');
    await go('home');
    await go('issues');
    await until(s => { const c = document.querySelector(s); return !!c && c.textContent.trim().length > 0 && !c.querySelector('.iss-card,[data-part=card],.spinner,[data-part=loading]'); }, pick('#issues-list', '[data-part=list]'), 'the error');
    await reading('error');
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${look}/${mode}`.startsWith(ONLY.split('/').slice(0, 2).join('/'))) continue;
      await scenario(mode, side, `${look}/${mode}`);
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
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 30000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
