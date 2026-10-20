// fetchAll: a list that outgrows the server's rows-per-request cap still comes back whole.
//
// The leads table passed 1000 rows and every screen that read it as one query kept
// showing 1000 or fewer, because PostgREST caps a response at max-rows (Supabase's
// default is 1000) without an error and ignores a larger .limit(). This stands in
// for that server: a builder over a table that answers at most MAX_ROWS rows per
// request, sorts the way it was told to, and honours .range(). Nothing here talks
// to a database.
const { fetchAll, HARD_MAX } = require('../src/lib/fetch-all');

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const MAX_ROWS = 1000;

// A table shaped like the real leads: most rows have their own timestamp, 404 share
// one (the CSV import wrote them in a single statement), so sorting on created_at
// alone leaves those in an order the server is free to change between requests.
function leadsTable(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({ id: i, name: 'Lead ' + i, created_at: i <= 404 ? '2026-07-12T13:26:26.630859Z' : `2026-08-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z` });
  }
  return rows;
}

// supabase-js's chain, as far as the helper touches it. `shuffleTies` makes the
// server break ties between equal sort keys differently on every request — what
// Postgres is allowed to do — so a missing tiebreak shows up as skipped or repeated rows.
function fakeTable(rows, { failOnCall, shuffleTies = true } = {}) {
  let calls = 0;
  const from = () => {
    const state = { orders: [], range: null, limit: null };
    const builder = {
      select: () => builder,
      order: (col, o = {}) => { state.orders.push({ col, asc: o.ascending !== false }); return builder; },
      limit: n => { state.limit = n; return builder; },
      range: (a, b) => { state.range = [a, b]; return builder; },
      then(resolve, reject) {
        calls++;
        if (failOnCall && calls === failOnCall) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
        let out = rows.slice();
        // Unordered ties come back in whatever order the planner picked this time.
        if (shuffleTies) out.sort(() => (calls % 2 ? 1 : -1) * 0.5 - Math.random() * 0.01 * (calls % 3 - 1));
        out.sort((x, y) => {
          for (const { col, asc } of state.orders) {
            if (x[col] < y[col]) return asc ? -1 : 1;
            if (x[col] > y[col]) return asc ? 1 : -1;
          }
          return 0;
        });
        if (state.range) out = out.slice(state.range[0], state.range[1] + 1);
        else if (state.limit != null) out = out.slice(0, state.limit);
        // The silent cap: no error, just fewer rows than asked for.
        out = out.slice(0, MAX_ROWS);
        return Promise.resolve({ data: out, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from, calls: () => calls };
}

(async () => {
  const table = leadsTable(1131);

  // The defect, reproduced: one query with a generous limit still stops at the cap.
  {
    const t = fakeTable(table);
    const { data } = await t.from().select().order('created_at', { ascending: false }).limit(50000);
    check('one query stops at the server cap, whatever .limit() says', data.length === MAX_ROWS, `got ${data.length}`);
  }

  // The fix: every row, each exactly once, in the order asked for.
  {
    const t = fakeTable(table);
    const { data, error } = await fetchAll(() => t.from().select().order('created_at', { ascending: false }));
    const ids = new Set(data.map(r => r.id));
    check('returns all 1131 rows', !error && data.length === 1131, `got ${data && data.length}`);
    check('no row repeated or skipped across the page edge', ids.size === 1131 && table.every(r => ids.has(r.id)), `${ids.size} distinct`);
    check('keeps the requested order (newest first)', data.every((r, i) => i === 0 || data[i - 1].created_at >= r.created_at));
    check('two requests for 1131 rows', t.calls() === 2, `${t.calls()} calls`);
  }

  // Without a tiebreak the same walk loses rows, which is why the helper adds one.
  {
    const t = fakeTable(table);
    const { data } = await fetchAll(() => t.from().select().order('created_at', { ascending: false }), { tiebreak: null });
    const ids = new Set(data.map(r => r.id));
    check('without the id tiebreak, tied timestamps skip or repeat rows (why it is on by default)', ids.size !== 1131 || data.length !== 1131, `${ids.size} distinct of ${data.length}`);
  }

  // Edges: an exact multiple of the page ends on an empty page, a small table takes one request.
  {
    const t = fakeTable(leadsTable(2000));
    const { data } = await fetchAll(() => t.from().select());
    check('an exact multiple of the page size ends cleanly', data.length === 2000 && t.calls() === 3, `${data.length} rows, ${t.calls()} calls`);
    const s = fakeTable(leadsTable(7));
    const r = await fetchAll(() => s.from().select());
    check('a small table is a single request', r.data.length === 7 && s.calls() === 1, `${s.calls()} calls`);
    const e = fakeTable([]);
    const z = await fetchAll(() => e.from().select());
    check('an empty table is an empty list, not an error', z.error === null && Array.isArray(z.data) && z.data.length === 0);
  }

  // max is a ceiling on rows, including inside a page.
  {
    const t = fakeTable(table);
    const { data } = await fetchAll(() => t.from().select(), { max: 1050 });
    check('max stops the walk at the ceiling, even inside a page', data.length === 1050, `got ${data.length}`);
    const roomy = fakeTable(table);
    const all = await fetchAll(() => roomy.from().select(), { max: 5000 });
    check('a ceiling above the table size returns the whole table', all.data.length === 1131, `got ${all.data.length}`);
    const u = fakeTable(table);
    const small = await fetchAll(() => u.from().select(), { max: 10 });
    check('a ceiling below one page asks for only that many', small.data.length === 10 && u.calls() === 1);
  }

  // A failing page is an error, not a silently short list.
  {
    const t = fakeTable(table, { failOnCall: 2 });
    const { data, error } = await fetchAll(() => t.from().select());
    check('an error on a later page is reported, not hidden behind a partial list', data === null && error && error.message === 'boom');
  }

  // A server that ignores the range (the stand-ins in other suites) cannot loop forever.
  {
    let n = 0;
    const stuck = () => ({
      order: () => stuck(),
      range: () => Promise.resolve({ data: (n++, Array.from({ length: 1000 }, (_, i) => ({ id: i }))), error: null }),
    });
    const { data } = await fetchAll(stuck);
    check('a server that ignores .range() is cut off at the hard maximum', data.length === HARD_MAX && n === HARD_MAX / 1000, `${data.length} rows, ${n} calls`);
  }

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} fetchAll checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
