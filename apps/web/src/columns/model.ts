// What the column engine deals in: a table's or form's fields as the server keeps them, and the rules the classic engine
// (public/assets/columns.js) applied to them — how a saved list is read against a screen's own columns, what renaming, moving,
// hiding and deleting do to the list, how a dropdown's options are written and read back, how a link and a coloured badge are
// made. The shapes are packages/contracts' (schemas.js); the checks are written by hand because the bundle does not carry zod,
// and model.test.ts holds each one to its schema — and each rule to the classic engine's, run over the same lists.
import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';

export type Column = z.infer<typeof schemas.Column>;
export type ColumnOption = z.infer<typeof schemas.ColumnOption>;
export type ColumnType = Column['type'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TYPES: readonly string[] = [
  'text',
  'number',
  'date',
  'link',
  'select',
  'radio',
  'checkbox',
  'virtual',
];

const HEX = /^#[0-9a-f]{6}$/;

function isOption(v: unknown): v is ColumnOption {
  return (
    isObject(v) &&
    typeof v['key'] === 'string' &&
    typeof v['label'] === 'string' &&
    (v['color'] === undefined || (typeof v['color'] === 'string' && HEX.test(v['color'])))
  );
}

export function isColumn(v: unknown): v is Column {
  if (!isObject(v)) return false;
  const { key, label, type, builtin, visible, deleted, required, width, options } = v;
  return (
    typeof key === 'string' &&
    typeof label === 'string' &&
    typeof type === 'string' &&
    TYPES.includes(type) &&
    typeof builtin === 'boolean' &&
    typeof visible === 'boolean' &&
    (deleted === undefined || deleted === true) &&
    (required === undefined || required === true) &&
    (width === undefined ||
      (typeof width === 'number' && Number.isInteger(width) && width >= 40 && width <= 800)) &&
    (options === undefined || (Array.isArray(options) && options.every(isOption)))
  );
}

/** What GET …/columns/:entity answers: the list the server keeps for it, or null where nothing was ever saved. */
export function isColumnsResponse(v: unknown): v is { columns: Column[] | null; entity: string } {
  return (
    isObject(v) &&
    typeof v['entity'] === 'string' &&
    (v['columns'] === null || (Array.isArray(v['columns']) && v['columns'].every(isColumn)))
  );
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── Reading a saved list ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a screen draws from what the server has: a list that was never saved (or is empty) is the screen's own columns; otherwise
 * the saved ones (a builtin the screen no longer has is dropped, a field somebody added is kept), then any builtin the screen
 * gained since, at the end; and a dropdown always has its options, and an option saved before colours existed has its builtin's.
 */
export function mergeColumns(saved: unknown, builtins: readonly Column[]): Column[] {
  if (!Array.isArray(saved) || !saved.length) return clone([...builtins]);
  const cols: Column[] = (saved as Column[])
    .filter(c => c && c.key && (!c.builtin || builtins.some(d => d.key === c.key)))
    .map(c => ({ ...clone(c), visible: c.visible !== false }));
  for (const d of builtins) if (!cols.some(c => c.key === d.key)) cols.push(clone(d));
  for (const c of cols) {
    const d = builtins.find(x => x.key === c.key);
    if (d?.options && !Array.isArray(c.options)) c.options = clone(d.options);
    if (d?.options && Array.isArray(c.options)) {
      for (const o of c.options) {
        if (!o.color) {
          const m = d.options.find(x => x.key === o.key);
          if (m?.color) o.color = m.color;
        }
      }
    }
  }
  return cols;
}

/** The columns a screen draws, in order: shown, and not deleted. */
export const visibleColumns = (cols: readonly Column[]): Column[] =>
  cols.filter(c => c.visible && !c.deleted);

/** A column by its key: the list's own, or else the screen's builtin of that name. */
export const columnOf = (
  cols: readonly Column[],
  builtins: readonly Column[],
  key: string,
): Column | undefined => cols.find(c => c.key === key) ?? builtins.find(c => c.key === key);

export const hasOptions = (type: string): boolean => type === 'select' || type === 'radio';

/** The words for a value of a dropdown column: its option's label, or the value itself. */
export const optionLabels = (col: Pick<Column, 'options'> | undefined): Record<string, string> => {
  const m: Record<string, string> = {};
  for (const o of col?.options ?? []) m[o.key] = o.label;
  return m;
};

/** An option's colour as it may be drawn: #rrggbb or nothing (it goes into a style, so nothing else may). */
export const safeHex = (v: unknown): string | null =>
  /^#[0-9a-fA-F]{6}$/.test(String(v ?? '')) ? String(v) : null;

export function optionColor(col: Pick<Column, 'options'> | undefined, key: string): string | null {
  const o = (col?.options ?? []).find(x => x.key === key);
  return safeHex(o?.color);
}

/** #rrggbb and an opacity, as the rgba() the badge's wash and rim are made of. */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** What a badge says and the colour it is painted in (none: it stays neutral). */
export function badgeOf(
  col: Pick<Column, 'options'> | undefined,
  raw: unknown,
  label?: string,
): { text: string; hex: string | null } {
  const key = raw == null ? '' : String(raw);
  const text = label ?? (optionLabels(col)[key] || key || '—');
  return { text, hex: optionColor(col, key) };
}

/** A key for a field somebody names: letters and numbers, the rest underscores. */
export const slug = (label: string): string =>
  String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'col';

/**
 * A dropdown's options typed one per line, as a list: the key an option already had (and its colour) when its label is the same,
 * so renaming one does not orphan the values stored under it; a new one gets a key made of its label.
 */
export function parseOptionLines(text: string, existing?: readonly ColumnOption[]): ColumnOption[] {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const prev = existing ?? [];
  const opts: ColumnOption[] = [];
  for (const l of lines) {
    const match = prev.find(o => o.label === l);
    let k = match ? match.key : slug(l);
    const b = k;
    let m = 2;
    while (opts.some(o => o.key === k)) k = b + '_' + m++;
    const opt: ColumnOption = { key: k, label: l };
    if (match?.color) opt.color = match.color;
    opts.push(opt);
  }
  return opts;
}

/** A row of the options editor: the key it has (empty for a new one), the label typed, the colour chosen. */
export interface OptionRow {
  key: string;
  label: string;
  color: string;
}

/** What the colour input says when nobody has chosen one: the neutral grey it starts at is "no colour", and is not stored. */
export const NO_COLOUR = '#8a8f98';

/** The options editor's rows as a list: blank labels are nothing, a new label gets a key, a key already taken is skipped. */
export function optionsOfRows(rows: readonly OptionRow[]): ColumnOption[] {
  const opts: ColumnOption[] = [];
  for (const r of rows) {
    const label = r.label.trim();
    if (!label) continue;
    let k = r.key;
    if (!k) {
      k = slug(label);
      const b = k;
      let m = 2;
      while (opts.some(o => o.key === k)) k = b + '_' + m++;
    }
    if (opts.some(o => o.key === k)) continue;
    const opt: ColumnOption = { key: k, label };
    if (r.color && r.color !== NO_COLOUR) opt.color = r.color;
    opts.push(opt);
  }
  return opts;
}

export const rowsOfOptions = (options: readonly ColumnOption[] | undefined): OptionRow[] =>
  (options ?? []).map(o => ({ key: o.key, label: o.label, color: o.color ?? '' }));

// ── Changing the list ───────────────────────────────────────────────────────────────────────────────────────────────────
// Each of these answers the new list (the old one is not touched); one that has nothing to do answers the same list.

const setCol = (cols: readonly Column[], key: string, f: (c: Column) => Column): Column[] =>
  cols.map(c => (c.key === key ? f(c) : c));

export const setVisible = (cols: readonly Column[], key: string, on: boolean): Column[] =>
  setCol(cols, key, c => ({ ...c, visible: on }));

/** A new name (a blank one is no change). */
export function rename(cols: readonly Column[], key: string, label: string): Column[] {
  const l = label.trim();
  return l ? setCol(cols, key, c => ({ ...c, label: l })) : [...cols];
}

const spliced = (cols: readonly Column[], from: number, to: number): Column[] => {
  const out = [...cols];
  const [moved] = out.splice(from, 1);
  if (moved) out.splice(to, 0, moved);
  return out;
};

/** One place left (-1) or right (+1) among the columns that are shown: it takes the place of the shown neighbour. */
export function move(cols: readonly Column[], key: string, dir: -1 | 1): Column[] {
  const vis = visibleColumns(cols);
  const vi = vis.findIndex(c => c.key === key);
  const neighbour = vis[vi + dir];
  if (!neighbour) return [...cols];
  return spliced(
    cols,
    cols.findIndex(c => c.key === key),
    cols.findIndex(c => c.key === neighbour.key),
  );
}

/** Dragged: the column takes the place of the one it was dropped on. */
export function reorder(cols: readonly Column[], src: string, target: string): Column[] {
  const from = cols.findIndex(c => c.key === src);
  const to = cols.findIndex(c => c.key === target);
  return from < 0 || to < 0 ? [...cols] : spliced(cols, from, to);
}

export const hide = (cols: readonly Column[], key: string): Column[] =>
  setVisible(cols, key, false);

/**
 * Deleted. A builtin is only marked (so that reading the list does not bring it back); a field somebody added is gone.
 * What was saved on the records stays on them either way.
 */
export function remove(cols: readonly Column[], key: string): Column[] {
  const col = cols.find(c => c.key === key);
  if (!col) return [...cols];
  if (col.builtin)
    return setCol(cols, key, c => ({ ...c, deleted: true as const, visible: false }));
  return cols.filter(c => c.key !== key);
}

/** The width a person typed, if it is one a column may have. */
export function widthOf(typed: string): number | undefined {
  const w = parseInt(typed, 10);
  return w >= 40 && w <= 800 ? w : undefined;
}

export interface FieldInput {
  label: string;
  type: ColumnType;
  /** the options of a dropdown or radio: what they are as typed (the rows of the editor, or the lines of a box) */
  options: ColumnOption[];
  required: boolean;
  width: number | undefined;
}

/** What is wrong with a field that cannot be saved, in the words the classic editor alerts. */
export type FieldProblem = 'name' | 'options' | 'optionLines' | 'keepOne';

export const PROBLEM_WORDS: Record<FieldProblem, Record<'add' | 'edit', string>> = {
  name: { add: 'Column name is required.', edit: 'Field name is required.' },
  options: { add: 'Add at least one option (one per line).', edit: 'Add at least one option.' },
  optionLines: {
    add: 'Add at least one option (one per line).',
    edit: 'Add at least one option (one per line).',
  },
  keepOne: { add: 'Keep at least one option.', edit: 'Keep at least one option.' },
};

/** A field somebody adds: at the end of the list, named after its label (a key already taken gets a number). */
export function addField(
  cols: readonly Column[],
  f: FieldInput,
): { cols: Column[] } | { problem: FieldProblem } {
  const label = f.label.trim();
  if (!label) return { problem: 'name' };
  let key = 'cf_' + slug(label);
  const base = key;
  let n = 2;
  while (cols.some(c => c.key === key)) key = base + '_' + n++;
  const col: Column = { key, label, type: f.type, builtin: false, visible: true };
  if (hasOptions(f.type)) {
    if (!f.options.length) return { problem: 'optionLines' };
    col.options = f.options;
  }
  if (f.required) col.required = true;
  if (f.width !== undefined) col.width = f.width;
  return { cols: [...cols, col] };
}

/** Everything about one field at once (the editor of a column): its name, type, options, whether forms require it, its width. */
export function editField(
  cols: readonly Column[],
  key: string,
  f: FieldInput,
): { cols: Column[] } | { problem: FieldProblem } {
  const label = f.label.trim();
  if (!label) return { problem: 'name' };
  if (hasOptions(f.type) && !f.options.length) return { problem: 'options' };
  return {
    cols: setCol(cols, key, c => {
      const next: Column = { ...c, label, type: f.type };
      if (hasOptions(f.type)) next.options = f.options;
      else delete next.options;
      if (f.required) next.required = true;
      else delete next.required;
      if (f.width !== undefined) next.width = f.width;
      else delete next.width;
      return next;
    }),
  };
}

/** Only the type (and, for a dropdown, its options typed one per line: an option of the same label keeps its key and colour). */
export function changeType(
  cols: readonly Column[],
  key: string,
  type: ColumnType,
  optionLines: string,
): { cols: Column[] } | { problem: FieldProblem } {
  const col = cols.find(c => c.key === key);
  if (!col) return { cols: [...cols] };
  if (hasOptions(type)) {
    const options = parseOptionLines(optionLines, col.options);
    if (!options.length) return { problem: 'optionLines' };
    return { cols: setCol(cols, key, c => ({ ...c, type, options })) };
  }
  return {
    cols: setCol(cols, key, c => {
      const next: Column = { ...c, type };
      delete next.options;
      return next;
    }),
  };
}

/** Only the options of a dropdown (at least one is kept). */
export function setOptions(
  cols: readonly Column[],
  key: string,
  options: ColumnOption[],
): { cols: Column[] } | { problem: FieldProblem } {
  if (!options.length) return { problem: 'keepOne' };
  return { cols: setCol(cols, key, c => ({ ...c, options })) };
}

// ── Filling a form from the list ────────────────────────────────────────────────────────────────────────────────────────

/** A stored value as a checkbox reads it. */
export const isTicked = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

/** The labels of the fields a form requires and has nothing in (a checkbox must be ticked; text is trimmed). */
export function missingRequired(
  drawn: readonly Column[],
  values: Readonly<Record<string, string | boolean>>,
): string[] {
  const out: string[] = [];
  for (const c of drawn) {
    if (!c.required || c.deleted || !c.visible) continue;
    const v = values[c.key];
    const filled = typeof v === 'boolean' ? v : (v ?? '').trim() !== '';
    if (!filled) out.push(c.label);
  }
  return out;
}

// ── Links ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a link column's text is, as a link — or nothing, when it is not one. No scheme means a bare domain far more often than a
 * path on this site; a scheme that is not http or https is never made clickable (a `javascript:` "link" typed into a cell would be
 * a script every viewer could run).
 */
export function linkUrl(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  const withScheme = hasScheme ? s : 'https://' + s;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return !hasScheme && !u.hostname.includes('.') ? '' : u.href;
}

/** The last part of a link's path names a Drive file far better than the address does; with no path, the host. */
export function linkLabel(href: string): string {
  try {
    const u = new URL(href);
    const tail = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(tail).replace(/[+_]/g, ' ').trim();
    return name && name.length <= 44 ? name : u.hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

// ── What each field is drawn as ─────────────────────────────────────────────────────────────────────────────────────────

/** The types a field can be changed to: the editor's chips, in its order. */
export const TYPE_CHOICES: readonly (readonly [ColumnType, string])[] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['link', 'Link'],
  ['select', 'Dropdown'],
  ['radio', 'Radio'],
  ['checkbox', 'Checkbox'],
];

/** The chip that starts chosen when a type is to be changed: a dropdown or a checkbox as it is, anything else as text. */
export const typeChipOf = (type: string): ColumnType =>
  hasOptions(type) ? (type as ColumnType) : type === 'checkbox' ? 'checkbox' : 'text';

/** …and when a field is edited: the type it has, or text where it has none the chips offer. */
export const editChipOf = (type: string): ColumnType =>
  TYPE_CHOICES.some(([t]) => t === type) ? (type as ColumnType) : 'text';

/** Builtin columns the way a screen lists them: a key, a name and a width, with the types of those that are not text. */
export function tupleColumns(
  tuples: readonly (readonly [string, string, number])[],
  types: Readonly<Record<string, ColumnType>> = {},
): Column[] {
  return tuples.map(([key, label, width]) => ({
    key,
    label,
    width,
    builtin: true,
    visible: true,
    type: types[key] ?? 'text',
  }));
}

/** The icons the editor's menu, picker and headers draw (lucide's names; the shell's table holds them). */
export const COLUMN_ICONS = {
  shown: 'eye',
  hidden: 'eye-off',
  edit: 'pencil',
  add: 'plus',
  field: 'settings-2',
  type: 'shuffle',
  options: 'list',
  left: 'arrow-left',
  right: 'arrow-right',
  remove: 'trash-2',
  chevron: 'chevron-down',
  link: 'external-link',
} as const;
