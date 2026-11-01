import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, teamMe } from '../test/helpers';
import { open } from '../test/session';
import { ANSWER, askOpen, assistantServer, looking, SECTIONS, section } from '../test/assistant';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title>Acme</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const iframe = () => document.querySelector('iframe') as HTMLIFrameElement;
const opened = (title: string) => screen.findByTitle(title);

/** What the app says to the frame, with where it was addressed. */
function listen() {
  const spy = vi.spyOn(iframe().contentWindow as Window, 'postMessage');
  const all = () => spy.mock.calls.map(([message, origin]) => ({ message, origin }));
  return {
    all,
    of: (type: string) => all().filter(c => (c.message as { type?: string }).type === type),
  };
}

/** The classic page speaks (from its own window, from this origin, unless a test says otherwise). */
function speak(
  data: unknown,
  { source, origin }: { source?: MessageEventSource | null; origin?: string } = {},
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: origin ?? window.location.origin,
        source: source === undefined ? iframe().contentWindow : source,
      }),
    );
  });
}
const page = (type: string, name?: string) => ({
  ml: 'embed',
  v: 1,
  type,
  ...(name ? { page: name } : {}),
});

const active = () =>
  document.querySelector('[data-part=itemActive]')?.textContent?.replace(/\d+$/, '').trim();

describe('a screen that has not moved, shown as its classic page', () => {
  it("opens the portal's classic page, embedded, on that screen's page", async () => {
    open('admin', adminMe(), { entries: ['/leads'] });
    expect((await opened('Leads (classic page)')).getAttribute('src')).toBe(
      '/legacy/dashboard?embed=1#customers',
    );
  });

  it("opens the team's, on the page the team portal calls it", async () => {
    open('team', teamMe({ leads: true }), { entries: ['/leads'] });
    expect((await opened('Leads (classic page)')).getAttribute('src')).toBe(
      '/legacy/employee?embed=1#leads',
    );
  });

  it('carries safe mode into the frame', async () => {
    open('admin', adminMe(), { safe: true, entries: ['/leads?safe=1'] });
    expect((await opened('Leads (classic page)')).getAttribute('src')).toBe(
      '/legacy/dashboard?embed=1&safe=1#customers',
    );
  });

  it('keeps the frame out of sight, and says it is opening, until the page says it is up', async () => {
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    expect(iframe().getAttribute('data-state')).toBe('loading');
    expect(screen.getByRole('status').textContent).toMatch(/Opening Leads/);
    // the ring that turns is for the eye; a screen reader is told in words
    expect(screen.getByRole('status').querySelector('span')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    speak(page('ready', 'customers'));
    await waitFor(() => expect(iframe().getAttribute('data-state')).toBe('ready'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the height of the frame', () => {
  const heightOfBox = () =>
    document.querySelector<HTMLElement>('[data-part=legacyFrame]')?.style.height;
  const tall = (px: number) =>
    Object.defineProperty(window, 'innerHeight', { value: px, configurable: true });

  /** jsdom lays nothing out: say where the box starts and how tall the bottom bar is. */
  function layout({ top, bar }: { top: number; bar: number }) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { top: this.dataset['part'] === 'legacyFrame' ? top : 0 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset['part'] === 'bottomNav' ? bar : 0;
    });
  }
  afterEach(() => {
    vi.restoreAllMocks();
    tall(768);
  });

  it('is what the window has left below the top bar', async () => {
    tall(800);
    layout({ top: 56, bar: 64 });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    // the phone's bottom bar is on show in jsdom (no stylesheet hides it): the page ends above it
    expect(heightOfBox()).toBe('680px');
    document.querySelector<HTMLElement>('[data-part=bottomNav]')!.style.display = 'none';
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(heightOfBox()).toBe('744px'); // a bar that is not on show takes no room
    tall(900);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(heightOfBox()).toBe('844px'); // …and the window being resized is followed
  });

  it('does not count the part of the bar that has scrolled out of sight, and is never less than a usable page', async () => {
    tall(800);
    layout({ top: -30, bar: 0 });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    expect(heightOfBox()).toBe('800px');
    tall(200);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(heightOfBox()).toBe('240px');
  });
});

describe('who the app listens to', () => {
  it('hears only its own frame, from its own origin, in the protocol', async () => {
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'), { source: window }); // some other window
    speak(page('ready', 'customers'), { source: null });
    speak(page('ready', 'customers'), { origin: 'https://elsewhere.example' });
    speak({ ml: 'embed', v: 2, type: 'ready', page: 'customers' });
    speak({ type: 'ready', page: 'customers' });
    speak('ready');
    speak(page('ready', '../customers'));
    expect(iframe().getAttribute('data-state')).toBe('loading');
    speak(page('ready', 'customers'));
    await waitFor(() => expect(iframe().getAttribute('data-state')).toBe('ready'));
  });

  it('does not move to a page that is not a screen of the app, whoever says so', async () => {
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak(page('navigated', 'zzzzzz'));
    expect(active()).toBe('Leads');
  });
});

describe('following the frame', () => {
  it('moves the address to the screen the person went to inside the page', async () => {
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    speak(page('ready', 'customers'));
    speak(page('navigated', 'deals'));
    await waitFor(() => expect(active()).toBe('Deals'));
    expect(heard.of('navigate')).toHaveLength(0); // it went there by itself: nobody asks it to go where it is
  });

  it('keeps the original look in the address it moves to, if the app was opened in it', async () => {
    window.history.replaceState(null, '', '/dashboard/leads?safe=1');
    open('admin', adminMe(), { safe: true, browser: true });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak(page('navigated', 'deals'));
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/deals'));
    expect(window.location.search).toBe('?safe=1');
    cleanup();

    window.history.replaceState(null, '', '/dashboard/leads');
    open('admin', adminMe(), { browser: true });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak(page('navigated', 'tasks'));
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/tasks'));
    expect(window.location.search).toBe('');
  });

  // (The page the lead is handed to is one that still has no screen of its own: the screens that make a document consume their
  // own ?lead= and clear it — tests/webdocs.js holds those. The frame attaches the lead to whichever address it moves to.)
  it("takes the lead along when a lead's page sent the person on to make a document for it", async () => {
    window.history.replaceState(null, '', '/dashboard/leads');
    open('admin', adminMe(), { browser: true });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak({ ...page('navigated', 'reports'), lead: 7 });
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/reports'));
    expect(window.location.search).toBe('?lead=7');
  });

  it('…beside the original look, if the app was opened in it', async () => {
    window.history.replaceState(null, '', '/dashboard/leads?safe=1');
    open('admin', adminMe(), { safe: true, browser: true });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak({ ...page('navigated', 'reports'), lead: 7 });
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/reports'));
    expect(new URLSearchParams(window.location.search).get('safe')).toBe('1');
    expect(new URLSearchParams(window.location.search).get('lead')).toBe('7');
  });

  it('names nobody when no lead was named, or one that is not a lead', async () => {
    window.history.replaceState(null, '', '/dashboard/leads');
    open('admin', adminMe(), { browser: true });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak({ ...page('navigated', 'reports'), lead: -1 });
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/reports'));
    expect(window.location.search).toBe('');
  });

  it('follows the team portal\'s old "log" page to the hours screen', async () => {
    open('team', teamMe({ leads: true, hours: true, hoursActions: { log: true } }), {
      entries: ['/leads'],
    });
    await opened('Leads (classic page)');
    speak(page('ready', 'leads'));
    speak(page('navigated', 'log'));
    await waitFor(() => expect(active()).toMatch(/Hours/));
  });

  it('asks the page for another screen instead of reloading it, in this origin only', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/leads'] });
    const first = await opened('Leads (classic page)');
    const heard = listen();
    speak(page('ready', 'customers'));
    await user.click(screen.getByRole('link', { name: 'Deals' }));
    await waitFor(() => expect(heard.of('navigate')).toHaveLength(1));
    expect(heard.of('navigate')[0]).toEqual({
      message: { ml: 'embed', v: 1, type: 'navigate', page: 'deals' },
      origin: window.location.origin,
    });
    expect(iframe()).toBe(first);
    expect(first.getAttribute('src')).toBe('/legacy/dashboard?embed=1#customers');
  });

  it('does not answer the echo of its own request', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    speak(page('ready', 'customers'));
    await user.click(screen.getByRole('link', { name: 'Deals' }));
    await waitFor(() => expect(heard.of('navigate')).toHaveLength(1));
    speak(page('navigated', 'deals')); // the page, having been asked, says where it is
    await waitFor(() => expect(active()).toBe('Deals'));
    expect(heard.of('navigate')).toHaveLength(1);
  });

  it('takes a page that opens again — it reloaded itself — back to the screen the person is on', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    speak(page('ready', 'customers'));
    await user.click(screen.getByRole('link', { name: 'Deals' }));
    await waitFor(() => expect(heard.of('navigate')).toHaveLength(1));
    speak(page('ready', 'customers')); // the page reloaded, and opened where its own address says
    await waitFor(() => expect(heard.of('navigate')).toHaveLength(2));
    expect(heard.of('navigate')[1]?.message).toMatchObject({ page: 'deals' });
    expect(active()).toBe('Deals');
  });

  it('does not ask a page that is still opening; asks it as soon as it is up, for where the person is by then', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    await user.click(screen.getByRole('link', { name: 'Deals' }));
    await waitFor(() => expect(active()).toBe('Deals'));
    expect(heard.all()).toHaveLength(0);
    speak(page('ready', 'customers')); // it opened on the page it was first asked for
    await waitFor(() => expect(heard.of('navigate')).toHaveLength(1));
    expect(heard.of('navigate')[0]?.message).toMatchObject({ page: 'deals' });
    expect(active()).toBe('Deals');
  });

  it('takes the frame back to where it opened when the person returns to that screen from inside the page', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    speak(page('ready', 'customers'));
    speak(page('navigated', 'deals'));
    await waitFor(() => expect(active()).toBe('Deals'));
    await user.click(screen.getByRole('link', { name: 'Leads' }));
    await waitFor(() => expect(heard.of('navigate')).toHaveLength(1));
    expect(heard.of('navigate')[0]?.message).toMatchObject({ page: 'customers' });
  });
});

describe('a task assigned to a team member', () => {
  const task = (type: string, id = 1) =>
    `event: notification\ndata: ${JSON.stringify({ id, type, title: 'Something', created_at: '2026-10-01T09:00:00.000Z' })}\n\n`;

  it('makes the page that lists their tasks read them again — the page no longer holds the stream that used to tell it', async () => {
    const stream = open('team', teamMe(), { entries: ['/tasks'] });
    await opened('My Tasks (classic page)');
    const heard = listen();
    await waitFor(() =>
      expect(stream.calls('/api/employee/notifications/stream?hd=2')).toHaveLength(1),
    );
    speak(page('ready', 'tasks'));
    stream.push(task('task', 1));
    await waitFor(() => expect(heard.of('refresh')).toHaveLength(1));
    expect(heard.of('refresh')[0]).toEqual({
      message: { ml: 'embed', v: 1, type: 'refresh', what: 'tasks' },
      origin: window.location.origin,
    });
    stream.push(task('reminder', 2));
    await waitFor(() => expect(heard.of('refresh')).toHaveLength(2));
  });

  it('is not made of any other kind of notification, nor of a frame that is not one, nor before the page is up', async () => {
    const stream = open('team', teamMe(), { entries: ['/tasks'] });
    await opened('My Tasks (classic page)');
    const heard = listen();
    await waitFor(() =>
      expect(stream.calls('/api/employee/notifications/stream?hd=2')).toHaveLength(1),
    );
    stream.push(task('task', 1));
    await new Promise(r => setTimeout(r, 50));
    expect(heard.of('refresh')).toHaveLength(0);
    speak(page('ready', 'tasks'));
    stream.push(task('request', 2));
    stream.push(task('general', 3));
    stream.push('event: notification\ndata: not json\n\n');
    stream.push('event: notification\ndata: 7\n\n');
    stream.push(task('task', 4));
    await waitFor(() => expect(heard.of('refresh')).toHaveLength(1));
  });

  it("is the team portal's alone: the admin's pages have no tasks of their own to read", async () => {
    const stream = open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    await waitFor(() =>
      expect(stream.calls('/api/dashboard/notifications/stream?hd=2')).toHaveLength(1),
    );
    speak(page('ready', 'customers'));
    stream.push(task('task', 1));
    await new Promise(r => setTimeout(r, 80));
    expect(heard.of('refresh')).toHaveLength(0);
  });
});

describe('what the frame needs of the app', () => {
  it('has a dead session asked about, once however many calls fail', async () => {
    const { onUnauthorized } = open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    speak(page('unauthorized'));
    speak(page('unauthorized'));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('passes on the look the admin saves, once the page is up and not before', async () => {
    const stream = open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    const heard = listen();
    const look = { name: 'Beta Motors', updated_at: '2999-01-01T00:00:00.000Z' };
    await waitFor(() =>
      expect(stream.calls('/api/dashboard/notifications/stream?hd=2')).toHaveLength(1),
    );
    stream.push(`event: workspace\ndata: ${JSON.stringify(look)}\n\n`);
    await new Promise(r => setTimeout(r, 50));
    expect(heard.of('look')).toHaveLength(0);
    speak(page('ready', 'customers'));
    stream.push(`event: workspace\ndata: ${JSON.stringify(look)}\n\n`);
    await waitFor(() => expect(heard.of('look')).toHaveLength(1));
    expect(heard.of('look')[0]).toEqual({
      message: { ml: 'embed', v: 1, type: 'look', profile: look },
      origin: window.location.origin,
    });
    stream.push('event: workspace\ndata: not json\n\n');
    stream.push('event: workspace\ndata: 7\n\n');
    await new Promise(r => setTimeout(r, 50));
    expect(heard.of('look')).toHaveLength(1);
  });
});

describe('a page that does not come up', () => {
  it('is said so after a while, with the classic portal one click away and another try offered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    open('admin', adminMe(), { entries: ['/leads'] });
    const first = await opened('Leads (classic page)');
    await act(async () => {
      vi.advanceTimersByTime(19_000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/did not open here/);
    expect(
      screen.getByRole('link', { name: /Open Leads in the classic portal/ }).getAttribute('href'),
    ).toBe('/legacy/dashboard#customers');
    expect(document.querySelector('iframe')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const again = await opened('Leads (classic page)');
    expect(again).not.toBe(first);
    expect(again.getAttribute('src')).toBe('/legacy/dashboard?embed=1#customers');
    expect(screen.getByRole('status').textContent).toMatch(/Opening Leads/);
    expect(document.querySelector<HTMLElement>('[data-part=legacyFrame]')?.style.height).toBe(
      `${window.innerHeight}px`,
    );
  });

  it('tries again at the screen the person has moved to meanwhile, not the one it first opened for', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    await user.click(screen.getByRole('link', { name: 'Deals' }));
    await waitFor(() => expect(active()).toBe('Deals'));
    await act(async () => {
      vi.advanceTimersByTime(21_000);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/classic page for Deals/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await opened('Deals (classic page)')).getAttribute('src')).toBe(
      '/legacy/dashboard?embed=1#deals',
    );
    speak(page('ready', 'deals'));
    await waitFor(() => expect(iframe().getAttribute('data-state')).toBe('ready'));
  });

  it('does not give up on a page that came up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open('admin', adminMe(), { entries: ['/leads'] });
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(iframe().getAttribute('data-state')).toBe('ready');
  });
});

describe('screens a frame cannot hold', () => {
  it('say why, and keep the classic portal one click away', async () => {
    open('admin', adminMe(), { entries: ['/chat'] });
    expect(await screen.findByText(/keeps a live connection to the server/)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Open Chat in the classic portal/ }).getAttribute('href'),
    ).toBe('/legacy/dashboard#chat');
  });
});

describe('the assistant, around a framed page', () => {
  // (the classic page builds none of it in a frame: the card stands above the frame, and the panel is the app's)
  const WITH_LEADS = { ...SECTIONS, sections: [...SECTIONS.sections, section('leads', 'Leads')] };
  const PROPOSAL = {
    action: { type: 'notify', title: 'Call Mona', to: 'me' },
    label: 'Notify',
    description: 'Send yourself a note: Call Mona.',
  };
  const framed = (said: Record<string, unknown> = {}) => {
    const s = assistantServer('/api/dashboard', { sections: WITH_LEADS, ...said });
    open('admin', adminMe(), { entries: ['/leads'], more: s.routes });
    return s;
  };
  const ready = async () => {
    await opened('Leads (classic page)');
    speak(page('ready', 'customers'));
    await waitFor(() => expect(iframe().getAttribute('data-state')).toBe('ready'));
  };
  const recordMessage = (record: unknown) => ({ ml: 'embed', v: 1, type: 'record', record });
  const LEAD = { kind: 'lead', id: '12', title: 'Mona Saleh', sub: 'New' };
  const ask = async (words: string) => {
    const panel = await askOpen();
    await userEvent.type(within(panel).getByRole('textbox'), words + '{Enter}');
    return panel;
  };

  it("puts the section's card above the frame, where the person sees it before the page", async () => {
    framed();
    await ready();
    const card = await screen.findByText('AI insights · Leads');
    const slot = document.querySelector('[data-part=frameCard]') as HTMLElement;
    const box = document.querySelector('[data-part=legacyFrame]') as HTMLElement;
    expect(slot.contains(card)).toBe(true);
    expect(slot.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.contains(slot)).toBe(false);
    expect(await screen.findByText('3 today')).toBeTruthy();
  });

  it('puts no card above the Accounting page, which has one of its own, and asks the server for none', async () => {
    const s = assistantServer('/api/dashboard', {
      sections: {
        ...SECTIONS,
        sections: [...SECTIONS.sections, section('accounting', 'Accounting')],
      },
    });
    open('admin', adminMe(), { entries: ['/accounting'], more: s.routes });
    await opened('Accounting (classic page)');
    await new Promise(r => setTimeout(r, 150));
    expect(screen.queryByText(/^AI insights/)).toBeNull();
    expect(document.querySelector('[data-part=frameCard]')?.childElementCount).toBe(0);
    expect(s.heard.insights).toHaveLength(0);
  });

  it('shows no card, and leaves nothing in the slot, to a person who may not ask the assistant', async () => {
    const s = assistantServer('/api/employee', { sections: WITH_LEADS });
    open('team', teamMe({ leads: true, assistant: false }), {
      entries: ['/leads'],
      more: s.routes,
    });
    await opened('Leads (classic page)');
    expect(screen.queryByText(/^AI insights/)).toBeNull();
    expect(document.querySelector('[data-part=frameCard]')?.childElementCount).toBe(0);
    expect(s.heard.insights).toHaveLength(0);
  });

  it('has the panel look at the record the page says is open, until it says none is', async () => {
    framed();
    await ready();
    await askOpen();
    expect(looking()).toBe('');
    speak(recordMessage(LEAD));
    await waitFor(() => expect(looking()).toBe('Lead #12 · Mona Saleh'));
    speak(recordMessage({ ...LEAD, title: 'Mona S. Saleh' })); // the title comes after a fetch: said again
    await waitFor(() => expect(looking()).toBe('Lead #12 · Mona S. Saleh'));
    speak(recordMessage(null));
    await waitFor(() => expect(looking()).toBe(''));
  });

  it('stays let go of while the page goes on saying it is the same record, and is looked at again after another one', async () => {
    framed();
    await ready();
    const panel = await askOpen();
    speak(recordMessage(LEAD));
    await waitFor(() => expect(looking()).toBe('Lead #12 · Mona Saleh'));
    await userEvent.click(within(panel).getByTitle('Ignore this record'));
    expect(looking()).toBe('');
    speak(recordMessage({ ...LEAD, title: 'Mona S. Saleh' })); // (said again, with the whole name)
    await new Promise(r => setTimeout(r, 150));
    expect(looking()).toBe('');
    speak(recordMessage({ kind: 'lead', id: '13', title: 'Omar Aziz', sub: '' }));
    await waitFor(() => expect(looking()).toBe('Lead #13 · Omar Aziz'));
    speak(recordMessage(LEAD)); // (and back to the first: a new thing to look at)
    await waitFor(() => expect(looking()).toBe('Lead #12 · Mona Saleh'));
  });

  it('hears a record from its own frame only, and nothing that is not a record', async () => {
    framed();
    await ready();
    await askOpen();
    speak(recordMessage(LEAD), { source: window });
    speak(recordMessage(LEAD), { source: null });
    speak(recordMessage(LEAD), { origin: 'https://elsewhere.example' });
    speak(recordMessage({ kind: 'Lead', id: '12' }));
    speak(recordMessage({ kind: 'lead' }));
    speak({ ml: 'embed', v: 2, type: 'record', record: LEAD });
    await new Promise(r => setTimeout(r, 150));
    expect(looking()).toBe('');
  });

  it('asks the page what is chosen on it as a question goes out, and sends what it says with the question', async () => {
    const s = framed();
    await ready();
    const sent = listen();
    const panel = await ask('who is hot?');
    await waitFor(() => expect(sent.of('screen')).toHaveLength(1));
    const asked = sent.of('screen')[0]!;
    expect(asked.origin).toBe(window.location.origin);
    expect(asked.message).toMatchObject({ ml: 'embed', v: 1, type: 'screen', section: 'leads' });
    expect(s.heard.chat).toHaveLength(0); // (the question waits for the page, a moment)
    const chosen = {
      tab: 'Hot',
      search: 'ahmed',
      filters: { status: 'Hot leads' },
      selected: [{ kind: 'lead', id: '3', title: 'Ahmed' }],
    };
    speak({
      ml: 'embed',
      v: 1,
      type: 'screen',
      id: (asked.message as { id: number }).id,
      screen: chosen,
    });
    expect(await within(panel).findByText('Three came today.')).toBeTruthy();
    expect(s.heard.chat[0]?.['screen']).toEqual({ page: 'customers', section: 'leads', ...chosen });
  });

  it('goes with the record the page said was open — and not with one the person said to ignore, whatever the page answers', async () => {
    const s = framed();
    await ready();
    const sent = listen();
    const panel = await askOpen();
    speak(recordMessage(LEAD));
    await waitFor(() => expect(looking()).toBe('Lead #12 · Mona Saleh'));
    await userEvent.type(within(panel).getByRole('textbox'), 'first{Enter}');
    await waitFor(() => expect(sent.of('screen')).toHaveLength(1));
    speak({
      ml: 'embed',
      v: 1,
      type: 'screen',
      id: (sent.of('screen')[0]!.message as { id: number }).id,
      screen: {},
    });
    await within(panel).findByText('Three came today.');
    expect(s.heard.chat[0]?.['screen']).toMatchObject({
      record: { kind: 'lead', id: '12', title: 'Mona Saleh', sub: 'New' },
    });
    await userEvent.click(within(panel).getByTitle('Ignore this record'));
    await userEvent.type(within(panel).getByRole('textbox'), 'second{Enter}');
    await waitFor(() => expect(sent.of('screen')).toHaveLength(2));
    speak({
      ml: 'embed',
      v: 1,
      type: 'screen',
      id: (sent.of('screen')[1]!.message as { id: number }).id,
      screen: { record: LEAD, tab: 'Hot' }, // (a page that names the record again is not heard on it)
    });
    await waitFor(() => expect(s.heard.chat).toHaveLength(2));
    expect(s.heard.chat[1]?.['screen']).toEqual({
      page: 'customers',
      section: 'leads',
      tab: 'Hot',
    });
  });

  it('answers a question once: a late or repeated answer is not taken for the next one', async () => {
    const s = framed();
    await ready();
    const sent = listen();
    const panel = await askOpen();
    await userEvent.type(within(panel).getByRole('textbox'), 'one{Enter}');
    await waitFor(() => expect(sent.of('screen')).toHaveLength(1));
    const first = (sent.of('screen')[0]!.message as { id: number }).id;
    speak({ ml: 'embed', v: 1, type: 'screen', id: first, screen: { tab: 'A' } });
    await within(panel).findByText('Three came today.');
    await userEvent.type(within(panel).getByRole('textbox'), 'two{Enter}');
    await waitFor(() => expect(sent.of('screen')).toHaveLength(2));
    const second = (sent.of('screen')[1]!.message as { id: number }).id;
    expect(second).not.toBe(first);
    speak({ ml: 'embed', v: 1, type: 'screen', id: first, screen: { tab: 'STALE' } });
    speak({ ml: 'embed', v: 1, type: 'screen', id: second, screen: { tab: 'B' } });
    await waitFor(() => expect(s.heard.chat).toHaveLength(2));
    expect(s.heard.chat[1]?.['screen']).toMatchObject({ tab: 'B' });
  });

  it('does not hold the question back for a page that does not answer', async () => {
    const s = framed();
    await ready();
    await ask('hello?');
    await waitFor(() => expect(s.heard.chat).toHaveLength(1), { timeout: 4_000 });
    expect(s.heard.chat[0]?.['screen']).toEqual({ page: 'customers', section: 'leads' });
  }, 8_000);

  it('does not wait on a page that has not come up', async () => {
    const s = framed();
    await opened('Leads (classic page)'); // (not ready)
    await ask('hello?');
    await waitFor(() => expect(s.heard.chat).toHaveLength(1), { timeout: 1_000 });
    expect(s.heard.chat[0]?.['screen']).toEqual({ page: 'customers', section: 'leads' });
  });

  it('has the page read again once an action the person confirmed was carried out', async () => {
    const s = framed({ chat: { ...ANSWER, proposals: [PROPOSAL] } });
    await ready();
    const sent = listen();
    const panel = await askOpen();
    await userEvent.type(within(panel).getByRole('textbox'), 'remind me{Enter}');
    await waitFor(() => expect(sent.of('screen')).toHaveLength(1));
    speak({
      ml: 'embed',
      v: 1,
      type: 'screen',
      id: (sent.of('screen')[0]!.message as { id: number }).id,
      screen: null,
    });
    await within(panel).findByText('Proposed · Notify');
    expect(sent.of('refresh')).toHaveLength(0);
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));
    await within(panel).findByText('Notification sent to you.');
    await waitFor(() => expect(sent.of('refresh')).toHaveLength(1));
    expect(sent.of('refresh')[0]!.message).toMatchObject({
      ml: 'embed',
      v: 1,
      type: 'refresh',
      what: 'page',
    });
    expect(s.heard.run).toHaveLength(1);
  });

  it("opens the panel, and puts it away, when the page says the assistant's key was pressed in it", async () => {
    framed();
    await ready();
    const expanded = () =>
      screen.getByRole('button', { name: 'Ask AI' }).getAttribute('aria-expanded');
    expect(expanded()).toBe('false');
    speak({ ml: 'embed', v: 1, type: 'ask' });
    await waitFor(() => expect(expanded()).toBe('true'));
    speak({ ml: 'embed', v: 1, type: 'ask' });
    await waitFor(() => expect(expanded()).toBe('false'));
  });

  it('hears that key from its own frame only, and not at all where the person may not ask', async () => {
    framed();
    await ready();
    const expanded = () =>
      screen.getByRole('button', { name: 'Ask AI' }).getAttribute('aria-expanded');
    speak({ ml: 'embed', v: 1, type: 'ask' }, { source: window });
    speak({ ml: 'embed', v: 1, type: 'ask' }, { origin: 'https://elsewhere.example' });
    await new Promise(r => setTimeout(r, 100));
    expect(expanded()).toBe('false');
    cleanup();
    const s = assistantServer('/api/employee', { sections: WITH_LEADS });
    open('team', teamMe({ leads: true, assistant: false }), {
      entries: ['/leads'],
      more: s.routes,
    });
    await opened('Leads (classic page)');
    speak({ ml: 'embed', v: 1, type: 'ask' });
    await new Promise(r => setTimeout(r, 100));
    expect(screen.queryByRole('dialog', { name: 'AI assistant' })).toBeNull();
  });

  it('lets go of the record, and of the frame, when the screen is left', async () => {
    const s = framed();
    await ready();
    await askOpen();
    speak(recordMessage(LEAD));
    await waitFor(() => expect(looking()).toBe('Lead #12 · Mona Saleh'));
    await userEvent.click(screen.getByRole('link', { name: 'Submissions' }));
    await waitFor(() => expect(looking()).toBe(''));
    expect(document.querySelector('iframe')).toBeNull();
    const panel = screen.getByRole('dialog', { name: 'AI assistant' });
    await userEvent.type(within(panel).getByRole('textbox'), 'and here?{Enter}');
    await waitFor(() => expect(s.heard.chat).toHaveLength(1), { timeout: 1_000 }); // (no frame to wait for)
    expect(s.heard.chat[0]?.['screen']).toMatchObject({ page: 'submissions' });
  });
});
