import type { Portal } from './env';
import { writeToken } from './session';

// A page can be opened by something other than a person typing its address: Google, sending someone back after
// "Sign in with Google" (src/index.js, the /api/email/callback handler), or the link in a password-reset email
// (src/routes/employee-portal.js). Both are the team portal's, and both say what they mean in the query string.
// Read once, at start-up, and taken out of the address bar at once: a session token or a single-use code has no
// business staying in the address bar, where it would be copied, bookmarked and sent along as a referrer.

/** What the page was opened for. Empty for an ordinary visit. */
export interface Arrival {
  /** Google signed the person in: this is their session (already kept, like any sign-in) */
  token?: string;
  /** Google signed the person in, and the account has a second step: the code is still to come */
  mfaToken?: string;
  /** the link in a password-reset email */
  resetToken?: string;
  /** Google could not sign the person in */
  error?: string;
}

const PARAMS = ['emp_token', 'mfa_token', 'google_login_error', 'reset'] as const;
// The server writes one of two short sentences or a short refusal; nothing longer belongs in front of someone.
const MAX_ERROR = 200;

export interface Where {
  location: Pick<Location, 'href'>;
  history: Pick<History, 'replaceState' | 'state'>;
  storage?: Pick<Storage, 'setItem'> | null;
}

const here = (): Where => ({ location: window.location, history: window.history });

export function takeArrival(portal: Portal, where: Where = here()): Arrival {
  // The admin portal has no Google sign-in and no reset email; a query string like that is not for it.
  if (portal !== 'team') return {};
  const url = new URL(where.location.href);
  const params = url.searchParams;
  if (!PARAMS.some(name => params.has(name))) return {};

  const token = params.get('emp_token');
  const mfaToken = params.get('mfa_token');
  const error = params.get('google_login_error');
  const resetToken = params.get('reset');

  // Out of the address bar first, so nothing below can leave a secret there. Everything else in it stays.
  for (const name of PARAMS) params.delete(name);
  const rest = params.toString();
  where.history.replaceState(
    where.history.state,
    '',
    url.pathname + (rest ? `?${rest}` : '') + url.hash,
  );

  // A session is a session: it goes where every sign-in's goes, and the app finds it there.
  if (token) {
    writeToken('team', token, where.storage);
    return { token };
  }
  const arrival: Arrival = {};
  if (mfaToken) arrival.mfaToken = mfaToken;
  if (resetToken) arrival.resetToken = resetToken;
  if (error) arrival.error = error.slice(0, MAX_ERROR);
  return arrival;
}
