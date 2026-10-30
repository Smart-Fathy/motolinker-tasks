// The inputs the permission rules are pinned against (tests/contracts.js): hand-made shapes that
// each mean something — legacy flat flags, rich action objects, keys that predate an action, scope in
// every form — and a seeded fuzz over the whole catalogue. The expected answers are recorded from the
// implementation (`node tests/contracts.js --record`), so the golden file says what the rules DID,
// and a later change has to say, in the diff of that file, what it changed on purpose.

// Stable pseudo-random numbers (mulberry32): the same fuzz on every machine and every run.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hand-made inputs. `sections` is the catalogue's own section → actions map, so the "everything
// explicit" cases follow the catalogue as it grows.
function handmade(sections) {
  const everyAction = value => {
    const out = {};
    for (const [s, actions] of Object.entries(sections)) {
      out[s] = true;
      out[s + 'Actions'] = Object.fromEntries(actions.map(a => [a, value(s, a)]));
    }
    return out;
  };
  return [
    ['undefined', undefined],
    ['null', null],
    ['an empty object', {}],
    ['legacy flat: leads on', { leads: true }],
    ['legacy flat: leads off', { leads: false }],
    ['legacy flat: every section on', Object.fromEntries(Object.keys(sections).map(s => [s, true]))],
    ['legacy flat: every section off', Object.fromEntries(Object.keys(sections).map(s => [s, false]))],
    ['legacy flag: viewAllRequests', { viewAllRequests: true }],
    ['legacy flag with the master off', { requests: false, viewAllRequests: true }],
    ['rich: leads, view only', { leads: true, leadsActions: { view: true } }],
    ['rich: master off, actions on', { leads: false, leadsActions: { view: true, edit: true } }],
    ['rich: an action object that predates deals.sales', { deals: true, dealsActions: { view: true, create: true } }],
    ['rich: deals.view and edit, sales fallbacks follow them', { deals: true, dealsActions: { view: true, edit: true } }],
    ['rich: payments follow sales', { deals: true, dealsActions: { view: true, sales: true, salesEdit: true } }],
    ['never inherited: stock.browse missing from an action object', { stock: true, stockActions: { view: true } }],
    ['never inherited: a flat stock master', { stock: true }],
    ['never inherited: leads.clientFolder with a flat master', { leads: true }],
    ['meet with an empty action object', { meet: true, meetActions: {} }],
    ['availability with an empty action object', { availability: true, availabilityActions: {} }],
    ['suppliers.purchases follows view', { suppliers: true, suppliersActions: { view: true } }],
    ['scope: assignedOnly', { scope: { assignedOnly: true } }],
    ['scope: the string "true" is not true', { scope: { assignedOnly: 'true' } }],
    ['scope: deal stages, valid and unknown', { scope: { dealStages: ['won', 'bogus', 'lead'] } }],
    ['scope: lead statuses are normalised', { scope: { leadStatuses: ['Hot', ' Not Interested ', '', null, 'WARM'] } }],
    ['scope: not an object', { scope: 'everything' }],
    ['scope: null', { scope: null }],
    ['values that are strings', { leads: 'true', tasks: 'false' }],
    ['a section the catalogue does not have', { flyingcars: true, flyingcarsActions: { fly: true } }],
    ['actions that are not an object', { leads: true, leadsActions: 'yes' }],
    ['actions that are an array', { leads: true, leadsActions: ['view'] }],
    ['nulls', { leads: null, leadsActions: null }],
    ['every action explicitly on', everyAction(() => true)],
    ['every action explicitly off', everyAction(() => false)],
    ['only the view actions on', everyAction((s, a) => a === 'view')],
    ['accounting master with no actions', { accounting: true }],
    ['issues master', { issues: true }],
    ['assistant switched off', { assistant: false }],
  ];
}

// `n` random inputs over the catalogue: for each section a master (mostly true/false, rarely junk),
// maybe an action object (each action true/false/absent/junk), and sometimes a scope.
function fuzz(sections, seed, n) {
  const r = rng(seed);
  const pick = list => list[Math.floor(r() * list.length)];
  const junk = () => pick(['true', 1, 0, null, [], {}, 'yes']);
  const cases = [];
  for (let i = 0; i < n; i++) {
    const input = {};
    for (const [s, actions] of Object.entries(sections)) {
      const m = r();
      if (m < 0.45) input[s] = true;
      else if (m < 0.8) input[s] = false;
      else if (m < 0.85) input[s] = junk();
      if (r() < 0.55) {
        const acts = {};
        for (const a of actions) {
          const x = r();
          if (x < 0.4) acts[a] = true;
          else if (x < 0.7) acts[a] = false;
          else if (x < 0.75) acts[a] = junk();
        }
        input[s + 'Actions'] = acts;
      }
    }
    if (r() < 0.3) input.viewAllRequests = r() < 0.5;
    if (r() < 0.4) {
      input.scope = {};
      if (r() < 0.5) input.scope.assignedOnly = r() < 0.7 ? true : junk();
      if (r() < 0.5) input.scope.dealStages = [pick(['lead', 'won', 'lost', 'nope']), pick(['quoted', 'negotiating', 'inquiry'])];
      if (r() < 0.5) input.scope.leadStatuses = [pick(['Hot', 'warm', 'Cold ', 'x y', '']), pick(['Blacklist', null, 'immediate-delivery'])];
    }
    cases.push(input);
  }
  return cases;
}

module.exports = { rng, handmade, fuzz };
