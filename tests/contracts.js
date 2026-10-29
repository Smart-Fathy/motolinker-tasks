// The permission rules, pinned.
//
// Who may do what is decided by one model (the catalogue of sections and actions, the defaults an
// employee record that predates a section gets, which actions are never inherited, how a scope is
// read) that the server enforces and the portals mirror. Moving it, or widening it, must not change
// anyone's rights by accident — the whole risk of this file is an employee who loses a page they use
// every day, or gains one nobody gave them, on the day of a deploy.
//
// So the answers are recorded: tests/fixtures/permissions.golden.json holds what the model DID for
// a set of hand-made shapes (each one means something) and a seeded fuzz over the whole catalogue —
// the normalised permissions, and for every section.action whether an employee with them may do it
// (with an ordinary job title and with the CTO's, which carries the Issues centre by title). This suite
// recomputes all of it twice — from packages/contracts alone, and through the server (employee-portal.js
// with the deal stages and the status normaliser the server hands it) — and compares both to the file;
// then checks that the actor model (capabilities, sections, scope) says the same things the recorded
// answers do. When the model is changed ON PURPOSE:
//
//     node tests/contracts.js --record      and read the diff of the golden file: it is the review
//
//   node tests/contracts.js                 check
//   node tests/contracts.js --record        re-record from the server's implementation
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { handmade, fuzz } = require('./helpers/perm-corpus');

const GOLDEN = path.join(__dirname, 'fixtures', 'permissions.golden.json');
const RECORD = process.argv.includes('--record');
const FUZZ_SEED = 20260304;
const FUZZ_N = 400;
const JOB_TITLES = ['Sales', 'Chief Technical Officer'];
const UNDEFINED = '__undefined__';   // JSON cannot carry `undefined`

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// JSON with the keys in order, so a hash does not depend on the order an implementation built them in.
const canon = v => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map(k => [k, val[k]])) : val));
const sha = v => crypto.createHash('sha1').update(canon(v)).digest('hex').slice(0, 16);

// An implementation under test: its catalogue, normalise(raw), can(normalised, section, action, jobTitle),
// and the catalogue + presets the admin editor is built from.
//
// The server's: employee-portal.js booted on the in-memory database, asked for its answers the way a
// request is (the catalogue is the admin route's response).
async function serverImplementation() {
  const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
  createFakeSupabase({ employees: [], sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [] }).install();
  const base = await bootApp({ port: process.env.PORT || 3993 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms, empCan, PERM_ACTIONS, DEFAULT_PERMISSIONS } = require(process.cwd() + '/src/routes/employee-portal.js');
  ctx.sessions.set('contracts-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const catalogue = await (await fetch(base + '/api/dashboard/permissions/catalogue', { headers: { Authorization: 'Bearer contracts-admin' } })).json();
  return {
    name: 'through the server',
    sections: PERM_ACTIONS, defaults: DEFAULT_PERMISSIONS, dealStages: ctx.DEAL_STAGES, catalogue,
    normalise: raw => normEmpPerms(raw),
    can: (normalised, section, action, jobTitle) => empCan({ permissions: normalised, job_title: jobTitle }, section, action),
  };
}

// The contracts package alone, no server: the two things the rule is handed (the deal stages and the
// lead-status normaliser — automation.js's autoNorm) are supplied here the way the server supplies them.
function contractsImplementation(dealStages) {
  const C = require('../packages/contracts');
  const deps = { dealStages, normStatus: x => String(x ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_') };
  return {
    name: 'from the contracts package alone',
    sections: C.PERM_ACTIONS, defaults: C.DEFAULT_PERMISSIONS, dealStages,
    catalogue: { groups: C.permCatalogue(), stages: dealStages, presets: C.PERM_PRESETS.map(p => ({ key: p.key, label: p.label, hint: p.hint, permissions: C.permPresetPerms(p) })) },
    normalise: raw => C.normalisePermissions(raw, deps),
    can: (normalised, section, action, jobTitle) => C.employeeCan({ permissions: normalised, job_title: jobTitle }, section, action),
  };
}

const allowedFor = (impl, normalised, jobTitle) => {
  const out = [];
  for (const [section, actions] of Object.entries(impl.sections)) for (const a of actions) if (impl.can(normalised, section, a, jobTitle)) out.push(section + '.' + a);
  return out.sort();
};
const answer = (impl, input) => {
  const output = impl.normalise(input);
  const allowed = Object.fromEntries(JOB_TITLES.map(t => [t, allowedFor(impl, output, t)]));
  return { output, allowed };
};

// One handmade case per line, so a re-recorded file diffs readably.
function serialise(g) {
  const line = v => '    ' + JSON.stringify(v);
  return '{\n'
    + `  "recordedBy": "node tests/contracts.js --record",\n`
    + `  "sections": ${JSON.stringify(g.sections)},\n`
    + `  "defaults": ${JSON.stringify(g.defaults)},\n`
    + `  "dealStages": ${JSON.stringify(g.dealStages)},\n`
    + `  "catalogue": ${JSON.stringify(g.catalogue)},\n`
    + `  "handmade": [\n${g.handmade.map(line).join(',\n')}\n  ],\n`
    + `  "fuzz": ${JSON.stringify(g.fuzz)}\n}\n`;
}

(async () => {
  const server = await serverImplementation();
  const sections = server.sections;
  const cases = handmade(sections).map(([name, input]) => ({ name, input: input === undefined ? UNDEFINED : input }));
  const fuzzInputs = fuzz(sections, FUZZ_SEED, FUZZ_N);

  if (RECORD) {
    const impl = server;
    const golden = {
      sections, defaults: impl.defaults, dealStages: impl.dealStages, catalogue: impl.catalogue,
      handmade: cases.map(c => ({ ...c, ...answer(impl, c.input === UNDEFINED ? undefined : c.input) })),
      fuzz: { seed: FUZZ_SEED, n: FUZZ_N, outputs: [], allowed: [] },
    };
    for (const input of fuzzInputs) { const a = answer(impl, input); golden.fuzz.outputs.push(sha(a.output)); golden.fuzz.allowed.push(sha(a.allowed)); }
    fs.writeFileSync(GOLDEN, serialise(golden));
    console.log(`recorded ${golden.handmade.length} hand-made and ${FUZZ_N} fuzz cases → ${path.relative(process.cwd(), GOLDEN)}`);
    process.exit(0);
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  check('the deal stages a scope may name are unchanged', isDeepStrictEqual(server.dealStages, golden.dealStages));

  for (const impl of [contractsImplementation(golden.dealStages), server]) {
    const say = n => `${impl.name}: ${n}`;
    check(say('the catalogue of sections and actions is unchanged'), isDeepStrictEqual(impl.sections, golden.sections));
    check(say('the defaults for a record that predates a section are unchanged'), isDeepStrictEqual(impl.defaults, golden.defaults));
    check(say('the catalogue the admin editor is built from — groups, labels, presets — is unchanged'), isDeepStrictEqual(impl.catalogue, golden.catalogue));

    const live = handmade(sections).map(([name, input]) => ({ name, input: input === undefined ? UNDEFINED : input }));
    check(say('the hand-made shapes are the ones that were recorded'), isDeepStrictEqual(live.map(c => c.name), golden.handmade.map(c => c.name)));
    const wrongOutput = [], wrongAllowed = [];
    for (const g of golden.handmade) {
      const a = answer(impl, g.input === UNDEFINED ? undefined : g.input);
      if (!isDeepStrictEqual(a.output, g.output)) wrongOutput.push(g.name);
      if (!isDeepStrictEqual(a.allowed, g.allowed)) wrongAllowed.push(g.name);
    }
    check(say(`normalising ${golden.handmade.length} hand-made shapes gives what it gave`), wrongOutput.length === 0, wrongOutput.join('; '));
    check(say('who may do what, with an ordinary title and with the CTO\'s, is the same for each'), wrongAllowed.length === 0, wrongAllowed.join('; '));

    const fo = [], fa = [];
    fuzzInputs.forEach((input, i) => {
      const a = answer(impl, input);
      if (sha(a.output) !== golden.fuzz.outputs[i]) fo.push(i);
      if (sha(a.allowed) !== golden.fuzz.allowed[i]) fa.push(i);
    });
    check(say(`normalising ${golden.fuzz.n} seeded random shapes gives what it gave`), golden.fuzz.n === FUZZ_N && golden.fuzz.seed === FUZZ_SEED && fo.length === 0, fo.length ? 'cases ' + fo.slice(0, 8).join(',') : '');
    check(say('…and who may do what is the same for each'), fa.length === 0, fa.length ? 'cases ' + fa.slice(0, 8).join(',') : '');
  }

  // The actor model says what the recorded answers say: for every shape and both titles, the
  // capabilities an actor is built with are exactly the section.action pairs the rules allowed, and
  // the sections are the ones whose master switch is on (plus the Issues centre for the CTO).
  {
    const C = require('../packages/contracts');
    const bad = [];
    const each = [...golden.handmade.map(g => [g.name, g.output]), ...fuzzInputs.slice(0, 120).map((input, i) => ['fuzz ' + i, contractsImplementation(golden.dealStages).normalise(input)])];
    for (const [name, output] of each) for (const title of JOB_TITLES) {
      const { caps, sections: secs } = C.capabilitiesOf(output, title);
      const want = allowedFor(contractsImplementation(golden.dealStages), output, title);
      if (!isDeepStrictEqual([...caps].sort(), want)) bad.push(name + ' / ' + title + ': caps');
      const wantSections = Object.keys(sections).filter(sec => output[sec] === true || (sec === 'issues' && /chief technical officer/i.test(title))).sort();
      if (!isDeepStrictEqual([...secs].sort(), wantSections)) bad.push(name + ' / ' + title + ': sections');
    }
    check(`an actor's capabilities and sections follow the rules, for ${each.length} shapes × ${JOB_TITLES.length} titles`, bad.length === 0, bad.slice(0, 4).join('; '));

    const admin = C.adminActor();
    const sara = C.employeeActor({ id: 7, name: 'Sara', job_title: 'Sales', permissions: contractsImplementation(golden.dealStages).normalise({ leads: true, leadsActions: { view: true, edit: true }, scope: { assignedOnly: true, leadStatuses: ['Hot'] } }) });
    check('the admin may do anything, in any section', C.can(admin, 'leads.delete') && C.can(admin, 'accounting.ai') && C.hasSection(admin, 'issues'));
    check('an employee may do what they were granted and no more', C.can(sara, 'leads.edit') && !C.can(sara, 'leads.delete') && !C.can(sara, 'accounting.view'));
    check('…and has the sections whose master is on', C.hasSection(sara, 'leads') && C.hasSection(sara, 'chat') && !C.hasSection(sara, 'accounting'));
    check('nobody at all may do nothing', !C.can(null, 'leads.view') && !C.can(undefined, 'leads.view') && !C.hasSection(null, 'leads'));
    check('the admin sees every row; a scope narrows an employee on leads and deals, not on tasks', !C.isScoped(C.scopeOf(admin, 'leads')) && C.isScoped(C.scopeOf(sara, 'leads')) && C.isScoped(C.scopeOf(sara, 'deals')) && !C.isScoped(C.scopeOf(sara, 'tasks')));
    check('an actor is described for the wire with sorted lists, and "*" stays "*"', (() => {
      const w = C.describeActor(sara), a = C.describeActor(admin);
      return a.caps === '*' && a.sections === '*' && Array.isArray(w.caps) && w.caps.join() === [...w.caps].sort().join() && w.actor.key === 'employee_7' && w.scope.assignedOnly === true;
    })());
    check('nothing can widen an actor by writing to it: the actor, its scope and the scope lists are frozen', (() => {
      const frozen = a => Object.isFrozen(a) && Object.isFrozen(a.scope) && Object.isFrozen(a.scope.dealStages) && Object.isFrozen(a.scope.leadStatuses);
      let pushed = false;
      try { admin.caps = new Set(); sara.caps = '*'; sara.scope.assignedOnly = false; } catch (_) { /* strict mode throws, sloppy mode ignores: either way nothing changes */ }
      try { C.NO_SCOPE.dealStages.push('x'); pushed = C.NO_SCOPE.dealStages.length > 0; } catch (_) { /* a frozen list refuses */ }
      return frozen(admin) && frozen(sara) && Object.isFrozen(C.NO_SCOPE) && Object.isFrozen(C.NO_SCOPE.dealStages) && Object.isFrozen(C.NO_SCOPE.leadStatuses) && C.scopeOf(admin, 'leads') === C.NO_SCOPE
        && admin.caps === '*' && sara.caps !== '*' && sara.scope.assignedOnly === true && !pushed && C.NO_SCOPE.dealStages.length === 0;
    })());
    const me = C.schemas.MeResponse;
    check('the /me schema accepts what describeActor and the workspace produce, and refuses what is not', me.safeParse({ ...C.describeActor(sara), workspace: { name: 'MotoLinker', logo_url: '', updated_at: null }, flags: {} }).success
      && me.safeParse({ ...C.describeActor(admin), workspace: { name: 'MotoLinker', logo_url: '', updated_at: '2026-03-04T10:00:00.000Z' }, flags: { a: true } }).success
      && !me.safeParse({ actor: {}, caps: 'all' }).success);
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
