import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { routeForUrl } from '../lib/pwa';
import { parseWorkerMessage } from '../sw/shared';
import { useAppTo, useSession } from './context';

/**
 * The worker asking the app to show a place: a notification was tapped while the app was open. The classic pages are told in
 * their own words by the same worker; these are the app's.
 */
export function useWorkerMessages(): void {
  const { portal } = useSession();
  const navigate = useNavigate();
  const to = useAppTo();
  useEffect(() => {
    const container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    if (!container) return;
    const onMessage = (event: MessageEvent) => {
      const message = parseWorkerMessage(event.data);
      const route = message && routeForUrl(portal, message.url, window.location.origin);
      if (route) void navigate(to(route));
    };
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, [portal, navigate, to]);
}
