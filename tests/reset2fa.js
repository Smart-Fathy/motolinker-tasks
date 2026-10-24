// scripts/reset-2fa.js — the way back in when the admin lost the phone and the codes.
//
// Run against the in-memory database rather than a mock of the client, so what is
// checked is what would be left in the tables.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'stub';
const { createFakeSupabase } = require('./helpers/fake-supabase');
const { main } = require('../scripts/reset-2fa');

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const db = createFakeSupabase({
  account_security: [
    { kind: 'admin', account_id: 'admin', totp_enabled: true },
    { kind: 'employee', account_id: '7', totp_enabled: true },
    { kind: 'employee', account_id: '8', totp_enabled: true },
  ],
  sessions: [
    { token: 'a1', kind: 'admin', payload: { username: 'admin' } },
    { token: 'a2', kind: 'admin', payload: { username: 'admin' } },
    { token: 'e7', kind: 'employee', payload: { id: 7 } },
    { token: 'e8', kind: 'employee', payload: { id: 8 } },
  ],
  push_subscriptions: [{ id: 1, member_key: 'admin' }, { id: 2, member_key: 'employee_7' }, { id: 3, member_key: 'employee_8' }],
});
db.install();

(async () => {
  const out = [];
  const log = s => out.push(s);
  const T = db.tables;

  c('with no arguments it says how to use it and changes nothing', await main([], process.env, log) === 2 && T.account_security.length === 3 && /Usage/.test(out.join()));
  c('an employee needs a numeric id', await main(['employee', 'sara'], process.env, log) === 2 && await main(['employee'], process.env, log) === 2 && T.account_security.length === 3);
  c('it refuses to run without database settings', await main(['admin'], { }, log) === 2 && T.account_security.length === 3);

  out.length = 0;
  c('resetting the admin succeeds', await main(['admin'], process.env, log) === 0, out.join(' | '));
  c('…removes only the admin\'s second factor', !T.account_security.some(r => r.kind === 'admin') && T.account_security.length === 2);
  c('…ends the admin\'s saved logins, and only those', !T.sessions.some(s => s.kind === 'admin') && T.sessions.length === 2, T.sessions.map(s => s.token).join(','));
  c('…and the admin\'s push subscriptions, and only those', !T.push_subscriptions.some(p => p.member_key === 'admin') && T.push_subscriptions.length === 2);
  c('…and says the running server keeps its in-memory logins until restart', out.some(l => /restarts/.test(l)));

  out.length = 0;
  c('resetting one employee leaves the others alone', await main(['employee', '7'], process.env, log) === 0
    && !T.account_security.some(r => r.account_id === '7') && T.account_security.some(r => r.account_id === '8')
    && !T.sessions.some(s => s.token === 'e7') && T.sessions.some(s => s.token === 'e8')
    && !T.push_subscriptions.some(p => p.member_key === 'employee_7') && T.push_subscriptions.some(p => p.member_key === 'employee_8'));

  out.length = 0;
  c('resetting an account with nothing set up says so, and succeeds', await main(['employee', '7'], process.env, log) === 0 && /no two-factor setup/.test(out.join(' ')), out.join(' | '));

  db.failing.add('account_security');
  let failed = false;
  try { await main(['employee', '8'], process.env, log); } catch (e) { failed = /Could not clear/.test(e.message); }
  c('if the database refuses, it fails loudly rather than reporting success', failed && T.sessions.some(s => s.token === 'e8'));

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} reset-2fa checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
