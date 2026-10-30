import { Icon } from '../../app/shell/icons';
import { cx } from '../../ui/cx';
import { cleanTitle, iconOf, relativeTime, type Notification } from './model';
import styles from './notifications.module.css';

interface ItemProps {
  n: Notification;
  /** the bell's panel, or the Notification Center */
  where: 'panel' | 'page';
  onOpen: (n: Notification) => void;
}

/** One notification, as the bell's panel and the Notification Center both show it (they differ in their frame, not their parts). */
export function NotificationItem({ n, where, onOpen }: ItemProps) {
  const page = where === 'page';
  const unread = !n.read;
  const icon = (
    <span className={cx(styles['typeIcon'], page && styles['typeIconPage'])} data-part="typeIcon">
      {page && unread && <span className={styles['marker']} data-part="marker" />}
      <Icon name={iconOf(n.type)} />
    </span>
  );
  const words = (
    <>
      <div className={styles['title']} data-part="title">
        {cleanTitle(n.title)}
      </div>
      {n.body && (
        <div className={cx(styles['text'], page && styles['textPage'])} data-part="text">
          {n.body}
        </div>
      )}
      <div className={cx(styles['time'], page && styles['timePage'])} data-part="time">
        {relativeTime(n.created_at)}
      </div>
    </>
  );
  const act = {
    role: 'button',
    tabIndex: 0,
    onClick: () => onOpen(n),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(n);
      }
    },
  } as const;
  if (!page) {
    return (
      <div
        {...act}
        className={cx(styles['item'], unread && styles['itemUnread'])}
        data-part="item"
        data-unread={unread}
      >
        {icon}
        <div className={styles['body']} data-part="body">
          {words}
        </div>
      </div>
    );
  }
  return (
    <div
      {...act}
      className={cx(styles['centerItem'], unread && styles['centerUnread'])}
      data-part="centerItem"
      data-unread={unread}
    >
      {icon}
      <div className={styles['centerBody']} data-part="body">
        {words}
      </div>
      <div className={styles['date']} data-part="date">
        {new Date(n.created_at).toLocaleDateString()}
      </div>
    </div>
  );
}
