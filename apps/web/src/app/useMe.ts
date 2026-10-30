import { useCallback, useEffect, useState } from 'react';
import { getMe, type Me, type MeResult } from '../lib/api';
import type { Portal } from '../lib/env';
import { clearToken, readToken } from '../lib/session';

export type MeState =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'signed-in'; me: Me }
  | { phase: 'unavailable'; status: number }
  | { phase: 'network' };

/** Seams for tests; the page's own storage and fetch otherwise. */
export interface UseMeDeps {
  storage?: Pick<Storage, 'getItem' | 'removeItem'> | null;
  fetchImpl?: typeof fetch;
}

/**
 * Who is signed in here, as the server says. The token is the one the classic portal keeps (same origin, same
 * key), so a person signed in there is signed in here; a token the server no longer recognises is removed, as
 * the classic portal removes it.
 */
export function useMe(
  portal: Portal,
  { storage, fetchImpl }: UseMeDeps = {},
): { state: MeState; retry: () => void } {
  const [token, setToken] = useState<string | null>(() => readToken(portal, storage));
  const [result, setResult] = useState<MeResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const ctl = new AbortController();
    getMe(token, { signal: ctl.signal, fetchImpl })
      .then(r => {
        if (ctl.signal.aborted) return;
        if (r.kind === 'unauthorized') {
          clearToken(portal, storage);
          setToken(null);
        } else {
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

  let state: MeState;
  if (!token) state = { phase: 'signed-out' };
  else if (!result) state = { phase: 'loading' };
  else if (result.kind === 'ok') state = { phase: 'signed-in', me: result.me };
  else if (result.kind === 'unavailable') state = { phase: 'unavailable', status: result.status };
  else state = { phase: 'network' };
  return { state, retry };
}
