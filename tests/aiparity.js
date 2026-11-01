// The new app's assistant against the classic one, value by value — the same method as tests/gcparity.js and tests/emparity.js (see there): the
// classic page and the new app opened as the same person, in one portal, both colour modes and two looks, at a phone's width, two in-betweens
// and a desktop, and the computed style of every named part compared, and the words in them.
//
//   pill          the "Ask AI" button in the top bar, closed          pillOpen   …and with the panel open (aria-expanded)
//   welcome       the panel open on a section: its head, status, the welcome and its chips, the box (docked beside the page on a desktop,
//                 over it on a tablet, a sheet on a phone)
//   statusOff     the model is not set up    statusBusy   out of capacity    statusFailing   a key that fails    statusReady   no news
//   typing        a question asked, and the answer on its way          answer     …and the answer, with the lookups it made and the model
//   answerOpen    …with the lookups opened    answerAr   an answer in Arabic          answerError   the model could not answer
//   proposals     an answer with two things to confirm                 done       one confirmed          failed     one the server refused
//   record        a supplier's page open: "Looking at…" in the panel
//   cardLoading   the card at the top of Submissions, being read       card       …the card, with who to call first
//   cardOff       …no model set up    cardBusy   …out of capacity     cardEmpty   …with nothing to flag     cardHidden   …put away
//   cardAr        …with lines in Arabic (a list with one is set from the right)
//   panelAway     the panel opened and put away again: where it waits, and the scrim (nothing of it may take a click or be seen)
//   pillHover  miniHover  chipHover  toolHover  gripHover     the pointer on the button, on the card's Refresh, on a chip, on the panel's ×, on its grip
//   actionHeld    Confirm pressed and the server not yet answered: both buttons held
//
// What the assistant says is the server's, and is the same on both sides: both ask the same routes the same questions. The routes are answered
// here (the suite does not talk to a model); a state that cannot be put in a real server is a state the answer is made.
// Run with --print to see every difference rather than the first few; --portal=admin (or team) for a half; --only=original/dark for a look
// and a mode; --states=a,b for a few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, sleep, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');
// (what the shared list leaves out and this screen sets: where a long word may break, how a box that is written in sits, the outline of one that has the
// keyboard, where a line is cut, and what a list that is scrolled to its end does)
const PROPS = [...PROPS_MORE, 'resize', 'wordBreak', 'overflowWrap', 'verticalAlign', 'direction', 'outlineStyle', 'outlineWidth', 'overscrollBehaviorY', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'listStyleType'];

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
const BOTH = {};
const ACCEPTED_BY = { admin: { ...BOTH }, team: { ...BOTH } };

const free = (c, x, text = false) => part(c, x, 'abs', null, text);
// A browser lays text out in 64ths of a pixel: where a margin is "what is left" (auto), the last of those can differ between two pages whose text is
// drawn by different engines of the same browser. Two lengths less than a 20th of a pixel apart are the same length here (nothing the eye can tell).
const align = (classic, next) => {
  for (const [role, c] of Object.entries(classic)) {
    const x = next[role];
    if (!c || !x) continue;
    for (const [k, v] of Object.entries(c)) {
      const w = x[k];
      if (typeof v === 'string' && typeof w === 'string' && /^-?\d+(\.\d+)?px$/.test(v) && /^-?\d+(\.\d+)?px$/.test(w) && Math.abs(parseFloat(v) - parseFloat(w)) < 0.05) x[k] = v;
    }
  }
};

// ── what the server says ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const section = (key, label, en, actions) => ({ key, label, chips: { en, ar: ['ما الذي يحتاج انتباهي اليوم؟'] }, actions });
const SECTIONS = {
  ai: true, act: true, pages: { customers: 'leads' },
  sections: [
    section('home', 'Home', ['What needs my attention today?', 'Plan my day'], ['notify', 'create_task']),
    section('submissions', 'Submissions', ['Which submissions are still unanswered?', 'Summarise this week', 'Who should I call first?'], ['notify']),
    section('suppliers', 'Suppliers', ['Which supplier is slowest to deliver?'], ['notify']),
  ],
};
const STATUS = {
  ok: { ai: true, ok: true, provider: 'cloudflare', model: '@cf/meta/stub-chat-1', error: null, status: null, at: 1 },
  off: { ai: false, ok: false },
  busy: { ai: true, ok: false, provider: 'cloudflare', model: '@cf/meta/stub-chat-1', error: 'Capacity', status: 429, at: 1 },
  failing: { ai: true, ok: false, provider: 'cloudflare', model: '@cf/meta/stub-chat-1', error: 'The key was refused', status: 401, at: 1 },
  ready: { ai: true, ok: null, provider: 'cloudflare', model: null, error: null, status: null, at: 1 },
};
const CARD = {
  ai: true, ok: true, model: '@cf/meta/stub-chat-1', provider: 'cloudflare', generated_at: '2026-11-01T10:42:00.000Z', section: 'submissions', label: 'Submissions', lang: 'en',
  insights: {
    highlights: ['Three submissions arrived today', 'The newest is from a returning buyer'],
    risks: ['One has waited two days without a reply'],
    suggestions: ['Answer the oldest first', 'Offer the buyer a call this afternoon'],
  },
  extra: { call_list: [{ customer_id: 7, name: 'Mona Saleh', why: 'asked twice' }, { customer_id: 9, name: '', why: 'new this morning' }] },
  cached: false,
};
const ANSWER = {
  ai: true, ok: true, section: 'submissions', label: 'Submissions', model: '@cf/meta/stub-chat-1', provider: 'cloudflare', lang: 'en',
  answer: 'Three arrived today. The oldest one, from Mona Saleh, has waited two days and is the one to answer first.',
  tool_calls: [
    { name: 'calculate', args: { expression: '3+2' }, result: { expression: '3+2', result: 5 } },
    { name: 'section_query', args: { query: 'find', q: 'mona' }, result: { rows: [{ id: 7, name: 'Mona Saleh' }] } },
  ],
  proposals: [],
};
const PROPOSALS = [
  { action: { type: 'notify', title: 'Call Mona', to: 'me' }, label: 'Notify', description: 'Send yourself a note: Call Mona.' },
  { action: { type: 'create_task', title: 'Answer Mona', to: 'me' }, label: 'Task', description: 'Make a task for you: Answer Mona.' },
];
const SUPPLIER = { id: 1, name: 'Yu Motors', contact: 'yu@example.com', country: 'China', address: 'Shanghai', notes: '', custom_fields: {}, created_by: 'admin', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' };

// ── the parts of a page: a name, its place in the classic markup and in the new app's ─────────────────────────────────────────────────────
const rolesFor = () => {
  const AB = '[data-part=aiBody]', NB = '#ai-body';
  const page = { content: free('.app-content, .content', '[data-part=content]') };
  // (the pill's place is read from the mode toggle that stands beside it in both headers: what else the two headers carry is not the pill's)
  const beside = (c, x, text = false) => part(c, x, 'abs', 'toggle', text);
  const pill = {
    toggle: free('#ml-mode-toggle', '[data-part=modeToggle]'),
    pill: beside('#ai-btn', '[data-part=aiPill]', true),
    pillBrain: beside('#ai-btn svg', '[data-part=aiPill] svg'),
    pillLabel: beside('#ai-btn .ai-pill-label', '[data-part=aiPillLabel]', true),
    pillKbd: beside('#ai-btn .ai-pill-kbd', '[data-part=aiPillKbd]', true),
  };
  const away = {
    scrimAway: free('#ai-overlay', '[data-part=aiOverlay]'),
    scrimButton: free('#ai-overlay button', '[data-part=aiOverlay] > button'),
    panelAway: free('#ai-panel', '[data-part=aiPanel]'),
    gripAway: free('#ai-grip', '[data-part=aiGrip]'),
  };
  const panel = {
    overlay: free('#ai-overlay', '[data-part=aiOverlay]'),
    overlayButton: free('#ai-overlay button', '[data-part=aiOverlay] > button'),
    panel: free('#ai-panel', '[data-part=aiPanel]'),
    grip: free('#ai-grip', '[data-part=aiGrip]'),
    head: free('.ai-panel-head', '[data-part=aiHead]'),
    title: free('.ai-title', '[data-part=aiTitle]', true),
    titleBrain: free('.ai-title svg', '[data-part=aiTitle] svg'),
    titleName: free('.ai-title > span', '[data-part=aiTitle] > span', true),
    titleSection: free('.ai-title small', '[data-part=aiTitle] small', true),
    status: free('#ai-status', '[data-part=aiStatus]', true),
    tools: free('.ai-tools', '[data-part=aiHead] > div:last-child'),
    lang: free('#ai-lang', '[data-part=aiLang]', true),
    newChat: free('.ai-tools button:nth-of-type(1)', '[data-part=aiNew]'),
    newIcon: free('.ai-tools button:nth-of-type(1) svg', '[data-part=aiNew] svg'),
    close: free('.ai-tools button:nth-of-type(2)', '[data-part=aiClose]', true),
    screen: free('#ai-screen', '[data-part=aiScreen]'),
    body: free(NB, AB),
    composer: free('.ai-composer', '[data-part=aiComposer]'),
    input: free('#ai-input', '[data-part=aiInput]'),
    send: free('#ai-send', '[data-part=aiSend]'),
    sendIcon: free('#ai-send svg', '[data-part=aiSend] svg'),
  };
  const bar = { newChat: panel.newChat, newIcon: panel.newIcon, close: panel.close, grip: panel.grip };
  const welcome = {
    welcome: free(`${NB} > .ai-msg.bot:first-child`, '[data-part=welcome]', true),
    welcomeLabel: free(`${NB} > .ai-msg.bot:first-child b`, '[data-part=welcome] b', true),
    chips: free(`${NB} > div:nth-child(2)`, `${AB} > div:nth-child(2)`),
  };
  for (const n of [1, 2, 3]) welcome[`chip${n}`] = free(`${NB} .ai-chip:nth-child(${n})`, `[data-part=chip]:nth-child(${n})`, true);
  const kept = { welcome: welcome.welcome, welcomeLabel: welcome.welcomeLabel };
  const user = { user: free(`${NB} > .ai-msg.user`, '[data-part=msgUser]', true) };
  const typing = { typing: free(`${NB} > .ai-msg.user + .ai-msg.bot`, '[data-part=typing]', true) };
  const answer = {
    answer: free(`${NB} > .ai-msg.user + .ai-msg.bot`, '[data-part=msgBot]', true),
    work: free(`${NB} .ai-work`, '[data-part=msgBot] [data-part=work]'),
    workSummary: free(`${NB} .ai-work summary`, '[data-part=msgBot] [data-part=work] summary', true),
    workCode: free(`${NB} .ai-work code`, '[data-part=msgBot] [data-part=work] code', true),
    tag: free(`${NB} .ai-tag`, '[data-part=tag]', true),
  };
  const workOpen = {
    code1: free(`${NB} .ai-work code:nth-of-type(1)`, '[data-part=work] code:nth-of-type(1)', true),
    code2: free(`${NB} .ai-work code:nth-of-type(2)`, '[data-part=work] code:nth-of-type(2)', true),
  };
  const action = n => ({
    [`action${n}`]: free(`${NB} .ai-action:nth-of-type(${n})`, `${AB} [data-part=action]:nth-of-type(${n})`, true),
  });
  const actions = {
    card1: free(`${NB} .ai-action`, '[data-part=action]', true),
    title1: free(`${NB} .ai-action .t`, '[data-part=action] > div:nth-child(1)', true),
    desc1: free(`${NB} .ai-action .d`, '[data-part=action] > div:nth-child(2)', true),
    row1: free(`${NB} .ai-action .r`, '[data-part=action] > div:nth-child(3)'),
    confirm1: free(`${NB} .ai-action .ai-btn.pri`, '[data-part=confirm]', true),
    dismiss1: free(`${NB} .ai-action .r .ai-btn:not(.pri)`, '[data-part=dismiss]', true),
  };
  const done = {
    done: free(`${NB} .ai-action.done`, '[data-part=actionDone]', true),
    doneTitle: free(`${NB} .ai-action.done .t`, '[data-part=actionDone] > div:nth-child(1)', true),
    doneDesc: free(`${NB} .ai-action.done .d`, '[data-part=actionDone] > div:nth-child(2)', true),
  };
  const failed = {
    failed: free(`${NB} .ai-action.failed`, '[data-part=actionFailed]', true),
    failedTitle: free(`${NB} .ai-action.failed .t`, '[data-part=actionFailed] > div:nth-child(1)', true),
    failedDesc: free(`${NB} .ai-action.failed > div:nth-child(2)`, '[data-part=actionFailed] > div:nth-child(2)', true),
    failedWhy: free(`${NB} .ai-action.failed > div:nth-child(3)`, '[data-part=actionFailed] > div:nth-child(3)', true),
  };
  void action;
  const record = {
    screenKind: free('#ai-screen .k', '[data-part=aiScreen] > span:nth-child(1)', true),
    screenTitle: free('#ai-screen .t', '[data-part=aiScreen] > span:nth-child(2)', true),
    screenX: free('#ai-screen .x', '[data-part=aiIgnore]', true),
  };
  const card = {
    card: free('#ai-card-submissions', '[data-part=aiCard]'),
    head: free('#ai-card-submissions .ai-card-head', '[data-part=aiCardHead]'),
    brain: free('#ai-card-submissions .ai-card-head > svg', '[data-part=aiCardHead] > svg'),
    title: free('#ai-card-submissions .ai-card-head b', '[data-part=aiCardHead] b', true),
    status: free('#ai-card-submissions .ai-card-head .st', '[data-part=aiCardStatus]', true),
    refresh: free('#ai-card-submissions .ai-card-head .ai-mini:nth-of-type(1)', '[data-part=aiCardRefresh]', true),
    ask: free('#ai-card-submissions .ai-card-head .ai-mini.ask', '[data-part=aiCardAsk]', true),
    askIcon: free('#ai-card-submissions .ai-card-head .ai-mini.ask svg', '[data-part=aiCardAsk] svg'),
    toggle: free('#ai-card-submissions .ai-card-head .ai-mini:nth-of-type(3)', '[data-part=aiCardToggle]', true),
    body: free('#ai-card-submissions .ai-card-body', '[data-part=aiCardBody]'),
  };
  const empty = { empty: free('#ai-card-submissions .ai-card-body > .ai-empty', '[data-part=aiCardBody] > [data-part=aiEmpty]', true) };
  const lists = { cols: free('#ai-card-submissions .ai-cols', '[data-part=aiCols]') };
  for (const n of [1, 2, 3]) {
    Object.assign(lists, {
      [`col${n}`]: free(`#ai-card-submissions .ai-cols > div:nth-child(${n})`, `[data-part=aiCols] > div:nth-child(${n})`),
      [`h${n}`]: free(`#ai-card-submissions .ai-cols > div:nth-child(${n}) h4`, `[data-part=aiCols] > div:nth-child(${n}) h4`, true),
      [`ul${n}`]: free(`#ai-card-submissions .ai-cols > div:nth-child(${n}) ul`, `[data-part=aiCols] > div:nth-child(${n}) ul`),
      [`li${n}`]: free(`#ai-card-submissions .ai-cols > div:nth-child(${n}) li`, `[data-part=aiCols] > div:nth-child(${n}) li`, true),
    });
  }
  const calls = {
    calls: free('#ai-card-submissions .ai-calls', '[data-part=aiCalls]'),
    callsHead: free('#ai-card-submissions .ai-calls h4', '[data-part=aiCalls] h4', true),
    call1: free('#ai-card-submissions .ai-call:nth-of-type(1)', '[data-part=aiCall]:nth-of-type(1)'),
    call1Name: free('#ai-card-submissions .ai-call:nth-of-type(1) b', '[data-part=aiCall]:nth-of-type(1) b', true),
    call1Why: free('#ai-card-submissions .ai-call:nth-of-type(1) span', '[data-part=aiCall]:nth-of-type(1) span', true),
    call2: free('#ai-card-submissions .ai-call:nth-of-type(2)', '[data-part=aiCall]:nth-of-type(2)'),
    call2Name: free('#ai-card-submissions .ai-call:nth-of-type(2) b', '[data-part=aiCall]:nth-of-type(2) b', true),
  };
  return { page, pill, away, panel, bar, welcome, kept, user, typing, answer, workOpen, actions, done, failed, record, card, empty, lists, calls };
};
const ROLES = rolesFor();

// What each state reads (groups of parts), the page it is on, and what the panel does for it
const READS = {
  pill: { read: ['page', 'pill'], on: 'submissions' },
  pillOpen: { read: ['page', 'pill'], on: 'submissions', panel: true },
  panelAway: { read: ['away'], on: 'submissions', panel: true, away: true },
  pillHover: { read: ['pill'], on: 'submissions', hover: ['#ai-btn', '[data-part=aiPill]'] },
  chipHover: { read: ['welcome'], on: 'submissions', panel: true, hover: ['#ai-body .ai-chip:nth-child(1)', '[data-part=chip]:nth-child(1)'] },
  toolHover: { read: ['bar'], on: 'submissions', panel: true, hover: ['.ai-tools button:nth-of-type(2)', '[data-part=aiClose]'] },
  gripHover: { read: ['bar'], on: 'submissions', panel: true, hover: ['#ai-grip', '[data-part=aiGrip]'] },
  welcome: { read: ['page', 'pill', 'panel', 'welcome'], on: 'submissions', panel: true },
  statusOff: { read: ['panel'], on: 'submissions', panel: true, status: 'off' },
  statusBusy: { read: ['panel'], on: 'submissions', panel: true, status: 'busy' },
  statusFailing: { read: ['panel'], on: 'submissions', panel: true, status: 'failing' },
  statusReady: { read: ['panel'], on: 'submissions', panel: true, status: 'ready' },
  typing: { read: ['panel', 'kept', 'user', 'typing'], on: 'submissions', panel: true },
  answer: { read: ['panel', 'kept', 'user', 'answer'], on: 'submissions', panel: true },
  answerOpen: { read: ['answer', 'workOpen'], on: 'submissions', panel: true },
  answerAr: { read: ['user', 'answer'], on: 'submissions', panel: true },
  answerError: { read: ['user', 'answer'], on: 'submissions', panel: true },
  proposals: { read: ['answer', 'actions'], on: 'submissions', panel: true },
  done: { read: ['done'], on: 'submissions', panel: true },
  failed: { read: ['failed'], on: 'submissions', panel: true },
  actionHeld: { read: ['actions'], on: 'submissions', panel: true },
  record: { read: ['panel', 'record'], on: 'suppliers', panel: true },
  cardLoading: { read: ['card', 'empty'], on: 'submissions' },
  card: { read: ['card', 'lists', 'calls'], on: 'submissions' },
  cardOff: { read: ['card', 'empty'], on: 'submissions' },
  cardBusy: { read: ['card', 'empty'], on: 'submissions' },
  cardEmpty: { read: ['card', 'lists'], on: 'submissions' },
  cardAr: { read: ['card', 'lists'], on: 'submissions' },
  miniHover: { read: ['card'], on: 'submissions', hover: ['#ai-card-submissions .ai-card-head .ai-mini:nth-of-type(1)', '[data-part=aiCardRefresh]'] },
  cardHidden: { read: ['card'], on: 'submissions' },
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = arg('widths') ? arg('widths').split(',').map(Number) : [390, 670, 800, 1100];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 4036 });
  db.tables.suppliers = [SUPPLIER];
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  // What the server is made to say about the assistant, on both sides alike
  const world = {};
  const reset = () => Object.assign(world, { runStatus: 0, sections: SECTIONS, status: STATUS.ok, insights: CARD, chat: ANSWER, run: { ok: true, type: 'notify', message: 'Notification sent to you.', result: {} }, hold: {} });
  reset();
  const stub = (u, m) => {
    const url = new URL(u);
    const x = /^\/api\/(?:employee|dashboard)\/ai\/(sections|status|insights|chat|actions\/run)$/.exec(url.pathname);
    if (!x) return null;
    const [, what] = x;
    if (m !== (what === 'sections' || what === 'status' ? 'GET' : 'POST')) return null;
    const key = what === 'actions/run' ? 'run' : what;
    const answer = () => (key === 'run' && world.runStatus ? { status: world.runStatus, body: world.run } : { status: 200, body: world[key] });
    const gate = world.hold[key];
    return gate ? gate.then(answer) : answer();
  };

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style
  const absent = new Set();

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const states = Object.keys(READS).filter(s => !STATE_FILTER.length || STATE_FILTER.includes(s));
    reset();
    const page = await openPage(browser, base, p, mode, next, stub);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    // The classic header carries things the new one does not (yet): the auto-refresh note, the Help button (Run 6c), and the page's Refresh button (which
    // the new pages draw in their own heads). They crowd the pill, which then shrinks and wraps its label at the widths where they do: that is the header's,
    // not the pill's, so they are put away here and what is compared is the pill.
    await page.addStyleTag({ content: STILL + (next ? '' : '.refresh-indicator,.last-updated,#help-btn,.header-right>.btn,.topbar-hours{display:none!important}') });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => 'card: ' + ((document.querySelector('#ai-card-submissions, [data-part=aiCard]') || {}).innerText || '(none)').replace(/\s+/g, ' ').slice(0, 200) + ' | panel: ' + ((document.querySelector('[data-part=aiPanel], #ai-panel') || { innerText: '(none)' }).innerText).replace(/\s+/g, ' ').slice(-400)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const go = to => page.evaluate((next, to) => {
      if (!next) return window.navigate(to);
      document.querySelector(`[data-screen=${to}]`).click();
    }, next, to);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const exists = (classic, now, words = '') => until(({ s, words }) => { const e = document.querySelector(s); return !!e && (!words || e.innerText.includes(words)); }, { s: pick(classic, now), words }, `${classic} / ${now}`);
    const gone = (classic, now) => until(s => !document.querySelector(s), pick(classic, now), `${classic} / ${now} to go`);
    const PANEL = ['#ai-panel.open', '[data-part=aiPill][aria-expanded=true]'];
    const openPanel = async (statusWords = '') => {
      await click('#ai-btn', '[data-part=aiPill]');
      await exists(...PANEL);
      await exists('#ai-status', '[data-part=aiStatus]', statusWords);
      await sleep(250);   // (the box takes the keyboard 120 ms after the panel opens, on a desktop: that has happened before anything is read)
    };
    const closePanel = async () => {
      await click('.ai-tools button:nth-of-type(2)', '[data-part=aiClose]');
      await until(c => { const pill = document.querySelector(c); return !!pill && pill.getAttribute('aria-expanded') === 'false'; }, pick('#ai-btn', '[data-part=aiPill]'), 'the panel to be put away');
    };
    const ask = async words => {
      await page.evaluate((s, words) => { const i = document.querySelector(s); i.value = words; i.dispatchEvent(new Event('input', { bubbles: true })); }, pick('#ai-input', '[data-part=aiInput]'), words);
      if (next) {
        // (a controlled box: the value is set the way a person's typing sets it)
        await page.focus('[data-part=aiInput]');
        await page.evaluate(() => { const i = document.querySelector('[data-part=aiInput]'); i.value = ''; });
        await page.keyboard.type(words);
        await page.keyboard.press('Enter');
      } else await click('#ai-send', '[data-part=aiSend]');
    };
    const answered = words => exists('#ai-body', '[data-part=aiBody]', words);
    const reading = async state => {
      const which = {};
      for (const g of READS[state].read) Object.assign(which, ROLES[g]);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        if (READS[state].hover) { await page.mouse.move(0, 0); await page.hover(pick(...READS[state].hover)).catch(() => undefined); await sleep(60); }
        const at = `${p.who}/${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS);
        (observed[at] = observed[at] || {})[side] = got;
        if (ABSENT && next) for (const [r, v] of Object.entries(got)) if (v === null) absent.add(`${state}/${r}`);
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
      if (READS[state].hover) await page.mouse.move(0, 0);
    };
    // the page the state is read on
    let on = null;
    const visit = async to => {
      if (on === to) return;
      await go(to);
      await until(s => !!document.querySelector(s), pick(`#page-${to}.active`, to === 'submissions' ? '[data-part=submissionsPage], [data-part=pageTitle]' : '[data-part=suppliersPage]'), `the ${to} page`);
      on = to;
    };
    // the card, asked for afresh: the card of the page is rebuilt (the classic one) or the screen is left and come back to (the new one)
    const freshCard = async () => {
      if (!next) {
        await page.evaluate(() => { document.getElementById('ai-card-submissions')?.remove(); window.aiMountCard('submissions'); });
      } else {
        await go('suppliers');
        await exists('', '[data-part=suppliersPage]');
        await go('submissions');
      }
      await exists('#ai-card-submissions', '[data-part=aiCard]');
    };

    for (const state of states) {
      const r = READS[state];
      reset();
      if (r.status) world.status = STATUS[r.status];
      await visit(r.on);
      if (r.panel) await openPanel(r.status === 'off' ? 'not configured' : r.status === 'busy' ? 'Busy' : r.status === 'failing' ? 'failing' : r.status === 'ready' ? 'Ready' : 'Connected');
      switch (state) {
        case 'panelAway':
          await closePanel();
          break;
        case 'pill': case 'pillOpen': case 'pillHover': case 'chipHover': case 'toolHover': case 'gripHover': case 'welcome': case 'statusOff': case 'statusBusy': case 'statusFailing': case 'statusReady':
          break;
        case 'typing': {
          let release; world.hold.chat = new Promise(r => { release = r; });
          await ask('Who should I call first?');
          await exists('#ai-body .ai-msg.user + .ai-msg.bot', '[data-part=typing]');
          await reading(state);
          release(); world.hold = {};
          await answered('Mona Saleh');
          break;
        }
        case 'answer': case 'answerOpen': {
          await ask('Who should I call first?');
          await answered('Mona Saleh');
          await exists('#ai-body .ai-tag', '[data-part=tag]');
          if (state === 'answerOpen') await click('#ai-body .ai-work summary', '[data-part=work] summary');
          break;
        }
        case 'answerAr': {
          world.chat = { ...ANSWER, answer: 'ثلاث رسائل وصلت اليوم، والأقدم تنتظر منذ يومين.', tool_calls: [] };
          await ask('من أتصل به أولاً؟');
          await answered('ثلاث رسائل');
          await exists('#ai-body .ai-tag', '[data-part=tag]');
          break;
        }
        case 'answerError': {
          world.chat = { ai: true, ok: false, error: 'cloudflare: The key was refused', status: 401 };
          await ask('Who should I call first?');
          await answered('I could not answer just now');
          break;
        }
        case 'actionHeld': {
          world.chat = { ...ANSWER, tool_calls: [], proposals: PROPOSALS };
          await ask('Remind me to call Mona');
          await exists('#ai-body .ai-action', '[data-part=action]');
          world.hold.run = new Promise(r => { world.releaseRun = r; });
          await click('#ai-body .ai-action .ai-btn.pri', '[data-part=confirm]');
          await until(s => !!document.querySelector(s) && document.querySelector(s).disabled, pick('#ai-body .ai-action .ai-btn.pri', '[data-part=confirm]'), 'Confirm to be held');
          await reading(state);
          world.releaseRun(); world.hold = {};
          await exists('#ai-body .ai-action.done', '[data-part=actionDone]');
          break;
        }
        case 'proposals': case 'done': case 'failed': {
          world.chat = { ...ANSWER, tool_calls: [], proposals: PROPOSALS };
          await ask('Remind me to call Mona');
          await exists('#ai-body .ai-action', '[data-part=action]');
          if (state === 'done') {
            await click('#ai-body .ai-action .ai-btn.pri', '[data-part=confirm]');
            await exists('#ai-body .ai-action.done', '[data-part=actionDone]');
          }
          if (state === 'failed') {
            world.run = { error: 'Not permitted' }; world.runStatus = 403;
            await click('#ai-body .ai-action .ai-btn.pri', '[data-part=confirm]');
            await exists('#ai-body .ai-action.failed', '[data-part=actionFailed]', 'Not permitted');
          }
          break;
        }
        case 'record': {
          await page.evaluate((next) => { if (!next) return window.openSupplierDetail(1); }, next);
          if (next) await click('', '[data-part=suppliersPage] [data-part=card] button');
          await exists('#ai-screen.on', '[data-part=aiScreen] [data-part=aiIgnore]');
          break;
        }
        case 'cardLoading': {
          let release; world.hold.insights = new Promise(r => { release = r; });
          await freshCard();
          await exists('#ai-card-submissions .ai-card-body .ai-empty', '[data-part=aiCardBody] [data-part=aiEmpty]', 'Reading');
          await reading(state);
          release(); world.hold = {};
          await exists('#ai-card-submissions .ai-cols', '[data-part=aiCols]');
          break;
        }
        case 'card': case 'cardEmpty': case 'cardAr': case 'miniHover': case 'cardOff': case 'cardBusy': {
          if (state === 'cardAr') world.insights = { ...CARD, cached: true, insights: { highlights: ['وصلت ٣ طلبات اليوم'], risks: ['رسالة واحدة بلا رد', 'One is late'], suggestions: ['Call Mona'] }, extra: {} };
          if (state === 'cardEmpty') world.insights = { ...CARD, cached: true, insights: { highlights: [], risks: [], suggestions: [] }, extra: {} };
          if (state === 'cardOff') world.insights = { ai: false, section: 'submissions' };
          if (state === 'cardBusy') world.insights = { ai: true, ok: false, error: 'cloudflare: Capacity', status: 429, busy: 'The assistant is busy right now. Try again in a moment.' };
          await freshCard();
          await exists('#ai-card-submissions .ai-card-body', '[data-part=aiCardBody]');
          await until(({ off, busy, empty }) => { const t = (document.querySelector('#ai-card-submissions, [data-part=aiCard]') || {}).innerText || ''; return off ? /not configured/.test(t) : busy ? /busy/i.test(t) : empty ? /Nothing to flag/.test(t) : /highlights/i.test(t); }, { off: state === 'cardOff', busy: state === 'cardBusy', empty: state === 'cardEmpty' }, 'the card');
          break;
        }
        case 'cardHidden': {
          await freshCard();
          await exists('#ai-card-submissions .ai-cols', '[data-part=aiCols]');
          await click('#ai-card-submissions .ai-card-head .ai-mini:nth-of-type(3)', '[data-part=aiCardToggle]');
          await until(s => document.querySelector(s).innerText.trim() === 'Show', pick('#ai-card-submissions .ai-card-head .ai-mini:nth-of-type(3)', '[data-part=aiCardToggle]'), 'the card to be put away');
          break;
        }
        default: throw new Error('no such state ' + state);
      }
      if (state !== 'typing' && state !== 'actionHeld') await reading(state);
      // put it all away: the panel, and the card's choice
      if (r.panel && !r.away) {
        if (state === 'pillOpen' || !['pill'].includes(state)) await closePanel();
      }
      if (state === 'cardHidden') {
        await click('#ai-card-submissions .ai-card-head .ai-mini:nth-of-type(3)', '[data-part=aiCardToggle]');
        await page.evaluate(() => { try { localStorage.removeItem('ml_ai_card_submissions'); } catch (e) { /* none */ } });
      }
      if (state === 'record') { if (!next) await page.evaluate(() => { if (typeof window.hideModal === 'function') window.hideModal(); }); on = null; await visit('submissions'); }   // (the classic page's supplier is a modal that stays over the page until it is put away; the new one goes with its screen)
      // each state begins from a panel with no conversation
      if (r.panel) { await openPanel(); await click('.ai-tools button:nth-of-type(1)', '[data-part=aiNew]'); await closePanel(); }
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

  if (process.env.AI_PEEK) {
    const [role, prop] = process.env.AI_PEEK.split('.');
    for (const [k, sides] of Object.entries(observed)) console.log('[peek]', k, JSON.stringify(sides.classic && sides.classic[role] && sides.classic[role][prop]), JSON.stringify(sides.next && sides.next[role] && sides.next[role][prop]));
  }
  const staleBy = { admin: new Set(Object.keys(ACCEPTED_BY.admin)), team: new Set(Object.keys(ACCEPTED_BY.team)) };
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const who = key.split('/')[0];
    align(classic, next);
    const { n, bad } = diff(classic, next, ACCEPTED_BY[who], staleBy[who], PROPS);
    compared += n;
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (ABSENT) console.log('parts found on neither side or only one:', [...absent].sort().join(', '));
  if (!ONLY && !STATE_FILTER.length) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > (PORTAL ? 20000 : 40000), String(compared));
    const stale = Object.entries(staleBy).filter(([who]) => !PORTAL || PORTAL === who).flatMap(([who, set]) => [...set].map(k => `${who}:${k}`));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.length === 0, stale.join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
