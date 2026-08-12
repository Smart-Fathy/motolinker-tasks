// Links in chat: linkifying without opening an XSS hole, and previewing without
// turning the server into a proxy for the private network.
//
// The SSRF assertions are the point. This process can reach 127.0.0.1 and the cloud
// metadata service; the browser that pasted the link cannot. Anything that lets a
// pasted URL reach those is a hole, so each case is asserted against the real guard
// rather than a description of it.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3989';

const http = require('http');
const fs = require('fs');
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// ── The linkifier, run as the browser runs it ────────────────────────────────
// Sliced out of the real shared file rather than reimplemented here.
const SRC = fs.readFileSync('public/assets/chat-extras.js', 'utf8');
const sandbox = { window: {}, document: { createElement: () => ({}) }, console };
new Function('window', 'document', SRC + '\nwindow.__x = { chatLinkify, chatLinkUrls, chatEsc, chatPreviewSlot, chatNameForBlob: typeof chatNameForBlob === "function" ? chatNameForBlob : null };')
  (sandbox.window, sandbox.document);
const { chatLinkify, chatPreviewSlot, chatNameForBlob } = sandbox.window.__x;

(async () => {
  // ── Linkify ──
  {
    const out = chatLinkify('see https://example.com/a for details');
    check('a bare url becomes a link',
      /<a href="https:\/\/example\.com\/a" target="_blank" rel="noopener noreferrer"/.test(out), out);
    check('the surrounding words survive', /see .*for details/.test(out.replace(/<[^>]+>/g, '')), out);
  }
  {
    const out = chatLinkify('<script>alert(1)</script>');
    check('markup in a message is escaped, not executed',
      !/<script>/.test(out) && /&lt;script&gt;/.test(out), out);
  }
  {
    // The dangerous shape: a quote inside the URL could close the href attribute.
    const out = chatLinkify('http://x.com/"onmouseover="alert(1)');
    check('a quote cannot break out of the href attribute', !/href="[^"]*"[^>]*onmouseover/.test(out), out);
    check("a single quote is escaped too", !/'/.test(out) || /&#39;/.test(out), out);
  }
  {
    const out = chatLinkify("it's at https://x.com/a, then home");
    check('trailing punctuation stays out of the link',
      /href="https:\/\/x\.com\/a"/.test(out) && !/href="[^"]*,"/.test(out), out);
    check('an apostrophe in the text is escaped', /&#39;/.test(out), out);
  }
  {
    const out = chatLinkify('javascript:alert(1) and vbscript:x');
    check('a javascript: url is not turned into a link', !/<a /.test(out), out);
  }
  check('no link means no preview slot', chatPreviewSlot('just talking') === '');
  check('a google link is left to the existing unfurl',
    chatPreviewSlot('https://docs.google.com/document/d/abc') === '',
    chatPreviewSlot('https://docs.google.com/document/d/abc'));
  check('an ordinary link asks for a preview',
    /data-preview-for=/.test(chatPreviewSlot('https://example.com/a')));
  check('a pasted blob is given a real filename',
    /^screenshot-\d{14}\.png$/.test(chatNameForBlob({ type: 'image/png' })),
    chatNameForBlob({ type: 'image/png' }));
  check('a jpeg paste gets a jpg extension, not "jpeg"',
    /\.jpg$/.test(chatNameForBlob({ type: 'image/jpeg' })), chatNameForBlob({ type: 'image/jpeg' }));

  // ── The guard, called directly ──
  require(process.cwd() + '/index.js');
  const { isPrivateAddress, assertPublic, safeFetchHtml } =
    require(process.cwd() + '/src/routes/link-preview.js');

  const PRIVATE = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.1',
                   '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1',
                   '::ffff:127.0.0.1'];
  const PUBLIC = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '11.0.0.1', '2606:4700::1111'];
  check('every private address is refused',
    PRIVATE.every(isPrivateAddress), PRIVATE.filter(a => !isPrivateAddress(a)).join(', '));
  check('public addresses are allowed',
    PUBLIC.every(a => !isPrivateAddress(a)), PUBLIC.filter(isPrivateAddress).join(', '));
  check('the metadata service is refused', isPrivateAddress('169.254.169.254'));
  check('nonsense is refused rather than guessed', isPrivateAddress('not-an-ip'));

  let rejected = false;
  try { await assertPublic('127.0.0.1'); } catch (_) { rejected = true; }
  check('assertPublic refuses loopback', rejected);
  rejected = false;
  try { await assertPublic('localhost'); } catch (_) { rejected = true; }
  check('assertPublic refuses a name that resolves to loopback', rejected);

  // ── End to end, through the route ──
  const base = 'http://127.0.0.1:' + process.env.PORT;
  // Wait for the app to bind rather than guessing at a sleep.
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/push/vapid-public-key'); break; }
    catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  const preview = async url => (await fetch(base + '/api/dashboard/link-preview', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }) })).json();

  // A local server standing in for "somewhere the browser could not reach".
  let hits = 0;
  const secret = http.createServer((_q, s) => { hits++; s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<title>internal</title>'); });
  await new Promise(r => secret.listen(0, '127.0.0.1', r));
  const secretPort = secret.address().port;

  const direct = await preview(`http://127.0.0.1:${secretPort}/`);
  check('a link to the private network is refused', !direct.title && !!direct.error, JSON.stringify(direct));
  check('and the private server was never contacted', hits === 0, `hits=${hits}`);

  const meta = await preview('http://169.254.169.254/latest/meta-data/');
  check('the cloud metadata service is refused', !meta.title && !!meta.error, JSON.stringify(meta));

  // A redirect from a public URL to a private one must be caught at the hop, not just
  // at the start. Testing that needs a first hop that genuinely looks public, so the
  // name resolution and the first response are both stubbed — pointing a real public
  // hostname at loopback is the one thing this box cannot arrange for itself.
  {
    const dnsp = require('dns').promises;
    const realLookup = dnsp.lookup, realFetch = global.fetch;
    dnsp.lookup = async (host, opts) =>
      host === 'public.example' ? [{ address: '93.184.216.34', family: 4 }] : realLookup(host, opts);
    global.fetch = async (u, o) => {
      if (String(u).startsWith('http://public.example/')) {
        return new Response('', { status: 302, headers: { Location: `http://127.0.0.1:${secretPort}/` } });
      }
      return realFetch(u, o);
    };
    let msg = '';
    try { await safeFetchHtml('http://public.example/'); }
    catch (e) { msg = e.message; }
    dnsp.lookup = realLookup; global.fetch = realFetch;
    check('a public link redirecting to the private network is refused at the hop',
      /not reachable/.test(msg), msg || '(no error thrown)');
    check('and the private server behind that redirect was never contacted', hits === 0, `hits=${hits}`);
  }

  const bad = await preview('file:///etc/passwd');
  check('a non-http scheme is refused', !!bad.error, JSON.stringify(bad));

  secret.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} link checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
