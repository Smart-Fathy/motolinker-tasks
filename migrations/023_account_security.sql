-- 023: sign-in record and two-factor authentication
--
-- login_events is the account's own history: every sign-in, from which browser and
-- address, and whether that browser had signed in to this account before. It is what
-- lets the app tell a person "someone signed in from a device you have not used" and
-- show them their recent sign-ins, and it is how a returning browser is recognised
-- (by the hash of a cookie the server sets — never the cookie itself).
--
-- account_security holds the second factor, one row per account. `kind` is 'admin' or
-- 'employee' and account_id is 'admin' or the employee's id, so the single
-- environment-variable admin and the employees table are covered by one design and
-- a secret never has to sit in a column that `select('*')` on employees would return.
-- totp_secret / totp_pending are sealed with MFA_ENCRYPTION_KEY when it is set
-- (see src/lib/secret-box.js); recovery_codes holds SHA-256 hashes, never the codes.
--
-- Nothing here is needed for the app to boot or for sign-in to work: without this
-- migration nobody has a second factor, sign-ins are not recorded, and every sign-in
-- is treated as a new device (so it alerts). Sessions and password-change revocation
-- (the critical fix) need no schema at all.
--
-- Apply by hand against the Supabase project, like every other file in this
-- directory. Idempotent.

CREATE TABLE IF NOT EXISTS public.login_events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,                       -- 'admin' | 'employee'
  account_id  TEXT NOT NULL,                       -- 'admin' or the employee's id
  event       TEXT NOT NULL DEFAULT 'login',       -- 'login' | 'mfa_failed' | ...
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip          TEXT,
  user_agent  TEXT,
  device      TEXT,                                -- "Chrome on Windows"
  device_hash TEXT,                                -- sha256 of the browser's device cookie
  method      TEXT,                                -- password | google | password+2fa | google+2fa | ...+recovery
  new_device  BOOLEAN NOT NULL DEFAULT FALSE
);

-- "Show me this account's recent sign-ins", newest first.
CREATE INDEX IF NOT EXISTS idx_login_events_account ON public.login_events (kind, account_id, at DESC);
-- "Has this browser signed in to this account before?" — a point lookup per sign-in.
CREATE INDEX IF NOT EXISTS idx_login_events_device  ON public.login_events (kind, account_id, device_hash) WHERE event = 'login';

CREATE TABLE IF NOT EXISTS public.account_security (
  kind           TEXT NOT NULL,                    -- 'admin' | 'employee'
  account_id     TEXT NOT NULL,                    -- 'admin' or the employee's id
  totp_secret    TEXT,                             -- the confirmed secret (sealed)
  totp_pending   TEXT,                             -- a secret shown at setup, not yet confirmed (sealed)
  totp_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_codes JSONB   NOT NULL DEFAULT '[]'::jsonb,   -- SHA-256 of each unused code
  last_step      BIGINT  NOT NULL DEFAULT 0,       -- last 30-second step accepted: a code cannot be replayed
  enabled_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, account_id)
);

-- Same posture as every other table: RLS on with no policies, so only the service
-- role the server uses can read or write them.
ALTER TABLE IF EXISTS public.login_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.account_security ENABLE ROW LEVEL SECURITY;
