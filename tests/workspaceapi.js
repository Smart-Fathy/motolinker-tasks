// The workspace profile's API against the real app and an in-memory database: the look
// is validated, merged onto what is stored (never rebuilt from it), announced to every
// open page, and cannot carry anything but data to the pages that read it back.
const http = require('http');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = createFakeSupabase({
  employees: [{ id: 2, name: 'Sara', username: 'sara', email: '', password_hash: 'x', permissions: {}, job_title: 'Sales' }],
  sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [],
});
db.install();

(async () => {
  const port = process.env.PORT || 3962;
  // The database is down before anything has been read: the first answer cannot come from a cache.
  db.failing.add('quotation_settings');
  const base = await bootApp({ port });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  ctx.sessions.set('wa-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set('wa-sara', { id: 2, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: normEmpPerms({}), createdAt: Date.now() });
  const A = { Authorization: 'Bearer wa-admin', 'Content-Type': 'application/json' };
  const E = { Authorization: 'Bearer wa-sara', 'Content-Type': 'application/json' };
  const get = async p => (await fetch(base + p)).json();
  const put = (p, body, h = A) => fetch(base + p, { method: 'PUT', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const stored = () => { const r = db.tables.quotation_settings.find(x => x.key === 'workspace_profile'); return r ? JSON.parse(r.value) : null; };

  // ── The database is down and nothing is cached ───────────────────────────────
  {
    const r = await fetch(base + '/api/workspace');
    const p = await r.json();
    check('a database that cannot answer still gets a named workspace…', r.status === 200 && p.name === 'MotoLinker' && p.theme.preset === 'black-gold');
    check('…marked degraded, so a page knows it has not heard from the database', p.degraded === true);
    db.failing.delete('quotation_settings');
    const q = await get('/api/workspace');
    check('once it answers, the flag is gone and the answer is the real one', !('degraded' in q) && q.name === 'MotoLinker');
  }

  // ── What a fresh workspace looks like to a page ──────────────────────────────
  {
    const p = await get('/api/workspace');
    check('the public profile carries the look, normalised', p.theme && p.theme.preset === 'black-gold' && p.theme.allow_user_mode === true && p.typography && p.shape && p.texts && p.custom_name === false);
    check('and nothing else (no stored extras)', Object.keys(p).sort().join() === 'custom_name,logo_url,name,shape,texts,theme,typography,updated_at');
  }

  // ── Who may change it ────────────────────────────────────────────────────────
  {
    const anon = await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto' } }, { 'Content-Type': 'application/json' });
    const emp = await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto' } }, E);
    check('nobody signed in cannot', anon.status === 401, 'status ' + anon.status);
    check('a team member cannot, whatever their permissions', emp.status === 401 || emp.status === 403, 'status ' + emp.status);
    check('…and nothing was stored', stored() === null);
  }

  // ── Saving a look ────────────────────────────────────────────────────────────
  let first;
  {
    const r = await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto', accent: '#ABCDEF', glow: 'subtle', default_mode: 'light' }, typography: { heading: 'poppins', body: 'poppins' }, shape: { radius: 3, density: 0 }, texts: { admin_title: 'Moto HQ' } });
    first = await r.json();
    check('the admin can save a look', r.status === 200 && first.theme.preset === 'moto' && first.theme.accent === '#abcdef' && first.typography.heading === 'poppins' && first.shape.radius === 3 && first.texts.admin_title === 'Moto HQ', JSON.stringify(first).slice(0, 200));
    const pub = await get('/api/workspace');
    check('and everyone reading it sees the same', JSON.stringify(pub) === JSON.stringify(first));
    check('the stored record is the data, in the shape theme-core uses', stored().theme.accent === '#abcdef' && stored().updated_at === first.updated_at);
  }

  // ── Merging: name and look do not undo each other ────────────────────────────
  {
    const n = await (await put('/api/dashboard/workspace', { name: 'Moto Group' })).json();
    check('renaming keeps the look', n.name === 'Moto Group' && n.theme.preset === 'moto' && n.typography.body === 'poppins' && n.texts.admin_title === 'Moto HQ');
    const t = await (await put('/api/dashboard/workspace/theme', { shape: { radius: 4 } })).json();
    check('changing one section leaves the others, and the name', t.shape.radius === 4 && t.shape.density === undefined && t.theme.preset === 'moto' && t.name === 'Moto Group');
    const t2 = await (await put('/api/dashboard/workspace/theme', { theme: { preset: 'ember' } })).json();
    check('a section sent is replaced whole, not merged: the old accent is gone', t2.theme.preset === 'ember' && !t2.theme.accent && t2.theme.allow_user_mode === true && t2.name === 'Moto Group');
    const logoRow = stored();
    logoRow.logo_url = 'https://stub.supabase.co/storage/v1/object/public/chat-files/workspace/logo_1_ab.png';
    logoRow.future_field = { keep: 'me' };
    db.tables.quotation_settings.find(x => x.key === 'workspace_profile').value = JSON.stringify(logoRow);
    await put('/api/dashboard/workspace/theme', { theme: { preset: 'matrix' } });
    check('a picture set meanwhile, and fields this version has never heard of, survive a save', stored().logo_url.endsWith('logo_1_ab.png') && stored().future_field.keep === 'me');
  }

  // ── Resetting ────────────────────────────────────────────────────────────────
  {
    const r = await (await put('/api/dashboard/workspace/theme', { reset: true })).json();
    check('reset puts the look back to the original and keeps the name and picture', r.theme.preset === 'black-gold' && !r.theme.accent && Object.keys(r.typography).length === 0 && Object.keys(r.shape).length === 0 && Object.keys(r.texts).length === 0 && r.name === 'Moto Group' && r.logo_url.endsWith('logo_1_ab.png'));
    const n = await (await put('/api/dashboard/workspace/theme', { theme: null })).json();
    check('null clears a section too', n.theme.preset === 'black-gold');
  }

  // ── Refusals ─────────────────────────────────────────────────────────────────
  {
    const before = JSON.stringify(stored());
    const cases = [
      ['an unknown preset', { theme: { preset: 'neon-pink' } }],
      ['a colour that is not a colour', { theme: { accent: 'red;background:url(//x)' } }],
      ['a neutral that is not a colour', { theme: { neutrals: { dark: { bg: '}body{display:none}' } } } }],
      ['a neutral that is not one of the five', { theme: { neutrals: { dark: { sidebarText: '#ffffff' } } } }],
      ['a font that is not on the list', { typography: { heading: 'Comic Sans MS' } }],
      ['a display face as the body font', { typography: { body: 'orbitron' } }],
      ['a roundness out of range', { shape: { radius: 9 } }],
      ['a density that is not a whole step', { shape: { density: 0.5 } }],
      ['text that is too long', { texts: { admin_title: 'x'.repeat(200) } }],
      ['a line that is not one you can change', { texts: { footer: 'hi' } }],
      ['a section of the wrong type', { theme: 'moto' }],
      ['an empty request', {}],
    ];
    for (const [what, body] of cases) {
      const r = await put('/api/dashboard/workspace/theme', body);
      const j = await r.json();
      check(`refused: ${what}`, r.status === 400 && typeof j.error === 'string' && j.error.length > 0, `status ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    }
    const bad = await put('/api/dashboard/workspace/theme', '{not json');
    check('refused: a body that is not JSON', bad.status === 400);
    const big = await put('/api/dashboard/workspace/theme', JSON.stringify({ texts: { admin_title: 'x'.repeat(20000) } }));
    check('refused: a body over 16 KB', big.status === 413, 'status ' + big.status);
    check('none of the refusals changed anything', JSON.stringify(stored()) === before);
  }

  // ── The guard: a look nobody could read ──────────────────────────────────────
  {
    const r = await put('/api/dashboard/workspace/theme', { theme: { neutrals: { dark: { text: '#444444' } } } });
    const j = await r.json();
    check('unreadable text is refused, naming the pair and the mode', r.status === 400 && /Text on the page \(dark\)/.test(j.error) && Array.isArray(j.problems) && j.problems.some(p => p.id === 'text-bg' && p.mode === 'dark'), JSON.stringify(j).slice(0, 200));
    const warn = await put('/api/dashboard/workspace/theme', { theme: { neutrals: { light: { muted: '#848484' } } } });
    check('a merely faint secondary colour is allowed (it is a warning in the editor, not a refusal)', warn.status === 200);
    await put('/api/dashboard/workspace/theme', { reset: true });
  }

  // ── Hostile text ─────────────────────────────────────────────────────────────
  {
    const r = await put('/api/dashboard/workspace/theme', { texts: { admin_title: '<img src=x onerror=alert(1)>  Moto\n\u2028HQ', team_sub: '{ws} · Log hours' } });
    const j = await r.json();
    check('markup brackets and control characters are stripped from the wording', r.status === 200 && !/[<>\n\u2028]/.test(j.texts.admin_title) && j.texts.admin_title.includes('Moto') && j.texts.team_sub === '{ws} · Log hours', JSON.stringify(j.texts));
    await put('/api/dashboard/workspace/theme', { reset: true });
  }

  // ── A stored row that was edited by hand ─────────────────────────────────────
  {
    const row = db.tables.quotation_settings.find(x => x.key === 'workspace_profile');
    const was = row.value;
    row.value = JSON.stringify({
      name: 'Tampered', logo_url: 'javascript:alert(1)',
      theme: { preset: '"; } body { display:none } /*', accent: 'red', neutrals: { dark: { bg: 'url(//evil)' } }, glow: 'blinding' },
      typography: { heading: '</style><script>alert(1)</script>' }, shape: { radius: 99 }, texts: { admin_title: '<script>' },
    });
    // The cache would answer: ask for it afresh through a save of nothing harmful.
    await put('/api/dashboard/workspace', { name: 'Tampered' });
    const p = await get('/api/workspace');
    check('a hand-edited row is read back clean: unknown values fall to the defaults', p.theme.preset === 'black-gold' && !p.theme.accent && !p.theme.neutrals && !p.theme.glow && !p.typography.heading && p.shape.radius === undefined, JSON.stringify(p).slice(0, 220));
    check('…and a picture address that is not our own storage is not believed', p.logo_url === '');
    row.value = was;
  }

  // ── Everyone open is told ────────────────────────────────────────────────────
  {
    const frames = [];
    await new Promise(resolve => {
      const req = http.get(base + '/api/employee/notifications/stream', { headers: { Authorization: 'Bearer wa-sara' } }, res => {
        res.on('data', d => frames.push(String(d)));
        resolve();
      });
      req.on('error', () => {});
      setTimeout(() => req.destroy(), 4000).unref();
    });
    await sleep(200);
    await put('/api/dashboard/workspace/theme', { theme: { preset: 'deep-ocean' } });
    await sleep(300);
    const text = frames.join('');
    const m = /event: workspace\ndata: (.+)\n\n/.exec(text);
    const sent = m ? JSON.parse(m[1]) : null;
    check('a team member\'s open stream receives a workspace event the moment the look is saved', !!sent && sent.theme.preset === 'deep-ocean', text.slice(-200));
    check('…carrying the whole profile, so the page needs no second request', !!sent && sent.name && sent.updated_at && sent.typography && sent.shape);
  }

  // ── Order ────────────────────────────────────────────────────────────────────
  {
    const a = await (await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto' } })).json();
    const b = await (await put('/api/dashboard/workspace/theme', { theme: { preset: 'ember' } })).json();
    const c = await (await put('/api/dashboard/workspace', { name: 'Again' })).json();
    check('every save is stamped strictly later than the one before, so a page can tell which profile is newer',
      Date.parse(a.updated_at) < Date.parse(b.updated_at) && Date.parse(b.updated_at) < Date.parse(c.updated_at));
  }

  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
