import type { Portal } from './env';

// The new app and the classic portals are one origin, so they share localStorage — and the keys the classic
// pages already use are kept, so signing in on either is signing in on both while they exist side by side.
export const TOKEN_KEY: Record<Portal, string> = { admin: 'ml_admin_token', team: 'ml_emp_token' };

type Reader = Pick<Storage, 'getItem'>;
type Remover = Pick<Storage, 'removeItem'>;

// Storage can be missing or can throw (a private window, blocked site data): that is "no token", not a crash.
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readToken(
  portal: Portal,
  storage: Reader | null = browserStorage(),
): string | null {
  try {
    const t = storage?.getItem(TOKEN_KEY[portal]);
    return t ? t : null;
  } catch {
    return null;
  }
}

export function clearToken(portal: Portal, storage: Remover | null = browserStorage()): void {
  try {
    storage?.removeItem(TOKEN_KEY[portal]);
  } catch {
    /* nothing to clear if storage cannot be reached */
  }
}
