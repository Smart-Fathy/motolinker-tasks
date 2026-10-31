// The screens of the app, held to the classic portals they replace.
//
// packages/contracts/src/modules.js says which screens there are, who gets each, how each portal's rail lists them,
// and what the classic portals called them. This suite does not trust it: it reads the two classic pages' navigation
// out of their markup and holds the catalogue to every group, label, icon and order; it runs the team portal's own
// permission code (sliced out of public/assets/employee.js) over the same corpus the permission rules are pinned
// against and holds `allows()` to what the classic rail shows; and it reads every link the server and the service
// workers write ('/employee#requests', '?chat=') and holds the deep-link table to resolving each of them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { handmade, fuzz } = require('./helpers/perm-corpus');
const C = require('@motolinker/contracts');
const M = require('@motolinker/contracts/modules');
const D = require('@motolinker/contracts/deeplinks');
const { adminActor, employeeActor } = require('@motolinker/contracts/access');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. The catalogue is consistent with itself and with the permission catalogue ────────────────
const ids = M.SCREENS.map(s => s.id);
check('every screen has its own id', new Set(ids).size === ids.length && ids.every(i => /^[a-z]+$/.test(i)), ids.join());
check('every group a rail uses is a group', ['admin', 'team'].every(p => M.NAV[p].every(g => M.GROUPS.some(x => x.id === g.group))));
for (const portal of ['admin', 'team']) {
  const listed = M.NAV[portal].flatMap(g => g.items);
  const inPortal = M.SCREENS.filter(s => M.inPortal(s, portal)).map(s => s.id);
  check(`the ${portal} rail lists each of its screens once, and only those`, listed.every(i => M.screenOf(i) && M.inPortal(M.screenOf(i), portal))
    && new Set(listed).size === listed.length && same([...listed].sort(), inPortal.filter(i => i !== 'security').sort()),
  `listed ${listed.length}, screens ${inPortal.length}`);
  const legacy = M.SCREENS.filter(s => M.inPortal(s, portal)).map(s => M.legacyIdOf(s, portal));
  check(`no two screens share a classic page id in the ${portal} portal`, new Set(legacy).size === legacy.length);
}
const actionsOf = Object.fromEntries(Object.entries(C.PERM_ACTIONS).map(([s, a]) => [s, new Set(a)]));
const capExists = cap => { const [s, a] = cap.split('.'); return !!(s && a && actionsOf[s] && actionsOf[s].has(a)); };
const needsOk = n => n.kind === 'always' || n.kind === 'admin' || (n.kind === 'section' && !!actionsOf[n.section]) || (n.kind === 'cap' && capExists(n.cap)) || (n.kind === 'anyCap' && n.caps.length > 0 && n.caps.every(capExists));
check('every section and action a screen asks for is in the permission catalogue', M.SCREENS.every(s => needsOk(s.needs)), M.SCREENS.filter(s => !needsOk(s.needs)).map(s => s.id).join());
check('a screen only names a classic page id for a portal it is in', M.SCREENS.every(s => !s.legacy || Object.keys(s.legacy).every(p => M.inPortal(s, p))));
check('the only flag a screen can wait for is one the server sets', M.SCREENS.every(s => !s.flag || s.flag === 'gchat'));

// ── 2. The classic pages' navigation, read from their markup ────────────────────────────────────
const text = html => html.replace(/<span class="nav-icon[^"]*">[\s\S]*?<\/span>/, '').replace(/<span[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function classicRail(file) {
  const html = read('public', file);
  const nav = html.slice(html.indexOf('<nav class="sidebar-nav">'), html.indexOf('</nav>', html.indexOf('<nav class="sidebar-nav">')));
  return nav.split('<div class="nav-group"').slice(1).map(g => ({
    group: (/data-group="([^"]+)"/.exec(g) || [])[1],
    label: text((/<span class="nav-group-label">([\s\S]*?)<\/span>/.exec(g) || [])[1] || ''),
    items: [...g.matchAll(/<(div|button)\s+class="nav-item[^"]*"([^>]*)>([\s\S]*?)<\/\1>/g)].map(m => {
      const page = (/onclick="navigate\('([^']+)'\)"/.exec(m[2]) || [])[1] || null;
      const icon = (/data-lucide="([^"]+)"/.exec(m[3]) || [])[1] || (/class="ml-brain"/.test(m[3]) ? 'brain-ai' : null);
      return { id: (/id="nav-([^"]+)"/.exec(m[2]) || [])[1], page, icon, label: text(m[3]) };
    }).filter(i => i.page),   // Help opens a dialog rather than a page
  }));
}
function classicBottom(file) {
  const html = read('public', file);
  const nav = (/<nav class="bottom-nav"[\s\S]*?<\/nav>/.exec(html) || [''])[0];
  return [...nav.matchAll(/<button class="bottom-nav-item[^"]*" id="bnav-([^"]+)" onclick="([^"]+)">([\s\S]*?)<\/button>/g)]
    .map(m => ({ page: (/navigate\('([^']+)'\)/.exec(m[2]) || [])[1], icon: (/data-lucide="([^"]+)"/.exec(m[3]) || [])[1], label: ((/<span>([^<]*)<\/span>/.exec(m[3]) || [])[1] || '').trim() }))
    .filter(i => i.page);
}
const FILE = { admin: 'dashboard.html', team: 'employee.html' };
for (const portal of ['admin', 'team']) {
  const want = M.NAV[portal].map(g => ({
    group: g.group,
    label: M.GROUPS.find(x => x.id === g.group).label,
    items: g.items.filter(id => !M.isNewTo(M.screenOf(id), portal)).map(id => { const s = M.screenOf(id); const p = M.presentation(s, portal); return { id: M.legacyIdOf(s, portal), page: M.legacyIdOf(s, portal), icon: p.icon, label: p.label }; }),
  }));
  const got = classicRail(FILE[portal]).map(g => ({ ...g, items: g.items.map(i => ({ id: i.id, page: i.page, icon: i.icon, label: i.label })) }));
  check(`the ${portal} rail is the classic page's: same sections, same order`, same(want.map(g => [g.group, g.label]), got.map(g => [g.group, g.label])), JSON.stringify(got.map(g => [g.group, g.label])));
  for (const g of want) {
    const c = got.find(x => x.group === g.group);
    check(`  ${portal} · ${g.group}: the same screens in the same order, with the classic labels and icons`, c && same(g.items, c.items),
      c ? JSON.stringify(g.items.filter((it, i) => !same(it, c.items[i]))) + ' vs ' + JSON.stringify(c.items) : 'missing');
  }
  const bottom = M.BOTTOM_NAV[portal].map(b => ({ page: M.legacyIdOf(M.screenOf(b.id), portal), icon: b.icon, label: b.label }));
  check(`the ${portal} bottom navigation is the classic page's`, same(bottom, classicBottom(FILE[portal])), JSON.stringify(classicBottom(FILE[portal])));
}

// A screen the catalogue calls new to a portal (Issues, in the admin's) is the one thing the comparison above leaves out. So that
// the allowance cannot outlive the truth, the classic page must really not have it, and the app must draw it itself.
check('a panel (opened over a page, as #security is) is in no portal\'s rail and no bottom bar: it is not a page to go to',
  M.SCREENS.filter(s => M.isPanel(s)).every(s => [...M.NAV.admin, ...M.NAV.team].every(g => !g.items.includes(s.id)) && [...M.BOTTOM_NAV.admin, ...M.BOTTOM_NAV.team].every(b => b.id !== s.id)));
check('security is the panel, and nothing else is yet', M.SCREENS.filter(s => M.isPanel(s)).map(s => s.id).join() === 'security');
check('only a screen a portal is in can be new to it', M.SCREENS.every(s => !s.fresh || s.fresh.every(p => M.inPortal(s, p))));
for (const portal of ['admin', 'team']) {
  const html = read('public', FILE[portal]);
  const fresh = M.SCREENS.filter(s => M.isNewTo(s, portal));
  check(`${portal}: what is new to the portal (${fresh.map(s => s.id).join(', ') || 'nothing'}) has no page in the classic one`,
    fresh.every(s => !html.includes(`id="page-${M.legacyIdOf(s, portal)}"`) && !html.includes(`navigate('${M.legacyIdOf(s, portal)}')`)));
}
check('Issues is new to the admin portal and not to the team one, where the classic page has it',
  M.isNewTo(M.screenOf('issues'), 'admin') && !M.isNewTo(M.screenOf('issues'), 'team') && read('public', 'employee.html').includes('id="page-issues"') && !read('public', 'dashboard.html').includes('id="page-issues"'));

// The team portal's top bar names the page; those names are the classic page's own list.
const titles = (() => { const m = /const pageTitles = (\{[\s\S]*?\});/.exec(read('public', 'assets', 'employee.js')); return m ? Function('return ' + m[1])() : null; })();
const teamTitles = Object.fromEntries(M.NAV.team.flatMap(g => g.items).map(id => [M.legacyIdOf(M.screenOf(id), 'team'), M.presentation(M.screenOf(id), 'team').title]));
check('every screen of the team portal carries the title its classic page does', titles && Object.entries(teamTitles).filter(([page]) => page !== 'home' || true).every(([page, title]) => titles[page] === title), titles ? JSON.stringify(Object.entries(teamTitles).filter(([page, title]) => titles[page] !== title)) : 'pageTitles not found');

// ── 3. Who gets which screen: the catalogue against the team portal's own code ──────────────────
// The classic portal decides what its rail shows in applyPermissions (public/assets/employee.js). That code is run here, as
// it is written, over the same inputs the permission rules are pinned against.
const src = read('public', 'assets', 'employee.js');
const SLICE = src.slice(src.indexOf('const PERM_SECTIONS = ['), src.indexOf('/* ── Issues center (CTO only) ── */'));
const CTO = (/function isCtoUser\(\) \{[^\n]*\}/.exec(src) || [''])[0];
check('the classic permission code was found to run', SLICE.includes('function applyPermissions(') && CTO.startsWith('function isCtoUser'));
function classicShows(perms, jobTitle) {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, { style: { display: '' }, dataset: {} }); return els.get(id); };
  const sandbox = { document: { getElementById: el, querySelectorAll: () => [] }, empInfo: { job_title: jobTitle }, gchatInitNav() {}, loadNavConfig() {}, navHeadingsFollowItems() {}, loadNavFavs() {}, __perms: perms };
  vm.createContext(sandbox);
  vm.runInContext(SLICE + '\n' + CTO + '\napplyPermissions(__perms);', sandbox);
  return page => el('nav-' + page).style.display !== 'none';
}
const deps = { dealStages: C.DEAL_STAGES || ['lead', 'quoted', 'negotiating', 'won', 'lost'], normStatus: x => String(x ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_') };
const corpus = [...handmade(C.PERM_ACTIONS).map(([name, input]) => [name, input]), ...fuzz(C.PERM_ACTIONS, 20260304, 400).map((input, i) => ['fuzz ' + i, input])];
let compared = 0, differing = [];
for (const [name, raw] of corpus) {
  for (const jobTitle of ['Sales', 'Chief Technical Officer']) {
    const perms = C.normalisePermissions(raw, deps);
    const shows = classicShows(perms, jobTitle);
    const actor = employeeActor({ id: 7, name: 'Sam', job_title: jobTitle, permissions: perms });
    for (const id of M.NAV.team.flatMap(g => g.items)) {
      const s = M.screenOf(id);
      compared++;
      const mine = M.allows(actor, s, { gchat: true });
      if (mine !== shows(M.legacyIdOf(s, 'team'))) differing.push(`${name} / ${jobTitle} / ${id}: catalogue ${mine}, classic ${!mine}`);
    }
  }
}
check(`for ${corpus.length} permission records × 2 job titles the catalogue gives a team member the screens the classic rail shows (${compared} answers)`, differing.length === 0, differing.slice(0, 4).join(' | '));
check('…and that comparison is not vacuous: both answers occur', (() => {
  const seen = new Set(); const shows = classicShows(C.normalisePermissions({ leads: true }, deps), 'Sales');
  for (const id of M.NAV.team.flatMap(g => g.items)) seen.add(shows(M.legacyIdOf(M.screenOf(id), 'team')));
  return seen.has(true) && seen.has(false);
})());

const admin = adminActor();
check('the admin gets every screen of the admin portal (Google Chat only where the server says it is set up)',
  M.NAV.admin.flatMap(g => g.items).every(id => M.allows(admin, M.screenOf(id), { gchat: true })) && !M.allows(admin, M.screenOf('gchat'), {}) && !M.allows(admin, M.screenOf('gchat'), { gchat: false }) && M.allows(admin, M.screenOf('home'), {}));
const nobody = employeeActor({ id: 8, name: 'Nia', job_title: '', permissions: C.normalisePermissions({}, deps) });
check('a team member never gets an admin-only screen, whatever they are granted', (() => {
  const everything = employeeActor({ id: 9, name: 'All', job_title: 'Chief Technical Officer', permissions: C.normalisePermissions(Object.fromEntries(Object.keys(C.PERM_ACTIONS).map(s => [s, true])), deps) });
  return M.SCREENS.filter(s => s.needs.kind === 'admin').every(s => !M.allows(everything, s, { gchat: true }) && !M.allows(nobody, s, { gchat: true }));
})());
check('nobody who is not signed in gets any screen', M.SCREENS.every(s => !M.allows(null, s, { gchat: true }) && !M.allows(undefined, s)));

// ── 4. Names: classic page ids and screens, both ways ───────────────────────────────────────────
check('classic page ids are read as the screens they were (customers is Leads, deletions is Approvals, rfqs is RFQ)',
  M.screenIdFromLegacy('customers', 'admin') === 'leads' && M.screenIdFromLegacy('deletions', 'admin') === 'approvals' && M.screenIdFromLegacy('rfqs', 'admin') === 'rfq' && M.screenIdFromLegacy('notif', 'team') === 'notifications');
check('the old team key for the hours page still opens it', M.screenIdFromLegacy('log', 'team') === 'hours' && M.screenIdFromLegacy('log', 'admin') === null);
check('a screen answers to its own id too, a screen the other portal has is not here, and an unknown id is nothing',
  M.screenIdFromLegacy('leads', 'admin') === 'leads' && M.screenIdFromLegacy('employees', 'team') === null && M.screenIdFromLegacy('issues', 'admin') === 'issues' && M.screenIdFromLegacy('workspace', 'team') === null && M.screenIdFromLegacy('nope', 'team') === null && M.screenIdFromLegacy('', 'team') === null);

// ── 5. Deep links: every link the server writes lands somewhere, both ways ──────────────────────
check('a hash asks for its screen, in either portal\'s own words', D.resolveDeepLink('admin', { hash: '#customers' }) === '/leads' && D.resolveDeepLink('team', { hash: '#leads' }) === '/leads' && D.resolveDeepLink('team', { hash: '#log' }) === '/hours' && D.resolveDeepLink('admin', { hash: '#security' }) === '/security');
check('a hash that is not a screen asks for nothing, and so does no hash', D.resolveDeepLink('team', { hash: '#nope' }) === null && D.resolveDeepLink('team', {}) === null && D.resolveDeepLink('admin', { hash: '#workspace' }) === '/workspace' && D.resolveDeepLink('team', { hash: '#workspace' }) === null);
check('a link to Issues opens it in either portal (in the admin\'s, only the new app has the page)', D.resolveDeepLink('admin', { hash: '#issues' }) === '/issues' && D.resolveDeepLink('team', { hash: '#issues' }) === '/issues');
check('?chat= opens the chat, at the room when the room is one, and wins over a hash',
  D.resolveDeepLink('team', { search: '?chat=abc-123' }) === '/chat/abc-123' && D.resolveDeepLink('team', { search: '?chat=../x' }) === '/chat' && D.resolveDeepLink('admin', { search: '?chat=7', hash: '#tasks' }) === '/chat/7');
check('a stored link is followed in the portal it is for, and goes nowhere in the other',
  D.linkTarget('/employee#requests', 'team') === '/requests' && D.linkTarget('/employee#requests', 'admin') === null && D.linkTarget('/dashboard#deletions', 'admin') === '/approvals' && D.linkTarget('/somewhere#x', 'admin') === null && D.linkTarget('', 'team') === null && D.linkTarget('/employee', 'team') === null);
check('an address inside the new app is the classic page it stands for',
  D.classicUrlFor('admin', '/leads') === '/dashboard#customers' && D.classicUrlFor('team', '/leads') === '/employee#leads' && D.classicUrlFor('admin', '/chat/r1') === '/dashboard?chat=r1' && D.classicUrlFor('admin', '/approvals') === '/dashboard#deletions'
  && D.classicUrlFor('team', '/employees') === '/employee' && D.classicUrlFor('team', '/issues') === '/employee#issues' && D.classicUrlFor('admin', '/issues') === '/dashboard' && D.classicUrlFor('admin', '/__gallery') === '/dashboard' && D.classicUrlFor('team', '') === '/employee' && D.classicUrlFor('team', '/hours?x=1#y') === '/employee#hours');

const SOURCES = ['index.js', ...fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => path.join('src', f)), 'public/sw-dashboard.js', 'public/sw-employee.js'];
const emitted = new Map();   // url -> where
for (const f of SOURCES) {
  const body = read(f);
  for (const m of body.matchAll(/['"`](\/(?:dashboard|employee)(?:\?[a-z]+=[^'"`#]*)?#[a-z]+)['"`]/g)) if (!emitted.has(m[1])) emitted.set(m[1], f);
}
const links = [...emitted.keys()];
check(`the server writes links into notifications, and they were found (${links.length} distinct)`, links.length >= 20, links.slice(0, 5).join(' '));
const unresolved = links.filter(url => { const portal = url.startsWith('/dashboard') ? 'admin' : 'team'; const to = D.linkTarget(url, portal); return !to || !M.screenOf(to.split('/')[1]) || !M.inPortal(M.screenOf(to.split('/')[1]), portal); });
check('every one of them opens a screen the portal it is for has', unresolved.length === 0, unresolved.join(' '));
const roundTrips = links.filter(url => {
  const portal = url.startsWith('/dashboard') ? 'admin' : 'team';
  const to = D.linkTarget(url, portal);
  // …and back to the classic page, which is the same page (the old 'log' hash is the one that is renamed on the way)
  const back = D.classicUrlFor(portal, to);
  return back !== url && !(url === '/employee#log' && back === '/employee#hours');
});
check('…and the new-app address of each leads back to the classic page the link named', roundTrips.length === 0, roundTrips.join(' '));
const swChat = ['public/sw-dashboard.js', 'public/sw-employee.js'].every(f => /\?chat=' \+ roomId/.test(read(f)));
check('the service workers open a room with ?chat=<id> (what resolveDeepLink reads)', swChat);

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
