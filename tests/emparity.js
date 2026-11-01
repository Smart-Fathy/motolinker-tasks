// The new app's My Email against the classic portals', value by value — the same method as tests/gdparity.js (see there): the classic
// page and the new app opened as the same person, in one portal, both colour modes and two looks, at a phone's width, two in-betweens
// and a desktop, and the computed style of every named part compared, and the words in them.
//
//   loading       the answer about the account has not come
//   unconfigured  there is no Google project on this server        unlinked   there is, and no account is linked
//   linked        an account and its inbox (unread and read, a bare address, a long sender and subject, a message with no subject)
//   empty         an account with nothing in its inbox
//   listLoading   the inbox is on its way               msgLoading   the message that was chosen is on its way
//   open          a message opened (text)               openHtml     …and one that is a page of HTML, in its frame
//   compose       the administrator's New Email sheet   reply        …and its Reply sheet, filled in for the message
//
// What Gmail says is the server's, and is the same on both sides: both ask the same routes the same questions. The routes are
// answered here (the suite does not talk to Google); a state that cannot be put in a real server is a state the answer is made.
// Run with --print to see every difference rather than the first few; --portal=admin (or team) for a half; --only=original/dark
// for a look and a mode; --states=a,b for a few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');
// (what the shared list leaves out and this screen sets: where a long word may break, whether a box may be resized, how a picture sits in a line)
const PROPS = [...PROPS_MORE, 'resize', 'wordBreak', 'overflowWrap', 'verticalAlign'];

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ABSENT = process.argv.includes('--absent');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const PORTAL = arg('portal');
const ONLY = arg('only');
const STATE_FILTER = arg('states').split(',').filter(Boolean);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why, by portal. Each must still differ, or it is stale and fails.
const ACCEPTED_BY = { admin: {}, team: {} };

const free = (c, x, text = false) => part(c, x, 'abs', null, text);
const MESSAGES = [
  { id: 'm1', subject: 'Quote for the Hilux', from: 'Ben Buyer <ben@buyer.test>', date: 'Wed, 28 Oct 2026 10:15:00 +0000', snippet: 'Could you send the final price including delivery to Abu Dhabi? We would like to close this week.', unread: true },
  { id: 'm2', subject: 'Re: Service slot on Friday', from: 'ana@motolinker.test', date: 'Tue, 27 Oct 2026 08:00:00 +0000', snippet: 'Friday at ten works for us.', unread: false },
  { id: 'm3', subject: 'A very long subject line that goes on and on to see whether the ellipsis is drawn at the end of it', from: '"Fay Fleet Manager, Long Company Name Trading LLC" <fay@fleet.test>', date: 'Mon, 26 Oct 2026 17:45:00 +0000', snippet: 'A snippet that is just as long as the subject so that it, too, has to be cut short by the list rather than wrapped onto a second line of the row.', unread: true },
  { id: 'm4', subject: '(no subject)', from: 'Dee <dee@dealer.test>', date: 'Sun, 25 Oct 2026 12:00:00 +0000', snippet: '', unread: false },
];
const TEXT = { id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], subject: 'Quote for the Hilux', from: 'Ben Buyer <ben@buyer.test>', to: 'ana@motolinker.test', date: 'Wed, 28 Oct 2026 10:15:00 +0000', messageId: '<m1@buyer.test>', isHtml: false,
  body: 'Hello,\n\nCould you send the final price including delivery to Abu Dhabi?\nWe would like to close this week.\n\nThanks,\nBen' };
const HTML = { ...TEXT, id: 'm3', threadId: 't3', subject: 'Offer', from: 'Fay <fay@fleet.test>', isHtml: true,
  body: '<html><body style="font-family:sans-serif;margin:8px"><h3>Offer</h3><p>Two <b>units</b> are available for delivery.</p></body></html>' };
const LINKED = { configured: true, connected: true, email: 'ana@motolinker.test', name: 'Ana A.', canSend: true };
const STATES = {
  unconfigured: { configured: false },
  unlinked: { configured: true, connected: false },
  linked: LINKED,
};

// The parts of a page, by portal: a name, its place in the classic markup and in the new app's.
const rolesFor = who => {
  const A = who === 'admin';
  const C = '#email-content';
  const N = A ? '[data-part=emailContent]' : '[data-part=emailPage]';
  const page = A ? { page: free('#page-email', '[data-part=emailPage]'), content: free(C, N) } : { page: free(C, N) };
  const loading = {
    loading: free(`${C} > .loading`, `${N} > [data-part=loading]`, true),
    spinner: free(`${C} > .loading .spinner`, `${N} > [data-part=loading] [data-part=spinner]`),
  };
  const card = {
    card: free(A ? `${C} .email-connect-card` : `${C} > div`, `${N} [data-part=connectCard]`),
    cardIcon: free(A ? `${C} .email-icon` : `${C} > div > svg`, A ? `${N} [data-part=connectIcon]` : `${N} [data-part=connectCard] > svg`, true),
    cardTitle: free(A ? `${C} .email-title` : `${C} > div > div:nth-child(2)`, `${N} [data-part=connectTitle]`, true),
    cardSub: free(A ? `${C} .email-sub` : `${C} > div > div:nth-child(3)`, `${N} [data-part=connectSub]`, true),
  };
  const env = A ? { env: free(`${C} .email-connect-card pre`, `${N} [data-part=env]`, true) } : {};
  const button = {
    connect: free(A ? `${C} .email-connect-card a.btn` : `${C} > div > a.btn`, `${N} [data-part=connectBtn]`, true),
    // (the team's button has the mail icon in it; the administrator's is the words alone)
    connectIcon: free(A ? `${C} .email-connect-card a.btn svg` : `${C} > div > a.btn svg`, `${N} [data-part=connectBtn] svg`),
  };
  const H = `${C} > div:nth-child(1)`;
  const account = {
    account: free(H, `${N} [data-part=account]`),
    who: free(`${H} > div:nth-child(1)`, `${N} [data-part=who]`),
    avatar: free(`${H} > div:nth-child(1) > div:nth-child(1)`, `${N} [data-part=accountAvatar]`, true),
    name: free(`${H} > div:nth-child(1) > div:nth-child(2) > div:nth-child(1)`, `${N} [data-part=accountName]`, true),
    email: free(`${H} > div:nth-child(1) > div:nth-child(2) > div:nth-child(2)`, `${N} [data-part=accountEmail]`, true),
    ...(A ? {
      actions: free(`${H} > div:nth-child(2)`, `${N} [data-part=accountActions]`),
      compose: free(`${H} > div:nth-child(2) > button:nth-child(1)`, `${N} [data-part=compose]`, true),
      disconnect: free(`${H} > div:nth-child(2) > button:nth-child(2)`, `${N} [data-part=disconnect]`, true),
    } : {
      disconnect: free(`${H} > button`, `${N} [data-part=disconnect]`, true),
    }),
  };
  // the inbox: the admin's is a table card in a pane of a split, the team's a card
  const IC = A ? `${C} .email-inbox-pane .table-card` : `${C} > .card`;
  const IL = A ? '#inbox-list' : '#email-inbox-list';
  const inbox = {
    ...(A ? {
      split: free('#email-split', `${N} [data-part=split]`),
      inboxPane: free(`${C} .email-inbox-pane`, `${N} [data-part=inboxPane]`),
      detailPane: free(`${C} .email-detail-pane`, `${N} [data-part=detailPane]`),
    } : {}),
    inboxCard: free(IC, `${N} [data-part=inboxCard]`),
    inboxHeader: free(A ? `${IC} .table-header` : `${IC} > div:nth-child(1)`, `${N} [data-part=inboxHeader]`),
    ...(A ? {
      inboxTitle: free(`${IC} .table-title`, `${N} [data-part=inboxTitle]`, true),
      refresh: free(`${IC} .table-header button`, `${N} [data-part=refresh]`, true),
    } : {}),
    inboxList: free(IL, `${N} [data-part=inboxList]`),
  };
  const rows = {};
  const R = A ? `${IL} > .inbox-item` : `${IL} > div`;
  for (const n of [1, 2, 3, 4]) {
    const row = `${R}:nth-child(${n})`, X = `${N} [data-part=inboxRow]:nth-child(${n})`;
    const body = A ? `${row} > div:nth-child(2)` : `${row} > div > div:nth-child(2)`;
    Object.assign(rows, {
      [`row${n}`]: free(row, X),
      [`dot${n}`]: free(A ? `${row} > div:nth-child(1)` : `${row} > div > div:nth-child(1)`, A ? `${X} > div:nth-child(1)` : `${X} > div > div:nth-child(1)`),
      [`from${n}`]: free(A ? `${body} > div:nth-child(1) > span:nth-child(1)` : `${body} > div:nth-child(1) > div:nth-child(1)`, `${X} [data-part=rowFrom]`, true),
      [`date${n}`]: free(A ? `${body} > div:nth-child(1) > span:nth-child(2)` : `${body} > div:nth-child(1) > div:nth-child(2)`, `${X} [data-part=rowDate]`, true),
      [`subject${n}`]: free(`${body} > div:nth-child(2)`, `${X} [data-part=rowSubject]`, true),
      [`snippet${n}`]: free(`${body} > div:nth-child(3)`, `${X} [data-part=rowSnippet]`, true),
    });
  }
  const empty = { none: free(A ? `${IL} .empty-state` : `${IL} .empty`, `${N} [data-part=inboxNone]`, true) };
  const listLoading = {
    listLoading: free(`${IL} .loading`, `${N} [data-part=inboxLoading]`, true),
    listSpinner: free(`${IL} .loading .spinner`, `${N} [data-part=inboxLoading] [data-part=spinner]`),
  };
  const placeholder = A ? {
    placeholder: free('#email-view-panel > div', `${N} [data-part=placeholder]`),
    placeholderIcon: free('#email-view-panel > div > div:nth-child(1)', `${N} [data-part=placeholderIcon]`, true),
    placeholderText: free('#email-view-panel > div > div:nth-child(2)', `${N} [data-part=placeholderText]`, true),
  } : {};
  // the message that is open
  const msgLoading = A ? {
    detailLoading: free('#email-view-panel .loading', `${N} [data-part=detailLoading]`, true),
    detailSpinner: free('#email-view-panel .loading .spinner', `${N} [data-part=detailLoading] [data-part=spinner]`),
  } : {
    messageBar: free('#email-detail-panel > .card > div:nth-child(1)', `${N} [data-part=messageHead]`),
    detailLoading: free('#email-detail-body .loading', `${N} [data-part=detailLoading]`, true),
    detailSpinner: free('#email-detail-body .loading .spinner', `${N} [data-part=detailLoading] [data-part=spinner]`),
  };
  let message;
  if (A) {
    const M = '#email-view-panel > div', MH = `${M} > div:nth-child(1)`, MM = `${MH} > div:nth-child(3)`;
    message = {
      message: free(M, `${N} [data-part=message]`),
      messageHead: free(MH, `${N} [data-part=messageHead]`),
      back: free(`${MH} .email-back-btn`, `${N} [data-part=back]`, true),
      messageSubject: free(`${MH} > div:nth-child(2)`, `${N} [data-part=messageSubject]`, true),
      messageMeta: free(MM, `${N} [data-part=messageMeta]`),
      messageWho: free(`${MM} > div:nth-child(1)`, `${N} [data-part=messageWho]`),
      messageFrom: free(`${MM} > div:nth-child(1) > div:nth-child(1)`, `${N} [data-part=messageFrom]`, true),
      messageFromValue: free(`${MM} > div:nth-child(1) > div:nth-child(1) span`, `${N} [data-part=messageFrom] span`, true),
      messageTo: free(`${MM} > div:nth-child(1) > div:nth-child(2)`, `${N} [data-part=messageTo]`, true),
      messageToValue: free(`${MM} > div:nth-child(1) > div:nth-child(2) span`, `${N} [data-part=messageTo] span`, true),
      messageDate: free(`${MM} > div:nth-child(1) > div:nth-child(3)`, `${N} [data-part=messageDate]`, true),
      answers: free(`${MM} > div:nth-child(2)`, `${N} [data-part=answers]`),
      reply: free(`${MM} > div:nth-child(2) > button:nth-child(1)`, `${N} [data-part=reply]`, true),
      forward: free(`${MM} > div:nth-child(2) > button:nth-child(2)`, `${N} [data-part=forward]`, true),
      messageBody: free(`${M} > div:nth-child(2)`, `${N} [data-part=messageBody]`),
    };
  } else {
    const P = '#email-detail-panel', CD = `${P} > .card`;
    message = {
      message: free(P, `${N} [data-part=message]`),
      messageCard: free(CD, `${N} [data-part=messageCard]`),
      messageHead: free(`${CD} > div:nth-child(1)`, `${N} [data-part=messageHead]`),
      back: free(`${CD} > div:nth-child(1) > button`, `${N} [data-part=back]`, true),
      backIcon: free(`${CD} > div:nth-child(1) > button svg`, `${N} [data-part=back] svg`),
      messageSubject: free('#email-detail-subject', `${N} [data-part=messageSubject]`, true),
      messageMeta: free('#email-detail-meta', `${N} [data-part=messageMeta]`),
      messageFrom: free('#email-detail-meta > div:nth-child(1)', `${N} [data-part=messageFrom]`, true),
      messageTo: free('#email-detail-meta > div:nth-child(2)', `${N} [data-part=messageTo]`, true),
      messageDate: free('#email-detail-meta > div:nth-child(3)', `${N} [data-part=messageDate]`, true),
      messageBody: free('#email-detail-body', `${N} [data-part=messageBody]`),
      reply: free(`${CD} > div:nth-child(4)`, `${N} [data-part=reply]`),
      replyLabel: free(`${CD} > div:nth-child(4) > div:nth-child(1)`, `${N} [data-part=replyLabel]`, true),
      replyBox: free('#email-reply-body', `${N} [data-part=replyBox]`, true),
      send: free('#email-reply-btn', `${N} [data-part=send]`, true),
      sendIcon: free('#email-reply-btn svg', `${N} [data-part=send] svg`),
    };
  }
  const text = { text: free(A ? '#email-view-panel pre' : '#email-detail-body pre', `${N} [data-part=bodyText]`, true) };
  const frame = { frame: free(A ? '#email-view-panel iframe' : '#email-detail-body iframe', `${N} [data-part=bodyFrame]`) };
  // the administrator's sheet
  const D = '[data-part=dialog] ';
  const sheet = A ? {
    curtain: free('#modal-overlay', '[data-part=curtain]'),
    dialog: free('#modal-box', '[data-part=dialog]'),
    head2: free('#modal-box .modal-header', `${D}> [data-part=head]`),
    sTitle: free('#modal-title', `${D}> [data-part=head] > [data-part=title]`, true),
    close: free('#modal-box .modal-close', `${D}> [data-part=head] > [data-part=close]`, true),
    sBody: free('#modal-body', `${D}> [data-part=body]`),
    toGroup: free('#modal-body > .form-group:nth-child(1)', `${D}[data-part=toGroup]`),
    toLabel: free('#modal-body > .form-group:nth-child(1) label', `${D}[data-part=toGroup] label`, true),
    to: free('#em-to', `${D}[data-part=to]`, true),
    subjectLabel: free('#modal-body > .form-group:nth-child(2) label', `${D}[data-part=subjectGroup] label`, true),
    subject: free('#em-subject', `${D}[data-part=subject]`, true),
    bodyLabel: free('#modal-body > .form-group:nth-child(3) label', `${D}[data-part=bodyGroup] label`, true),
    composeBody: free('#em-body', `${D}[data-part=composeBody]`, true),
    sFoot: free('#modal-footer', `${D}> [data-part=foot]`),
    cancelBtn: free('#modal-footer .btn:nth-child(1)', `${D}> [data-part=foot] > [data-part=cancel]`, true),
    sendBtn: free('#modal-footer .btn:nth-child(2)', `${D}> [data-part=foot] > [data-part=send]`, true),
  } : {};
  return { page, loading, card, env, button, account, inbox, rows, empty, listLoading, placeholder, msgLoading, message, text, frame, sheet };
};

// What each state reads
const READS = {
  loading: ['page', 'loading'],
  unconfigured: ['page', 'card', 'env'],
  unlinked: ['page', 'card', 'button'],
  linked: ['page', 'account', 'inbox', 'rows', 'placeholder'],
  empty: ['page', 'account', 'inbox', 'empty', 'placeholder'],
  listLoading: ['page', 'account', 'inbox', 'listLoading', 'placeholder'],
  // (the page's own height is not read here: the classic team page draws the reply box under a message that has not come yet, which
  // the new one does not — a reply needs a message to answer)
  msgLoading: ['inbox', 'msgLoading'],
  open: ['page', 'inbox', 'rows', 'message', 'text'],
  openHtml: ['page', 'message', 'frame'],
  compose: ['sheet'],
  reply: ['sheet'],
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = arg('widths') ? arg('widths').split(',').map(Number) : [390, 670, 800, 1100];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, portals } = await bootDemo({ port: process.env.PORT || 4027 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  // What the server is made to say about the Gmail account, on both sides alike
  const world = { status: STATES.linked, messages: MESSAGES, bodies: { m1: TEXT, m3: HTML }, hold: {} };
  const stub = (u, m) => {
    const url = new URL(u);
    const x = /^\/api\/(?:employee\/)?email\/(status|messages)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!x || m !== 'GET') return null;
    const [, what, id] = x;
    const answer = () => ({ status: 200, body: what === 'status' ? world.status : id ? world.bodies[id] : world.messages });
    const gate = what === 'status' ? world.hold.status : id ? world.hold.message : world.hold.messages;
    return gate ? gate.then(answer) : answer();
  };

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style
  const absent = new Set();

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const A = p.who === 'admin';
    const states = Object.keys(READS).filter(s => (!STATE_FILTER.length || STATE_FILTER.includes(s)) && (A || !['compose', 'reply'].includes(s)));
    Object.assign(world, { status: STATES.linked, messages: MESSAGES, hold: {} });
    const page = await openPage(browser, base, p, mode, next, stub);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    const pick = (classic, now) => next ? now : classic;
    const content = pick('#email-content', '[data-part=emailPage]');
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=emailPage], #email-content') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const go = to => page.evaluate((next, to) => {
      if (!next) return window.navigate(to);
      document.querySelector(`[data-screen=${to}]`).click();
    }, next, to);
    const exists = sel => until(s => !!document.querySelector(s), sel, sel);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const leave = async () => {
      await go('home');
      await until(s => !document.querySelector(s), pick('#page-email.active', '[data-part=emailPage]'), 'the page to be left');
    };
    const closeSheet = async () => {
      if (next) await page.keyboard.press('Escape'); else await page.evaluate(() => window.hideModal());
      await until(s => !document.querySelector(s), pick('#modal-overlay[style*="flex"]', '[data-part=dialog]'), 'the sheet to close');
    };
    const reading = async (state) => {
      const ROLES = rolesFor(p.who);
      const which = {};
      for (const g of READS[state]) Object.assign(which, ROLES[g]);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS);
        (observed[at] = observed[at] || {})[side] = got;
        if (ABSENT && next) for (const [r, v] of Object.entries(got)) if (v === null) absent.add(`${state}/${r}`);
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };
    // (the page has finished when the loader has gone and something stands where it was)
    const ready = what => until(s => { const c = document.querySelector(s); return !!c && !c.querySelector('.loading, [data-part=loading]') && c.children.length > 0; }, content, what);
    const listed = what => until(s => !!document.querySelector(s), pick(A ? '#inbox-list .inbox-item, #inbox-list .empty-state' : '#email-inbox-list > div:not(.loading), #email-inbox-list .empty', '[data-part=inboxRow], [data-part=inboxNone]'), what);
    const row = n => pick(A ? `#inbox-list > .inbox-item:nth-child(${n})` : `#email-inbox-list > div:nth-child(${n})`, `[data-part=inboxRow]:nth-child(${n})`);
    const opened = (what, html) => until(({ ok, html, admin }) => {
      const b = document.querySelector(ok);
      if (!b || b.querySelector('.loading, [data-part=loading]')) return false;
      if (!html) return !!b.querySelector('pre');
      const f = b.querySelector('iframe');
      return !!f && f.contentDocument && f.contentDocument.readyState === 'complete' && (!admin || !!f.style.height);
    }, { ok: pick(A ? '#email-view-panel' : '#email-detail-body', '[data-part=messageBody]'), html, admin: A }, what);
    // the account and its inbox, with the server saying what a state calls for
    const visit = async (state, status, messages) => {
      world.status = status;
      if (messages) world.messages = messages;
      await go('email');
      await ready(`email to be drawn (${state})`);
      if (READS[state].includes('inbox')) await listed(`the inbox (${state})`);
      await reading(state);
      await leave();
    };

    // the loader: the answer about the account is held back
    if (states.includes('loading')) {
      let release; world.hold.status = new Promise(r => { release = r; });
      await go('email');
      await exists(pick(`${A ? '#email-content > .loading' : '#email-content > .loading'}`, '[data-part=emailPage] [data-part=loading]'));
      await reading('loading');
      release(); world.hold = {};
      await ready('the page after the loader');
      await leave();
    }
    if (states.includes('unconfigured')) await visit('unconfigured', STATES.unconfigured);
    if (states.includes('unlinked')) await visit('unlinked', STATES.unlinked);
    if (states.includes('linked')) await visit('linked', STATES.linked, MESSAGES);
    if (states.includes('empty')) await visit('empty', STATES.linked, []);
    // the inbox is on its way
    if (states.includes('listLoading')) {
      let release; world.hold.messages = new Promise(r => { release = r; });
      world.status = STATES.linked; world.messages = MESSAGES;
      await go('email');
      await exists(pick(A ? '#inbox-list .loading' : '#email-inbox-list .loading', '[data-part=inboxLoading]'));
      await reading('listLoading');
      release(); world.hold = {};
      await listed('the inbox after the loader');
      await leave();
    }
    // …and the message that was chosen
    if (states.includes('msgLoading')) {
      world.status = STATES.linked; world.messages = MESSAGES;
      await go('email');
      await listed('the inbox');
      let release; world.hold.message = new Promise(r => { release = r; });
      await click(row(1) , row(1));
      await exists(pick(A ? '#email-view-panel .loading' : '#email-detail-body .loading', '[data-part=detailLoading]'));
      await reading('msgLoading');
      release(); world.hold = {};
      await opened('the message after the loader', false);
      await leave();
    }
    if (states.includes('open') || states.includes('reply')) {
      world.status = STATES.linked; world.messages = MESSAGES;
      await go('email');
      await listed('the inbox');
      await click(row(1), row(1));
      await opened('the message', false);
      if (states.includes('open')) await reading('open');
      if (states.includes('reply')) {
        await click('#email-view-panel button.btn-primary', '[data-part=reply]');
        await exists(pick('#modal-overlay[style*="flex"]', '[data-part=dialog]'));
        await reading('reply');
        await closeSheet();
      }
      await leave();
    }
    if (states.includes('openHtml')) {
      world.status = STATES.linked; world.messages = MESSAGES;
      await go('email');
      await listed('the inbox');
      await click(row(3), row(3));
      await opened('the page of HTML', true);
      await reading('openHtml');
      await leave();
    }
    if (A && states.includes('compose')) {
      world.status = STATES.linked; world.messages = MESSAGES;
      await go('email');
      await listed('the inbox');
      await click('#email-content > div:nth-child(1) button.btn-primary', '[data-part=compose]');
      await exists(pick('#modal-overlay[style*="flex"]', '[data-part=dialog]'));
      await reading('compose');
      await closeSheet();
      await leave();
    }
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const mode of MODES) for (const p of portals) for (const side of ['classic', 'next']) {
      if (PORTAL && p.who !== PORTAL) continue;
      if (ONLY && !`${look}/${mode}`.startsWith(ONLY)) continue;
      await scenario(p, mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();

  const staleBy = { admin: new Set(Object.keys(ACCEPTED_BY.admin)), team: new Set(Object.keys(ACCEPTED_BY.team)) };
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const who = key.split('/')[0];
    const { n, bad } = diff(classic, next, ACCEPTED_BY[who], staleBy[who], PROPS);
    compared += n;
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (ABSENT) console.log('parts found on neither side or only one:', [...absent].sort().join(', '));
  if (!ONLY && !STATE_FILTER.length) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > (PORTAL ? 30000 : 60000), String(compared));
    const stale = Object.entries(staleBy).filter(([who]) => !PORTAL || PORTAL === who).flatMap(([who, set]) => [...set].map(k => `${who}:${k}`));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.length === 0, stale.join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
