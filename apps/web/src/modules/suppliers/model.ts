// What the Suppliers screen deals in: the answers of the server and the checks that tell one from nonsense, and the small things
// the classic page (public/assets/procurement.js) worked out for itself — the figures on a card, the line above the register, the
// view it remembers. The shapes are packages/contracts' (schemas.js); the checks are written by hand because the bundle does not
// carry zod, and model.test.ts holds each one to its schema.
import { tupleColumns, type Column } from '../../columns';
import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';

export type Supplier = z.infer<typeof schemas.Supplier>;
export type Vehicle = z.infer<typeof schemas.SupplierVehicle>;
export type Offer = z.infer<typeof schemas.SupplierOffer>;
export type SupplierDoc = z.infer<typeof schemas.SupplierDoc>;
export type Purchases = z.infer<typeof schemas.SupplierPurchases>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isTextOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isTextOrMissing = (v: unknown): boolean => v === undefined || isTextOrNull(v);
const isNumberOrNull = (v: unknown): boolean => v === null || typeof v === 'number';
const isFields = (v: unknown): boolean => v === undefined || v === null || isObject(v);

export function isSupplier(v: unknown): v is Supplier {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    typeof v['name'] === 'string' &&
    isTextOrNull(v['contact']) &&
    isTextOrNull(v['address']) &&
    isTextOrNull(v['country']) &&
    isTextOrNull(v['notes']) &&
    isFields(v['custom_fields']) &&
    isTextOrMissing(v['created_by']) &&
    isTextOrMissing(v['created_at']) &&
    isTextOrMissing(v['updated_at'])
  );
}
export const isSupplierList = (v: unknown): v is Supplier[] =>
  Array.isArray(v) && v.every(isSupplier);

export function isVehicle(v: unknown): v is Vehicle {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    Number.isInteger(v['supplier_id']) &&
    typeof v['brand'] === 'string' &&
    typeof v['model'] === 'string' &&
    isTextOrNull(v['trim']) &&
    (v['model_year'] === null || Number.isInteger(v['model_year'])) &&
    isTextOrNull(v['availability']) &&
    isNumberOrNull(v['fob_price']) &&
    typeof v['currency'] === 'string' &&
    isTextOrNull(v['lead_time']) &&
    isTextOrNull(v['accessories']) &&
    isTextOrNull(v['notes']) &&
    isFields(v['custom_fields']) &&
    isTextOrMissing(v['created_by']) &&
    isTextOrMissing(v['created_at']) &&
    isTextOrMissing(v['updated_at'])
  );
}
export const isVehicleList = (v: unknown): v is Vehicle[] => Array.isArray(v) && v.every(isVehicle);

export const isOffer = (v: unknown): v is Offer =>
  isVehicle(v) && typeof (v as unknown as Record<string, unknown>)['supplier_name'] === 'string';
export const isOfferList = (v: unknown): v is Offer[] => Array.isArray(v) && v.every(isOffer);

export function isSupplierDoc(v: unknown): v is SupplierDoc {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    Number.isInteger(v['supplier_id']) &&
    typeof v['name'] === 'string' &&
    isTextOrNull(v['drive_file_id']) &&
    isTextOrNull(v['web_link']) &&
    isTextOrNull(v['mime_type']) &&
    isNumberOrNull(v['size_bytes']) &&
    isTextOrMissing(v['uploaded_by']) &&
    isTextOrMissing(v['created_at'])
  );
}
export const isDocList = (v: unknown): v is SupplierDoc[] =>
  Array.isArray(v) && v.every(isSupplierDoc);

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isPurchases(v: unknown): v is Purchases {
  if (!isObject(v)) return false;
  const { units, poLines, totals } = v;
  if (!Array.isArray(units) || !Array.isArray(poLines) || !isObject(totals)) return false;
  return (
    units.every(
      u =>
        isObject(u) &&
        Number.isInteger(u['stock_id']) &&
        isTextOrNull(u['make']) &&
        isTextOrNull(u['model']) &&
        isTextOrNull(u['trim']) &&
        typeof u['vin'] === 'string' &&
        typeof u['colour'] === 'string' &&
        typeof u['status'] === 'string' &&
        isCount(u['price']),
    ) &&
    poLines.every(
      l =>
        isObject(l) &&
        Number.isInteger(l['po_id']) &&
        isTextOrNull(l['po_number']) &&
        isTextOrNull(l['po_date']) &&
        isTextOrNull(l['currency']) &&
        typeof l['brand'] === 'string' &&
        typeof l['model'] === 'string' &&
        typeof l['trim'] === 'string' &&
        isCount(l['qty']) &&
        isCount(l['price']) &&
        typeof l['lead_time'] === 'string',
    ) &&
    Number.isInteger(totals['vehicles']) &&
    isCount(totals['ordered']) &&
    isCount(totals['avg_unit_price']) &&
    isCount(totals['avg_po_price']) &&
    Array.isArray(totals['lead_times']) &&
    totals['lead_times'].every(t => typeof t === 'string')
  );
}

// ── The register's columns ──────────────────────────────────────────────────────────────────────────────────────────────────

/** What the register has before anybody arranges it: the five fields of a supplier. */
export const SUPPLIER_COLUMNS: readonly Column[] = tupleColumns([
  ['name', 'Name', 140],
  ['contact', 'Contact', 120],
  ['country', 'Country', 90],
  ['address', 'Address', 160],
  ['notes', 'Notes', 160],
]);

/** …and what a supplier's catalogue has: the eight fields of a vehicle offered. */
export const VEHICLE_COLUMNS: readonly Column[] = tupleColumns(
  [
    ['brand', 'Brand', 110],
    ['model', 'Model', 110],
    ['trim', 'Trim', 100],
    ['model_year', 'Year', 70],
    ['availability', 'Availability', 120],
    ['fob_price', 'FOB price', 100],
    ['lead_time', 'Lead time', 110],
    ['accessories', 'Accessories', 160],
  ],
  { model_year: 'number', fob_price: 'number' },
);

// ── What a card shows ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Two letters for a supplier's avatar. */
export const initials = (name: string | null | undefined): string =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase() || '?';

/** A value in the thousands, as the card writes it: 1.5M, 320K, or a dash for nothing. */
export function shortEgp(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return Math.round(v / 1e3) + 'K';
  return v ? String(v) : '—';
}

/** The figures the cards are made of, which belong to other sections (a person may hold Suppliers without Inventory). */
export interface Stats {
  /** units in the register, and what they are worth, by the supplier's name (lower-cased) */
  units: ReadonlyMap<string, number>;
  value: ReadonlyMap<string, number>;
  /** vehicles in the catalogue, by the supplier's id */
  catalogue: ReadonlyMap<number, number>;
  totalUnits: number;
  totalCatalogue: number;
  /** each is false where the server would not say (the section is not the person's): no figure, not a confident zero */
  haveStock: boolean;
  haveCatalogue: boolean;
}

/**
 * The figures from what the two other lists said. A list that could not be had (`null`) is no figure at all. Units record their
 * supplier as a name and the catalogue by id, so the join with the register is by name — the only key the units and the register
 * share.
 */
export function statsOf(offers: unknown, stock: unknown): Stats {
  const units = new Map<string, number>();
  const value = new Map<string, number>();
  const catalogue = new Map<number, number>();
  if (Array.isArray(offers)) {
    for (const v of offers) {
      if (!isObject(v) || typeof v['supplier_id'] !== 'number') continue;
      catalogue.set(v['supplier_id'], (catalogue.get(v['supplier_id']) ?? 0) + 1);
    }
  }
  if (Array.isArray(stock)) {
    for (const m of stock) {
      if (!isObject(m)) continue;
      const list = Array.isArray(m['units']) ? m['units'] : [];
      for (const u of list) {
        if (!isObject(u)) continue;
        const key = String(u['supplier'] || m['supplier'] || '')
          .trim()
          .toLowerCase();
        if (!key) continue;
        units.set(key, (units.get(key) ?? 0) + 1);
        value.set(
          key,
          (value.get(key) ?? 0) + (Number(u['price_list']) || Number(m['price']) || 0),
        );
      }
    }
  }
  const sum = (m: ReadonlyMap<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return {
    units,
    value,
    catalogue,
    totalUnits: sum(units),
    totalCatalogue: sum(catalogue),
    haveStock: Array.isArray(stock),
    haveCatalogue: Array.isArray(offers),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The line above the register: how many suppliers, and — where the person may know them — the units and the catalogue. */
export function countLine(n: number, s: Stats): string {
  return (
    plural(n, 'supplier') +
    (s.haveStock ? ` · ${plural(s.totalUnits, 'unit')} in the register` : '') +
    (s.haveCatalogue ? ` · ${plural(s.totalCatalogue, 'catalogue vehicle')}` : '')
  );
}

/** One card's three figures. */
export function cardFigures(x: Pick<Supplier, 'id' | 'name'>, s: Stats) {
  const key = String(x.name || '')
    .trim()
    .toLowerCase();
  return {
    units: s.units.get(key) ?? 0,
    value: s.value.get(key) ?? 0,
    catalogue: s.catalogue.get(x.id) ?? 0,
  };
}

// ── The view it remembers ───────────────────────────────────────────────────────────────────────────────────────────────────

export type View = 'cards' | 'table';
/** Where the classic page keeps which view the register was left in (cards, until somebody chooses the table). */
export const VIEW_KEY = 'ml_sup_view';

export function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}
export function saveView(v: View): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* (a browser that will not keep it: the view is not remembered) */
  }
}

// ── In a supplier's pages ───────────────────────────────────────────────────────────────────────────────────────────────────

export type Tab = 'vehicles' | 'docs' | 'purchases';

/** A file's size as the documents list says it (at least a kilobyte; nothing for nothing). */
export const kb = (n: number | null | undefined): string =>
  n ? Math.max(1, Math.round(n / 1024)) + ' KB' : '';

/** A figure with its thousands separated, in this browser's own way. */
export const money = (n: unknown): string => (Number(n) || 0).toLocaleString();

/** A vehicle by its words: make, model and trim, whichever there are. */
export const carOf = (c: {
  make?: string | null;
  brand?: string | null;
  model?: string | null;
  trim?: string | null;
}): string => [c.make ?? c.brand, c.model, c.trim].filter(Boolean).join(' ');

/** The icons the screen draws (lucide's names; the shell's table holds them). */
export const SUPPLIER_ICONS = {
  add: 'plus',
  cards: 'layout-grid',
  table: 'table',
  edit: 'pencil',
  remove: 'trash-2',
  upload: 'upload',
  file: 'file-text',
  gone: 'x',
} as const;
