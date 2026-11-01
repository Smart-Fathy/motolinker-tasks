import type { Where } from './arrival';

// Google can send a person back from Google Chat's consent screen with the reason it would not link them in the address
// (?gchat_error=…, written by the server's /api/email/callback). Read once, at start-up, and taken out of the address bar at once:
// the screen is reached through a redirect to its own address, which would drop it, and a reason has no business staying in the
// address bar, where it would be copied, bookmarked and sent along as a referrer. The screen shows it once.

const PARAM = 'gchat_error';
// The server writes Google's own words, or one sentence of its own (about a hundred characters); nothing longer belongs in front of someone.
const MAX_REASON = 300;

const here = (): Where => ({ location: window.location, history: window.history });

let held: string | null = null;

/** Read the reason out of the address, if there is one, and take it out of the address bar (everything else in it stays). */
export function takeChatReturn(where: Where = here()): void {
  const url = new URL(where.location.href);
  const reason = url.searchParams.get(PARAM);
  if (reason === null) return;
  url.searchParams.delete(PARAM);
  const rest = url.searchParams.toString();
  where.history.replaceState(
    where.history.state,
    '',
    url.pathname + (rest ? `?${rest}` : '') + url.hash,
  );
  // (an empty reason is no reason: the classic page showed nothing for it either)
  held = reason ? reason.slice(0, MAX_REASON) : null;
}

/** The reason the person was sent back with, if they were and the screen has not shown it yet. */
export const chatReturn = (): string | null => held;

/** The screen has shown it. */
export function clearChatReturn(): void {
  held = null;
}
