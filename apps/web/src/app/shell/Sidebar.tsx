import ThemeCore from '@theme-core';
import { NavLink, useNavigate } from 'react-router';
import { switchToClassicUrl } from '../../lib/env';
import { badgeText, useUnreadCount } from '../../modules/notifications';
import { cx } from '../../ui/cx';
import { useAppTo, useFrame, useSession, useTheme } from '../context';
import type { RailGroup } from '../nav';
import { preloadScreen } from '../registry';
import { ChevronDown, Icon, PanelLeftClose } from './icons';
import styles from './shell.module.css';
import type { ShellState } from './state';

interface SidebarProps {
  rail: RailGroup[];
  active: string | null;
  state: ShellState;
}

/** The workspace's picture (a round mark), its name and what the portal calls itself. */
function Brand({ state }: { state: ShellState }) {
  const { portal } = useSession();
  const { name, texts } = useTheme();
  const admin = portal === 'admin';
  const key = admin ? 'admin_role' : 'team_role';
  const role = (texts[key] ?? ThemeCore.TEXT_DEFAULTS[key] ?? '').replaceAll('{ws}', name);
  return (
    <div className={styles['brand']} data-part="brand">
      <div className={styles['brandRow']}>
        <div className={styles['mark']} data-part="mark" />
        <div className={styles['brandText']} data-part="brandText">
          <div className={styles['brandName']} data-part="brandName">
            {name}
          </div>
          <div className={styles['brandSub']} data-part="brandSub">
            {role}
          </div>
        </div>
        <button
          type="button"
          className={styles['collapse']}
          data-part="collapse"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          aria-pressed={state.collapsed}
          onClick={state.toggleCollapsed}
        >
          <PanelLeftClose aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles['close']}
          data-part="close"
          title="Close menu"
          aria-label="Close menu"
          onClick={() => state.setDrawer(false)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ rail, active, state }: SidebarProps) {
  const { portal, signOut } = useSession();
  const frame = useFrame();
  const unread = useUnreadCount();
  const to = useAppTo();
  const navigate = useNavigate();
  const admin = portal === 'admin';
  return (
    <aside
      className={cx(
        styles['sidebar'],
        state.drawer && styles['drawerOpen'],
        state.collapsed && styles['collapsed'],
      )}
      data-part="sidebar"
      id="sidebar"
    >
      <Brand state={state} />
      <nav className={styles['nav']} data-part="nav" aria-label="Sections">
        {rail.map(group => {
          const open = state.isGroupOpen(group.id);
          return (
            <div
              key={group.id}
              className={cx(styles['group'], open && styles['groupOpen'])}
              data-group={group.id}
              data-part="group"
            >
              <div
                className={styles['groupHead']}
                data-part="groupHead"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => state.toggleGroup(group.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    state.toggleGroup(group.id);
                  }
                }}
              >
                <span className={styles['groupLabel']} data-part="groupLabel">
                  {group.label}
                </span>
                {admin && (
                  <span className={styles['groupCount']} data-part="groupCount">
                    {group.items.length}
                  </span>
                )}
                <ChevronDown className={styles['chevron']} aria-hidden="true" />
              </div>
              <div className={styles['groupItems']} hidden={false}>
                {group.items.map(item => {
                  const here = active === item.id;
                  const className = cx(styles['item'], here && styles['itemActive']);
                  const body = (
                    <>
                      <span
                        className={cx(styles['icon'], item.icon === 'brain-ai' && styles['iconAi'])}
                        data-part="icon"
                      >
                        <Icon name={item.icon} />
                      </span>
                      <span className={styles['itemLabel']}>{item.label}</span>
                      {item.id === 'notifications' && unread > 0 && (
                        <span className={styles['navBadge']} data-part="navBadge">
                          {badgeText(unread)}
                        </span>
                      )}
                    </>
                  );
                  return admin ? (
                    <NavLink
                      key={item.id}
                      to={to('/' + item.id)}
                      className={className}
                      data-part={here ? 'itemActive' : 'item'}
                      data-screen={item.id}
                      aria-current={here ? 'page' : undefined}
                      tabIndex={open ? 0 : -1}
                      onPointerEnter={() => preloadScreen(item.id)}
                      onFocus={() => preloadScreen(item.id)}
                      onClick={() => state.setDrawer(false)}
                    >
                      {body}
                    </NavLink>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      className={className}
                      data-part={here ? 'itemActive' : 'item'}
                      data-screen={item.id}
                      aria-current={here ? 'page' : undefined}
                      tabIndex={open ? 0 : -1}
                      onPointerEnter={() => preloadScreen(item.id)}
                      onFocus={() => preloadScreen(item.id)}
                      onClick={() => {
                        state.setDrawer(false);
                        void navigate(to('/' + item.id));
                      }}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      {!admin && (
        <div className={styles['teamFooter']} data-part="teamFooter">
          <button
            type="button"
            className={styles['reportIssue']}
            data-part="reportIssue"
            onClick={() => frame.open('report')}
          >
            <Icon name="bug" size={14} /> Report an Issue
          </button>
        </div>
      )}
      {admin && (
        <div className={styles['footer']} data-part="footer">
          <a
            className={styles['footerRow']}
            data-part="classicLink"
            href={switchToClassicUrl(portal)}
          >
            <span className={styles['footerIcon']}>
              <Icon name="arrow-left" />
            </span>{' '}
            Classic portal
          </a>
          <button
            type="button"
            className={styles['footerRow']}
            data-part="footerRow"
            onClick={() => {
              state.setDrawer(false);
              frame.open('security');
            }}
          >
            <span className={styles['footerIcon']}>
              <Icon name="shield-check" />
            </span>{' '}
            Security
          </button>
          <button
            type="button"
            className={styles['footerRow']}
            data-part="signOut"
            onClick={signOut}
          >
            <span className={styles['footerIcon']}>
              <Icon name="log-out" />
            </span>{' '}
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}
