import { isNewTo, legacyIdOf, presentation, screenOf } from '@motolinker/contracts/modules';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ReportIssue } from '../../modules/issues';
import { useLiveNotifications } from '../../modules/notifications';
import { ToastHost } from '../../ui';
import { cx } from '../../ui/cx';
import { useSession } from '../context';
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
  const [reporting, setReporting] = useState(false);
  const startReport = useCallback(() => setReporting(true), []);
  const endReport = useCallback(() => setReporting(false), []);

  // Where the person was, for next time (under the key the classic portal keeps it in, as that portal's page name). A screen
  // the classic portal never had is not a page it could open, so it is not remembered for it.
  useEffect(() => {
    const screen = active ? screenOf(active) : undefined;
    if (!screen || isNewTo(screen, portal)) return;
    try {
      window.localStorage.setItem(pageKey(portal), legacyIdOf(screen, portal));
    } catch {
      /* private mode */
    }
  }, [active, portal]);

  const screen = active ? screenOf(active) : undefined;
  const title = screen ? presentation(screen, portal).title : '';
  return (
    <div className={styles['layout']} data-part="layout">
      <Gradients />
      <div
        className={cx(styles['overlay'], state.drawer && styles['overlayVisible'])}
        data-part="overlay"
        onClick={() => state.setDrawer(false)}
      />
      <Sidebar rail={rail} active={active} state={state} onReportIssue={startReport} />
      <div
        className={cx(styles['content'], state.collapsed && styles['contentWide'])}
        data-part="content"
      >
        <Header state={state} title={title} onReportIssue={startReport} />
        <main className={styles['page']} data-part="page">
          <Outlet />
        </main>
      </div>
      <BottomNav items={bottom} active={active} state={state} />
      {reporting && <ReportIssue onClose={endReport} />}
      <ToastHost toasts={toasts} />
    </div>
  );
}
