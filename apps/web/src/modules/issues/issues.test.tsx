import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import { SAID, whenOf, type Issue, type IssueComment } from './model';

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

const ticket = (id: number, over: Partial<Issue> = {}): Issue => ({
  id,
  title: `Ticket ${id}`,
  description: `Details of ${id}`,
  file_url: '',
  reporter_id: 9,
  reporter_name: 'Sara Ali',
  status: 'open',
  created_at: '2026-10-01T09:30:00.000Z',
  resolved_at: null,
  resolved_by: '',
  ...over,
});
const reply = (id: number, over: Partial<IssueComment> = {}): IssueComment => ({
  id,
  issue_id: 4,
  author_key: 'employee_9',
  author_name: 'Sara Ali',
  body: `Reply ${id}`,
  file_url: '',
  file_name: '',
  file_size: null,
  file_type: '',
  created_at: '2026-10-01T10:00:00.000Z',
  ...over,
});

const WAITING = ticket(4, { title: 'Cannot log hours', reporter_name: 'Sara Ali' });
const CLOSED = ticket(5, {
  title: 'Printer jammed',
  reporter_name: 'Omar Hassan',
  status: 'resolved',
  resolved_by: 'Admin',
  resolved_at: '2026-10-02T08:00:00.000Z',
});
const NAMELESS = ticket(6, { title: '', reporter_name: '', description: '' });

/** The CTO by title: reads the centre and manages it, whatever they were granted. */
const CTO = () => teamMe({}, 'Chief Technical Officer');
/** Somebody who may read the centre but not manage it. */
const READER = () => teamMe({ issues: true, issuesActions: { view: true } });

interface World {
  issues: Issue[];
  threads: Record<number, IssueComment[]>;
  /** what the server says to each kind of call, if it says no */
  no?: { list?: number; thread?: number; post?: number; patch?: number };
}

/** A signed-in session against a server that keeps tickets and their replies. */
function boot(
  portal: 'admin' | 'team',
  world: World,
  {
    me = portal === 'admin' ? adminMe() : CTO(),
    list,
  }: { me?: ReturnType<typeof adminMe>; list?: Promise<unknown> } = {},
) {
  const w = world;
  const say = (status: number, error: string) => json(status, { error, code: 'x' });
  const more: Record<string, Answer> = {
    '/api/v1/issues': async () => {
      if (list) await list;
      return w.no?.list ? say(w.no.list, 'Not permitted') : json(200, { items: w.issues });
    },
  };
  for (const id of [4, 5, 6, 7]) {
    more[`/api/v1/issues/${id}`] = init => {
      if (w.no?.patch) return say(w.no.patch, 'Not permitted');
      const body = JSON.parse(String(init.body)) as { status: Issue['status'] };
      const at = w.issues.findIndex(i => i.id === id);
      const done = body.status === 'resolved';
      w.issues[at] = {
        ...w.issues[at]!,
        status: body.status,
        resolved_by: done ? 'Cleo' : '',
        resolved_at: done ? '2026-10-03T08:00:00.000Z' : null,
      };
      return json(200, w.issues[at]);
    };
    more[`/api/v1/issues/${id}/comments`] = init => {
      if (init.method === 'POST') {
        if (w.no?.post) return say(w.no.post, 'Write a reply, or attach a file.');
        const body = JSON.parse(String(init.body)) as { body: string };
        const made = reply(100 + (w.threads[id]?.length ?? 0), {
          issue_id: id,
          author_name: 'Cleo',
          body: body.body,
        });
        w.threads[id] = [...(w.threads[id] ?? []), made];
        return json(201, made);
      }
      if (w.no?.thread) return say(w.no.thread, 'Not permitted');
      return json(200, { items: w.threads[id] ?? [] });
    };
  }
  const s = open(portal, me, { entries: ['/issues'], more });
  const cards = () => [...document.querySelectorAll<HTMLElement>('[data-part=card]')];
  return {
    ...s,
    cards,
    card: (title: string) => cards().find(c => c.textContent?.includes(title))!,
    pane: () => document.querySelector<HTMLElement>('[data-part=detail]')!,
    chip: (value: string) =>
      document.querySelector<HTMLElement>(`[data-part=chip][data-value="${value}"]`)!,
    sub: () => document.querySelector('[data-part=sub]')?.textContent,
    world: w,
    reads: (path: string) => s.calls(path).filter(c => (c.init.method ?? 'GET') === 'GET').length,
  };
}

const world = (over: Partial<World> = {}): World => ({
  issues: [WAITING, CLOSED, ticket(7, { title: 'Wi-Fi drops' })],
  threads: { 4: [reply(1), reply(2, { author_name: 'Cleo', body: 'Looking into it.' })] },
  ...over,
});

describe('the Issues centre', () => {
  it('is headed "Reported issues", says what it is for until the queue comes, and then how many are still open', async () => {
    const queue = deferred<unknown>();
    const s = boot('team', world(), { list: queue.promise });
    expect(await screen.findByText('Reported issues')).toBeTruthy();
    expect(s.sub()).toBe('Tickets the team raised from “Report an issue”');
    expect(await screen.findByText('Loading…')).toBeTruthy();
    queue.resolve(undefined);
    await waitFor(() => expect(s.sub()).toBe('2 still open'));
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('counts the queue on its chips: all, open, resolved', async () => {
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    const n = (value: string) => s.chip(value).querySelector('span:last-child')?.textContent;
    expect([n(''), n('open'), n('resolved')]).toEqual(['3', '2', '1']);
    expect(s.chip('').getAttribute('aria-pressed')).toBe('true');
    expect(s.chip('open').getAttribute('aria-pressed')).toBe('false');
  });

  it('lists each ticket as a card: its title, who and when, and whether it is open', async () => {
    const s = boot('team', world({ issues: [WAITING, CLOSED, NAMELESS] }));
    await screen.findByText('Cannot log hours');
    const waiting = within(s.card('Cannot log hours'));
    expect(waiting.getByText(`Sara Ali · ${whenOf(WAITING.created_at)}`)).toBeTruthy();
    expect(waiting.getByText('Open')).toBeTruthy();
    expect(within(s.card('Printer jammed')).getByText('Resolved')).toBeTruthy();
    // a ticket with no title is a "System issue", and with no reporter is by "—"
    const bare = within(s.card('System issue'));
    expect(bare.getByText(`— · ${whenOf(NAMELESS.created_at)}`)).toBeTruthy();
  });

  it('shows only what a chip names, and the ticket being read goes when the chip does not show it', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    expect(await within(s.pane()).findByText('Details of 4')).toBeTruthy();

    await user.click(s.chip('resolved'));
    expect(s.cards().map(c => c.textContent)).toEqual([expect.stringContaining('Printer jammed')]);
    expect(s.chip('resolved').getAttribute('aria-pressed')).toBe('true');
    // the ticket that was being read is not in that chip, so the pane lets go of it — for good
    expect(within(s.pane()).getByText('Pick a ticket to read it and reply.')).toBeTruthy();
    await user.click(s.chip(''));
    expect(s.cards()).toHaveLength(3);
    expect(within(s.pane()).getByText('Pick a ticket to read it and reply.')).toBeTruthy();

    // a ticket the chip still shows stays open in the pane
    await user.click(s.card('Cannot log hours'));
    await user.click(s.chip('open'));
    expect(within(s.pane()).getByText('Details of 4')).toBeTruthy();
  });

  it('says there is nothing, and that all is clear, when the queue (or the chip) has none', async () => {
    const user = userEvent.setup({ delay: null });
    const empty = boot('team', world({ issues: [] }));
    expect(await screen.findByText('No issues here — all clear! 🎉')).toBeTruthy();
    expect(empty.sub()).toBe('Nothing open — all clear');
    cleanup();

    const s = boot('team', world({ issues: [WAITING] }));
    await screen.findByText('Cannot log hours');
    await user.click(s.chip('resolved'));
    expect(screen.getByText('No issues here — all clear! 🎉')).toBeTruthy();
  });

  it("says why the queue could not be had, in the server's words, and keeps the page's own line", async () => {
    const s = boot('team', world({ no: { list: 403 } }));
    expect(await screen.findByText('Not permitted')).toBeTruthy();
    expect(s.sub()).toBe('Tickets the team raised from “Report an issue”');
    expect(s.cards()).toHaveLength(0);
  });

  it('asks for the queue once when it opens', async () => {
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    expect(s.reads('/api/v1/issues')).toBe(1);
  });
});

describe('reading a ticket', () => {
  it('asks for nothing until one is picked, then shows it: who, when, what they said, and the conversation', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    expect(within(s.pane()).getByText('Pick a ticket to read it and reply.')).toBeTruthy();
    expect(s.reads('/api/v1/issues/4/comments')).toBe(0);

    await user.click(s.card('Cannot log hours'));
    const pane = within(s.pane());
    expect(await pane.findByText('Reply 1')).toBeTruthy();
    expect(pane.getByText('Looking into it.')).toBeTruthy();
    expect(pane.getByText('Conversation')).toBeTruthy();
    expect(pane.getByText('SA')).toBeTruthy();
    expect(pane.getByText('Details of 4')).toBeTruthy();
    expect(s.card('Cannot log hours').getAttribute('aria-pressed')).toBe('true');
    expect(s.reads('/api/v1/issues/4/comments')).toBe(1);
  });

  it('says "No replies yet." for a ticket nobody has answered, and "No description was given." for one with no words', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world({ issues: [NAMELESS], threads: {} }));
    await screen.findByText('System issue');
    await user.click(s.card('System issue'));
    expect(await within(s.pane()).findByText('No replies yet.')).toBeTruthy();
    expect(within(s.pane()).getByText('No description was given.')).toBeTruthy();
    expect(within(s.pane()).getByText('?')).toBeTruthy();
  });

  it('shows the loader in the conversation until it comes', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    expect(s.pane().querySelector('[data-part=thread] [data-part=loading]')).toBeTruthy();
    await within(s.pane()).findByText('Reply 1');
    expect(s.pane().querySelector('[data-part=thread] [data-part=loading]')).toBeNull();
  });

  it('says why the conversation could not be had instead of saying nobody has written', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world({ no: { thread: 403 } }));
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    expect(await within(s.pane()).findByText('Not permitted')).toBeTruthy();
    expect(within(s.pane()).queryByText('No replies yet.')).toBeNull();
  });

  it('opens the attachment in a new tab when it is a link a browser should follow, and not otherwise', async () => {
    const user = userEvent.setup({ delay: null });
    const w = world({
      issues: [
        ticket(4, { title: 'With file', file_url: 'https://cdn.example.com/shot.png' }),
        ticket(5, { title: 'Hostile', file_url: 'javascript:alert(1)' }),
      ],
      threads: {
        4: [
          reply(1, { file_url: '/files/log.txt', file_name: 'log.txt' }),
          reply(2, { file_url: 'javascript:alert(1)', file_name: 'evil' }),
          reply(3, { file_url: 'https://cdn.example.com/a.pdf', file_name: '' }),
        ],
      },
    });
    const s = boot('team', w);
    await screen.findByText('With file');
    await user.click(s.card('With file'));
    const pane = within(s.pane());
    const view = await pane.findByRole('link', { name: 'View attachment' });
    expect(view.getAttribute('href')).toBe('https://cdn.example.com/shot.png');
    expect(view.getAttribute('target')).toBe('_blank');
    expect(view.getAttribute('rel')).toBe('noopener noreferrer');
    expect(pane.getByRole('link', { name: 'log.txt' }).getAttribute('href')).toBe('/files/log.txt');
    expect(pane.getByRole('link', { name: 'attachment' }).getAttribute('href')).toBe(
      'https://cdn.example.com/a.pdf',
    );
    expect(pane.queryByRole('link', { name: 'evil' })).toBeNull();

    await user.click(s.card('Hostile'));
    await waitFor(() => expect(pane.queryByRole('link', { name: 'View attachment' })).toBeNull());
  });

  it('says who solved a closed ticket, and when — and says nothing of it for an open one', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Printer jammed'));
    expect(
      await within(s.pane()).findByText(`Solved by Admin · ${whenOf(CLOSED.resolved_at)}`),
    ).toBeTruthy();
    await user.click(s.card('Cannot log hours'));
    await waitFor(() => expect(within(s.pane()).queryByText(/Solved by/)).toBeNull());
  });

  it('scrolls the ticket into view on a phone, where it is below the queue, and not on a wide screen', async () => {
    const user = userEvent.setup({ delay: null });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }));
    await user.click(s.card('Cannot log hours'));
    expect(scroll).not.toHaveBeenCalled();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width:900px)', media: q }));
    await user.click(s.card('Printer jammed'));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});

describe('answering a ticket', () => {
  it('sends a reply, empties the box, asks for the conversation again and shows the new reply', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await within(s.pane()).findByText('Reply 1');
    const box = within(s.pane()).getByPlaceholderText('Reply to Sara Ali…') as HTMLTextAreaElement;
    await user.type(box, '  Fixed it.  ');
    await user.click(within(s.pane()).getByRole('button', { name: 'Send' }));
    expect(await within(s.pane()).findByText('Fixed it.')).toBeTruthy();
    const posts = s.calls('/api/v1/issues/4/comments').filter(c => c.init.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]!.init.body))).toEqual({ body: 'Fixed it.' });
    expect(box.value).toBe('');
    expect(box.disabled).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(s.reads('/api/v1/issues/4/comments')).toBe(2);
  });

  it('asks for nothing when there is nothing to send, and puts the cursor in the box', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await within(s.pane()).findByText('Reply 1');
    const box = within(s.pane()).getByPlaceholderText('Reply to Sara Ali…');
    await user.type(box, '   ');
    await user.click(within(s.pane()).getByRole('button', { name: 'Send' }));
    expect(s.calls('/api/v1/issues/4/comments').filter(c => c.init.method === 'POST')).toHaveLength(
      0,
    );
    expect(document.activeElement).toBe(box);
  });

  it("tells the person in the server's words when it would not take the reply, and keeps what they wrote", async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world({ no: { post: 400 } }));
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await within(s.pane()).findByText('Reply 1');
    const box = within(s.pane()).getByPlaceholderText('Reply to Sara Ali…') as HTMLTextAreaElement;
    await user.type(box, 'Hello');
    await user.click(within(s.pane()).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Write a reply, or attach a file.')).toBeTruthy();
    expect(box.value).toBe('Hello');
    expect(box.disabled).toBe(false);
  });

  it('starts a new draft for each ticket', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await user.type(
      await within(s.pane()).findByPlaceholderText('Reply to Sara Ali…'),
      'half a thought',
    );
    await user.click(s.card('Printer jammed'));
    const box = (await within(s.pane()).findByPlaceholderText(
      'Reply to Omar Hassan…',
    )) as HTMLTextAreaElement;
    expect(box.value).toBe('');
  });

  it('addresses the reply to "the reporter" when the ticket has no name on it', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world({ issues: [NAMELESS] }));
    await screen.findByText('System issue');
    await user.click(s.card('System issue'));
    expect(await within(s.pane()).findByPlaceholderText('Reply to the reporter…')).toBeTruthy();
  });
});

describe('closing and reopening', () => {
  it('marks an open ticket solved: asks, tells the person the reporter has been told, and the card, pill and count follow', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await user.click(await within(s.pane()).findByRole('button', { name: 'Mark solved' }));
    expect(await screen.findByText(SAID.solved)).toBeTruthy();
    const patches = s.calls('/api/v1/issues/4');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(patches[0]!.init.body))).toEqual({ status: 'resolved' });
    await waitFor(() =>
      expect(within(s.card('Cannot log hours')).getByText('Resolved')).toBeTruthy(),
    );
    expect(within(s.pane()).getByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(within(s.pane()).getByText(/^Solved by Cleo/)).toBeTruthy();
    expect(s.sub()).toBe('1 still open');
    expect(s.chip('open').querySelector('span:last-child')?.textContent).toBe('1');
    expect(s.reads('/api/v1/issues')).toBe(1);
  });

  it('reopens a closed one', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Printer jammed'));
    await user.click(await within(s.pane()).findByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText(SAID.reopened)).toBeTruthy();
    expect(JSON.parse(String(s.calls('/api/v1/issues/5')[0]!.init.body))).toEqual({
      status: 'open',
    });
    await waitFor(() => expect(within(s.card('Printer jammed')).getByText('Open')).toBeTruthy());
    expect(within(s.pane()).getByRole('button', { name: 'Mark solved' })).toBeTruthy();
    expect(within(s.pane()).queryByText(/Solved by/)).toBeNull();
    expect(s.sub()).toBe('3 still open');
  });

  it('lets go of a ticket that leaves the chip it was read from', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world());
    await screen.findByText('Cannot log hours');
    await user.click(s.chip('open'));
    await user.click(s.card('Cannot log hours'));
    await user.click(await within(s.pane()).findByRole('button', { name: 'Mark solved' }));
    await screen.findByText(SAID.solved);
    expect(s.cards().map(c => c.textContent)).toEqual([expect.stringContaining('Wi-Fi drops')]);
    expect(within(s.pane()).getByText('Pick a ticket to read it and reply.')).toBeTruthy();
    // …and it does not come back when the chip does
    await user.click(s.chip(''));
    expect(within(s.pane()).getByText('Pick a ticket to read it and reply.')).toBeTruthy();
  });

  it('says why when the server would not, and the ticket stays as it was', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world({ no: { patch: 403 } }));
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await user.click(await within(s.pane()).findByRole('button', { name: 'Mark solved' }));
    expect(await screen.findByText('Not permitted')).toBeTruthy();
    expect(within(s.card('Cannot log hours')).getByText('Open')).toBeTruthy();
    expect(screen.queryByText(SAID.solved)).toBeNull();
    expect(s.sub()).toBe('2 still open');
  });

  it('is offered only to somebody who may manage the centre: a reader can answer but not close', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('team', world(), { me: READER() });
    await screen.findByText('Cannot log hours');
    await user.click(s.card('Cannot log hours'));
    await within(s.pane()).findByText('Reply 1');
    expect(within(s.pane()).getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(within(s.pane()).queryByRole('button', { name: 'Mark solved' })).toBeNull();
    await user.click(s.card('Printer jammed'));
    await within(s.pane()).findByText(/Solved by Admin/);
    expect(within(s.pane()).queryByRole('button', { name: 'Reopen' })).toBeNull();
  });
});

describe('who has it', () => {
  it('is the admin’s page too: the same centre, with everything an admin may do', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot('admin', world());
    expect(await screen.findByText('Reported issues')).toBeTruthy();
    await screen.findByText('Cannot log hours');
    expect(s.sub()).toBe('2 still open');
    await user.click(s.card('Cannot log hours'));
    await user.click(await within(s.pane()).findByRole('button', { name: 'Mark solved' }));
    expect(await screen.findByText(SAID.solved)).toBeTruthy();
    // it stands in the admin's rail, beside Notifications
    expect(document.querySelector('[data-screen=issues]')?.getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('is not the page of a team member who was not given it: the centre is not opened for them', async () => {
    open('team', teamMe({}, 'Sales'), {
      entries: ['/issues'],
      more: { '/api/v1/issues': () => json(200, { items: [WAITING] }) },
    });
    expect(await screen.findByText(/Signed in as Sam/)).toBeTruthy();
    expect(screen.queryByText('Reported issues')).toBeNull();
    expect(screen.queryByText('Cannot log hours')).toBeNull();
  });
});
