// The Issues centre on the server: tickets the team reports to the Chief Technical Officer, read and closed by the people who
// manage them, and the conversation on each — on the team portal's routes and on /api/v1.
//
// The team portal's routes lived in index.js, written for the one portal that had a page for them; this holds what they do —
// which rows, for whom, who is told what, what a failing database answers — so that moving that code into
// src/modules/issues and putting /api/v1/issues beside it (which the admin can use as well) changes nothing for the classic
// page, and so that the new routes are held to the same facts plus the ones the classic ones never had to be: strict about
// what they are sent, honest about what went wrong, and open to the admin.
// (tests/issuereq.js drives the classic page itself end to end; this is the server underneath it.)
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const BASE_TIME = Date.parse('2026-10-01T09:00:00Z');
  const at = i => new Date(BASE_TIME + i * 60000).toISOString();
  const employee = (id, name, title = 'Sales') => ({ id, name, username: name.toLowerCase(), email: '', password_hash: 'x', job_title: title, permissions: {}, avatar_url: '', status_text: '', status_emoji: '' });
  const everyone = [
    employee(71, 'Ana'),                                         // reports tickets
    employee(72, 'Cleo', 'Chief Technical Officer'),              // manages them by title
    employee(73, 'Dan', 'Support'),                              // manages them by permission
    employee(74, 'Eli', 'Support'),                              // may read them, not close them
    employee(75, 'Fay', 'Ops'),                                  // reports one too, can do nothing else
    employee(76, 'Gus', 'Deputy Chief Technical Officer'),        // a second CTO (the title is matched, not equalled)
  ];
  const employees = everyone.slice();   // the database's table is this array; `everyone` stays whole
  const raw = {
    71: {}, 72: {}, 75: {}, 76: {},
    73: { issues: true, issuesActions: { view: true, resolve: true } },
    74: { issues: true, issuesActions: { view: true } },
  };
  const seedIssues = () => [
    { id: 1, title: 'Barcode scanner is dead', description: 'It beeps twice and stops.', file_url: '', reporter_id: 71, reporter_name: 'Ana', status: 'open', created_at: at(1), resolved_at: null, resolved_by: '' },
    { id: 2, title: 'Sheet export', description: '', file_url: 'https://files.example/x.png', reporter_id: 71, reporter_name: 'Ana', status: 'resolved', created_at: at(2), resolved_at: at(5), resolved_by: 'Cleo' },
    { id: 3, title: '', description: 'No title here.', file_url: '', reporter_id: 75, reporter_name: 'Fay', status: 'open', created_at: at(3), resolved_at: null, resolved_by: '' },
  ];
  const seedComments = () => [
    { id: 1, issue_id: 1, author_key: 'employee_72', author_name: 'Cleo', body: 'Swap the cable.', file_url: '', file_name: '', file_size: null, file_type: '', created_at: at(10) },
    { id: 2, issue_id: 1, author_key: 'employee_71', author_name: 'Ana', body: 'Done, still dead.', file_url: '', file_name: '', file_size: null, file_type: '', created_at: at(11) },
    { id: 3, issue_id: 2, author_key: 'employee_72', author_name: 'Cleo', body: 'Fixed in the next release.', file_url: '', file_name: '', file_size: null, file_type: '', created_at: at(12) },
  ];
  const db = createFakeSupabase(
    { employees, sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [], presence: [], issues: seedIssues(), issue_comments: seedComments() },
    { serial: { issues: 100, issue_comments: 100 }, defaults: { notifications: () => ({ read: false }), issues: () => ({ status: 'open', file_url: '', description: '', resolved_at: null, resolved_by: '' }), issue_comments: () => ({ file_url: '', file_name: '', file_type: '', file_size: null }) } },
  );
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3961 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const reset = () => {
    db.tables.issues.splice(0, db.tables.issues.length, ...seedIssues());
    db.tables.issue_comments.splice(0, db.tables.issue_comments.length, ...seedComments());
    db.tables.notifications.splice(0);
    db.storage.clear();
    db.log.length = 0; db.failing.clear();
  };

  ctx.sessions.set('is-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const TOKEN = { 71: 'is-ana', 72: 'is-cleo', 73: 'is-dan', 74: 'is-eli', 75: 'is-fay', 76: 'is-gus' };
  for (const e of everyone) {
    ctx.employeeSessions.set(TOKEN[e.id], { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms(raw[e.id]), createdAt: Date.now() });
  }
  const call = async (method, path, token, body) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method, headers, body: payload });
    let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };
  const issueRow = id => db.tables.issues.find(i => i.id === id);
  const queries = (method, table) => db.log.filter(l => l.method === method && l.table === table).map(l => l.query);
  // what the server tells people after it has answered: wait for it to have finished telling
  const told = async (n, ms = 1500) => { const t0 = Date.now(); while (db.tables.notifications.length < n && Date.now() - t0 < ms) await sleep(20); await sleep(60); return db.tables.notifications.slice(); };
  const form = (fields, file) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (file) f.append('file', new Blob([file.bytes], { type: file.type }), file.name); return f; };

  const CLASSIC = '/api/employee';

  // ═══ 1. The classic routes: what they do today ═══════════════════════════════════════════════
  // ── reading the centre ──
  {
    const cleo = await call('GET', `${CLASSIC}/issues`, TOKEN[72]);
    check('a CTO (by title alone) reads the tickets, newest first', cleo.status === 200 && JSON.stringify(cleo.body.map(i => i.id)) === '[3,2,1]', JSON.stringify(cleo.body && cleo.body.map(i => i.id)));
    check('…asked of the database as: everything, newest first, two hundred at most', queries('GET', 'issues')[0] === '?select=*&order=created_at.desc&limit=200', queries('GET', 'issues')[0]);
    check('…the rows as they are stored', cleo.body[2].title === 'Barcode scanner is dead' && cleo.body[2].reporter_name === 'Ana' && cleo.body[2].status === 'open' && cleo.body[1].resolved_by === 'Cleo' && cleo.body[1].file_url === 'https://files.example/x.png');
    const dan = await call('GET', `${CLASSIC}/issues`, TOKEN[73]), eli = await call('GET', `${CLASSIC}/issues`, TOKEN[74]);
    check('a team member granted the section can read them too', dan.status === 200 && eli.status === 200 && dan.body.length === 3);
    const ana = await call('GET', `${CLASSIC}/issues`, TOKEN[71]), fay = await call('GET', `${CLASSIC}/issues`, TOKEN[75]);
    check('anyone else — even the person who reported one — is refused the list', ana.status === 403 && ana.body.error === 'Not permitted' && fay.status === 403);
    const wrong = [];
    for (const [label, token] of [['nobody', null], ['a token nobody issued', 'is-nobody'], ['the admin\'s login', 'is-admin']]) {
      for (const [method, path, body] of [['GET', `${CLASSIC}/issues`], ['PUT', `${CLASSIC}/issues/1`, { status: 'resolved' }], ['GET', `${CLASSIC}/issues/1/comments`], ['POST', `${CLASSIC}/issues/1/comments`, { body: 'x' }], ['POST', `${CLASSIC}/report-issue`, form({ title: 'x' })]]) {
        const got = (await call(method, path, token, body)).status;
        if (got !== 401) wrong.push(`${method} ${path} as ${label}: ${got}`);
      }
    }
    check('nobody, a token nobody issued, and the admin\'s login (the routes are the team portal\'s) are 401 everywhere', wrong.length === 0, wrong.join('; '));
    db.failing.add('issues');
    const down = await call('GET', `${CLASSIC}/issues`, TOKEN[72]);
    check('a database that cannot be asked is a 500 carrying its own words', down.status === 500 && /simulated database failure/.test(down.body.error), JSON.stringify(down));
    db.failing.clear();
  }

  // ── closing and reopening ──
  reset();
  {
    const put = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[72], { status: 'resolved' });
    check('a CTO closes a ticket: the row comes back resolved, with who closed it and when', put.status === 200 && put.body.status === 'resolved' && put.body.resolved_by === 'Cleo' && /^\d{4}-\d\d-\d\dT/.test(put.body.resolved_at || ''), JSON.stringify(put.body));
    check('…and that is what is stored', issueRow(1).status === 'resolved' && issueRow(1).resolved_by === 'Cleo' && issueRow(1).resolved_at === put.body.resolved_at);
    check('…read first, then written once, by id', queries('GET', 'issues').join() === '?select=*&id=eq.1' && queries('PATCH', 'issues').join() === '?id=eq.1&select=*', `${queries('GET', 'issues').join()} | ${queries('PATCH', 'issues').join()}`);
    const sent = await told(1);
    check('…and whoever reported it is told, by name, once', sent.length === 1 && sent[0].member_key === 'employee_71' && sent[0].type === 'issue' && sent[0].title === 'Solved: Barcode scanner is dead' && sent[0].body === 'Cleo marked the issue you reported as solved.' && sent[0].url === '/employee#issues', JSON.stringify(sent));

    const again = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[72], { status: 'resolved' });
    await sleep(200);
    check('closing what is already closed changes nothing and tells nobody again', again.status === 200 && db.tables.notifications.length === 1);

    const reopen = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[72], { status: 'open' });
    check('reopening clears who closed it and when', reopen.status === 200 && reopen.body.status === 'open' && reopen.body.resolved_at === null && reopen.body.resolved_by === '');
    const odd = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[72], { status: 'banana' });
    check('anything that is not "resolved" is "open"', odd.status === 200 && odd.body.status === 'open');
    const none = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[72]);
    check('…so is no body at all', none.status === 200 && none.body.status === 'open');

    const dan = await call('PUT', `${CLASSIC}/issues/3`, TOKEN[73], { status: 'resolved' });
    check('a team member granted "resolve" can close one too, and is named as who did', dan.status === 200 && dan.body.resolved_by === 'Dan');
    const eli = await call('PUT', `${CLASSIC}/issues/3`, TOKEN[74], { status: 'open' });
    check('one granted only "view" cannot', eli.status === 403 && eli.body.error === 'Not permitted' && issueRow(3).status === 'resolved');
    const ana = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[71], { status: 'resolved' });
    check('…and the person who reported it cannot close their own ticket', ana.status === 403 && issueRow(1).status === 'open');
    const missing = await call('PUT', `${CLASSIC}/issues/999`, TOKEN[72], { status: 'resolved' });
    check('a ticket that is not there is a 500 carrying the database\'s words (the classic page shows them)', missing.status === 500 && /rows returned/.test(missing.body.error), JSON.stringify(missing));
  }

  // ── closing a ticket whose reporter has gone ──
  reset();
  {
    issueRow(1).reporter_id = null;
    const put = await call('PUT', `${CLASSIC}/issues/1`, TOKEN[72], { status: 'resolved' });
    await sleep(200);
    check('a ticket with no reporter on record is closed all the same, and nobody is told', put.status === 200 && db.tables.notifications.length === 0);
  }

  // ── the conversation ──
  reset();
  {
    const cleo = await call('GET', `${CLASSIC}/issues/1/comments`, TOKEN[72]);
    check('a CTO reads the replies on a ticket, oldest first', cleo.status === 200 && cleo.body.map(c => c.id).join() === '1,2' && cleo.body[0].author_name === 'Cleo', JSON.stringify(cleo.body.map(c => c.id)));
    check('…asked of the database as: this ticket\'s, oldest first, two hundred at most', queries('GET', 'issue_comments')[0] === '?select=*&issue_id=eq.1&order=created_at.asc&limit=200', queries('GET', 'issue_comments')[0]);
    const ana = await call('GET', `${CLASSIC}/issues/1/comments`, TOKEN[71]);
    check('the person who reported it reads them too', ana.status === 200 && ana.body.length === 2);
    const fayOwn = await call('GET', `${CLASSIC}/issues/3/comments`, TOKEN[75]);
    check('…each reporter their own ticket\'s', fayOwn.status === 200 && fayOwn.body.length === 0);
    const fayOther = await call('GET', `${CLASSIC}/issues/1/comments`, TOKEN[75]);
    check('an unrelated colleague is turned away', fayOther.status === 403 && fayOther.body.error === 'Not permitted');
    const eli = await call('GET', `${CLASSIC}/issues/1/comments`, TOKEN[74]);
    check('one who may read the centre reads any ticket\'s', eli.status === 200 && eli.body.length === 2);
    const lost = await call('GET', `${CLASSIC}/issues/999/comments`, TOKEN[72]), junk = await call('GET', `${CLASSIC}/issues/abc/comments`, TOKEN[72]);
    check('a ticket that is not there is a 404', lost.status === 404 && lost.body.error === 'Issue not found' && junk.status === 404);
    db.failing.add('issue_comments');
    const down = await call('GET', `${CLASSIC}/issues/1/comments`, TOKEN[72]);
    check('replies that cannot be read are an empty thread, not a broken page', down.status === 200 && Array.isArray(down.body) && down.body.length === 0, JSON.stringify(down));
    db.failing.clear();
  }

  reset();
  {
    const post = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[72], { body: '  Try the spare.  ' });
    check('a CTO replies: the reply is stored against that ticket, trimmed, with the author named', post.status === 200 && post.body.issue_id === 1 && post.body.body === 'Try the spare.' && post.body.author_key === 'employee_72' && post.body.author_name === 'Cleo', JSON.stringify(post.body));
    const sent = await told(1);
    const heardFirst = (await told(2)).slice().sort((a, b) => a.member_key.localeCompare(b.member_key));
    check('…and both ends of the ticket hear about it: the person who reported it, and every other CTO (not the author)', heardFirst.length === 2 && heardFirst[0].member_key === 'employee_71' && heardFirst[1].member_key === 'employee_76' && heardFirst.every(n => n.type === 'issue' && n.title === 'Cleo commented on: Barcode scanner is dead' && n.body === 'Try the spare.' && n.url === '/employee#issues'), JSON.stringify(heardFirst.map(n => [n.member_key, n.title])));

    reset();
    const back = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[71], { body: 'Thanks.' });
    const heard = (await told(2)).map(n => n.member_key).sort();
    check('the reporter answers back, and every CTO — the one by title, and the deputy — hears it (not the author)', back.status === 200 && heard.join() === 'employee_72,employee_76', heard.join());

    reset();
    const own = await call('POST', `${CLASSIC}/issues/3/comments`, TOKEN[75], { body: 'Any news?' });
    check('a reporter can write on their own ticket', own.status === 200);
    const outsider = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[75], { body: 'Me too' });
    check('an unrelated colleague cannot write on it', outsider.status === 403 && !db.tables.issue_comments.some(c => c.body === 'Me too'));
    const empty = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[72], { body: '   ' });
    check('an empty reply is refused', empty.status === 400 && empty.body.error === 'Comment is empty', JSON.stringify(empty));
    const lost = await call('POST', `${CLASSIC}/issues/999/comments`, TOKEN[72], { body: 'x' });
    check('…and a reply to a ticket that is not there is a 404', lost.status === 404 && lost.body.error === 'Issue not found');
    const long = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[72], { body: 'x'.repeat(2500) });
    check('a reply is cut at two thousand characters', long.status === 200 && long.body.body.length === 2000);
    // (the only check on a file's address is what it is made of: an https link with nothing in it a page could be escaped with)
    for (const bad of ['javascript:alert(1)', 'http://files.example/a.png', 'https://files.example/a"b.png', 'https://files.example/a b.png', 'files.example/a.png']) {
      const refused = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[72], { body: 'See this', file_url: bad });
      check(`a file address that is not a plain https link (${bad}) is refused`, refused.status === 400 && /uploaded through the app/.test(refused.body.error), JSON.stringify(refused));
    }
    const kept = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[72], { body: 'See this', file_url: 'https://files.example/a.png' });
    check('…and any plain https link is kept as it was sent', kept.status === 200 && kept.body.file_url === 'https://files.example/a.png');
    const stored = 'https://stub.supabase.co/storage/v1/object/public/chat-files/issues/1_a.png';
    const file = await call('POST', `${CLASSIC}/issues/1/comments`, TOKEN[72], { file_url: stored, file_name: 'a.png', file_size: 1234, file_type: 'image/png' });
    check('a reply may be just a file this app stored', file.status === 200 && file.body.file_url === stored && file.body.file_name === 'a.png' && file.body.body === '', JSON.stringify(file.body));
    const heard2 = db.tables.notifications.filter(n => n.title.includes('commented on'));
    await told(db.tables.notifications.length + 1, 300);
    check('…and what the person is told is the file\'s name', db.tables.notifications.some(n => n.body === '\u{1F4CE} a.png'));
    void heard2;
  }

  // ── reporting ──
  reset();
  {
    const r = await call('POST', `${CLASSIC}/report-issue`, TOKEN[71], form({ title: 'Cannot log hours', description: 'The button does nothing.' }));
    check('a team member reports a ticket: ok, with no file', r.status === 200 && r.body.ok === true && r.body.file === '', JSON.stringify(r));
    const row = db.tables.issues.find(i => i.title === 'Cannot log hours');
    check('…stored as open, under their name and id', row && row.description === 'The button does nothing.' && row.file_url === '' && row.reporter_id === 71 && row.reporter_name === 'Ana' && row.status === 'open', JSON.stringify(row));
    const sent = (await told(2)).slice().sort((a, b) => a.member_key.localeCompare(b.member_key));
    check('…and every Chief Technical Officer is told, with the ticket\'s words (the deputy too: the title is matched, not equalled)', sent.length === 2 && sent[0].member_key === 'employee_72' && sent[1].member_key === 'employee_76' && sent.every(n => n.type === 'issue' && n.title === 'Issue reported by Ana: Cannot log hours' && n.body === 'The button does nothing.' && n.url === '/employee#issues'), JSON.stringify(sent.map(n => [n.member_key, n.title, n.body, n.url])));
    check('…the CTOs found by title, with a case-blind match', queries('GET', 'employees').includes('?select=id%2Cname&job_title=ilike.%25chief+technical+officer%25'), queries('GET', 'employees').join(' | '));
  }

  reset();
  {
    const r = await call('POST', `${CLASSIC}/report-issue`, TOKEN[75], form({ title: 'Only a title' }));
    const row = db.tables.issues.find(i => i.title === 'Only a title');
    const sent = await told(2);
    check('a title alone is enough, and it is what the CTOs are told', r.status === 200 && row && row.description === '' && sent.every(n => n.body === 'Only a title'), JSON.stringify(sent.map(n => n.body)));
    reset();
    const d = await call('POST', `${CLASSIC}/report-issue`, TOKEN[75], form({ description: 'Only details' }));
    const row2 = db.tables.issues[db.tables.issues.length - 1];
    check('so are details alone: the ticket is then called "System issue"', d.status === 200 && row2.title === 'System issue' && row2.description === 'Only details' && (await told(2)).every(n => n.title === 'Issue reported by Fay: System issue'));
    const none = await call('POST', `${CLASSIC}/report-issue`, TOKEN[75], form({ title: '  ', description: '' }));
    check('neither is a 400', none.status === 400 && none.body.error === 'Please describe the issue' && db.tables.issues.length === 4, JSON.stringify(none));
    reset();
    await call('POST', `${CLASSIC}/report-issue`, TOKEN[71], form({ title: 'T'.repeat(200), description: 'D'.repeat(2100) }));
    const long = db.tables.issues[db.tables.issues.length - 1];
    check('a title is cut at 150 characters and the details at 2000', long.title.length === 150 && long.description.length === 2000, `${long.title.length} ${long.description.length}`);
  }

  reset();
  {
    // nobody holds the CTO's title: the admin is told instead
    const keep = db.tables.employees.splice(0).filter(e => !/chief technical officer/i.test(e.job_title));
    db.tables.employees.push(...keep);
    const r = await call('POST', `${CLASSIC}/report-issue`, TOKEN[71], form({ title: 'No CTO', description: 'Nobody to tell.' }));
    const sent = await told(1);
    check('with no Chief Technical Officer on the team the admin is told instead, with a link to the notifications page', r.status === 200 && sent.length === 1 && sent[0].member_key === 'admin' && sent[0].url === '/dashboard#notif' && sent[0].title === 'Issue reported by Ana: No CTO', JSON.stringify(sent.map(n => [n.member_key, n.url])));
    db.tables.employees.splice(0, db.tables.employees.length, ...everyone);
  }

  reset();
  {
    const png = { bytes: Buffer.from('not really a png'), type: 'image/png', name: 'screen shot (1).png' };
    const r = await call('POST', `${CLASSIC}/report-issue`, TOKEN[71], form({ title: 'With a picture', description: 'See attached.' }, png));
    const keys = [...db.storage.keys()];
    check('an attachment is stored in the chat-files bucket under issues/, its name made safe', r.status === 200 && keys.length === 1 && /^chat-files\/issues\/\d+_screen_shot__1_\.png$/.test(keys[0]) && db.storage.get(keys[0]).contentType === 'image/png', keys.join());
    const row = db.tables.issues.find(i => i.title === 'With a picture');
    check('…and its public address is on the ticket and in what the CTOs are told', r.body.file && r.body.file === row.file_url && /\/chat-files\/issues\/\d+_screen_shot__1_\.png$/.test(row.file_url) && (await told(2)).every(n => n.body === `See attached.\nAttachment: ${row.file_url}`), JSON.stringify([r.body, row && row.file_url]));
  }

  reset();
  {
    // an insert that fails is not an error to the person: the CTO is still told, in words
    db.failing.add('issues');
    const r = await call('POST', `${CLASSIC}/report-issue`, TOKEN[71], form({ title: 'Lost ticket', description: 'The table is down.' }));
    const sent = await told(2);
    check('a ticket that could not be stored is still announced to the CTOs, and the person is told it went (best-effort)', r.status === 200 && r.body.ok === true && sent.length === 2 && sent.every(n => n.title === 'Issue reported by Ana: Lost ticket'), JSON.stringify([r.status, sent.length]));
    db.failing.clear();
  }

  // ═══ 2. /api/v1/issues: the same tickets through the same service, and open to the admin ═══════
  const { schemas } = require(process.cwd() + '/packages/contracts');
  const V1 = '/api/v1/issues';
  const ADMIN = 'is-admin';
  const peopleTold = () => db.tables.notifications.map(n => n.member_key).sort().join();

  // ── reading the centre ──
  reset();
  {
    const classic = await call('GET', `${CLASSIC}/issues`, TOKEN[72]);
    db.log.length = 0;
    const cleo = await call('GET', V1, TOKEN[72]);
    check('a CTO reads the tickets as { items }: the same ones, in the same order, as the classic page\'s', cleo.status === 200 && Object.keys(cleo.body).join() === 'items' && JSON.stringify(cleo.body.items.map(i => i.id)) === JSON.stringify(classic.body.map(i => i.id)), `${cleo.status}`);
    check('…every ticket is what the contract says a ticket is', schemas.IssueList.safeParse(cleo.body).success);
    check('…asked of the database exactly as the classic page asks', queries('GET', 'issues').join() === '?select=*&order=created_at.desc&limit=200', queries('GET', 'issues').join());
    const admin = await call('GET', V1, ADMIN), dan = await call('GET', V1, TOKEN[73]), eli = await call('GET', V1, TOKEN[74]);
    check('the admin reads them too (the classic routes were the team portal\'s alone), and so does anyone granted the section', admin.status === 200 && admin.body.items.length === 3 && dan.status === 200 && eli.status === 200);
    const ana = await call('GET', V1, TOKEN[71]), fay = await call('GET', V1, TOKEN[75]);
    check('anyone else — even the person who reported one — is refused the list', ana.status === 403 && ana.body.error === 'Not permitted' && fay.status === 403);
    const nobody = await call('GET', V1, null), unknown = await call('GET', V1, 'is-nobody');
    check('nobody, and a token nobody issued, are 401', nobody.status === 401 && unknown.status === 401);

    db.tables.issues.push({ id: 50, title: null, description: null, file_url: null, reporter_id: null, reporter_name: null, status: null, created_at: at(50), resolved_at: undefined, resolved_by: null });
    const odd = (await call('GET', V1, TOKEN[72])).body.items.find(i => i.id === 50);
    check('a ticket whose columns are null has them empty, and is open — so a client never has to ask', odd && odd.title === '' && odd.description === '' && odd.file_url === '' && odd.reporter_id === null && odd.reporter_name === '' && odd.status === 'open' && odd.resolved_at === null && odd.resolved_by === '' && schemas.Issue.safeParse(odd).success, JSON.stringify(odd));
    db.failing.add('issues');
    const down = await call('GET', V1, TOKEN[72]);
    check('a database that cannot be asked is a 503 that says so, without its own words', down.status === 503 && down.body.code === 'unavailable' && !/simulated|XX000/.test(JSON.stringify(down.body)), JSON.stringify(down.body));
    db.failing.clear();
  }

  // ── closing and reopening ──
  reset();
  {
    const put = await call('PATCH', `${V1}/1`, TOKEN[72], { status: 'resolved' });
    check('a CTO closes a ticket: the ticket comes back resolved, with who closed it and when', put.status === 200 && schemas.Issue.safeParse(put.body).success && put.body.status === 'resolved' && put.body.resolved_by === 'Cleo' && /^\d{4}-\d\d-\d\dT/.test(put.body.resolved_at), JSON.stringify(put.body));
    const sent = db.tables.notifications.slice();
    check('…the reporter is told, by name, once — in the words the classic page tells them', sent.length === 1 && sent[0].member_key === 'employee_71' && sent[0].title === 'Solved: Barcode scanner is dead' && sent[0].body === 'Cleo marked the issue you reported as solved.' && sent[0].url === '/employee#issues', JSON.stringify(sent));
    await call('PATCH', `${V1}/1`, TOKEN[72], { status: 'resolved' });
    check('…and closing what is already closed tells nobody again', db.tables.notifications.length === 1);
    const reopen = await call('PATCH', `${V1}/1`, TOKEN[72], { status: 'open' });
    check('reopening clears who closed it and when', reopen.status === 200 && reopen.body.status === 'open' && reopen.body.resolved_at === null && reopen.body.resolved_by === '');

    const admin = await call('PATCH', `${V1}/3`, ADMIN, { status: 'resolved' });
    check('the admin closes one too, and is named "Admin" to whoever reported it', admin.status === 200 && admin.body.resolved_by === 'Admin' && db.tables.notifications.some(n => n.member_key === 'employee_75' && n.body === 'Admin marked the issue you reported as solved.'));
    const dan = await call('PATCH', `${V1}/3`, TOKEN[73], { status: 'open' });
    check('a team member granted "resolve" can close and reopen', dan.status === 200 && dan.body.status === 'open');
    const eli = await call('PATCH', `${V1}/3`, TOKEN[74], { status: 'resolved' }), ana = await call('PATCH', `${V1}/1`, TOKEN[71], { status: 'resolved' });
    check('one granted only "view", and the person who reported it, cannot', eli.status === 403 && ana.status === 403 && issueRow(3).status === 'open' && issueRow(1).status === 'open');
    const nobody = await call('PATCH', `${V1}/1`, null, { status: 'resolved' });
    check('nobody is 401', nobody.status === 401);

    const bad = [];
    for (const body of [{ status: 'banana' }, {}, { status: 'open', title: 'x' }, { status: 1 }, [], 'resolved']) {
      const r = await call('PATCH', `${V1}/1`, TOKEN[72], body);
      if (r.status !== 400 || r.body.code !== 'invalid') bad.push(`${JSON.stringify(body)}: ${r.status}`);
    }
    check('anything but { status: "open" | "resolved" } is a 400 (the classic route read anything else as "open")', bad.length === 0, bad.join('; '));
    const noBody = await call('PATCH', `${V1}/1`, TOKEN[72]);
    check('…so is no body at all', noBody.status === 400 && noBody.body.code === 'invalid');
    const notDigits = [];
    for (const id of ['abc', '1.5', '-1', '99999999999999999999']) { const r = await call('PATCH', `${V1}/${id}`, TOKEN[72], { status: 'open' }); if (r.status !== 400) notDigits.push(`${id}: ${r.status}`); }
    check('an id that is not digits is a 400', notDigits.length === 0, notDigits.join('; '));
    const missing = await call('PATCH', `${V1}/999`, TOKEN[72], { status: 'resolved' });
    check('a ticket that is not there is a 404 in the one error shape (the classic route answered with the database\'s words)', missing.status === 404 && missing.body.code === 'not_found' && !/rows returned/.test(JSON.stringify(missing.body)), JSON.stringify(missing.body));
    db.failing.add('issues');
    const down = await call('PATCH', `${V1}/1`, TOKEN[72], { status: 'resolved' });
    check('a database that cannot be asked is a 503', down.status === 503 && down.body.code === 'unavailable', JSON.stringify(down.body));
    db.failing.clear();
  }

  // ── the conversation ──
  reset();
  {
    const classic = await call('GET', `${CLASSIC}/issues/1/comments`, TOKEN[72]);
    db.log.length = 0;
    const cleo = await call('GET', `${V1}/1/comments`, TOKEN[72]);
    check('a CTO reads the replies on a ticket as { items }: the same, oldest first', cleo.status === 200 && Object.keys(cleo.body).join() === 'items' && JSON.stringify(cleo.body.items.map(c => c.id)) === JSON.stringify(classic.body.map(c => c.id)) && schemas.IssueCommentList.safeParse(cleo.body).success, JSON.stringify(cleo.body.items && cleo.body.items.map(c => c.id)));
    check('…asked of the database as the classic page asks', queries('GET', 'issue_comments').join() === '?select=*&issue_id=eq.1&order=created_at.asc&limit=200', queries('GET', 'issue_comments').join());
    const who = {};
    for (const [label, token] of [['the admin', ADMIN], ['the reporter', TOKEN[71]], ['a colleague who may read the centre', TOKEN[74]]]) who[label] = (await call('GET', `${V1}/1/comments`, token)).status;
    check('the admin, the person who reported it, and anyone who may read the centre read them', Object.values(who).every(s => s === 200), JSON.stringify(who));
    const fayOwn = await call('GET', `${V1}/3/comments`, TOKEN[75]), fayOther = await call('GET', `${V1}/1/comments`, TOKEN[75]);
    check('each reporter reads their own ticket\'s; an unrelated colleague is turned away', fayOwn.status === 200 && fayOther.status === 403 && fayOther.body.code === 'forbidden', JSON.stringify(fayOther.body));
    const lost = await call('GET', `${V1}/999/comments`, TOKEN[72]), junk = await call('GET', `${V1}/abc/comments`, TOKEN[72]), nobody = await call('GET', `${V1}/1/comments`, null);
    check('a ticket that is not there is a 404, an id that is not digits a 400, and nobody a 401', lost.status === 404 && lost.body.code === 'not_found' && junk.status === 400 && nobody.status === 401);
    db.failing.add('issue_comments');
    const down = await call('GET', `${V1}/1/comments`, TOKEN[72]);
    check('replies that cannot be read are a 503, not an empty thread that looks like nobody has answered', down.status === 503 && down.body.code === 'unavailable', JSON.stringify(down.body));
    db.failing.clear();
  }

  reset();
  {
    const post = await call('POST', `${V1}/1/comments`, TOKEN[72], { body: '  Try the spare.  ' });
    check('a CTO replies: 201, the reply as the contract has it, trimmed, with the author named', post.status === 201 && schemas.IssueComment.safeParse(post.body).success && post.body.issue_id === 1 && post.body.body === 'Try the spare.' && post.body.author_key === 'employee_72' && post.body.author_name === 'Cleo', JSON.stringify(post.body));
    check('…and both ends of the ticket hear of it, as on the classic page: the reporter and every other CTO', peopleTold() === 'employee_71,employee_76' && db.tables.notifications.every(n => n.title === 'Cleo commented on: Barcode scanner is dead' && n.body === 'Try the spare.'), peopleTold());

    reset();
    const admin = await call('POST', `${V1}/1/comments`, ADMIN, { body: 'From the admin.' });
    check('the admin replies as "Admin", and the reporter and every CTO hear of it', admin.status === 201 && admin.body.author_key === 'admin' && admin.body.author_name === 'Admin' && peopleTold() === 'employee_71,employee_72,employee_76', peopleTold());

    reset();
    const back = await call('POST', `${V1}/1/comments`, TOKEN[71], { body: 'Thanks.' });
    check('the reporter answers back, and every CTO hears of it (not the author)', back.status === 201 && peopleTold() === 'employee_72,employee_76', peopleTold());
    const outsider = await call('POST', `${V1}/1/comments`, TOKEN[75], { body: 'Me too' });
    check('an unrelated colleague cannot write on it', outsider.status === 403 && outsider.body.code === 'forbidden' && !db.tables.issue_comments.some(c => c.body === 'Me too'));
    const nobody = await call('POST', `${V1}/1/comments`, null, { body: 'x' });
    check('nobody is 401', nobody.status === 401);

    const bad = [];
    for (const body of [{}, { body: '   ' }, { body: 'x'.repeat(2001) }, { body: 'x', author_key: 'admin' }, { body: 5 }, { file_size: -1, body: 'x' }]) {
      const r = await call('POST', `${V1}/1/comments`, TOKEN[72], body);
      if (r.status !== 400 || r.body.code !== 'invalid') bad.push(`${JSON.stringify(body).slice(0, 40)}: ${r.status}`);
    }
    check('an empty reply, a reply of more than two thousand characters (the classic route cut it), and anything unknown are a 400', bad.length === 0, bad.join('; '));
    const noBody = await call('POST', `${V1}/1/comments`, TOKEN[72]);
    check('…so is no body at all', noBody.status === 400);
    const refused = await call('POST', `${V1}/1/comments`, TOKEN[72], { body: 'See this', file_url: 'javascript:alert(1)' });
    check('a file address that is not a plain https link is refused in words a person can read', refused.status === 400 && refused.body.code === 'invalid' && /uploaded through the app/.test(refused.body.error), JSON.stringify(refused.body));
    const stored = 'https://stub.supabase.co/storage/v1/object/public/chat-files/issues/1_a.png';
    const file = await call('POST', `${V1}/1/comments`, TOKEN[72], { file_url: stored, file_name: 'a.png', file_size: 1234, file_type: 'image/png' });
    check('a reply may be just a file the app stored', file.status === 201 && file.body.file_url === stored && file.body.file_name === 'a.png' && file.body.file_size === 1234 && file.body.body === '' && schemas.IssueComment.safeParse(file.body).success, JSON.stringify(file.body));
    const lost = await call('POST', `${V1}/999/comments`, TOKEN[72], { body: 'x' }), badId = await call('POST', `${V1}/abc/comments`, TOKEN[72], { body: 'x' });
    check('a reply to a ticket that is not there is a 404, and to an id that is not digits a 400', lost.status === 404 && lost.body.code === 'not_found' && badId.status === 400);
    db.failing.add('issue_comments');
    const down = await call('POST', `${V1}/1/comments`, TOKEN[72], { body: 'x' });
    check('a database that cannot be asked is a 503, and nobody is told of a reply that was not kept', down.status === 503 && down.body.code === 'unavailable' && !db.tables.notifications.some(n => n.body === 'x'), JSON.stringify(down.body));
    db.failing.clear();
  }

  // ── reporting ──
  reset();
  {
    const r = await call('POST', V1, TOKEN[71], form({ title: 'Cannot log hours', description: 'The button does nothing.' }));
    check('a team member reports a ticket: 201, with no file', r.status === 201 && schemas.IssueReportResult.safeParse(r.body).success && r.body.file === '', JSON.stringify(r));
    const row = db.tables.issues.find(i => i.title === 'Cannot log hours');
    check('…stored as open, under their name and id', row && row.description === 'The button does nothing.' && row.reporter_id === 71 && row.reporter_name === 'Ana' && row.status === 'open' && row.file_url === '', JSON.stringify(row));
    check('…and every Chief Technical Officer is told, in the classic page\'s words, with a link to the center', peopleTold() === 'employee_72,employee_76' && db.tables.notifications.every(n => n.type === 'issue' && n.title === 'Issue reported by Ana: Cannot log hours' && n.body === 'The button does nothing.' && n.url === '/employee#issues'), peopleTold());

    reset();
    const admin = await call('POST', V1, ADMIN, form({ title: 'From the admin' }));
    const arow = db.tables.issues.find(i => i.title === 'From the admin');
    check('the admin may report one too: it has no reporter id on record, and is named "Admin"', admin.status === 201 && arow && arow.reporter_id === null && arow.reporter_name === 'Admin' && db.tables.notifications.every(n => n.title === 'Issue reported by Admin: From the admin'), JSON.stringify(arow));

    reset();
    await call('POST', V1, TOKEN[75], form({ description: 'Only details' }));
    check('details alone are enough: the ticket is then called "System issue"', db.tables.issues.some(i => i.title === 'System issue' && i.description === 'Only details') && db.tables.notifications.every(n => n.title === 'Issue reported by Fay: System issue'));
    const bad = [];
    for (const fields of [{}, { title: '  ', description: '' }, { title: 'T'.repeat(151), description: 'x' }, { title: 'x', description: 'D'.repeat(2001) }]) {
      const rr = await call('POST', V1, TOKEN[71], form(fields));
      if (rr.status !== 400 || rr.body.code !== 'invalid' || !Array.isArray(rr.body.issues)) bad.push(`${JSON.stringify(fields).slice(0, 40)}: ${rr.status}`);
    }
    check('neither a summary nor details, and a summary of more than 150 or details of more than 2000 characters (the classic route cut them), are a 400 that says what was wrong', bad.length === 0 && db.tables.issues.length === 4, bad.join('; '));
    const json = await call('POST', V1, TOKEN[71], { title: 'as json' });
    check('a body that is not a form is the same 400 (the form is what carries a file)', json.status === 400 && json.body.code === 'invalid');
    const nobody = await call('POST', V1, null, form({ title: 'x' }));
    check('nobody is 401', nobody.status === 401);
  }

  reset();
  {
    const keep = db.tables.employees.splice(0).filter(e => !/chief technical officer/i.test(e.job_title));
    db.tables.employees.push(...keep);
    const r = await call('POST', V1, TOKEN[71], form({ title: 'No CTO', description: 'Nobody to tell.' }));
    check('with no Chief Technical Officer on the team the admin is told instead, as on the classic page', r.status === 201 && db.tables.notifications.length === 1 && db.tables.notifications[0].member_key === 'admin' && db.tables.notifications[0].url === '/dashboard#notif');
    db.tables.employees.splice(0, db.tables.employees.length, ...everyone);
  }

  reset();
  {
    const png = { bytes: Buffer.from('not really a png'), type: 'image/png', name: 'screen shot (1).png' };
    const r = await call('POST', V1, TOKEN[71], form({ title: 'With a picture', description: 'See attached.' }, png));
    const keys = [...db.storage.keys()];
    const row = db.tables.issues.find(i => i.title === 'With a picture');
    check('an attachment is stored in the chat-files bucket under issues/, its name made safe, and its address is on the ticket and in what the CTOs are told', r.status === 201 && keys.length === 1 && /^chat-files\/issues\/\d+_screen_shot__1_\.png$/.test(keys[0]) && r.body.file === row.file_url && db.tables.notifications.every(n => n.body === `See attached.\nAttachment: ${row.file_url}`), JSON.stringify([r.body, keys]));

    reset();
    const big = await call('POST', V1, TOKEN[71], form({ title: 'Too big' }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1024), type: 'application/zip', name: 'big.zip' }));
    check('a file of more than 10 MB is a 413 and nothing is kept or told', big.status === 413 && big.body.code === 'too_large' && db.storage.size === 0 && !db.tables.issues.some(i => i.title === 'Too big') && db.tables.notifications.length === 0, JSON.stringify(big.body));

    // two uploads in the same millisecond name the same object: the second is refused by the store
    reset();
    const realNow = Date.now; Date.now = () => 1790000000000;
    try {
      await call('POST', V1, TOKEN[71], form({ title: 'First' }, { bytes: Buffer.from('a'), type: 'text/plain', name: 'same.txt' }));
      db.tables.notifications.splice(0);
      const second = await call('POST', V1, TOKEN[71], form({ title: 'Second' }, { bytes: Buffer.from('b'), type: 'text/plain', name: 'same.txt' }));
      check('an attachment the store refuses is a 502 that says so, and nothing is kept or told of that ticket', second.status === 502 && second.body.code === 'upload_failed' && !db.tables.issues.some(i => i.title === 'Second') && db.tables.notifications.length === 0, JSON.stringify(second.body));
      db.tables.notifications.splice(0);
      const classicSecond = await call('POST', `${CLASSIC}/report-issue`, TOKEN[71], form({ title: 'Third' }, { bytes: Buffer.from('c'), type: 'text/plain', name: 'same.txt' }));
      check('…where the classic route says it in the store\'s own words', classicSecond.status === 500 && /^Attachment upload failed: /.test(classicSecond.body.error), JSON.stringify(classicSecond.body));
    } finally { Date.now = realNow; }
  }

  reset();
  {
    db.failing.add('issues');
    const r = await call('POST', V1, TOKEN[71], form({ title: 'Lost ticket', description: 'The table is down.' }));
    check('a ticket that could not be stored is a 503 — and is not announced, so nobody is told of a ticket that is not there (the classic route announces it anyway)', r.status === 503 && r.body.code === 'unavailable' && db.tables.notifications.length === 0, JSON.stringify(r.body));
    db.failing.clear();
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
