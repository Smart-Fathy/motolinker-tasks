// The new app behind the switch: who gets it, what it is dressed in, and that nothing the switch does can
// leave a page that does not open.
//
// The classic portals are what everybody gets. A browser that asks (?ui=next, remembered in the `ml_ui` cookie, or an
// env default) is sent the new app instead: apps/web built for real by this suite, its page dressed by the code that
// dresses the classic pages, so it opens in the workspace's look from the first paint. The classic page is always at
// /legacy/dashboard and /legacy/employee; ?ui=legacy puts a browser back; no build, a template that has lost a hook, or
// a switch that cannot be read all send the classic page.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const T = require('../public/assets/theme-core.js');
const { SWAPS, BOOT_MARKER, scriptJson } = require('../src/http/spa-shell');
const { chooseUi, readCookie } = require('../src/http/ui-choice');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ── The app, built for real into a directory of its own ─────────────────────────────────────────
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }
const template = read('apps', 'web', 'index.html');
const builtPage = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const assets = fs.readdirSync(path.join(dist, 'assets'));
const jsFile = assets.find(f => f.endsWith('.js'));

// ── 1. The template and the built page keep the hooks the dressing code finds its places by ─────
const HOOKS = [
  BOOT_MARKER, '<meta charset="UTF-8">', '<title>MotoLinker · Admin Dashboard</title>', '<link rel="icon" type="image/png" href="/icons/favicon.png">',
  '<meta name="theme-color" content="#1e2130">', '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="ML Admin">', '<link rel="manifest" href="/manifest-dashboard.json">', '<div id="root"></div>',
];
const FONTS_LINK = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/;
check('the template has every hook the dressing code looks for', HOOKS.every(h => template.includes(h)) && FONTS_LINK.test(template), HOOKS.filter(h => !template.includes(h)).join(' | '));
check('…and the page the build writes keeps them all, and gains its script and sheet under /ui/', HOOKS.every(h => builtPage.includes(h)) && FONTS_LINK.test(builtPage)
  && /<script type="module"[^>]*src="\/ui\/assets\/[^"]+\.js"/.test(builtPage) && /<link rel="stylesheet"[^>]*href="\/ui\/assets\/[^"]+\.css"/.test(builtPage));
check('every text swapped in for the team portal is in the template', SWAPS.team.every(([from]) => template.includes(from)), SWAPS.team.filter(([from]) => !template.includes(from)).map(([f]) => f).join(' | '));
// The heads are the classic pages' heads, not a copy that can drift from them.
const tag = (html, re) => (html.match(re) || [''])[0];
const heads = html => ['<meta name="theme-color"[^>]*>', '<meta name="apple-mobile-web-app-status-bar-style"[^>]*>', '<meta name="apple-mobile-web-app-title"[^>]*>', '<link rel="manifest"[^>]*>', '<title>[^<]*</title>'].map(r => tag(html, new RegExp(r)));
const classicAdmin = read('public', 'dashboard.html'), classicTeam = read('public', 'employee.html');
check('the admin head in the template is the classic dashboard page\'s head', JSON.stringify(heads(template)) === JSON.stringify(heads(classicAdmin)), JSON.stringify(heads(template)) + ' vs ' + JSON.stringify(heads(classicAdmin)));
// (the <a> is the noscript link, and the <html> tag carries the app's own marker of which portal's defaults the stylesheet starts from:
// neither is in a classic page's head)
const fromClassicHead = ([, to]) => !to.startsWith('<a ') && !to.startsWith('<html');
check('what is swapped in for the team is, word for word, in the classic team page\'s head', SWAPS.team.filter(fromClassicHead).every(([, to]) => classicTeam.includes(to)), SWAPS.team.filter(([, to]) => fromClassicHead([, to]) && !classicTeam.includes(to)).map(([, to]) => to).join(' | '));
check('the template marks the admin portal on <html>, and the team swap marks the team', template.includes('<html lang="en" data-portal="admin">') && SWAPS.team.some(([from, to]) => from === '<html lang="en" data-portal="admin">' && to === '<html lang="en" data-portal="team">'));
// The layers rank in the order they are first named in the built sheet, so a component's sheet coming before base.css would put
// `ui` under the reset and turn every padding and margin in the app to zero. Nothing else notices: the page still opens.
const builtCss = fs.readFileSync(path.join(dist, 'assets', assets.find(f => f.endsWith('.css'))), 'utf8');
const layerOrder = css => { const seen = []; for (const m of css.matchAll(/@layer\s+([a-z][a-z0-9, -]*)\s*[{;]/gi)) for (const n of m[1].split(',').map(x => x.trim())) if (n && !seen.includes(n)) seen.push(n); return seen; };
check('the built stylesheet ranks its layers reset, base, ui — the order they are named in, which the import order in main.tsx decides', layerOrder(builtCss).slice(0, 3).join() === 'reset,base,ui', layerOrder(builtCss).join());

// ── 2. The pure parts ───────────────────────────────────────────────────────────────────────────
check('the switch takes only next and legacy, from the query first, then the cookie, then the default', (() => {
  const c = o => JSON.stringify(chooseUi(o));
  return c({ query: { ui: 'next' } }) === '{"ui":"next","remember":"next"}'
    && c({ query: { ui: 'legacy' }, cookie: 'ml_ui=next' }) === '{"ui":"legacy","remember":"legacy"}'
    && c({ cookie: 'a=1; ml_ui=next; b=2' }) === '{"ui":"next","remember":null}'
    && c({ defaultUi: 'next' }) === '{"ui":"next","remember":null}'
    && c({ query: { ui: 'NEXT' }, cookie: 'ml_ui=other' }) === '{"ui":"legacy","remember":null}'
    && c({ query: { ui: ['next', 'legacy'] } }) === '{"ui":"legacy","remember":null}'
    && c({ query: { ui: '' }, cookie: ';;;', defaultUi: 'bogus' }) === '{"ui":"legacy","remember":null}'
    && c() === '{"ui":"legacy","remember":null}';
})());
check('a cookie is read by name, whitespace and other cookies notwithstanding', readCookie(' a=1;  ml_ui = next ;b=2', 'ml_ui') === 'next' && readCookie('xml_ui=next', 'ml_ui') === null && readCookie(undefined, 'ml_ui') === null);
check('the JSON written into a page cannot close its script, open a comment, or hold a raw line separator', (() => {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const s = scriptJson({ a: '</script><!--<script>alert(1)', b: 'x' + LS + 'y' + PS });
  return !s.includes('<') && !s.includes(LS) && !s.includes(PS) && JSON.parse(s).a === '</script><!--<script>alert(1)';
})());

// ── 3. The server ───────────────────────────────────────────────────────────────────────────────
const db = createFakeSupabase({ employees: [], sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [] });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3990, env: { ML_WEB_DIST: dist } });
  const ctx = require(process.cwd() + '/src/ctx');
  ctx.sessions.set('sp-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const A = { Authorization: 'Bearer sp-admin', 'Content-Type': 'application/json' };
  const put = (p, body) => fetch(base + p, { method: 'PUT', headers: A, body: JSON.stringify(body) }).then(r => r.json());
  const page = async (p, headers) => {
    const r = await fetch(base + p, { headers: headers || {}, redirect: 'manual' });
    return { r, status: r.status, text: await r.text(), cookies: r.headers.getSetCookie() };
  };
  const isSpa = t => t.includes('<div id="root"></div>') && /window\.__ML__=/.test(t);
  const isClassic = t => /href="\/assets\/[a-z-]+\.css/.test(t) && !isSpa(t);
  const COOKIE_NEXT = 'ml_ui=next; Path=/; Max-Age=31536000; SameSite=Lax', COOKIE_LEGACY = 'ml_ui=legacy; Path=/; Max-Age=31536000; SameSite=Lax';
  const mlOf = t => JSON.parse(t.match(/window\.__ML__=(\{.*?\});<\/script>/)[1]);

  // — a browser that has asked for nothing gets the classic page, exactly as before —
  const def = await page('/dashboard');
  const legacyAdmin = await page('/legacy/dashboard');
  check('with no cookie, no query and no env default, /dashboard is the classic page', def.status === 200 && isClassic(def.text));
  check('…which is byte for byte what /legacy/dashboard sends', def.text === legacyAdmin.text && legacyAdmin.status === 200);
  check('…and the address says that it varies by cookie, because it now can', /cookie/i.test(def.r.headers.get('vary') || ''));
  check('…the team page too', isClassic((await page('/employee')).text) && (await page('/employee')).text === (await page('/legacy/employee')).text);
  check('…and nothing is remembered unless asked', def.cookies.length === 0);

  // — asking for the new app —
  const next = await page('/dashboard?ui=next');
  check('?ui=next sends the new app\'s page', next.status === 200 && isSpa(next.text) && /id="root"/.test(next.text));
  check('…and the server remembers the choice for a year', next.cookies.length === 1 && next.cookies[0] === COOKIE_NEXT, next.cookies.join(' | '));
  check('…the page is not cached by anyone without asking the server first', /no-cache/.test(next.r.headers.get('cache-control') || ''));
  check('…it carries what the app is told about where it is: the portal and the workspace\'s name', (() => { const m = mlOf(next.text); return m.portal === 'admin' && m.ui === 'next' && m.v === 1 && m.workspace.name === 'MotoLinker'; })());
  check('…its script and sheet are the built, hashed files under /ui/', new RegExp('/ui/assets/' + jsFile.replace('.', '\\.')).test(next.text));
  check('…and the marker is gone, so no half-dressed page', !next.text.includes(BOOT_MARKER));
  const remembered = await page('/dashboard', { Cookie: 'ml_ui=next' });
  check('a browser that has the cookie gets the new app without asking again, and the cookie is not rewritten', isSpa(remembered.text) && remembered.cookies.length === 0);
  const back = await page('/dashboard?ui=legacy', { Cookie: 'ml_ui=next' });
  check('?ui=legacy is the way back: the classic page, and the cookie says so', isClassic(back.text) && back.cookies[0] === COOKIE_LEGACY);
  check('/legacy/dashboard is the classic page whatever the cookie says', isClassic((await page('/legacy/dashboard', { Cookie: 'ml_ui=next' })).text));
  check('/dashboard.html follows the switch too', isSpa((await page('/dashboard.html?ui=next')).text) && isClassic((await page('/dashboard.html')).text));
  const garbage = [['/dashboard?ui=bogus', {}], ['/dashboard?ui=NEXT', {}], ['/dashboard?ui=next&ui=legacy', {}], ['/dashboard?ui[]=next', {}], ['/dashboard', { Cookie: 'ml_ui=bogus' }], ['/dashboard', { Cookie: ';;;ml_ui' }], ['/dashboard', { Cookie: 'ml_ui=' }]];
  const wrong = [];
  for (const [p, h] of garbage) { const g = await page(p, h); if (!isClassic(g.text) || g.cookies.length) wrong.push(p + ' ' + JSON.stringify(h)); }
  check('anything that is not exactly next or legacy is ignored: the classic page, nothing remembered', wrong.length === 0, wrong.join('; '));

  // — the team portal —
  const team = await page('/employee?ui=next');
  check('/employee?ui=next sends the new app dressed as the team portal', team.status === 200 && isSpa(team.text) && mlOf(team.text).portal === 'team');
  check('…with the team portal\'s head: title, manifest, theme colour, status bar, app title and the noscript link', team.text.includes('<title>MotoLinker — Team Portal</title>') && team.text.includes('href="/manifest-employee.json"')
    && team.text.includes('<meta name="theme-color" content="#0a0b10">') && team.text.includes('content="black-translucent"') && team.text.includes('<meta name="apple-mobile-web-app-title" content="MotoLinker">')
    && team.text.includes('<a href="/legacy/employee">') && !team.text.includes('Admin Dashboard') && !team.text.includes('manifest-dashboard'));
  check('…and the admin page keeps the admin head', next.text.includes('<title>MotoLinker · Admin Dashboard</title>') && next.text.includes('href="/manifest-dashboard.json"') && next.text.includes('<a href="/legacy/dashboard">'));

  // — env defaults —
  process.env.ML_UI_DEFAULT_ADMIN = 'next';
  check('ML_UI_DEFAULT_ADMIN=next gives the admin portal the new app to a browser that has asked for nothing, and not the team portal', isSpa((await page('/dashboard')).text) && isClassic((await page('/employee')).text));
  check('…while a browser that chose the classic page keeps it', isClassic((await page('/dashboard', { Cookie: 'ml_ui=legacy' })).text));
  delete process.env.ML_UI_DEFAULT_ADMIN;
  process.env.ML_UI_DEFAULT = 'next';
  check('ML_UI_DEFAULT=next is the default for both', isSpa((await page('/dashboard')).text) && isSpa((await page('/employee')).text));
  process.env.ML_UI_DEFAULT_TEAM = 'legacy';
  check('…and a portal\'s own variable beats the shared one', isSpa((await page('/dashboard')).text) && isClassic((await page('/employee')).text));
  delete process.env.ML_UI_DEFAULT; delete process.env.ML_UI_DEFAULT_TEAM;
  process.env.ML_UI_DEFAULT_ADMIN = 'nonsense';
  check('an env default that is not next is the classic page', isClassic((await page('/dashboard')).text));
  delete process.env.ML_UI_DEFAULT_ADMIN;

  // — addresses inside the new app —
  const deep = await page('/dashboard/leads/42', { Cookie: 'ml_ui=next' });
  check('an address inside the new app opens the new app (so a deep link survives a reload)', deep.status === 200 && isSpa(deep.text));
  const deepClassic = await page('/dashboard/leads/42');
  check('…and for a browser on the classic page it does not exist, as before', deepClassic.status === 404);
  check('…nor does one under /employee', (await page('/employee/anything')).status === 404 && isSpa((await page('/employee/anything', { Cookie: 'ml_ui=next' })).text));

  // — the workspace's look —
  await put('/api/dashboard/workspace', { name: 'Acme Motors' });
  await put('/api/dashboard/workspace/theme', { theme: { preset: 'moto' }, typography: { heading: 'poppins', body: 'poppins' } });
  const dressed = await page('/dashboard?ui=next');
  const classicDressed = await page('/legacy/dashboard');
  const styleOf = t => (t.match(/<style id="ws-theme">([^<]*)<\/style>/) || [])[1];
  check('the new app opens in the workspace\'s look from the first paint: the theme style is in the page', !!styleOf(dressed.text) && styleOf(dressed.text) === styleOf(classicDressed.text) && /--primary/.test(styleOf(dressed.text)));
  check('…and the early light/dark script, as in the classic page', dressed.text.includes('<script>' + T.bootScript(T.normalize(JSON.parse(db.tables.quotation_settings.find(r => r.key === 'workspace_profile').value)))) );
  check('…the workspace\'s name is in the title and in what the app is told', /<title data-ws-title="[^"]*">Acme Motors · Admin Dashboard<\/title>/.test(dressed.text) && mlOf(dressed.text).workspace.name === 'Acme Motors');
  check('…and its fonts are the ones chosen', dressed.text.includes(T.fontsHref(T.normalize(JSON.parse(db.tables.quotation_settings.find(r => r.key === 'workspace_profile').value)))));
  check('a workspace that has replaced no wording tells the app none', JSON.stringify(mlOf(dressed.text).workspace.texts) === '{}' && JSON.stringify(mlOf(next.text).workspace.texts) === '{}');
  await put('/api/dashboard/workspace/theme', { texts: { admin_title: 'Owners only', admin_sub: 'Welcome back, {ws}', team_title: 'Crew room' } });
  const worded = await page('/dashboard?ui=next');
  const wordedTeam = await page('/employee?ui=next');
  const wordsOf = t => mlOf(t).workspace.texts;
  check('the wording an admin replaced reaches the app, which draws its own text where the classic page\'s markers cannot be', wordsOf(worded.text).admin_title === 'Owners only' && wordsOf(worded.text).admin_sub === 'Welcome back, {ws}' && wordsOf(wordedTeam.text).team_title === 'Crew room', JSON.stringify(wordsOf(worded.text)));
  const classicWorded = await page('/legacy/dashboard');
  check('…and it is the wording the classic page shows (one source, so the two cannot say different things)', /data-ws-text="admin_title"[^>]*>Owners only</.test(classicWorded.text) && /data-ws-text="admin_sub"[^>]*>Welcome back, Acme Motors</.test(classicWorded.text));
  check('…{ws} is left for the app to fill in with the name it is told, so a rename needs no page rebuilt', mlOf(worded.text).workspace.name === 'Acme Motors' && !wordsOf(worded.text).admin_sub.includes('Acme'));
  check('?safe=1 is the original wording in the new app too', JSON.stringify(wordsOf((await page('/dashboard?ui=next&safe=1')).text)) === '{}');
  await put('/api/dashboard/workspace/theme', { texts: { admin_title: '</script><script>alert(1)</script>' } });
  const markup = await page('/dashboard?ui=next');
  check('wording with markup in it puts none into the page or into what the app is told', !markup.text.includes('</script><script>alert(1)') && !/[<>]/.test(wordsOf(markup.text).admin_title || ''), wordsOf(markup.text).admin_title);
  await put('/api/dashboard/workspace/theme', { texts: {} });
  const safe = await page('/dashboard?ui=next&safe=1');
  check('?safe=1 is the original look in the new app too (the way back in if a look ever makes the screen hard to use)', styleOf(safe.text) === styleOf((await page('/legacy/dashboard?safe=1')).text) && styleOf(safe.text) !== styleOf(dressed.text));
  await put('/api/dashboard/workspace', { name: '</title><script>alert(1)</script>' });
  const hostile = await page('/dashboard?ui=next');
  check('a hostile workspace name puts no markup into the page or into what the app is told', !hostile.text.includes('<script>alert(1)') && !hostile.text.includes('</title><script>') && mlOf(hostile.text).workspace.name === '</title><script>alert(1)</script>');
  await put('/api/dashboard/workspace', { name: 'MotoLinker' });
  await put('/api/dashboard/workspace/theme', { reset: true });

  // — the built files —
  const asset = await fetch(base + '/ui/assets/' + jsFile);
  check('the built files are served under /ui/ as JavaScript', asset.status === 200 && /javascript/.test(asset.headers.get('content-type') || ''));
  check('…cached for a year and marked immutable, which is safe because their names carry a hash of their content', /max-age=31536000/.test(asset.headers.get('cache-control') || '') && /immutable/.test(asset.headers.get('cache-control') || ''));
  check('…the unprocessed page is not one of them, nor a directory, nor a file that is not there, nor a way out of the folder',
    (await fetch(base + '/ui/index.html')).status === 404 && (await fetch(base + '/ui/')).status === 404 && (await fetch(base + '/ui/assets/nope.js')).status === 404 && (await fetch(base + '/ui/..%2f..%2fpackage.json')).status === 404);
  const gz = zlib.gzipSync(fs.readFileSync(path.join(dist, 'assets', jsFile))).length;
  check('the app\'s JavaScript stays inside its budget (250 kB gzipped)', gz <= 250 * 1024, `${(gz / 1024).toFixed(1)} kB`);
  check('…and does not carry zod, which the browser has no use for', !/ZodError|\$ZodType/.test(fs.readFileSync(path.join(dist, 'assets', jsFile), 'utf8')));

  // — it can never leave a page that does not open —
  fs.renameSync(path.join(dist, 'index.html'), path.join(dist, 'index.html.away'));
  const noBuild = await page('/dashboard?ui=next');
  check('with no build, a browser that asked for the new app gets the classic page, not an error', noBuild.status === 200 && isClassic(noBuild.text));
  fs.renameSync(path.join(dist, 'index.html.away'), path.join(dist, 'index.html'));
  fs.writeFileSync(path.join(dist, 'index.html'), builtPage.replace(BOOT_MARKER, ''));
  const noHook = await page('/dashboard?ui=next');
  check('with a template that has lost a hook, the classic page (and a warning), not a half-dressed new app', noHook.status === 200 && isClassic(noHook.text));
  fs.writeFileSync(path.join(dist, 'index.html'), builtPage);
  check('…and the new app is back the moment the build is', isSpa((await page('/dashboard?ui=next')).text));

  // — what did not change —
  const manifest = await fetch(base + '/manifest-dashboard.json');
  check('the install manifests are as they were', manifest.status === 200 && JSON.parse(await manifest.text()).start_url === '/dashboard');
  check('the classic pages still register their service worker at their own scope, and the new app registers none yet', /serviceWorker\.register\('\/sw-dashboard\.js'/.test(read('public', 'assets', 'dashboard.js')) && !/serviceWorker/.test(fs.readFileSync(path.join(dist, 'assets', jsFile), 'utf8')));

  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
