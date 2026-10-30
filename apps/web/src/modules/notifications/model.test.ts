import { inPortal, screenOf } from '@motolinker/contracts/modules';
import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import {
  badgeText,
  cleanTitle,
  countUnread,
  fromStream,
  iconOf,
  isNotification,
  isNotificationList,
  KEEP,
  relativeTime,
  routeOf,
  sameId,
  toastText,
  TYPE_ICONS,
  urlOf,
  withAllRead,
  withLive,
  withRead,
  type Notification,
} from './model';

const note = (id: number | string, extra: Partial<Notification> = {}): Notification => ({
  id,
  type: 'task',
  title: `Title ${id}`,
  body: '',
  url: '',
  read: false,
  created_at: '2026-10-01T09:00:00.000Z',
  ...extra,
});

describe('what the server lists is recognised as the contract says', () => {
  // The app does not carry zod just to read one list, so the guard is written by hand and held to the schema here.
  const good = { items: [note(1), note('tmp-1700000000000', { read: true })], unread: 1 };
  const corpus: unknown[] = [
    good,
    { items: [], unread: 0 },
    { ...good, extra: 'ignored' },
    { items: [{ ...note(1), member_key: 'admin' }], unread: 0 },
    null,
    undefined,
    'text',
    [],
    {},
    { items: [] },
    { unread: 0 },
    { items: 'no', unread: 0 },
    { items: [], unread: -1 },
    { items: [], unread: 1.5 },
    { items: [], unread: '1' },
    { items: [null], unread: 0 },
    { items: [note(1.5)], unread: 0 },
    { items: [note('')], unread: 0 },
    { items: [{ ...note(1), id: null }], unread: 0 },
    { items: [{ ...note(1), id: true }], unread: 0 },
    { items: [{ ...note(1), id: undefined }], unread: 0 },
    { items: [{ ...note(1), type: null }], unread: 0 },
    { items: [{ ...note(1), title: 5 }], unread: 0 },
    { items: [{ ...note(1), body: null }], unread: 0 },
    { items: [{ ...note(1), url: undefined }], unread: 0 },
    { items: [{ ...note(1), read: 'false' }], unread: 0 },
    { items: [{ ...note(1), read: 0 }], unread: 0 },
    { items: [{ ...note(1), created_at: 20261001 }], unread: 0 },
    { items: [note(1), { ...note(2), read: null }], unread: 0 },
  ];
  it.each(corpus.map((v, i) => [i, v] as const))(
    'agrees with the schema about example %i',
    (_i, v) => {
      expect(isNotificationList(v)).toBe(schemas.NotificationList.safeParse(v).success);
    },
  );

  it('agrees about one notification, too', () => {
    for (const n of [
      note(1),
      note('x'),
      { ...note(1), read: undefined },
      { ...note(1), id: 0.5 },
      3,
      null,
    ]) {
      expect(isNotification(n)).toBe(schemas.Notification.safeParse(n).success);
    }
  });
});

describe('a row off the live stream', () => {
  it('is read as the server reads a stored one: an owner is dropped, a missing read is unread, a missing type is general', () => {
    const live = fromStream({
      id: 202,
      member_key: 'employee_51',
      type: 'request',
      title: 'A request',
      body: 'Was approved',
      url: '/employee#requests',
      created_at: '2026-10-30T13:32:08.706Z',
    });
    expect(live).toEqual({
      id: 202,
      type: 'request',
      title: 'A request',
      body: 'Was approved',
      url: '/employee#requests',
      read: false,
      created_at: '2026-10-30T13:32:08.706Z',
    });
    expect(fromStream({ id: 1, title: 'x' })).toMatchObject({
      type: 'general',
      body: '',
      url: '',
      read: false,
    });
  });

  it('keeps a row that could not be stored (its id says so) and one that arrives already read', () => {
    expect(fromStream({ id: 'tmp-1700000000000', title: 't', read: false })?.id).toBe(
      'tmp-1700000000000',
    );
    expect(fromStream({ id: 3, title: 't', read: true })?.read).toBe(true);
  });

  it('is given the time it arrived when it carries none, so it reads "just now" and not "Invalid Date"', () => {
    const arrived = fromStream({ id: 1, title: 'x' });
    expect(Number.isNaN(Date.parse(arrived?.created_at ?? ''))).toBe(false);
    expect(relativeTime(arrived!.created_at)).toBe('just now');
  });

  it('is nothing at all unless it has an id and a title', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      [],
      {},
      { id: 1 },
      { title: 't' },
      { id: '', title: 't' },
      { id: 1.5, title: 't' },
      { id: 1, title: 4 },
    ]) {
      expect(fromStream(bad)).toBeNull();
    }
  });

  it('always comes out as a notification the contract accepts, whatever was left out of it', () => {
    for (const raw of [
      { id: 1, title: 't' },
      { id: 'tmp-1', title: '', body: null, type: 7, read: 'yes' },
    ]) {
      expect(schemas.Notification.safeParse(fromStream(raw)).success).toBe(true);
    }
  });
});

describe('the list, changed', () => {
  it('has a new one at its head and the oldest gone once there are more than fifty', () => {
    const full = Array.from({ length: KEEP }, (_, i) => note(KEEP - i));
    const next = withLive(full, note(KEEP + 1));
    expect(next).toHaveLength(KEEP);
    expect(next[0]?.id).toBe(KEEP + 1);
    expect(next.at(-1)?.id).toBe(2);
  });

  it('does not add one it already has (a list read just after it arrived already holds it), by id, whatever the id is written as', () => {
    const list = [note(5), note(4)];
    expect(withLive(list, note(5))).toEqual(list);
    expect(withLive(list, note('5'))).toEqual(list);
    expect(withLive(list, note(6)).map(n => n.id)).toEqual([6, 5, 4]);
  });

  it('marks one read, and only that one, leaving the list it was given alone', () => {
    const list = [note(3), note(2), note(1)];
    const next = withRead(list, 2);
    expect(next.map(n => n.read)).toEqual([false, true, false]);
    expect(list.every(n => !n.read)).toBe(true);
    expect(withRead(list, '3').map(n => n.read)).toEqual([true, false, false]);
    expect(withRead(list, 99).map(n => n.read)).toEqual([false, false, false]);
  });

  it('hands back the very rows that did not change, so what shows them is not drawn again for nothing', () => {
    const list = [note(3), note(2, { read: true }), note(1)];
    const next = withRead(list, 3);
    expect(next[1]).toBe(list[1]);
    expect(next[2]).toBe(list[2]);
    expect(withRead(list, 2)[1]).toBe(list[1]);
    expect(withAllRead(list)[1]).toBe(list[1]);
  });

  it('marks all read, and counts only what is not', () => {
    const list = [note(3), note(2, { read: true }), note(1)];
    expect(countUnread(list)).toBe(2);
    expect(countUnread(withAllRead(list))).toBe(0);
    expect(list[0]?.read).toBe(false);
    expect(withAllRead([]).length).toBe(0);
  });

  it('compares ids as the classic pages do: as text', () => {
    expect(sameId(5, '5')).toBe(true);
    expect(sameId(5, 6)).toBe(false);
    expect(sameId('tmp-1', 'tmp-1')).toBe(true);
  });
});

describe('the words', () => {
  it('count to 99 and say 99+ after that', () => {
    expect([1, 9, 10, 99, 100, 5000].map(badgeText)).toEqual(['1', '9', '10', '99', '99+', '99+']);
  });

  it('put the body after the title, when there is one', () => {
    expect(toastText(note(1, { title: 'New task assigned', body: 'Quote the Hilux' }))).toBe(
      'New task assigned · Quote the Hilux',
    );
    expect(toastText(note(1, { title: 'Hours approved', body: '' }))).toBe('Hours approved');
  });

  it('drop leading emoji and symbols from a title, and leave the rest as it is', () => {
    expect(cleanTitle('📋 New task')).toBe('New task');
    expect(cleanTitle('⚠️  — Overdue: call back')).toBe('Overdue: call back');
    expect(cleanTitle('New task 📋')).toBe('New task 📋');
    expect(cleanTitle('مهمة جديدة')).toBe('مهمة جديدة');
    expect(cleanTitle('7 days left')).toBe('7 days left');
  });

  it('keep a title that is nothing but symbols, rather than show nothing', () => {
    expect(cleanTitle('🔔')).toBe('🔔');
    expect(cleanTitle('')).toBe('');
  });

  it("say how long ago, in the classic pages' steps", () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const ago = (s: number) => relativeTime(new Date(now - s * 1000).toISOString(), now);
    expect([0, 59, 60, 119, 3599, 3600, 86399, 86400, 604799].map(ago)).toEqual([
      'just now',
      'just now',
      '1m ago',
      '1m ago',
      '59m ago',
      '1h ago',
      '23h ago',
      '1d ago',
      '6d ago',
    ]);
    expect(ago(604800)).toBe(new Date(now - 604800 * 1000).toLocaleDateString());
  });
});

describe('the icon of a type', () => {
  it("is the classic portals' for each type they name, and the bell for any other", () => {
    expect(Object.keys(TYPE_ICONS).sort()).toEqual([
      'deal',
      'followup',
      'hours',
      'huddle',
      'issue',
      'lead',
      'reminder',
      'request',
      'security',
      'task',
    ]);
    expect(iconOf('task')).toBe('clipboard-list');
    expect(iconOf('followup')).toBe('alarm-clock');
    expect(iconOf('general')).toBe('bell');
    expect(iconOf('')).toBe('bell');
  });

  it('is not fooled by a type that is the name of something every object has', () => {
    expect(iconOf('constructor')).toBe('bell');
    expect(iconOf('__proto__')).toBe('bell');
    expect(iconOf('toString')).toBe('bell');
  });
});

describe('where a click goes', () => {
  it('is the page the link names, if it is a page of this portal', () => {
    expect(routeOf('admin', '/dashboard#tasks', 'request')).toBe('/tasks');
    expect(routeOf('admin', '/dashboard#customers', 'task')).toBe('/leads');
    expect(routeOf('team', '/employee#requests', 'task')).toBe('/requests');
    expect(routeOf('team', '/employee#log', 'task')).toBe('/hours');
    expect(routeOf('admin', '/dashboard#notif', 'task')).toBe('/notifications');
  });

  it('is Security for #security, in either portal', () => {
    expect(routeOf('admin', '/dashboard#security', 'security')).toBe('/security');
    expect(routeOf('team', '/employee#security', 'task')).toBe('/security');
  });

  it("is, when the link names no page of this portal, the type's page — as each portal has always chosen it", () => {
    const admin = {
      request: '/requests',
      task: '/tasks',
      hours: '/hours',
      quotation: '/quotation',
      lead: '/leads',
      deal: '/deals',
      followup: '/leads',
    };
    for (const [type, path] of Object.entries(admin)) expect(routeOf('admin', '', type)).toBe(path);
    const team = {
      hours: '/hours',
      task: '/tasks',
      reminder: '/tasks',
      lead: '/quotation',
      deal: '/deals',
      request: '/requests',
      followup: '/leads',
    };
    for (const [type, path] of Object.entries(team)) expect(routeOf('team', '', type)).toBe(path);
  });

  it('ignores a link that names a page the portal does not have', () => {
    expect(routeOf('team', '/employee#workspace', 'task')).toBe('/tasks');
    expect(routeOf('admin', '/dashboard#nonsense', 'task')).toBe('/tasks');
  });

  it('opens Issues in either portal, though the classic admin portal has no such page', () => {
    expect(routeOf('team', '/employee#issues', 'issue')).toBe('/issues');
    expect(routeOf('admin', '/dashboard#issues', 'request')).toBe('/issues');
  });

  it('stays where it is, for the admin, when nothing says where; the team goes to its hours', () => {
    expect(routeOf('admin', '', 'general')).toBeNull();
    expect(routeOf('admin', '', 'reminder')).toBeNull();
    expect(routeOf('team', '', 'general')).toBe('/hours');
    expect(routeOf('team', '/employee', 'huddle')).toBe('/hours');
  });

  it('is not fooled by a type that is the name of something every object has', () => {
    expect(routeOf('admin', '', 'constructor')).toBeNull();
    expect(routeOf('team', '', '__proto__')).toBe('/hours');
  });

  it('reads the first thing after the first #, as the classic pages do', () => {
    expect(routeOf('admin', '/dashboard#tasks#deals', 'request')).toBe('/tasks');
    expect(routeOf('admin', 'tasks', 'request')).toBe('/requests');
  });

  it('only ever names a screen the portal has', () => {
    for (const portal of ['admin', 'team'] as const) {
      for (const type of [...Object.keys(TYPE_ICONS), 'quotation', 'general']) {
        const path = routeOf(portal, '', type);
        if (path === null) continue;
        const screen = screenOf(path.slice(1));
        expect(screen && inPortal(screen, portal), `${portal} ${type} -> ${path}`).toBe(true);
      }
    }
  });

  it("points a team member's notification with no link at the portal itself, and the admin's at nothing", () => {
    expect(urlOf('team', note(1, { url: '' }))).toBe('/employee');
    expect(urlOf('admin', note(1, { url: '' }))).toBe('');
    expect(urlOf('team', note(1, { url: '/employee#requests' }))).toBe('/employee#requests');
  });
});
