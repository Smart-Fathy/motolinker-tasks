import { classicUrlFor } from '@motolinker/contracts/deeplinks';
import { presentation, type Screen } from '@motolinker/contracts/modules';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Button, ButtonLink } from '../ui';
import { useSession } from './context';

/**
 * A screen the app does not show itself and cannot show in a frame: it is not gone, it is exactly where it was, in the
 * classic portal. `children` says why (where the classic page cannot be framed) or what happened (where it could not be
 * loaded), and `onRetry` offers another try.
 */
export function Unported({
  screen,
  children,
  onRetry,
}: {
  screen: Screen;
  children: ReactNode;
  onRetry?: () => void;
}) {
  const { portal } = useSession();
  const { pathname } = useLocation();
  const title = presentation(screen, portal).title;
  // …at the address that is the classic page whatever the switch says
  const classic = classicUrlFor(portal, pathname).replace(/^\/(dashboard|employee)/, '/legacy/$1');
  return (
    <section className="card" data-part="unported" style={{ margin: '28px', maxWidth: '40rem' }}>
      <h2>{title}</h2>
      <p className="muted">{children}</p>
      <div className="actions">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        <ButtonLink href={classic}>Open {title} in the classic portal</ButtonLink>
      </div>
    </section>
  );
}
