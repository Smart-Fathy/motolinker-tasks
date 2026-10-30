import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import type { Meeting } from '../meet';
import type { CalendarFeed, CalendarFollowup, CalendarTask } from './model';

// Wed 14 Oct 2026, noon: the month on show is October (Sun 27 Sep – Sat 31 Oct), the week is 11–17 Oct.
const NOW = new Date(2026, 9, 14, 12, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const at = (day: number, h: number, m = 0, month = 9) =>
  new Date(2026, month, day, h, m).toISOString();
const meeting = (id: number, over: Partial<Meeting> = {}): Meeting => ({
  id,
  title: `Meeting ${id}`,
  description: '',
  starts_at: at(14, 10),
  duration_min: 30,
  attendee_ids: ['61'],
  meet_link: '',
  created_by: 'admin',
  created_at: '2026-10-01T09:30:00.000Z',
  ...over,
});
const task = (id: number, over: Partial<CalendarTask> = {}): CalendarTask => ({
  id,
  title: `Task ${id}`,
  description: '',
  due_date: '2026-10-14',
  status: 'todo',
  priority: 'medium',
  milestone: '',
  assignee_ids: ['61'],
  channel_name: '',
  ...over,
});
const followup = (id: number, over: Partial<CalendarFollowup> = {}): CalendarFollowup => ({
  id,
  due_at: at(14, 16),
  note: 'Call back',
  customer_id: 7,
  customer_name: 'Monier Samaha',
  ...over,
});

interface World {
  feed: Pick<CalendarFeed, 'tasks' | 'meetings' | 'followups'>;
  /** the admin's Google link, as GET /api/calendar/status says */
  sync?: { configured: boolean; connected: boolean; email?: string };
  no?: { feed?: number };
}
const world = (over: Partial<World> = {}): World => ({
  feed: {
    meetings: [
      meeting(1, {
        title: 'Weekly sales sync',
        starts_at: at(14, 10, 30),
        duration_min: 45,
        attendee_ids: ['61', '62'],
        meet_link: 'https://meet.google.com/abc-defg-hij',
      }),
      meeting(2, {
        title: 'Procurement huddle',
        starts_at: at(15, 9),
        meet_link: 'huddle:3',
        description: 'Quotes\nfirst',
      }),
    ],
    followups: [followup(1)],
    tasks: [
      task(1, { title: 'Send the Avatr quote' }),
      task(2, { title: 'Late one', due_date: '2026-10-12' }),
      task(3, { title: 'Done one', due_date: '2026-10-13', status: 'done' }),
    ],
  },
  ...over,
});

function boot(
  portal: 'admin' | 'team',
  w: World,
  {
    me = portal === 'admin' ? adminMe() : teamMe(),
    slow = {},
  }: { me?: ReturnType<typeof adminMe>; slow?: Record<string, Promise<unknown>> } = {},
) {
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const more: Record<string, Answer> = {
    [`${portal === 'admin' ? '/api/dashboard/employees-for-tasks' : '/api/employee/coworkers'}`]:
      () =>
        json(200, [
          { id: 61, name: 'Ana' },
          { id: 62, name: 'Bo' },
        ]),
    [`${base}/chat/rooms`]: () => json(200, [{ id: 3, name: 'Sales' }]),
    '/api/calendar/status': () => json(200, w.sync ?? { configured: false, connected: false }),
    '/api/calendar/disconnect': () => {
      w.sync = { configured: true, connected: false };
      return json(200, { ok: true });
    },
    '/api/v1/meetings/1': init => {
      const body = JSON.parse(String(init.body)) as Partial<Meeting>;
      w.feed.meetings = w.feed.meetings.map(m => (m.id === 1 ? { ...m, ...body } : m));
      return json(
        200,
        w.feed.meetings.find(m => m.id === 1),
      );
    },
    '/api/v1/meetings': async () => json(201, meeting(9)),
  };
  // any window of days is asked for as its own address
  const feedPaths = [
    '2026-09-27&to=2026-10-31', // October as a month
    '2026-10-11&to=2026-10-17', // …and as a week
    '2026-11-01&to=2026-12-05', // November
    '2026-10-04&to=2026-10-10', // the week before
    '2026-10-18&to=2026-10-24', // the week after
  ];
  for (const p of feedPaths) {
    more[`/api/v1/calendar?from=${p}`] = async () => {
      await slow[p];
      return w.no?.feed
        ? json(w.no.feed, {
            error: 'The calendar is unavailable right now. Try again in a moment.',
            code: 'unavailable',
          })
        : json(200, { from: '', to: '', ...w.feed });
    };
  }
  return { ...open(portal, me, { entries: ['/calendar'], more }), world: w };
}

const days = () => [...document.querySelectorAll<HTMLElement>('[data-part=day]')];
const dayOf = (key: string) =>
  document.querySelector<HTMLElement>(`[data-part=day][data-day="${key}"]`)!;
const chipsIn = (el: Element) => [...el.querySelectorAll<HTMLElement>('[data-part=chip]')];
const grid = () => document.querySelector<HTMLElement>('[data-part=grid]')!;
/** The "Close" button along the foot of a sheet (its head has a × that is named Close too). */
const closeOf = (sheet: HTMLElement) =>
  sheet.querySelector<HTMLElement>('[data-part=foot] [data-part=close]')!;

describe.each(['admin', 'team'] as const)('the Calendar, in the %s portal', portal => {
  it('says what it holds, and links to Google Calendar', async () => {
    boot(portal, world());
    await waitFor(() => expect(days().length).toBeGreaterThan(0));
    expect(document.querySelector('[data-part=heading]')!.textContent).toBe('Calendar');
    expect(document.querySelector('[data-part=sub]')!.textContent).toBe(
      portal === 'admin'
        ? "Meetings, task due dates and lead follow-ups from MotoLinker. Scheduled meetings also land on everyone's Google Calendar."
        : 'Your meetings, the tasks you owe and the leads you promised to call.',
    );
    const google = screen.getByRole('link', { name: /Google Calendar/ });
    expect(google.getAttribute('href')).toBe('https://calendar.google.com/calendar/r/week');
    expect([google.getAttribute('target'), google.getAttribute('rel')]).toEqual([
      '_blank',
      'noopener',
    ]);
  });

  it('shows October as the whole weeks it touches, today marked and the neighbours dimmed', async () => {
    const view = boot(portal, world());
    await waitFor(() => expect(days()).toHaveLength(35));
    expect(document.querySelector('[data-part=barTitle]')!.textContent).toBe(
      NOW.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    );
    expect([...document.querySelectorAll('[data-part=dow]')].map(d => d.textContent)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
    expect(days()[0]!.getAttribute('data-day')).toBe('2026-09-27');
    expect(days()[34]!.getAttribute('data-day')).toBe('2026-10-31');
    expect(dayOf('2026-10-14').className).toMatch(/today/);
    expect(dayOf('2026-10-13').className).not.toMatch(/today/);
    expect(dayOf('2026-09-30').className).toMatch(/other/);
    expect(dayOf('2026-10-01').className).not.toMatch(/other/);
    expect(view.calls('/api/v1/calendar?from=2026-09-27&to=2026-10-31')).toHaveLength(1);
  });

  it('puts each thing on its day, in the order it happens: meetings and follow-ups by their time, tasks at the end', async () => {
    boot(portal, world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    const kinds = chipsIn(dayOf('2026-10-14')).map(c => [
      c.getAttribute('data-kind'),
      c.textContent,
    ]);
    expect(kinds[0]![0]).toBe('meeting');
    expect(kinds[0]![1]).toMatch(/Weekly sales sync$/);
    expect(kinds[1]![0]).toBe('followup');
    expect(kinds[1]![1]).toMatch(/Monier Samaha$/);
    expect(kinds[2]).toEqual(['task', 'Send the Avatr quote']);
    expect(chipsIn(dayOf('2026-10-14'))[0]!.textContent).toContain(
      new Date(at(14, 10, 30)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
    expect(chipsIn(dayOf('2026-10-14'))[0]!.getAttribute('title')).toBe('Weekly sales sync');
    expect(chipsIn(dayOf('2026-10-14'))[1]!.getAttribute('title')).toBe('Call back');
  });

  it("marks a task that is late, and one that is done; a meeting in a huddle draws the huddle's glyph", async () => {
    boot(portal, world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-12')).length).toBe(1));
    expect(chipsIn(dayOf('2026-10-12'))[0]!.className).toMatch(/overdue/);
    expect(chipsIn(dayOf('2026-10-13'))[0]!.className).toMatch(/done/);
    expect(chipsIn(dayOf('2026-10-13'))[0]!.className).not.toMatch(/overdue/);
    expect(chipsIn(dayOf('2026-10-14'))[2]!.className).not.toMatch(/overdue|done/);
    expect(chipsIn(dayOf('2026-10-15'))[0]!.querySelector('svg')!.getAttribute('class')).toMatch(
      /lucide-radio/,
    );
    expect(chipsIn(dayOf('2026-10-14'))[0]!.querySelector('svg')!.getAttribute('class')).toMatch(
      /lucide-video/,
    );
  });

  it('counts what is on show, in the legend', async () => {
    boot(portal, world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    const keys = [...document.querySelectorAll('[data-part=key]')].map(k => k.textContent);
    expect(keys).toEqual(['2 meetings', '3 tasks', '1 follow-up']);
  });

  it('steps a month on and back, asking for the window it moves to; Today comes home', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot(portal, world());
    await waitFor(() => expect(days()).toHaveLength(35));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(view.calls('/api/v1/calendar?from=2026-11-01&to=2026-12-05')).toHaveLength(1),
    );
    expect(document.querySelector('[data-part=barTitle]')!.textContent).toBe(
      new Date(2026, 10, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    );
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(document.querySelector('[data-part=barTitle]')!.textContent).toBe(
      NOW.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    );
    await waitFor(() => expect(days()[0]!.getAttribute('data-day')).toBe('2026-09-27'));
  });

  it('switches to a week, which shows everything on a day, and steps by weeks', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot(portal, world());
    await waitFor(() => expect(days()).toHaveLength(35));
    await user.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(days()).toHaveLength(7));
    expect(view.calls('/api/v1/calendar?from=2026-10-11&to=2026-10-17')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(grid().getAttribute('data-view')).toBe('week');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(view.calls('/api/v1/calendar?from=2026-10-18&to=2026-10-24')).toHaveLength(1),
    );
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() =>
      expect(view.calls('/api/v1/calendar?from=2026-10-04&to=2026-10-10')).toHaveLength(1),
    );
  });

  it('shows the first three things on a day in a month, and "+N more" opens the whole day', async () => {
    const user = userEvent.setup({ delay: null });
    const w = world();
    w.feed.tasks.push(task(4, { title: 'Fourth' }), task(5, { title: 'Fifth' }));
    boot(portal, w);
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    const more = within(dayOf('2026-10-14')).getByRole('button', { name: '+2 more' });
    await user.click(more);
    const sheet = await screen.findByRole('dialog');
    expect(
      within(sheet).getByText(
        new Date(2026, 9, 14, 12).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }),
      ),
    ).toBeTruthy();
    expect(chipsIn(sheet)).toHaveLength(5);
    expect(within(sheet).getByRole('button', { name: 'Schedule something' })).toBeTruthy();
    await user.click(closeOf(sheet));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows all of them in a week', async () => {
    const user = userEvent.setup({ delay: null });
    const w = world();
    w.feed.tasks.push(task(4, { title: 'Fourth' }), task(5, { title: 'Fifth' }));
    boot(portal, w);
    await waitFor(() => expect(days()).toHaveLength(35));
    await user.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(days()).toHaveLength(7));
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(5));
    expect(document.querySelector('[data-part=more]')).toBeNull();
  });

  it('opens a meeting with when, how long and how many, the notes, and where to join it', async () => {
    const user = userEvent.setup({ delay: null });
    boot(portal, world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    await user.click(chipsIn(dayOf('2026-10-14'))[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'Weekly sales sync' });
    const when = new Date(at(14, 10, 30)).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(within(sheet).getByText(when)).toBeTruthy();
    expect(sheet.textContent).toContain('45 min · 2 attendee(s)');
    expect(within(sheet).getByRole('link', { name: 'Join' }).getAttribute('href')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toBeTruthy();
    await user.click(closeOf(sheet));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(chipsIn(dayOf('2026-10-15'))[0]!);
    const huddle = await screen.findByRole('dialog', { name: 'Procurement huddle' });
    expect(huddle.textContent).toContain('Quotes\nfirst');
    expect(
      within(huddle).getByText(
        'Joins the in-app huddle — audio in MotoLinker, no Google account needed.',
      ),
    ).toBeTruthy();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.click(within(huddle).getByRole('button', { name: /Join huddle/ }));
    expect(opened).toHaveBeenCalledWith(
      portal === 'admin' ? '/legacy/dashboard?chat=3' : '/legacy/employee?chat=3',
      '_blank',
      'noopener',
    );
    // (the sheet goes behind it)
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a task or a follow-up goes to where it is kept: Tasks, or Leads', async () => {
    const user = userEvent.setup({ delay: null });
    boot(portal, world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    await user.click(chipsIn(dayOf('2026-10-14'))[2]!);
    await waitFor(() => expect(document.querySelector('[data-part=calendarPage]')).toBeNull());
    expect(document.querySelector('[data-part=legacyFrame]')).toBeTruthy();
  });

  it('says why when the calendar cannot be had, and draws no days with things on them', async () => {
    boot(portal, world({ no: { feed: 400 } }));
    expect(
      await screen.findByText('The calendar is unavailable right now. Try again in a moment.'),
    ).toBeTruthy();
    expect(days()).toHaveLength(35);
    expect(document.querySelectorAll('[data-part=chip]')).toHaveLength(0);
  });

  it('keeps what the last window held on show for the days it shares with the next, while the next is on its way', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<void>();
    boot(portal, world(), { slow: { '2026-10-11&to=2026-10-17': wait.promise } });
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(days()).toHaveLength(7);
    expect(chipsIn(dayOf('2026-10-14'))).toHaveLength(3);
    wait.resolve();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(chipsIn(dayOf('2026-10-14'))).toHaveLength(3);
  });

  it('shows the loader while a window is on its way, and the days of the last one stay on show until it comes', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<void>();
    boot(portal, world(), { slow: { '2026-11-01&to=2026-12-05': wait.promise } });
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    expect(screen.queryByText('Loading…')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Loading…')).toBeTruthy();
    wait.resolve();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  });
});

describe('where a task and a follow-up go', () => {
  const active = () =>
    document.querySelector('[data-part=itemActive]')?.getAttribute('data-screen');

  it('a task goes to Tasks, and a follow-up to Leads, where they are kept', async () => {
    const user = userEvent.setup({ delay: null });
    boot('admin', world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    const kind = (k: string) =>
      chipsIn(dayOf('2026-10-14')).find(c => c.getAttribute('data-kind') === k)!;
    await user.click(kind('followup'));
    await waitFor(() => expect(active()).toBe('leads'));
    cleanup();
    boot('admin', world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    await user.click(kind('task'));
    await waitFor(() => expect(active()).toBe('tasks'));
  });
});

describe('who may do what on the calendar', () => {
  it('whoever may schedule can add an event — by the button or a double-click on a day — and edit a meeting', async () => {
    const user = userEvent.setup({ delay: null });
    boot('team', world());
    await waitFor(() => expect(days()).toHaveLength(35));
    await user.click(screen.getByRole('button', { name: /New event/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Schedule a meeting' });
    expect((within(sheet).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-14');
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.dblClick(dayOf('2026-10-22'));
    const seeded = await screen.findByRole('dialog', { name: 'Schedule a meeting' });
    expect((within(seeded).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-22');
    expect((within(seeded).getByLabelText('Time') as HTMLInputElement).value).toBe('10:00');
  });

  it('Edit opens the meeting itself — as it stands — in the sheet, and saving it refreshes the calendar', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot('team', world());
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    await user.click(chipsIn(dayOf('2026-10-14'))[0]!);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit meeting' });
    expect((within(sheet).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Weekly sales sync',
    );
    expect(within(sheet).getByLabelText('Duration').textContent).toBe('45 min');
    await user.clear(within(sheet).getByLabelText('Title'));
    await user.type(within(sheet).getByLabelText('Title'), 'Moved sync');
    await user.click(within(sheet).getByRole('button', { name: 'Save & re-sync calendars' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(view.calls('/api/v1/calendar?from=2026-09-27&to=2026-10-31').length).toBeGreaterThan(
        1,
      ),
    );
    await waitFor(() =>
      expect(chipsIn(dayOf('2026-10-14'))[0]!.textContent).toMatch(/Moved sync$/),
    );
  });

  it('one who may only see meetings gets no New event, no Edit and no "Schedule something"', async () => {
    const user = userEvent.setup({ delay: null });
    const me = teamMe({ meet: true, meetActions: { view: true, schedule: false } });
    const w = world();
    w.feed.tasks.push(task(4), task(5));
    boot('team', w, { me });
    await waitFor(() => expect(chipsIn(dayOf('2026-10-14')).length).toBe(3));
    expect(screen.queryByRole('button', { name: /New event/ })).toBeNull();
    await user.dblClick(dayOf('2026-10-22'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(chipsIn(dayOf('2026-10-14'))[0]!);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(sheet).getByRole('link', { name: 'Join' })).toBeTruthy();
    await user.click(closeOf(sheet));
    await user.click(within(dayOf('2026-10-14')).getByRole('button', { name: /more/ }));
    const day = await screen.findByRole('dialog');
    expect(within(day).queryByRole('button', { name: 'Schedule something' })).toBeNull();
  });
});

describe("the admin's Google Calendar link", () => {
  it('says so when Google is not set up, and offers nothing to press', async () => {
    boot('admin', world({ sync: { configured: false, connected: false } }));
    expect(await screen.findByText('Google not configured')).toBeTruthy();
    expect(document.querySelector('[data-part=syncToggle]')).toBeNull();
  });

  it('says when new tasks are being added to a calendar, and whose; Disconnect asks first', async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const w = world({ sync: { configured: true, connected: true, email: 'boss@example.com' } });
    const view = boot('admin', w);
    expect(await screen.findByText('Task sync on · boss@example.com')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(confirm).toHaveBeenCalledWith(
      'Stop adding new tasks to Google Calendar? Existing events stay put.',
    );
    expect(view.calls('/api/calendar/disconnect')).toHaveLength(0);
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Task sync off')).toBeTruthy();
    expect(view.calls('/api/calendar/disconnect')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Connect for task sync' })).toBeTruthy();
  });

  it('Connect leaves for Google, with the session carried in the address', async () => {
    const user = userEvent.setup({ delay: null });
    localStorage.setItem('ml_admin_token', 'tok-admin');
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    boot('admin', world({ sync: { configured: true, connected: false } }));
    await user.click(await screen.findByRole('button', { name: 'Connect for task sync' }));
    expect(assign).toHaveBeenCalledWith('/api/calendar/connect?_t=tok-admin');
  });

  it("is the admin's alone: the team portal never asks", async () => {
    const view = boot('team', world());
    await waitFor(() => expect(days()).toHaveLength(35));
    expect(view.calls('/api/calendar/status')).toHaveLength(0);
    expect(document.querySelector('[data-part=syncStatus]')).toBeNull();
  });
});
