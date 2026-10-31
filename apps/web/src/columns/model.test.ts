import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import contracts from '@motolinker/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addField,
  badgeOf,
  changeType,
  editChipOf,
  editField,
  hasOptions,
  hexA,
  hide,
  isColumn,
  isColumnsResponse,
  isTicked,
  linkLabel,
  linkUrl,
  mergeColumns,
  missingRequired,
  move,
  NO_COLOUR,
  optionsOfRows,
  parseOptionLines,
  PROBLEM_WORDS,
  reorder,
  remove,
  rename,
  rowsOfOptions,
  safeHex,
  setOptions,
  setVisible,
  slug,
  tupleColumns,
  typeChipOf,
  visibleColumns,
  widthOf,
  type Column,
  type ColumnOption,
  type OptionRow,
} from './model';

const S = contracts.schemas;

// ── The guards, held to the schemas ─────────────────────────────────────────────────────────────────────────────────────

const col = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  key: 'cf_a',
  label: 'A',
  type: 'text',
  builtin: false,
  visible: true,
  ...over,
});

describe('the answers the column engine accepts', () => {
  // The bundle does not carry zod; this table is what keeps each hand-written check honest against the schema.
  const cases: Array<[string, unknown]> = [
    ['a plain column', col()],
    ['a builtin', col({ key: 'name', builtin: true })],
    [
      'hidden, deleted, required and sized',
      col({ visible: false, deleted: true, required: true, width: 120 }),
    ],
    [
      'a dropdown with colours and without',
      col({
        type: 'select',
        options: [
          { key: 'a', label: 'A', color: '#aa00ff' },
          { key: 'b', label: 'B' },
        ],
      }),
    ],
    ['every type there is', col({ type: 'virtual' })],
    ['a link', col({ type: 'link' })],
    ['an unknown type', col({ type: 'telepathy' })],
    ['a width out of range', col({ width: 5000 })],
    ['a width that is not whole', col({ width: 100.5 })],
    ['deleted: false', col({ deleted: false })],
    ['required: false', col({ required: false })],
    ['no key', col({ key: undefined })],
    ['a numeric label', col({ label: 3 })],
    [
      'a colour that is not #rrggbb',
      col({ type: 'select', options: [{ key: 'a', label: 'A', color: 'red' }] }),
    ],
    [
      'an upper-case colour (the server writes them lower)',
      col({ type: 'select', options: [{ key: 'a', label: 'A', color: '#AA00FF' }] }),
    ],
    ['options that are not a list', col({ options: 'x' })],
    ['an option with no label', col({ options: [{ key: 'a' }] })],
    ['not an object', 'column'],
    ['null', null],
  ];
  it.each(cases)('%s: the check and the schema agree', (_name, value) => {
    expect(isColumn(value)).toBe(S.Column.safeParse(value).success);
  });

  const answers: Array<[string, unknown]> = [
    ['nothing saved', { columns: null, entity: 'suppliers' }],
    ['a list', { columns: [col()], entity: 'suppliers' }],
    ['an empty list', { columns: [], entity: 'stock' }],
    ['a list with a bad column in it', { columns: [col(), col({ type: 'nope' })], entity: 'x' }],
    ['no entity', { columns: null }],
    ['columns missing', { entity: 'x' }],
    ['columns that are not a list', { columns: 'x', entity: 'x' }],
    ['not an object', []],
  ];
  it.each(answers)('%s: the check and the schema agree', (_name, value) => {
    expect(isColumnsResponse(value)).toBe(S.ColumnsResponse.safeParse(value).success);
  });
});

// ── The rules, held to the classic engine ───────────────────────────────────────────────────────────────────────────────
// public/assets/columns.js is the engine the classic portals run. It is loaded here as it ships and given the same lists as the
// functions of model.ts, and what each leaves behind must be the same. (Its menus and dialogs are drawn into the page, so a
// dialog is opened for real and filled in the way a person fills it, and saved.)

interface ClassicEngine {
  cols: Column[];
  merge: (saved: unknown) => Column[];
  visible: () => Column[];
  setVis: (key: string, on: boolean) => void;
  rename: (key: string) => void;
  move: (key: string, dir: number) => void;
  reorder: (src: string, target: string) => void;
  hide: (key: string) => void;
  remove: (key: string) => void;
  openAddModal: () => void;
  saveNewCol: () => void;
  openFieldModal: (key: string) => void;
  saveField: () => void;
  openTypeModal: (key: string) => void;
  saveType: () => void;
  openOptsModal: (key: string) => void;
  saveOpts: () => void;
  addOptRow: () => void;
  _collectOptRows: () => ColumnOption[];
  badgeHtml: (col: Column | undefined, raw: unknown, label?: string) => string;
}
interface Classic {
  ColumnsEngine: (entity: string, cfg: Record<string, unknown>) => ClassicEngine;
  ceSlug: (s: string) => string;
  ceParseOptLines: (text: string, existing?: unknown) => ColumnOption[];
  ceLinkUrl: (raw: unknown) => string;
  ceLinkLabel: (href: string) => string;
  hexA: (hex: string, a: number) => string;
  ceSafeHex: (v: unknown) => string | null;
  ceHasOpts: (t: string) => boolean;
}

const alerts: string[] = [];
// (the path goes in as a variable: Vite turns a literal `new URL('…', import.meta.url)` into a dev-server address)
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SOURCE = read('../../../../public/assets/columns.js');
const classic = new Function(
  'alert',
  'confirm',
  'prompt',
  `${SOURCE}\nreturn { ColumnsEngine, ceSlug, ceParseOptLines, ceLinkUrl, ceLinkLabel, hexA, ceSafeHex, ceHasOpts };`,
) as (
  alert: (m: string) => void,
  confirm: () => boolean,
  prompt: (m: string, v: string) => string | null,
) => Classic;

let typed: string | null = null;
const C = classic(
  m => void alerts.push(m),
  () => true,
  () => typed,
);

const BUILTINS: Column[] = [
  { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true, width: 140 },
  { key: 'contact', label: 'Contact', type: 'text', builtin: true, visible: true, width: 120 },
  {
    key: 'country',
    label: 'Country',
    type: 'select',
    builtin: true,
    visible: true,
    options: [
      { key: 'cn', label: 'China', color: '#dc2626' },
      { key: 'jp', label: 'Japan' },
    ],
  },
  { key: 'notes', label: 'Notes', type: 'text', builtin: true, visible: true, width: 160 },
];

const SAVED: Array<[string, unknown]> = [
  ['nothing', null],
  ['an empty list', []],
  ['something that is not a list', 'x'],
  [
    'builtins reordered, one hidden, one renamed, and a field added',
    [
      { key: 'notes', label: 'Remarks', type: 'text', builtin: true, visible: true },
      { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
      {
        key: 'cf_rating',
        label: 'Rating',
        type: 'select',
        builtin: false,
        visible: true,
        options: [
          { key: 'a', label: 'A', color: '#00ff00' },
          { key: 'b', label: 'B' },
        ],
      },
      { key: 'contact', label: 'Contact', type: 'text', builtin: true, visible: false },
    ],
  ],
  [
    'a builtin the screen does not have, and one it gained since',
    [
      { key: 'gone', label: 'Gone', type: 'text', builtin: true, visible: true },
      { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
    ],
  ],
  [
    'a dropdown that lost its options and one whose options lost their colours',
    [
      { key: 'country', label: 'Country', type: 'select', builtin: true, visible: true },
      {
        key: 'cf_x',
        label: 'X',
        type: 'radio',
        builtin: false,
        visible: true,
        options: [{ key: 'x', label: 'X' }],
      },
    ],
  ],
  [
    'options saved before colours existed',
    [
      {
        key: 'country',
        label: 'Country',
        type: 'select',
        builtin: true,
        visible: true,
        options: [
          { key: 'cn', label: '中国' },
          { key: 'jp', label: 'Japan', color: '#123456' },
          { key: 'kr', label: 'Korea' },
        ],
      },
    ],
  ],
  [
    'columns with no visible flag, a soft-deleted builtin, and junk',
    [
      { key: 'name', label: 'Name', type: 'text', builtin: true },
      { key: 'notes', label: 'Notes', type: 'text', builtin: true, deleted: true, visible: false },
      null,
      { label: 'No key' },
      {
        key: 'cf_y',
        label: 'Y',
        type: 'date',
        builtin: false,
        visible: true,
        required: true,
        width: 90,
      },
    ],
  ],
];

const same = <T>(a: T, b: T) => expect(JSON.stringify(a)).toBe(JSON.stringify(b));

/** The classic engine, holding this list. */
function engineWith(list: readonly Column[]): ClassicEngine {
  const E = C.ColumnsEngine('t' + Math.random().toString(36).slice(2), {
    builtins: BUILTINS,
    fetch: () => Promise.resolve(),
  });
  E.cols.push(...(JSON.parse(JSON.stringify(list)) as Column[]));
  return E;
}

const q = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error('not in the page: ' + sel);
  return el;
};

beforeEach(() => {
  alerts.length = 0;
  typed = null;
});

describe('reading a saved list', () => {
  it.each(SAVED)('%s is read as the classic engine reads it', (_name, saved) => {
    same(mergeColumns(saved, BUILTINS), engineWith([]).merge(saved));
  });

  it('does not touch what it was given', () => {
    const saved = JSON.parse(JSON.stringify(SAVED[3]?.[1])) as Column[];
    const before = JSON.stringify(saved);
    mergeColumns(saved, BUILTINS);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('shows what is shown and not deleted, in order', () => {
    const cols = mergeColumns(SAVED[7]?.[1], BUILTINS);
    same(visibleColumns(cols), engineWith(cols).visible());
  });
});

describe('changing the list', () => {
  const lists = SAVED.filter(([, s]) => Array.isArray(s) && s.length).map(
    ([name, s]) => [name, mergeColumns(s, BUILTINS)] as const,
  );
  const keys = (cols: readonly Column[]) => cols.map(c => c.key);

  describe.each(lists)('%s', (_name, cols) => {
    it('shows and hides each column as the classic engine does', () => {
      for (const key of keys(cols)) {
        for (const on of [true, false]) {
          const E = engineWith(cols);
          E.setVis(key, on);
          same(setVisible(cols, key, on), E.cols);
        }
        const E = engineWith(cols);
        E.hide(key);
        same(hide(cols, key), E.cols);
      }
    });
    it('moves each column left and right among those that are shown', () => {
      for (const key of keys(cols)) {
        for (const dir of [-1, 1] as const) {
          const E = engineWith(cols);
          E.move(key, dir);
          same(move(cols, key, dir), E.cols);
        }
      }
    });
    it('reorders every pair, and ignores a key that is not there', () => {
      for (const a of [...keys(cols), 'nope']) {
        for (const b of [...keys(cols), 'nope']) {
          const E = engineWith(cols);
          E.reorder(a, b);
          same(reorder(cols, a, b), E.cols);
        }
      }
    });
    it('deletes a builtin by marking it and a field by removing it', () => {
      for (const key of keys(cols)) {
        const E = engineWith(cols);
        E.remove(key);
        same(remove(cols, key), E.cols);
      }
    });
    it('renames, and a blank name is no change', () => {
      for (const key of keys(cols)) {
        for (const name of ['  Renamed  ', '', '   ']) {
          const E = engineWith(cols);
          typed = name;
          E.rename(key);
          same(rename(cols, key, name), E.cols);
        }
      }
    });
  });

  it('does not touch the list it was given', () => {
    const cols = mergeColumns(SAVED[3]?.[1], BUILTINS);
    const before = JSON.stringify(cols);
    setVisible(cols, 'name', false);
    move(cols, 'name', 1);
    reorder(cols, 'name', 'notes');
    remove(cols, 'name');
    remove(cols, 'cf_rating');
    rename(cols, 'name', 'X');
    expect(JSON.stringify(cols)).toBe(before);
  });
});

describe('what a person fills in, and what the classic dialogs make of it', () => {
  const rowsOf = () =>
    [...document.querySelectorAll<HTMLElement>('#ce-opts-list .lo-row')].map((r): OptionRow => ({
      key: r.dataset['optkey'] ?? '',
      label: r.querySelector('input')?.value ?? '',
      color: r.querySelector<HTMLInputElement>('input[type=color]')?.value ?? '',
    }));
  const fill = (id: string, value: string) => (q<HTMLInputElement>(id).value = value);
  const base = mergeColumns(SAVED[3]?.[1], BUILTINS);

  const adds = [
    { label: 'Insurance status', type: 'text', lines: '', required: false, width: '' },
    { label: '  Padded  ', type: 'number', lines: '', required: true, width: '90' },
    { label: 'Name', type: 'text', lines: '', required: false, width: '39' },
    {
      label: 'Rating',
      type: 'select',
      lines: 'Pending\nApproved\n\n  Rejected  \nApproved',
      required: true,
      width: '800',
    },
    { label: 'Rating', type: 'radio', lines: 'One', required: false, width: '801' },
    { label: 'Empty list', type: 'select', lines: '\n  \n', required: false, width: '' },
    { label: '   ', type: 'text', lines: '', required: false, width: '' },
    {
      label: 'Ünïcode & symbols!',
      type: 'checkbox',
      lines: 'ignored',
      required: false,
      width: 'abc',
    },
    { label: 'cf_rating', type: 'link', lines: '', required: false, width: '40' },
  ] as const;

  it.each(adds)('adding a field: $label as $type', f => {
    const E = engineWith(base);
    E.openAddModal();
    fill('#ce-name', f.label);
    fill('#ce-type', f.type);
    fill('#ce-options', f.lines);
    q<HTMLInputElement>('#ce-required').checked = f.required;
    fill('#ce-width', f.width);
    E.saveNewCol();
    const options = hasOptions(f.type) ? parseOptionLines(f.lines) : [];
    const mine = addField(base, {
      label: f.label,
      type: f.type,
      options,
      required: f.required,
      width: widthOf(f.width),
    });
    if ('problem' in mine) {
      expect(alerts).toEqual([PROBLEM_WORDS[mine.problem].add]);
      same(E.cols, base);
    } else {
      expect(alerts).toEqual([]);
      same(mine.cols, E.cols);
    }
  });

  const fieldEdits = [
    {
      key: 'country',
      label: 'Land',
      type: 'select',
      required: true,
      width: '200',
      edit: (r: OptionRow[]) => r,
    },
    {
      key: 'country',
      label: 'Land',
      type: 'select',
      required: false,
      width: '',
      edit: (r: OptionRow[]) => [
        ...r,
        { key: '', label: 'Korea', color: '#00ff00' },
        { key: '', label: 'Japan', color: NO_COLOUR },
      ],
    },
    {
      key: 'country',
      label: 'Land',
      type: 'text',
      required: false,
      width: '',
      edit: (r: OptionRow[]) => r,
    },
    {
      key: 'country',
      label: 'Land',
      type: 'select',
      required: false,
      width: '',
      edit: () => [] as OptionRow[],
    },
    {
      key: 'country',
      label: '  ',
      type: 'select',
      required: false,
      width: '',
      edit: (r: OptionRow[]) => r,
    },
    {
      key: 'name',
      label: 'Title',
      type: 'radio',
      required: false,
      width: '',
      edit: () => [
        { key: '', label: 'Mr', color: '#112233' },
        { key: '', label: 'Ms', color: '' },
        { key: '', label: ' ', color: '' },
        { key: 'x', label: 'Dr', color: '#445566' },
        { key: 'x', label: 'Dr again', color: '' },
      ],
    },
    {
      key: 'cf_rating',
      label: 'Rating',
      type: 'checkbox',
      required: true,
      width: '40',
      edit: (r: OptionRow[]) => r,
    },
    {
      key: 'notes',
      label: 'Notes',
      type: 'date',
      required: false,
      width: '41',
      edit: (r: OptionRow[]) => r,
    },
  ] as const;

  it.each(fieldEdits)('editing a field: $key → $label as $type', f => {
    const E = engineWith(base);
    E.openFieldModal(f.key);
    fill('#ce-name', f.label);
    fill('#ce-type', f.type);
    // (the rows the editor shows are the ones it was opened with; the edit adds, drops and changes some)
    const opened = rowsOf();
    const wanted = f.edit(opened);
    document.querySelector('#ce-opts-list')!.innerHTML = '';
    for (const r of wanted) {
      E.addOptRow();
      const row = [...document.querySelectorAll<HTMLElement>('#ce-opts-list .lo-row')].pop()!;
      row.dataset['optkey'] = r.key;
      row.querySelector('input')!.value = r.label;
      row.querySelector<HTMLInputElement>('input[type=color]')!.value = r.color || NO_COLOUR;
    }
    q<HTMLInputElement>('#ce-required').checked = f.required;
    fill('#ce-width', f.width);
    const asRows = rowsOf();
    same(optionsOfRows(asRows), E._collectOptRows());
    E.saveField();
    const mine = editField(base, f.key, {
      label: f.label,
      type: f.type,
      options: optionsOfRows(asRows),
      required: f.required,
      width: widthOf(f.width),
    });
    if ('problem' in mine) {
      expect(alerts).toEqual([PROBLEM_WORDS[mine.problem].edit]);
      same(E.cols, base);
    } else {
      expect(alerts).toEqual([]);
      same(mine.cols, E.cols);
    }
  });

  it('takes "required" and a width off a field when the editor unticks and empties them, as the classic editor does', () => {
    const cols: Column[] = [
      {
        key: 'cf_req',
        label: 'Req',
        type: 'text',
        builtin: false,
        visible: true,
        required: true,
        width: 120,
      },
    ];
    const E = engineWith(cols);
    E.openFieldModal('cf_req');
    expect(q<HTMLInputElement>('#ce-required').checked).toBe(true);
    expect(q<HTMLInputElement>('#ce-width').value).toBe('120');
    q<HTMLInputElement>('#ce-required').checked = false;
    fill('#ce-width', '');
    E.saveField();
    const mine = editField(cols, 'cf_req', {
      label: 'Req',
      type: 'text',
      options: [],
      required: false,
      width: undefined,
    });
    if ('problem' in mine) throw new Error('the edit was refused: ' + mine.problem);
    same(mine.cols, E.cols);
    expect(mine.cols[0]).not.toHaveProperty('required');
    expect(mine.cols[0]).not.toHaveProperty('width');
  });

  const typeChanges = [
    { key: 'country', type: 'text', lines: '' },
    { key: 'country', type: 'select', lines: 'China\nJapan\nKorea' },
    { key: 'country', type: 'radio', lines: 'Japan\n  China  \nJapan' },
    { key: 'country', type: 'select', lines: '' },
    { key: 'country', type: 'checkbox', lines: 'ignored' },
    { key: 'name', type: 'select', lines: 'A\nB' },
    { key: 'cf_rating', type: 'text', lines: '' },
    { key: 'cf_rating', type: 'select', lines: 'A\nB\nC' },
  ] as const;

  it.each(typeChanges)('changing the type of $key to $type', f => {
    const E = engineWith(base);
    E.openTypeModal(f.key);
    fill('#ce-type', f.type);
    fill('#ce-options', f.lines);
    E.saveType();
    const mine = changeType(base, f.key, f.type, f.lines);
    if ('problem' in mine) {
      expect(alerts).toEqual([PROBLEM_WORDS[mine.problem].add]);
      same(E.cols, base);
    } else {
      expect(alerts).toEqual([]);
      same(mine.cols, E.cols);
    }
  });

  it.each([
    ['country', (r: OptionRow[]) => r],
    ['country', (r: OptionRow[]) => r.map(x => ({ ...x, label: x.label + '!' }))],
    ['country', () => [] as OptionRow[]],
    ['cf_rating', (r: OptionRow[]) => [...r, { key: '', label: 'New', color: '#abcdef' }]],
  ] as const)('editing the options of %s', (key, edit) => {
    const E = engineWith(base);
    E.openOptsModal(key);
    const wanted = edit(rowsOf());
    document.querySelector('#ce-opts-list')!.innerHTML = '';
    for (const r of wanted) {
      E.addOptRow();
      const row = [...document.querySelectorAll<HTMLElement>('#ce-opts-list .lo-row')].pop()!;
      row.dataset['optkey'] = r.key;
      row.querySelector('input')!.value = r.label;
      row.querySelector<HTMLInputElement>('input[type=color]')!.value = r.color || NO_COLOUR;
    }
    E.saveOpts();
    const mine = setOptions(base, key, optionsOfRows(wanted));
    if ('problem' in mine) {
      expect(alerts).toEqual([PROBLEM_WORDS[mine.problem].add]);
      same(E.cols, base);
    } else {
      expect(alerts).toEqual([]);
      same(mine.cols, E.cols);
    }
  });

  it('starts the type chips where the classic dialogs start them', () => {
    for (const t of [
      'text',
      'number',
      'date',
      'link',
      'select',
      'radio',
      'checkbox',
      'virtual',
      'telepathy',
    ]) {
      const list: Column[] = [
        { key: 'k', label: 'K', type: t as Column['type'], builtin: false, visible: true },
      ];
      const E = engineWith(list);
      E.openTypeModal('k');
      expect(q<HTMLInputElement>('#ce-type').value).toBe(typeChipOf(t));
      E.openFieldModal('k');
      expect(q<HTMLInputElement>('#ce-type').value).toBe(editChipOf(t));
    }
  });

  it('shows the rows an editor opens with: the options of the column, with their keys and colours', () => {
    const E = engineWith(base);
    E.openOptsModal('country');
    const rows = rowsOf();
    const country = base.find(c => c.key === 'country');
    same(
      rows.map(r => r.key),
      (country?.options ?? []).map(o => o.key),
    );
    same(
      rows.map(r => r.color),
      rowsOfOptions(country?.options).map(r => r.color || NO_COLOUR),
    );
  });
});

describe('words and colours', () => {
  it('makes keys as the classic engine does', () => {
    for (const s of [
      'Insurance status',
      '  Padded  ',
      'Ünïcode & symbols!',
      '###',
      '',
      'A  B',
      '_x_',
      'x'.repeat(100),
    ]) {
      expect(slug(s)).toBe(C.ceSlug(s));
    }
  });

  it('reads options typed one per line as the classic engine does', () => {
    const existing: ColumnOption[] = [
      { key: 'cn', label: 'China', color: '#dc2626' },
      { key: 'jp', label: 'Japan' },
    ];
    for (const text of [
      '',
      '\n\n',
      'China\nJapan\nKorea',
      ' Japan \n Japan \nJapan',
      'A b\nA-b\nA  b',
      'China\nchina',
    ]) {
      for (const prev of [undefined, existing]) {
        same(parseOptionLines(text, prev), C.ceParseOptLines(text, prev));
      }
    }
  });

  it('reads a link as the classic engine does', () => {
    const inputs: unknown[] = [
      '',
      '  ',
      null,
      undefined,
      'example.com',
      'https://example.com/a/b%20c.pdf',
      'http://x.test',
      'localhost',
      'ftp://x.test/f',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'mailto:a@b.c',
      'drive.google.com/file/d/1/view',
      'www.example.com',
      'not a url',
      'https://example.com/' + 'long-'.repeat(20) + '.pdf',
      'https://example.com/%E0%A4%A',
      'https://www.example.com/',
      'https://x.test/a+b_c',
      12345,
    ];
    for (const raw of inputs) {
      expect(linkUrl(raw)).toBe(C.ceLinkUrl(raw));
      const href = linkUrl(raw);
      if (href) expect(linkLabel(href)).toBe(C.ceLinkLabel(href));
    }
    expect(linkLabel('not a url')).toBe(C.ceLinkLabel('not a url'));
  });

  it('draws colours as the classic engine does, and only the safe ones', () => {
    for (const v of [
      '#aabbcc',
      '#AABBCC',
      '#abc',
      'red',
      '',
      null,
      undefined,
      '#aabbccd',
      'url(x)',
      '#12345g',
      12,
    ]) {
      expect(safeHex(v)).toBe(C.ceSafeHex(v));
    }
    expect(hexA('#112233', 0.12)).toBe(C.hexA('#112233', 0.12));
    expect(hexA('#ffffff', 0.3)).toBe(C.hexA('#ffffff', 0.3));
  });

  it('knows which types have options', () => {
    for (const t of ['text', 'select', 'radio', 'checkbox', 'virtual', '', 'Select'])
      expect(hasOptions(t)).toBe(C.ceHasOpts(t));
  });

  it('badges say and colour what the classic engine does', () => {
    const E = engineWith(BUILTINS);
    const country = BUILTINS.find(c => c.key === 'country');
    const host = document.createElement('div');
    for (const [raw, label] of [
      ['cn', undefined],
      ['jp', undefined],
      ['kr', undefined],
      ['', undefined],
      [null, undefined],
      ['cn', 'Chinese'],
    ] as const) {
      host.innerHTML = E.badgeHtml(country, raw, label);
      const span = host.firstElementChild as HTMLElement;
      const mine = badgeOf(country, raw, label);
      expect(span.textContent).toBe(mine.text);
      expect(span.style.getPropertyValue('--ce-c') || null).toBe(mine.hex);
      expect(span.className === 'ce-pill').toBe(mine.hex !== null);
      if (mine.hex) expect(span.style.background).toBe(hexA(mine.hex, 0.12).replace(/,/g, ', '));
    }
    expect(E.badgeHtml(undefined, 'x')).toContain('>x<');
    expect(badgeOf(undefined, 'x')).toEqual({ text: 'x', hex: null });
  });
});

describe('filling a form', () => {
  const required = (key: string, label: string, over: Partial<Column> = {}): Column => ({
    key,
    label,
    type: 'text',
    builtin: false,
    visible: true,
    required: true,
    ...over,
  });

  it('asks for the required fields that are empty, and nothing else', () => {
    const drawn = [
      required('cf_a', 'A'),
      required('cf_b', 'B'),
      required('cf_c', 'C', { type: 'checkbox' }),
      { ...required('cf_d', 'D'), required: undefined } as Column,
      required('cf_e', 'E', { visible: false }),
      required('cf_f', 'F', { deleted: true }),
    ];
    expect(
      missingRequired(drawn, { cf_a: '  ', cf_b: 'x', cf_c: false, cf_d: '', cf_e: '', cf_f: '' }),
    ).toEqual(['A', 'C']);
    expect(missingRequired(drawn, { cf_a: 'x', cf_b: 'y', cf_c: true })).toEqual([]);
    expect(missingRequired(drawn, {})).toEqual(['A', 'B', 'C']);
  });

  it('reads a stored value as a ticked box as the classic form does', () => {
    for (const [v, ticked] of [
      [true, true],
      ['true', true],
      [1, true],
      ['1', true],
      [false, false],
      ['false', false],
      [0, false],
      ['', false],
      [null, false],
      ['yes', false],
    ] as const) {
      expect(isTicked(v)).toBe(ticked);
    }
  });
});

describe('the columns a screen starts with', () => {
  it('lists a key, a name and a width, with the type where it is not text', () => {
    const cols = tupleColumns(
      [
        ['name', 'Name', 140],
        ['year', 'Year', 70],
      ],
      { year: 'number' },
    );
    expect(cols).toEqual([
      { key: 'name', label: 'Name', width: 140, builtin: true, visible: true, type: 'text' },
      { key: 'year', label: 'Year', width: 70, builtin: true, visible: true, type: 'number' },
    ]);
    expect(cols.every(isColumn)).toBe(true);
  });
});

describe('the classic engine, for the record', () => {
  it('is the engine these were held to: it still has every rule they rest on', () => {
    // (a rename of any of these in columns.js would leave the comparisons above comparing nothing)
    for (const name of [
      'merge',
      'setVis',
      'rename',
      'move',
      'reorder',
      'hide',
      'remove',
      'openAddModal',
      'saveNewCol',
      'openFieldModal',
      'saveField',
      'openTypeModal',
      'saveType',
      'openOptsModal',
      'saveOpts',
      'addOptRow',
      '_collectOptRows',
      'badgeHtml',
      'visible',
    ]) {
      expect(typeof (engineWith([]) as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

vi.stubGlobal('alert', (m: string) => alerts.push(m));
