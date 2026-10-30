import { defineModule } from '../../app/define-module';
import { Meet } from './Meet';

export default defineModule('meet', { Page: Meet });

// What the Calendar takes from this module: a meeting, what a meeting's link joins, and the sheet that schedules and changes one.
export { useScheduling } from './Schedule';
export { useMeetingActions } from './data';
export {
  classicRoomUrl,
  huddleRoomOf,
  isMeeting,
  isMeetingList,
  linkUrl,
  MEET_ICONS,
  SAID as MEET_SAID,
  summaryOf as meetingSummary,
  whenOf as meetingWhen,
  type Meeting,
} from './model';
