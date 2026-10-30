import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_EVERY_MS,
  RELOAD_EVERY_MS,
  refreshPush,
  reloadOnStaleChunk,
  routeForUrl,
  startWorker,
  type WorkerDeps,
} from './pwa';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ORIGIN = 'https://portal.example';

function page(state: DocumentVisibilityState = 'visible') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: state,
    addEventListener: vi.fn((_type: string, fn: () => void) => void listeners.add(fn)),
    removeEventListener: vi.fn((_type: string, fn: () => void) => void listeners.delete(fn)),
  };
  return {
    doc: doc as unknown as NonNullable<WorkerDeps['doc']>,
    show: (visibility: DocumentVisibilityState) => {
      doc.visibilityState = visibility;
      listeners.forEach(fn => fn());
    },
    listening: () => listeners.size,
  };
}

describe("the portal's worker, put in place", () => {
  it('is registered at its own address with the scope of its portal', async () => {
    for (const [portal, url, scope] of [
      ['admin', '/sw-ui-dashboard.js', '/dashboard'],
      ['team', '/sw-ui-employee.js', '/employee'],
    ] as const) {
      const register = vi.fn(
        async () => ({ update: vi.fn() }) as unknown as ServiceWorkerRegistration,
      );
      startWorker(portal, { container: { register }, doc: page().doc });
      await flush();
      expect(register).toHaveBeenCalledExactlyOnceWith(url, { scope });
    }
  });

  it('is not an error where the browser has none, nor where it will not take one', async () => {
    const p = page();
    const stop = startWorker('admin', { container: undefined, doc: p.doc });
    expect(p.listening()).toBe(0);
    expect(stop()).toBeUndefined();

    const register = vi.fn(() => Promise.reject(new Error('blocked')));
    const q = page();
    let clock = 0;
    startWorker('admin', { container: { register }, doc: q.doc, now: () => clock });
    await flush();
    clock += CHECK_EVERY_MS;
    q.show('visible'); // nothing registered, nothing to ask
    expect(q.listening()).toBe(1);
  });

  it('asks for a newer one when the page comes to the front after a while, not every time', async () => {
    let clock = 1_000_000;
    const update = vi.fn(async () => undefined);
    const register = async () => ({ update }) as unknown as ServiceWorkerRegistration;
    const p = page('hidden');
    startWorker('admin', { container: { register }, doc: p.doc, now: () => clock });
    await flush();

    clock += CHECK_EVERY_MS - 1;
    p.show('visible');
    expect(update).not.toHaveBeenCalled(); // too soon after it was put in place

    clock += 1;
    p.show('hidden');
    expect(update).not.toHaveBeenCalled(); // behind another window: not now

    p.show('visible');
    expect(update).toHaveBeenCalledTimes(1);

    clock += 1_000;
    p.show('visible');
    expect(update).toHaveBeenCalledTimes(1); // it has just asked

    clock += CHECK_EVERY_MS;
    p.show('visible');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not mind a check that cannot reach the server, and stops listening when told to', async () => {
    let clock = 0;
    // (a plain function: a spy keeps an eye on the promises it returns, which would hide one nobody handles)
    let asked = 0;
    const update = () => {
      asked++;
      return Promise.reject(new TypeError('offline'));
    };
    const register = async () => ({ update }) as unknown as ServiceWorkerRegistration;
    const p = page();
    const stop = startWorker('team', { container: { register }, doc: p.doc, now: () => clock });
    await flush();
    clock += CHECK_EVERY_MS;
    p.show('visible');
    await flush();
    expect(asked).toBe(1);
    stop();
    expect(p.listening()).toBe(0);
  });
});

describe('a push subscription made before', () => {
  const holding = (subscription: unknown) => ({
    ready: Promise.resolve({
      pushManager: { getSubscription: async () => subscription },
    } as unknown as ServiceWorkerRegistration),
  });
  const JSON_OF = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

  it('is told to the server again', async () => {
    const post = vi.fn(async () => undefined);
    const sub = { toJSON: () => JSON_OF };
    expect(await refreshPush(post, undefined, { container: holding(sub), pushable: true })).toBe(
      true,
    );
    expect(post).toHaveBeenCalledExactlyOnceWith(JSON_OF);
  });

  it('is not made when there is none: that is a screen to offer, not a prompt out of nowhere', async () => {
    const post = vi.fn(async () => undefined);
    expect(await refreshPush(post, undefined, { container: holding(null), pushable: true })).toBe(
      false,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('is left alone where there is no push, no worker, or the page has moved on', async () => {
    const post = vi.fn(async () => undefined);
    const sub = { toJSON: () => JSON_OF };
    expect(await refreshPush(post, undefined, { container: holding(sub), pushable: false })).toBe(
      false,
    );
    expect(await refreshPush(post, undefined, { container: undefined, pushable: true })).toBe(
      false,
    );
    const gone = new AbortController();
    const pending = refreshPush(post, gone.signal, { container: holding(sub), pushable: true });
    gone.abort();
    expect(await pending).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('is not an error when the server will not have it', async () => {
    const post = vi.fn(() => Promise.reject(new Error('401')));
    const sub = { toJSON: () => JSON_OF };
    expect(await refreshPush(post, undefined, { container: holding(sub), pushable: true })).toBe(
      false,
    );
    const never = { ready: Promise.reject(new Error('no worker')) };
    expect(await refreshPush(post, undefined, { container: never, pushable: true })).toBe(false);
  });
});

describe('a file that went with the last build', () => {
  const setup = (now: () => number = () => 5_000_000) => {
    const target = new EventTarget();
    const memory = new Map<string, string>();
    const store = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    };
    const reload = vi.fn();
    const stop = reloadOnStaleChunk({ target, store, now, reload });
    const fail = () => {
      const event = new Event('vite:preloadError', { cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    return { fail, reload, stop, memory };
  };

  it('is answered with the new build, which is one reload away', () => {
    const { fail, reload } = setup();
    const event = fail();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true); // the error that would have been thrown is not
  });

  it('is answered once a minute at most, so a file that is really gone cannot make a loop', () => {
    let clock = 5_000_000;
    const { fail, reload } = setup(() => clock);
    fail();
    clock += RELOAD_EVERY_MS - 1;
    const again = fail();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(again.defaultPrevented).toBe(false); // this time the error is the page's to show
    clock += 1;
    fail();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('is not answered where there is no way to remember having answered', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const store = {
      getItem: () => {
        throw new Error('storage is off');
      },
      setItem: () => undefined,
    };
    reloadOnStaleChunk({ target, store, now: () => 1, reload });
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('is not listened for once told to stop', () => {
    const { fail, reload, stop } = setup();
    stop();
    fail();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("where a notification's address goes in the app", () => {
  const route = (portal: 'admin' | 'team', url: string) => routeForUrl(portal, url, ORIGIN);

  it("is the screen a link stored by the server names, in this portal's words", () => {
    expect(route('admin', '/dashboard#customers')).toBe('/leads');
    expect(route('team', '/employee#requests')).toBe('/requests');
    expect(route('admin', '/dashboard?chat=r-1')).toBe('/chat/r-1');
    expect(route('team', '/employee?chat=r-1#requests')).toBe('/chat/r-1');
    expect(route('admin', ORIGIN + '/dashboard#customers')).toBe('/leads');
  });

  it('is an address inside the app, as it is', () => {
    expect(route('admin', '/dashboard/leads')).toBe('/leads');
    expect(route('admin', '/dashboard/chat/r-1')).toBe('/chat/r-1');
    expect(route('team', '/employee/hours?x=1#y')).toBe('/hours'); // the place; what rides on it is not carried
  });

  it('is the front door when the address names no screen in particular', () => {
    for (const url of ['/dashboard', '/dashboard/', '/dashboard#nothing', '/dashboard?x=1'])
      expect(route('admin', url), url).toBe('/');
  });

  it("is nowhere when the address is not this portal's", () => {
    for (const url of [
      '/employee#requests',
      '/employee',
      '/legacy/dashboard',
      '/dashboardx',
      '/',
      'https://elsewhere.example/dashboard#customers',
      '//elsewhere.example/dashboard',
      'http://[bad',
    ])
      expect(route('admin', url), url).toBeNull();
  });
});
