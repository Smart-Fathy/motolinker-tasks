import type { Portal } from './env';

// The server's sign-in routes, as the classic portals call them (public/assets/dashboard.js, employee.js). Both
// portals answer the same shapes; only the paths differ. Every call here ends in a result the screen can act on,
// never a thrown error: a server that is down or slow is an answer too, and it must not sign anybody out (this file
// never touches the stored token — the caller decides what a result means for it).

const PATHS = {
  admin: { login: '/api/auth/login', code: '/api/auth/login/2fa', logout: '/api/auth/logout' },
  team: {
    login: '/api/employee/login',
    code: '/api/employee/login/2fa',
    logout: '/api/employee/logout',
  },
} as const satisfies Record<Portal, { login: string; code: string; logout: string }>;

// Team only: the admin account's password is the server's setting, not something a person resets by email.
const FORGOT_PATH = '/api/employee/forgot-password';
const RESET_PATH = '/api/employee/reset-password';

/** The server said no (or something unreadable): `message` is its own words, ready to show. */
interface Failed {
  kind: 'failed';
  message: string;
  status: number;
}
/** The server could not be reached at all. */
interface Unreachable {
  kind: 'network';
}

export type SignInResult =
  | { kind: 'signed-in'; token: string }
  /** the password was right and the account has a second step: no session yet, only a challenge to answer */
  | { kind: 'code-needed'; mfaToken: string }
  | Failed
  | Unreachable;

export type CodeResult =
  | { kind: 'signed-in'; token: string }
  /** the challenge is gone (it ran out, was used, or too many wrong codes were tried): back to the password */
  | { kind: 'expired'; message: string }
  | Failed
  | Unreachable;

export type MailResult = { kind: 'done' } | Failed | Unreachable;

export interface AuthApi {
  signIn(username: string, password: string): Promise<SignInResult>;
  /** the six digits of the authenticator app, or one of the recovery codes */
  verifyCode(mfaToken: string, code: string): Promise<CodeResult>;
  /** team only */
  forgotPassword(email: string): Promise<MailResult>;
  /** team only */
  resetPassword(resetToken: string, newPassword: string): Promise<MailResult>;
  /** best effort: a person who is leaving is not kept waiting for a server that will not answer */
  signOut(token: string): Promise<void>;
}

type Body = Record<string, unknown>;
interface Reply {
  status: number;
  ok: boolean;
  body: Body;
}

const isRecord = (v: unknown): v is Body =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const line = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** What to say when the server gave no words of its own (a gateway's error page, an empty body). */
function sayFor(status: number, otherwise: string): string {
  if (status === 429) return 'Too many attempts. Try again in a moment.';
  if (status >= 500) return 'The server could not answer just now. Try again in a moment.';
  return otherwise;
}

export function makeAuthApi(
  portal: Portal,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): AuthApi {
  const paths = PATHS[portal];

  /** null: the server could not be reached */
  async function post(path: string, payload: unknown, token?: string): Promise<Reply | null> {
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      return null;
    }
    let body: Body = {};
    try {
      const parsed: unknown = await res.json();
      if (isRecord(parsed)) body = parsed;
    } catch {
      /* a gateway's HTML page, or nothing at all: the status says what happened */
    }
    return { status: res.status, ok: res.ok, body };
  }

  const failed = (r: Reply, otherwise: string): Failed => ({
    kind: 'failed',
    status: r.status,
    message: line(r.body['error']) ?? sayFor(r.status, otherwise),
  });

  return {
    async signIn(username, password) {
      const r = await post(paths.login, { username, password });
      if (!r) return { kind: 'network' };
      if (r.ok) {
        const mfaToken = line(r.body['mfa_token']);
        if (r.body['mfa_required'] === true && mfaToken) return { kind: 'code-needed', mfaToken };
        const token = line(r.body['token']);
        if (token && r.body['mfa_required'] !== true) return { kind: 'signed-in', token };
      }
      return failed(r, 'Could not sign in.');
    },

    async verifyCode(mfaToken, code) {
      const r = await post(paths.code, { mfa_token: mfaToken, code });
      if (!r) return { kind: 'network' };
      const token = line(r.body['token']);
      if (r.ok && token) return { kind: 'signed-in', token };
      if (r.body['expired'] === true) {
        return {
          kind: 'expired',
          message: line(r.body['error']) ?? 'Your sign-in expired. Enter your password again.',
        };
      }
      return failed(r, 'That code did not work.');
    },

    async forgotPassword(email) {
      const r = await post(FORGOT_PATH, { email });
      if (!r) return { kind: 'network' };
      return r.ok ? { kind: 'done' } : failed(r, 'Could not send the link.');
    },

    async resetPassword(resetToken, newPassword) {
      const r = await post(RESET_PATH, { token: resetToken, newPassword });
      if (!r) return { kind: 'network' };
      return r.ok ? { kind: 'done' } : failed(r, 'Could not update the password.');
    },

    async signOut(token) {
      await post(paths.logout, {}, token);
    },
  };
}
