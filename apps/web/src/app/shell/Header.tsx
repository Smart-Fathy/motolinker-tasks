import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import ThemeCore from '@theme-core';
import { switchToClassicUrl } from '../../lib/env';
import { MODE_NAMES } from '../../lib/theme';
import { cx } from '../../ui/cx';
import { useAppTo, useSession, useTheme } from '../context';
import { Icon, Menu, ModeIcon } from './icons';
import { NotificationBell } from './NotificationBell';
import styles from './shell.module.css';
import type { ShellState } from './state';

const NEXT = { dark: 'light', light: 'auto', auto: 'dark' } as const;

/** The sun, the moon or the half-moon: dark, light or whatever the device says. Not offered where the workspace has fixed the mode. */
function ModeToggle() {
  const { mode, canChoose, theme } = useTheme();
  if (!canChoose) return null;
  const label = `Colour mode: ${MODE_NAMES[mode]} (click for ${MODE_NAMES[NEXT[mode]]})`;
  return (
    <button
      type="button"
      className={styles['bell']}
      data-part="modeToggle"
      data-mode-pref={mode}
      title={label}
      aria-label={label}
      onClick={() => theme.cycleMode()}
    >
      <ModeIcon mode={mode} />
    </button>
  );
}

/** The team portal keeps your account behind your own initials, top right. */
function ProfileMenu() {
  const { me, signOut } = useSession();
  const to = useAppTo();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const name = me.actor.name || '?';
  const initials = name
    .split(' ')
    .map(w => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={styles['profileWrap']} ref={wrap}>
      <button
        type="button"
        className={styles['profileBtn']}
        data-part="profileBtn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles['avatar']} data-part="avatar">
          {initials}
        </span>
      </button>
      {open && (
        <div className={styles['profileMenu']} data-part="profileMenu">
          <div className={styles['profileHead']}>
            <span className={cx(styles['avatar'], styles['avatarLg'])}>{initials}</span>
            <div className={styles['profileWho']}>
              <div className={styles['profileName']}>{name}</div>
              <div className={styles['profileRole']}>{me.actor.jobTitle || 'Employee'}</div>
            </div>
          </div>
          <div className={styles['profileActions']}>
            <NavLink
              to={to('/security')}
              className={styles['profileItem']}
              onClick={() => setOpen(false)}
            >
              <Icon name="shield-check" /> Security
            </NavLink>
            <a
              className={styles['profileItem']}
              data-part="classicLink"
              href={switchToClassicUrl('team')}
            >
              <Icon name="arrow-left" /> Classic portal
            </a>
            <button
              type="button"
              className={cx(styles['profileItem'], styles['danger'])}
              onClick={signOut}
            >
              <Icon name="log-out" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface HeaderProps {
  state: ShellState;
  /** the team portal's top bar names the page it is on */
  title: string;
}

export function Header({ state, title }: HeaderProps) {
  const { portal } = useSession();
  const { name, texts } = useTheme();
  const hamburger = (
    <button
      type="button"
      className={styles['hamburger']}
      data-part="hamburger"
      aria-label="Toggle menu"
      aria-expanded={state.drawer}
      onClick={() => state.setDrawer(!state.drawer)}
    >
      <Menu aria-hidden="true" />
    </button>
  );
  if (portal === 'team') {
    return (
      <header className={styles['topbar']} data-part="header">
        <div className={styles['topbarLeft']}>
          {hamburger}
          <div className={styles['topbarTitle']} data-part="title">
            {title}
          </div>
        </div>
        <div className={styles['topbarRight']}>
          <ModeToggle />
          <NotificationBell />
          <ProfileMenu />
        </div>
      </header>
    );
  }
  const badge = (texts['admin_badge'] ?? ThemeCore.TEXT_DEFAULTS['admin_badge'] ?? '').replaceAll(
    '{ws}',
    name,
  );
  return (
    <header className={styles['header']} data-part="header">
      <div className={styles['headerLeft']}>
        {hamburger}
        <div className={styles['logo']} data-part="logo" />
        <h1 className={styles['headerName']} data-part="title">
          {name}
        </h1>
        <span className={styles['headerBadge']} data-part="badge">
          {badge}
        </span>
      </div>
      <div className={styles['headerRight']}>
        <ModeToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
