// What a scheduled meeting is to the app, and the small rules the Meet page, its scheduling sheet and the Calendar share: how
// the server's rows are recognised, how a day and a time are written, what a link is, where a meeting happens, and what the
// sheet sends. The classic portals carry these in public/assets/meetings.js and calendar.js; src/modules/meetings is the
// server's side of the same thing.
import { classicUrlFor } from '@motolinker/contracts/deeplinks';
import type { Portal } from '../../lib/env';

/** A meeting, as GET /api/v1/meetings lists it (packages/contracts: schemas.Meeting). */
export interface Meeting {
  id: number;
  title: string;
  description: string;
  /** an instant, as ISO 8601 */
  starts_at: string;
  duration_min: number;
  /** employee ids, as text */
  attendee_ids: string[];
  /** where to join: empty, a web address, or `huddle:<room>` */
  meet_link: string;
  /** 'admin' or 'employee_<id>' */
  created_by: string;
  created_at: string;
}

/** What the sheet sends to schedule or change a meeting (schemas.MeetingBody). */
export interface MeetingBody {
  title: string;
  starts_at: string;
  duration_min: number;
  attendee_ids: string[];
  meet_link: string;
  description: string;
}

/** Somebody who can be invited. */
export interface Person {
  id: string;
  name: string;
}

/** A chat room a huddle can be held in. */
export interface Room {
  id: string;
  name: string;
}

/** The words the person is told when it works. */
export const SAID = {
  scheduled: "Scheduled — it lands on every attendee's calendar.",
  updated: 'Meeting updated — calendars re-sync in the background.',
  confirmCancel: 'Cancel this meeting? Calendar events are removed for everyone.',
} as const;

/** The glyphs the Meet page and the Calendar draw (the icon registry in app/shell/icons.tsx holds them, and a test holds it to this list). */
export const MEET_ICONS = {
  newMeeting: 'video',
  join: 'link',
  schedule: 'calendar-plus',
  huddle: 'radio',
} as const;

/** How long a meeting can be, as the sheet offers it (minutes). */
export const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

/**
 * Is this a meeting? The page reads these fields, so these are the ones checked; model.test.ts holds the guards to the
 * schemas in packages/contracts (the bundle does not carry zod just for this).
 */
export function isMeeting(v: unknown): v is Meeting {
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

export function isMeetingList(v: unknown): v is { items: Meeting[] } {
  return isObject(v) && Array.isArray(v['items']) && v['items'].every(isMeeting);
}

/**
 * The people or rooms a list from the classic routes holds: whatever has an id and a name (the classic sheet reads nothing
 * else of them), the id as text. Anything that is not a list is nobody.
 */
function namedBy(v: unknown): { id: string; name: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { id: string; name: string }[] = [];
  for (const x of v) {
    if (!isObject(x)) continue;
    const id = x['id'];
    if (typeof id !== 'number' && typeof id !== 'string') continue;
    out.push({ id: String(id), name: typeof x['name'] === 'string' ? x['name'] : '' });
  }
  return out;
}
export const peopleOf = (v: unknown): Person[] => namedBy(v);
/** (a room with no name is "Conversation", as in the classic sheet) */
export const roomsOf = (v: unknown): Room[] =>
  namedBy(v).map(r => ({ id: r.id, name: r.name || 'Conversation' }));

/** The room a `huddle:<room>` link names, or empty. */
export function huddleRoomOf(link: string): string {
  const k = /^huddle:(\d+)$/.exec(String(link || ''));
  return k?.[1] ?? '';
}

/**
 * A link somebody typed, as a link — but only when it really is one. Anything else is left as the plain text it is, and a
 * scheme that is not http(s) is never made clickable: a `javascript:` "link" typed into a meeting would otherwise be a script
 * every viewer can run. A bare domain gets https://. (The same rule as the classic portals' link columns.)
 */
export function linkUrl(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  let u: URL;
  try {
    u = new URL(hasScheme ? s : 'https://' + s);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return !hasScheme && !u.hostname.includes('.') ? '' : u.href;
}

/** The address of a Google Meet room by its code (the cards' "Join"), or nothing when there is no code. */
export function meetCodeUrl(raw: string): string {
  const code = String(raw).trim().replace(/\s/g, '');
  return code ? 'https://meet.google.com/' + code : '';
}

/** The classic portal at a chat room, where the huddle of a meeting is held until huddles move into the new app. */
export function classicRoomUrl(portal: Portal, room: string): string {
  return classicUrlFor(portal, '/chat/' + room).replace(/^\/(dashboard|employee)/, '/legacy/$1');
}

/** A meeting's start as the list writes it: the weekday, the day of the month, and the time. */
export function whenOf(iso: string): { weekday: string; day: number; time: string } {
  const t = new Date(iso);
  return {
    weekday: t.toLocaleDateString(undefined, { weekday: 'short' }),
    day: t.getDate(),
    time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

/** "09:30 AM · 30 min · 2 attendee(s)" */
export function summaryOf(m: Meeting): string {
  return `${whenOf(m.starts_at).time} · ${m.duration_min} min · ${m.attendee_ids.length} attendee(s)`;
}

/** Where a meeting happens, as the sheet asks it. */
export type Where = 'meet' | 'huddle' | 'link';

/** What the scheduling sheet holds while it is open. */
export interface Draft {
  title: string;
  /** YYYY-MM-DD, the person's own day */
  date: string;
  /** HH:MM */
  time: string;
  duration: number;
  /** the ids of the people picked */
  attendees: string[];
  where: Where;
  room: string;
  link: string;
  notes: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The sheet as it opens: a new meeting an hour from now (or ten in the morning of a day picked on the calendar), thirty
 * minutes, on Google Meet; or an existing one as it stands.
 */
export function draftOf(
  meeting: Meeting | null,
  seed: { date?: string } | undefined,
  rooms: readonly Room[],
  now: Date = new Date(),
): Draft {
  const room = meeting ? huddleRoomOf(meeting.meet_link) : '';
  let start = meeting ? new Date(meeting.starts_at) : new Date(now.getTime() + 3600e3);
  if (!meeting && seed?.date) {
    const seeded = new Date(seed.date + 'T10:00:00');
    if (!isNaN(seeded.getTime())) start = seeded;
  }
  return {
    title: meeting?.title ?? '',
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    duration: meeting ? meeting.duration_min : 30,
    attendees: meeting ? meeting.attendee_ids.map(String) : [],
    where: room ? 'huddle' : meeting?.meet_link ? 'link' : 'meet',
    room: room || rooms[0]?.id || '',
    link: !room && meeting?.meet_link ? meeting.meet_link : '',
    notes: meeting?.description ?? '',
  };
}

/** What the sheet sends, or what is wrong with it (in the words the classic sheet uses). */
export function bodyOf(d: Draft): { ok: true; body: MeetingBody } | { ok: false; message: string } {
  const title = d.title.trim();
  if (!title) return { ok: false, message: 'Title is required.' };
  const at = d.date && d.time ? new Date(`${d.date}T${d.time}`) : null;
  if (!at || isNaN(at.getTime())) return { ok: false, message: 'Pick a date and time.' };
  const meetLink =
    d.where === 'huddle'
      ? d.room
        ? `huddle:${d.room}`
        : ''
      : d.where === 'link'
        ? d.link.trim()
        : '';
  return {
    ok: true,
    body: {
      title,
      starts_at: at.toISOString(),
      duration_min: Math.round(d.duration) || 30,
      attendee_ids: d.attendees,
      // (empty on Google Meet: Google makes the link when the meeting is written to the calendar)
      meet_link: meetLink,
      description: d.notes,
    },
  };
}
