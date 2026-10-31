// The lines of a document while its form is open: what each holds, a new one added (empty, or from the catalogue), one taken away.
import { useCallback, useRef, useState } from 'react';
import type { Column } from '../columns';
import { rowOf, type Row } from './Lines';
import type { Line } from './model';

export interface Rows {
  rows: readonly Row[];
  change: (id: number, key: string, value: string | boolean) => void;
  remove: (id: number) => void;
  /** a line more (empty, or made from the catalogue) */
  add: (line?: Line) => void;
}

/**
 * The rows a form starts with: the document's lines, or one empty line if it has none. `shown` are the columns the grid draws
 * (they must be known before the form is: the form is made of them); `starts` are the values a line with none of its own begins
 * with — a purchase order's status begins as the first of the options it has been given. A form that wants none until one is
 * asked for (a vehicle's cars) says `emptyStart`.
 */
export function useRows(
  lines: readonly Line[],
  shown: readonly Column[],
  starts: () => Readonly<Record<string, string>>,
  emptyStart = false,
): Rows {
  const [rows, setRows] = useState<Row[]>(() =>
    (lines.length || emptyStart ? lines : [{}]).map((line, i) =>
      rowOf(i, line, shown as Column[], starts()),
    ),
  );
  // (the number the next row will be given: a row's own, so that one taken out of the middle does not hand its boxes to the next)
  const next = useRef(rows.length);
  const change = useCallback(
    (id: number, key: string, value: string | boolean) =>
      setRows(was =>
        was.map(r => (r.id === id ? { ...r, values: { ...r.values, [key]: value } } : r)),
      ),
    [],
  );
  const remove = useCallback((id: number) => setRows(was => was.filter(r => r.id !== id)), []);
  const add = useCallback(
    (line: Line = {}) => {
      const id = next.current++;
      setRows(was => [...was, rowOf(id, line, shown as Column[], starts())]);
    },
    [shown, starts],
  );
  return { rows, change, remove, add };
}
