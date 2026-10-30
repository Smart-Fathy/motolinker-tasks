import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  badgeText,
  NotificationItem,
  PANEL_SHOWS,
  useNotifications,
} from '../../modules/notifications';
import { useAppTo } from '../context';
import { Icon } from './icons';
import styles from './shell.module.css';

/**
 * The bell in the top bar: how many are unread, and, opened, the newest twenty. Opening it reads them all (the classic portals
 * do the same); "View all" goes to the Notification Center; a click on one reads it and goes to the page it is about.
 */
export function NotificationBell() {
  const { items, unread, unavailable, markAllRead, open: openNotification } = useNotifications();
  const to = useAppTo();
  const navigate = useNavigate();
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
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = () => {
    if (!open && unread > 0) markAllRead();
    setOpen(!open);
  };
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <div className={styles['bellWrap']} ref={wrap} data-part="bellWrap">
      <button
        type="button"
        className={styles['bell']}
        data-part="bell"
        title="Notifications"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="bell" size={20} />
        {unread > 0 && (
          <span className={styles['bellBadge']} data-part="bellBadge">
            {badgeText(unread)}
          </span>
        )}
      </button>
      {open && (
        <div className={styles['panel']} data-part="panel">
          <div className={styles['panelHead']} data-part="panelHead">
            <span>Notifications</span>
            <div className={styles['panelActions']}>
              <button
                type="button"
                className={styles['readAll']}
                data-part="viewAll"
                onClick={() => {
                  setOpen(false);
                  void navigate(to('/notifications'));
                }}
              >
                View all
              </button>
              <button
                type="button"
                className={styles['readAll']}
                data-part="readAll"
                onClick={markAllRead}
              >
                Mark all read
              </button>
            </div>
          </div>
          <div className={styles['panelList']} data-part="panelList">
            {items.length > 0 ? (
              items.slice(0, PANEL_SHOWS).map(n => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  where="panel"
                  onOpen={picked => {
                    setOpen(false);
                    openNotification(picked);
                  }}
                />
              ))
            ) : (
              <div className={styles['panelEmpty']} data-part="panelEmpty">
                {unavailable ? 'Notifications are unavailable right now.' : 'No notifications yet'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
