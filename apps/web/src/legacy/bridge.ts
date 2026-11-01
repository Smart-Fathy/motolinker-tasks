// The conversation between the app and a classic page it shows in a frame. The other side is public/assets/embed.js,
// which the server loads into a page asked for as /legacy/<portal>?embed=1; tests/embed.js and tests/webframe.js hold the
// two to each other. Every message is a plain object: { ml: 'embed', v: 1, type, ...fields }.
import { classicUrl, type Portal } from '../lib/env';

export const PROTOCOL = 'embed';
export const VERSION = 1;

/** A record the page says is open: what kind it is, which one, and what it is called (a lead's profile, a supplier's page). */
export interface FrameRecord {
  kind: string;
  id: string;
  title: string;
  sub: string;
}

/** What the page says is chosen on it: the tab, the words in the search box, the filters, the rows that are ticked. */
export interface FrameScreen {
  tab?: string;
  search?: string;
  filters?: Record<string, string>;
  selected?: { kind: string; id: string; title: string }[];
}

/** What the page tells the app. */
export type FromFrame =
  | { type: 'ready'; page: string }
  /** `lead`: a lead's page sent the person to `page` to make a document for that lead */
  | { type: 'navigated'; page: string; lead?: number }
  | { type: 'unauthorized' }
  /** the record open on the page changed (null: none is open any more) */
  | { type: 'record'; record: FrameRecord | null }
  /** the answer to a `screen` question, by its number (null: the page could not say) */
  | { type: 'screen'; id: number; screen: FrameScreen | null }
  /** the assistant's key (Ctrl/⌘+K) was pressed in the page, whose frame the app's own listener does not hear */
  | { type: 'ask' };

/** What the app tells the page. */
export type ToFrame =
  | { type: 'navigate'; page: string }
  | { type: 'look'; profile: object }
  /** something changed that the page shows, and it should read it again (a task was assigned; or, 'page', whatever is on show) */
  | { type: 'refresh'; what: 'tasks' | 'page' }
  /** what is open and chosen on the page? `id` pairs the answer with the question; `section` is the assistant's word for the page */
  | { type: 'screen'; id: number; section: string };

// A page of the classic portals is named by a few lowercase letters ('customers', 'purchaseorders').
const PAGE = /^[a-z]{2,20}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Words from the page, on one line and no longer than the server keeps them; nothing for a thing that is not words. */
function words(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const out = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return out === '' ? undefined : out;
}

/** The kinds of record the assistant knows are lowercase words with underscores ('lead', 'purchase_order'). */
const KIND = /^[a-z][a-z_]{0,23}$/;

function parseRecord(v: unknown): FrameRecord | null {
  if (!isObject(v)) return null;
  const kind = v['kind'];
  const id = typeof v['id'] === 'number' ? String(v['id']) : v['id'];
  if (typeof kind !== 'string' || !KIND.test(kind)) return null;
  if (typeof id !== 'string' || id.length < 1 || id.length > 40) return null;
  return { kind, id, title: words(v['title'], 120) ?? '', sub: words(v['sub'], 120) ?? '' };
}

/** What the page says is chosen on it: each thing it says well is kept, each it does not is left out. */
function parseScreen(v: unknown): FrameScreen | null {
  if (!isObject(v)) return null;
  const out: FrameScreen = {};
  const tab = words(v['tab'], 40);
  if (tab) out.tab = tab;
  const search = words(v['search'], 80);
  if (search) out.search = search;
  if (isObject(v['filters'])) {
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(v['filters']).slice(0, 8)) {
      const k = words(key, 40);
      const w = words(value, 120);
      if (k && w) filters[k] = w;
    }
    if (Object.keys(filters).length) out.filters = filters;
  }
  if (Array.isArray(v['selected'])) {
    const selected: NonNullable<FrameScreen['selected']> = [];
    for (const row of v['selected'].slice(0, 10)) {
      if (!isObject(row)) continue;
      const kind = row['kind'];
      const id = typeof row['id'] === 'number' ? String(row['id']) : row['id'];
      if (typeof kind !== 'string' || !KIND.test(kind) || typeof id !== 'string' || !id) continue;
      selected.push({ kind, id: id.slice(0, 40), title: words(row['title'], 60) ?? '' });
    }
    if (selected.length) out.selected = selected;
  }
  return out;
}

/** A message from the frame, or null for anything that is not one: another protocol, another version, a page that cannot exist. */
export function parseFromFrame(data: unknown): FromFrame | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m['ml'] !== PROTOCOL || m['v'] !== VERSION) return null;
  if (m['type'] === 'unauthorized') return { type: 'unauthorized' };
  if (m['type'] === 'ask') return { type: 'ask' };
  if (m['type'] === 'record') {
    if (m['record'] === null) return { type: 'record', record: null };
    const record = parseRecord(m['record']);
    return record ? { type: 'record', record } : null;
  }
  if (m['type'] === 'screen') {
    const id = m['id'];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null;
    return { type: 'screen', id, screen: m['screen'] === null ? null : parseScreen(m['screen']) };
  }
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
