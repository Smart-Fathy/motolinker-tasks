// The public website form: what a stranger can change with it, what it tells them,
// and how much of it one address can send.
//
// POST /api/submissions has no session — the marketing website forwards every enquiry
// to it — so anyone can call it, and three things made that worse than it had to be:
//   1. A re-inquiry replaced the customer's email (and car) on file with whatever was
//      posted, so knowing someone's phone number was enough to redirect the quotations
//      and contracts staff send them.
//   2. The answer carried the customer id and whether a lead was created: a lookup,
//      for anyone, of whether a phone number belongs to a customer.
//   3. Nothing limited it. Every post is a lead, a row, a push to the admin and the
//      automation rules, with no cap on how many, nor on how long a field may be.
//
// Boots the real app on an in-memory database and posts to it over HTTP, as the
// website's Worker does.
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The limiter reads the clock; the test moves it rather than waiting a quarter-hour.
let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;

const db = createFakeSupabase({
  customers: [
    // An email and a car on file: neither may be replaced from the public form.
    { id: 1, name: 'Mona', phone: '01000500577', phone_norm: '01000500577', email: 'mona@example.com', car_in_question: 'Avatr 11', lead_status: 'hot', created_by: 'admin' },
    // Came in by phone: no email yet (the column's default), and no car recorded.
    { id: 2, name: 'Karim', phone: '+20 1112223334', phone_norm: '01112223334', email: '', car_in_question: null, lead_status: 'warm', created_by: 'admin' },
  ],
  form_submissions: [], lead_activities: [], notifications: [], push_subscriptions: [],
  automation_rules: [], automation_runs: [], employees: [], sessions: [], quotation_settings: [], google_tokens: [],
});
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3988 });
  const T = db.tables;
  // Every part below posts from its own address, so the limiter's count for one part
  // never decides another's result.
  const submit = (ip, body) => fetch(base + '/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
  const mona = () => T.customers.find(x => x.id === 1);
  const karim = () => T.customers.find(x => x.id === 2);
  const counts = () => ({ leads: T.customers.length, rows: T.form_submissions.length, pushes: T.notifications.length });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ── 1. A re-inquiry fills blanks and never overwrites ─────────────────────────
  {
    const r = await submit('198.51.100.1', { name: 'Not Mona', phone: '+20 100 050 0577', email: 'attacker@example.net', car_interest: 'Anything', message: 'Send the contract here' });
    await sleep(50);   // the timeline entry is written after the answer goes out
    c('a post with a known phone number is taken', r.status === 200, String(r.status));
    c('…and does not replace the email on file', mona().email === 'mona@example.com', mona().email);
    c('…or the car on file', mona().car_in_question === 'Avatr 11', mona().car_in_question);
    c('…and makes no second lead', T.customers.length === 2, String(T.customers.length));
    const sub = T.form_submissions.find(s => s.email === 'attacker@example.net');
    c('what was posted is still kept, linked to the customer it matched',
      !!sub && sub.customer_id === 1 && sub.car_interest === 'Anything', JSON.stringify(sub));
    c('…and the re-inquiry is on that customer\'s timeline',
      T.lead_activities.some(a => a.customer_id === 1 && a.body === 'Re-inquiry via website — Send the contract here'));
  }
  {
    await submit('198.51.100.1', { name: 'Karim', phone: '01112223334', email: 'karim@example.com', car_interest: 'Zeekr 001' });
    c('a blank email is filled from the form', karim().email === 'karim@example.com', karim().email);
    c('…and a blank car', karim().car_in_question === 'Zeekr 001', String(karim().car_in_question));
    await submit('198.51.100.1', { name: 'Karim', phone: '01112223334', email: 'someone-else@example.net', car_interest: 'Something else' });
    c('once filled, a later post does not change either',
      karim().email === 'karim@example.com' && karim().car_in_question === 'Zeekr 001', `${karim().email} / ${karim().car_in_question}`);
  }

  // ── 2. The answer says nothing about who is a customer ────────────────────────
  {
    const known = await submit('198.51.100.2', { name: 'Probe', phone: '01000500577' });
    const unknown = await submit('198.51.100.2', { name: 'Probe', phone: '01234567890' });
    const a = await known.text(), b = await unknown.text();
    c('a customer\'s number and a new one get the same answer', known.status === 200 && unknown.status === 200 && a === b, `${a} | ${b}`);
    c('…which is { ok: true } and nothing more', a === '{"ok":true}', a);
    c('the new number still became a lead', T.customers.some(x => x.phone_norm === '01234567890' && x.created_by === 'web_form'));
  }

  // ── 3. Ten posts per address per quarter-hour ─────────────────────────────────
  {
    const ip = '203.0.113.9';
    const first = [];
    for (let i = 0; i < 10; i++) first.push((await submit(ip, { name: 'Flood ' + i, phone: '0155000' + String(i).padStart(4, '0') })).status);
    await sleep(50);
    const before = counts();
    const eleventh = await submit(ip, { name: 'Flood 10', phone: '01550000010' });
    await sleep(50);
    c('ten posts from one address are taken', first.every(s => s === 200), first.join(','));
    c('…and the eleventh is refused with 429', eleventh.status === 429, String(eleventh.status));
    c('…saying when to come back', Number(eleventh.headers.get('retry-after')) > 0, String(eleventh.headers.get('retry-after')));
    c('…with the CORS headers, so a page on another origin can read that', eleventh.headers.get('access-control-allow-origin') === '*');
    c('a refused post makes no lead, no submission and no push', same(counts(), before), JSON.stringify([before, counts()]));
    c('another address is not held up by it', (await submit('203.0.113.10', { name: 'Neighbour', phone: '01550000011' })).status === 200);
    skew += 15 * 60_000 + 1000;
    c('a quarter-hour later the first address is let back in', (await submit(ip, { name: 'Later', phone: '01550000012' })).status === 200);
  }

  // ── 4. Every field has a ceiling ──────────────────────────────────────────────
  {
    const caps = { name: 120, email: 200, phone: 40, car_interest: 120, message: 4000, source: 60 };
    const long = {
      name: 'N'.repeat(500), email: 'e'.repeat(300) + '@example.com', phone: '0109' + '7'.repeat(96),
      car_interest: 'C'.repeat(500), message: 'M'.repeat(6000), source: 'S'.repeat(200),
    };
    const r = await submit('192.0.2.20', long);
    await sleep(50);
    c('an oversized post is still taken, not refused', r.status === 200, String(r.status));
    const sub = T.form_submissions.find(s => s.name.startsWith('NNN'));
    c('each field of the stored submission is cut to its cap',
      !!sub && Object.entries(caps).every(([k, n]) => sub[k] === long[k].slice(0, n)),
      sub ? Object.keys(caps).map(k => `${k}=${sub[k].length}`).join(' ') : 'no row');
    const lead = T.customers.find(x => x.name.startsWith('NNN'));
    const leadCut = lead && { name: lead.name.length, email: lead.email.length, phone: lead.phone.length, car: lead.car_in_question.length,
      inquiry: lead.inquiry.length, notes: lead.notes.length, source: lead.source.length };
    c('…and so is the lead made from it',
      same(leadCut, { name: 120, email: 200, phone: 40, car: 120, inquiry: 4000, notes: 4000, source: 60 }), JSON.stringify(leadCut));
    c('…whose phone is matched on what was kept', !!lead && lead.phone_norm === '0109' + '7'.repeat(36), lead && lead.phone_norm);

    await submit('192.0.2.20', { name: 'Emoji edge', phone: '01090000001', message: 'a'.repeat(3999) + '😀' + 'tail' });
    const edge = T.form_submissions.find(s => s.name === 'Emoji edge');
    c('a cut that lands inside an emoji drops the whole emoji, not half of it',
      !!edge && edge.message === 'a'.repeat(3999), edge && JSON.stringify(edge.message.slice(-3)));
  }

  // ── 5. A body over 16kb is not read at all ────────────────────────────────────
  {
    const before = counts();
    const r = await submit('192.0.2.30', { name: 'Huge', phone: '01090000002', message: 'M'.repeat(17 * 1024) });
    await sleep(50);
    c('a body over 16kb is refused with 413', r.status === 413, String(r.status));
    c('…and nothing is written', same(counts(), before), JSON.stringify([before, counts()]));
    c('a body just under it is taken', (await submit('192.0.2.30', { name: 'Big', phone: '01090000003', message: 'M'.repeat(15 * 1024) })).status === 200);
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} website form checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
