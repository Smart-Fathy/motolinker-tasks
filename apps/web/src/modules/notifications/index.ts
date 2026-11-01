import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('notifications', {
  Page: lazyPage(() => import('./Notifications'), 'Notifications'),
});

// What the frame of the app (the bell in the header, the badge in the rail, the toasts) takes from this module.
export { NotificationItem } from './NotificationItem';
export { notificationsKey, useLiveNotifications, useNotifications, useUnreadCount } from './data';
export { badgeText, fromStream, PANEL_SHOWS, type Notification } from './model';
