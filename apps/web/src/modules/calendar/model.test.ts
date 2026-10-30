import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import type { Meeting } from '../meet';
import {
  addDays,
  countsOver,
  dayKey,
  daysOf,
  hhmm,
  isCalendarFeed,
  isCalendarFollowup,
  isCalendarTask,
  isOverdue,
  itemsOn,
  meetingIcon,
  plural,
  rangeOf,
  sameDay,
  startOfMeeting,
  startOfWeek,
  stepped,
  syncOf,
  titleOf,
  titleOfDay,
  type CalendarFollowup,
  type CalendarTask,
} from './model';

const task = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Send the Avatr quote',
  description: 'Full spec',
  due_date: '2026-10-14',
  status: 'todo',
  priority: 'high',
  milestone: '',
  assignee_ids: ['81'],
  channel_name: 'Sales',
  ...over,
});
const followup = (over: Record<string, unknown> = {}) => ({
  id: 2,
  due_at: '2026-10-14T16:00:00.000Z',
  note: 'Call back',
  customer_id: 7,
  customer_name: 'Monier Samaha',
  ...over,
});
const meeting = (over: Record<string, unknown> = {}) => ({
  id: 3,
  title: 'Weekly sales sync',
  description: '',
  starts_at: '2026-10-14T10:00:00.000Z',
  duration_min: 30,
  attendee_ids: ['81'],
  meet_link: '',
  created_by: 'admin',
  created_at: '2026-10-01T09:30:00.000Z',
  ...over,
});
const feed = (over: Record<string, unknown> = {}) => ({
  from: '2026-10-13',
  to: '2026-10-22',
  tasks: [task()],
  meetings: [meeting()],
  followups: [followup()],
  ...over,
});

describe('what the feed is', () => {
  // The browser does not carry zod for this: these guards are held to the contract's schemas, on what is right and on every
  // way of being wrong that the page could be handed.
  it('has tasks recognised as the schema recognises them', () => {
    const tasks: unknown[] = [
      task(),
      task({ assignee_ids: [] }),
      task({ id: 1.5 }),
      task({ id: '1' }),
      task({ title: null }),
      task({ due_date: null }),
      task({ status: 1 }),
      task({ assignee_ids: [81] }),
      task({ assignee_ids: null }),
      task({ channel_name: undefined }),
      null,
      'task',
      [],
    ];
    for (const t of tasks)
      expect([isCalendarTask(t), t]).toEqual([schemas.CalendarTask.safeParse(t).success, t]);
  });
  it('has follow-ups recognised as the schema recognises them', () => {
    const items: unknown[] = [
      followup(),
      followup({ note: '', customer_name: '' }),
      followup({ id: 'x' }),
      followup({ customer_id: null }),
      followup({ customer_id: 1.5 }),
      followup({ due_at: 5 }),
      followup({ note: null }),
      null,
      {},
    ];
    for (const f of items)
      expect([isCalendarFollowup(f), f]).toEqual([
        schemas.CalendarFollowup.safeParse(f).success,
        f,
      ]);
  });
  it('is a feed when all three lists are lists of their kind', () => {
    const feeds: unknown[] = [
      feed(),
      feed({ tasks: [], meetings: [], followups: [] }),
      feed({ tasks: [task({ id: 'x' })] }),
      feed({ meetings: [{ id: 1 }] }),
      feed({ followups: 'none' }),
      feed({ from: undefined }),
      feed({ to: 5 }),
      [],
      null,
    ];
    for (const f of feeds)
      expect([isCalendarFeed(f), f]).toEqual([schemas.CalendarFeed.safeParse(f).success, f]);
  });
});

describe('the days on show', () => {
  // Wed 14 Oct 2026, in whatever zone the tests run in
  const wed = new Date(2026, 9, 14, 15, 20);

  it('writes a day as the server does', () => {
    expect(dayKey(wed)).toBe('2026-10-14');
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(sameDay(wed, new Date(2026, 9, 14, 1))).toBe(true);
    expect(sameDay(wed, new Date(2026, 9, 15))).toBe(false);
  });
  it('a week starts on the Sunday before, at midnight', () => {
    const s = startOfWeek(wed);
    expect([dayKey(s), s.getHours(), s.getMinutes(), s.getDay()]).toEqual(['2026-10-11', 0, 0, 0]);
    expect(dayKey(startOfWeek(new Date(2026, 9, 11, 23)))).toBe('2026-10-11');
  });
  it('adds days across a month and does not change what it was given', () => {
    const out = addDays(new Date(2026, 9, 30), 3);
    expect(dayKey(out)).toBe('2026-11-02');
    expect(dayKey(wed)).toBe('2026-10-14');
  });
  it('a week view is the week, and a month view is the whole weeks the month touches', () => {
    const w = rangeOf('week', wed);
    expect([dayKey(w.from), dayKey(w.to)]).toEqual(['2026-10-11', '2026-10-17']);
    const m = rangeOf('month', wed);
    expect([dayKey(m.from), dayKey(m.to)]).toEqual(['2026-09-27', '2026-10-31']);
    const feb = rangeOf('month', new Date(2026, 1, 10));
    expect([dayKey(feb.from), dayKey(feb.to)]).toEqual(['2026-02-01', '2026-02-28']);
    expect(daysOf(m.from, m.to)).toHaveLength(35);
    expect(daysOf(w.from, w.to).map(dayKey)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
  });
  it('the arrows go a week or a month on', () => {
    expect(dayKey(stepped('week', wed, 1))).toBe('2026-10-21');
    expect(dayKey(stepped('week', wed, -2))).toBe('2026-09-30');
    expect(dayKey(stepped('month', wed, 1))).toBe('2026-11-01');
    expect(dayKey(stepped('month', new Date(2026, 0, 31), -1))).toBe('2025-12-01');
  });
  it('the bar names what is on show', () => {
    expect(titleOf('month', wed)).toBe(
      wed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    );
    const w = rangeOf('week', wed);
    expect(titleOf('week', wed)).toBe(
      `${w.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${w.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    );
  });
  it('a day dialog is named by its day', () => {
    expect(titleOfDay('2026-10-14')).toBe(
      new Date(2026, 9, 14, 12).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    );
  });
  it('writes a time as the list does', () => {
    expect(hhmm(wed)).toBe(wed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  });
});

describe('what is on a day', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m).toISOString();
  const day = new Date(2026, 9, 14, 12);
  const f = {
    meetings: [
      meeting({ id: 1, starts_at: at(14) }),
      meeting({ id: 2, starts_at: at(9, 30) }),
      meeting({ id: 3, starts_at: new Date(2026, 9, 15, 9).toISOString() }),
    ] as unknown as Meeting[],
    followups: [
      followup({ id: 4, due_at: at(11) }),
      followup({ id: 5, due_at: at(9, 30) }),
    ] as unknown as CalendarFollowup[],
    tasks: [
      task({ id: 6, due_date: '2026-10-14' }),
      task({ id: 7, due_date: '2026-10-13' }),
    ] as unknown as CalendarTask[],
  };

  it('is the meetings and follow-ups in the order they happen, then the tasks (which have a day and no time)', () => {
    const got = itemsOn(f, day).map(
      i => i.kind + ':' + (i.kind === 'meeting' ? i.m.id : i.kind === 'followup' ? i.f.id : i.t.id),
    );
    // (the two at 9:30 keep the order they were given in: meetings first)
    expect(got).toEqual(['meeting:2', 'followup:5', 'followup:4', 'meeting:1', 'task:6']);
  });
  it('is nothing on a day with nothing', () => {
    expect(itemsOn(f, new Date(2026, 9, 20))).toEqual([]);
  });
  it('counts what the days on show hold, for the legend', () => {
    const days = daysOf(new Date(2026, 9, 12), new Date(2026, 9, 16));
    expect(countsOver(f, days)).toEqual({ meeting: 3, task: 2, followup: 2 });
    expect(countsOver(f, daysOf(new Date(2026, 9, 14), new Date(2026, 9, 14)))).toEqual({
      meeting: 2,
      task: 1,
      followup: 2,
    });
  });
  it('says "1 meeting" and "2 meetings"', () => {
    expect([plural(0, 'meeting'), plural(1, 'meeting'), plural(2, 'meeting')]).toEqual([
      '0 meetings',
      '1 meeting',
      '2 meetings',
    ]);
    expect(plural(1, 'follow-up')).toBe('1 follow-up');
  });
  it('a task is late when it is open and its day has passed', () => {
    const today = new Date(2026, 9, 14);
    expect(isOverdue(task({ due_date: '2026-10-13' }) as CalendarTask, today)).toBe(true);
    expect(isOverdue(task({ due_date: '2026-10-14' }) as CalendarTask, today)).toBe(false);
    expect(isOverdue(task({ due_date: '2026-10-13', status: 'done' }) as CalendarTask, today)).toBe(
      false,
    );
    expect(isOverdue(task({ due_date: '2026-10-15' }) as CalendarTask, today)).toBe(false);
  });
  it("a meeting in a huddle draws the huddle's glyph, any other the video call's", () => {
    expect(meetingIcon(meeting({ meet_link: 'huddle:3' }) as Meeting)).toBe('radio');
    expect(meetingIcon(meeting({ meet_link: 'https://meet.google.com/x' }) as Meeting)).toBe(
      'video',
    );
    expect(meetingIcon(meeting({ meet_link: '' }) as Meeting)).toBe('video');
  });
  it("writes a meeting's start for its dialog", () => {
    const m = meeting({ starts_at: new Date(2026, 9, 14, 10, 30).toISOString() }) as Meeting;
    expect(startOfMeeting(m)).toBe(
      new Date(2026, 9, 14, 10, 30).toLocaleString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });
});

describe("the admin's Google Calendar link", () => {
  it('is read as the server says it, and is nothing when the server says nothing', () => {
    expect(syncOf({ configured: true, connected: true, email: 'a@b.co' })).toEqual({
      configured: true,
      connected: true,
      email: 'a@b.co',
    });
    expect(syncOf({ configured: true })).toEqual({ configured: true, connected: false, email: '' });
    expect(syncOf({ configured: 'yes', connected: 1, email: 5 })).toEqual({
      configured: false,
      connected: false,
      email: '',
    });
    expect(syncOf(null)).toEqual({ configured: false, connected: false, email: '' });
    expect(syncOf('x')).toEqual({ configured: false, connected: false, email: '' });
  });
});
