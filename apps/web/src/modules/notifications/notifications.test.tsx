import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminMe, json, teamMe } from '../../test/helpers';
import { open } from '../../test/session';
import type { Notification } from './model';

const STREAM = {
  admin: '/api/dashboard/notifications/stream?hd=2',
  team: '/api/employee/notifications/stream?hd=2',
};

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const note = (id: number | string, extra: Partial<Notification> = {}): Notification => ({
  id,
  type: 'general',
  title: `Title ${id}`,
  body: '',
  url: '',
  read: false,
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...extra,
});
const many = (count: number, extra: Partial<Notification> = {}) =>
  Array.from({ length: count }, (_, i) => note(count - i, extra));

/** What the server answers when the list is asked for: the notifications, or a status that is not a success. */
type ListAnswer = Notification[] | { status: number };

interface Boot {
  /** what the server lists, each time it is asked after the first (the last answer stands) */
  lists?: ListAnswer[];
  /** how the server takes a mark-as-read */
  readStatus?: number;
  /** the server holds a mark-as-read until this is released */
  hold?: Promise<void>;
  /** …and holds the answer to the nth question about the list (the first is 0) until this is released */
  holdList?: { at: number; until: Promise<void> };
  entries?: string[];
  browser?: boolean;
  safe?: boolean;
}

/** A signed-in session whose server has these notifications, and a record of what it was asked. */
async function boot(
  portal: 'admin' | 'team',
  first: ListAnswer,
  {
    lists = [],
    readStatus = 200,
    hold,
    holdList,
    entries = ['/home'],
    browser = false,
    safe = false,
  }: Boot = {},
) {
  const answers = [first, ...lists];
  let asked = 0;
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(), {
    entries,
    browser,
    safe,
    more: {
      '/api/v1/notifications': async () => {
        const nth = asked++;
        const answer = answers[Math.min(nth, answers.length - 1)]!;
        if (holdList && nth === holdList.at) await holdList.until;
        if (!Array.isArray(answer))
          return json(answer.status, { error: 'no', code: 'unavailable' });
        return json(200, { items: answer, unread: answer.filter(n => !n.read).length });
      },
      '/api/v1/notifications/read': async () => {
        await hold;
        return readStatus === 200
          ? json(200, { ok: true })
          : json(readStatus, { error: 'no', code: 'unavailable' });
      },
    },
  });
  await waitFor(() => expect(s.calls(STREAM[portal])).toHaveLength(1));
  const sent = () =>
    s.calls('/api/v1/notifications/read').map(c => JSON.parse(String(c.init.body)) as unknown);
  const listed = () => s.calls('/api/v1/notifications').length;
  return Object.assign(s, { sent, listed });
}

const bell = () => document.querySelector('[data-part=bell]') as HTMLElement;
const ready = () => waitFor(() => expect(bell()).toBeTruthy());
const badge = () => document.querySelector('[data-part=bellBadge]');
const navBadge = () => document.querySelector('[data-screen=notifications] [data-part=navBadge]');
const panel = () => document.querySelector('[data-part=panel]');
const panelRows = () => [...document.querySelectorAll('[data-part=panel] [data-part=item]')];
const titles = (rows: Element[]) =>
  rows.map(r => r.querySelector('[data-part=title]')?.textContent);
const live = (n: object) => `event: notification\ndata: ${JSON.stringify(n)}\n\n`;

describe('the bell', () => {
  it("shows how many are unread, on the bell and on the rail's Notifications item, and nothing when none are", async () => {
    await boot('admin', [note(3), note(2), note(1, { read: true })]);
    await waitFor(() => expect(badge()?.textContent).toBe('2'));
    expect(navBadge()?.textContent).toBe('2');
    expect(document.querySelectorAll('[data-part=navBadge]')).toHaveLength(1);
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread');
    cleanup();
    await boot('admin', [note(1, { read: true })]);
    await ready();
    expect(badge()).toBeNull();
    expect(navBadge()).toBeNull();
  });

  it('says 99+ for a hundred', async () => {
    await boot('admin', many(100));
    await waitFor(() => expect(badge()?.textContent).toBe('99+'));
    expect(navBadge()?.textContent).toBe('99+');
  });

  it("is in the team portal's top bar too, with its own count", async () => {
    await boot('team', [note(2), note(1)]);
    await waitFor(() => expect(badge()?.textContent).toBe('2'));
    expect(navBadge()?.textContent).toBe('2');
    expect(document.querySelector('[data-part=header] [data-part=bellWrap]')).toBeTruthy();
  });

  it('reads them all when it is opened — at once on screen, and the server is told once', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(2), note(1)]);
    await waitFor(() => expect(badge()?.textContent).toBe('2'));
    await user.click(bell());
    expect(panel()).toBeTruthy();
    await waitFor(() => expect(badge()).toBeNull());
    expect(navBadge()).toBeNull();
    expect(panelRows().map(r => r.getAttribute('data-unread'))).toEqual(['false', 'false']);
    await waitFor(() => expect(s.sent()).toEqual([{ all: true }]));
    await user.click(bell());
    expect(panel()).toBeNull();
    await user.click(bell());
    expect(panel()).toBeTruthy();
    expect(s.sent()).toEqual([{ all: true }]);
  });

  it('lists the newest twenty in its panel, and says so when there are none', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('admin', many(25, { read: true }));
    await ready();
    await user.click(bell());
    await waitFor(() => expect(panelRows()).toHaveLength(20));
    expect(titles(panelRows())[0]).toBe('Title 25');
    expect(titles(panelRows())[19]).toBe('Title 6');
    cleanup();
    await boot('team', []);
    await ready();
    await user.click(bell());
    expect(document.querySelector('[data-part=panelEmpty]')?.textContent).toBe(
      'No notifications yet',
    );
  });

  it('draws no empty line for a notification that has nothing to say beyond its title', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('admin', [
      note(2, { title: 'With words', body: 'Some words', read: true }),
      note(1, { title: 'Bare', body: '', read: true }),
    ]);
    await ready();
    await user.click(bell());
    await waitFor(() => expect(panelRows()).toHaveLength(2));
    expect(panelRows().map(r => r.querySelectorAll('[data-part=text]').length)).toEqual([1, 0]);
  });

  it('closes on Escape and on a click anywhere else', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('admin', [note(1, { read: true })]);
    await ready();
    await user.click(bell());
    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
    await user.click(bell());
    expect(panel()).toBeTruthy();
    await user.click(document.body);
    expect(panel()).toBeNull();
    await user.click(bell());
    await user.click(within(panel() as HTMLElement).getByText('Notifications'));
    expect(panel()).toBeTruthy();
  });

  it('takes "View all" to the Notification Center', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('admin', [note(1, { read: true })]);
    await ready();
    await user.click(bell());
    await user.click(screen.getByRole('button', { name: 'View all' }));
    expect(await screen.findByText('Notification Center')).toBeTruthy();
    expect(panel()).toBeNull();
    expect(screen.getByRole('link', { name: /Notifications/ }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('marks all read from its panel without closing it', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(2, { read: true }), note(1, { read: true })]);
    await ready();
    await user.click(bell());
    s.push(live(note(3, { title: 'Fresh', body: 'Just now' })));
    await waitFor(() => expect(panelRows()).toHaveLength(3));
    expect(panelRows()[0]?.getAttribute('data-unread')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(panel()).toBeTruthy();
    await waitFor(() => expect(panelRows()[0]?.getAttribute('data-unread')).toBe('false'));
    await waitFor(() => expect(s.sent()).toEqual([{ all: true }]));
  });
});

describe('a click on a notification', () => {
  it('reads that one, closes the panel and goes to the page the link names (the admin)', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [
      note(7, { type: 'request', title: 'A request', url: '/dashboard#tasks', read: true }),
    ]);
    await ready();
    await user.click(bell());
    await user.click(await screen.findByText('A request'));
    expect(panel()).toBeNull();
    expect(await screen.findByTitle('Tasks (classic page)')).toBeTruthy();
    expect(s.sent()).toEqual([{ id: 7 }]);
  });

  it('goes by its type when the link names no page, and nowhere for the admin when the type has none', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('admin', [
      note(2, { type: 'lead', title: 'A lead', read: true }),
      note(1, { type: 'general', title: 'News', read: true }),
    ]);
    await ready();
    await user.click(bell());
    await user.click(await screen.findByText('News'));
    expect(document.querySelector('iframe')).toBeNull();
    await user.click(bell());
    await user.click(await screen.findByText('A lead'));
    expect(await screen.findByTitle('Leads (classic page)')).toBeTruthy();
  });

  it('takes a team member to the page their link names, by their type otherwise, and to their hours when it has none', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('team', [
      note(3, { type: 'request', title: 'Approved', url: '/employee#requests', read: true }),
      note(2, { type: 'reminder', title: 'Call back', url: '', read: true }),
      note(1, { type: 'general', title: 'Hello', url: '', read: true }),
    ]);
    await ready();
    await user.click(bell());
    await user.click(await screen.findByText('Approved'));
    expect(await screen.findByTitle('Requests (classic page)')).toBeTruthy();
    await user.click(bell());
    await user.click(await screen.findByText('Hello'));
    expect(await screen.findByTitle('Hours Log (classic page)')).toBeTruthy();
  });

  it('is done with the keyboard too', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(5, { type: 'task', title: 'Do it', read: true })]);
    await ready();
    await user.click(bell());
    const row = await screen.findByRole('button', { name: /Do it/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTitle('Tasks (classic page)')).toBeTruthy();
    expect(s.sent()).toEqual([{ id: 5 }]);
  });

  it('is done with the space bar, too, and by nothing else on the keyboard', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(6, { type: 'task', title: 'Do it too', read: true })]);
    await ready();
    await user.click(bell());
    const row = await screen.findByRole('button', { name: /Do it too/ });
    row.focus();
    await user.keyboard('a');
    expect(s.sent()).toEqual([]);
    await user.keyboard(' ');
    expect(await screen.findByTitle('Tasks (classic page)')).toBeTruthy();
    expect(s.sent()).toEqual([{ id: 6 }]);
  });

  it('does not ask the server to read one that was never stored (its id says so)', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(1, { read: true })]);
    await ready();
    s.push(
      live({
        id: 'tmp-1700000000000',
        member_key: 'admin',
        type: 'task',
        title: 'Not stored',
        body: '',
        url: '',
        read: false,
        created_at: new Date().toISOString(),
      }),
    );
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
    await user.click(bell());
    await user.click(within(panel() as HTMLElement).getByText('Not stored'));
    await waitFor(() => expect(badge()).toBeNull());
    expect(s.sent()).toEqual([{ all: true }]);
  });

  it('asks the server what is true when it would not take it', async () => {
    const user = userEvent.setup({ delay: null });
    let release = () => {};
    const hold = new Promise<void>(resolve => (release = resolve));
    const s = await boot('admin', [note(1, { title: 'Still unread' })], {
      readStatus: 400,
      hold,
      lists: [[note(1, { title: 'Still unread' })]],
    });
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
    await user.click(bell());
    await waitFor(() => expect(badge()).toBeNull());
    expect(s.listed()).toBe(1);
    release();
    await waitFor(() => expect(s.listed()).toBe(2));
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
  });
});

describe('what the person did, and what the server said', () => {
  it('is not undone by a reading of the list that was on its way when the person read them', async () => {
    const user = userEvent.setup({ delay: null });
    let release = () => {};
    const until = new Promise<void>(resolve => (release = resolve));
    const list = [note(2, { title: 'Two' }), note(1, { title: 'One', read: true })];
    const s = await boot('admin', list, { lists: [list], holdList: { at: 1, until } });
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
    await user.click(document.querySelector('[data-screen=notifications]') as HTMLElement);
    await waitFor(() => expect(s.listed()).toBe(2));
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(badge()).toBeNull());
    release();
    await new Promise(r => setTimeout(r, 120));
    expect(badge()).toBeNull();
    expect(
      [...document.querySelectorAll('[data-part=centerItem]')].map(r =>
        r.getAttribute('data-unread'),
      ),
    ).toEqual(['false', 'false']);
  });

  it('does not say a list it has is unavailable because the last asking failed', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('admin', [], { lists: [{ status: 404 }] });
    await ready();
    await user.click(document.querySelector('[data-screen=notifications]') as HTMLElement);
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    await new Promise(r => setTimeout(r, 120));
    expect(screen.queryByText('Notifications are unavailable right now.')).toBeNull();
  });

  it("says in the bell's panel, too, that it cannot tell", async () => {
    const user = userEvent.setup({ delay: null });
    await boot('team', { status: 404 });
    await ready();
    await user.click(bell());
    expect(
      (await screen.findByText('Notifications are unavailable right now.')).getAttribute(
        'data-part',
      ),
    ).toBe('panelEmpty');
  });

  it('keeps safe mode in the address a click goes to', async () => {
    const user = userEvent.setup({ delay: null });
    window.history.replaceState(null, '', '/home?safe=1');
    await boot('admin', [note(1, { type: 'task', title: 'Do it', read: true })], {
      browser: true,
      safe: true,
    });
    await ready();
    await user.click(bell());
    await user.click(await screen.findByText('Do it'));
    await waitFor(() => expect(window.location.pathname).toBe('/tasks'));
    expect(window.location.search).toBe('?safe=1');
  });
});

describe('what the live stream brings', () => {
  it('goes to the head of the list, adds to the count, and comes up as a toast', async () => {
    const s = await boot('admin', [note(1, { read: true })]);
    await ready();
    s.push(
      live({
        id: 2,
        member_key: 'admin',
        type: 'task',
        title: 'New task assigned',
        body: 'Quote the Hilux',
        url: '/dashboard#tasks',
        created_at: new Date().toISOString(),
      }),
    );
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
    expect(screen.getByRole('status').textContent).toBe('New task assigned · Quote the Hilux');
    expect(navBadge()?.textContent).toBe('1');
  });

  it('is not added twice if the list already holds it', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(2, { read: true })]);
    await ready();
    s.push(live({ id: 2, title: 'Title 2', created_at: new Date().toISOString(), read: true }));
    s.push(live({ id: 3, title: 'Title 3', created_at: new Date().toISOString() }));
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
    await user.click(bell());
    await waitFor(() => expect(titles(panelRows())).toEqual(['Title 3', 'Title 2']));
  });

  it('is ignored if it is not a notification, and a toast is not made of it', async () => {
    const s = await boot('admin', [note(1, { read: true })]);
    await ready();
    s.push('event: notification\ndata: not json\n\n');
    s.push('event: notification\ndata: {"id": 5}\n\n');
    s.push(live({ id: 9, title: 'Real', created_at: new Date().toISOString() }));
    await waitFor(() => expect(badge()?.textContent).toBe('1'));
    expect(screen.getAllByRole('status').map(t => t.textContent)).toEqual(['Real']);
  });
});

describe('the Notification Center', () => {
  it('lists everything, the unread marked, and reads one when it is clicked', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot(
      'admin',
      [
        note(3, {
          type: 'request',
          title: '📋 A request',
          body: 'Please look',
          url: '/dashboard#requests',
        }),
        note(2, { read: true }),
        note(1, { read: true }),
      ],
      { entries: ['/notifications'] },
    );
    expect(await screen.findByText('Notification Center')).toBeTruthy();
    expect(
      screen.getByText('Click any notification to navigate to the relevant page'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-part=centerItem]')).toHaveLength(3),
    );
    const first = document.querySelector('[data-part=centerItem]') as HTMLElement;
    expect(first.getAttribute('data-unread')).toBe('true');
    expect(first.querySelector('[data-part=marker]')).toBeTruthy();
    expect(within(first).getByText('A request')).toBeTruthy();
    expect(within(first).getByText('Please look')).toBeTruthy();
    expect(within(first).getByText('5m ago')).toBeTruthy();
    await user.click(first);
    expect(await screen.findByTitle('Requests (classic page)')).toBeTruthy();
    expect(s.sent()).toEqual([{ id: 3 }]);
  });

  it('reads everything from its button, once, and not at all when there is nothing unread', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('team', [note(2), note(1)], { entries: ['/notifications'] });
    expect(
      await screen.findByText('Click any notification to go to the relevant page'),
    ).toBeTruthy();
    await waitFor(() => expect(badge()?.textContent).toBe('2'));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(badge()).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(s.sent()).toEqual([{ all: true }]));
    expect(document.querySelectorAll('[data-part=marker]')).toHaveLength(0);
  });

  it('says there is nothing, and says when it cannot tell', async () => {
    await boot('admin', [], { entries: ['/notifications'] });
    expect((await screen.findByText('No notifications yet')).getAttribute('data-part')).toBe(
      'empty',
    );
    cleanup();
    const s = open('admin', adminMe(), {
      entries: ['/notifications'],
      more: { '/api/v1/notifications': () => json(404, { error: 'Not found', code: 'not_found' }) },
    });
    await waitFor(() => expect(s.calls('/api/v1/notifications').length).toBeGreaterThan(0));
    expect(await screen.findByText('Notifications are unavailable right now.')).toBeTruthy();
  });

  it('asks the server again when it is opened, even if the list was read a moment ago', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await boot('admin', [note(2, { read: true })], {
      lists: [[note(3, { title: 'Arrived meanwhile' }), note(2, { read: true })]],
    });
    await waitFor(() => expect(s.listed()).toBe(1));
    await user.click(document.querySelector('[data-screen=notifications]') as HTMLElement);
    expect(await screen.findByText('Arrived meanwhile')).toBeTruthy();
    expect(s.listed()).toBe(2);
  });

  it('is reached from the rail, in either portal, and answers for the screen it is', async () => {
    const user = userEvent.setup({ delay: null });
    await boot('team', [note(1, { read: true })]);
    await ready();
    await user.click(document.querySelector('[data-screen=notifications]') as HTMLElement);
    expect(await screen.findByText('Notification Center')).toBeTruthy();
    expect(document.querySelector('[data-part=title]')?.textContent).toBe('Notifications');
  });
});
