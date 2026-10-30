import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import { SAID, summaryOf, whenOf, type Meeting } from './model';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const meeting = (id: number, over: Partial<Meeting> = {}): Meeting => ({
  id,
  title: `Meeting ${id}`,
  description: '',
  starts_at: new Date(2026, 9, 14 + id, 10, 30).toISOString(),
  duration_min: 30,
  attendee_ids: [],
  meet_link: '',
  created_by: 'admin',
  created_at: '2026-10-01T09:30:00.000Z',
  ...over,
});

const SYNC = meeting(1, {
  title: 'Weekly sales sync',
  duration_min: 45,
  attendee_ids: ['61', '62'],
  meet_link: 'https://meet.google.com/abc-defg-hij',
});
const HUDDLE = meeting(2, { title: 'Procurement huddle', meet_link: 'huddle:3' });
const BARE = meeting(3, { title: 'Bare domain', meet_link: 'zoom.example/j/1' });
const NOLINK = meeting(4, { title: 'No link yet', meet_link: '' });
const SCRIPT = meeting(5, { title: 'Sneaky', meet_link: 'javascript:alert(1)' });

interface World {
  meetings: Meeting[];
  people: unknown[];
  rooms: unknown[];
  /** what the server says to each kind of call, if it says no */
  no?: { list?: number; save?: number; del?: number; people?: number; rooms?: number };
}

const PEOPLE = [
  { id: 61, name: 'Ana' },
  { id: 62, name: 'Bo' },
  { id: 64, name: 'Dee' },
];
const ROOMS = [
  { id: 3, name: 'Sales' },
  { id: 4, name: '' },
];
const world = (over: Partial<World> = {}): World => ({
  meetings: [SYNC, HUDDLE, BARE, NOLINK, SCRIPT],
  people: PEOPLE,
  rooms: ROOMS,
  ...over,
});

/** A signed-in session against a server that keeps meetings. */
function boot(
  portal: 'admin' | 'team',
  w: World,
  {
    me = portal === 'admin' ? adminMe() : teamMe(),
    list,
  }: { me?: ReturnType<typeof adminMe>; list?: Promise<unknown> } = {},
) {
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const say = (status: number, error: string) => json(status, { error, code: 'x' });
  const more: Record<string, Answer> = {
    '/api/v1/meetings': async init => {
      if (init.method === 'POST') {
        if (w.no?.save) return say(w.no.save, 'Give the meeting a title (up to 200 characters).');
        const body = JSON.parse(String(init.body)) as Partial<Meeting>;
        const made = meeting(Math.max(0, ...w.meetings.map(m => m.id)) + 1, {
          ...body,
          created_by: 'admin',
        });
        w.meetings = [...w.meetings, made];
        return json(201, made);
      }
      if (list) await list;
      return w.no?.list
        ? say(w.no.list, 'Meetings are unavailable right now.')
        : json(200, { items: w.meetings });
    },
    [portal === 'admin' ? '/api/dashboard/employees-for-tasks' : '/api/employee/coworkers']: () =>
      w.no?.people ? say(w.no.people, 'no') : json(200, w.people),
    [`${base}/chat/rooms`]: () => (w.no?.rooms ? say(w.no.rooms, 'no') : json(200, w.rooms)),
  };
  for (const id of [1, 2, 3, 4, 5, 6]) {
    more[`/api/v1/meetings/${id}`] = init => {
      if (init.method === 'DELETE') {
        if (w.no?.del) return say(w.no.del, 'Meetings are unavailable right now.');
        w.meetings = w.meetings.filter(m => m.id !== id);
        return json(200, { ok: true });
      }
      if (w.no?.save) return say(w.no.save, 'Give the meeting a start time.');
      const body = JSON.parse(String(init.body)) as Partial<Meeting>;
      const at = w.meetings.findIndex(m => m.id === id);
      w.meetings[at] = { ...w.meetings[at]!, ...body };
      return json(200, w.meetings[at]);
    };
  }
  const view = open(portal, me, { entries: ['/meet'], more });
  return { ...view, world: w };
}

const pageTitle = () => document.querySelector('[data-part=heading]');
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-part=meeting]')];
const bodyOf = (call: { init: RequestInit }) =>
  JSON.parse(String(call.init.body)) as Record<string, unknown>;

describe.each(['admin', 'team'] as const)('the Meet page, in the %s portal', portal => {
  it('says what it is for, and offers a new meeting and a way into one that exists', async () => {
    boot(portal, world());
    await waitFor(() => expect(pageTitle()).toBeTruthy());
    expect(pageTitle()!.textContent).toBe('Google Meet');
    expect(screen.getByText('Start or join a video meeting instantly.')).toBeTruthy();
    const start = screen.getByRole('link', { name: /Start Meeting/ });
    expect(start.getAttribute('href')).toBe('https://meet.google.com/new');
    expect(start.getAttribute('target')).toBe('_blank');
    expect(start.getAttribute('rel')).toBe('noopener');
    expect(screen.getByText('New Meeting')).toBeTruthy();
    expect(screen.getByText('Join a Meeting')).toBeTruthy();
    expect(screen.getByPlaceholderText('abc-defg-hij')).toBeTruthy();
  });

  it('joins a meeting by its code — spaces taken out — on Join and on Enter, and does nothing with no code', async () => {
    const user = userEvent.setup({ delay: null });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    boot(portal, world());
    const code = await screen.findByPlaceholderText('abc-defg-hij');
    const join = within(code.parentElement!).getByRole('button', { name: 'Join' });
    await user.click(join);
    expect(opened).not.toHaveBeenCalled();
    await user.type(code, ' abc defg hij ');
    await user.click(join);
    expect(opened).toHaveBeenLastCalledWith(
      'https://meet.google.com/abcdefghij',
      '_blank',
      'noopener',
    );
    await user.clear(code);
    await user.type(code, 'xyz-abcd-efg{Enter}');
    expect(opened).toHaveBeenLastCalledWith(
      'https://meet.google.com/xyz-abcd-efg',
      '_blank',
      'noopener',
    );
  });

  it('lists the upcoming meetings, each with its day, its title, and when, how long and how many', async () => {
    boot(portal, world());
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.getByText('Upcoming meetings')).toBeTruthy();
    const first = rows()[0]!;
    const when = whenOf(SYNC.starts_at);
    expect(within(first).getByText('Weekly sales sync')).toBeTruthy();
    expect(first.querySelector('[data-part=weekday]')!.textContent).toBe(when.weekday);
    expect(first.querySelector('[data-part=date]')!.textContent).toBe(String(when.day));
    expect(first.querySelector('[data-part=meta]')!.textContent).toBe(summaryOf(SYNC));
    expect(first.querySelector('[data-part=meta]')!.textContent).toMatch(
      / · 45 min · 2 attendee\(s\)$/,
    );
  });

  it('joins a meeting where it is held: its link, a bare domain made one, a huddle in the classic portal — and nothing where there is nothing to join', async () => {
    boot(portal, world());
    await waitFor(() => expect(rows()).toHaveLength(5));
    const join = (i: number) => rows()[i]!.querySelector<HTMLAnchorElement>('[data-part=join]');
    expect(join(0)!.getAttribute('href')).toBe('https://meet.google.com/abc-defg-hij');
    expect(join(0)!.textContent).toBe('Join');
    expect([join(0)!.getAttribute('target'), join(0)!.getAttribute('rel')]).toEqual([
      '_blank',
      'noopener',
    ]);
    expect(join(1)!.textContent).toMatch(/Join huddle/);
    expect(join(1)!.getAttribute('href')).toBe(
      portal === 'admin' ? '/legacy/dashboard?chat=3' : '/legacy/employee?chat=3',
    );
    expect(join(2)!.getAttribute('href')).toBe('https://zoom.example/j/1');
    expect(join(3)).toBeNull();
    expect(join(4)).toBeNull();
  });

  it('says so when nothing is scheduled', async () => {
    boot(portal, world({ meetings: [] }));
    expect(
      await screen.findByText(/Nothing scheduled\. A scheduled meeting lands on every attendee/),
    ).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it('shows the loader while the meetings are on their way', async () => {
    const wait = deferred<void>();
    boot(portal, world(), { list: wait.promise });
    expect(await screen.findByText('Loading meetings…')).toBeTruthy();
    expect(screen.queryByText('Upcoming meetings')).toBeNull();
    wait.resolve();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.queryByText('Loading meetings…')).toBeNull();
  });

  it('says why when the meetings cannot be had — rather than saying that nothing is scheduled', async () => {
    boot(portal, world({ no: { list: 403 } }));
    expect(await screen.findByText('Meetings are unavailable right now.')).toBeTruthy();
    expect(screen.queryByText(/Nothing scheduled/)).toBeNull();
    expect(document.querySelector('[data-part=error]')).toBeTruthy();
  });
});

describe('who may do what with the meetings', () => {
  it('a team member who may schedule gets the button, Edit and Cancel on every meeting', async () => {
    boot('team', world(), { me: teamMe() });
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.getByRole('button', { name: /Schedule a meeting/ })).toBeTruthy();
    for (const r of rows()) {
      expect(within(r).getByRole('button', { name: 'Edit' })).toBeTruthy();
      expect(within(r).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    }
  });

  it('one who may only see them sees the list, and can join, but cannot schedule, change or cancel', async () => {
    boot('team', world(), {
      me: teamMe({ meet: true, meetActions: { view: true, schedule: false } }),
    });
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.getByText('Upcoming meetings')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Schedule a meeting/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(rows()[0]!.querySelector('[data-part=join]')).toBeTruthy();
  });

  it('one who may not see them gets the cards and no list — and the server is not asked for one', async () => {
    const view = boot('team', world(), {
      me: teamMe({ meet: true, meetActions: { view: false, schedule: false } }),
    });
    await waitFor(() => expect(pageTitle()).toBeTruthy());
    expect(screen.queryByText('Upcoming meetings')).toBeNull();
    expect(screen.queryByText('Loading meetings…')).toBeNull();
    expect(view.calls('/api/v1/meetings')).toHaveLength(0);
  });

  it('the admin may do all of it', async () => {
    boot('admin', world());
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.getByRole('button', { name: /Schedule a meeting/ })).toBeTruthy();
    expect(within(rows()[0]!).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});

describe('scheduling a meeting', () => {
  it.each(['admin', 'team'] as const)(
    'opens a sheet that asks for the people and the rooms as it opens (%s)',
    async portal => {
      const user = userEvent.setup({ delay: null });
      const view = boot(portal, world());
      await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
      const sheet = await screen.findByRole('dialog', { name: 'Schedule a meeting' });
      const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
      expect(
        view.calls(
          portal === 'admin' ? '/api/dashboard/employees-for-tasks' : '/api/employee/coworkers',
        ),
      ).toHaveLength(1);
      expect(view.calls(`${base}/chat/rooms`)).toHaveLength(1);
      for (const name of ['Ana', 'Bo', 'Dee'])
        expect(within(sheet).getByRole('checkbox', { name })).toBeTruthy();
      expect((within(sheet).getByLabelText('Title') as HTMLInputElement).value).toBe('');
      expect((within(sheet).getByLabelText('Duration') as HTMLSelectElement).value).toBe('30');
      expect((within(sheet).getByLabelText('Where') as HTMLSelectElement).value).toBe('meet');
      expect(within(sheet).getByRole('button', { name: 'Schedule' })).toBeTruthy();
    },
  );

  it('sends what was filled in, closes, says so, and shows the new meeting in the list', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot('team', world());
    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Title'), '  Quarterly review ');
    await user.clear(within(sheet).getByLabelText('Date'));
    await user.type(within(sheet).getByLabelText('Date'), '2026-12-01');
    await user.clear(within(sheet).getByLabelText('Time'));
    await user.type(within(sheet).getByLabelText('Time'), '14:15');
    await user.selectOptions(within(sheet).getByLabelText('Duration'), '90');
    await user.click(within(sheet).getByRole('checkbox', { name: 'Ana' }));
    await user.click(within(sheet).getByRole('checkbox', { name: 'Dee' }));
    await user.type(within(sheet).getByLabelText('Notes'), 'Numbers first');
    await user.click(within(sheet).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = view.calls('/api/v1/meetings').find(c => c.init.method === 'POST')!;
    expect(bodyOf(post)).toEqual({
      title: 'Quarterly review',
      starts_at: new Date(2026, 11, 1, 14, 15).toISOString(),
      duration_min: 90,
      attendee_ids: ['61', '64'],
      meet_link: '',
      description: 'Numbers first',
    });
    expect(await screen.findByText(SAID.scheduled)).toBeTruthy();
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(screen.getByText('Quarterly review')).toBeTruthy();
  });

  it("says what is wrong with a meeting before it sends it, in the classic sheet's words, and stays open", async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot('team', world());
    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Schedule' }));
    expect(within(sheet).getByText('Title is required.')).toBeTruthy();
    await user.type(within(sheet).getByLabelText('Title'), 'Standup');
    await user.clear(within(sheet).getByLabelText('Date'));
    await user.click(within(sheet).getByRole('button', { name: 'Schedule' }));
    expect(within(sheet).getByText('Pick a date and time.')).toBeTruthy();
    expect(view.calls('/api/v1/meetings').filter(c => c.init.method === 'POST')).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it("shows the server's words in the sheet when it would not take the meeting, and keeps what was typed", async () => {
    const user = userEvent.setup({ delay: null });
    const w = world({ no: { save: 400 } });
    boot('team', w);
    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Title'), 'Standup');
    await user.click(within(sheet).getByRole('button', { name: 'Schedule' }));
    expect(
      await within(sheet).findByText('Give the meeting a title (up to 200 characters).'),
    ).toBeTruthy();
    expect((within(sheet).getByLabelText('Title') as HTMLInputElement).value).toBe('Standup');
    expect(screen.queryByText(SAID.scheduled)).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Schedule' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('holds it in an in-app huddle (the room it is held in), or at a link of its own', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot('team', world());
    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Title'), 'Huddle time');
    await user.selectOptions(within(sheet).getByLabelText('Where'), 'huddle');
    const room = within(sheet).getByLabelText('Huddle in') as HTMLSelectElement;
    expect([...room.options].map(o => o.textContent)).toEqual(['Sales', 'Conversation']);
    await user.selectOptions(room, '4');
    await user.click(within(sheet).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posts = view.calls('/api/v1/meetings').filter(c => c.init.method === 'POST');
    expect(bodyOf(posts[0]!)['meet_link']).toBe('huddle:4');

    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const second = await screen.findByRole('dialog');
    await user.type(within(second).getByLabelText('Title'), 'Zoom call');
    await user.selectOptions(within(second).getByLabelText('Where'), 'link');
    expect(within(second).queryByLabelText('Huddle in')).toBeNull();
    await user.type(within(second).getByLabelText('Link'), ' https://zoom.example/j/9 ');
    await user.click(within(second).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const later = view.calls('/api/v1/meetings').filter(c => c.init.method === 'POST');
    expect(bodyOf(later[1]!)['meet_link']).toBe('https://zoom.example/j/9');
  });

  it('cannot hold it in a huddle when there are no chat rooms, and says so; and offers nobody when nobody could be found', async () => {
    const user = userEvent.setup({ delay: null });
    boot('team', world({ rooms: [], people: [] }));
    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const sheet = await screen.findByRole('dialog');
    const huddle = within(sheet).getByRole('option', {
      name: 'In-app huddle (no chat rooms yet)',
    }) as HTMLOptionElement;
    expect(huddle.disabled).toBe(true);
    expect(within(sheet).getByText('No team members found')).toBeTruthy();
  });

  it('opens all the same when the people or the rooms cannot be had (a team member without the chat permission cannot list rooms)', async () => {
    const user = userEvent.setup({ delay: null });
    boot('team', world({ no: { people: 500, rooms: 403 } }));
    await user.click(await screen.findByRole('button', { name: /Schedule a meeting/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('No team members found')).toBeTruthy();
    expect(
      within(sheet).getByRole('option', { name: 'In-app huddle (no chat rooms yet)' }),
    ).toBeTruthy();
  });
});

describe('changing and cancelling a meeting', () => {
  it('Edit opens the meeting as it stands, saves it with a PUT, and says calendars re-sync', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot('team', world());
    await waitFor(() => expect(rows()).toHaveLength(5));
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit meeting' });
    expect((within(sheet).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Weekly sales sync',
    );
    expect((within(sheet).getByLabelText('Duration') as HTMLSelectElement).value).toBe('45');
    expect((within(sheet).getByLabelText('Where') as HTMLSelectElement).value).toBe('link');
    expect((within(sheet).getByLabelText('Link') as HTMLInputElement).value).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect((within(sheet).getByRole('checkbox', { name: 'Ana' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((within(sheet).getByRole('checkbox', { name: 'Dee' }) as HTMLInputElement).checked).toBe(
      false,
    );
    await user.clear(within(sheet).getByLabelText('Title'));
    await user.type(within(sheet).getByLabelText('Title'), 'Renamed');
    await user.click(within(sheet).getByRole('button', { name: 'Save & re-sync calendars' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const put = view.calls('/api/v1/meetings/1').find(c => c.init.method === 'PUT')!;
    expect(bodyOf(put)['title']).toBe('Renamed');
    expect(bodyOf(put)['attendee_ids']).toEqual(['61', '62']);
    expect(await screen.findByText(SAID.updated)).toBeTruthy();
    await waitFor(() => expect(within(rows()[0]!).getByText('Renamed')).toBeTruthy());
  });

  it('opens a meeting in a huddle with its room chosen and no link', async () => {
    const user = userEvent.setup({ delay: null });
    boot('team', world());
    await waitFor(() => expect(rows()).toHaveLength(5));
    await user.click(within(rows()[1]!).getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog');
    expect((within(sheet).getByLabelText('Where') as HTMLSelectElement).value).toBe('huddle');
    expect((within(sheet).getByLabelText('Huddle in') as HTMLSelectElement).value).toBe('3');
  });

  it('keeps the length of a meeting that is not one the sheet offers, rather than quietly making it fifteen minutes', async () => {
    const user = userEvent.setup({ delay: null });
    const view = boot('team', world({ meetings: [meeting(1, { duration_min: 25 })] }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog');
    const length = within(sheet).getByLabelText('Duration') as HTMLSelectElement;
    expect(length.value).toBe('25');
    expect([...length.options].map(o => o.value)).toEqual([
      '15',
      '25',
      '30',
      '45',
      '60',
      '90',
      '120',
    ]);
    await user.click(within(sheet).getByRole('button', { name: 'Save & re-sync calendars' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      bodyOf(view.calls('/api/v1/meetings/1').find(c => c.init.method === 'PUT')!)['duration_min'],
    ).toBe(25);
  });

  it('Cancel asks first; "no" leaves the meeting, "yes" cancels it and the list is asked for again', async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const view = boot('team', world());
    await waitFor(() => expect(rows()).toHaveLength(5));
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledWith(SAID.confirmCancel);
    expect(view.calls('/api/v1/meetings/1')).toHaveLength(0);
    expect(rows()).toHaveLength(5);
    confirm.mockReturnValue(true);
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(view.calls('/api/v1/meetings/1').some(c => c.init.method === 'DELETE')).toBe(true);
    expect(screen.queryByText('Weekly sales sync')).toBeNull();
  });

  it('tells the person when a meeting could not be cancelled (the classic page said nothing), and keeps it', async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    boot('team', world({ no: { del: 503 } }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Meetings are unavailable right now.')).toBeTruthy();
    expect(rows()).toHaveLength(5);
  });
});
