// The new app's assistant whole: a real server (the real assistant routes, grants, section packs and actions), the built app, a real browser. tests/assistroutes.js
// holds the server's side (who may ask for what, what the model is told, what comes back, that a proposal is nothing until it is confirmed and is checked again
// when it is), apps/web's own tests hold the panel against a script, and tests/aiparity.js holds the look to the classic portals'. This is the three working
// together, with only the model stood in for (at the provider, so that the lookups it asks for are really made) —
//
//   the pill and the key: who has them (the administrator, a member who may ask, not a member who may not), Ctrl+K, Escape, the panel kept open across a reload
//   a question: what the person sees go out and come back (the answer, the lookup the model made, the model's name), the section it was asked in, the language
//   a proposal: nothing is done until it is confirmed; what confirming does (the note is made, the person is told), what is refused and why (a member who may
//     only ask), and what dismissing does (nothing)
//   the card at the top of a section's page: what the model made of it, asked again on Refresh, put away and kept put away
//   a classic page in the app's frame (Leads): the card above the frame, the lead the page has open as what the panel is looking at, what the model is told of it
//   the phone: the pill is the brain alone, and the panel rises as a sheet
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The stand-in goes in before the app is read: src/lib/llm.js takes the providers' functions when it is first required.
const cf = require('../src/lib/cloudflare-ai');
const model = { configured: true, seen: [], script: [], fallback: null };
cf.cloudflareConfigured = () => model.configured;
cf.cloudflareChat = async args => {
  model.seen.push(args);
  const next = model.script.length ? model.script.shift() : model.fallback;
  return typeof next === 'function' ? next(args) : (next || { ok: true, text: 'Fine.', model: '@cf/stub/chat-1', toolCalls: [] });
};

const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath, pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = text => ({ ok: true, text, model: '@cf/stub/chat-1', toolCalls: [] });
const ask = (name, args, id = 't1') => ({ ok: true, text: '', model: '@cf/stub/chat-1', toolCalls: [{ id, name, args }] });
const insights = obj => say(JSON.stringify(obj));
const system = () => String((model.seen[model.seen.length - 1] || {}).systemText || '');
const asksForCard = args => /"highlights"/.test(String(args.systemText || '') + JSON.stringify(args.messages || ''));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webassist-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  const db = createFakeSupabase({
    ...seedTables(parseSchema()),
    customers: [
      { id: 1, name: 'Ahmed Hassan', phone: '0100', phone_norm: '0100', lead_status: 'hot', source: 'fb_ad', created_at: '2026-10-01T00:00:00Z', assigned_to: null, been_contacted: true },
      { id: 2, name: 'Mona Saleh', phone: '0111', phone_norm: '0111', lead_status: 'cold', source: 'website', created_at: '2026-10-20T00:00:00Z', assigned_to: null },
    ],
    lead_activities: [], lead_followups: [], deals: [], tasks: [], notifications: [], submissions: [],
  }, { serial: { notifications: 100, tasks: 100 } });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 4014, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const bot = (chat, act) => ({ assistant: true, assistantActions: { chat, act } });
  const PERMS = {
    ana: { leads: true, leadsActions: { view: true, edit: true }, submissions: true, submissionsActions: { view: true }, ...bot(true, true) },     // may ask, may confirm
    ben: { leads: true, leadsActions: { view: true }, submissions: true, submissionsActions: { view: true }, ...bot(true, false) },                // may ask, may not confirm
    cy: { leads: true, leadsActions: { view: true }, submissions: true, submissionsActions: { view: true }, assistant: false },                    // the assistant switched off
  };
  const member = (id, name, p) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: p, email: name.toLowerCase() + '@example.com' });
  T.employees = T.employees.filter(e => ![91, 92, 93].includes(e.id)).concat([member(91, 'Ana', PERMS.ana), member(92, 'Ben', PERMS.ben), member(93, 'Cy', PERMS.cy)]);
  const ADMIN = { who: 'admin', token: 'wa-admin', key: 'ml_admin_token', route: '/dashboard' };
  const team = (token, id, p) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id, p });
  const ANA = team('wa-ana', 91, PERMS.ana), BEN = team('wa-ben', 92, PERMS.ben), CY = team('wa-cy', 93, PERMS.cy);
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [ANA, BEN, CY]) {
    const e = T.employees.find(x => x.id === m.id);
    ctx.employeeSessions.set(m.token, { id: m.id, name: e.name, username: e.username, job_title: 'Ops', permissions: normEmpPerms(m.p), createdAt: Date.now() });
  }
  const reset = () => {
    model.configured = true; model.seen.length = 0; model.script.length = 0;
    // (a card is asked for in words of its own; a question is answered in a line)
    model.fallback = args => (asksForCard(args) ? insights({ highlights: ['Three arrived today'], risks: ['One is two days old'], suggestions: ['Answer the oldest first'] }) : say('Fine.'));
    T.notifications.length = 0;
  };
  reset();

  // ── the browser ──────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const open = async (who, route, { width = 1280, height = 900 } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.calls = [];
    page.refused = [];
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) page.refused.push(r.status() + ' ' + new URL(r.url()).pathname); });
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith(base)) { const x = new URL(u); page.calls.push({ path: x.pathname, method: r.method(), body: r.postData() }); }
      if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(u)) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (/^https?:/.test(u) && !u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument((key, token) => {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      try { if (!localStorage.getItem(key)) localStorage.setItem(key, token); } catch (_) { /* none */ }
    }, who.key, who.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width, height });
    await page.goto(base + who.route + route, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    page.shut = async () => { await page.close(); await context.close(); };
    return page;
  };
  const until = async (page, fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 50 }, arg); return true; } catch (_) { return false; } };
  const q = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
  const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
  const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const type = async (page, words) => { await page.focus('[data-part=aiInput]'); await page.keyboard.type(words); await page.keyboard.press('Enter'); };
  const openPanel = async page => { await click(page, '[data-part=aiPill]'); return until(page, () => !!document.querySelector('[data-part=aiPanel]') && document.querySelector('[data-part=aiPill]').getAttribute('aria-expanded') === 'true'); };
  const bodyHas = (page, words) => until(page, w => (document.querySelector('[data-part=aiBody]') || { innerText: '' }).innerText.includes(w), words);
  const calls = (page, re, method) => page.calls.filter(c => re.test(c.path) && (!method || c.method === method));

  // ═══ 1. The pill and the key ═══════════════════════════════════════════════════════
  let page = await open(ADMIN, '/submissions');
  check('the administrator has the pill, with the key that opens the panel beside it, closed',
    await q(page, '[data-part=aiPill]') && (await text(page, '[data-part=aiPill]')) === 'Ask AI Ctrl K' && await page.evaluate(() => document.querySelector('[data-part=aiPill]').getAttribute('aria-expanded')) === 'false');
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  check('Ctrl+K opens the panel, and it says how the model is doing and what it reads',
    await until(page, () => /Connected \(chat-1\) · reading Submissions/.test((document.querySelector('[data-part=aiStatus]') || { innerText: '' }).innerText)),
    await text(page, '[data-part=aiStatus]'));
  check('…it is docked beside the page on a desktop (the page gives it room), and the box has the keyboard',
    await page.evaluate(() => { const c = document.querySelector('[data-part=content]'); return parseFloat(getComputedStyle(c).marginRight) >= 400; })
    && await until(page, () => document.activeElement === document.querySelector('[data-part=aiInput]')));
  check('…and is kept open for the next visit', await page.evaluate(() => localStorage.getItem('ml_ai_open')) === '1');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
  check('a reload on a desktop finds the panel where it was left, without taking the keyboard',
    await until(page, () => !!document.querySelector('[data-part=aiPanel]') && document.querySelector('[data-part=aiPill]').getAttribute('aria-expanded') === 'true')
    && await page.evaluate(() => document.activeElement !== document.querySelector('[data-part=aiInput]')));
  await page.focus('[data-part=aiInput]');
  await page.keyboard.press('Escape');
  check('Escape, with the keyboard in the panel, puts it away', await until(page, () => document.querySelector('[data-part=aiPill]').getAttribute('aria-expanded') === 'false') && await page.evaluate(() => localStorage.getItem('ml_ai_open')) === '0');
  await page.shut();

  for (const [who, expected, why] of [[ANA, true, 'a member who may ask'], [BEN, true, 'a member who may ask but not confirm'], [CY, false, 'a member whose assistant is switched off']]) {
    page = await open(who, '/submissions');
    await sleep(800);
    const has = await q(page, '[data-part=aiPill]');
    const asked = calls(page, /\/ai\//).length;
    if (!who.p.assistant && who === CY) {
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await sleep(300);
    }
    check(`${why}: ${expected ? 'has the pill' : 'has no pill, no panel, no key — and the app asks the assistant nothing'}`,
      has === expected && (expected || (!(await q(page, '[data-part=aiPanel]')) && asked === 0 && calls(page, /\/ai\//).length === 0)), `pill ${has}, ai calls ${asked}`);
    await page.shut();
  }

  // ═══ 2. A question ═════════════════════════════════════════════════════════════════
  reset();
  page = await open(ADMIN, '/submissions');
  await openPanel(page);
  model.script.length = 0;
  model.script.push(ask('calculate', { expression: '2+3' }), say('That is 5, from the lookup I made.'));
  await type(page, 'What is 2+3?');
  const answered = await bodyHas(page, 'That is 5, from the lookup I made.');
  const seen = { user: await text(page, '[data-part=msgUser]'), work: await text(page, '[data-part=work] summary'), tag: await text(page, '[data-part=tag]') };
  check('a question goes out, is shown as asked, and comes back as an answer with the lookup the model made and the model that gave it',
    answered && seen.user === 'What is 2+3?' && seen.work === 'Worked out with 1 lookup' && seen.tag.toLowerCase() === 'ai · chat-1', JSON.stringify(seen));
  const chat = calls(page, /\/api\/dashboard\/ai\/chat$/, 'POST')[0];
  const sent = chat && JSON.parse(chat.body);
  check('…the server was asked in the section the page belongs to, with the page and the words, and what is on the screen',
    sent && sent.section === 'submissions' && sent.page === 'submissions' && sent.message === 'What is 2+3?' && Array.isArray(sent.history) && sent.history.length === 0 && sent.screen && sent.screen.page === 'submissions' && !('lang' in sent), JSON.stringify(sent));
  check('…and the model was told who asked and what the section holds', /Submissions/.test(system()) && system().length > 200);
  await click(page, '[data-part=work] summary');
  check('the lookup can be opened: what the model asked, and what it got', (await text(page, '[data-part=work] code')) === 'calculate(2+3)\n= 5'.replace('\n', ' '), await text(page, '[data-part=work] code'));
  model.script.push(say('Second answer.'));
  await type(page, 'And again?');
  const second = await until(page, () => document.querySelectorAll('[data-part=msgBot]').length === 2);
  const sentTwo = JSON.parse(calls(page, /\/api\/dashboard\/ai\/chat$/, 'POST')[1].body);
  check('the conversation goes on: the second question carries the first, and what was answered to it',
    second && sentTwo.history.length === 2 && sentTwo.history[0].role === 'user' && sentTwo.history[1].role === 'bot' && /That is 5/.test(sentTwo.history[1].content), JSON.stringify(sentTwo.history));
  await page.select('[data-part=aiLang]', 'ar');
  // (the card at the top of the page is asked for again in the language chosen: that is not the question's answer)
  for (let i = 0; i < 100 && calls(page, /\/ai\/insights$/, 'POST').length < 2; i++) await sleep(100);
  await sleep(300);
  model.script.push(say('جواب.'));
  await type(page, 'سؤال');
  await until(page, () => document.querySelectorAll('[data-part=msgBot]').length === 3);
  const sentAr = JSON.parse(calls(page, /\/api\/dashboard\/ai\/chat$/, 'POST')[2].body);
  const dir = await page.evaluate(() => getComputedStyle([...document.querySelectorAll('[data-part=msgBot]')].pop()).direction);
  check('a language chosen in the panel goes with the question, and the answer in Arabic is set from the right', sentAr.lang === 'ar' && dir === 'rtl', JSON.stringify({ lang: sentAr.lang, dir, body: sentAr.message }));
  await click(page, '[data-part=aiNew]');
  check('a new conversation puts the welcome and its chips back', await until(page, () => !!document.querySelector('[data-part=welcome]') && document.querySelectorAll('[data-part=chip]').length >= 1));
  await page.select('[data-part=aiLang]', 'auto');
  model.script.length = 0;
  model.script.push(say('The chip was asked.'));
  await click(page, '[data-part=chip]');
  check('a chip is asked as it stands', await bodyHas(page, 'The chip was asked.'));
  await page.shut();

  // ═══ 3. A model that cannot answer ════════════════════════════════════════════════
  reset();
  page = await open(ADMIN, '/submissions');
  await openPanel(page);
  model.script.push({ ok: false, status: 429, error: 'Capacity' });
  await type(page, 'Anything?');
  check('a model that is out of capacity is said so in words, in the conversation', await bodyHas(page, 'busy'), await text(page, '[data-part=aiBody]'));
  model.configured = false;
  await click(page, '[data-part=aiNew]');
  await type(page, 'Hello?');
  check('a server with no model says that, and what to set', await bodyHas(page, 'not configured'), await text(page, '[data-part=aiBody]'));
  await page.shut();

  // ═══ 4. A proposal ════════════════════════════════════════════════════════════════
  reset();
  page = await open(ADMIN, '/submissions');
  await openPanel(page);
  const PROPOSE = (title, id) => ask('propose_action', { type: 'notify', title, body: 'Reminder', to: 'me' }, id);
  model.script.push(PROPOSE('Call Mona', 'p1'), PROPOSE('Call Ahmed', 'p2'), say('I have proposed two notes.'));
  await type(page, 'Remind me to call Mona and Ahmed');
  check('a proposal arrives as a card to confirm — and nothing has been done',
    await until(page, () => document.querySelectorAll('[data-part=action]').length === 2) && T.notifications.length === 0
    && /proposed · /i.test(await text(page, '[data-part=action]')), await text(page, '[data-part=aiBody]'));
  await click(page, '[data-part=action] [data-part=confirm]');
  check('confirming carries it out on the server (the note is made for the administrator) and says what was done, in the panel and at the foot of the screen',
    await until(page, () => !!document.querySelector('[data-part=actionDone]')) && T.notifications.some(n => /Call Mona/.test(n.title || '')) && /Notification sent to you/.test(await text(page, '[data-part=actionDone]'))
    && await until(page, () => /Notification sent to you/.test(document.body.innerText)));
  const ran = calls(page, /\/ai\/actions\/run$/, 'POST');
  check('…by one call, with the action as the card kept it', ran.length === 1 && JSON.parse(ran[0].body).action.title === 'Call Mona', JSON.stringify(ran.map(c => c.body)));
  await click(page, '[data-part=action] [data-part=dismiss]');
  check('dismissing the other does nothing at all: the card goes, and the server is not asked',
    await until(page, () => document.querySelectorAll('[data-part=action]').length === 0) && calls(page, /\/ai\/actions\/run$/, 'POST').length === 1 && !T.notifications.some(n => /Call Ahmed/.test(n.title || '')));
  await page.shut();

  // …a member who may ask but not confirm: the model may propose, the server will not do it
  reset();
  page = await open(BEN, '/submissions');
  await openPanel(page);
  model.script.push(PROPOSE('Call Mona', 'p1'), say('I have proposed one.'));
  await type(page, 'Remind me to call Mona');
  await until(page, () => !!document.querySelector('[data-part=action]'), null, 8000);
  if (await q(page, '[data-part=action]')) {
    await click(page, '[data-part=action] [data-part=confirm]');
    check('a member who may not act is refused when they confirm, and the card says why (nothing is made)',
      await until(page, () => !!document.querySelector('[data-part=actionFailed]')) && T.notifications.length === 0 && (await text(page, '[data-part=actionFailed]')).length > 20, await text(page, '[data-part=actionFailed]'));
  } else {
    check('a member who may not act is offered nothing to confirm (the model is not given the means to propose)', T.notifications.length === 0);
  }
  await page.shut();

  // ═══ 5. The card at the top of a page ═════════════════════════════════════════════
  reset();
  model.fallback = args => (asksForCard(args) ? insights({ highlights: ['Three arrived today'], risks: ['One is two days old'], suggestions: ['Answer the oldest first'] }) : say('Fine.'));
  page = await open(ADMIN, '/submissions');
  check('the card shows what the model made of the section: highlights, risks and suggestions, and who made it',
    await until(page, () => /Three arrived today/.test((document.querySelector('[data-part=aiCard]') || { innerText: '' }).innerText))
    && /RISKS/.test(await text(page, '[data-part=aiCard]')) && /One is two days old/.test(await text(page, '[data-part=aiCard]')) && /Answer the oldest first/.test(await text(page, '[data-part=aiCard]'))
    && /chat-1/.test(await text(page, '[data-part=aiCardStatus]')), await text(page, '[data-part=aiCard]'));
  const cardCalls = () => calls(page, /\/ai\/insights$/, 'POST').map(c => JSON.parse(c.body));
  check('…asked for once, with the page', cardCalls().length === 1 && cardCalls()[0].page === 'submissions' && cardCalls()[0].refresh === false, JSON.stringify(cardCalls()));
  model.fallback = args => (asksForCard(args) ? insights({ highlights: ['Four arrived today'], risks: [], suggestions: [] }) : say('Fine.'));
  await click(page, '[data-part=aiCardRefresh]');
  check('Refresh asks the model again, whatever the server has kept', await until(page, () => /Four arrived today/.test(document.querySelector('[data-part=aiCard]').innerText)) && cardCalls().length === 2 && cardCalls()[1].refresh === true);
  await click(page, '[data-part=aiCardToggle]');
  check('Hide puts it away and the choice is kept', await text(page, '[data-part=aiCardToggle]') === 'Show' && await page.evaluate(() => localStorage.getItem('ml_ai_card_submissions')) === 'closed');
  page.calls.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-part=aiCard]', { timeout: 20000 });
  await sleep(500);
  check('…across a reload, and a card that is put away asks the model for nothing', await text(page, '[data-part=aiCardToggle]') === 'Show' && calls(page, /\/ai\/insights$/, 'POST').length === 0);
  await click(page, '[data-part=aiCardAsk]');
  check('Ask on the card opens the panel', await until(page, () => !!document.querySelector('[data-part=aiPanel]') && document.querySelector('[data-part=aiPill]').getAttribute('aria-expanded') === 'true'));
  await page.evaluate(() => localStorage.removeItem('ml_ai_card_submissions'));
  await page.shut();

  // ═══ 6. A classic page in the app's frame ═════════════════════════════════════════
  reset();
  page = await open(ADMIN, '/leads');
  const frame = async () => { for (let i = 0; i < 200; i++) { const f = page.frames().find(x => x !== page.mainFrame() && /\/legacy\//.test(x.url())); if (f) return f; await sleep(100); } return null; };
  const guest = await frame();
  check('Leads is the classic page in the frame, and the card for it stands above the frame, not inside it',
    !!guest && await until(page, () => { const c = document.querySelector('[data-part=frameCard] [data-part=aiCard]'); const f = document.querySelector('[data-part=legacyFrame]'); return !!c && !!f && !f.contains(c); }), guest ? guest.url() : 'no frame');
  await until(guest, () => typeof window.openLeadProfile === 'function' && !!document.querySelector('.page.active'));
  await openPanel(page);
  await guest.evaluate(() => { openLeadProfile(2); });
  check('a lead opened in the classic page is what the panel says it is looking at',
    await until(page, () => /Lead #2/.test((document.querySelector('[data-part=aiScreen]') || { innerText: '' }).innerText)), await text(page, '[data-part=aiScreen]'));
  check('…by its name once the page has it', await until(page, () => /Lead #2 · Mona Saleh/.test((document.querySelector('[data-part=aiScreen]') || { innerText: '' }).innerText)), `${await text(page, '[data-part=aiScreen]')} — refused: ${page.refused.join(', ')} — drawer: ${await guest.evaluate(() => (document.getElementById('ld-name') || {}).textContent)}`);
  model.script.length = 0;
  model.script.push(say('Mona Saleh is a cold lead from the website.'));
  await type(page, 'Summarise this lead');
  check('the question goes with the lead, and the model is given the lead in full (the page said which, the server read it)',
    await bodyHas(page, 'cold lead from the website') && /Mona Saleh/.test(system()) && JSON.parse(calls(page, /\/api\/dashboard\/ai\/chat$/, 'POST')[0].body).screen.record.id === '2', system().slice(0, 300));
  await click(page, '[data-part=aiIgnore]');
  model.script.push(say('A general answer.'));
  await type(page, 'And in general?');
  await bodyHas(page, 'A general answer.');
  check('…and a lead the person said to ignore is not sent with the next one', !('record' in JSON.parse(calls(page, /\/api\/dashboard\/ai\/chat$/, 'POST')[1].body).screen));
  await page.shut();

  // ═══ 7. A phone ═══════════════════════════════════════════════════════════════════
  reset();
  page = await open(ADMIN, '/submissions', { width: 390, height: 800 });
  const pillBox = await page.evaluate(() => { const b = document.querySelector('[data-part=aiPill]'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: getComputedStyle(b.querySelector('[data-part=aiPillLabel]')).display, radius: getComputedStyle(b).borderTopLeftRadius }; });
  check('on a phone the pill is the brain alone, a round 44px target', pillBox.w === 44 && pillBox.h === 44 && pillBox.label === 'none' && parseFloat(pillBox.radius) > 20, JSON.stringify(pillBox));
  await openPanel(page);
  await sleep(400);
  const sheet = await page.evaluate(() => { const p = document.querySelector('[data-part=aiPanel]').getBoundingClientRect(); return { left: Math.round(p.left), right: Math.round(p.right), bottom: Math.round(p.bottom), top: Math.round(p.top), w: innerWidth, h: innerHeight }; });
  check('…and the panel rises from the bottom as a sheet, the width of the phone', sheet.left === 0 && sheet.right === sheet.w && sheet.bottom === sheet.h && sheet.top > 0 && sheet.top < sheet.h / 2, JSON.stringify(sheet));
  check('…it does not take the keyboard (it would cover the answer)', await page.evaluate(() => document.activeElement !== document.querySelector('[data-part=aiInput]')));
  await click(page, '[data-part=aiOverlay]');
  check('…a tap on the page behind it puts it away', await until(page, () => document.querySelector('[data-part=aiPill]').getAttribute('aria-expanded') === 'false'));
  check('…and none of this threw in the page', page.errors.length === 0, page.errors.join(' | '));
  await page.shut();

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
