#!/bin/bash
# Every suite. Run from the repo root: bash tests/run.sh
#
# Most of these drive the real shipped code rather than a copy — the browser suites
# slice the actual module out of public/assets/*.js, and the migration suite runs
# the real SQL against a throwaway Postgres.
#
#   bash tests/run.sh                         every suite
#   bash tests/run.sh --only themecss,shell   just those (the first column below; smoke and routes too)
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0
only=""
if [ "$1" = "--only" ]; then only=",$2,"; shift 2; fi
wanted() { [ -z "$only" ] || [[ "$only" == *",$1,"* ]]; }
run() {
  name=$1; wanted "$name" || return 0
  printf '%-14s ' "$name"; shift
  out=$("$@" 2>&1); rc=$?
  echo "$out" | tail -1
  if [ $rc -eq 0 ]; then pass=$((pass+1))
  else
    fail=$((fail+1))
    # The last line is rarely the one that says what went wrong.
    echo "$out" > "${TMPDIR:-/tmp}/ml-suite-$name.txt"; echo "               full output: ${TMPDIR:-/tmp}/ml-suite-$name.txt"
  fi
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
run emailview   node tests/emailview.js
run attachlinks node tests/attachlinks.js
run configguard node tests/configguard.js
run scopewrite  node tests/scopewrite.js
run pastetest   node tests/pastetest.js
run invitetest  node tests/invitetest.js
run hdsignal    node tests/hdsignal.js
run hdmeeting   node tests/hdmeeting.js
run hdextras    node tests/hdextras.js
run workspaceui node tests/workspaceui.js
run workspaceapi node tests/workspaceapi.js
run shell        node tests/shell.js
run themeui     node tests/themeui.js
run wsedit      node tests/wsedit.js
run icontest    node tests/icontest.js
run leadstest   node tests/leadstest.js
run permstest   node tests/permstest.js
run contracts   node tests/contracts.js
run permlive    node tests/permlive.js
run permsui     node tests/permsui.js
run foldertest  node tests/foldertest.js
run proctest    node tests/proctest.js
run reported    node tests/reported.js
run issuereq    node tests/issuereq.js
run availsched  node tests/availsched.js
run portalgaps  node tests/portalgaps.js
run bindings    node tests/bindings.js
run boottest    node tests/boottest.js
run dbdown      node tests/dbdown.js
run sessions    node tests/sessiontest.js
run authlibs    node tests/authlibs.js
run revoketest  node tests/revoketest.js
run mfalibs     node tests/mfalibs.js
run signintest  node tests/signintest.js
run securityui  node tests/securityui.js
run reset2fa    node tests/reset2fa.js
run submittest  node tests/submittest.js
run ssetest     node tests/ssetest.js
run navtest     node tests/navtest.js
run colengine   node tests/colengine.js
run quotetest   node tests/quotetest.js
run meetstest   node tests/meetstest.js
run caltest     node tests/caltest.js
run chatmenu    node tests/chatmenu.js
run availtest   node tests/availtest.js
run logistics   node tests/logistics.js
run accttest    node tests/accttest.js
run assisttest  node tests/assisttest.js
run llmtest     node tests/llmtest.js
run chatai      node tests/chatai.js
run tracktest   node tests/tracktest.js
run portaltest  node tests/portaltest.js
run envexample  node tests/envexample.js
run mobiletest  node tests/mobiletest.js
run themecss    node tests/themecss.js
run themecore   node tests/themecore.js
run themeaudit  node tests/themeaudit.js
run homecache   node tests/homecache.js
run dbfetch     node tests/dbfetch.js
run fetchall    node tests/fetchall.js
run profiletest node tests/profiletest.js
run gziptest    node tests/gziptest.js
run docbrand    node tests/doc-brand.js
run docquote    node tests/doc-quotation.js
run doccontract node tests/doc-contract.js
run docpo       node tests/doc-po.js
run docrfq      node tests/doc-rfq.js
# needs a local coturn on 127.0.0.1:3478 for the success path; skips it otherwise
run relaytest   node tests/relaytest.js

if wanted smoke; then
  printf '%-14s ' "smoke"
  if out=$(node tools/smoke-routes.js 2>&1); then echo "$out" | tail -1; pass=$((pass+1));
  else echo "$out" | grep -E "BROKEN|exercised|BLIND|escaped a handler" | tail -6; fail=$((fail+1)); fi
fi

if wanted routes; then
  printf '\n%-14s ' "routes"
  # The legacy routes must be exactly the snapshot; /api/v1 is fingerprinted beside it, with its guards.
  if out=$(node tools/route-inventory.js --check 2>&1); then
    echo "$out" | grep -E "^inventory matches" | tail -1; pass=$((pass+1))
  else
    echo "$out" | grep -E "^(ROUTES CHANGED|  )"; fail=$((fail+1))
  fi
fi

echo; echo "$pass suite(s) green, $fail red"
[ $fail -eq 0 ]
