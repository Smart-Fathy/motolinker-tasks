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
// recomputes all of it and compares. When the model is changed ON PURPOSE:
//
//     node tests/contracts.js --record      and read the diff of the golden file: it is the review
//
//   node tests/contracts.js                 check
//   node tests/contracts.js --record        re-record from the implementation
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

// The implementation under test: normalise(raw), can(normalised, section, action, jobTitle), and the
// catalogue the admin editor is built from.
async function loadImplementation() {
  const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
  createFakeSupabase({ employees: [], sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [] }).install();
  const base = await bootApp({ port: process.env.PORT || 3993 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms, empCan, PERM_ACTIONS, DEFAULT_PERMISSIONS } = require(process.cwd() + '/src/routes/employee-portal.js');
  ctx.sessions.set('contracts-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const catalogue = await (await fetch(base + '/api/dashboard/permissions/catalogue', { headers: { Authorization: 'Bearer contracts-admin' } })).json();
  return {
    sections: PERM_ACTIONS, defaults: DEFAULT_PERMISSIONS, dealStages: ctx.DEAL_STAGES, catalogue,
    normalise: raw => normEmpPerms(raw),
    can: (normalised, section, action, jobTitle) => empCan({ permissions: normalised, job_title: jobTitle }, section, action),
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
  const impl = await loadImplementation();
  const sections = impl.sections;
  const cases = handmade(sections).map(([name, input]) => ({ name, input: input === undefined ? UNDEFINED : input }));
  const fuzzInputs = fuzz(sections, FUZZ_SEED, FUZZ_N);

  if (RECORD) {
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

  check('the catalogue of sections and actions is unchanged', isDeepStrictEqual(sections, golden.sections));
  check('the defaults for a record that predates a section are unchanged', isDeepStrictEqual(impl.defaults, golden.defaults));
  check('the deal stages a scope may name are unchanged', isDeepStrictEqual(impl.dealStages, golden.dealStages));
  check('the catalogue the admin editor is built from — groups, labels, presets — is unchanged', isDeepStrictEqual(impl.catalogue, golden.catalogue));

  const live = handmade(sections).map(([name, input]) => ({ name, input: input === undefined ? UNDEFINED : input }));
  check('the hand-made shapes are the ones that were recorded', isDeepStrictEqual(live.map(c => c.name), golden.handmade.map(c => c.name)));
  const wrongOutput = [], wrongAllowed = [];
  for (const g of golden.handmade) {
    const a = answer(impl, g.input === UNDEFINED ? undefined : g.input);
    if (!isDeepStrictEqual(a.output, g.output)) wrongOutput.push(g.name);
    if (!isDeepStrictEqual(a.allowed, g.allowed)) wrongAllowed.push(g.name);
  }
  check(`normalising ${golden.handmade.length} hand-made shapes gives what it gave`, wrongOutput.length === 0, wrongOutput.join('; '));
  check('…and who may do what, with an ordinary title and with the CTO\'s, is the same for each', wrongAllowed.length === 0, wrongAllowed.join('; '));

  const fo = [], fa = [];
  fuzzInputs.forEach((input, i) => {
    const a = answer(impl, input);
    if (sha(a.output) !== golden.fuzz.outputs[i]) fo.push(i);
    if (sha(a.allowed) !== golden.fuzz.allowed[i]) fa.push(i);
  });
  check(`normalising ${golden.fuzz.n} seeded random shapes gives what it gave`, golden.fuzz.n === FUZZ_N && golden.fuzz.seed === FUZZ_SEED && fo.length === 0, fo.length ? 'cases ' + fo.slice(0, 8).join(',') : '');
  check('…and who may do what is the same for each', fa.length === 0, fa.length ? 'cases ' + fa.slice(0, 8).join(',') : '');

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
