// What a notification is to the app, and the small rules the bell and the Notification Center share: how a row from the
// server is recognised, how a title and a time are worded, what icon a type has and where a click on one goes. The classic
// portals each carry these in their own script; the two copies differed only in the two maps at the end, which are kept as
// they were (src/modules/notifications is the server's side of the same thing).
import { screenIdFromLegacy } from '@motolinker/contracts/modules';
import type { Portal } from '../../lib/env';

/** What /api/v1/notifications lists: the schema is packages/contracts' `Notification`, and model.test.ts holds these guards to it. */
export interface Notification {
  id: number | string;
  type: string;
  title: string;
  body: string;
  url: string;
  read: boolean;
  created_at: string;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
}

/** How many the server lists, and so how many the app keeps. */
export const KEEP = 50;
/** How many the bell's panel shows (the Notification Center shows all of them). */
export const PANEL_SHOWS = 20;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number | string =>
  (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && v.length > 0);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function isNotification(v: unknown): v is Notification {
  return (
    isObject(v) &&
    isId(v['id']) &&
    typeof v['type'] === 'string' &&
    typeof v['title'] === 'string' &&
    typeof v['body'] === 'string' &&
    typeof v['url'] === 'string' &&
    typeof v['read'] === 'boolean' &&
    typeof v['created_at'] === 'string'
  );
}

export function isNotificationList(v: unknown): v is NotificationList {
  return (
    isObject(v) &&
    Array.isArray(v['items']) &&
    v['items'].every(isNotification) &&
    typeof v['unread'] === 'number' &&
    Number.isInteger(v['unread']) &&
    v['unread'] >= 0
  );
}

/**
 * A row off the live stream. The stream carries the row as it was stored (an owner beside the rest, and no `read` where the
 * database filled it in), or, when it could not be stored, one with an id of "tmp-…": read the same way as the server reads
 * a stored one, so what comes out is always a Notification. Anything that is not a row with an id and a title is nothing.
 */
export function fromStream(raw: unknown): Notification | null {
  if (!isObject(raw) || !isId(raw['id']) || typeof raw['title'] !== 'string') return null;
  return {
    id: raw['id'],
    type: text(raw['type']) || 'general',
    title: raw['title'],
    body: text(raw['body']),
    url: text(raw['url']),
    read: raw['read'] === true,
    created_at: text(raw['created_at']) || new Date().toISOString(),
  };
}

export const sameId = (a: number | string, b: number | string): boolean => String(a) === String(b);

export const countUnread = (items: readonly Notification[]): number =>
  items.reduce((n, item) => n + (item.read ? 0 : 1), 0);

/** A new one at the head, the oldest dropped past the limit; one that is already there is not added twice. */
export function withLive(items: readonly Notification[], added: Notification): Notification[] {
  if (items.some(n => sameId(n.id, added.id))) return [...items];
  return [added, ...items].slice(0, KEEP);
}

export function withRead(items: readonly Notification[], id: number | string): Notification[] {
  return items.map(n => (sameId(n.id, id) && !n.read ? { ...n, read: true } : n));
}

export const withAllRead = (items: readonly Notification[]): Notification[] =>
  items.map(n => (n.read ? n : { ...n, read: true }));

/** "3" for 3, "99+" for anything over 99 (the badges). */
export const badgeText = (unread: number): string => (unread > 99 ? '99+' : String(unread));

/** What the toast says of a live one. */
export const toastText = (n: Notification): string => `${n.title}${n.body ? ' · ' + n.body : ''}`;

/** Leading emoji and symbols are dropped, so notifications stored with one read clean (the ones written now carry none). */
export function cleanTitle(title: string): string {
  return title.replace(/^[^\p{L}\p{N}]+/u, '').trim() || title;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = (now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}

/** The icon of each type of notification; one without a type of its own gets the bell. */
export const TYPE_ICONS: Readonly<Record<string, string>> = {
  task: 'clipboard-list',
  reminder: 'alarm-clock',
  hours: 'clock',
  lead: 'contact-2',
  deal: 'kanban-square',
  request: 'inbox',
  issue: 'bug',
  followup: 'alarm-clock',
  huddle: 'headphones',
  security: 'shield-alert',
};
export const iconOf = (type: string): string =>
  Object.hasOwn(TYPE_ICONS, type) ? (TYPE_ICONS[type] ?? 'bell') : 'bell';

// Where a notification of a type goes when its link names no page. The portals chose differently, and still do.
const ADMIN_PAGE_BY_TYPE: Readonly<Record<string, string>> = {
  request: 'requests',
  task: 'tasks',
  hours: 'hours',
  quotation: 'quotation',
  lead: 'customers',
  deal: 'deals',
  followup: 'customers',
};
const TEAM_PAGE_BY_TYPE: Readonly<Record<string, string>> = {
  hours: 'hours',
  task: 'tasks',
  reminder: 'tasks',
  lead: 'quotation',
  deal: 'deals',
  request: 'requests',
  followup: 'leads',
};

/**
 * Where a click on a notification goes, as a path in the app, or null for nowhere. The page the link names comes first (a
 * '#<page>' that is a page of this portal, '#security' being the Security screen), then the type's page. A type that has none
 * leaves the admin where they are and takes a team member to their hours, as the portals do.
 */
export function routeOf(portal: Portal, url: string, type: string): string | null {
  const hash = url.split('#')[1];
  const linked = hash ? screenIdFromLegacy(hash, portal) : null;
  if (linked) return '/' + linked;
  // (a type that is the name of something every object has — 'constructor' — finds no screen either)
  const page = (portal === 'team' ? TEAM_PAGE_BY_TYPE : ADMIN_PAGE_BY_TYPE)[type];
  const typed = page ? screenIdFromLegacy(page, portal) : null;
  if (typed) return '/' + typed;
  return portal === 'team' ? '/hours' : null;
}

/** The link a notification carries; the team portal's rows without one point at the portal itself. */
export const urlOf = (portal: Portal, n: Notification): string =>
  n.url || (portal === 'team' ? '/employee' : '');
