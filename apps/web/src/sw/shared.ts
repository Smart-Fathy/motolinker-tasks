// What the new app's service worker and the app's pages both have to agree on: the worker's addresses (one script, served at
// two), the scope each one holds, and what the worker says to the pages. Pure and tiny, because the worker is made of it.
import type { Portal } from '../lib/env';

const SPEC: Record<Portal, { base: string; name: string }> = {
  admin: { base: '/dashboard', name: 'dashboard' },
  team: { base: '/employee', name: 'employee' },
};

/** The address a portal's worker is loaded from. The script is the same file; the address says which portal it is for. */
export const workerUrl = (portal: Portal): string => `/sw-ui-${SPEC[portal].name}.js`;

/** What a portal's worker controls: the portal's own address and everything under it (never /legacy/…, never /api/…). */
export const scopeOf = (portal: Portal): string => SPEC[portal].base;

/** The portal a worker was loaded for, by the address it was loaded from; null for any other address (it then does nothing). */
export function portalOfWorker(pathname: string): Portal | null {
  for (const portal of ['admin', 'team'] as const) {
    if (pathname === workerUrl(portal)) return portal;
  }
  return null;
}

/** The worker asking a page to show a place — a tapped notification. Anything else a worker posts is not for the app. */
export interface WorkerMessage {
  ml: 'sw';
  v: 1;
  type: 'open';
  /** an address on this origin */
  url: string;
}

export function parseWorkerMessage(data: unknown): WorkerMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m['ml'] !== 'sw' || m['v'] !== 1 || m['type'] !== 'open') return null;
  return typeof m['url'] === 'string' ? { ml: 'sw', v: 1, type: 'open', url: m['url'] } : null;
}
