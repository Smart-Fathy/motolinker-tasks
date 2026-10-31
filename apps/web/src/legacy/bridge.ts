// The conversation between the app and a classic page it shows in a frame. The other side is public/assets/embed.js,
// which the server loads into a page asked for as /legacy/<portal>?embed=1; tests/embed.js and tests/webframe.js hold the
// two to each other. Every message is a plain object: { ml: 'embed', v: 1, type, ...fields }.
import { classicUrl, type Portal } from '../lib/env';

export const PROTOCOL = 'embed';
export const VERSION = 1;

/** What the page tells the app. */
export type FromFrame =
  | { type: 'ready'; page: string }
  /** `lead`: a lead's page sent the person to `page` to make a document for that lead */
  | { type: 'navigated'; page: string; lead?: number }
  | { type: 'unauthorized' };

/** What the app tells the page. */
export type ToFrame =
  | { type: 'navigate'; page: string }
  | { type: 'look'; profile: object }
  /** something changed that the page shows, and it should read it again (a task was assigned) */
  | { type: 'refresh'; what: 'tasks' };

// A page of the classic portals is named by a few lowercase letters ('customers', 'purchaseorders').
const PAGE = /^[a-z]{2,20}$/;

/** A message from the frame, or null for anything that is not one: another protocol, another version, a page that cannot exist. */
export function parseFromFrame(data: unknown): FromFrame | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m['ml'] !== PROTOCOL || m['v'] !== VERSION) return null;
  if (m['type'] === 'unauthorized') return { type: 'unauthorized' };
  if (m['type'] !== 'ready' && m['type'] !== 'navigated') return null;
  const page = m['page'];
  if (typeof page !== 'string' || !PAGE.test(page)) return null;
  if (m['type'] === 'ready') return { type: 'ready', page };
  // (a lead that is not a whole number above nought is none: the move still counts, the document is not made for anybody)
  const lead = m['lead'];
  return typeof lead === 'number' && Number.isInteger(lead) && lead > 0
    ? { type: 'navigated', page, lead }
    : { type: 'navigated', page };
}

export const toFrame = (message: ToFrame): Record<string, unknown> => ({
  ml: PROTOCOL,
  v: VERSION,
  ...message,
});

/** The classic page, as the frame shows it: without its own chrome, on that page, in safe mode if the app is. */
export const frameUrl = (portal: Portal, page: string, safe: boolean): string =>
  `${classicUrl(portal)}?embed=1${safe ? '&safe=1' : ''}#${page}`;
