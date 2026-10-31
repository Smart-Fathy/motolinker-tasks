import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, MemoryRouter } from 'react-router';
import { makeApi, portalBase, type Me, type Profile } from '../lib/api';
import type { MlEnv, Portal } from '../lib/env';
import { refreshPush } from '../lib/pwa';
import { makeQueryClient } from '../lib/query';
import { createStream } from '../lib/sse';
import { throttle } from '../lib/throttle';
import { Theme } from '../lib/theme';
import { createToasts } from '../lib/toasts';
import { accessOf } from './access';
import { SessionContext, type SessionValue } from './context';
import { AppRoutes } from './routes';

export interface SessionProps {
  env: MlEnv;
  me: Me;
  token: string;
  /** the person asked to leave */
  signOut: () => void;
  /** a call came back 401: ask the server whether the session is over */
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
  /** tests: keep the address in memory, opening at these */
  entries?: string[];
  safe?: boolean;
}

/** The address the server hands the app is under its portal's own ('/dashboard', '/employee'); the dev server's is not. */
export function basenameFor(portal: Portal, pathname: string): string {
  const base = portal === 'team' ? '/employee' : '/dashboard';
  return pathname === base || pathname.startsWith(base + '/') ? base : '';
}

const RECHECK_EVERY_MS = 5000;
const NO_CHANGES: Partial<Profile> = {};

/**
 * Everything one signed-in session owns, and nothing that outlives it: its data (a new session starts empty, so one person's
 * data can never show to the next), its live stream, the look it wears and the address it is at. Leaving drops all of it.
 */
export function Session({
  env,
  me,
  token,
  signOut,
  onUnauthorized,
  fetchImpl,
  entries,
  safe,
}: SessionProps) {
  const portal = env.portal;
  const [isSafe] = useState(
    () => safe ?? new URLSearchParams(window.location.search).get('safe') === '1',
  );
  const [client] = useState(makeQueryClient);
  const [toasts] = useState(createToasts);
  const access = useMemo(() => accessOf(me), [me]);
  // What the person has just changed about themselves is shown before the server is asked again; a fresh answer from the
  // server (a new `me`) replaces it, the server being the one that knows.
  const [changes, setChanges] = useState<{ for: Me; profile: Partial<Profile> }>({
    for: me,
    profile: NO_CHANGES,
  });
  const own = changes.for === me ? changes.profile : NO_CHANGES;
  const shown = useMemo(
    () => (me.profile ? { ...me, profile: { ...me.profile, ...own } } : me),
    [me, own],
  );
  const updateProfile = useCallback(
    (more: Partial<Profile>) =>
      setChanges(c => ({
        for: me,
        profile: { ...(c.for === me ? c.profile : NO_CHANGES), ...more },
      })),
    [me],
  );

  // (the owner of the session — App — hands this over unchanged between renders)
  const asked = useMemo(() => throttle(onUnauthorized, RECHECK_EVERY_MS), [onUnauthorized]);

  const api = useMemo(
    () => makeApi({ portal, token, onUnauthorized: asked, ...(fetchImpl ? { fetchImpl } : {}) }),
    [portal, token, asked, fetchImpl],
  );
  const [theme] = useState(
    () => new Theme({ safe: isSafe, initial: { name: env.workspaceName, texts: env.texts } }),
  );
  const stream = useMemo(
    () =>
      createStream({
        url: `${portalBase(portal)}/notifications/stream?hd=2`,
        token,
        ...(fetchImpl ? { fetchImpl } : {}),
      }),
    [portal, token, fetchImpl],
  );

  // The workspace as it is now, and what this person chose for the colours.
  useEffect(() => {
    void theme.load(fetchImpl);
    void theme.syncPrefs(api);
    return theme.start();
  }, [theme, api, fetchImpl]);

  // A push subscription this person made before is told to the server again (the app's own worker is the one that shows it).
  useEffect(() => {
    const done = new AbortController();
    void refreshPush(
      subscription => api.post(`${api.base}/push/subscribe`, subscription),
      done.signal,
    );
    return () => done.abort();
  }, [api]);
  // …and again when the server has forgotten it (it clears a person's subscriptions with the sessions it signs out).
  const resubscribePush = useCallback(
    () => void refreshPush(subscription => api.post(`${api.base}/push/subscribe`, subscription)),
    [api],
  );

  // The live stream: the admin changing the look reaches every open page; a refusal about the session is asked about.
  useEffect(() => {
    const offLook = stream.on('workspace', data => {
      try {
        theme.apply(JSON.parse(data));
      } catch {
        /* not a profile: nothing to wear */
      }
    });
    const offStatus = stream.onStatus(status => {
      if (status === 'unauthorized') asked();
    });
    const wake = () => stream.reconnectNow();
    const forward = () => {
      if (document.visibilityState === 'visible') wake();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', forward);
    stream.start();
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', forward);
      offLook();
      offStatus();
      stream.close();
    };
  }, [stream, theme, asked]);

  const value = useMemo<SessionValue>(
    () => ({
      portal,
      env,
      me: shown,
      access,
      safe: isSafe,
      api,
      theme,
      stream,
      toasts,
      signOut,
      updateProfile,
      resubscribePush,
      recheck: asked,
    }),
    [
      portal,
      env,
      shown,
      access,
      isSafe,
      api,
      theme,
      stream,
      toasts,
      signOut,
      updateProfile,
      resubscribePush,
      asked,
    ],
  );

  const routes = <AppRoutes />;
  return (
    <QueryClientProvider client={client}>
      <SessionContext value={value}>
        {entries ? (
          <MemoryRouter initialEntries={entries}>{routes}</MemoryRouter>
        ) : (
          <BrowserRouter basename={basenameFor(portal, window.location.pathname)}>
            {routes}
          </BrowserRouter>
        )}
      </SessionContext>
    </QueryClientProvider>
  );
}
