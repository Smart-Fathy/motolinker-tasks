#!/bin/bash
# Every suite. Run from the repo root: bash tests/run.sh
#
# Most of these drive the real shipped code rather than a copy — the browser suites
# slice the actual module out of public/assets/*.js, and the migration suite runs
# the real SQL against a throwaway Postgres.
#
#   bash tests/run.sh                         every suite, one after another (they use fixed ports)
#   bash tests/run.sh --only themecss,shell   just those (the first column below; smoke and routes too)
#   bash tests/run.sh --shard 2/5             the 2nd of 5 slices of the suites; CI runs the five side by side on
#                                             five machines (tools/shard-plan.js deals them out by tests/suite-weights.json)
#   bash tests/run.sh --list                  print the suite names and run nothing (also with --only / --shard)
#
# `secparity` (the Security panel against the classic one, 8 looks of 2 portals) runs as two, one per portal, for the same reason;
# so do `supparity` (Suppliers), `docparity` (RFQs and purchase orders), `ctparity` (Contracts) and `stparity` (Inventory & Logistics).
# `themeaudit`, the contrast audit, is the longest suite and runs as three (themeaudit1..3) so that it can be
# spread over machines; --only themeaudit asks for all three. Every suite's seconds go to
# ${TMPDIR:-/tmp}/ml-suite-times.txt, which is what tests/suite-weights.json is refreshed from.
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0; listed=0
only=""; only_given=0; asked=(); shard=""; list=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only)  only_given=1; IFS=, read -ra asked <<< "${2-}"; shift; [ $# -gt 0 ] && shift ;;
    --shard) shard=${2-}; shift; [ $# -gt 0 ] && shift ;;
    --list)  list=1; shift ;;
    *) echo "usage: bash tests/run.sh [--only a,b] [--shard I/N] [--list]" >&2; exit 2 ;;
  esac
done
if [ -n "$shard" ]; then
  [ $only_given -eq 1 ] && { echo "--shard and --only cannot be combined" >&2; exit 2; }
  if ! [[ "$shard" =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]]; then echo "--shard wants I/N, like 2/5; got '$shard'" >&2; exit 2; fi
  si=${BASH_REMATCH[1]}; sn=${BASH_REMATCH[2]}
  [ "$si" -le "$sn" ] || { echo "--shard I/N wants I no bigger than N; got '$shard'" >&2; exit 2; }
  mine=$(bash "$0" --list | node tools/shard-plan.js "$si" "$sn") || exit 2
  only_given=1; IFS=, read -ra asked <<< "$mine"
fi
expanded=()
for n in "${asked[@]}"; do
  case "$n" in themeaudit) expanded+=(themeaudit1 themeaudit2 themeaudit3) ;; secparity) expanded+=(secparityadmin secparityteam) ;; supparity) expanded+=(supparityadmin supparityteam) ;; docparity) expanded+=(docparityadmin docparityteam) ;; ctparity) expanded+=(ctparityadmin ctparityteam) ;; stparity) expanded+=(stparityadmin stparityteam) ;; *) expanded+=("$n") ;; esac
done
asked=("${expanded[@]}")
if [ $only_given -eq 1 ]; then only=","; for n in "${asked[@]}"; do only="$only$n,"; done; fi
known=","   # every suite name the runner reached, wanted or not: what --only is checked against
times="${TMPDIR:-/tmp}/ml-suite-times.txt"
[ $list -eq 1 ] || : > "$times"
wanted() { known="$known$1,"; [ -z "$only" ] || [[ "$only" == *",$1,"* ]]; }
run() {
  name=$1; wanted "$name" || return 0
  if [ $list -eq 1 ]; then echo "$name"; listed=$((listed+1)); return 0; fi
  printf '%-14s ' "$name"; shift
  t0=$SECONDS
  out=$("$@" 2>&1); rc=$?
  echo "$name $((SECONDS - t0))" >> "$times"
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
run actor       node tests/actor.js
run account     node tests/account.js
run suppliers   node tests/suppliers.js
run rfqpo       node tests/rfqpo.js
run contractdocs node tests/contractdocs.js
run stockroutes node tests/stockroutes.js
run containerroutes node tests/containerroutes.js
run notifications node tests/notifications.js
run submissions  node tests/submissions.js
run meetings     node tests/meetings.js
run calendar     node tests/calendar.js
run issues       node tests/issues.js
run modules     node tests/modules.js
run deployconfig node tests/deployconfig.js
run shards       node tests/shards.js
run spashell     node tests/spashell.js
run webunit      node tools/run-web-tests.js
run signinparity node tests/signinparity.js
run shellparity  node tests/shellparity.js
run notifparity node tests/notifparity.js
run subparity   node tests/subparity.js
run issparity   node tests/issparity.js
run meetparity  node tests/meetparity.js
run calparity   node tests/calparity.js
run secparityadmin node tests/secparity.js --only=admin
run secparityteam  node tests/secparity.js --only=team
run supparityadmin node tests/supparity.js --only=admin
run supparityteam  node tests/supparity.js --only=team
run docparityadmin node tests/docparity.js --only=admin
run docparityteam  node tests/docparity.js --only=team
run ctparityadmin  node tests/ctparity.js --only=admin
run ctparityteam   node tests/ctparity.js --only=team
run stparityadmin  node tests/stparity.js --only=admin
run stparityteam   node tests/stparity.js --only=team
run acctparity  node tests/acctparity.js
run webshell     node tests/webshell.js
run galleryaudit node tests/galleryaudit.js
run embed        node tests/embed.js
run webframe     node tests/webframe.js
run webpwa       node tests/webpwa.js
run webnotifs    node tests/webnotifs.js
run webissues    node tests/webissues.js
run webmeet      node tests/webmeet.js
run websecurity  node tests/websecurity.js
run websuppliers node tests/websuppliers.js
run webdocs      node tests/webdocs.js
run webcontracts node tests/webcontracts.js
run webstock     node tests/webstock.js
run webauth      node tests/webauth.js
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
run themeaudit1 node tests/themeaudit.js --part=1/3
run themeaudit2 node tests/themeaudit.js --part=2/3
run themeaudit3 node tests/themeaudit.js --part=3/3
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
  if [ $list -eq 1 ]; then echo smoke; listed=$((listed+1)); else
    printf '%-14s ' "smoke"
    t0=$SECONDS
    if out=$(node tools/smoke-routes.js 2>&1); then echo "$out" | tail -1; pass=$((pass+1));
    else echo "$out" | grep -E "BROKEN|exercised|BLIND|escaped a handler" | tail -6; fail=$((fail+1)); fi
    echo "smoke $((SECONDS - t0))" >> "$times"
  fi
fi

if wanted routes; then
  if [ $list -eq 1 ]; then echo routes; listed=$((listed+1)); else
    printf '\n%-14s ' "routes"
    t0=$SECONDS
    # The legacy routes must be exactly the snapshot; /api/v1 is fingerprinted beside it, with its guards.
    if out=$(node tools/route-inventory.js --check 2>&1); then
      echo "$out" | grep -E "^inventory matches" | tail -1; pass=$((pass+1))
    else
      echo "$out" | grep -E "^(ROUTES CHANGED|  )"; fail=$((fail+1))
    fi
    echo "routes $((SECONDS - t0))" >> "$times"
  fi
fi

# A name that matches nothing would run nothing and pass — and CI selects its suites by name.
if [ $only_given -eq 1 ]; then
  for n in "${asked[@]}"; do
    [[ "$known" == *",$n,"* ]] || { echo "no suite is called '$n' (the names are the first column of a full run)" >&2; fail=$((fail+1)); }
  done
  [ $((pass + fail + listed)) -gt 0 ] || { echo "--only matched no suite" >&2; fail=1; }
fi

if [ $list -eq 1 ]; then [ $fail -eq 0 ]; exit; fi
echo; echo "$pass suite(s) green, $fail red"
[ $fail -eq 0 ]
