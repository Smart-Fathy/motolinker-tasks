// A small in-memory stand-in for Supabase's REST API (PostgREST), for tests that boot
// the real app and need a database that actually filters, updates and deletes.
//
// Not a general PostgREST — it covers the verbs, filters and headers this app's
// queries use, and throws on anything else, so a query that quietly does something
// different from the real thing shows up as a test error rather than a pass.
//
//   const db = createFakeSupabase({ employees: [...], sessions: [] });
//   db.install();                        // replaces global.fetch for stub.supabase.co
//   db.tables.sessions                   // the live rows
//   db.missing.add('login_events')       // behave as if the table were never migrated
//   db.failing.add('account_security')   // answer 500, as a database that is down does
//   db.restarting.add('account_security')   // answer 503 PGRST002, as PostgREST does while a restarted database comes back
//   db.latency = 20                      // ms per query, so concurrent requests really interleave
//   { defaults: { t: () => ({ col: v }) } }  // column defaults applied on insert, like the real table's
//   db.storage                           // Storage objects uploaded: 'bucket/path' -> { contentType, size, bytes }
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function createFakeSupabase(initial = {}, { serial = {}, defaults = {} } = {}) {
  const tables = {};
  const nextId = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows;
    nextId[name] = serial[name] || (rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1);
  }
  const missing = new Set();
  const failing = new Set();   // tables that answer 500, as a database that is down or timing out does
  // Tables that answer as PostgREST does for the minute after a database restart, while
  // it reloads its schema cache. The message names the schema cache, as a missing
  // table's does — which is the mistake this exists to catch.
  const restarting = new Set();
  const log = [];   // { method, table, query } for assertions about what the app asked for
  const storage = new Map();   // 'bucket/path' -> { contentType, size }

  const getCol = (row, col) => {
    const m = col.match(/^(\w+)->>(\w+)$/);
    if (m) { const o = row[m[1]]; const v = o == null ? undefined : o[m[2]]; return v == null ? null : String(v); }
    return row[col];
  };
  const parseList = s => s.replace(/^\(|\)$/g, '').split(',').map(x => x.trim().replace(/^"|"$/g, ''));
  const cmp = (a, b) => {
    if (a == null || b == null) return 0;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
    const da = Date.parse(a), db = Date.parse(b);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  function matches(row, col, expr) {
    const dot = expr.indexOf('.');
    const op = expr.slice(0, dot), val = expr.slice(dot + 1);
    const v = getCol(row, col);
    switch (op) {
      case 'eq': return v != null && String(v) === val;
      case 'neq': return v == null || String(v) !== val;
      case 'in': return v != null && parseList(val).includes(String(v));
      case 'is': return val === 'null' ? v == null : String(v) === val;
      case 'lt': return v != null && cmp(v, val) < 0;
      case 'lte': return v != null && cmp(v, val) <= 0;
      case 'gt': return v != null && cmp(v, val) > 0;
      case 'gte': return v != null && cmp(v, val) >= 0;
      case 'ilike': return v != null && new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(String(v));
      default: throw new Error(`fake-supabase: unsupported filter operator "${op}" on ${col}`);
    }
  }
  const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
  function filtered(rows, params) {
    let out = rows;
    for (const [col, expr] of params) {
      if (RESERVED.has(col)) continue;
      if (col === 'or' || col === 'and') throw new Error('fake-supabase: or()/and() filters are not supported');
      out = out.filter(r => matches(r, col, expr));
    }
    return out;
  }
  function project(rows, select) {
    if (!select || select === '*' || /[(]/.test(select)) return rows;
    const cols = select.split(',').map(s => s.trim());
    return rows.map(r => { const o = {}; for (const c of cols) o[c] = r[c]; return o; });
  }

  async function handle(url, init = {}) {
    // A real database takes time to answer, which is what lets two requests that arrive
    // together both read a row before either has written it. Answering in the same turn
    // of the event loop hides every race; tests that need one set db.latency.
    if (db.latency) await new Promise(r => setTimeout(r, db.latency));
    const u = new URL(url);
    const table = (u.pathname.match(/\/rest\/v1\/([^/]+)/) || [])[1];
    const method = String(init.method || 'GET').toUpperCase();
    const hdr = {};
    const rawH = init.headers;
    if (rawH && typeof rawH.forEach === 'function') rawH.forEach((v, k) => { hdr[k.toLowerCase()] = v; });
    else for (const [k, v] of Object.entries(rawH || {})) hdr[k.toLowerCase()] = v;

    // Storage, as storage-js speaks it: an upload POSTs the bytes to object/<bucket>/<path>
    // and is answered with its Key; a removal DELETEs object/<bucket> with the paths.
    const obj = u.pathname.match(/^\/storage\/v1\/object\/(.+)$/);
    if (obj) {
      log.push({ method, table: 'storage', query: obj[1] });
      if (method === 'POST' || method === 'PUT') {
        const key = decodeURIComponent(obj[1]);
        if (method === 'POST' && storage.has(key) && hdr['x-upsert'] !== 'true') {
          return new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), { status: 400, headers: JSON_HEADERS });
        }
        const body = init.body;
        const bytes = body && (Buffer.isBuffer(body) || body instanceof Uint8Array) ? Buffer.from(body) : null;
        storage.set(key, { contentType: hdr['content-type'] || '', size: body ? (body.length ?? body.byteLength ?? body.size ?? 0) : 0, bytes });
        return new Response(JSON.stringify({ Id: 'obj-' + storage.size, Key: key }), { status: 200, headers: JSON_HEADERS });
      }
      if (method === 'DELETE') {
        const bucket = decodeURIComponent(obj[1]);
        const gone = [];
        for (const p of (JSON.parse(init.body || '{}').prefixes || [])) if (storage.delete(bucket + '/' + p)) gone.push({ name: p });
        return new Response(JSON.stringify(gone), { status: 200, headers: JSON_HEADERS });
      }
      throw new Error(`fake-supabase: unsupported storage method ${method}`);
    }
    const prefer = String(hdr.prefer || '');
    const wantsRows = /return=representation/.test(prefer);
    const single = /vnd\.pgrst\.object/.test(String(hdr.accept || ''));
    const params = [...u.searchParams.entries()];
    const sel = u.searchParams.get('select');
    log.push({ method, table, query: u.search });

    if (failing.has(table)) {
      return new Response(JSON.stringify({ code: 'XX000', message: 'simulated database failure' }), { status: 500, headers: JSON_HEADERS });
    }
    if (restarting.has(table)) {
      return new Response(JSON.stringify({ code: 'PGRST002', details: null, hint: null, message: 'Could not query the database for the schema cache. Retrying.' }), { status: 503, headers: JSON_HEADERS });
    }
    if (!(table in tables) || missing.has(table)) {
      return new Response(JSON.stringify({ code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${table}' in the schema cache` }), { status: 404, headers: JSON_HEADERS });
    }
    const rows = tables[table];
    const reply = (list, status = 200) => {
      if (single) {
        if (list.length !== 1) return new Response(JSON.stringify({ code: 'PGRST116', details: `The result contains ${list.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }), { status: 406, headers: JSON_HEADERS });
        return new Response(JSON.stringify(project(list, sel)[0]), { status, headers: JSON_HEADERS });
      }
      return new Response(JSON.stringify(project(list, sel)), { status, headers: JSON_HEADERS });
    };

    if (method === 'GET') {
      let out = filtered(rows, params).slice();
      const order = u.searchParams.get('order');
      if (order) {
        const keys = order.split(',').map(o => { const [c, d] = o.split('.'); return { c, desc: d === 'desc' }; });
        out.sort((a, b) => { for (const { c, desc } of keys) { const r = cmp(getCol(a, c), getCol(b, c)); if (r) return desc ? -r : r; } return 0; });
      }
      const off = Number(u.searchParams.get('offset') || 0), lim = u.searchParams.get('limit');
      out = out.slice(off, lim != null ? off + Number(lim) : undefined);
      return reply(out.map(r => ({ ...r })));
    }

    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const batch = Array.isArray(body) ? body : [body];
      const conflict = u.searchParams.get('on_conflict');
      const merge = /resolution=merge-duplicates/.test(prefer);
      const out = [];
      for (const item of batch) {
        let row = null;
        if (conflict) {
          const keys = conflict.split(',');
          row = rows.find(r => keys.every(k => String(r[k]) === String(item[k])));
        }
        if (row && merge) { Object.assign(row, item); out.push(row); continue; }
        if (row) return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' }), { status: 409, headers: JSON_HEADERS });
        const fresh = { ...(defaults[table] ? defaults[table]() : {}), ...item };
        if (fresh.id == null && nextId[table] != null && table !== 'sessions') fresh.id = nextId[table]++;
        if (fresh.created_at === undefined && table !== 'sessions') fresh.created_at = new Date().toISOString();
        rows.push(fresh); out.push(fresh);
      }
      return wantsRows ? reply(out.map(r => ({ ...r })), 201) : new Response(null, { status: 201 });
    }

    if (method === 'PATCH') {
      const hit = filtered(rows, params);
      const patch = JSON.parse(init.body);
      for (const r of hit) Object.assign(r, patch);
      return wantsRows ? reply(hit.map(r => ({ ...r }))) : new Response(null, { status: 204 });
    }

    if (method === 'DELETE') {
      const hit = filtered(rows, params);
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return wantsRows ? reply(hit.map(r => ({ ...r }))) : new Response(null, { status: 204 });
    }
    throw new Error(`fake-supabase: unsupported method ${method}`);
  }

  function install() {
    const real = global.fetch;
    global.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!url.includes('stub.supabase.co')) return real(input, init);
      return handle(url, init || (typeof input === 'object' ? { method: input.method, headers: input.headers, body: undefined } : {}));
    };
    return db;
  }
  const db = { tables, missing, failing, restarting, log, storage, install, handle, latency: 0 };
  return db;
}

// Boot the real app against a stub and wait until it answers.
async function bootApp({ port, adminPassword = 'pw', env = {} } = {}) {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
  process.env.ADMIN_PASSWORD = adminPassword;
  process.env.PORT = String(port);
  Object.assign(process.env, env);
  require(process.cwd() + '/index.js');
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + '/api/auth/check'); return base; } catch (_) { await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error('app did not start');
}

module.exports = { createFakeSupabase, bootApp };
