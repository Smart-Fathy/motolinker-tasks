import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../test/helpers';
import { open } from '../test/session';

// The worker, as the app meets it: what it is told when it opens, and what the worker says to it. (jsdom has no service
// workers; these stand in for the browser's.)

const SUBSCRIPTION = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

function browserWith(subscription: unknown, ready?: Promise<unknown>) {
  const events = new EventTarget();
  const container = Object.assign(events, {
    ready: ready ?? Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
  });
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
  return {
    say: (data: unknown) =>
      act(() => {
        events.dispatchEvent(new MessageEvent('message', { data }));
      }),
  };
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title>Acme</title><style id="ws-theme">/* server */</style>`;
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'PushManager');
});

describe('a push subscription this browser already has', () => {
  const PUSH = {
    '/api/dashboard/push/subscribe': () => json(200, { ok: true }),
    '/api/employee/push/subscribe': () => json(200, { ok: true }),
  };

  it("is told to the portal's server when somebody is signed in, as them", async () => {
    browserWith({ toJSON: () => SUBSCRIPTION });
    const a = open('admin', adminMe(), { more: PUSH });
    await waitFor(() => expect(a.calls('/api/dashboard/push/subscribe')).toHaveLength(1));
    const call = a.calls('/api/dashboard/push/subscribe')[0]!;
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(String(call.init.body))).toEqual(SUBSCRIPTION);
    expect(new Headers(call.init.headers).get('Authorization')).toBe('Bearer tok');
    cleanup();

    const t = open('team', teamMe({ leads: true }), { more: PUSH });
    await waitFor(() => expect(t.calls('/api/employee/push/subscribe')).toHaveLength(1));
    expect(t.calls('/api/dashboard/push/subscribe')).toHaveLength(0);
  });

  it('is not told once the app has been closed', async () => {
    const ready = deferred<unknown>();
    browserWith(null, ready.promise);
    const a = open('admin', adminMe(), { more: PUSH });
    await screen.findByRole('navigation', { name: 'Sections' });
    a.unmount();
    ready.resolve({
      pushManager: { getSubscription: async () => ({ toJSON: () => SUBSCRIPTION }) },
    });
    await new Promise(r => setTimeout(r, 30));
    expect(a.calls('/api/dashboard/push/subscribe')).toHaveLength(0);
  });

  it('is not made when there is none', async () => {
    browserWith(null);
    const a = open('admin', adminMe(), { more: PUSH });
    await screen.findByRole('navigation', { name: 'Sections' });
    await new Promise(r => setTimeout(r, 30));
    expect(a.calls('/api/dashboard/push/subscribe')).toHaveLength(0);
  });
});

describe('the worker asking for a place', () => {
  it('takes the app to the screen a tapped notification names', async () => {
    const browser = browserWith(null);
    open('admin', adminMe(), { entries: ['/home'] });
    await screen.findByRole('navigation', { name: 'Sections' });
    browser.say({ ml: 'sw', v: 1, type: 'open', url: '/dashboard?chat=room-7' });
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeTruthy();
    browser.say({ ml: 'sw', v: 1, type: 'open', url: '/dashboard#customers' });
    expect(await screen.findByTitle('Leads (classic page)')).toBeTruthy();
  });

  it('keeps the original look in the address it goes to, if the app was opened in it', async () => {
    const browser = browserWith(null);
    window.history.replaceState(null, '', '/dashboard/home?safe=1');
    open('admin', adminMe(), { safe: true, browser: true });
    await screen.findByRole('navigation', { name: 'Sections' });
    browser.say({ ml: 'sw', v: 1, type: 'open', url: '/dashboard?chat=room-7' });
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/chat/room-7'));
    expect(window.location.search).toBe('?safe=1');
    cleanup();

    window.history.replaceState(null, '', '/dashboard/home');
    open('admin', adminMe(), { browser: true });
    await screen.findByRole('navigation', { name: 'Sections' });
    browser.say({ ml: 'sw', v: 1, type: 'open', url: '/dashboard#customers' });
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/leads'));
    expect(window.location.search).toBe('');
  });

  it("does not move for anything that is not that, or not this portal's", async () => {
    const browser = browserWith(null);
    open('admin', adminMe(), { entries: ['/leads'] });
    await screen.findByTitle('Leads (classic page)');
    for (const data of [
      { type: 'open_chat_room', roomId: 'room-7' }, // what the classic pages are told
      { ml: 'sw', v: 2, type: 'open', url: '/dashboard?chat=room-7' },
      { ml: 'sw', v: 1, type: 'open', url: '/employee#requests' },
      { ml: 'sw', v: 1, type: 'open', url: 'https://elsewhere.example/dashboard?chat=room-7' },
      'open',
      null,
    ])
      browser.say(data);
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByRole('heading', { name: 'Chat' })).toBeNull();
    expect(screen.getByTitle('Leads (classic page)')).toBeTruthy();
  });

  it('is not listened to once the app is closed', async () => {
    const browser = browserWith(null);
    const add = vi.spyOn(navigator.serviceWorker, 'addEventListener');
    const remove = vi.spyOn(navigator.serviceWorker, 'removeEventListener');
    const view = open('admin', adminMe(), { entries: ['/home'] });
    await screen.findByRole('navigation', { name: 'Sections' });
    expect(add).toHaveBeenCalledWith('message', expect.any(Function));
    view.unmount();
    expect(remove).toHaveBeenCalledWith('message', add.mock.calls[0]?.[1]);
    browser.say({ ml: 'sw', v: 1, type: 'open', url: '/dashboard?chat=room-7' });
    expect(screen.queryByRole('heading', { name: 'Chat' })).toBeNull();
  });
});
