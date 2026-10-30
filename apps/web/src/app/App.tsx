import { lazy, Suspense, useMemo, useState } from 'react';
import { SignIn } from '../auth/SignIn';
import type { Arrival } from '../lib/arrival';
import { makeAuthApi, type AuthApi } from '../lib/auth-api';
import { readEnv, switchToClassicUrl, type MlEnv } from '../lib/env';
import { galleryAt } from '../gallery/route';
import { Session } from './Session';
import { useMe, type UseMeDeps } from './useMe';

export interface AppProps {
  env?: MlEnv;
  /** what the page was opened for (Google's return, a reset link), read once at start-up */
  arrival?: Arrival | undefined;
  deps?: UseMeDeps;
  /** for tests; the portal's own sign-in routes otherwise */
  api?: AuthApi;
  /** for tests: keep the address in memory and open at these */
  entries?: string[];
}

/** A chunk of its own: the page the app opens with does not carry the gallery (tests/spashell.js holds it to that). */
const Gallery = lazy(() => import('../gallery/Gallery'));

/** The product, or — at <portal>/__gallery, which needs no session — the page that shows its parts under any look. */
export function App(props: AppProps) {
  const [gallery] = useState(() => !props.entries && galleryAt(window.location.pathname));
  return gallery ? (
    <Suspense fallback={null}>
      <Gallery portal={(props.env ?? readEnv()).portal} />
    </Suspense>
  ) : (
    <Product {...props} />
  );
}

/**
 * It opens in the workspace's look and asks who you are. Nobody yet — the sign-in screens, with everything the classic
 * portal's has; somebody — their Session: the frame, with the screens that have moved in it.
 */
function Product({ env = readEnv(), arrival, deps, api, entries }: AppProps) {
  const calls = useMemo(
    () => api ?? makeAuthApi(env.portal, deps?.fetchImpl),
    [api, env.portal, deps?.fetchImpl],
  );
  const { state, token, retry, recheck, signedIn, signOut } = useMe(env.portal, {
    ...deps,
    initialToken: arrival?.token,
  });
  // What the page was opened for belongs to the first sign-in screen only: once somebody has signed in, or out, the
  // challenge or reset link it carried is spent, and the next sign-in screen starts from the password.
  const [opened, setOpened] = useState<Arrival>(arrival ?? {});

  if (state.phase === 'signed-out') {
    return (
      <SignIn
        env={env}
        arrival={opened}
        api={calls}
        onSignedIn={token => {
          setOpened({});
          signedIn(token);
        }}
      />
    );
  }

  if (state.phase === 'signed-in' && token) {
    return (
      <Session
        key={token}
        env={env}
        me={state.me}
        token={token}
        {...(deps?.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})}
        onUnauthorized={recheck}
        signOut={() => {
          setOpened({});
          signOut(ending => void calls.signOut(ending));
        }}
        {...(entries ? { entries } : {})}
      />
    );
  }

  return (
    <main className="page">
      <header className="header">
        <h1>{env.workspaceName}</h1>
        <span className="badge">
          {env.portal === 'team' ? 'Team portal' : 'Admin'} · new app, preview
        </span>
      </header>

      <section className="card" aria-live="polite">
        {state.phase === 'loading' && <p role="status">Checking your session…</p>}

        {state.phase === 'unavailable' && (
          <>
            <h2>The server cannot answer just now</h2>
            <p className="muted">
              {state.status === 503
                ? 'It cannot reach its database.'
                : `It answered with an error (${state.status}).`}{' '}
              Your session is not lost.
            </p>
            <div className="actions">
              <button type="button" className="btn" onClick={retry}>
                Try again
              </button>
            </div>
          </>
        )}

        {state.phase === 'network' && (
          <>
            <h2>Cannot reach the server</h2>
            <p className="muted">Check the connection. Your session is not lost.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={retry}>
                Try again
              </button>
            </div>
          </>
        )}
      </section>

      <p className="footer">
        This is the new MotoLinker app, in preview.{' '}
        <a href={switchToClassicUrl(env.portal)}>Go back to the classic portal</a>.
      </p>
    </main>
  );
}
