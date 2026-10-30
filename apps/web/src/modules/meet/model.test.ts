import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  classicRoomUrl,
  draftOf,
  DURATIONS,
  huddleRoomOf,
  isMeeting,
  isMeetingList,
  linkUrl,
  meetCodeUrl,
  peopleOf,
  roomsOf,
  summaryOf,
  whenOf,
  type Draft,
  type Meeting,
} from './model';

const meeting = (over: Record<string, unknown> = {}) => ({
  id: 7,
  title: 'Weekly sales sync',
  description: 'Agenda',
  starts_at: '2026-10-14T10:00:00.000Z',
  duration_min: 45,
  attendee_ids: ['61', '62'],
  meet_link: 'https://meet.google.com/abc-defg-hij',
  created_by: 'employee_61',
  created_at: '2026-10-01T09:30:00.000Z',
  ...over,
});

describe('what a meeting is', () => {
  // The browser does not carry zod for this: these guards are held to the contract's schema, on what is right and on every
  // way of being wrong that the page could be handed.
  const meetings: unknown[] = [
    meeting(),
    meeting({ description: '', meet_link: '', attendee_ids: [] }),
    meeting({ meet_link: 'huddle:3', created_by: 'admin' }),
    meeting({ id: 1.5 }),
    meeting({ id: '7' }),
    meeting({ id: null }),
    meeting({ id: 2 ** 60 }),
    meeting({ title: null }),
    meeting({ description: null }),
    meeting({ starts_at: 1893456000000 }),
    meeting({ duration_min: '45' }),
    meeting({ duration_min: 45.5 }),
    meeting({ attendee_ids: [61, 62] }),
    meeting({ attendee_ids: null }),
    meeting({ attendee_ids: 'x' }),
    meeting({ meet_link: null }),
    meeting({ created_by: null }),
    meeting({ created_at: undefined }),
    null,
    'meeting',
    [],
    {},
  ];
  it('is recognised exactly as the schema in packages/contracts recognises it', () => {
    for (const m of meetings) {
      expect([isMeeting(m), m]).toEqual([schemas.Meeting.safeParse(m).success, m]);
    }
  });
  it('is a list only when it holds meetings (and says so as { items })', () => {
    const lists: unknown[] = [
      { items: [] },
      { items: [meeting(), meeting({ id: 8 })] },
      { items: [meeting(), { id: 1 }] },
      { items: 'x' },
      { items: null },
      [meeting()],
      null,
      {},
    ];
    for (const l of lists) {
      expect([isMeetingList(l), l]).toEqual([schemas.MeetingList.safeParse(l).success, l]);
    }
  });
});

describe('who can be invited, and where a huddle can be held', () => {
  it('are whatever the classic lists hold that has an id and a name, the id as text', () => {
    expect(
      peopleOf([
        { id: 61, name: 'Ana', username: 'ana', avatar_url: '' },
        { id: '62', name: 'Bo' },
        { id: 63 },
        { name: 'nobody' },
        null,
        'x',
      ]),
    ).toEqual([
      { id: '61', name: 'Ana' },
      { id: '62', name: 'Bo' },
      { id: '63', name: '' },
    ]);
    expect(peopleOf(null)).toEqual([]);
    expect(peopleOf({ error: 'no' })).toEqual([]);
  });
  it('rooms without a name are "Conversation"', () => {
    expect(roomsOf([{ id: 3, name: 'Sales' }, { id: 4, name: '' }, { id: 5 }])).toEqual([
      { id: '3', name: 'Sales' },
      { id: '4', name: 'Conversation' },
      { id: '5', name: 'Conversation' },
    ]);
    expect(roomsOf(undefined)).toEqual([]);
  });
});

describe('where a meeting is joined', () => {
  it('a huddle is huddle:<digits>, and nothing else is', () => {
    expect(huddleRoomOf('huddle:3')).toBe('3');
    expect(huddleRoomOf('huddle:42')).toBe('42');
    for (const no of [
      '',
      'huddle:',
      'huddle:x',
      'huddle:3 ',
      ' huddle:3',
      'huddle:3/4',
      'https://x.example',
      'Huddle:3',
    ]) {
      expect(huddleRoomOf(no)).toBe('');
    }
  });

  it('a link is made clickable only when it really is a web address', () => {
    expect(linkUrl('https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(linkUrl('  http://zoom.example/j/1  ')).toBe('http://zoom.example/j/1');
    expect(linkUrl('zoom.example/j/1')).toBe('https://zoom.example/j/1');
    expect(linkUrl('meet.google.com')).toBe('https://meet.google.com/');
    for (const no of [
      '',
      '   ',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,hi',
      'ftp://x.example/f',
      'mailto:a@b.co',
      'localhost',
      'not a link',
      'huddle:3',
      'file:///etc/passwd',
    ]) {
      expect([no, linkUrl(no)]).toEqual([no, '']);
    }
  });

  it('a Meet code opens that room, spaces and all', () => {
    expect(meetCodeUrl(' abc-defg-hij ')).toBe('https://meet.google.com/abc-defg-hij');
    expect(meetCodeUrl('abc defg hij')).toBe('https://meet.google.com/abcdefghij');
    expect(meetCodeUrl('   ')).toBe('');
    expect(meetCodeUrl('')).toBe('');
  });

  it('a huddle is held in the classic portal for now: its chat room, at the address that is the classic page', () => {
    expect(classicRoomUrl('team', '3')).toBe('/legacy/employee?chat=3');
    expect(classicRoomUrl('admin', '3')).toBe('/legacy/dashboard?chat=3');
  });
});

describe('how a meeting is written in the list', () => {
  it('has a short weekday, the day of the month, and the time', () => {
    const t = new Date(2026, 9, 14, 9, 30);
    const w = whenOf(t.toISOString());
    expect(w.weekday).toBe(t.toLocaleDateString(undefined, { weekday: 'short' }));
    expect(w.day).toBe(14);
    expect(w.time).toBe(t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  });
  it('says how long and how many', () => {
    const m = meeting() as Meeting;
    expect(summaryOf(m)).toBe(`${whenOf(m.starts_at).time} · 45 min · 2 attendee(s)`);
    expect(summaryOf({ ...m, attendee_ids: [] })).toMatch(/ · 0 attendee\(s\)$/);
  });
});

describe('the scheduling sheet as it opens', () => {
  const rooms = [
    { id: '3', name: 'Sales' },
    { id: '4', name: 'Ops' },
  ];
  const now = new Date(2026, 9, 14, 9, 30);

  it('a new meeting is an hour from now, thirty minutes, on Google Meet, with nobody picked', () => {
    expect(draftOf(null, undefined, rooms, now)).toEqual({
      title: '',
      date: '2026-10-14',
      time: '10:30',
      duration: 30,
      attendees: [],
      where: 'meet',
      room: '3',
      link: '',
      notes: '',
    });
  });
  it('a day picked on the calendar seeds the date, at ten in the morning', () => {
    const d = draftOf(null, { date: '2026-11-02' }, rooms, now);
    expect([d.date, d.time]).toEqual(['2026-11-02', '10:00']);
  });
  it('…and a day that is not a date seeds nothing', () => {
    const d = draftOf(null, { date: 'soon' }, rooms, now);
    expect([d.date, d.time]).toEqual(['2026-10-14', '10:30']);
  });
  it('with no chat rooms there is no room to pick', () => {
    expect(draftOf(null, undefined, [], now).room).toBe('');
  });
  it("an existing meeting is as it stands, in the person's own time", () => {
    const m = meeting({ starts_at: new Date(2026, 9, 20, 15, 5).toISOString() }) as Meeting;
    expect(draftOf(m, undefined, rooms, now)).toEqual({
      title: 'Weekly sales sync',
      date: '2026-10-20',
      time: '15:05',
      duration: 45,
      attendees: ['61', '62'],
      where: 'link',
      room: '3',
      link: 'https://meet.google.com/abc-defg-hij',
      notes: 'Agenda',
    });
  });
  it('a meeting with no link is on Google Meet; one in a huddle names its room and has no link', () => {
    expect(draftOf(meeting({ meet_link: '' }) as Meeting, undefined, rooms, now).where).toBe(
      'meet',
    );
    const h = draftOf(meeting({ meet_link: 'huddle:4' }) as Meeting, undefined, rooms, now);
    expect([h.where, h.room, h.link]).toEqual(['huddle', '4', '']);
  });
  it('offers the lengths the classic sheet does', () => {
    expect([...DURATIONS]).toEqual([15, 30, 45, 60, 90, 120]);
  });
});

describe('what the sheet sends', () => {
  const draft = (over: Partial<Draft> = {}): Draft => ({
    title: '  Weekly sales sync ',
    date: '2026-10-14',
    time: '10:30',
    duration: 45,
    attendees: ['61', '64'],
    where: 'meet',
    room: '3',
    link: '',
    notes: 'Agenda',
    ...over,
  });
  const body = (d: Draft) => {
    const out = bodyOf(d);
    if (!out.ok) throw new Error(out.message);
    return out.body;
  };

  it('is what the server takes, and the server takes it', () => {
    const b = body(draft());
    expect(b).toEqual({
      title: 'Weekly sales sync',
      starts_at: new Date(2026, 9, 14, 10, 30).toISOString(),
      duration_min: 45,
      attendee_ids: ['61', '64'],
      meet_link: '',
      description: 'Agenda',
    });
    expect(schemas.MeetingBody.safeParse(b).success).toBe(true);
  });
  it('asks Google for the link by sending none; a huddle sends its room; a link of its own is trimmed', () => {
    expect(body(draft({ where: 'meet', link: 'https://ignored.example' })).meet_link).toBe('');
    expect(
      body(draft({ where: 'huddle', room: '4', link: 'https://ignored.example' })).meet_link,
    ).toBe('huddle:4');
    expect(body(draft({ where: 'huddle', room: '' })).meet_link).toBe('');
    expect(body(draft({ where: 'link', link: '  https://zoom.example/j/1 ' })).meet_link).toBe(
      'https://zoom.example/j/1',
    );
  });
  it("refuses, in the classic sheet's words, a meeting with no title or no moment", () => {
    expect(bodyOf(draft({ title: '   ' }))).toEqual({ ok: false, message: 'Title is required.' });
    expect(bodyOf(draft({ date: '' }))).toEqual({ ok: false, message: 'Pick a date and time.' });
    expect(bodyOf(draft({ time: '' }))).toEqual({ ok: false, message: 'Pick a date and time.' });
    expect(bodyOf(draft({ date: '2026-13-45' }))).toEqual({
      ok: false,
      message: 'Pick a date and time.',
    });
  });
  it('is thirty minutes when the length is not a number', () => {
    expect(body(draft({ duration: Number.NaN })).duration_min).toBe(30);
  });
});
