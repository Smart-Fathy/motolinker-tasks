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
- **Serial on purpose.** The suites use fixed ports, so they cannot run side by side; that is why a full
  run is about 16 minutes and not less on a bigger machine.
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

Production builds with Node 18.20.8 (see the README, "How production is built"); the suites above ran
on Node 22. The suites that cover the new server code — `contracts` 26/26, `actor` 30/30, `permstest`
82/82, the route inventory and `smoke` (465 routes) — were also run on 18.20.8, in a tree assembled the
way Railway's builder assembles it (manifests only, `npm install`, the source over the top,
`npm run build`), and pass there too.

## When a suite goes red

The runner prints the last line of each suite, which is rarely the line that says what went wrong; the
whole output is saved to `$TMPDIR/ml-suite-<name>.txt` (or `/tmp`), and CI prints those files when the
job fails. `bash tests/run.sh --only <name>` runs one suite — and exits non-zero on a name that matches
nothing, so a typo cannot pass.
