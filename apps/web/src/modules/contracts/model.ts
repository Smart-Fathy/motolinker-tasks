// What the contract form works out for itself: where a blank of the paper form lives in the contract's data (a dotted path, as the
// classic editor named them), what each field starts with, what the payment lines are, what the contract's data is once the form
// is done with it, and what picking a lead puts into the buyer's block. Pure functions: the form holds the state, these decide.
// (public/assets/procurement.js — ctField, ctGet, ctSet, ctCollect, ctPopulateLeadPicker — is where each of them was written first.)
import {
  CONTRACT_PAYMENT_WHEN,
  CONTRACT_SALE_TEMPLATE,
  CONTRACT_SECTIONS,
  type ContractField,
} from '@motolinker/contracts/documents';
import type { ContractRow } from '../../docs/model';

/** What a contract holds: the blanks of the paper form by their dotted paths, and whatever else was put there. */
export type Data = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A value as the form shows it. */
export const textOf = (v: unknown): string => (v == null ? '' : String(v));

/** The value at a dotted path of the contract's data ('buyer.name'), if it is there. */
export function getPath(data: unknown, path: string): unknown {
  let at: unknown = data;
  for (const key of path.split('.')) {
    if (!isObject(at) && !Array.isArray(at)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** The data with a value at a dotted path, made where the path was not there yet. Nothing the form was opened on is changed. */
export function withPath(data: Data, path: string, value: unknown): Data {
  const keys = path.split('.');
  const copy: Data = { ...data };
  let at = copy;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    at[key] = isObject(next) ? { ...next } : {};
    at = at[key] as Data;
  }
  at[keys[keys.length - 1]!] = value;
  return copy;
}

/** A contract written on the car-sale wording has payment lines of its own to add and take away; an older one keeps what it had. */
export const isSale = (data: Data): boolean => data['template'] === CONTRACT_SALE_TEMPLATE;

/** A block of the form with its rows of fields: the older wording's fields only where the contract is on the older wording. */
export interface Block {
  id: string;
  title: string;
  rows: readonly (readonly ContractField[])[];
}

/** The older wording's fields are more fields of the block's last row (one grid, as the classic editor drew it), not a row of their own. */
const joined = (
  rows: readonly (readonly ContractField[])[],
  older: readonly (readonly ContractField[])[] | undefined,
): (readonly ContractField[])[] =>
  older?.length ? [...rows.slice(0, -1), [...(rows.at(-1) ?? []), ...older.flat()]] : [...rows];

export function blocksOf(data: Data): Block[] {
  const sale = isSale(data);
  return CONTRACT_SECTIONS.map(s => ({
    id: s.id,
    title: s.title,
    rows: sale ? s.rows : joined(s.rows, s.older),
  }));
}

/** Every field the form shows for this contract, in order. */
export const fieldsOf = (data: Data): ContractField[] => blocksOf(data).flatMap(b => b.rows.flat());

/** What each field starts with: what the contract holds at its path, as words. */
export function startValues(data: Data): Record<string, string> {
  return Object.fromEntries(fieldsOf(data).map(([path]) => [path, textOf(getPath(data, path))]));
}

/** A payment line of the car-sale contract: how much, when, and the label it came with (which is kept, not shown). */
export interface PayRow {
  id: number;
  amount: string;
  when: string;
  label: string;
}

export const newPayRow = (id: number): PayRow => ({
  id,
  amount: '',
  when: CONTRACT_PAYMENT_WHEN,
  label: '',
});

/** The payment lines the contract holds (a list of objects; anything else is no line). */
export function payRowsOf(data: Data): PayRow[] {
  const pays = Array.isArray(data['payments']) ? data['payments'] : [];
  return pays.map((p, id) => {
    const line = isObject(p) ? p : {};
    return {
      id,
      amount: textOf(line['amount']),
      when: textOf(line['when']),
      label: textOf(line['label']),
    };
  });
}

/** …and, for a contract on the older wording, the lines as they are: only how much of each can be changed. */
export interface FixedPay {
  amount: string;
  /** what the line says it is for, to read beside the amount */
  note: string;
}

export function fixedPaysOf(data: Data): FixedPay[] {
  const pays = Array.isArray(data['payments']) ? data['payments'] : [];
  return pays.map(p => {
    const line = isObject(p) ? p : {};
    const when = textOf(line['when']);
    const label = textOf(line['label']);
    return { amount: textOf(line['amount']), note: when + (label ? ` (${label})` : '') };
  });
}

/**
 * The contract's data once the form is done with it: what it was, with each field the form shows put at its path (trimmed), the
 * payment lines exactly the rows on screen, its own number, and the added fields. Whatever the form does not show stays as it was —
 * a field the contract has that no row of the form names, an added field whose column is hidden.
 */
export function dataOf(
  was: Data,
  values: Readonly<Record<string, string>>,
  pays: readonly PayRow[] | readonly FixedPay[],
  extras: Readonly<Record<string, unknown>>,
  contractNo: string,
): Data {
  let data: Data = JSON.parse(JSON.stringify(was)) as Data;
  for (const [path, value] of Object.entries(values)) data = withPath(data, path, value.trim());
  if (isSale(was)) {
    data['payments'] = (pays as readonly PayRow[]).map(p => ({
      amount: p.amount.trim(),
      when: p.when.trim(),
      label: p.label,
    }));
    if (contractNo) data['contractNo'] = contractNo;
  } else {
    // (an older contract keeps its lines; only the amounts are the form's)
    const lines = Array.isArray(data['payments']) ? [...(data['payments'] as unknown[])] : [];
    (pays as readonly FixedPay[]).forEach((p, i) => {
      lines[i] = { ...(isObject(lines[i]) ? (lines[i] as Data) : {}), amount: p.amount.trim() };
    });
    if (lines.length) data['payments'] = lines;
  }
  data['custom_fields'] = {
    ...(isObject(was['custom_fields']) ? was['custom_fields'] : {}),
    ...extras,
  };
  return data;
}

/** What a contract is called on saving: after its buyer, in the contract's own language. */
export const titleOf = (buyer: string): string => `عقد — ${buyer}`;

/** A contract drafted by a deal reaching Won, not by a person. */
export const isAuto = (row: Pick<ContractRow, 'created_by'>): boolean =>
  row.created_by === 'auto_won';

/** What the form needs of a lead: who they are, and what the lead's own page knows that a contract is made of. */
export interface LeadSeed {
  id: number;
  name: string;
  address: string;
  car: string;
  nationalId: string;
}

export function seedOf(lead: Record<string, unknown> | undefined): LeadSeed | null {
  if (!lead) return null;
  const cf = isObject(lead['custom_fields']) ? lead['custom_fields'] : {};
  const first = (...v: unknown[]) => v.map(textOf).find(s => s !== '') ?? '';
  return {
    id: Number(lead['id']),
    name: textOf(lead['name']),
    address: first(lead['address'], cf['cf_address']),
    car: first(
      cf['cf_vehicle_offered'],
      cf['cf_vehicle_requested'],
      lead['car_in_question'],
    ).trim(),
    nationalId: textOf(cf['cf_national_id']),
  };
}

/**
 * Picking a lead puts them in the buyer's block: their name always, the rest only where the form has nothing yet (a person who
 * has typed an address keeps it) — their national ID, their address, and the car they asked about split into make and model.
 */
export function withLead(
  values: Readonly<Record<string, string>>,
  lead: LeadSeed,
): Record<string, string> {
  const next: Record<string, string> = { ...values, 'buyer.name': lead.name };
  const fill = (path: string, value: string) => {
    if (value && !(next[path] ?? '').trim()) next[path] = value;
  };
  fill('buyer.nationalId', lead.nationalId);
  fill('buyer.address', lead.address);
  if (lead.car) {
    const bits = lead.car.split(/\s+/);
    fill('vehicle.make', bits[0] ?? '');
    fill('vehicle.model', bits.slice(1).join(' '));
  }
  return next;
}

/** The id each field's input carries ('buyer.name' is "ct-buyer-name"). */
export const fieldId = (path: string): string => `ct-${path.replace(/\./g, '-')}`;
