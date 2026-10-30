import { defineModule } from '../../app/define-module';
import { Notifications } from './Notifications';

export default defineModule('notifications', { Page: Notifications });

// What the frame of the app (the bell in the header, the badge in the rail, the toasts) takes from this module.
export { NotificationItem } from './NotificationItem';
export { notificationsKey, useLiveNotifications, useNotifications, useUnreadCount } from './data';
export { badgeText, fromStream, PANEL_SHOWS, type Notification } from './model';
