import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../app/shell/icons';
import { Btn } from '../ui/Btn';
import { cx } from '../ui/cx';
import { Control, FormGroup, FormLabel, TextControl } from '../ui/Form';
import styles from './columns.module.css';
import {
  COLUMN_ICONS,
  editChipOf,
  hasOptions,
  NO_COLOUR,
  optionsOfRows,
  parseOptionLines,
  rowsOfOptions,
  TYPE_CHOICES,
  typeChipOf,
  visibleColumns,
  widthOf,
  type Column,
  type ColumnType,
} from './model';
import type { Columns } from './useColumns';

// ── The floating menu: one column's, or the list of all of them ────────────────────────────────────────────────────────────

function Item({
  icon,
  size = 13,
  children,
  onClick,
  disabled,
  danger,
  part,
}: {
  icon: string;
  size?: number;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  part?: string;
}) {
  return (
    <button
      type="button"
      className={danger ? styles['danger'] : undefined}
      disabled={disabled ?? false}
      data-part={part}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
      {children}
    </button>
  );
}

function Sep() {
  return <div className={styles['sep']} />;
}

function ColumnMenu({ columns, col }: { columns: Columns; col: Column }) {
  const shown = visibleColumns(columns.all);
  const at = shown.findIndex(c => c.key === col.key);
  const canType = col.type !== 'virtual';
  if (!columns.canEdit) return null;
  return (
    <>
      {canType && (
        <Item icon={COLUMN_ICONS.field} part="menuField" onClick={() => columns.openField(col.key)}>
          Edit field…
        </Item>
      )}
      <Item icon={COLUMN_ICONS.edit} part="menuRename" onClick={() => columns.rename(col.key)}>
        Rename
      </Item>
      {canType && (
        <Item icon={COLUMN_ICONS.type} part="menuType" onClick={() => columns.openType(col.key)}>
          Change type
        </Item>
      )}
      {hasOptions(col.type) && (
        <Item
          icon={COLUMN_ICONS.options}
          part="menuOptions"
          onClick={() => columns.openOptions(col.key)}
        >
          Edit options
        </Item>
      )}
      <Sep />
      <Item
        icon={COLUMN_ICONS.left}
        part="menuLeft"
        disabled={at <= 0}
        onClick={() => columns.move(col.key, -1)}
      >
        Move left
      </Item>
      <Item
        icon={COLUMN_ICONS.right}
        part="menuRight"
        disabled={at >= shown.length - 1}
        onClick={() => columns.move(col.key, 1)}
      >
        Move right
      </Item>
      <Sep />
      <Item icon={COLUMN_ICONS.hidden} part="menuHide" onClick={() => columns.hide(col.key)}>
        Hide column
      </Item>
      <Item
        danger
        icon={COLUMN_ICONS.remove}
        part="menuDelete"
        onClick={() => columns.remove(col.key)}
      >
        Delete column
      </Item>
    </>
  );
}

function Picker({ columns }: { columns: Columns }) {
  return (
    <>
      <div className={styles['pickHead']} data-part="pickHead">
        Columns
      </div>
      {columns.all
        .filter(c => !c.deleted)
        .map(c => (
          <div key={c.key} className={styles['row']} data-part="pickRow">
            <button
              type="button"
              className={cx(styles['eye'], !c.visible && styles['colHidden'])}
              data-part="pickEye"
              onClick={e => {
                e.stopPropagation();
                columns.setVisible(c.key, !c.visible);
              }}
            >
              <Icon name={c.visible ? COLUMN_ICONS.shown : COLUMN_ICONS.hidden} size={14} />
              {c.label}
            </button>
            {columns.canEdit && c.type !== 'virtual' && (
              <button
                type="button"
                className={styles['pencil']}
                title="Edit field — type, options, colors"
                data-part="pickEdit"
                onClick={e => {
                  e.stopPropagation();
                  columns.openField(c.key);
                }}
              >
                <Icon name={COLUMN_ICONS.edit} size={13} />
              </button>
            )}
          </div>
        ))}
      {columns.canEdit && (
        <>
          <Sep />
          <button
            type="button"
            data-part="pickAdd"
            onClick={e => {
              e.stopPropagation();
              columns.openAdd();
            }}
          >
            <Icon name={COLUMN_ICONS.add} size={13} />
            Add field
          </button>
        </>
      )}
    </>
  );
}

function FloatingMenu({ columns }: { columns: Columns }) {
  const { menu, closeMenu } = columns;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    // A click anywhere else puts it away (the one that opened it never gets this far: the chevron and the button stop it).
    // Escape does too — and is this menu's, so a dialog it was opened over stays.
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeMenu();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu, closeMenu]);
  if (!menu) return null;
  const col = menu.kind === 'column' ? columns.col(menu.key) : undefined;
  return createPortal(
    <div
      ref={box}
      className={styles['menu']}
      style={{ left: menu.x, top: menu.y }}
      data-part="colMenu"
      data-mode={menu.kind === 'picker' ? 'picker' : 'colmenu'}
    >
      {menu.kind === 'picker' ? (
        <Picker columns={columns} />
      ) : (
        col && <ColumnMenu columns={columns} col={col} />
      )}
    </div>,
    document.body,
  );
}

// ── The editor's own dialogs ───────────────────────────────────────────────────────────────────────────────────────────────
// They stack above whatever is open (a sheet being filled in, a supplier's catalogue) and go back to it: Escape and a press on
// the curtain close this layer only. Focus goes to the first field and Tab stays among these.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])';

function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input:not([type=hidden]), select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // (the dialog under this one keeps its own Tab to itself while this one is open)
      e.stopPropagation();
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
      } else if (!box.current?.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  return createPortal(
    <div
      className={styles['overlay']}
      data-part="ceCurtain"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={styles['box']}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-part="ceDialog"
      >
        <div className={styles['head']} data-part="ceHead">
          <span data-part="ceTitle">{title}</span>
          <button
            type="button"
            className={styles['x']}
            aria-label="Close"
            data-part="ceClose"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div className={styles['body']} data-part="ceBody">
          {children}
        </div>
        <div className={styles['foot']} data-part="ceFoot">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Field types as chips rather than a dropdown: a native popup inside a stacked dialog is drawn behind it in some browsers. */
function TypeChips({ value, onPick }: { value: ColumnType; onPick: (t: ColumnType) => void }) {
  return (
    <div className={styles['types']} data-part="ceTypes">
      {TYPE_CHOICES.map(([t, label]) => (
        <button
          key={t}
          type="button"
          className={cx(styles['type'], t === value && styles['on'])}
          aria-pressed={t === value}
          data-part="ceType"
          data-ce-type={t}
          onClick={() => onPick(t)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface Row {
  id: number;
  key: string;
  label: string;
  color: string;
  fresh?: boolean;
}

let rowIds = 0;
const rowsFrom = (col: Column | undefined): Row[] =>
  rowsOfOptions(col?.options).map(r => ({ ...r, id: ++rowIds }));

function OptionRows({
  rows,
  setRows,
  hint,
}: {
  rows: Row[];
  setRows: (next: Row[]) => void;
  hint: ReactNode;
}) {
  return (
    <>
      <div data-part="ceOptList">
        {rows.map(r => (
          <div key={r.id} className={styles['optRow']} data-part="ceOptRow">
            <Control
              part="ceOptLabel"
              value={r.label}
              placeholder="Option label"
              style={{ flex: 1 }}
              autoFocus={r.fresh ?? false}
              onChange={e =>
                setRows(rows.map(x => (x.id === r.id ? { ...x, label: e.target.value } : x)))
              }
            />
            <input
              type="color"
              className={styles['swatch']}
              title="Badge color"
              data-part="ceOptColor"
              value={r.color || NO_COLOUR}
              onChange={e =>
                setRows(rows.map(x => (x.id === r.id ? { ...x, color: e.target.value } : x)))
              }
            />
            <button
              type="button"
              className={styles['optX']}
              title="Remove"
              data-part="ceOptRemove"
              onClick={() => setRows(rows.filter(x => x.id !== r.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <Btn
        small
        data-part="ceAddOpt"
        onClick={() =>
          setRows([...rows, { id: ++rowIds, key: '', label: '', color: '', fresh: true }])
        }
      >
        + Add option
      </Btn>
      {hint}
    </>
  );
}

const asRows = (rows: Row[]) => rows.map(({ key, label, color }) => ({ key, label, color }));

function Footer({
  onCancel,
  onSave,
  save,
}: {
  onCancel: () => void;
  onSave: () => void;
  save: string;
}) {
  return (
    <>
      <Btn data-part="ceCancel" onClick={onCancel}>
        Cancel
      </Btn>
      <Btn kind="primary" data-part="ceSave" onClick={onSave}>
        {save}
      </Btn>
    </>
  );
}

/** What a field is asked besides its name and type: whether forms require it, and how wide it is. */
function RequiredAndWidth({
  required,
  setRequired,
  width,
  setWidth,
  wrap,
}: {
  required: boolean;
  setRequired: (v: boolean) => void;
  width: string;
  setWidth: (v: string) => void;
  wrap?: boolean;
}) {
  return (
    <FormGroup
      part="ceExtras"
      style={{
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        ...(wrap ? { flexWrap: 'wrap' } : {}),
      }}
    >
      <label className={styles['tick']}>
        <input
          type="checkbox"
          className={styles['accent']}
          checked={required}
          data-part="ceRequired"
          onChange={e => setRequired(e.target.checked)}
        />{' '}
        Required in forms
      </label>
      <label className={styles['widthLabel']}>
        Width{' '}
        <Control
          part="ceWidth"
          type="number"
          min={40}
          max={800}
          placeholder="auto"
          style={{ width: 90 }}
          value={width}
          onChange={e => setWidth(e.target.value)}
        />{' '}
        px
      </label>
    </FormGroup>
  );
}

const alertAbout = (problem: string | null) => {
  if (problem) window.alert(problem);
};

function AddDialog({ columns }: { columns: Columns }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [lines, setLines] = useState('');
  const [required, setRequired] = useState(false);
  const [width, setWidth] = useState('');
  const save = () =>
    alertAbout(
      columns.saveNew({
        label,
        type,
        options: hasOptions(type) ? parseOptionLines(lines) : [],
        required,
        width: widthOf(width),
      }),
    );
  return (
    <Dialog
      title="Add Column"
      onClose={columns.closeDialog}
      footer={<Footer onCancel={columns.closeDialog} onSave={save} save="Add column" />}
    >
      <FormGroup part="ceGroup">
        <FormLabel part="ceLabel">Column name</FormLabel>
        <Control
          part="ceName"
          value={label}
          placeholder="e.g. Insurance status"
          onChange={e => setLabel(e.target.value)}
        />
      </FormGroup>
      <FormGroup part="ceGroup">
        <FormLabel part="ceLabel">Type</FormLabel>
        <TypeChips value={type} onPick={setType} />
      </FormGroup>
      {hasOptions(type) && (
        <FormGroup part="ceGroup">
          <FormLabel part="ceLabel">Options — one per line</FormLabel>
          <TextControl
            part="ceOptions"
            rows={4}
            placeholder={'Pending\nApproved\nRejected'}
            value={lines}
            onChange={e => setLines(e.target.value)}
          />
        </FormGroup>
      )}
      <RequiredAndWidth
        required={required}
        setRequired={setRequired}
        width={width}
        setWidth={setWidth}
      />
    </Dialog>
  );
}

function FieldDialog({ columns, col }: { columns: Columns; col: Column }) {
  const [label, setLabel] = useState(col.label);
  const [type, setType] = useState<ColumnType>(editChipOf(col.type));
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(col));
  const [required, setRequired] = useState(col.required === true);
  const [width, setWidth] = useState(col.width ? String(col.width) : '');
  // Switching to a dropdown with nothing to choose from is the commonest way to end up with an empty one, so the first option
  // is given.
  const pick = (t: ColumnType) => {
    setType(t);
    if (hasOptions(t) && rows.length === 0)
      setRows([{ id: ++rowIds, key: '', label: '', color: '', fresh: true }]);
  };
  const save = () =>
    alertAbout(
      columns.saveField(col.key, {
        label,
        type,
        options: optionsOfRows(asRows(rows)),
        required,
        width: widthOf(width),
      }),
    );
  return (
    <Dialog
      title={'Edit Field — ' + col.label}
      onClose={columns.closeDialog}
      footer={<Footer onCancel={columns.closeDialog} onSave={save} save="Save field" />}
    >
      <FormGroup part="ceGroup">
        <FormLabel part="ceLabel">Field name</FormLabel>
        <Control part="ceName" value={label} onChange={e => setLabel(e.target.value)} />
      </FormGroup>
      <FormGroup part="ceGroup">
        <FormLabel part="ceLabel">Type</FormLabel>
        <TypeChips value={type} onPick={pick} />
      </FormGroup>
      {hasOptions(type) && (
        <div data-part="ceOptionsWrap">
          <FormLabel part="ceLabel">Options</FormLabel>
          <OptionRows
            rows={rows}
            setRows={setRows}
            hint={
              <div className={cx(styles['hint'], styles['hintField'])} data-part="ceHint">
                The color paints the value&apos;s badge in tables and cards.
              </div>
            }
          />
        </div>
      )}
      <RequiredAndWidth
        required={required}
        setRequired={setRequired}
        width={width}
        setWidth={setWidth}
        wrap
      />
    </Dialog>
  );
}

function TypeDialog({ columns, col }: { columns: Columns; col: Column }) {
  const [type, setType] = useState<ColumnType>(typeChipOf(col.type));
  const [lines, setLines] = useState((col.options ?? []).map(o => o.label).join('\n'));
  return (
    <Dialog
      title={'Change Type — ' + col.label}
      onClose={columns.closeDialog}
      footer={
        <Footer
          onCancel={columns.closeDialog}
          onSave={() => alertAbout(columns.saveType(col.key, type, lines))}
          save="Save"
        />
      }
    >
      <FormGroup part="ceGroup">
        <FormLabel part="ceLabel">Type</FormLabel>
        <TypeChips value={type} onPick={setType} />
      </FormGroup>
      {hasOptions(type) && (
        <FormGroup part="ceGroup">
          <FormLabel part="ceLabel">Options — one per line</FormLabel>
          <TextControl
            part="ceOptions"
            rows={4}
            value={lines}
            onChange={e => setLines(e.target.value)}
          />
        </FormGroup>
      )}
    </Dialog>
  );
}

function OptionsDialog({ columns, col }: { columns: Columns; col: Column }) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(col));
  return (
    <Dialog
      title={'Edit Options — ' + col.label}
      onClose={columns.closeDialog}
      footer={
        <Footer
          onCancel={columns.closeDialog}
          onSave={() => alertAbout(columns.saveOptions(col.key, optionsOfRows(asRows(rows))))}
          save="Save options"
        />
      }
    >
      <OptionRows
        rows={rows}
        setRows={setRows}
        hint={
          <div className={cx(styles['hint'], styles['hintOptions'])} data-part="ceHint">
            The color paints the value&apos;s badge in tables and cards.
          </div>
        }
      />
    </Dialog>
  );
}

/**
 * The editor of a table's columns: the menu a header opens, the "Columns" list, and the dialogs they lead to. A screen that has
 * `useColumns` puts this anywhere in its tree; it draws nothing until one of them is asked for.
 */
export function ColumnsLayer({ columns }: { columns: Columns }) {
  const { dialog } = columns;
  const col = dialog && dialog.kind !== 'add' ? columns.col(dialog.key) : undefined;
  return (
    <>
      <FloatingMenu columns={columns} />
      {dialog?.kind === 'add' && <AddDialog columns={columns} />}
      {dialog?.kind === 'field' && col && (
        <FieldDialog key={dialog.key} columns={columns} col={col} />
      )}
      {dialog?.kind === 'type' && col && (
        <TypeDialog key={dialog.key} columns={columns} col={col} />
      )}
      {dialog?.kind === 'options' && col && (
        <OptionsDialog key={dialog.key} columns={columns} col={col} />
      )}
    </>
  );
}
