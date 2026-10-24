#!/usr/bin/env node
// Clear a lost second factor from the command line.
//
//   node scripts/reset-2fa.js admin
//   node scripts/reset-2fa.js employee 12
//
// For the case the dashboard cannot cover: the admin lost their phone AND their
// recovery codes (the Reset button on the Employees page is for employees, and the
// admin cannot sign in to press anything), or no administrator is available at all.
// Run it where SUPABASE_URL and SUPABASE_SERVICE_KEY are set — the same place the app
// runs, e.g. `railway run node scripts/reset-2fa.js admin`.
//
// It removes the second factor, ends the account's saved logins, and removes its push
// subscriptions, exactly like the Reset button. Then the account signs in with its
// password alone and can set up two-factor authentication again from Security.
//
// What it cannot do is reach into the running server's memory: a login the server is
// already holding stays valid until the server restarts. If the reason for the reset is
// that someone else may have got in, restart (redeploy) the service as well.
const { createClient } = require('@supabase/supabase-js');

async function resetSecondFactor(supabase, kind, id) {
  const account = String(id);
  const gone = await supabase.from('account_security').delete().eq('kind', kind).eq('account_id', account).select('kind');
  if (gone.error) throw new Error(`Could not clear the second factor: ${gone.error.message}`);

  let sessions = supabase.from('sessions').delete().eq('kind', kind);
  if (kind === 'employee') sessions = sessions.eq('payload->>id', account);
  const ended = await sessions.select('token');
  if (ended.error) throw new Error(`The second factor is cleared, but the saved logins could not be ended: ${ended.error.message}`);

  // Best-effort: a signed-out phone should stop receiving notification text.
  await supabase.from('push_subscriptions').delete().eq('member_key', kind === 'admin' ? 'admin' : `employee_${account}`);
  return { factorRemoved: (gone.data || []).length, sessionsEnded: (ended.data || []).length };
}

async function main(argv, env, log) {
  const [kind, id] = argv;
  if (kind !== 'admin' && !(kind === 'employee' && /^\d+$/.test(id || ''))) {
    log('Usage:\n  node scripts/reset-2fa.js admin\n  node scripts/reset-2fa.js employee <employee id>');
    return 2;
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    log('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (run this where the app runs, e.g. `railway run node scripts/reset-2fa.js admin`).');
    return 2;
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const who = kind === 'admin' ? 'the admin account' : `employee ${id}`;
  const r = await resetSecondFactor(supabase, kind, kind === 'admin' ? 'admin' : id);
  log(r.factorRemoved ? `Two-factor authentication removed for ${who}.` : `${who} had no two-factor setup to remove.`);
  log(`${r.sessionsEnded} saved login${r.sessionsEnded === 1 ? '' : 's'} ended.`);
  log('The running server keeps any login it already holds in memory until it restarts — redeploy if someone else may have had access.');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, console.log).then(code => process.exit(code), e => { console.error(e.message); process.exit(1); });
}
module.exports = { resetSecondFactor, main };
