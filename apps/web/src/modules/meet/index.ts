import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('meet', { Page: lazyPage(() => import('./Meet'), 'Meet') });

// What the Calendar takes from this module: a meeting, where one is joined, and the sheet that schedules and changes one.
export { useScheduling } from './Schedule';
export { classicRoomUrl, huddleRoomOf, linkUrl, MEET_ICONS, type Meeting } from './model';
