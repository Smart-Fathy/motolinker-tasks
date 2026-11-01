// The new app's Google Chat against the classic portals', value by value — the same method as tests/gdparity.js and tests/emparity.js (see
// there): the classic page and the new app opened as the same person, in one portal, both colour modes and two looks, at a phone's width,
// two in-betweens and a desktop, and the computed style of every named part compared, and the words in them.
//
//   loading       the answer about the account has not come       unconfigured  Chat is not set up on this server
//   unlinked      it is, and no account is linked                 lost          a link Google no longer honours
//   returned      back from Google's consent screen with a reason (?gchat_error=…)
//   listLoading   the spaces are on their way                     spaces        the spaces (a group, a conversation of two, a long name…)
//   noSpaces      an account with no conversations                spacesDenied  Google says no (the organization does not allow it)
//   spacesExpired …the session has expired (with a way to make it again)         spacesFailed  …it could not be reached
//   open          a space opened, with messages (the person's own, another's, one nobody wrote)
//   msgLoading    the messages are on their way                   noMessages    a space with nothing in it
//   msgDenied     the messages could not be had                   msgExpired    …because the link has gone (with a way to make it again)
//   noRead        a link that was not granted reading             readOnly      …that was not granted sending
//
// What Chat says is the server's, and is the same on both sides: both ask the same routes the same questions. The routes are answered here
// (the suite does not talk to Google); a state that cannot be put in a real server is a state the answer is made. The classic pages hide
// both panes on a phone unless they are marked .mob-show, which Google Chat never does, so on a phone the classic page shows nothing: it is
// marked here the way the main Chat marks its own, and the new app is held to that.
// Run with --print to see every difference rather than the first few; --portal=admin (or team) for a half; --only=original/dark
// for a look and a mode; --states=a,b for a few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');
// (what the shared list leaves out and this screen sets: where a long word may break, whether a box may be resized, how a picture sits in a line,
// whether a list that is scrolled to its end hands the scroll on to the page, the corners of a bubble that the shared list leaves out (its tail
// is the one that is squarer), and the outline of a box that is written in)
const PROPS = [...PROPS_MORE, 'resize', 'wordBreak', 'overflowWrap', 'verticalAlign', 'overscrollBehaviorY', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'outlineStyle', 'outlineWidth'];

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
// Where Chat gave no words of its own for the messages it would not give, the classic page showed the server's bare word ("reconnect"); the new app says it.
const WORDS = {
  'msgCard._text': 'a bare word in the classic page', 'msgCardBody._text': 'a bare word in the classic page',
  'msgCardBody._w': 'a bare word is narrower than a sentence', 'msgCardBody._x': 'a bare word is narrower than a sentence',
};
const ACCEPTED_BY = { admin: { ...WORDS }, team: { ...WORDS } };

const free = (c, x, text = false) => part(c, x, 'abs', null, text);
const SPACES = [
  { name: 'spaces/AAA1', title: 'Sales team', type: 'SPACE' },
  { name: 'spaces/BBB2', title: 'Direct message', type: 'DIRECT_MESSAGE' },
  { name: 'spaces/CCC3', title: 'Operations and logistics crew for the whole region', type: 'GROUP_CHAT' },
  { name: 'spaces/DDD4', title: 'Ünïcode & more', type: 'SPACE' },
];
const at = m => new Date(2026, 9, 20, 9, m).toISOString();
const MESSAGES = {
  'spaces/AAA1': [
    { id: 'spaces/AAA1/messages/m1', text: 'Quote sent to the buyer', senderName: 'Ana A.', senderId: 'users/11', createTime: at(5) },
    { id: 'spaces/AAA1/messages/m2', text: 'Thanks Ana — please also send the delivery terms for Abu Dhabi, with the port charges included in the final price.', senderName: 'Bo B.', senderId: 'users/22', createTime: at(31) },
    { id: 'spaces/AAA1/messages/m3', text: 'Supercalifragilisticexpialidocious_and_a_very_long_unbroken_word_that_has_to_break_somewhere_to_fit_the_bubble', senderName: '', senderId: '', createTime: at(47) },
  ],
};
const CAPS = { spaces: true, read: true, send: true };
const LINKED = { configured: true, connected: true, email: 'ana@motolinker.test', name: 'Ana A.', caps: CAPS };
const STATUS = {
  unconfigured: { configured: false },
  unlinked: { configured: true, connected: false },
  lost: { configured: true, connected: false, reconnect: true, email: 'ana@motolinker.test' },
  linked: LINKED,
  noRead: { ...LINKED, caps: { spaces: true, read: false, send: true } },
  readOnly: { ...LINKED, caps: { spaces: true, read: true, send: false } },
};

// The parts of a page: a name, its place in the classic markup and in the new app's. (The two portals' pages are the same markup.)
const rolesFor = () => {
  const L = '#page-gchat > .chat-layout';
  const N = '[data-part=gchatPage]';
  const M = '#gchat-main', G = '#gchat-messages', X = `${N} [data-part=chatMain]`, W = `${N} [data-part=chatMessages]`;
  const page = {
    page: free('#page-gchat', N),
    layout: free(L, `${N} [data-part=chatLayout]`),
    rooms: free(`${L} > .chat-rooms-panel`, `${N} [data-part=chatRooms]`),
    roomsHeader: free(`${L} .chat-rooms-header`, `${N} [data-part=chatRoomsHeader]`),
    roomsTitle: free(`${L} .chat-rooms-title`, `${N} [data-part=chatRoomsTitle]`, true),
    refresh: free(`${L} .chat-rooms-header button`, `${N} [data-part=chatRefresh]`),
    refreshIcon: free(`${L} .chat-rooms-header button svg`, `${N} [data-part=chatRefresh] svg`),
    roomList: free('#gchat-space-list', `${N} [data-part=chatRoomList]`),
    main: free(M, X),
  };
  const listLoading = {
    listLoading: free('#gchat-space-list > .loading', `${N} [data-part=listLoading]`, true),
    listSpinner: free('#gchat-space-list > .loading .spinner', `${N} [data-part=listLoading] [data-part=spinner]`),
  };
  const none = { noSpaces: free('#gchat-space-list > div', `${N} [data-part=noSpaces]`, true) };
  const rows = {};
  for (const n of [1, 2, 3, 4]) {
    const row = `#gchat-space-list > .chat-room-item:nth-child(${n})`, R = `${N} [data-part=spaceRow]:nth-child(${n})`;
    Object.assign(rows, {
      [`row${n}`]: free(row, R),
      [`wrap${n}`]: free(`${row} .chat-room-avatar-wrap`, `${R} [data-part=spaceAvatarWrap]`),
      [`avatar${n}`]: free(`${row} .chat-room-avatar`, `${R} [data-part=spaceAvatar]`, true),
      [`info${n}`]: free(`${row} .chat-room-info`, `${R} [data-part=spaceInfo]`),
      [`name${n}`]: free(`${row} .chat-room-name`, `${R} [data-part=spaceName]`, true),
      [`preview${n}`]: free(`${row} .chat-room-preview`, `${R} [data-part=spacePreview]`, true),
    });
  }
  const placeholder = {
    placeholder: free(`${M} > .chat-empty-state`, `${X} > [data-part=placeholder]`, true),
    placeholderIcon: free(`${M} > .chat-empty-state svg`, `${X} > [data-part=placeholder] svg`),
  };
  const card = {
    card: free(`${M} > .chat-empty-state`, `${X} > [data-part=stateCard]`, true),
    cardIcon: free(`${M} > .chat-empty-state > svg`, `${X} > [data-part=stateCard] > svg`),
    cardTitle: free(`${M} > .chat-empty-state > div:nth-child(2)`, `${X} [data-part=stateTitle]`, true),
    cardBody: free(`${M} > .chat-empty-state > div:nth-child(3)`, `${X} [data-part=stateBody]`, true),
    cardBtn: free(`${M} > .chat-empty-state > button`, `${X} [data-part=stateBtn]`, true),
  };
  const conversation = {
    header: free(`${M} > .chat-header`, `${X} [data-part=chatHeader]`),
    name: free(`${M} .chat-header-name`, `${X} [data-part=chatName]`, true),
    messages: free(G, W),
  };
  const msgLoading = {
    msgLoading: free(`${G} > .loading`, `${W} [data-part=messagesLoading]`, true),
    msgSpinner: free(`${G} > .loading .spinner`, `${W} [data-part=messagesLoading] [data-part=spinner]`),
  };
  const noMessages = { noMessages: free(`${G} > .chat-empty-state`, `${W} [data-part=noMessages]`, true) };
  const msgCard = {
    msgCard: free(`${G} > .chat-empty-state`, `${W} [data-part=stateCard]`, true),
    msgCardIcon: free(`${G} > .chat-empty-state > svg`, `${W} [data-part=stateCard] > svg`),
    msgCardTitle: free(`${G} > .chat-empty-state > div:nth-child(2)`, `${W} [data-part=stateTitle]`, true),
    msgCardBody: free(`${G} > .chat-empty-state > div:nth-child(3)`, `${W} [data-part=stateBody]`, true),
    msgCardBtn: free(`${G} > .chat-empty-state > button`, `${W} [data-part=stateBtn]`, true),
  };
  const msgs = {};
  for (const n of [1, 2, 3]) {
    const m = `${G} > .chat-msg:nth-child(${n})`, R = `${W} [data-part=msg]:nth-child(${n})`;
    Object.assign(msgs, {
      [`msg${n}`]: free(m, R),
      [`sender${n}`]: free(`${m} .chat-msg-sender`, `${R} [data-part=msgSender]`, true),
      [`bubble${n}`]: free(`${m} .chat-msg-bubble`, `${R} [data-part=msgBubble]`, true),
      [`time${n}`]: free(`${m} .chat-msg-time`, `${R} [data-part=msgTime]`, true),
    });
  }
  const composer = {
    composer: free(`${M} > .chat-composer`, `${X} [data-part=chatComposer]`, true),
    input: free('#gchat-input', `${X} [data-part=chatInput]`),
    send: free('#gchat-send', `${X} [data-part=sendBtn]`),
  };
  // (the classic page draws its icons when the messages have come, not before)
  const sendIcon = { sendIcon: free('#gchat-send svg', `${X} [data-part=sendBtn] svg`) };
  const readOnlyLink = { readOnlyLink: free(`${M} > .chat-composer a`, `${X} [data-part=readOnlyLink]`, true) };
  return { page, listLoading, none, rows, placeholder, card, conversation, msgLoading, noMessages, msgCard, msgs, composer, sendIcon, readOnlyLink };
};
const ROLES = rolesFor();

// What each state reads, and the pane a phone shows for it (the classic page is marked with it: see the head of this file)
const READS = {
  loading: { read: ['page', 'listLoading', 'placeholder'], pane: 'list' },
  unconfigured: { read: ['page', 'card'], pane: 'main' },
  unlinked: { read: ['page', 'card'], pane: 'main' },
  lost: { read: ['page', 'card'], pane: 'main' },
  returned: { read: ['page', 'card'], pane: 'main' },
  listLoading: { read: ['page', 'listLoading', 'placeholder'], pane: 'list' },
  spaces: { read: ['page', 'rows', 'placeholder'], pane: 'list' },
  noSpaces: { read: ['page', 'none', 'placeholder'], pane: 'list' },
  spacesDenied: { read: ['page', 'card'], pane: 'main' },
  spacesExpired: { read: ['page', 'card'], pane: 'main' },
  spacesFailed: { read: ['page', 'card'], pane: 'main' },
  open: { read: ['page', 'rows', 'conversation', 'msgs', 'composer', 'sendIcon'], pane: 'main' },
  msgLoading: { read: ['conversation', 'msgLoading', 'composer'], pane: 'main' },
  noMessages: { read: ['conversation', 'noMessages', 'composer', 'sendIcon'], pane: 'main' },
  msgDenied: { read: ['conversation', 'msgCard', 'composer', 'sendIcon'], pane: 'main' },
  msgExpired: { read: ['conversation', 'msgCard', 'composer', 'sendIcon'], pane: 'main' },
  noRead: { read: ['conversation', 'msgCard', 'composer', 'sendIcon'], pane: 'main' },
  readOnly: { read: ['conversation', 'msgs', 'composer', 'readOnlyLink'], pane: 'main' },
};
// (the new header has a way back to the list that the classic page has not: on a phone, where it is drawn, it moves the name along)
const PHONE_SKIP = { name: ['_x', '_w'] };
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = arg('widths') ? arg('widths').split(',').map(Number) : [390, 670, 800, 1100];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, portals } = await bootDemo({ port: process.env.PORT || 4035, env: { GOOGLE_CHAT_ENABLED: '1', GOOGLE_CHAT_CLIENT_ID: 'demo-client', GOOGLE_CHAT_CLIENT_SECRET: 'demo-secret' } });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  // What the server is made to say about the Chat account, on both sides alike
  const world = { status: STATUS.linked, spaces: { spaces: SPACES }, messages: MESSAGES, hold: {} };
  const stub = (u, m) => {
    const url = new URL(u);
    const x = /^\/api\/(?:employee|dashboard)\/gchat\/(status|spaces|messages)$/.exec(url.pathname);
    if (!x || m !== 'GET') return null;
    const [, what] = x;
    const answer = () => ({ status: 200, body: what === 'status' ? world.status : what === 'spaces' ? world.spaces : (world.messages[url.searchParams.get('space')] ? (world.messageAnswer || { messages: world.messages[url.searchParams.get('space')] }) : { messages: [] }) });
    const gate = world.hold[what];
    if (process.env.GC_DEBUG) console.log('[stub]', what, gate ? 'HELD' : 'answered');
    return gate ? gate.then(answer) : answer();
  };

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style
  const absent = new Set();

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const states = Object.keys(READS).filter(s => !STATE_FILTER.length || STATE_FILTER.includes(s));
    const reset = () => Object.assign(world, { status: STATUS.linked, spaces: { spaces: SPACES }, messages: MESSAGES, messageAnswer: null, hold: {} });
    reset();
    const page = await openPage(browser, base, p, mode, next, stub);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=gchatPage], #page-gchat') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const go = to => page.evaluate((next, to) => {
      if (!next) return window.navigate(to);
      document.querySelector(`[data-screen=${to}]`).click();
    }, next, to);
    // The classic page keeps what the last visit drew (a card stays in the main pane until a space is opened, and the open space is
    // remembered) while the new app starts every visit over: so each state starts from the page as it is when it has just loaded.
    const fresh = next ? null : await page.evaluate(() => [document.getElementById('gchat-main').innerHTML, document.getElementById('gchat-space-list').innerHTML]);
    const enter = async () => {
      if (!next) await page.evaluate(([main, list]) => { document.getElementById('gchat-main').innerHTML = main; document.getElementById('gchat-space-list').innerHTML = list; _gchat.space = null; gchatStopPoll(); }, fresh);
      await go('gchat');
    };
    // something stands where the state puts it: a selector, and (where one selector serves several states) the words in it
    const arrived = (what, classic, now, words = '') => until(({ s, words }) => { const e = document.querySelector(s); return !!e && (!words || e.innerText.includes(words)); }, { s: pick(classic, now), words }, what);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const leave = async () => {
      await go('home');
      await until(s => !document.querySelector(s), pick('#page-gchat.active', '[data-part=gchatPage]'), 'the page to be left');
    };
    const mend = state => next ? null : page.evaluate(pane => {
      document.querySelector('#page-gchat .chat-rooms-panel').classList.toggle('mob-show', pane === 'list');
      document.querySelector('#gchat-main').classList.toggle('mob-show', pane === 'main');
    }, READS[state].pane);
    const reading = async state => {
      const which = {};
      for (const g of READS[state].read) Object.assign(which, ROLES[g]);
      await mend(state);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS);
        if (width <= 700) for (const [role, props] of Object.entries(PHONE_SKIP)) if (got[role] && !got[role]._hidden) for (const prop of props) delete got[role][prop];
        (observed[at] = observed[at] || {})[side] = got;
        if (ABSENT && next) for (const [r, v] of Object.entries(got)) if (v === null) absent.add(`${state}/${r}`);
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };
    const CARD = ['#gchat-main > .chat-empty-state', '[data-part=chatMain] > [data-part=stateCard]'];
    const MCARD = ['#gchat-messages > .chat-empty-state', '[data-part=chatMessages] [data-part=stateCard]'];
    const ROW = n => pick(`#gchat-space-list > .chat-room-item:nth-child(${n})`, `[data-part=spaceRow]:nth-child(${n})`);
    const SPACE_ROWS = ['#gchat-space-list .chat-room-item', '[data-part=spaceRow]'];
    // the page, for a state of the account
    const visit = async (state, status, words) => {
      Object.assign(world, { status });
      await enter();
      await arrived(`the card (${state})`, ...CARD, words);
      await reading(state);
      await leave();
      reset();
    };
    const spaces = async state => {
      await enter();
      await arrived('the spaces', ...SPACE_ROWS);
    };
    const openFirst = async () => {
      await click(ROW(1), ROW(1));
      await arrived('the conversation', '#gchat-main .chat-header', '[data-part=chatHeader]');
    };

    if (states.includes('loading')) {
      let release; world.hold.status = new Promise(r => { release = r; });
      await enter();
      await arrived('the loader (loading)', '#gchat-space-list > .loading', '[data-part=listLoading]');
      await reading('loading');
      release(); world.hold = {};
      await arrived('the page after the loader', ...SPACE_ROWS);
      await leave();
    }
    if (states.includes('unconfigured')) await visit('unconfigured', STATUS.unconfigured, 'not set up');
    if (states.includes('unlinked')) await visit('unlinked', STATUS.unlinked, 'Connect Google Chat');
    if (states.includes('lost')) await visit('lost', STATUS.lost, 'Reconnect Google Chat');
    // sent back from Google's consent screen: the address says why (the classic page reads it when the screen is opened, the new app when it starts)
    if (states.includes('returned')) {
      const query = '?gchat_error=' + encodeURIComponent('Google rejected the Chat permissions.');
      if (next) {
        await page.goto(base + p.route + query + '#gchat', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-part=gchatPage]', { timeout: 20000 });
      } else {
        await page.evaluate(q => history.replaceState(null, '', location.pathname + q), query);
        await enter();
      }
      await arrived('the card (returned)', ...CARD, "Couldn't connect");
      await reading('returned');
      // (the new app opens on the page the person was last on, unless the address says another: so it is asked for Home)
      if (next) await page.goto(base + p.route + '#home', { waitUntil: 'domcontentloaded' });
      else await page.evaluate(() => history.replaceState(null, '', location.pathname));
      if (next) await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
      else await go('home');
      await until(s => !document.querySelector(s), pick('#page-gchat.active', '[data-part=gchatPage]'), 'the page to be left');
      await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    }
    if (states.includes('listLoading')) {
      let release; world.hold.spaces = new Promise(r => { release = r; });
      await enter();
      await arrived('the loader (listLoading)', '#gchat-space-list > .loading', '[data-part=listLoading]');
      await reading('listLoading');
      release(); world.hold = {};
      await arrived('the spaces after the loader', ...SPACE_ROWS);
      await leave();
    }
    if (states.includes('spaces')) {
      await spaces('spaces');
      await reading('spaces');
      await leave();
    }
    if (states.includes('noSpaces')) {
      world.spaces = { spaces: [] };
      await enter();
      await arrived('the note', '#gchat-space-list > div:not(.loading)', '[data-part=noSpaces]');
      await reading('noSpaces');
      await leave();
      reset();
    }
    for (const [state, error, words] of [['spacesDenied', 'forbidden', 'unavailable'], ['spacesExpired', 'reconnect', 'expired'], ['spacesFailed', 'failed', 'Could not reach']]) {
      if (!states.includes(state)) continue;
      world.spaces = { spaces: [], error, detail: 'Backend Error' };
      await enter();
      await arrived(`the card (${state})`, ...CARD, words);
      await reading(state);
      await leave();
      reset();
    }
    if (states.includes('open')) {
      await spaces('open');
      await openFirst();
      await arrived('the messages', '#gchat-messages .chat-msg', '[data-part=msg]');
      // (the classic page takes the mark off every row when a space is opened and never puts it on the open one; the new app marks the
      // open one, as the page's own list does when it is drawn with a space open: so the classic row is marked as that list would)
      if (!next) await page.evaluate(() => document.querySelector('#gchat-space-list .chat-room-item').classList.add('active'));
      await reading('open');
      await leave();
    }
    if (states.includes('msgLoading')) {
      await spaces('msgLoading');
      let release; world.hold.messages = new Promise(r => { release = r; });
      await openFirst();
      await arrived('the loader (msgLoading)', '#gchat-messages > .loading', '[data-part=messagesLoading]');
      await reading('msgLoading');
      release(); world.hold = {};
      await arrived('the messages after the loader', '#gchat-messages .chat-msg', '[data-part=msg]');
      await leave();
    }
    if (states.includes('noMessages')) {
      await spaces('noMessages');
      await click(ROW(2), ROW(2));
      await arrived('the note', '#gchat-messages > .chat-empty-state', '[data-part=noMessages]');
      await reading('noMessages');
      await leave();
    }
    for (const [state, answer, words] of [['msgDenied', { messages: [], error: 'forbidden', detail: 'The caller does not have permission' }, 'Could not load'], ['msgExpired', { messages: [], error: 'reconnect' }, 'Could not load']]) {
      if (!states.includes(state)) continue;
      await spaces(state);
      world.messageAnswer = answer;
      await openFirst();
      await arrived(`the card (${state})`, ...MCARD, words);
      await reading(state);
      await leave();
      reset();
    }
    if (states.includes('noRead')) {
      world.status = STATUS.noRead;
      await spaces('noRead');
      await openFirst();
      await arrived('the card (noRead)', ...MCARD, 'Message history not shared');
      await reading('noRead');
      await leave();
      reset();
    }
    if (states.includes('readOnly')) {
      world.status = STATUS.readOnly;
      await spaces('readOnly');
      await openFirst();
      await arrived('the messages', '#gchat-messages .chat-msg', '[data-part=msg]');
      await arrived('the line', '#gchat-main > .chat-composer a', '[data-part=readOnlyLink]');
      await reading('readOnly');
      await leave();
      reset();
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

  if (process.env.GC_PEEK) {
    const [role, prop] = process.env.GC_PEEK.split('.');
    for (const [k, sides] of Object.entries(observed)) console.log('[peek]', k, JSON.stringify(sides.classic && sides.classic[role] && sides.classic[role][prop]), JSON.stringify(sides.next && sides.next[role] && sides.next[role][prop]));
  }
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
