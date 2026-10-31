import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Icon } from '../app/shell/icons';
import { BrandSelect } from '../ui/BrandSelect';
import { Btn } from '../ui/Btn';
import { cx } from '../ui/cx';
import { Control, FormGroup, FormLabel } from '../ui/Form';
import styles from './columns.module.css';
import { badgeOf, COLUMN_ICONS, hexA, isTicked, linkLabel, linkUrl, type Column } from './model';
import type { Columns } from './useColumns';

// ── In a header ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The two buttons above a table that has editable columns ("Columns" and "+ Field"); nothing for those who may not edit. */
export function ColumnsBar({ columns }: { columns: Columns }) {
  if (!columns.canEdit) return null;
  const small: CSSProperties = { padding: '4px 10px', fontSize: 12 };
  return (
    <>
      <Btn style={small} data-part="colsButton" onClick={e => columns.openPicker(e)}>
        Columns
      </Btn>
      <Btn style={small} data-part="fieldButton" onClick={() => columns.openAdd()}>
        + Field
      </Btn>
    </>
  );
}

/** A header cell with the column's menu behind a chevron — the way into a field's type, options and colours. */
export function ColumnHeader({
  columns,
  col,
  className,
  style,
  part,
}: {
  columns: Columns;
  col: Column;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  part?: string;
}) {
  const open = (e: MouseEvent | KeyboardEvent) => {
    if ('key' in e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      columns.openMenu(
        {
          clientX: r.left,
          clientY: r.bottom,
          stopPropagation: () => e.stopPropagation(),
        } as MouseEvent,
        col.key,
      );
      return;
    }
    columns.openMenu(e, col.key);
  };
  return (
    <th className={className} style={style} data-part={part ?? 'th'}>
      {col.label}
      {columns.canEdit && (
        <span
          role="button"
          tabIndex={0}
          className={styles['chev']}
          title="Field options — type, dropdown options, colors"
          data-part="chevron"
          onClick={open}
          onKeyDown={open}
        >
          <Icon name={COLUMN_ICONS.chevron} size={11} />
        </span>
      )}
    </th>
  );
}

// ── What a value looks like ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A dropdown's value as a badge, in the colour its option was given (or neutral). */
export function Badge({
  col,
  value,
  label,
}: {
  col: Pick<Column, 'options'> | undefined;
  value: unknown;
  label?: string;
}) {
  const { text, hex } = badgeOf(col, value, label);
  const style = (
    hex
      ? {
          '--ce-c': hex,
          background: hexA(hex, 0.12),
          border: `1px solid ${hexA(hex, 0.3)}`,
        }
      : undefined
  ) as CSSProperties | undefined;
  return (
    <span className={cx(styles['pill'], hex && styles['coloured'])} style={style} data-part="badge">
      {text}
    </span>
  );
}

/** What a link column holds, as a link — or as the text it is, when it is not one. */
export function LinkCell({ raw, empty }: { raw: unknown; empty?: string }) {
  const href = linkUrl(raw);
  if (!href) {
    const s = String(raw == null ? '' : raw).trim();
    return <>{s || (empty ?? '—')}</>;
  }
  return (
    <a
      className={styles['link']}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      data-part="link"
      onClick={e => e.stopPropagation()}
    >
      <Icon name={COLUMN_ICONS.link} size={12} />
      {linkLabel(href)}
    </a>
  );
}

/** The cell of a field somebody added, for a record that keeps it in `custom_fields`. */
export function CustomCell({
  col,
  record,
}: {
  col: Column;
  record: { custom_fields?: Record<string, unknown> | null };
}) {
  // (on a phone a table is read as a card for each row, and each cell says whose it is: the column's heading, written on it)
  const raw = (record.custom_fields ?? {})[col.key];
  if (col.type === 'select' || col.type === 'radio')
    return (
      <td className={styles['cell']} data-part="cell" data-label={col.label}>
        <Badge col={col} value={raw} />
      </td>
    );
  if (col.type === 'checkbox')
    return (
      <td className={cx(styles['cell'], styles['centre'])} data-part="cell" data-label={col.label}>
        {raw === true || raw === 'true' ? '✓' : '—'}
      </td>
    );
  if (col.type === 'link')
    return (
      <td className={styles['cell']} data-part="cell" data-label={col.label}>
        <LinkCell raw={raw} />
      </td>
    );
  return (
    <td className={styles['cell']} data-part="cell" data-label={col.label}>
      {raw == null ? '' : String(raw)}
    </td>
  );
}

// ── In a form ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a field of a form says it is called: its label, and a star where a form requires it. */
export function FieldLabel({ col, htmlFor }: { col: Column; htmlFor?: string }) {
  return (
    <FormLabel htmlFor={htmlFor} part="fieldLabel">
      {col.label}
      {col.required && (
        <>
          {' '}
          <span className={styles['star']}>*</span>
        </>
      )}
    </FormLabel>
  );
}

/** One column as a field of a form, for its configured type: a dropdown, a box to tick, a link, a number, a date or text. */
export function FieldInput({
  col,
  value,
  onChange,
  id,
}: {
  col: Column;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
  id: string;
}) {
  if (col.type === 'select' || col.type === 'radio') {
    const v = value == null ? '' : String(value);
    const options = [
      { value: '', label: '—' },
      ...(col.options ?? []).map(o => ({ value: o.key, label: o.label })),
    ];
    return (
      <FormGroup part="field">
        <FieldLabel col={col} htmlFor={id} />
        <BrandSelect
          id={id}
          part="fieldSelect"
          value={options.some(o => o.value === v) ? v : ''}
          options={options}
          onChange={onChange}
        />
      </FormGroup>
    );
  }
  if (col.type === 'checkbox') {
    return (
      <FormGroup part="field">
        <label className={styles['tickLabel']} data-part="fieldTick">
          <input
            id={id}
            type="checkbox"
            checked={isTicked(value)}
            data-part="fieldBox"
            onChange={e => onChange(e.target.checked)}
          />{' '}
          {col.label}
          {col.required && (
            <>
              {' '}
              <span className={styles['star']}>*</span>
            </>
          )}
        </label>
      </FormGroup>
    );
  }
  const typed =
    col.type === 'link'
      ? 'url'
      : col.type === 'number'
        ? 'number'
        : col.type === 'date'
          ? 'date'
          : 'text';
  return (
    <FormGroup part="field">
      <FieldLabel col={col} htmlFor={id} />
      <Control
        id={id}
        part="fieldInput"
        type={typed}
        value={value == null ? '' : String(value)}
        {...(col.type === 'link' ? { inputMode: 'url' as const, placeholder: 'https://…' } : {})}
        onChange={e => onChange(e.target.value)}
      />
    </FormGroup>
  );
}

// ── In a grid of lines ──────────────────────────────────────────────────────────────────────────────────────────────────────

const GRID_STYLE: CSSProperties = { fontSize: 12, padding: '5px 6px' };
/** Long free text keeps the box it was designed with. */
const AREA_STYLE: CSSProperties = { fontSize: 11.5, padding: '5px 6px', resize: 'vertical' };

/**
 * One cell of a grid of lines (a supplier's catalogue, the lines of an order), drawn for its configured type. A change is
 * handed over when it is made — a dropdown or a box at once, text when it is left or Enter is pressed (the browser's own
 * "change") — and the cell keeps what was typed; it is not drawn again from what the server answers.
 */
export function GridInput({
  col,
  value,
  onCommit,
}: {
  col: Column;
  value: unknown;
  onCommit: (value: string | boolean) => void;
}) {
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const onChange = () =>
      commit.current(
        el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value,
      );
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  const text = value == null ? '' : String(value);

  if (col.type === 'select' || col.type === 'radio') {
    const options = [
      { value: '', label: '—' },
      ...(col.options ?? []).map(o => ({ value: o.key, label: o.label })),
    ];
    return (
      <td className={styles['gridCell']} data-part="gridCell">
        <BrandSelect
          part="gridSelect"
          style={GRID_STYLE}
          value={options.some(o => o.value === text) ? text : ''}
          options={options}
          onChange={onCommit}
        />
      </td>
    );
  }
  if (col.type === 'checkbox') {
    return (
      <td className={cx(styles['gridCell'], styles['centre'])} data-part="gridCell">
        <input
          ref={field as React.RefObject<HTMLInputElement>}
          type="checkbox"
          className={styles['accent']}
          defaultChecked={isTicked(value)}
          data-part="gridBox"
        />
      </td>
    );
  }
  // Long free text keeps the box it was designed with.
  if (col.key === 'accessories') {
    return (
      <td className={styles['gridCell']} data-part="gridCell">
        <textarea
          ref={field as React.RefObject<HTMLTextAreaElement>}
          className={styles['gridInput']}
          style={AREA_STYLE}
          rows={2}
          defaultValue={text}
          data-part="gridArea"
        />
      </td>
    );
  }
  const type =
    col.type === 'number'
      ? 'number'
      : col.type === 'date'
        ? 'date'
        : col.type === 'link'
          ? 'url'
          : 'text';
  return (
    <td className={styles['gridCell']} data-part="gridCell">
      <input
        ref={field as React.RefObject<HTMLInputElement>}
        className={styles['gridInput']}
        style={GRID_STYLE}
        type={type}
        {...(type === 'number' ? { min: 0 } : {})}
        {...(type === 'url' ? { inputMode: 'url' as const, placeholder: 'https://…' } : {})}
        defaultValue={text}
        data-part="gridInput"
      />
    </td>
  );
}
