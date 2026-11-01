import { resolveDeepLink } from '@motolinker/contracts/deeplinks';
import { inPortal, isPanel, screenIdFromLegacy, screenOf } from '@motolinker/contracts/modules';
import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { NOT_FRAMED } from '../legacy/frameable';
import { LegacyFrame } from '../legacy/LegacyFrame';
import { useAppTo, useSession } from './context';
import { useNavConfig } from './nav-config';
import { Shell } from './shell/Shell';
import { pageKey } from './shell/state';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenLoading } from './ScreenLoading';
import { Unported } from './Unported';
import { registry } from './registry';
import { useWorkerMessages } from './useWorkerMessages';

/** Where a bare address opens: the page the person was last on, if they may still open it; Home otherwise. */
export function startScreen(portal: 'admin' | 'team', allows: (id: string) => boolean): string {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(pageKey(portal));
  } catch {
    /* private mode */
  }
  const id = saved ? screenIdFromLegacy(saved, portal) : null;
  // (a panel is not a page to start on: it would only open the panel again)
  const screen = id ? screenOf(id) : undefined;
  return id && screen && !isPanel(screen) && allows(id) ? id : 'home';
}

/**
 * A bare address is a way in. If it carries a link that already exists in the world — '/employee#requests' in a notification,
 * '/dashboard?chat=<room>' in a push — that is where it goes (once, replacing the address with the screen's own); otherwise
 * to where the person was last, or Home.
 */
function Landing() {
  const { portal, access } = useSession();
  const { search, hash } = useLocation();
  const to = useAppTo();
  const target =
    resolveDeepLink(portal, { search, hash }) ?? '/' + startScreen(portal, access.allows);
  return <Navigate to={to(target)} replace />;
}

/**
 * A screen of the app, or Home when the address names one that does not exist, is not this portal's, or is not this person's.
 * A screen that has moved is its module's page; one that has not is the classic page, in a frame — or, where a frame cannot
 * hold it, a card that says why and takes the person there.
 */
function ScreenRoute() {
  const { id = '' } = useParams();
  const { portal, access } = useSession();
  const to = useAppTo();
  const screen = screenOf(id);
  if (!screen || !inPortal(screen, portal) || !access.allows(id))
    return <Navigate to={to('/home')} replace />;
  const found = registry.get(id);
  // A screen's page is fetched when it is first opened (lazyPage): the frame stays up meanwhile, and if the file cannot be
  // had — the connection dropped, or the app was updated since this page was opened — the screen says so and offers the way out.
  if (found)
    return (
      <ScreenBoundary
        key={id}
        fallback={
          <Unported screen={screen} onRetry={() => window.location.reload()}>
            This screen could not be shown. Reload to try again, or open it in the classic portal.
          </Unported>
        }
      >
        <Suspense fallback={<ScreenLoading />}>
          <found.Page />
        </Suspense>
      </ScreenBoundary>
    );
  if (Object.hasOwn(NOT_FRAMED, id)) return <Unported screen={screen}>{NOT_FRAMED[id]}</Unported>;
  return <LegacyFrame screen={screen} />;
}

export function AppRoutes() {
  const navConfig = useNavConfig();
  useWorkerMessages();
  return (
    <Routes>
      <Route element={<Shell navConfig={navConfig} />}>
        <Route index element={<Landing />} />
        <Route path=":id/*" element={<ScreenRoute />} />
      </Route>
    </Routes>
  );
}
