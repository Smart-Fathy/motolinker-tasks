import type { Columns } from '../columns';
import { ColumnHeader, GRID_CELL, GRID_HEAD, GRID_ROW, GridInput } from '../columns';
import { Btn } from '../ui';
import styles from './docs.module.css';
import { cellOf, type Line } from './model';

/**
 * One line of a document as the form holds it: what the line was when the form opened (`base`, whose words under fields the grid
 * does not show are kept) and what the grid shows over it (`values`). `id` is the row's own, so that a row removed from the
 * middle does not hand its boxes to the next.
 */
export interface Row {
  id: number;
  base: Line;
  values: Record<string, string | boolean>;
}

/** A row that starts as this line: every shown column holds what the line has (a status a line has none of starts as `firstOf`). */
export function rowOf(
  id: number,
  line: Line,
  shown: Parameters<typeof cellOf>[1][],
  starts: Readonly<Record<string, string>> = {},
): Row {
  const values: Record<string, string | boolean> = {};
  for (const c of shown) {
    const own = cellOf(line, c);
    values[c.key] = line[c.key] == null && starts[c.key] !== undefined ? starts[c.key]! : own;
  }
  return { id, base: line, values };
}

/**
 * The table of lines (the vehicles an RFQ asks for, the vehicles a purchase order buys): a number, then the columns the
 * administrator has shown, in their order and as the type each was given, then a × that takes the line away. The cells are the
 * form's own, so that what is typed is held by the form (and by nothing in the page).
 */
export function LinesGrid({
  columns,
  rows,
  change,
  remove,
  number,
  minWidth,
  removeTitle,
}: {
  columns: Columns;
  rows: readonly Row[];
  change: (id: number, key: string, value: string | boolean) => void;
  remove: (id: number) => void;
  /** the number column's header and width */
  number: { label: string; width: number };
  /** the table never narrows below this: it scrolls inside its frame instead */
  minWidth: number;
  removeTitle: string;
}) {
  return (
    <div className={styles['gridFrame']} data-part="gridFrame">
      <table className={styles['grid']} style={{ minWidth }} data-part="grid">
        <thead>
          <tr>
            <th className={GRID_HEAD} style={{ width: number.width }} data-part="gridNumberHead">
              {number.label}
            </th>
            {columns.shown.map(c => (
              <ColumnHeader
                key={c.key}
                columns={columns}
                col={c}
                className={GRID_HEAD}
                style={{ minWidth: c.width || 90 }}
                part="gridHead"
              />
            ))}
            <th className={GRID_HEAD} style={{ width: 38 }} data-part="gridEndHead" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={GRID_ROW} data-part="gridRow">
              <td
                className={GRID_CELL}
                style={{ textAlign: 'center', color: 'var(--muted)' }}
                data-part="gridNumber"
              >
                {i + 1}
              </td>
              {columns.shown.map(c => (
                <GridInput
                  key={c.key}
                  col={c}
                  live
                  value={r.values[c.key] ?? cellOf(r.base, c)}
                  onCommit={v => change(r.id, c.key, v)}
                />
              ))}
              <td className={GRID_CELL} style={{ textAlign: 'center' }} data-part="gridEnd">
                <Btn
                  danger
                  style={{ padding: '2px 7px', fontSize: 14 }}
                  title={removeTitle}
                  data-part="gridRemove"
                  onClick={() => remove(r.id)}
                >
                  ×
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
