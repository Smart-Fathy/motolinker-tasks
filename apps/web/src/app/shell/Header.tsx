import { useEffect, useRef, useState } from 'react';
import ThemeCore from '@theme-core';
import { AssistantPill } from '../../assistant';
import { switchToClassicUrl } from '../../lib/env';
import { MODE_NAMES } from '../../lib/theme';
import { cx } from '../../ui/cx';
import { useFrame, useSession, useTheme, type FramePanel } from '../context';
import { ACCOUNT_ICONS } from '../../modules/security/model';
import { useAccount } from '../../modules/security';
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

/** What a person looks like in the account menu: their picture where they have set one, their initials where they have not. */
function Face({ large }: { large?: boolean }) {
  const { me } = useSession();
  const name = me.actor.name || '?';
  const initials = name
    .split(' ')
    .map(w => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const picture = me.profile?.avatarUrl;
  return (
    <span
      className={cx(styles['avatar'], large && styles['avatarLg'])}
      data-part={large ? 'avatarLarge' : 'avatar'}
    >
      {picture ? <img className={styles['avatarImg']} src={picture} alt="" /> : initials}
    </span>
  );
}

/** The team portal keeps your account behind your own face, top right: your picture, name and status, and what you may do. */
function ProfileMenu() {
  const { me, signOut } = useSession();
  const frame = useFrame();
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
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
  const status = [me.profile?.statusEmoji, me.profile?.statusText].filter(Boolean).join(' ').trim();
  // Anything in the menu that opens a dialog puts the menu away first: it would sit behind the curtain otherwise.
  const ask = (panel: FramePanel) => () => {
    setOpen(false);
    frame.open(panel);
  };
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
        <Face />
      </button>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        data-part="avatarFile"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void account.uploadAvatar(file);
        }}
      />
      {open && (
        <div className={styles['profileMenu']} data-part="profileMenu">
          <div className={styles['profileHead']}>
            <button
              type="button"
              className={styles['profileAv']}
              data-part="changePicture"
              title="Change profile picture"
              onClick={() => picker.current?.click()}
            >
              <Face large />
              <span className={styles['profileAvEdit']}>
                <Icon name={ACCOUNT_ICONS.picture} />
              </span>
            </button>
            <div className={styles['profileWho']}>
              <div className={styles['profileName']} data-part="name">
                {name}{' '}
                <button
                  type="button"
                  className={styles['profilePencil']}
                  data-part="changeUsername"
                  title="Change username"
                  aria-label="Change username"
                  onClick={ask('username')}
                >
                  <Icon name={ACCOUNT_ICONS.username} />
                </button>
              </div>
              <div className={styles['profileRole']}>{me.actor.jobTitle || 'Employee'}</div>
              <div
                className={cx(styles['profileStatus'], status && styles['hasStatus'])}
                data-part="status"
                role="button"
                tabIndex={0}
                title="Set a status"
                onClick={ask('status')}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') ask('status')();
                }}
              >
                {status || '＋ Set status'}
              </div>
            </div>
          </div>
          <div className={styles['profileActions']}>
            <button
              type="button"
              className={styles['profileItem']}
              data-part="reportIssue"
              onClick={ask('report')}
            >
              <Icon name="bug" /> Report an issue
            </button>
            <button
              type="button"
              className={styles['profileItem']}
              data-part="changePassword"
              onClick={ask('password')}
            >
              <Icon name={ACCOUNT_ICONS.password} /> Change password
            </button>
            <button
              type="button"
              className={styles['profileItem']}
              data-part="security"
              onClick={ask('security')}
            >
              <Icon name="shield-check" /> Security
            </button>
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
          <AssistantPill />
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
        <AssistantPill />
        <NotificationBell />
      </div>
    </header>
  );
}
