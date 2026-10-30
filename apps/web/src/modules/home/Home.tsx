import { useSession } from '../../app/context';
import { ButtonLink } from '../../ui';
import { classicUrl } from '../../lib/env';

/** Home, until the widgets move: who you are here, and what you may do — the thing to check a grant against. */
export function Home() {
  const { me, portal } = useSession();
  const { actor, caps, sections, workspace } = me;
  return (
    <section className="card" data-part="home" style={{ margin: '28px', maxWidth: '40rem' }}>
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
      <p className="muted">
        The screens in the menu are moving here one at a time; each one that has not moved opens in
        the classic portal.
      </p>
      <div className="actions">
        <ButtonLink href={classicUrl(portal)}>Open the classic portal</ButtonLink>
      </div>
    </section>
  );
}
