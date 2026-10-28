// The pages as they arrive: the workspace's name, picture and look already written in,
// so nothing flashes the original on load; nothing but that added; and no profile,
// however hostile, able to put anything into a page but a name and a colour.
const fs = require('fs');
const path = require('path');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const T = require('../public/assets/theme-core.js');
const { renderShell, renderManifest } = require('../src/lib/shell');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const ADMIN_FILE = read('dashboard.html'), TEAM_FILE = read('employee.html');

const db = createFakeSupabase({
  employees: [], sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [],
});
db.install();

// The page with what the shell adds taken out again: the early script and the theme style.
const stripped = html => html
  .replace(/\n<script>\(function\(\)\{var d=document\.documentElement,m=[^<]*<\/script>/, '')
  .replace(/<style id="ws-theme">[^<]*<\/style>\n<\/head>/, '</head>');

(async () => {
  const port = process.env.PORT || 3963;
  db.failing.add('quotation_settings');   // nothing cached, the database down: the first page is served blind
  const base = await bootApp({ port });
  const ctx = require(process.cwd() + '/src/ctx');
  ctx.sessions.set('sh-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const A = { Authorization: 'Bearer sh-admin', 'Content-Type': 'application/json' };
  const page = async (p, h) => { const r = await fetch(base + p, { headers: h || {} }); return { r, text: await r.text() }; };
  const put = (p, body) => fetch(base + p, { method: 'PUT', headers: A, body: JSON.stringify(body) }).then(r => r.json());
  const setRow = patch => {
    const row = db.tables.quotation_settings.find(x => x.key === 'workspace_profile');
    const cur = row ? JSON.parse(row.value) : {};
    const next = JSON.stringify({ ...cur, ...patch });
    if (row) row.value = next; else db.tables.quotation_settings.push({ key: 'workspace_profile', value: next });
  };

  // ── Opened while the database is down and nothing is cached ──────────────────
  {
    const { r, text } = await page('/dashboard');
    check('a page still opens when the database cannot say what the look is', r.status === 200 && text.includes('<style id="ws-theme">'));
    check('…as the original, not as a guess', !/:root\{/.test(text.match(/<style id="ws-theme">([^<]*)<\/style>/)[1]) && stripped(text) === ADMIN_FILE);
    db.failing.delete('quotation_settings');
  }

  // ── A workspace that has chosen nothing ──────────────────────────────────────
  let adminDefault;
  {
    const a = await page('/dashboard');
    adminDefault = a;
    const t = await page('/employee');
    check('both pages open', a.r.status === 200 && t.r.status === 200 && /^text\/html; charset=utf-8/.test(a.r.headers.get('content-type')));
    check('the page is the file it always was, plus the mode script and the theme style — nothing else changed', stripped(a.text) === ADMIN_FILE && stripped(t.text) === TEAM_FILE);
    const style = a.text.match(/<style id="ws-theme">([^<]*)<\/style>/)[1];
    check('what is added for a default workspace is only the light tokens (and the always-dark parts putting them back)', style.startsWith('html[data-mode="light"]{') && !/:root/.test(style) && !/(^|\})\.on-dark/.test(style) && style === T.renderThemeCss({}));
    check('the mode script runs before the stylesheets; the style comes after them', a.text.indexOf('data-mode') < a.text.indexOf('<link rel="stylesheet"') && a.text.indexOf('<style id="ws-theme">') > a.text.lastIndexOf('<link rel="stylesheet"'));
    check('the font link and the browser-bar colour are as they were', a.text.includes('<meta name="theme-color" content="#1e2130">') && a.text.includes(T.fontsHref({})) && !a.text.includes('ws-custom-logo'));
    check('/dashboard.html and /employee.html are the same pages, not the bare files', (await page('/dashboard.html')).text === a.text && (await page('/employee.html')).text === t.text);
    check('it is revalidated each time, and answers 304 when nothing has changed', /no-cache/.test(a.r.headers.get('cache-control')) && !!a.r.headers.get('etag')
      // (fetch adds Cache-Control: no-cache to a conditional request unless told otherwise, which asks for a fresh copy)
      && (await fetch(base + '/dashboard', { headers: { 'If-None-Match': a.r.headers.get('etag'), 'Cache-Control': 'max-age=0' } })).status === 304);
  }

  // ── A workspace with a look, a name and a picture ─────────────────────────────
  const LOGO = 'https://stub.supabase.co/storage/v1/object/public/chat-files/workspace/logo_1_ab.png';
  let moto;
  {
    await put('/api/dashboard/workspace', { name: 'Moto & "Co" <Group>' });
    await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto' }, typography: { heading: 'poppins', body: 'poppins' }, shape: { radius: 3, density: 1 } });
    setRow({ logo_url: LOGO });
    await put('/api/dashboard/workspace', { name: 'Moto & "Co" <Group>' });   // refresh the cache with the picture
    const a = await page('/dashboard');
    moto = a;
    const t = await page('/employee');
    const prof = await (await fetch(base + '/api/workspace')).json();
    const style = a.text.match(/<style id="ws-theme">([^<]*)<\/style>/)[1];
    check('the dark block, the always-dark block and the light block are all there, exactly as theme-core writes them', style === T.renderThemeCss(prof) && /^:root\{/.test(style) && style.includes('.on-dark{') && style.includes('html[data-mode="light"]{'));
    check('the font link is the chosen pair', a.text.includes('<link href="' + T.fontsHref(prof) + '" rel="stylesheet">') && !a.text.includes('Cormorant'));
    check('the browser bar takes the page colour of the mode it opens in (Moto opens light)', a.text.includes('<meta name="theme-color" content="#f5f9f3">') && t.text.includes('<meta name="theme-color" content="#f5f9f3">'));
    check('the phone status bar of the team portal is no longer a dark translucent one under a light page', t.text.includes('<meta name="apple-mobile-web-app-status-bar-style" content="default">') && !t.text.includes('black-translucent'));
    check('the mode script opens the page light', a.text.includes('m="light"'));
    check('the name is in the title, the sidebar and the headings — escaped', a.text.includes('<title data-ws-title="{ws} · Admin Dashboard">Moto &amp; &quot;Co&quot; &lt;Group&gt; · Admin Dashboard</title>')
      && a.text.includes('<div class="sidebar-logo-text" data-ws-name>Moto &amp; &quot;Co&quot; &lt;Group&gt;</div>') && !a.text.includes('<Group>') && (a.text.match(/data-ws-name>Moto/g) || []).length === 2, (a.text.match(/data-ws-name>[^<]*/g) || []).join(' | '));
    check('…on the team page too, in the sign-in line and the install banner', (t.text.match(/data-ws-name>Moto &amp;/g) || []).length === 4);
    check('the picture is on the page before any script runs: the mark, and the tab icon with the original kept', a.text.includes('<html lang="en" class="ws-custom-logo" style="--ws-logo:url(&quot;' + LOGO + '&quot;)">')
      && a.text.includes('<link rel="icon" type="image/png" href="' + LOGO + '" data-default-href="/icons/favicon.png">'));
    check('a changed workspace is a different page (new ETag)', a.r.headers.get('etag') !== adminDefault.r.headers.get('etag'));
    check('…and nothing but the intended things differ from the original page', (() => {
      const orig = ADMIN_FILE.split('\n'), now = a.text.split('\n');
      const changed = now.filter(l => !orig.includes(l));
      return changed.every(l => /ws-theme|data-mode|theme-color|fonts\.googleapis|<title|data-ws-name|<html|rel="icon"|<script>/.test(l));
    })());
  }

  // ── Safe mode ────────────────────────────────────────────────────────────────
  {
    const s = await page('/dashboard?safe=1');
    check('?safe=1 opens the original look whatever is saved…', s.text.match(/<style id="ws-theme">([^<]*)<\/style>/)[1] === T.renderThemeCss({}) && s.text.includes(T.fontsHref({})) && s.text.includes('<meta name="theme-color" content="#1e2130">') && s.text.includes('m="dark"'));
    check('…but is still the workspace: its name and picture', s.text.includes('Moto &amp;') && s.text.includes('ws-custom-logo'));
    check('and is not what the next ordinary visit gets', (await page('/dashboard')).text === moto.text);
  }

  // ── Hostile profiles ─────────────────────────────────────────────────────────
  {
    setRow({
      name: '</title><script>alert(1)</script>',
      logo_url: 'https://x.test/a.png"); } body { display:none } /*',
      theme: { preset: '"}</style><script>alert(2)</script>', accent: 'red;}', neutrals: { dark: { bg: '</style>' } } },
      typography: { heading: '</style>' }, shape: {}, texts: { admin_title: '<script>alert(3)</script>' },
    });
    await put('/api/dashboard/workspace', { name: '</title><script>alert(1)</script>' });
    const a = await page('/dashboard');
    check('no script of an attacker\'s writing can be on the page', !/alert\([123]\)/.test(a.text.replace(/<script>alert\([123]\)<\/script>/g, '')) === true || !/<script>alert/.test(a.text), (a.text.match(/.{20}alert.{20}/g) || []).join(' | '));
    check('…the name is text, wherever it appears', a.text.includes('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;') && !a.text.includes('<script>alert'));
    check('…a picture address that is not our own storage is not used', !a.text.includes('ws-custom-logo') && !a.text.includes('x.test'));
    check('…and the look falls back to the original', a.text.match(/<style id="ws-theme">([^<]*)<\/style>/)[1] === T.renderThemeCss({}));
    await put('/api/dashboard/workspace', { name: 'MotoLinker' });
    setRow({ logo_url: '', theme: {}, typography: {}, texts: {} });
  }

  // ── The wording an admin replaced ─────────────────────────────────────────────
  {
    const fixture = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MotoLinker · X</title><link rel="stylesheet" href="/a.css"></head><body>'
      + '<h1 data-ws-text="admin_title">Admin Dashboard</h1><p data-ws-text="team_sub"><b>x</b> y</p><p><span data-ws-text="team_sub">Log hours</span></p><i data-ws-text="admin_sub">Welcome</i></body></html>';
    const ws = { name: 'Moto', custom_name: true, logo_url: '', updated_at: 'x', theme: {}, typography: {}, shape: {}, texts: { admin_title: 'Moto <HQ> & Co', team_sub: '{ws} · Hours', evil: 'x' } };
    const out = renderShell(fixture, ws);
    check('a replaced line is written in, escaped (the brackets were already taken out of it on the way in)', out.includes('<h1 data-ws-text="admin_title">Moto HQ &amp; Co</h1>'), (out.match(/<h1[^>]*>[^<]*/) || [])[0]);
    check('{ws} stands for the workspace\'s name', out.includes('<span data-ws-text="team_sub">Moto · Hours</span>'));
    check('a line nobody replaced keeps its own wording, and one that holds markup is left alone', out.includes('<i data-ws-text="admin_sub">Welcome</i>') && out.includes('<p data-ws-text="team_sub"><b>x</b> y</p>'));
  }

  // ── Install manifests ────────────────────────────────────────────────────────
  {
    const file = JSON.parse(read('manifest-dashboard.json'));
    // back to a workspace that has chosen nothing
    await put('/api/dashboard/workspace/theme', { reset: true });
    const def = await (await fetch(base + '/manifest-dashboard.json')).json();
    check('the manifest of an unchanged workspace is the file as shipped', JSON.stringify(def) === JSON.stringify(file) && /json/.test((await fetch(base + '/manifest-employee.json')).headers.get('content-type')));
    await put('/api/dashboard/workspace', { name: 'Moto Group Holdings' });
    await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto' } });
    const m = await (await fetch(base + '/manifest-dashboard.json')).json();
    const e = await (await fetch(base + '/manifest-employee.json')).json();
    check('a named workspace names the installed app', m.name === 'Moto Group Holdings — Admin' && m.short_name === 'Moto Group Ho' .slice(0, 12) && /^Moto Group Holdings Admin/.test(m.description) && e.name === 'Moto Group Holdings — Team Portal' && e.short_name === 'Moto Group H');
    check('…and its page colour is the splash and title-bar colour', m.background_color === '#f5f9f3' && m.theme_color === '#f5f9f3' && e.background_color === '#f5f9f3');
    check('everything else about the app is untouched', m.id === '/dashboard' && m.start_url === '/dashboard' && m.scope === '/dashboard' && JSON.stringify(m.icons) === JSON.stringify(file.icons) && m.display === 'standalone');
    check('renderManifest does not alter the object it is given', (() => { const o = { name: 'x', theme_color: '#000000', description: 'MotoLinker' }; const before = JSON.stringify(o); renderManifest(o, { name: 'Z', custom_name: true, theme: { preset: 'ember' } }, 'admin'); return JSON.stringify(o) === before; })());
  }

  // ── Service workers ──────────────────────────────────────────────────────────
  for (const [f, portal] of [['sw-dashboard.js', 'dashboard'], ['sw-employee.js', 'employee']]) {
    const sw = read(f);
    const i = sw.indexOf("startsWith('/manifest-" + portal + "')");
    const block = sw.slice(i, i + 400);
    check(`${f}: the manifest is fetched network-first, so a rename reaches an installed copy`, i > 0 && /fetch\(request\)/.test(block) && /\.catch\(\(\) => caches\.match\(request\)\)/.test(block) && !/\/manifest-/.test(sw.slice(sw.indexOf('Icons and assets'), sw.indexOf('Icons and assets') + 200)));
  }

  // ── Never the reason a page does not open ─────────────────────────────────────
  {
    const real = ctx.workspaceProfile;
    ctx.workspaceProfile = async () => { throw new Error('boom'); };
    const a = await page('/dashboard');
    check('if dressing the page fails, the page itself is still sent', a.r.status === 200 && a.text === ADMIN_FILE);
    ctx.workspaceProfile = real;
  }

  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
