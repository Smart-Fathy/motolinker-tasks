import { useSession } from '../../app/context';
import { NotificationItem } from './NotificationItem';
import { useNotifications } from './data';
import styles from './notifications.module.css';

const HINT = {
  admin: 'Click any notification to navigate to the relevant page',
  team: 'Click any notification to go to the relevant page',
} as const;

/** The Notification Center: every notification the server lists (the newest fifty), newest first, and a click goes to the page it is about. */
export function Notifications() {
  const { portal } = useSession();
  const { items, loading, unavailable, markAllRead, open } = useNotifications({ fresh: true });
  return (
    <div className={styles['page']} data-part="notificationsPage">
      <div className={styles['pageHead']}>
        <div>
          <div className={styles['pageTitle']} data-part="pageTitle">
            Notification Center
          </div>
          <div className={styles['pageHint']} data-part="pageHint">
            {HINT[portal]}
          </div>
        </div>
        <button
          type="button"
          className={styles['markAll']}
          data-part="markAll"
          onClick={markAllRead}
        >
          Mark all read
        </button>
      </div>
      <div data-part="notificationsList">
        {items.length > 0 ? (
          items.map(n => <NotificationItem key={n.id} n={n} where="page" onOpen={open} />)
        ) : (
          <div className={styles['pageEmpty']} data-part="empty">
            {unavailable
              ? 'Notifications are unavailable right now.'
              : loading
                ? 'Loading…'
                : 'No notifications yet'}
          </div>
        )}
      </div>
    </div>
  );
}
