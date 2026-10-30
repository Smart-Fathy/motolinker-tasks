import {
  BOTTOM_NAV,
  GROUPS,
  NAV,
  presentation,
  screenIdFromLegacy,
  screenOf,
} from '@motolinker/contracts/modules';
import type { Portal } from '../lib/env';
import type { Access } from './access';

export interface RailItem {
  /** the screen */
  id: string;
  label: string;
  icon: string;
}

export interface RailGroup {
  id: string;
  label: string;
  items: RailItem[];
}

/** The sidebar arrangement an admin saves (Arrange sections): one for the whole workspace, read by both portals. */
export interface NavConfig {
  groups?: {
    key?: string;
    label?: string;
    hidden?: boolean;
    items?: { id?: string; label?: string; hidden?: boolean }[];
  }[];
}

const classicId = (itemId: string) => itemId.replace(/^nav-/, '');

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * What the server kept as the arrangement, read as what it can be: anything that is not the shape it should be is left out
 * rather than trusted (a saved arrangement is JSON an older version, or a person, wrote). Nothing here can fail; the worst
 * a bad one does is nothing.
 */
export function readNavConfig(raw: unknown): NavConfig {
  if (!isObject(raw) || !Array.isArray(raw['groups'])) return {};
  const groups = raw['groups'].filter(isObject).map(g => {
    const group: NonNullable<NavConfig['groups']>[number] = { hidden: g['hidden'] === true };
    const key = text(g['key']);
    const label = text(g['label']);
    if (key) group.key = key;
    if (label) group.label = label;
    group.items = (Array.isArray(g['items']) ? g['items'] : []).filter(isObject).map(i => {
      const item: { id?: string; label?: string; hidden?: boolean } = {
        hidden: i['hidden'] === true,
      };
      const id = text(i['id']);
      const itemLabel = text(i['label']);
      if (id) item.id = id;
      if (itemLabel) item.label = itemLabel;
      return item;
    });
    return group;
  });
  return { groups };
}

/**
 * The screen a saved arrangement means by an item. It names classic page ids, and the arrangement is shared: the admin saves
 * 'nav-customers' and 'nav-rfqs', which the team portal calls 'leads' and 'rfq'. So an id is read in either portal's words.
 */
function screenOfConfigId(itemId: string): string | null {
  const id = classicId(itemId);
  return screenIdFromLegacy(id, 'admin') ?? screenIdFromLegacy(id, 'team');
}

/**
 * The rail this person sees: the portal's sections and screens as shipped, arranged as the admin arranged them, with only
 * the screens this person may open.
 *
 * The arrangement is applied as the classic portals apply it (public/assets/dashboard.js and employee.js, applyNavConfig):
 * it renames sections and screens, moves screens between sections as well as within them, and hides. A screen the
 * arrangement does not know (one that shipped after it was saved) goes to the end of its section; a section it does not
 * know goes after the ones it does. What it may never do is let a person open what they may not: it only takes away.
 * A section with nothing left in it is not drawn.
 */
export function buildRail(portal: Portal, access: Access, config?: NavConfig | null): RailGroup[] {
  interface Draft extends RailGroup {
    hidden: boolean;
  }
  const groups: Draft[] = NAV[portal].map(g => ({
    id: g.group,
    label: GROUPS.find(x => x.id === g.group)?.label ?? g.group,
    hidden: false,
    items: g.items.map(id => {
      const s = screenOf(id);
      const p = s ? presentation(s, portal) : { label: id, icon: id };
      return { id, label: p.label, icon: p.icon };
    }),
  }));
  const hiddenItems = new Set<string>();
  const byKey = new Map(groups.map(g => [g.id, g]));
  const everyItem = new Map(groups.flatMap(g => g.items).map(i => [i.id, i]));
  let order = [...groups];
  const toEnd = <T>(list: T[], x: T): T[] => [...list.filter(y => y !== x), x];

  const placedGroups = new Set<string>();
  for (const cg of config?.groups ?? []) {
    const g = cg.key ? byKey.get(cg.key) : undefined;
    if (!g) continue; // a section this portal does not have
    placedGroups.add(g.id);
    if (cg.label) g.label = cg.label;
    if (cg.hidden === true) g.hidden = true;
    order = toEnd(order, g);
    const placed = new Set<string>();
    for (const ci of cg.items ?? []) {
      const sid = ci.id ? screenOfConfigId(ci.id) : null;
      const item = sid ? everyItem.get(sid) : undefined;
      if (!item) continue; // a screen this portal does not have
      if (ci.label) item.label = ci.label;
      if (ci.hidden === true) hiddenItems.add(item.id);
      for (const other of groups) other.items = other.items.filter(i => i !== item);
      g.items.push(item);
      placed.add(item.id);
    }
    // New entries join the list; they do not jump the queue.
    if (placed.size)
      g.items = [
        ...g.items.filter(i => placed.has(i.id)),
        ...g.items.filter(i => !placed.has(i.id)),
      ];
  }
  for (const g of [...order]) if (!placedGroups.has(g.id)) order = toEnd(order, g);

  return order
    .filter(g => !g.hidden)
    .map(g => ({
      id: g.id,
      label: g.label,
      items: g.items.filter(i => access.allows(i.id) && !hiddenItems.has(i.id)),
    }))
    .filter(g => g.items.length > 0);
}

/** The quick tabs along the bottom of a phone: the same four, each only where this person may open it. */
export function buildBottomNav(portal: Portal, access: Access): RailItem[] {
  return BOTTOM_NAV[portal]
    .filter(b => access.allows(b.id))
    .map(b => ({ id: b.id, label: b.label, icon: b.icon }));
}
