// The column engine, for one table or form: its columns as the server keeps them (read against the screen's own), what changing
// them does, and which menu or dialog of the editor is open. A screen asks for it once —
//
//   const columns = useColumns('suppliers', SUPPLIER_COLUMNS);
//
// — draws from `columns.shown`, and puts <ColumnsLayer columns={columns}/> somewhere in its tree for the editor. Who may edit is
// the administrator only (the server refuses everyone else's write, so nobody else is offered one).
import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { useSession } from '../app/context';
import { useColumnConfig } from './data';
import {
  addField,
  changeType,
  columnOf,
  editField,
  hide,
  mergeColumns,
  move,
  PROBLEM_WORDS,
  remove,
  rename,
  reorder,
  setOptions,
  setVisible,
  visibleColumns,
  type Column,
  type ColumnOption,
  type FieldInput,
  type FieldProblem,
} from './model';

export type MenuState =
  { kind: 'column'; key: string; x: number; y: number } | { kind: 'picker'; x: number; y: number };

export type DialogState =
  | { kind: 'add' }
  | { kind: 'field'; key: string }
  | { kind: 'type'; key: string }
  | { kind: 'options'; key: string };

export interface Columns {
  entity: string;
  /** the list has been asked for (a screen draws only after: the form IS the column list) */
  loaded: boolean;
  /** who may change the list */
  canEdit: boolean;
  /** every column, in order: what is saved (hidden and deleted ones too) */
  all: readonly Column[];
  /** what the screen draws: shown, and not deleted */
  shown: readonly Column[];
  col: (key: string) => Column | undefined;

  menu: MenuState | null;
  dialog: DialogState | null;
  /** the menu of one column (from the chevron in its header) */
  openMenu: (e: MouseEvent, key: string) => void;
  /** the list of columns to show and hide ("Columns"); a second press puts it away */
  openPicker: (e: MouseEvent) => void;
  openAdd: () => void;
  openField: (key: string) => void;
  openType: (key: string) => void;
  openOptions: (key: string) => void;
  closeMenu: () => void;
  closeDialog: () => void;

  setVisible: (key: string, on: boolean) => void;
  rename: (key: string) => void;
  move: (key: string, dir: -1 | 1) => void;
  reorder: (src: string, target: string) => void;
  hide: (key: string) => void;
  remove: (key: string) => void;
  /** what a dialog's Save does; the words of what is wrong, if something is (the dialog says them) */
  saveNew: (f: FieldInput) => string | null;
  saveField: (key: string, f: FieldInput) => string | null;
  saveType: (key: string, type: Column['type'], optionLines: string) => string | null;
  saveOptions: (key: string, options: ColumnOption[]) => string | null;
}

/** Where a menu opens: at the pointer, kept on the screen (the classic menu's own arithmetic). */
const placed = (e: MouseEvent) => ({
  x: Math.min(e.clientX, window.innerWidth - 230),
  y: Math.min(e.clientY + 6, window.innerHeight - 60),
});

export function useColumns(entity: string, builtins: readonly Column[]): Columns {
  const { portal } = useSession();
  const { saved, loaded, keep } = useColumnConfig(entity);
  const all = useMemo(() => mergeColumns(saved, builtins), [saved, builtins]);
  const shown = useMemo(() => visibleColumns(all), [all]);
  const canEdit = portal === 'admin';
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const col = useCallback((key: string) => columnOf(all, builtins, key), [all, builtins]);

  // Everything the editor opens is for the person who may edit: for anybody else a screen's asking opens nothing.
  const openMenu = useCallback(
    (e: MouseEvent, key: string) => {
      e.stopPropagation();
      if (!canEdit || !col(key)) return;
      setMenu({ kind: 'column', key, ...placed(e) });
    },
    [canEdit, col],
  );
  const openPicker = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!canEdit) return;
      const at = placed(e);
      setMenu(open => (open?.kind === 'picker' ? null : { kind: 'picker', ...at }));
    },
    [canEdit],
  );

  // A dialog is opened from a menu, which goes away as it opens.
  const openAdd = useCallback(() => {
    setMenu(null);
    if (canEdit) setDialog({ kind: 'add' });
  }, [canEdit]);
  const openDialog = useCallback(
    (kind: 'field' | 'type' | 'options', key: string) => {
      setMenu(null);
      if (canEdit && col(key)) setDialog({ kind, key });
    },
    [canEdit, col],
  );

  const change = useCallback((next: Column[]) => keep(next), [keep]);
  const closed = useCallback((f: () => void) => {
    setMenu(null);
    f();
  }, []);
  const finish = useCallback(
    (
      result: { cols: Column[] } | { problem: FieldProblem },
      mode: 'add' | 'edit',
    ): string | null => {
      if ('problem' in result) return PROBLEM_WORDS[result.problem][mode];
      setDialog(null);
      change(result.cols);
      return null;
    },
    [change],
  );

  return {
    entity,
    loaded,
    canEdit,
    all,
    shown,
    col,
    menu,
    dialog,
    openMenu,
    openPicker,
    openAdd,
    openField: key => openDialog('field', key),
    openType: key => openDialog('type', key),
    openOptions: key => openDialog('options', key),
    closeMenu,
    closeDialog,
    setVisible: (key, on) => change(setVisible(all, key, on)),
    rename: key =>
      closed(() => {
        const c = col(key);
        if (!c) return;
        const typed = window.prompt('Column name', c.label);
        if (typed && typed.trim()) change(rename(all, key, typed));
      }),
    move: (key, dir) => closed(() => change(move(all, key, dir))),
    reorder: (src, target) => {
      if (src !== target) change(reorder(all, src, target));
    },
    hide: key => closed(() => change(hide(all, key))),
    remove: key =>
      closed(() => {
        const c = col(key);
        if (!c) return;
        if (
          !window.confirm(
            `Delete column "${c.label}"? Saved values stay on the records but won't be shown.`,
          )
        )
          return;
        change(remove(all, key));
      }),
    saveNew: f => finish(addField(all, f), 'add'),
    saveField: (key, f) => finish(editField(all, key, f), 'edit'),
    saveType: (key, type, lines) => finish(changeType(all, key, type, lines), 'add'),
    saveOptions: (key, options) => finish(setOptions(all, key, options), 'add'),
  };
}
