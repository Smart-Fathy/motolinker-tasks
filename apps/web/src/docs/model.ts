// What the document screens (RFQs, purchase orders; contracts and quotations next) deal in: the answers of the server and the checks
// that tell one from nonsense, the columns a document and its lines start with, and the small things the classic page
// (public/assets/procurement.js) worked out for itself — a purchase order's total, which lines count, the title a document is
// saved under. The shapes are packages/contracts' (schemas.js, documents.js); the checks are written by hand because the bundle
// does not carry zod, and model.test.ts holds each one to its schema.
import {
  DOC_STATUS_COLORS,
  PO_LINE_FIELDS,
  PO_LINE_NUMBERS,
  PO_LINE_STATUSES,
  RFQ_LINE_FIELDS,
  RFQ_LINE_NUMBERS,
} from '@motolinker/contracts/documents';
import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';
import { isTicked, tupleColumns, type Column, type ColumnType } from '../columns';

export { PO_STATUSES, RFQ_STATUSES } from '@motolinker/contracts/documents';

export type Rfq = z.infer<typeof schemas.Rfq>;
export type RfqRow = z.infer<typeof schemas.RfqRow>;
export type RfqDefaults = z.infer<typeof schemas.RfqDefaults>;
export type Po = z.infer<typeof schemas.Po>;
export type PoRow = z.infer<typeof schemas.PoRow>;
export type PoDefaults = z.infer<typeof schemas.PoDefaults>;
export type LeadOption = z.infer<typeof schemas.LeadOption>;
/** A line of a document: the fields its kind of line has, and whatever the administrator added alongside. */
export type Line = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isTextOrMissing = (v: unknown): boolean => v === undefined || isTextOrNull(v);
const isIdOrNull = (v: unknown): boolean => v === null || Number.isInteger(v);
const isIdOrMissing = (v: unknown): boolean => v === undefined || isIdOrNull(v);
const isFields = (v: unknown): boolean => v === undefined || v === null || isObject(v);
const isLines = (v: unknown): v is Line[] => Array.isArray(v) && v.every(isObject);

function isRfqRow(v: unknown): v is RfqRow {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    isText(v['rfq_no']) &&
    isText(v['title']) &&
    isTextOrNull(v['supplier_name']) &&
    isTextOrNull(v['issuer']) &&
    isTextOrNull(v['rfq_date']) &&
    isText(v['status']) &&
    isIdOrNull(v['customer_id']) &&
    isLines(v['items']) &&
    isTextOrNull(v['created_by']) &&
    isTextOrNull(v['created_at'])
  );
}
export const isRfqList = (v: unknown): v is RfqRow[] => Array.isArray(v) && v.every(isRfqRow);

export function isRfq(v: unknown): v is Rfq {
  if (!isRfqRow(v)) return false;
  const o = v as unknown as Record<string, unknown>;
  return (
    isIdOrNull(o['supplier_id']) &&
    isTextOrNull(o['supplier_contact']) &&
    isTextOrNull(o['supplier_address']) &&
    isTextOrNull(o['supplier_country']) &&
    isTextOrNull(o['payment_terms']) &&
    isTextOrNull(o['delivery_location']) &&
    isTextOrNull(o['service_provider']) &&
    isTextOrNull(o['contact']) &&
    isTextOrNull(o['documents_required']) &&
    isFields(o['custom_fields']) &&
    isTextOrMissing(o['updated_at'])
  );
}

export const isRfqDefaults = (v: unknown): v is RfqDefaults =>
  isObject(v) &&
  isText(v['rfq_no']) &&
  isText(v['rfq_date']) &&
  isLines(v['items']) &&
  isText(v['payment_terms']) &&
  isText(v['documents_required']) &&
  isIdOrNull(v['customer_id']);

function isPoRow(v: unknown): v is PoRow {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    isText(v['po_number']) &&
    isText(v['title']) &&
    isTextOrNull(v['supplier']) &&
    isTextOrNull(v['po_date']) &&
    isText(v['currency']) &&
    isText(v['status']) &&
    isIdOrNull(v['customer_id']) &&
    isLines(v['items']) &&
    isTextOrNull(v['created_by']) &&
    isTextOrNull(v['created_at'])
  );
}
export const isPoList = (v: unknown): v is PoRow[] => Array.isArray(v) && v.every(isPoRow);

export function isPo(v: unknown): v is Po {
  if (!isPoRow(v)) return false;
  const o = v as unknown as Record<string, unknown>;
  return (
    isTextOrNull(o['notes']) &&
    isIdOrMissing(o['supplier_id']) &&
    [
      'supplier_contact',
      'supplier_address',
      'supplier_country',
      'issuer',
      'quote_id',
      'incoterm',
    ].every(k => isTextOrMissing(o[k])) &&
    [
      'delivery_location',
      'service_provider',
      'contact',
      'documents_required',
      'payment_terms',
    ].every(k => isTextOrMissing(o[k])) &&
    isFields(o['custom_fields']) &&
    isTextOrMissing(o['updated_at'])
  );
}

export const isPoDefaults = (v: unknown): v is PoDefaults =>
  isObject(v) &&
  isText(v['po_number']) &&
  isText(v['po_date']) &&
  isText(v['currency']) &&
  isLines(v['items']) &&
  isIdOrNull(v['customer_id']);

export const isXlsx = (v: unknown): v is { xlsx: string; name: string } =>
  isObject(v) && isText(v['xlsx']) && isText(v['name']);
export const isPdf = (v: unknown): v is { pdf: string; name?: string } =>
  isObject(v) && isText(v['pdf']) && (v['name'] === undefined || isText(v['name']));

export const isLeadList = (v: unknown): v is LeadOption[] =>
  Array.isArray(v) &&
  v.every(
    l =>
      isObject(l) &&
      Number.isInteger(l['id']) &&
      isTextOrNull(l['name']) &&
      isTextOrMissing(l['phone']),
  );

// ── The columns ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_COLUMN = (pairs: readonly (readonly [string, string])[]): Column => ({
  key: 'status',
  label: 'Status',
  type: 'select',
  builtin: true,
  visible: true,
  options: pairs.map(([key, label]) => {
    const color = (DOC_STATUS_COLORS as Record<string, string>)[key];
    return { key, label, ...(color ? { color } : {}) };
  }),
});

/** A document's own Status is a column too (the administrator renames, recolours and adds its options, and adds fields beside it). */
export const docStatusColumn = STATUS_COLUMN;

const numbers = (keys: readonly string[]): Record<string, ColumnType> =>
  Object.fromEntries(keys.map(k => [k, 'number' as const]));

/** What an RFQ's lines start with. */
export const RFQ_LINE_COLUMNS: readonly Column[] = tupleColumns(
  RFQ_LINE_FIELDS,
  numbers(RFQ_LINE_NUMBERS),
);

/** …and a purchase order's: its Status is a dropdown of where the line is in its journey. */
export const PO_LINE_COLUMNS: readonly Column[] = tupleColumns(PO_LINE_FIELDS, {
  ...numbers(PO_LINE_NUMBERS),
  status: 'select',
}).map(c =>
  c.key === 'status'
    ? { ...c, options: PO_LINE_STATUSES.map(s => ({ key: s.key, label: s.label, color: s.fg })) }
    : c,
);

// ── Lines ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a line is worth: its price for each of its units (one, where it says none). */
export const lineTotal = (lines: readonly Line[]): number =>
  lines.reduce((sum, l) => sum + (Number(l['pi_price']) || 0) * (Number(l['units']) || 1), 0);

/** A figure with its thousands separated, in this browser's own way. */
export const thousands = (n: unknown): string => (Number(n) || 0).toLocaleString();

/** A line of an RFQ counts when it names a vehicle; the server drops one that does not. */
export const rfqLineFilled = (l: Line): boolean => !!(l['brand'] || l['model'] || l['trim']);
/** …and a purchase order's when it names a client, a vehicle or a VIN. */
export const poLineFilled = (l: Line): boolean =>
  !!(l['client'] || l['brand'] || l['model'] || l['vin']);

/** The value a grid cell starts with for this column (a checkbox is ticked or not; anything else is its text). */
export function cellOf(line: Line, col: Column): string | boolean {
  const raw = line[col.key];
  if (col.type === 'checkbox') return isTicked(raw);
  return raw == null ? '' : String(raw);
}

/**
 * The lines a form saves: each is what the line was, with what the grid shows put over it. A column the administrator has hidden
 * is not on the grid, but its words are still the line's — editing a line does not empty them.
 */
export function savedLines(
  was: readonly Line[],
  edited: readonly Record<string, string | boolean>[],
): Line[] {
  return edited.map((values, i) => ({ ...(was[i] ?? {}), ...values }));
}

/** The title a document is saved under: who it goes to and how many vehicles it asks for. */
export const titleOf = (who: string, fallback: string, filled: number): string =>
  `${who || fallback} — ${filled} vehicle(s)`;

/** A name that is safe to give a file. */
export const fileName = (name: string): string => name.replace(/[^\w.-]+/g, '_');

/** A date as the lists write it: the document's own, else the day it was made. */
export function whenOf(date: string | null, createdAt: string | null): string {
  if (date) return date;
  if (!createdAt) return '';
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** The icons the document screens draw (lucide's names; the shell's table holds them). */
export const DOC_ICONS = {
  add: 'plus',
  file: 'file-text',
  download: 'download',
  catalogue: 'list-plus',
} as const;
