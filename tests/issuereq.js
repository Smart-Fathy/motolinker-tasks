// The team portal's Requests screen and the Issues centre, driven end to end.
//
// Requests was never in any redesign tranche: it was still the original form of
// three <select>s while the design asks a question and offers chips. Issues was
// a 760px column with a dropdown filter, no way to reply to a ticket, and no way
// for the person who reported one to ever hear that it was closed.
//
// Two halves, in one file because they are one change:
//   server — resolving an issue notifies whoever reported it, and the ticket has
//            a conversation both ends can read.
//   UI     — the chips are real controls that write real values, and the Issues
//            centre uses the whole screen and can hold a conversation.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3994';

const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// ── Half one: the server ─────────────────────────────────────────────────────
const ISSUE = { id: 5, title: 'Barcode scanner is dead', description: 'It beeps twice and stops.',
  file_url: '', reporter_id: 11, reporter_name: 'Mahmoud Adel', status: 'open',
  created_at: '2026-08-20T08:00:00Z' };
const notified = [];      // every row written to notifications
const comments = [];      // every row written to issue_comments
let patched = null;       // the update body sent to issues

const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const method = ((init && init.method) || 'GET').toUpperCase();
  const body = init && init.body ? JSON.parse(init.body) : null;
  const json = v => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const one = accept.includes('pgrst.object');

  if (url.includes('/rest/v1/issues?')) {
    // The stub is a row, not a mock: a PATCH sticks, so the next read sees the
    // ticket in the state the handler just left it in.
    if (method === 'PATCH') { patched = body; Object.assign(ISSUE, body); return json(one ? { ...ISSUE } : [{ ...ISSUE }]); }
    return json(one ? ISSUE : [ISSUE]);
  }
  if (url.includes('/rest/v1/issue_comments')) {
    if (method === 'POST') { const row = { id: comments.length + 1, ...body, created_at: '2026-08-27T10:00:00Z' }; comments.push(row); return json(one ? row : [row]); }
    return json(comments);
  }
  if (url.includes('/rest/v1/notifications') && method === 'POST') {
    notified.push(body); return json(one ? { id: notified.length, ...body } : [{ id: notified.length, ...body }]);
  }
  return json(one ? {} : []);
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
const base = 'http://127.0.0.1:' + process.env.PORT;

function mint(token, id, name, job_title, permissions) {
  ctx.employeeSessions.set(token, { id, name, username: name.toLowerCase(), job_title, permissions: normEmpPerms(permissions || {}) });
  return token;
}
const hit = (method, p, token, body) => fetch(base + p, {
  method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.text() }));

(async () => {
  await sleep(600);
  const cto      = mint('iss-cto', 3, 'Karim', 'Chief Technical Officer');
  const reporter = mint('iss-rep', 11, 'Mahmoud', 'Logistics Lead');
  const other    = mint('iss-oth', 12, 'Nour', 'Sales');

  // Resolving tells the reporter. Nobody was told anything before this change.
  notified.length = 0;
  const put = await hit('PUT', '/api/employee/issues/5', cto, { status: 'resolved' });
  await sleep(250);
  check('the CTO can resolve an issue', put.status === 200, put.body.slice(0, 90));
  check('…and it records who closed it and when',
    !!(patched && patched.status === 'resolved' && patched.resolved_by === 'Karim' && patched.resolved_at),
    JSON.stringify(patched));
  const solved = notified.find(n => n.member_key === 'employee_11' && /Solved/i.test(n.title || ''));
  check('…and the person who reported it is told it is solved', !!solved,
    JSON.stringify(notified.map(n => n.member_key + ':' + n.title)));
  check('…with a body that names who closed it', !!(solved && /Karim/.test(solved.body || '')), solved && solved.body);

  // Resolving a ticket that was already resolved must not re-notify.
  notified.length = 0;
  await hit('PUT', '/api/employee/issues/5', cto, { status: 'resolved' });
  await sleep(200);
  check('…once, not on every save of an already-closed ticket',
    !notified.some(n => /Solved/i.test(n.title || '')), JSON.stringify(notified.map(n => n.title)));

  // The conversation.
  comments.length = 0; notified.length = 0;
  const post = await hit('POST', '/api/employee/issues/5/comments', cto, { body: 'Swapped the cable — try it now.' });
  await sleep(250);
  check('the CTO can comment on an issue', post.status === 200 && comments.length === 1, post.body.slice(0, 90));
  check('…stored against that issue with the author named',
    comments[0]?.issue_id === 5 && comments[0]?.author_key === 'employee_3' && comments[0]?.author_name === 'Karim',
    JSON.stringify(comments[0]));
  check('…and the reporter hears about the reply',
    notified.some(n => n.member_key === 'employee_11' && /commented/i.test(n.title || '')),
    JSON.stringify(notified.map(n => n.member_key + ':' + n.title)));

  const empty = await hit('POST', '/api/employee/issues/5/comments', cto, { body: '   ' });
  check('…and an empty comment is refused', empty.status === 400, empty.body.slice(0, 60));

  // Who may read the thread. The reporter is not a CTO and has no issues.view.
  const rRead = await hit('GET', '/api/employee/issues/5/comments', reporter);
  check('the reporter can read the replies on their own ticket', rRead.status === 200, rRead.body.slice(0, 60));
  const rPost = await hit('POST', '/api/employee/issues/5/comments', reporter, { body: 'Still dead.' });
  check('…and answer back', rPost.status === 200, rPost.body.slice(0, 60));
  const oRead = await hit('GET', '/api/employee/issues/5/comments', other);
  check('…while an unrelated colleague is turned away', oRead.status === 403, oRead.body.slice(0, 60));
  const oPut = await hit('PUT', '/api/employee/issues/5', reporter, { status: 'resolved' });
  check('…and cannot close their own ticket either', oPut.status === 403, oPut.body.slice(0, 60));

  // ── Half two: the two screens ──────────────────────────────────────────────
  const REQS = [
    { id: 7, title: 'Second monitor for the port desk', description: 'The 24" one.', category: 'Equipment',
      priority: 'medium', status: 'pending', created_by: 'mahmoud', assignee_id: null, created_at: '2026-08-18T09:00:00Z' },
    { id: 8, title: 'Annual leave — 2 to 6 September', description: '', category: 'Leave',
      priority: 'high', status: 'approved', created_by: 'mahmoud', assignee_id: null, created_at: '2026-08-15T09:00:00Z' },
    { id: 9, title: 'Customs clearance course', description: '', category: 'Training',
      priority: 'low', status: 'pending', created_by: 'mahmoud', assignee_id: 4, created_at: '2026-08-12T09:00:00Z' },
  ];
  const ISSUES = [
    { ...ISSUE, id: 5, status: 'open' },
    { id: 6, title: 'Sheet export times out', description: 'Only on the big report.', file_url: 'https://x.test/a.png',
      reporter_id: 12, reporter_name: 'Nour Sami', status: 'resolved', resolved_by: 'Karim',
      resolved_at: '2026-08-22T12:00:00Z', created_at: '2026-08-19T08:00:00Z' },
  ];
  const CO = [{ id: 4, name: 'Karim Zaki', username: 'karim' }, { id: 12, name: 'Nourhan Fathy', username: 'nourhan' }];
  const PERMS = { requests: true, requestsActions: { view: true, create: true, comment: true },
    tasks: true, hours: true, issues: true, issuesActions: { view: true, resolve: true } };

  const posted = [];
  function api(p, method, reqBody) {
    if (/employee\/check$/.test(p)) return { ok: true, id: 11, name: 'Mahmoud Adel', username: 'mahmoud', job_title: 'Logistics Lead', permissions: PERMS };
    if (/issues\/\d+\/comments$/.test(p)) {
      if (method === 'POST') { posted.push({ p, body: reqBody }); return { id: 1, author_name: 'Mahmoud Adel', body: JSON.parse(reqBody || '{}').body, created_at: '2026-08-27T10:00:00Z' }; }
      return [{ id: 1, author_name: 'Karim Zaki', body: 'Swapped the cable.', created_at: '2026-08-26T10:00:00Z' }];
    }
    if (/employee\/issues$/.test(p)) return ISSUES;
    if (/requests\/\d+\/comments$/.test(p)) return [];
    if (/employee\/requests$/.test(p)) { if (method === 'POST') { posted.push({ p, body: reqBody }); return { id: 10 }; } return REQS; }
    if (/coworkers/.test(p)) return CO;
    if (/nav-config$/.test(p)) return { groups: [] };
    if (/nav-favourites$/.test(p)) return { favourites: [] };
    if (/stats$/.test(p)) return { total: 0, done: 0, inProgress: 0, todo: 0, overdue: 0, highPriority: 0, byStatus: {}, byPriority: {} };
    if (/home\/layout$/.test(p)) return { widgets: [] };
    if (/columns/.test(p)) return { columns: [] };
    return [];
  }

  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });

  async function open(width) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width < 500 ? 844 : 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};window.Chart=function(){this.destroy=function(){}};window.Chart.register=function(){};' });
      if (u.pathname.startsWith('/api/')) {
        if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
      }
      if (u.pathname === '/employee') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/employee.html', 'utf8') });
      const f = path.join('public', u.pathname.replace(/^\//, ''));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
        return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
      }
      req.respond({ status: 404, body: '' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ml_emp_token', 't'));
    await page.goto(`http://127.0.0.1:${port}/employee`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    return { page, errs };
  }

  // ── Requests ───────────────────────────────────────────────────────────────
  {
    const { page, errs } = await open(1280);
    await page.evaluate(() => navigate('requests'));
    await sleep(900);

    const form = await page.evaluate(() => {
      const p = document.getElementById('page-requests');
      return {
        selects: p.querySelectorAll('select').length,
        cats: [...p.querySelectorAll('#req-cat-chips .rq-chip')].map(b => b.textContent.trim()),
        pris: [...p.querySelectorAll('.t-seg[data-group="req-priority"]')].map(b => b.textContent.trim()),
        tos: [...p.querySelectorAll('#req-to-chips .rq-chip')].map(b => b.textContent.trim()),
        ask: p.querySelector('#req-title')?.placeholder || '',
        sub: document.getElementById('req-sub')?.textContent || '',
        hint: document.getElementById('req-hint')?.textContent || '',
        submit: document.getElementById('req-submit-btn')?.textContent.trim() || '',
      };
    });
    check('Requests has no dropdowns left — the design uses chips', form.selects === 0, 'selects=' + form.selects);
    check('…seven category chips, in the design order',
      form.cats.join('|') === 'Equipment|IT Support|HR|Finance|Leave|Training|Other', form.cats.join('|'));
    check('…priority is the three-way segmented control',
      form.pris.join('|') === 'High|Medium|Low', form.pris.join('|'));
    check('…Send to is Admin plus the roster, as chips',
      form.tos.join('|') === 'Admin|Karim Zaki|Nourhan Fathy', form.tos.join('|'));
    check('…the title field asks the question', form.ask === 'What do you need?', form.ask);
    check('…the subtitle counts what is waiting', form.sub === '2 awaiting a decision', form.sub);
    check('…and the helper line names who it goes to',
      form.hint === 'Goes to whoever is on approvals today.', form.hint);
    check('…the button reads as the design writes it', form.submit === 'Submit request', form.submit);

    const badge = await page.evaluate(() => document.querySelector('#nav-requests .chat-nav-badge')?.textContent || '');
    check('Requests carries its count in the rail', badge === '2', badge);

    // The chips have to be controls, not decoration.
    const picked = await page.evaluate(() => {
      reqPickCat('Leave'); reqPickPri('high'); reqPickTo('4', 'Karim Zaki');
      const onOf = sel => [...document.querySelectorAll(sel)].filter(b => b.classList.contains('on')).map(b => b.dataset.value);
      return {
        cat: document.getElementById('req-category').value,
        pri: document.getElementById('req-priority').value,
        to:  document.getElementById('req-assignee').value,
        catOn: onOf('#req-cat-chips .rq-chip'),
        priOn: onOf('.t-seg[data-group="req-priority"]'),
        toOn:  onOf('#req-to-chips .rq-chip'),
        hint: document.getElementById('req-hint').textContent,
      };
    });
    check('picking a category writes the value and lights exactly that chip',
      picked.cat === 'Leave' && picked.catOn.join() === 'Leave', JSON.stringify(picked.catOn));
    check('picking a priority writes the value and lights exactly that segment',
      picked.pri === 'high' && picked.priOn.join() === 'high', JSON.stringify(picked.priOn));
    check('picking a recipient writes the id and lights exactly that chip',
      picked.to === '4' && picked.toOn.join() === '4', JSON.stringify(picked.toOn));
    check('…and the helper line follows the recipient',
      picked.hint === 'Goes straight to Karim Zaki.', picked.hint);

    // …and the values the chips hold have to reach the server.
    posted.length = 0;
    await page.evaluate(() => { document.getElementById('req-title').value = 'Forklift service'; submitRequest(); });
    await sleep(700);
    const sent = posted.find(x => /employee\/requests$/.test(x.p));
    const sentBody = sent ? JSON.parse(sent.body) : {};
    check('submitting posts what the chips were showing',
      sentBody.title === 'Forklift service' && sentBody.category === 'Leave' &&
      sentBody.priority === 'high' && sentBody.assignee_id === '4', JSON.stringify(sentBody));
    const reset = await page.evaluate(() => ({
      cat: document.getElementById('req-category').value,
      pri: document.getElementById('req-priority').value,
      to:  document.getElementById('req-assignee').value,
    }));
    check('…and the form goes back to its defaults',
      reset.cat === 'Equipment' && reset.pri === 'medium' && reset.to === '', JSON.stringify(reset));

    // My requests is a list of cards now, and each one opens its conversation.
    const cards = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#my-requests-list .rq-item')];
      return {
        n: items.length,
        tables: document.querySelectorAll('#my-requests-list table').length,
        meta: items[0]?.querySelector('.rq-item-meta')?.textContent || '',
        pills: [...(items[0]?.querySelectorAll('.rq-pill') || [])].map(p => p.textContent.trim()),
        striped: items.every(i => !!i.querySelector('.rq-stripe')),
      };
    });
    check('My requests renders cards, not a table', cards.n === 3 && cards.tables === 0, JSON.stringify(cards));
    check('…each with the design\'s meta line', cards.meta === 'Equipment · 18 Aug 2026 · to Admin', cards.meta);
    check('…priority and status as pills', cards.pills.join('|') === 'Medium|Pending', cards.pills.join('|'));
    check('…and a status rail down the left', cards.striped === true);

    await page.evaluate(() => document.querySelector('#my-requests-list .rq-item').click());
    await sleep(500);
    const opened = await page.evaluate(() => {
      const m = document.getElementById('emp-comments-modal');
      return { open: !!m && getComputedStyle(m).display !== 'none',
        desc: document.getElementById('empc-desc')?.innerText || '' };
    });
    check('…clicking a card still opens the conversation the design did not draw',
      opened.open && /24"/.test(opened.desc), JSON.stringify(opened).slice(0, 90));
    check('no page errors on Requests', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── Issues ─────────────────────────────────────────────────────────────────
  {
    const { page, errs } = await open(1280);
    await page.evaluate(() => navigate('issues'));
    await sleep(900);

    const shape = await page.evaluate(() => {
      const p = document.getElementById('page-issues');
      const inner = p.querySelector('.iss-split');
      return {
        selects: p.querySelectorAll('select').length,
        capped: [...p.querySelectorAll('*')].some(e => /760px/.test(e.getAttribute('style') || '')),
        width: inner ? Math.round(inner.getBoundingClientRect().width) : 0,
        page: Math.round(p.getBoundingClientRect().width),
        chips: [...p.querySelectorAll('#issues-filter .rq-chip')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
        cards: p.querySelectorAll('#issues-list .iss-card').length,
        sub: document.getElementById('iss-sub')?.textContent || '',
      };
    });
    check('the Issues centre is not a 760px column any more', shape.capped === false);
    check('…it uses the width of the page', shape.width > shape.page * 0.9, `${shape.width} of ${shape.page}`);
    check('…the filter is chips with counts, not a dropdown',
      shape.selects === 0 && shape.chips.join('|') === 'All 2|Open 1|Resolved 1', shape.chips.join('|'));
    check('…the subtitle counts what is still open', shape.sub === '1 still open', shape.sub);
    check('…and both tickets are listed', shape.cards === 2, String(shape.cards));

    await page.evaluate(() => issSetFilter('resolved'));
    await sleep(300);
    const filtered = await page.evaluate(() => ({
      n: document.querySelectorAll('#issues-list .iss-card').length,
      title: document.querySelector('#issues-list .iss-card-title')?.textContent || '',
    }));
    check('a filter chip filters the queue', filtered.n === 1 && /Sheet export/.test(filtered.title), JSON.stringify(filtered));
    await page.evaluate(() => issSetFilter(''));
    await sleep(250);

    await page.evaluate(() => issOpen(5));
    await sleep(600);
    const detail = await page.evaluate(() => {
      const d = document.getElementById('iss-detail');
      return {
        title: d.querySelector('.iss-d-title')?.textContent || '',
        body: d.querySelector('.iss-d-body')?.textContent || '',
        reporter: d.querySelector('.iss-d-by')?.innerText.replace(/\s+/g, ' ') || '',
        thread: [...d.querySelectorAll('.iss-msg-body')].map(m => m.textContent),
        reply: !!d.querySelector('#iss-reply-input'),
        resolve: [...d.querySelectorAll('button')].map(b => b.textContent.trim()),
        selected: !!document.querySelector('#issues-list .iss-card.sel'),
      };
    });
    check('opening a ticket shows it in the reading pane',
      /Barcode scanner/.test(detail.title) && /beeps twice/.test(detail.body), JSON.stringify(detail).slice(0, 110));
    check('…naming who reported it', /Mahmoud Adel/.test(detail.reporter), detail.reporter);
    check('…and marks it as the one being read', detail.selected === true);
    check('…the conversation on it is loaded', detail.thread.join() === 'Swapped the cable.', JSON.stringify(detail.thread));
    check('…with a box to reply in and a way to close it',
      detail.reply && detail.resolve.includes('Send') && detail.resolve.includes('Mark solved'), JSON.stringify(detail.resolve));

    posted.length = 0;
    await page.evaluate(() => { document.getElementById('iss-reply-input').value = 'Try the spare.'; issPostComment(5); });
    await sleep(700);
    const reply = posted.find(x => /issues\/5\/comments$/.test(x.p));
    check('the reply posts to that issue', !!reply && JSON.parse(reply.body).body === 'Try the spare.',
      reply ? reply.body : 'nothing posted');

    await page.evaluate(() => issOpen(6));
    await sleep(600);
    const closed = await page.evaluate(() => document.getElementById('iss-detail').innerText.replace(/\s+/g, ' '));
    check('a closed ticket says who closed it', /Solved by Karim/.test(closed), closed.slice(0, 90));
    check('no page errors on Issues', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── The phone ──────────────────────────────────────────────────────────────
  {
    const { page } = await open(390);
    for (const [name, id] of [['requests', 'my-requests-list'], ['issues', 'issues-list']]) {
      await page.evaluate(p => navigate(p), name);
      await sleep(900);
      const over = await page.evaluate(host => ({
        body: document.documentElement.scrollWidth > window.innerWidth + 1,
        stacked: (() => { const s = document.querySelector('.iss-split'); return s ? getComputedStyle(s).gridTemplateColumns.split(' ').length === 1 : true; })(),
        rows: document.getElementById(host)?.children.length || 0,
      }), id);
      check(`${name} does not scroll sideways at 390px`, over.body === false);
      check(`${name} still has its rows at 390px`, over.rows > 0, String(over.rows));
      if (name === 'issues') check('…and the reading pane stacks under the queue', over.stacked === true);
    }
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
