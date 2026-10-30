import { classicUrl, readEnv, switchToClassicUrl, type MlEnv } from '../lib/env';
import type { Me } from '../lib/api';
import { useMe, type UseMeDeps } from './useMe';

function Who({ me, env }: { me: Me; env: MlEnv }) {
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
      </div>
      <p className="muted">
        The modules are still in the classic portal; they move here one at a time.
      </p>
    </>
  );
}

/** The foundation: it opens with the workspace's look, finds out who you are, and says so. Modules come next. */
export function App({ env = readEnv(), deps }: { env?: MlEnv; deps?: UseMeDeps }) {
  const { state, retry } = useMe(env.portal, deps);
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

        {state.phase === 'signed-out' && (
          <>
            <h2>You are not signed in here yet</h2>
            <p>
              Sign in on the classic portal, then come back to this page: your session carries over.
            </p>
            <div className="actions">
              <a className="btn" href={classicUrl(env.portal)}>
                Open the classic portal
              </a>
            </div>
          </>
        )}

        {state.phase === 'signed-in' && <Who me={state.me} env={env} />}

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
