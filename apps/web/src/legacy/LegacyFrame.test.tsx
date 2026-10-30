import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, teamMe } from '../test/helpers';
import { open } from '../test/session';

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
    open('admin', adminMe(), { entries: ['/security'] });
    expect(await screen.findByText(/opens over a page of the classic portal/)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(
      screen
        .getByRole('link', { name: /Open Security in the classic portal/ })
        .getAttribute('href'),
    ).toBe('/legacy/dashboard#security');
  });
});
