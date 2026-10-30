# Test baseline

What "green" means today, so a later change can be compared with it. Recorded at `7afaefb` (the end of
the tooling / contracts / actor run), on the machine described below, by running the whole of
`bash tests/run.sh` three times in a row in a clean checkout.

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| suites green | 86 | 86 | 86 |
| suites red | 0 | 0 | 0 |
| wall clock | 963 s | 937 s | 938 s |

- **Nothing flaked.** The three outputs are byte-identical: every suite printed the same counts every
  time (about 3,450 individual checks in the suites that print `N/N`). There is no flaky suite to record
  — if one appears, it goes here with its symptom and what was done.
- **86 is 84 listed suites plus `smoke` and `routes`.** One of the 84, `docpo`, is a placeholder that
  prints `0/0 passed` (the purchase-order PDF has no test yet), so 85 suites check something.
- **Serial on one machine, on purpose.** The suites use fixed ports, so they cannot run side by side on a
  machine; that is why a full run is about 16 minutes and not less on a bigger one. CI gets its speed from
  more machines instead: `--shard I/N` (see the README, "Tests").
- Two suites can use a tool a plain machine may lack. `relaytest` checks its success case against a
  real coturn on `127.0.0.1:3478` only when `LIVE_TURN=1` is set (it was not, above), and `docrfq`
  prints its workbooks through LibreOffice (installed on this machine, so those checks ran; it skips
  them when `soffice` is missing). The main CI job runs both without installing anything; the nightly
  job installs coturn and LibreOffice and runs both for real.

## The machine

4 vCPU, 15 GB, Linux 6.18, Node 22.22.0, npm 10.9.4, Chromium 1194 / 1243 from the dev image,
puppeteer 24.40.0. A GitHub-hosted runner for a public repository has the same four cores; the CI suite
job's timeout is 75 minutes, several times the measured run.

## On the runtime production has

The numbers above were taken on Node 22 while production still ran Node 18.20.8; the suites that cover
the new server code (`contracts`, `actor`, `permstest`, the route inventory and `smoke`) also passed on
18.20.8 then, in a tree assembled the way Railway's builder assembles it. Production now builds with
Node 22.x — the major these suites run on, and the one CI reads from `package.json` — behind a healthcheck
(see the README, "How production is built").

## On a hosted runner

The first GitHub Actions run of the suite (the Run 1 merge; `ubuntu-24.04`, Node 22.23.4) took 14 min 44 s
and passed 85 of 86 suites. The one that differed was `themeaudit`. The dev image cannot reach
`cdnjs.cloudflare.com`, so Leaflet (loaded lazily on the stock Tracking page) had never rendered in a
local run; on the runner it did, and the audit judged its attribution control against map tiles it cannot
see. The audit now refuses every request that is not to the page's own server, so it sees the same page
on every machine. Whether that attribution text is readable enough on the real map is a separate, open
question about third-party chrome.

## One known intermittent: `webpwa`

Part `turns` ("…then the app puts its worker back in charge") occasionally fails: the new app's worker finishes
installing (it has called `skipWaiting()`) and then stays `waiting` behind the classic portal's worker for the whole
15-second wait. It is older than the notifications work (merged main shows it too) and is about one run in twenty here;
through an outbound proxy (this sandbox has one) it is about one in two, which is why the browser is launched without
the proxy variables (`http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`) in its environment. Measured so far: stopping the classic worker at that moment lets the app's activate at once, and a
request the active worker answered with a never-ending body holds a waiting worker back while an open stream it does not
answer does not — so something the classic worker answered, or is still doing, is open, and nothing visible in the page says
what. `PWA_ONLY=turns node tests/webpwa.js` in a loop reproduces it; a person who goes from the classic portal to the app
can end a visit without the app's worker in charge (the next visit has it). A failed run of this suite on its own is worth
one re-run before it is worth a look.

A second failure showed up once, on hosted CI only, and is not explained: the first check of the push part ("a push is
shown…") timed out twice in a row while the browser was launched with `--no-proxy-server`, and passed on the run after that
flag was gone. It does not happen here, however the hosted run is imitated (the same Chrome, two cores, a loaded machine, no
proxy variables). If it comes back, the failure now prints what the browser knew: the notification permission, the
registration's workers, what `getNotifications()` holds, whether the worker can show a notification itself, the page's
errors and the last requests the server saw.

## When a suite goes red

The runner prints the last line of each suite, which is rarely the line that says what went wrong; the
whole output is saved to `$TMPDIR/ml-suite-<name>.txt` (or `/tmp`), and CI prints those files when the
job fails. `bash tests/run.sh --only <name>` runs one suite — and exits non-zero on a name that matches
nothing, so a typo cannot pass.
