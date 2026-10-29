# Parity

The portals are being ported to one codebase, module by module (see the README's "Migrating to one
codebase"). "It looks and works the same" is shown, not asserted. Two things carry the proof:

- **Pictures.** `node tools/parity/shoot-legacy.js` photographs every page of both legacy portals
  (admin 28, team 24) in light and dark at 1440 and 390 px, plus the sign-in screens, into `.parity/legacy`
  (git-ignored; CI can upload it as an artifact). The page list is read from the page, and a page that
  will not open is reported as a problem instead of being photographed as Home. The same script, run
  against the new app (`--ui next`), produces the other half of each side-by-side review.
- **A feature matrix per module** (`docs/parity/<module>.md`, written as each module is ported): one row
  per API call, inline handler and permission gate found in the legacy code, each linked to a test or to
  a recorded decision. A module is done when no row is open.

Nothing here is pixel-gated: the new DOM is different on purpose, so approved pictures become the
regression baseline for the new app instead.
