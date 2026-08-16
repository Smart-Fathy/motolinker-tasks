#!/bin/bash
# Every suite. Run from the repo root: bash tests/run.sh
#
# Most of these drive the real shipped code rather than a copy — the browser suites
# slice the actual module out of public/assets/*.js, and the migration suite runs
# the real SQL against a throwaway Postgres.
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0
run() {
  printf '%-14s ' "$1"; shift
  out=$("$@" 2>&1); rc=$?
  echo "$out" | tail -1
  [ $rc -eq 0 ] && pass=$((pass+1)) || fail=$((fail+1))
}
run hdtest      node tests/hdtest.js
run sharetest   node tests/sharetest.js
run grouptest   node tests/grouptest.js
run guesttest   node tests/guesttest.js
run phase2test  node tests/phase2test.js
run stocktest   node tests/stocktest.js
run drivetest   node tests/drivetest.js
run suptest     node tests/suptest.js
run phase3ui    node tests/phase3ui.js
run catalogue   node tests/cataloguetest.js
run columns     node tests/columns.js
run shared      node tests/shared.js
run widgets     node tests/widgets.js
run linktest    node tests/linktest.js
run pastetest   node tests/pastetest.js
run invitetest  node tests/invitetest.js
run leadstest   node tests/leadstest.js
run permstest   node tests/permstest.js
run permlive    node tests/permlive.js
run permsui     node tests/permsui.js
run foldertest  node tests/foldertest.js
run proctest    node tests/proctest.js
run bindings    node tests/bindings.js
run boottest    node tests/boottest.js
run sessions    node tests/sessiontest.js
run ssetest     node tests/ssetest.js
run navtest     node tests/navtest.js
run colengine   node tests/colengine.js
run quotetest   node tests/quotetest.js
run meetstest   node tests/meetstest.js
run availtest   node tests/availtest.js
run mobiletest  node tests/mobiletest.js
run homecache   node tests/homecache.js
# needs a local coturn on 127.0.0.1:3478 for the success path; skips it otherwise
run relaytest   node tests/relaytest.js

printf '%-14s ' "smoke"
if out=$(node tools/smoke-routes.js 2>&1); then echo "$out" | tail -1; pass=$((pass+1));
else echo "$out" | grep -E "BROKEN|exercised|BLIND|escaped a handler" | tail -6; fail=$((fail+1)); fi

printf '\n%-14s ' "routes"
node tools/route-inventory.js /tmp/ml-routes.txt >/dev/null 2>&1
if diff -q tools/routes.snapshot.txt /tmp/ml-routes.txt >/dev/null; then
  echo "inventory matches the snapshot"; pass=$((pass+1))
else
  echo "ROUTES CHANGED — review, then regenerate tools/routes.snapshot.txt"; fail=$((fail+1))
fi

echo; echo "$pass suite(s) green, $fail red"
[ $fail -eq 0 ]
