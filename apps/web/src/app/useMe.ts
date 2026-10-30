import { useCallback, useEffect, useRef, useState } from 'react';
import { getMe, type Me, type MeResult } from '../lib/api';
import type { Portal } from '../lib/env';
import { clearToken, readToken, writeToken } from '../lib/session';

export type MeState =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'signed-in'; me: Me }
  | { phase: 'unavailable'; status: number }
  | { phase: 'network' };

/** Seams for tests; the page's own storage and fetch otherwise. */
export interface UseMeDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  fetchImpl?: typeof fetch;
  /** a session the page was handed on arrival (Google's return): used even if storage will not keep it */
  initialToken?: string | undefined;
}

/**
 * Who is signed in here, as the server says. The token is the one the classic portal keeps (same origin, same
 * key), so a person signed in there is signed in here; a token the server no longer recognises is removed, as
 * the classic portal removes it.
 *
 * Nothing but a "no" from the server about the token itself ends a session: a server that is down, slow or
 * unreadable leaves the person signed in (and says so), and only an explicit sign-out clears it from this side.
 */
export function useMe(
  portal: Portal,
  { storage, fetchImpl, initialToken }: UseMeDeps = {},
): {
  state: MeState;
  /** the session the answer belongs to (null: nobody is signed in) */
  token: string | null;
  retry: () => void;
  /**
   * Ask again who this is, without losing the screen: something said "no" (a call came back 401) and only the server's
   * answer about the token itself decides whether the session is over. A server that cannot answer leaves things as they are.
   */
  recheck: () => void;
  /** a sign-in succeeded: keep the session (for the next load, and for the classic portal) and find out who it is */
  signedIn: (token: string) => void;
  /** leave: `notify` is told the session that is ending (to tell the server), then it is forgotten here */
  signOut: (notify?: (token: string) => void) => void;
} {
  const [token, setToken] = useState<string | null>(
    () => initialToken || readToken(portal, storage),
  );
  const [result, setResult] = useState<MeResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const quiet = useRef(false);

  useEffect(() => {
    if (!token) return;
    const ctl = new AbortController();
    const asked = quiet.current;
    quiet.current = false;
    getMe(token, { signal: ctl.signal, fetchImpl })
      .then(r => {
        if (ctl.signal.aborted) return;
        if (r.kind === 'unauthorized') {
          clearToken(portal, storage);
          setToken(null);
        } else if (!asked || r.kind === 'ok') {
          setResult(r);
        }
      })
      .catch(() => {
        /* cancelled: a newer request or an unmounted page owns the state now */
      });
    return () => ctl.abort();
  }, [token, attempt, portal, storage, fetchImpl]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt(a => a + 1);
  }, []);

  const recheck = useCallback(() => {
    quiet.current = true;
    setAttempt(a => a + 1);
  }, []);

  const signedIn = useCallback(
    (fresh: string) => {
      writeToken(portal, fresh, storage);
      setResult(null);
      setToken(fresh);
    },
    [portal, storage],
  );

  const signOut = useCallback(
    (notify?: (ending: string) => void) => {
      if (token) notify?.(token);
      clearToken(portal, storage);
      setResult(null);
      setToken(null);
    },
    [token, portal, storage],
  );

  let state: MeState;
  if (!token) state = { phase: 'signed-out' };
  else if (!result) state = { phase: 'loading' };
  else if (result.kind === 'ok') state = { phase: 'signed-in', me: result.me };
  else if (result.kind === 'unavailable') state = { phase: 'unavailable', status: result.status };
  else state = { phase: 'network' };
  return { state, token, retry, recheck, signedIn, signOut };
}
