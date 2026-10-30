import { useMemo, useState } from 'react';
import { SignIn } from '../auth/SignIn';
import type { Me } from '../lib/api';
import type { Arrival } from '../lib/arrival';
import { makeAuthApi, type AuthApi } from '../lib/auth-api';
import { classicUrl, readEnv, switchToClassicUrl, type MlEnv } from '../lib/env';
import { useMe, type UseMeDeps } from './useMe';

function Who({ me, env, onSignOut }: { me: Me; env: MlEnv; onSignOut: () => void }) {
  const { actor, caps, sections, workspace } = me;
  return (
    <>
      <h2>Signed in as {actor.name || 'you'}</h2>
      <dl className="facts">
        <dt>Account</dt>
        <dd>
          {actor.kind === 'admin'
            ? 'Administrator'
            : `Team member${actor.jobTitle ? ` · ${actor.jobTitle}` : ''}`}
        </dd>
        <dt>Allowed to</dt>
        <dd>
          {caps === '*'
            ? 'do everything'
            : `${caps.length} ${caps.length === 1 ? 'action' : 'actions'}`}
        </dd>
        <dt>Sections</dt>
        <dd>
          {sections === '*' ? 'all of them' : sections.length ? sections.join(', ') : 'none yet'}
        </dd>
        <dt>Workspace</dt>
        <dd>{workspace.name}</dd>
      </dl>
      <div className="actions">
        <a className="btn" href={classicUrl(env.portal)}>
          Open the classic portal
        </a>
        <button type="button" className="btn secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <p className="muted">
        The modules are still in the classic portal; they move here one at a time.
      </p>
    </>
  );
}

export interface AppProps {
  env?: MlEnv;
  /** what the page was opened for (Google's return, a reset link), read once at start-up */
  arrival?: Arrival | undefined;
  deps?: UseMeDeps;
  /** for tests; the portal's own sign-in routes otherwise */
  api?: AuthApi;
}

/**
 * The foundation: it opens with the workspace's look and asks who you are. Nobody yet — the sign-in screens, with
 * everything the classic portal's has; somebody — who, and a way out. The modules come next.
 */
export function App({ env = readEnv(), arrival, deps, api }: AppProps) {
  const calls = useMemo(
    () => api ?? makeAuthApi(env.portal, deps?.fetchImpl),
    [api, env.portal, deps?.fetchImpl],
  );
  const { state, retry, signedIn, signOut } = useMe(env.portal, {
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

        {state.phase === 'signed-in' && (
          <Who
            me={state.me}
            env={env}
            onSignOut={() => {
              setOpened({});
              signOut(ending => void calls.signOut(ending));
            }}
          />
        )}

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
