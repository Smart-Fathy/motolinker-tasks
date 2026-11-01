// The assistant, as the server does it — in both portals, which share one set of routes (one factory, mounted twice): the administrator's at
// /api/dashboard/ai/* and a team member's at /api/employee/ai/* (sections, status, context, insights, chat, actions/run).
//
// The new app's assistant calls these routes as they are. This holds what the panel and the cards may rely on: who may ask for what
// (assistant.chat for the drawer and the cards, assistant.act for confirming a proposal), which sections a person is offered and whether they
// are offered actions in them, what the model is told (the person, the section, the figures they may see and no others, the language, what is
// open on their screen, the conversation so far), what comes back when the model answers, is busy, fails or is not there at all, that a
// proposal is nothing until it is confirmed and is checked again when it is, and that every answer is the shape packages/contracts says it is.
// The model is stood in for (at the provider, so that the lookups it asks for are really made), so nothing here reaches the network.
const C = require('../packages/contracts');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

// The stand-in goes in before the app is read: src/lib/llm.js takes the providers' functions when it is first required.
const cf = require('../src/lib/cloudflare-ai');
const model = { configured: true, seen: [], script: [], fallback: null };
cf.cloudflareConfigured = () => model.configured;
cf.cloudflareChat = async args => {
  model.seen.push(args);
  const next = model.script.length ? model.script.shift() : model.fallback;
  return typeof next === 'function' ? next(args) : (next || { ok: true, text: 'Fine.', model: '@cf/stub/chat-1', toolCalls: [] });
};

const S = C.schemas;
const SECTIONS = require('../src/lib/sections');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const say = text => ({ ok: true, text, model: '@cf/stub/chat-1', toolCalls: [] });
const ask = (name, args, id = 't1') => ({ ok: true, text: '', model: '@cf/stub/chat-1', toolCalls: [{ id, name, args }] });
const json = obj => say(JSON.stringify(obj));
const fail = (status, error) => ({ ok: false, status, error });
const lastSeen = () => model.seen[model.seen.length - 1];
const system = () => String((lastSeen() || {}).systemText || '');
const reset = () => { model.configured = true; model.seen.length = 0; model.script.length = 0; model.fallback = null; };

const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [],
  customers: [
    { id: 1, name: 'Ahmed Hassan', phone: '0100', lead_status: 'hot', source: 'fb_ad', created_at: '2026-10-01T00:00:00Z', assigned_to: 2, been_contacted: true },
    { id: 2, name: 'Mona Saleh', phone: '0111', lead_status: 'cold', source: 'website', created_at: '2026-10-20T00:00:00Z', assigned_to: 3 },
    { id: 3, name: 'Eli Customer', phone: '0122', lead_status: 'warm', source: 'website', created_at: '2026-10-25T00:00:00Z', assigned_to: 6 },
  ],
  lead_activities: [], lead_followups: [], deals: [], tasks: [], notifications: [],
});
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 4039 });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const person = (id, name, perms) => ({
    id, name, username: name.toLowerCase(), email: '', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), job_title: 'Ops',
    permissions: perms, avatar_url: '', status_text: '', status_emoji: '',
  });
  const bot = (chat, act) => ({ assistant: true, assistantActions: { chat, act } });
  const lead = (extra = {}) => ({ leads: true, leadsActions: { view: true, edit: true, create: true }, ...extra });
  T.employees.push(
    person(2, 'Ana', { ...lead(), tasks: true, tasksActions: { view: true, create: true }, ...bot(true, true) }),      // chat and act, sees every lead
    person(3, 'Ben', { ...lead(), ...bot(true, false) }),                                                                // chat only
    person(4, 'Cy', { ...lead(), assistant: false }),                                                                   // the assistant switched off
    person(5, 'Dee', { leads: false, ...bot(true, true) }),                                                              // may ask, has no leads
    person(6, 'Eli', { ...lead({ scope: { assignedOnly: true } }), ...bot(true, true) }),                                // sees only the leads assigned to him
    person(7, 'Fay', { leads: true, leadsActions: { view: true, edit: false }, ...bot(true, true) }),                    // may act, may not edit a lead
    person(8, 'Gus', { ...bot(true, true), accounting: true, accountingActions: { ai: true, edit: true } }),                        // has the finance assistant
    person(10, 'Ira', { ...bot(true, false), accounting: true, accountingActions: { ai: true, edit: true } }),   // has the finance assistant and may record an expense, but may not act
    person(9, 'Hal', { leads: true, leadsActions: { view: true, edit: false }, submissions: true, submissionsActions: { view: true, edit: true }, ...bot(true, true) }),   // may edit a submission, may not edit a lead
  );
  const call = async (method, path, { token, body } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch (_) {}
    return { status: r.status, data, text };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const tok = {};
  for (const n of ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ira']) tok[n] = await signIn(n);
  const A = '/api/dashboard/ai', E = '/api/employee/ai';
  const settle = () => new Promise(r => setTimeout(r, 120));
  const keys = r => ((r.data && r.data.sections) || []).map(s => s.key);

  // ═══ The state of the model ══════════════════════════════════════════════════
  // (asked first: before anything has been asked of the model, there is nothing to say about it)
  const s0 = await call('GET', A + '/status', { token: 'adm' });
  check('before any call the model is configured and untried: ok is null and nothing has been spent to say so', s0.status === 200 && shape(S.AiStatus, s0.data) === true && s0.data.ai === true && s0.data.ok === null && s0.data.model === null && s0.data.at === 0, JSON.stringify(s0.data));

  // ═══ Who may ask ═════════════════════════════════════════════════════════════
  const ROUTES = [
    { m: 'GET', p: '/sections' }, { m: 'GET', p: '/status' }, { m: 'GET', p: '/context' },
    { m: 'POST', p: '/insights', body: { section: 'home' } }, { m: 'POST', p: '/chat', body: { message: 'hi' } },
    { m: 'POST', p: '/actions/run', body: { type: 'notify', title: 'x' } },
  ];
  const go = (r, prefix, token) => call(r.m, prefix + r.p, { token, body: r.body });
  const unsigned = [];
  for (const r of ROUTES) {
    const outs = [await go(r, A), await go(r, E), await go(r, A, tok.Ana), await go(r, E, 'adm')];   // nobody, nobody, a team member's token on the administrator's, the other way about
    if (outs.some(o => o.status !== 401)) unsigned.push(`${r.m} ${r.p}: ${outs.map(o => o.status).join('/')}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token', unsigned.length === 0, unsigned.join('; '));
  const off = [];
  for (const r of ROUTES) { const o = await go(r, E, tok.Cy); if (o.status !== 403) off.push(`${r.m} ${r.p}: ${o.status}`); }
  check('a team member with the assistant switched off is refused every route (403), the drawer and the cards alike', off.length === 0, off.join('; '));
  const cannotAct = await go(ROUTES[5], E, tok.Ben);
  const canChat = [];
  for (const r of ROUTES.slice(0, 5)) { const o = await go(r, E, tok.Ben); if (o.status !== 200) canChat.push(`${r.m} ${r.p}: ${o.status}`); }
  check('assistant.chat opens the drawer and the cards; confirming a proposal is assistant.act, which is a grant of its own (403 without it)', canChat.length === 0 && cannotAct.status === 403 && same(cannotAct.data, { error: 'Not permitted' }), `${canChat.join('; ')} | ${cannotAct.status}`);
  const admin = await go(ROUTES[0], A, 'adm');
  check('the administrator is allowed everything: the routes need no grant of theirs', admin.status === 200 && (await go(ROUTES[5], A, 'adm')).status === 200);

  // ═══ What a person is offered ════════════════════════════════════════════════
  reset();
  const everySection = Object.keys(SECTIONS.SECTIONS);
  check('the administrator is offered every section, and the finance assistant beside them', admin.status === 200 && shape(S.AiSections, admin.data) === true && same(keys(admin), [...everySection, 'accounting']), keys(admin).join());
  check('…each with the chips the panel shows in both languages and the actions that may be proposed there', admin.data.sections.filter(s => s.key !== 'accounting').every(s => same(s.chips, SECTIONS.SECTIONS[s.key].chips) && same(s.actions, SECTIONS.SECTIONS[s.key].actions)) && admin.data.act === true);
  check('…the finance assistant has chips of its own and proposes nothing from here', same(admin.data.sections.find(s => s.key === 'accounting').actions, []) && admin.data.sections.find(s => s.key === 'accounting').chips.en.length > 0);
  check('…and the page names the portals use map onto sections (the classic ones: customers is leads, rfqs is rfq)', same(admin.data.pages, SECTIONS.PAGE_TO_SECTION) && admin.data.pages.customers === 'leads');
  const ana = await call('GET', E + '/sections', { token: tok.Ana });
  check('a team member is offered the sections their grants reach — and never the administrator\'s two (employees, automations)', ana.status === 200 && shape(S.AiSections, ana.data) === true && keys(ana).includes('leads') && keys(ana).includes('tasks') && !keys(ana).includes('employees') && !keys(ana).includes('automations') && !keys(ana).includes('deals'), keys(ana).join());
  const dee = await call('GET', E + '/sections', { token: tok.Dee });
  check('…none that gate on a grant they do not have (no leads: no Leads section, but Home, which every page borrows)', keys(dee).includes('home') && !keys(dee).includes('leads'), keys(dee).join());
  const ben = await call('GET', E + '/sections', { token: tok.Ben });
  check('without assistant.act the sections come with no actions and the panel is told it may not act', ben.data.act === false && ben.data.sections.every(s => same(s.actions, [])) && ana.data.act === true && ana.data.sections.some(s => s.actions.length > 0));
  const gus = await call('GET', E + '/sections', { token: tok.Gus });
  check('the finance assistant is offered to those who have accounting.ai, and to nobody else', keys(gus).includes('accounting') && !keys(ana).includes('accounting'), keys(gus).join());
  model.configured = false;
  const unset = await call('GET', A + '/sections', { token: 'adm' });
  check('with no model configured the sections are still offered, with ai false (the panel says what to set up)', unset.status === 200 && unset.data.ai === false && unset.data.sections.length === everySection.length + 1 && shape(S.AiSections, unset.data) === true);
  model.configured = true;

  // ═══ The state of the model, once it has been asked ═════════════════════════
  model.configured = false;
  const s1 = await call('GET', A + '/status', { token: 'adm' });
  check('not configured says so in two words and nothing more', same(s1.data, { ai: false, ok: false }) && shape(S.AiStatus, s1.data) === true);
  model.configured = true;
  model.script.push(say('Hello.'));
  await call('POST', A + '/chat', { token: 'adm', body: { message: 'hello', section: 'home' } });
  const s2 = await call('GET', A + '/status', { token: 'adm' });
  check('after a call that worked it says which model answered', s2.data.ok === true && s2.data.provider === 'cloudflare' && s2.data.model === '@cf/stub/chat-1' && s2.data.error === null && shape(S.AiStatus, s2.data) === true, JSON.stringify(s2.data));
  model.script.push(fail(401, 'bad token'));
  await call('POST', A + '/chat', { token: 'adm', body: { message: 'hello again', section: 'home' } });
  const s3 = await call('GET', A + '/status', { token: 'adm' });
  check('…and after one that failed, why (the key is set and failing)', s3.data.ok === false && /bad token/.test(s3.data.error) && s3.data.status === 401 && shape(S.AiStatus, s3.data) === true, JSON.stringify(s3.data));
  const sTeam = await call('GET', E + '/status', { token: tok.Ana });
  check('both portals read the same model (it is the server\'s, not a person\'s)', same(sTeam.data, s3.data));

  // ═══ The cards ═══════════════════════════════════════════════════════════════
  reset();
  model.script.push(json({ highlights: ['3 hot leads'], risks: ['1 follow-up overdue'], suggestions: ['Call Ahmed'], call_list: [{ customer_id: 1, name: 'Ahmed Hassan', why: 'hot, silent for 30 days' }] }));
  const i1 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'leads' } });
  check('the card for a section: highlights, risks and suggestions, who to call first, the model and when', i1.status === 200 && shape(S.AiInsights, i1.data) === true && i1.data.ok === true && same(i1.data.insights, { highlights: ['3 hot leads'], risks: ['1 follow-up overdue'], suggestions: ['Call Ahmed'] }) && same(i1.data.extra, { call_list: [{ customer_id: 1, name: 'Ahmed Hassan', why: 'hot, silent for 30 days' }] }) && i1.data.section === 'leads' && i1.data.label === 'Leads' && i1.data.lang === 'en' && i1.data.cached === false, JSON.stringify(i1.data).slice(0, 200));
  check('…the model is asked for JSON, about this section, as this person, for the figures they may see', lastSeen().json === true && /"Leads" section/.test(system()) && /The person is the admin/.test(system()) && /SECTION PACK/.test(system()));
  const i2 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'leads' } });
  check('the same card asked for again within ten minutes comes from the cache (no second call to the model), marked as such', i2.data.cached === true && model.seen.length === 1 && same(i2.data.insights, i1.data.insights));
  model.script.push(json({ highlights: ['fresh'], risks: [], suggestions: [] }));
  const i3 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'leads', refresh: true } });
  check('…unless a refresh is asked for, which goes to the model again', i3.data.cached === false && i3.data.insights.highlights[0] === 'fresh' && model.seen.length === 2);
  model.script.push(json({ highlights: ['hers'], risks: [], suggestions: [] }));
  const i4 = await call('POST', E + '/insights', { token: tok.Ana, body: { page: 'customers' } });
  check('a card is a person\'s own: Ana does not get the administrator\'s, and the page name the portal uses (customers) finds the section', i4.status === 200 && i4.data.section === 'leads' && i4.data.cached === false && i4.data.insights.highlights[0] === 'hers' && /employee id 2/.test(system()), String(i4.data.section));
  model.script.push(json({ highlights: ['1', '2', '3', '4', '5', '6', '7', '8'], risks: [{ what: 'odd' }, 'plain'], suggestions: 'not a list', call_list: [{ customer_id: '7', name: null, why: 5 }, { customer_id: 'x', name: 'Mona' }, 2, 3, 4, 5, 6, 7].map(x => (typeof x === 'object' ? x : { customer_id: x, name: 'n' + x, why: 'w' })) }));
  const iClean = await call('POST', A + '/insights', { token: 'adm', body: { section: 'deals', refresh: true } });
  check('what the model returns is cleaned before it is a card: six to a list, a thing that is not words written out as JSON, a list that is not a list empty, a call list of six with ids as numbers (or none) and words as words', iClean.data.insights.highlights.length === 6 && iClean.data.insights.risks[0] === '{"what":"odd"}' && iClean.data.insights.risks[1] === 'plain' && same(iClean.data.insights.suggestions, []) && iClean.data.extra.call_list.length === 6 && same(iClean.data.extra.call_list[0], { customer_id: 7, name: '', why: '5' }) && iClean.data.extra.call_list[1].customer_id === null && shape(S.AiInsights, iClean.data) === true, JSON.stringify(iClean.data.extra));
  model.script.push(json({ highlights: ['ar'], risks: [], suggestions: [] }));
  const i5 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'leads', lang: 'ar' } });
  check('a card is asked for in the language chosen, and is cached apart from the other language\'s', i5.data.lang === 'ar' && i5.data.cached === false && /Arabic/.test(system()));
  model.script.push(json({ highlights: ['nowhere'], risks: [], suggestions: [] }));
  const i6 = await call('POST', E + '/insights', { token: tok.Dee, body: { section: 'leads' } });
  check('a section the person may not read is not refused but answered as Home: they are asked about what they may see', i6.status === 200 && i6.data.section === 'home' && i6.data.label === 'Home');
  model.script.push(json({ highlights: ['home'], risks: [], suggestions: [] }));
  const i7 = await call('POST', E + '/insights', { token: tok.Ana, body: { section: 'employees' } });
  check('…and the administrator\'s own sections (employees, automations) are Home for a team member too', i7.data.section === 'home');
  const asked = model.seen.length;
  const i8 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'accounting' } });
  check('the Accounting page keeps its own cards: the answer says so and no model is asked', i8.status === 200 && i8.data.ok === false && i8.data.section === 'accounting' && /own insight cards/.test(i8.data.note) && shape(S.AiInsights, i8.data) === true && model.seen.length === asked);
  reset();
  model.script.push(say('not json at all'));
  const i9 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'tasks', refresh: true } });
  check('a model that does not return JSON is told to the card plainly, with its name', i9.data.ok === false && /did not return JSON/.test(i9.data.error) && i9.data.model === '@cf/stub/chat-1' && shape(S.AiInsights, i9.data) === true);
  model.script.push(say('42'));
  const i9b = await call('POST', A + '/insights', { token: 'adm', body: { section: 'tasks', refresh: true } });
  check('…and JSON that is not an object (a number, a bare word) is no card either', i9b.data.ok === false && /did not return JSON/.test(i9b.data.error));
  model.script.push(fail(429, 'Capacity exceeded'));
  const i10 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'tasks', refresh: true } });
  check('a model out of capacity is busy, in words for a person (English by default)', i10.data.ok === false && i10.data.status === 429 && /busy right now/.test(i10.data.busy) && shape(S.AiInsights, i10.data) === true, JSON.stringify(i10.data));
  model.script.push(fail(429, 'Capacity exceeded'));
  const i11 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'tasks', refresh: true, lang: 'ar' } });
  check('…and in Arabic where Arabic was asked for', /[؀-ۿ]/.test(i11.data.busy || ''));
  model.script.push(fail(500, 'boom'));
  const i12 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'tasks', refresh: true } });
  check('any other failure is the model\'s own words, with no "busy"', i12.data.ok === false && /boom/.test(i12.data.error) && i12.data.busy === undefined && i12.data.status === 500);
  model.configured = false;
  const i13 = await call('POST', A + '/insights', { token: 'adm', body: { section: 'tasks' } });
  check('with no model configured: ai false, and the section it would have been', same(i13.data, { ai: false, section: 'tasks' }) && shape(S.AiInsights, i13.data) === true);
  model.configured = true;

  // ═══ A question ══════════════════════════════════════════════════════════════
  reset();
  const c0 = await call('POST', A + '/chat', { token: 'adm', body: {} });
  const c0b = await call('POST', A + '/chat', { token: 'adm', body: { message: '   ' } });
  check('a question with nothing in it is a 400, and the model is not asked', c0.status === 400 && same(c0.data, { error: 'message required' }) && c0b.status === 400 && model.seen.length === 0);
  model.script.push(say('Three hot leads.'));
  const c1 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'How many hot leads?' } });
  check('an answer: the words, the model, the section, and no lookups or proposals when it made none', c1.status === 200 && shape(S.AiChat, c1.data) === true && c1.data.answer === 'Three hot leads.' && c1.data.section === 'leads' && c1.data.label === 'Leads' && c1.data.model === '@cf/stub/chat-1' && c1.data.provider === 'cloudflare' && same(c1.data.tool_calls, []) && same(c1.data.proposals, []) && c1.data.lang === 'en', JSON.stringify(c1.data).slice(0, 220));
  check('…the model is told who is asking, which section, today, the language, and the section\'s figures — and what it is asked is what was typed', /The person is the admin/.test(system()) && /"Leads" section/.test(system()) && /LANGUAGE: answer in English/.test(system()) && /SECTION PACK/.test(system()) && /Ahmed Hassan/.test(system()) && lastSeen().messages[lastSeen().messages.length - 1].content === 'How many hot leads?');
  model.script.push(say('ok'));
  await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'x'.repeat(5000) } });
  check('a question is cut at 4,000 characters', lastSeen().messages[lastSeen().messages.length - 1].content.length === 4000);
  const c0c = await call('POST', A + '/chat', { token: 'adm', body: { message: ' '.repeat(4000) + 'hello' } });
  check('…so a question whose words only begin after that is nothing (a 400)', c0c.status === 400);
  model.script.push(say('ok'));
  await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'and the second?', history: [{ role: 'user', content: 'first?' }, { role: 'bot', content: 'first answer' }] } });
  check('the conversation so far goes with it, the person\'s words as theirs and the assistant\'s as its own', same(lastSeen().messages.map(m => [m.role, m.content]), [['user', 'first?'], ['assistant', 'first answer'], ['user', 'and the second?']]), JSON.stringify(lastSeen().messages.map(m => m.role)));
  model.script.push(say('تمام'));
  const c2 = await call('POST', A + '/chat', { token: 'adm', body: { message: 'كم عدد العملاء؟' } });
  check('no language chosen: it is the language the question is in (Arabic here), and the answer says which', c2.data.lang === 'ar' && /Arabic/.test(system()));
  model.script.push(say('ok'));
  const c3 = await call('POST', A + '/chat', { token: 'adm', body: { message: 'كم عدد العملاء؟', lang: 'en' } });
  check('…and a language chosen wins over the question\'s own', c3.data.lang === 'en' && /answer in English/.test(system()));
  model.script.push(say('ok'));
  const c4 = await call('POST', E + '/chat', { token: tok.Ana, body: { page: 'customers', message: 'hi' } });
  check('the page name the portal uses finds the section, as for the cards', c4.data.section === 'leads' && /employee id 2/.test(system()) && /Ana/.test(system()));
  model.script.push(say('ok'));
  const c5 = await call('POST', E + '/chat', { token: tok.Dee, body: { section: 'leads', message: 'hi' } });
  check('a section the person may not read is answered as Home, never read to them', c5.data.section === 'home' && !/Ahmed Hassan/.test(system()));

  // — what is on the screen —
  model.script.push(say('ok'));
  await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'summarise this', screen: { page: 'customers', tab: 'Activity', search: 'ahmed', filters: { status: 'Hot', source: 'all' }, record: { kind: 'lead', id: '1', title: 'Ahmed Hassan', sub: 'Hot · 0100' }, selected: [{ kind: 'lead', id: '2', title: 'Mona Saleh' }] } } });
  const sc = system();
  check('what is open on the screen goes to the model: the record (so that "this lead" means it), the tab, the search, the filters that are not "all", the rows ticked', /SCREEN: the lead #1 "Ahmed Hassan" \(Hot · 0100\) is OPEN/.test(sc) && /tab "Activity"/.test(sc) && /filtered by the search "ahmed"/.test(sc) && /filters status=Hot/.test(sc) && !/source=all/.test(sc) && /1 row\(s\) ticked: lead #2 Mona Saleh/.test(sc), (sc.match(/SCREEN:.*/) || [''])[0]);
  check('…an open lead arrives in full (its profile, activity, follow-ups), so that "summarise this one" needs no lookup', /FOCUS \(the open record, in full\)/.test(sc));
  model.script.push(say('ok'));
  await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'x', screen: { record: { kind: 'planet', id: '1' }, tab: '' } } });
  check('a screen that names a kind of record there is none of is read for what is sound in it (nothing here), not trusted', !/SCREEN:/.test(system()));

  model.script.push(say('ok'));
  await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'now', history: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', content: 'turn ' + i })) } });
  check('a long conversation goes with it only as far back as the last eight turns', lastSeen().messages.length === 9 && lastSeen().messages[0].content === 'turn 4' && lastSeen().messages[8].content === 'now', lastSeen().messages.map(m => m.content).join('|'));
  model.script.push(say('ok'));
  await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'x', screen: { view: 'Kanban', search: 's'.repeat(200), filters: Object.fromEntries(Array.from({ length: 14 }, (_, i) => ['f' + i, 'v' + i])), selected: Array.from({ length: 14 }, (_, i) => ({ kind: 'lead', id: String(i + 1), title: 't' + i })) } } });
  const big = system();
  check('what is on the screen is held to a size: the view named, a search of 80 characters, ten filters, ten rows ticked', /view "Kanban"/.test(big) && big.includes('search "' + 's'.repeat(80) + '"') && !big.includes('s'.repeat(81)) && /f9=v9/.test(big) && !/f10=/.test(big) && /10 row\(s\) ticked/.test(big) && !/lead #11/.test(big));
  for (let i = 0; i < 8; i++) model.script.push(ask('calculate', { expression: '1 + ' + i }, 'c' + i));   // (more than it is allowed; the seventh call is the one that must answer)
  model.script.splice(6, 2, say('Enough.'));
  const before3 = model.seen.length;
  const cLoop = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'keep calculating' } });
  check('a model that keeps asking for lookups is stopped after six rounds and made to answer in words (seven calls in all, the last with no tools)', cLoop.data.answer === 'Enough.' && cLoop.data.tool_calls.length === 6 && model.seen.length - before3 === 7 && lastSeen().toolChoice === 'none', `${cLoop.data.tool_calls.length} lookups, ${model.seen.length - before3} calls`);
  model.script.length = 0;

  // — the lookups the model makes, and the proposals —
  model.script.push(ask('calculate', { expression: '2 + 3 * 4' }), say('That is 14.'));
  const c6 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'what is 2 + 3 * 4' } });
  check('a lookup the model made is shown with what it asked and what it got back (the working, for the person to open)', c6.data.answer === 'That is 14.' && c6.data.tool_calls.length === 1 && c6.data.tool_calls[0].name === 'calculate' && c6.data.tool_calls[0].result.result === 14 && shape(S.AiChat, c6.data) === true, JSON.stringify(c6.data.tool_calls));
  model.script.push(ask('section_query', { query: 'find_lead', q: '0111' }), say('Mona.'));
  const c7 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'who is 0111' } });
  check('…and a lookup into the section\'s own data is really made (the person it found is in the result)', c7.data.tool_calls[0].name === 'section_query' && /Mona Saleh/.test(JSON.stringify(c7.data.tool_calls[0].result)));
  model.script.push(ask('propose_action', { type: 'create_followup', customer_id: 1, days: 3, note: 'call back' }), say('I have proposed a follow-up for Ahmed.'));
  const c8 = await call('POST', E + '/chat', { token: tok.Ana, body: { section: 'leads', message: 'schedule a follow-up for Ahmed' } });
  const before = T.lead_followups.length;
  check('a proposal comes beside the answer, as something to confirm: its action, what it is called and what it will do — and nothing has been written', shape(S.AiChat, c8.data) === true && c8.data.proposals.length === 1 && c8.data.proposals[0].action.type === 'create_followup' && c8.data.proposals[0].action.customer_id === 1 && /Follow-up/i.test(c8.data.proposals[0].label) && before === 0, JSON.stringify(c8.data.proposals));
  check('…the proposal is among the lookups too, with its result, so the panel can show the work', c8.data.tool_calls.some(t => t.name === 'propose_action' && t.result.proposed === true));
  model.script.push(say('ok'));
  await call('POST', E + '/chat', { token: tok.Ben, body: { section: 'leads', message: 'schedule a follow-up' } });
  const declared = ((lastSeen().tools || [])[0] || {}).functionDeclarations || [];
  check('a person without assistant.act is not given the means to propose: the model is not offered propose_action, and is told it cannot act', !declared.some(d => d.name === 'propose_action') && /you cannot take actions for this person/.test(system()));
  model.script.push(ask('propose_action', { type: 'create_followup', customer_id: 1, days: 3 }), say('Done.'));
  const c9 = await call('POST', E + '/chat', { token: tok.Ben, body: { section: 'leads', message: 'schedule a follow-up' } });
  const before2 = T.lead_followups.length;
  const c9run = c9.data.proposals.length ? await call('POST', E + '/actions/run', { token: tok.Ben, body: { action: c9.data.proposals[0].action } }) : { status: 403 };
  check('…and if it proposes one anyway, confirming it is still refused (403) and nothing is written: the guard is on the confirming, not on the model behaving', c9run.status === 403 && T.lead_followups.length === before2);
  model.script.push(ask('propose_action', { type: 'create_followup', customer_id: 1 }), say('Which day?'));
  const c10 = await call('POST', E + '/chat', { token: tok.Ana, body: { section: 'leads', message: 'schedule a follow-up for Ahmed' } });
  check('a proposal that does not stand up (no date) is the model\'s to correct, not the person\'s to confirm: it is told what is missing and nothing is proposed', c10.data.proposals.length === 0 && /due_at/.test(JSON.stringify(c10.data.tool_calls)), JSON.stringify(c10.data.tool_calls).slice(0, 160));

  // — only what they may see —
  model.script.push(say('ok'));
  await call('POST', E + '/chat', { token: tok.Eli, body: { section: 'leads', message: 'my leads?' } });
  const eli = system();
  model.script.push(say('ok'));
  await call('POST', E + '/chat', { token: tok.Ana, body: { section: 'leads', message: 'my leads?' } });
  const anaText = system();
  check('the figures are drawn under the person\'s own scope: a member who sees only what is assigned to them is told of that, and of no other lead', /Eli Customer/.test(eli) && !/Ahmed Hassan/.test(eli) && !/Mona Saleh/.test(eli) && /Ahmed Hassan/.test(anaText) && /Eli Customer/.test(anaText));
  model.script.push(ask('lookup', { kind: 'lead', customer_id: 1 }), say('ok'));
  const c11 = await call('POST', E + '/chat', { token: tok.Eli, body: { section: 'leads', message: 'tell me about lead 1' } });
  check('…and a lookup follows the same rule: a lead outside the scope is refused to the model with the reason', /outside your scope/.test(JSON.stringify(c11.data.tool_calls)), JSON.stringify(c11.data.tool_calls).slice(0, 160));

  // — the model not there, busy, failing —
  model.script.push(fail(429, 'Capacity exceeded'));
  const c12 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'hello' } });
  check('a model out of capacity is busy, in words for a person (the drawer shows them, not a code)', c12.status === 200 && c12.data.ok === false && c12.data.status === 429 && /busy right now/.test(c12.data.busy) && shape(S.AiChat, c12.data) === true, JSON.stringify(c12.data));
  model.script.push(fail(429, 'Capacity exceeded'));
  const c13 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'مرحبا' } });
  check('…in Arabic to a question in Arabic', /[؀-ۿ]/.test(c13.data.busy || ''));
  model.script.push(fail(500, 'boom'));
  const c14 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'hello' } });
  check('any other failure is the model\'s own words and its status, and no "busy"', c14.data.ok === false && /boom/.test(c14.data.error) && c14.data.status === 500 && c14.data.busy === undefined && shape(S.AiChat, c14.data) === true);
  model.configured = false;
  const c15 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'leads', message: 'hello' } });
  check('with no model configured: ai false, and the section — no question reaches anything', same(c15.data, { ai: false, section: 'leads' }) && shape(S.AiChat, c15.data) === true);
  model.configured = true;

  // — the finance assistant, which the Accounting page keeps —
  reset();
  model.script.push(say('Revenue is up.'));
  const c16 = await call('POST', A + '/chat', { token: 'adm', body: { section: 'accounting', message: 'summarise this month', period: 'month' } });
  check('a question on the Accounting section is answered by the finance assistant, in the same shape (so the drawer is one drawer), labelled for it', c16.status === 200 && shape(S.AiChat, c16.data) === true && c16.data.section === 'accounting' && c16.data.label === 'Accounting' && c16.data.answer === 'Revenue is up.', JSON.stringify(c16.data).slice(0, 200));
  model.script.push(say('ok'));
  const c17 = await call('POST', E + '/chat', { token: tok.Ana, body: { section: 'accounting', message: 'summarise this month' } });
  check('…and without accounting.ai it is Home that answers (the finance figures are not theirs)', c17.data.section === 'home');
  model.script.push(say('ok'));
  const c18 = await call('POST', E + '/chat', { token: tok.Gus, body: { section: 'accounting', message: 'summarise this month' } });
  check('…while someone who has it is answered by the finance assistant', c18.data.section === 'accounting');

  model.script.push(say('ok'));
  await call('POST', E + '/chat', { token: tok.Gus, body: { section: 'accounting', message: 'record rent' } });
  const gusTools = (((lastSeen().tools || [])[0] || {}).functionDeclarations || []).map(d => d.name);
  model.script.push(say('ok'));
  await call('POST', E + '/chat', { token: tok.Ira, body: { section: 'accounting', message: 'record rent' } });
  const iraTools = (((lastSeen().tools || [])[0] || {}).functionDeclarations || []).map(d => d.name);
  check('the finance assistant may propose recording an expense or a payment to someone who may act, and is not given the means to anyone who may not', gusTools.includes('propose_action') && !iraTools.includes('propose_action') && iraTools.length > 0, `${gusTools.join()} | ${iraTools.join()}`);

  // ═══ A proposal, confirmed ═══════════════════════════════════════════════════
  reset();
  const notified = T.notifications.length;
  const a1 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { action: { type: 'notify', title: 'Remember', to: 'me' } } });
  check('a confirmed proposal is carried out, as the manual route would: the answer says what was done, in words', a1.status === 200 && shape(S.AiActionDone, a1.data) === true && a1.data.type === 'notify' && /sent to you/i.test(a1.data.message), JSON.stringify(a1.data));
  const a2 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'create_followup', customer_id: 1, days: 2, note: 'call back' } });
  await settle();
  check('the proposal may be sent as the card kept it ({ action }) or bare ({ type, … }): both are the same', a2.status === 200 && a2.data.type === 'create_followup' && /Ahmed Hassan/.test(a2.data.message) && T.lead_followups.length === 1 && T.lead_followups[0].customer_id === 1 && T.lead_followups[0].created_by === 'ana' && T.lead_followups[0].assigned_to === 2);
  check('…with the same side effects as doing it by hand: the lead\'s activity says it, with the person who confirmed it as its author', T.lead_activities.some(x => x.customer_id === 1 && x.type === 'follow_up' && /Follow-up scheduled/.test(x.body) && x.author_name === 'Ana'), JSON.stringify(T.lead_activities.map(x => [x.type, x.author_name])));
  model.script.push(json({ highlights: ['x'], risks: [], suggestions: [] }));
  const warm = await call('POST', E + '/insights', { token: tok.Ana, body: { section: 'leads' } });
  model.script.push(json({ highlights: ['y'], risks: [], suggestions: [] }));
  await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'create_followup', customer_id: 2, days: 4 } });
  const stale = await call('POST', E + '/insights', { token: tok.Ana, body: { section: 'leads' } });
  check('a confirmed action makes the next reading fresh: the card is not served from before it', warm.data.cached === false && stale.data.cached === false && stale.data.insights.highlights[0] === 'y');
  const a3 = await call('POST', E + '/actions/run', { token: tok.Ana, body: {} });
  check('nothing to carry out is a 400', a3.status === 400 && same(a3.data, { error: 'action.type required' }));
  const a4 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'drop_table' } });
  check('an action there is not is a 400 that names the ones there are', a4.status === 400 && /Unknown action "drop_table"\. Choose one of: create_followup/.test(a4.data.error));
  const a5 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'create_followup', customer_id: 1 } });
  check('the proposal is checked again here, not taken from the card: one with no date is a 400 with what is missing', a5.status === 400 && /due_at/.test(a5.data.error));
  const a6 = await call('POST', E + '/actions/run', { token: tok.Fay, body: { type: 'create_followup', customer_id: 1, days: 2 } });
  check('…and so is what the person may do: they may act, but not edit a lead, and the follow-up on a lead is an edit (403)', a6.status === 403 && same(a6.data, { error: 'Not permitted' }) && T.lead_followups.length === 2);
  const a7 = await call('POST', E + '/actions/run', { token: tok.Eli, body: { type: 'create_followup', customer_id: 1, days: 2 } });
  check('…and their scope: a lead that is not theirs is out of reach even to a proposal that was confirmed (403)', a7.status === 403 && /outside your scope/.test(a7.data.error) && T.lead_followups.length === 2, JSON.stringify(a7.data));
  T.form_submissions = T.form_submissions || [];
  T.form_submissions.push({ id: 31, name: 'Web Visitor', phone: '0133', email: '', car_interest: 'BYD Seal', source: 'website', message: '', customer_id: null, created_at: '2026-10-28T00:00:00Z' });
  const a7b = await call('POST', E + '/actions/run', { token: tok.Hal, body: { type: 'link_submission', submission_id: 31, customer_id: 1 } });
  check('linking a website submission to a lead needs the right to edit leads as well as submissions (403 for someone who has only the one)', a7b.status === 403 && same(a7b.data, { error: 'Not permitted' }) && T.form_submissions[0].customer_id === null, JSON.stringify(a7b.data));
  const a8 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'create_followup', customer_id: 999, days: 2 } });
  check('a lead that is not there is a 404', a8.status === 404 && same(a8.data, { error: 'Lead not found' }));
  const a9 = await call('POST', A + '/actions/run', { token: 'adm', body: { type: 'create_task', title: 'Call supplier', days: 2 } });
  check('the administrator\'s task needs somebody to do it (an employee id), and says so', a9.status === 400 && /who the task is for/.test(a9.data.error));
  const a10 = await call('POST', A + '/actions/run', { token: 'adm', body: { type: 'create_task', title: 'Call supplier', days: 2, assignee_ids: [2] } });
  check('…with one, it is made, for them, by the administrator', a10.status === 200 && shape(S.AiActionDone, a10.data) === true && T.tasks.length === 1 && T.tasks[0].title === 'Call supplier' && T.tasks[0].assignee_id === '2' && T.tasks[0].created_by === 'dashboard', JSON.stringify(T.tasks[0] || null));
  const a11 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'create_task', title: 'My own task', days: 1, assignee_ids: [3] } });
  check('a team member\'s task is their own whoever the model named (the model\'s employee id is not trusted)', a11.status === 200 && T.tasks[1].assignee_id === '2' && T.tasks[1].created_by === 'ana');
  const a12 = await call('POST', E + '/actions/run', { token: tok.Ana, body: { type: 'notify', title: 'Hello', to: '3' } });
  check('a team member may send a note to themselves or the administrator, not to a colleague', a12.status === 403 && /yourself or to the admin/.test(a12.data.error));

  // ═══ The pack, for checking a figure ═════════════════════════════════════════
  const ctxAdmin = await call('GET', A + '/context?section=leads', { token: 'adm' });
  check('/context shows what the model is told for a section — the figures, with the working caches left out', ctxAdmin.status === 200 && ctxAdmin.data && ctxAdmin.data.counts && !Object.keys(ctxAdmin.data).some(k => k.startsWith('_')), Object.keys(ctxAdmin.data || {}).join());
  const ctxAcct = await call('GET', A + '/context?section=accounting', { token: 'adm' });
  check('…and the Accounting section points at its own', ctxAcct.data.section === 'accounting' && /own pack/.test(ctxAcct.data.note));

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
