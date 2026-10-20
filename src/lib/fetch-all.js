// Read every row of a Supabase query, not just the first page of it.
//
// PostgREST answers one request with at most `max-rows` rows (Supabase's default
// is 1000) and does so silently: no error, no flag, and `.limit(50000)` does not
// raise it. Every list in the app that was written as one query therefore stops at
// 1000 rows the day its table grows past that. The leads table did, and the
// symptom was a total that stopped tracking the real number.
//
// `build` returns a FRESH query each time it is called (a builder is spent once it
// is awaited), already past .select() and any filters:
//
//   const { data, error } = await fetchAll(
//     () => supabase.from('customers').select('id,name').order('created_at', { ascending: false }));
//
// The result has supabase-js's own { data, error } shape, so a caller swaps in
// without changing how it reads the answer.
//
// Pages are cut by position, so the order has to be total or rows can be skipped or
// repeated at a page edge. A sort on created_at alone is not: a CSV import writes
// hundreds of rows with one identical timestamp. The primary key is appended as the
// last sort key to make it so.
const PAGE = 1000;

// Never walk past this many rows, however the caller asks: the stand-in servers in
// the test suites ignore the range and would otherwise answer the same page forever.
const HARD_MAX = 50000;

async function fetchAll(build, { max = HARD_MAX, pageSize = PAGE, tiebreak = 'id' } = {}) {
  const cap = Math.min(max, HARD_MAX);
  const rows = [];
  while (rows.length < cap) {
    const from = rows.length;
    const to = Math.min(from + pageSize, cap) - 1;
    let q = build();
    if (tiebreak) q = q.order(tiebreak, { ascending: true });
    const { data, error } = await q.range(from, to);
    if (error) return { data: null, error };
    const got = data || [];
    rows.push(...got);
    // A short page is the end of the table. This relies on pageSize not exceeding
    // the server's max-rows, so it stays at 1000, the default.
    if (got.length < to - from + 1) break;
  }
  return { data: rows, error: null };
}

module.exports = { fetchAll, PAGE, HARD_MAX };
