import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { useAppTo, useFrame } from '../../app/context';

/**
 * '/security' is a way to the panel, not a page: the panel opens over the page the person was last on (or Home), as the classic
 * portals open it for '#security' — from a security alert's notification, or the link in its email — and the address goes back
 * to that page's own.
 */
export function SecurityRoute() {
  const frame = useFrame();
  const to = useAppTo();
  useEffect(() => {
    frame.open('security');
  }, [frame]);
  return <Navigate to={to('/')} replace />;
}
