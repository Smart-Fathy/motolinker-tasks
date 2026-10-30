// What the Calendar draws, and the small rules it keeps: how the server's feed is recognised, which days a month or a week
// shows, what is on a day and in what order, how a day and a time are written. The classic portals carry these in
// public/assets/calendar.js; src/modules/calendar is the server's side of the same thing.
import type { Meeting } from '../meet';
import { huddleRoomOf } from '../meet';

/** A task on the day it is due (GET /api/v1/calendar; packages/contracts: schemas.CalendarTask). */
export interface CalendarTask {
  id: number;
  title: string;
  description: string;
  /** the day it is due, YYYY-MM-DD */
  due_date: string;
  status: string;
  priority: string;
  milestone: string;
  assignee_ids: string[];
  channel_name: string;
}

/** A call somebody promised a lead (schemas.CalendarFollowup). */
export interface CalendarFollowup {
  id: number;
  /** an instant, as ISO 8601 */
  due_at: string;
  note: string;
  customer_id: number;
  customer_name: string;
}

/** What a person is expected at, in a window of days (schemas.CalendarFeed). */
export interface CalendarFeed {
  from: string;
  to: string;
  tasks: CalendarTask[];
  meetings: Meeting[];
  followups: CalendarFollowup[];
}

export type View = 'month' | 'week';

/** The glyphs the Calendar draws (the icon registry in app/shell/icons.tsx holds them, and a test holds it to this list). */
export const CAL_ICONS = {
  meeting: 'video',
  huddle: 'radio',
  followup: 'phone-call',
  taskDone: 'check-circle-2',
  taskOpen: 'circle-dot',
  add: 'plus',
  external: 'external-link',
} as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

/** Is this a task of the feed? The page reads these fields, so these are the ones checked (calendar model.test.ts holds them to the schema). */
export function isCalendarTask(v: unknown): v is CalendarTask {
  if (!isObject(v)) return false;
  return (
    isInt(v['id']) &&
    typeof v['title'] === 'string' &&
    typeof v['description'] === 'string' &&
    typeof v['due_date'] === 'string' &&
    typeof v['status'] === 'string' &&
    typeof v['priority'] === 'string' &&
    typeof v['milestone'] === 'string' &&
    Array.isArray(v['assignee_ids']) &&
    v['assignee_ids'].every(a => typeof a === 'string') &&
    typeof v['channel_name'] === 'string'
  );
}

export function isCalendarFollowup(v: unknown): v is CalendarFollowup {
  if (!isObject(v)) return false;
  return (
    isInt(v['id']) &&
    typeof v['due_at'] === 'string' &&
    typeof v['note'] === 'string' &&
    isInt(v['customer_id']) &&
    typeof v['customer_name'] === 'string'
  );
}

/** A meeting of the feed is a meeting of the Meet page: the same fields, read the same way. */
function isFeedMeeting(v: unknown): v is Meeting {
  if (!isObject(v)) return false;
  return (
    isInt(v['id']) &&
    typeof v['title'] === 'string' &&
    typeof v['description'] === 'string' &&
    typeof v['starts_at'] === 'string' &&
    isInt(v['duration_min']) &&
    Array.isArray(v['attendee_ids']) &&
    v['attendee_ids'].every(a => typeof a === 'string') &&
    typeof v['meet_link'] === 'string' &&
    typeof v['created_by'] === 'string' &&
    typeof v['created_at'] === 'string'
  );
}

export function isCalendarFeed(v: unknown): v is CalendarFeed {
  return (
    isObject(v) &&
    typeof v['from'] === 'string' &&
    typeof v['to'] === 'string' &&
    Array.isArray(v['tasks']) &&
    v['tasks'].every(isCalendarTask) &&
    Array.isArray(v['meetings']) &&
    v['meetings'].every(isFeedMeeting) &&
    Array.isArray(v['followups']) &&
    v['followups'].every(isCalendarFollowup)
  );
}

// ── Days ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** A day as the server writes it: YYYY-MM-DD, in the person's own calendar. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The Sunday on or before a day, at midnight. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export const sameDay = (a: Date, b: Date): boolean => dayKey(a) === dayKey(b);
/** A time of day as the list writes it. */
export const hhmm = (d: Date): string =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The first and last day a view of the calendar shows around the day it is on: the week, or the whole weeks of the month. */
export function rangeOf(view: View, cursor: Date): { from: Date; to: Date } {
  if (view === 'week') {
    const from = startOfWeek(cursor);
    return { from, to: addDays(from, 6) };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { from: startOfWeek(first), to: addDays(startOfWeek(last), 6) };
}

/** Every day from one to the other, inclusive. */
export function daysOf(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) days.push(new Date(d));
  return days;
}

/** Where the arrows go: a week, or a month, on from where the calendar is. */
export function stepped(view: View, cursor: Date, n: number): Date {
  return view === 'week'
    ? addDays(cursor, 7 * n)
    : new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
}

/** What the bar calls the days on show: "Oct 11 – Oct 17, 2026" for a week, "October 2026" for a month. */
export function titleOf(view: View, cursor: Date): string {
  if (view === 'week') {
    const { from, to } = rangeOf('week', cursor);
    return `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// ── What is on a day ───────────────────────────────────────────────────────────────────────────────────────────────

export type Item =
  | { kind: 'meeting'; at: Date; sort: number; m: Meeting }
  | { kind: 'followup'; at: Date; sort: number; f: CalendarFollowup }
  | { kind: 'task'; at: null; sort: number; t: CalendarTask };

/** Tasks have a day and no time: they sort to the end of it rather than pretending to be at midnight. */
const END_OF_DAY = 8.64e15;

/** Everything on one day, in the order it happens. */
export function itemsOn(
  feed: Pick<CalendarFeed, 'tasks' | 'meetings' | 'followups'>,
  d: Date,
): Item[] {
  const key = dayKey(d);
  const out: Item[] = [];
  for (const m of feed.meetings) {
    const t = new Date(m.starts_at);
    if (dayKey(t) === key) out.push({ kind: 'meeting', at: t, sort: t.getTime(), m });
  }
  for (const f of feed.followups) {
    const t = new Date(f.due_at);
    if (dayKey(t) === key) out.push({ kind: 'followup', at: t, sort: t.getTime(), f });
  }
  for (const t of feed.tasks) {
    if (t.due_date === key) out.push({ kind: 'task', at: null, sort: END_OF_DAY, t });
  }
  return out.sort((a, b) => a.sort - b.sort);
}

/** How many of each kind the days on show hold (the legend). */
export function countsOver(
  feed: Pick<CalendarFeed, 'tasks' | 'meetings' | 'followups'>,
  days: readonly Date[],
): Record<Item['kind'], number> {
  const counts = { meeting: 0, task: 0, followup: 0 };
  for (const d of days) for (const i of itemsOn(feed, d)) counts[i.kind]++;
  return counts;
}

export const plural = (n: number, one: string, many = one + 's'): string =>
  `${n} ${n === 1 ? one : many}`;

/** Is a task late? Open, and due before today. */
export const isOverdue = (t: CalendarTask, today: Date = new Date()): boolean =>
  t.status !== 'done' && t.due_date < dayKey(today);

/** A meeting's start as the dialog writes it: "Wed, Oct 14, 10:30 AM". */
export const startOfMeeting = (m: Meeting): string =>
  new Date(m.starts_at).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A day as the day dialog's title: "Wednesday, October 14". */
export const titleOfDay = (key: string): string =>
  new Date(key + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

/** Which glyph a meeting's chip draws: a huddle's, or a video call's. */
export const meetingIcon = (m: Meeting): string =>
  huddleRoomOf(m.meet_link) ? CAL_ICONS.huddle : CAL_ICONS.meeting;

/** The state of the admin's Google Calendar link (new tasks land on the assignee's calendar). */
export interface SyncStatus {
  configured: boolean;
  connected: boolean;
  email: string;
}
export function syncOf(v: unknown): SyncStatus {
  const o = isObject(v) ? v : {};
  return {
    configured: o['configured'] === true,
    connected: o['connected'] === true,
    email: typeof o['email'] === 'string' ? o['email'] : '',
  };
}
export const SAID = {
  confirmDisconnect: 'Stop adding new tasks to Google Calendar? Existing events stay put.',
  notConfigured: 'Google not configured',
  syncOn: (email: string) => `Task sync on · ${email}`,
  syncOff: 'Task sync off',
  disconnect: 'Disconnect',
  connect: 'Connect for task sync',
} as const;
