// The admin's Gmail viewer, opening an email written by an attacker.
//
// Everything in an inbound email is an outsider's text. The viewer used to draw the
// HTML body in an iframe with no sandbox — a srcdoc frame shares this page's origin,
// so the email's own script could read the admin's session out of localStorage the
// moment the message was opened — and it carried the subject and sender inside the
// Reply and Forward buttons' onclick text, where a quote in the subject closed the
// string and ran whatever followed. Both are asserted against the real dashboard in
// Chromium: nothing from the email runs, and Reply/Forward still fill the right
// fields.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const SUBJECT = "Invoice');window.__pwnedBySubject=1;('";
const EMAIL = {
  id: 'm1', threadId: 't1', labelIds: ['INBOX'], messageId: '<abc@evil.test>',
  subject: SUBJECT, from: 'Mallory <mallory@evil.test>', to: 'sales@motolinker.test', date: '2026-10-20T10:00:00Z',
  isHtml: true,
  body: '<html><body><p id="hello">Hello there</p>'
    + '<img src="x" onerror="parent.__pwnedByBody=1">'
    + '<script>parent.__pwnedByBody=2<\/script></body></html>',
};

function api(u) {
  if (/auth\/check$/.test(u.pathname)) return { ok: true };
  if (/email\/status$/.test(u.pathname)) return { configured: true, connected: true, email: 'sales@motolinker.test' };
  if (/email\/messages\/m1$/.test(u.pathname)) return EMAIL;
  if (/email\/messages$/.test(u.pathname)) return { messages: [] };
  if (/nav-config$/.test(u.pathname)) return { groups: [] };
  return [];
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: require('./helpers/browser').chromePath(),
    headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u)) });
    }
    if (u.pathname === '/dashboard') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/dashboard.html', 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('ml_admin_token', 'admin-token'));
  await page.goto(`http://127.0.0.1:${port}/dashboard`, { waitUntil: 'networkidle2' }).catch(() => {});
  await sleep(600);

  await page.evaluate(() => navigate('email'));
  await page.waitForSelector('#email-view-panel', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => openEmail('m1'));
  await page.waitForSelector('#email-view-panel iframe', { timeout: 5000 }).catch(() => {});
  await sleep(500);

  const frame = await page.evaluate(() => {
    const f = document.querySelector('#email-view-panel iframe');
    if (!f) return null;
    let hello = null;
    try { hello = f.contentDocument && f.contentDocument.getElementById('hello') && f.contentDocument.getElementById('hello').textContent; } catch (_) {}
    return { sandbox: f.getAttribute('sandbox'), hello, pwned: window.__pwnedByBody || null };
  });
  check('the email body is drawn', !!frame && frame.hello === 'Hello there', JSON.stringify(frame));
  check('in a sandboxed frame that may not run scripts',
    !!frame && frame.sandbox !== null && !/allow-scripts/.test(frame.sandbox), frame && String(frame.sandbox));
  check("the email's own script and onerror did not run in the dashboard", !!frame && !frame.pwned, frame && String(frame.pwned));

  // Reply: the subject must reach the reply form intact and never run.
  const clickButton = label => page.evaluate(l => {
    const b = [...document.querySelectorAll('#email-view-panel button')].find(x => x.textContent.trim() === l);
    if (b) b.click();
    return !!b;
  }, label);
  check('the Reply button is there', await clickButton('Reply'));
  await sleep(300);
  const reply = await page.evaluate(() => ({
    to: (document.getElementById('em-to') || {}).value, subject: (document.getElementById('em-subject') || {}).value,
    pwned: window.__pwnedBySubject || null,
  }));
  check("a quote in the subject did not run as code", !reply.pwned, String(reply.pwned));
  check('Reply addresses the sender and keeps the subject as text',
    reply.to === 'mallory@evil.test' && reply.subject === 'Re: ' + SUBJECT, JSON.stringify(reply));
  await page.evaluate(() => typeof hideModal === 'function' && hideModal());

  check('the Forward button is there', await clickButton('Forward'));
  await sleep(300);
  const fwd = await page.evaluate(() => ({ to: (document.getElementById('em-to') || {}).value, pwned: window.__pwnedBySubject || null }));
  check('Forward still fills the address it always did', fwd.to === 'mallory@evil.test' && !fwd.pwned, JSON.stringify(fwd));

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} email viewer checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
