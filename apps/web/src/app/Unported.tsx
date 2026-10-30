import { classicUrlFor } from '@motolinker/contracts/deeplinks';
import { presentation, screenOf } from '@motolinker/contracts/modules';
import { useLocation } from 'react-router';
import { ButtonLink } from '../ui';
import { useSession } from './context';

/**
 * A screen that has not moved to the new app yet. It is not gone: it is exactly where it was, in the classic portal, and
 * this says so and takes you to the page you meant. (A later run shows it right here, inside the frame.)
 */
export function Unported({ id }: { id: string }) {
  const { portal } = useSession();
  const { pathname } = useLocation();
  const screen = screenOf(id);
  const title = screen ? presentation(screen, portal).title : id;
  // …at the address that is the classic page whatever the switch says
  const classic = classicUrlFor(portal, pathname).replace(/^\/(dashboard|employee)/, '/legacy/$1');
  return (
    <section className="card" data-part="unported" style={{ margin: '28px', maxWidth: '40rem' }}>
      <h2>{title}</h2>
      <p className="muted">
        This screen has not moved to the new app yet. It is still in the classic portal, and works
        there as it always has.
      </p>
      <div className="actions">
        <ButtonLink href={classic}>Open {title} in the classic portal</ButtonLink>
      </div>
    </section>
  );
}
