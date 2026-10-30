// The app's side of its service worker (src/sw/sw.ts): putting the worker in place and keeping it fresh, keeping alive a push
// subscription the person made before, taking a tapped notification to its screen, and surviving the one thing a new build
// does to a page that is still open — the files it was going to load next are gone.
import { linkTarget } from '@motolinker/contracts/deeplinks';
import { scopeOf, workerUrl } from '../sw/shared';
import type { Portal } from './env';

/** A page left open does not wait for its next visit to hear of a new build: it asks when it comes to the front, this often at most. */
export const CHECK_EVERY_MS = 30 * 60_000;

/** After a reload for a missing file the next one waits this long: a file still missing after that is a different problem. */
export const RELOAD_EVERY_MS = 60_000;

export interface WorkerDeps {
  /** where workers are registered; absent where the browser has none (an insecure address, an old browser) */
  container?: Pick<ServiceWorkerContainer, 'register'> | undefined;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  now?: () => number;
}

const containerOfBrowser = (): ServiceWorkerContainer | undefined =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : undefined;

/**
 * Puts the portal's worker in place (the same scope the classic worker holds, so whichever portal page was opened last is the
 * one in charge) and asks for a newer one when the page comes to the front after a while. Returns what undoes the listening.
 * Nothing here is allowed to be the reason the app does not open: a worker that cannot be registered is the app without one.
 */
export function startWorker(portal: Portal, deps: WorkerDeps = {}): () => void {
  const container = 'container' in deps ? deps.container : containerOfBrowser();
  const doc = deps.doc ?? document;
  const now = deps.now ?? Date.now;
  if (!container) return () => undefined;

  let registration: ServiceWorkerRegistration | undefined;
  let checked = now();
  container.register(workerUrl(portal), { scope: scopeOf(portal) }).then(
    r => {
      registration = r;
    },
    () => undefined,
  );
  const onVisible = () => {
    if (!registration || doc.visibilityState !== 'visible' || now() - checked < CHECK_EVERY_MS)
      return;
    checked = now();
    registration.update().catch(() => undefined);
  };
  doc.addEventListener('visibilitychange', onVisible);
  return () => doc.removeEventListener('visibilitychange', onVisible);
}

export interface PushDeps {
  container?: Pick<ServiceWorkerContainer, 'ready'> | undefined;
  /** whether the browser has push at all */
  pushable?: boolean;
}

/**
 * Tells the server again about the push subscription this browser already has, if it has one — what the classic pages do each
 * time they open, so a subscription the server dropped (or never stored, for a sign-in on a new account) is back. It never
 * asks for permission or makes a subscription: offering notifications is a screen's job, and a prompt out of nowhere is the
 * worst way to be asked.
 */
export async function refreshPush(
  post: (subscription: PushSubscriptionJSON) => Promise<unknown>,
  signal?: AbortSignal,
  deps: PushDeps = {},
): Promise<boolean> {
  const container = 'container' in deps ? deps.container : containerOfBrowser();
  const pushable = deps.pushable ?? (typeof window !== 'undefined' && 'PushManager' in window);
  if (!container || !pushable) return false;
  try {
    const registration = await container.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription || signal?.aborted) return false;
    await post(subscription.toJSON());
    return true;
  } catch {
    return false;
  }
}

export interface StaleChunkDeps {
  /** where Vite announces a file it could not load (`vite:preloadError`) */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  store?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  reload?: () => void;
}

const RELOADED_KEY = 'ml_chunk_reload';

/**
 * A page that was open while a new build went out asks for files that are no longer there. The new build is one reload away,
 * so that is what happens — once a minute at most, so that a file that is really gone cannot make a loop. Returns what undoes
 * the listening.
 */
export function reloadOnStaleChunk(deps: StaleChunkDeps = {}): () => void {
  const target = deps.target ?? window;
  const now = deps.now ?? Date.now;
  const reload = deps.reload ?? (() => window.location.reload());
  const onError = (event: Event) => {
    try {
      const store = deps.store ?? window.sessionStorage;
      const last = Number(store.getItem(RELOADED_KEY) ?? 0);
      if (now() - last < RELOAD_EVERY_MS) return;
      store.setItem(RELOADED_KEY, String(now()));
    } catch {
      return; // no way to remember that we did: do not risk a loop
    }
    event.preventDefault();
    reload();
  };
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}

/**
 * Where an address a tapped notification carried goes in the app: a link stored by the server ('/dashboard#customers',
 * '/employee?chat=<room>'), or an address inside the app. Null for anything that is not this portal's.
 */
export function routeForUrl(portal: Portal, url: string, origin: string): string | null {
  let at: URL;
  try {
    at = new URL(url, origin);
  } catch {
    return null;
  }
  if (at.origin !== origin) return null;
  const base = scopeOf(portal);
  if (at.pathname === base || at.pathname === base + '/')
    return linkTarget(at.pathname + at.search + at.hash, portal) ?? '/';
  if (at.pathname.startsWith(base + '/')) return at.pathname.slice(base.length);
  return null;
}
