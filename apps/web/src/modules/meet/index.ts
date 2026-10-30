import { defineModule } from '../../app/define-module';
import { Meet } from './Meet';

export default defineModule('meet', { Page: Meet });

// What the Calendar takes from this module: a meeting, where one is joined, and the sheet that schedules and changes one.
export { useScheduling } from './Schedule';
export { classicRoomUrl, huddleRoomOf, linkUrl, MEET_ICONS, type Meeting } from './model';
