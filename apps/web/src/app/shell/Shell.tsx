import {
  isNewTo,
  isPanel,
  legacyIdOf,
  presentation,
  screenOf,
} from '@motolinker/contracts/modules';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ReportIssue } from '../../modules/issues';
import { useLiveNotifications } from '../../modules/notifications';
import { AccountDialogs, SecurityPanel } from '../../modules/security';
import { ToastHost } from '../../ui';
import { cx } from '../../ui/cx';
import { FrameContext, useSession, type Frame, type FramePanel } from '../context';
import { buildBottomNav, buildRail, type NavConfig } from '../nav';
import { BottomNav } from './BottomNav';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import styles from './shell.module.css';
import { pageKey, useShellState } from './state';

/** The screen a path is on: '/leads/42' is leads. */
export function screenAt(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return first && screenOf(first) ? first : null;
}

/** One gradient, drawn once for the Accounting item's brain (a hidden svg paints no gradients, so it is sized to nothing instead). */
function Gradients() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ml-ai-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f472b6" />
          <stop offset=".35" stopColor="#a78bfa" />
          <stop offset=".7" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * The frame of the signed-in app, the same for both portals: the rail (what this person may open, arranged as the admin
 * arranged it), the top bar, the phone's bottom bar, and, between them, the screen the address names.
 */
export function Shell({
  navConfig,
  openAll,
}: {
  navConfig?: NavConfig | null;
  /** every section drawn open, and nothing remembered (the gallery's specimen) */
  openAll?: boolean;
}) {
  const { portal, access, toasts } = useSession();
  useLiveNotifications();
  const { pathname } = useLocation();
  const active = screenAt(pathname);
  const rail = useMemo(() => buildRail(portal, access, navConfig), [portal, access, navConfig]);
  const bottom = useMemo(() => buildBottomNav(portal, access), [portal, access]);
  const activeGroup = rail.find(g => g.items.some(i => i.id === active))?.id ?? null;
  const state = useShellState(portal, activeGroup, { openAll: !!openAll });
  // The panels and dialogs the frame owns: one is open at a time, and anything inside the app can ask for one.
  const [panel, setPanel] = useState<FramePanel | null>(null);
  const frame = useMemo<Frame>(() => ({ open: setPanel }), []);
  // A panel puts itself away, and only while it is the one that is open: a dialog that was still waiting for the server when
  // another was opened must not take that one with it when the answer comes.
  const endPanel = useCallback(
    (which: FramePanel) => setPanel(open => (open === which ? null : open)),
    [],
  );

  // Where the person was, for next time (under the key the classic portal keeps it in, as that portal's page name). A screen
  // the classic portal never had is not a page it could open, so it is not remembered for it; a panel is not a page at all.
  useEffect(() => {
    const screen = active ? screenOf(active) : undefined;
    if (!screen || isNewTo(screen, portal) || isPanel(screen)) return;
    try {
      window.localStorage.setItem(pageKey(portal), legacyIdOf(screen, portal));
    } catch {
      /* private mode */
    }
  }, [active, portal]);

  const screen = active ? screenOf(active) : undefined;
  const title = screen ? presentation(screen, portal).title : '';
  return (
    <FrameContext value={frame}>
      <div className={styles['layout']} data-part="layout">
        <Gradients />
        <div
          className={cx(styles['overlay'], state.drawer && styles['overlayVisible'])}
          data-part="overlay"
          onClick={() => state.setDrawer(false)}
        />
        <Sidebar rail={rail} active={active} state={state} />
        <div
          className={cx(styles['content'], state.collapsed && styles['contentWide'])}
          data-part="content"
        >
          <Header state={state} title={title} />
          <main className={styles['page']} data-part="page">
            <Outlet />
          </main>
        </div>
        <BottomNav items={bottom} active={active} state={state} />
        {panel === 'report' && <ReportIssue onClose={() => endPanel('report')} />}
        {panel === 'security' && <SecurityPanel onClose={() => endPanel('security')} />}
        {(panel === 'status' || panel === 'username' || panel === 'password') && (
          <AccountDialogs which={panel} onClose={() => endPanel(panel)} />
        )}
        <ToastHost toasts={toasts} />
      </div>
    </FrameContext>
  );
}
