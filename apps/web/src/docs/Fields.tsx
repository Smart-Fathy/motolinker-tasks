import type { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import type { Columns } from '../columns';
import { BrandSelect, type SelectOption } from '../ui';
import { cx } from '../ui/cx';
import styles from './docs.module.css';

/** The sheets' `.po-lbl`: the small grey caption over a field of a document. */
export function Lbl({ children, spaced }: { children: ReactNode; spaced?: boolean }) {
  return (
    <div className={cx(styles['lbl'], spaced && styles['lblSpaced'])} data-part="lbl">
      {children}
    </div>
  );
}

/** A row of fields that fits as many to a line as the width allows (the sheets' `repeat(auto-fit, minmax(…, 1fr))`). */
export function Grid({ min, children }: { min: number; children: ReactNode }) {
  const style: CSSProperties = { gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))` };
  return (
    <div className={styles['fieldGrid']} style={style} data-part="fieldGrid">
      {children}
    </div>
  );
}

/** One field: its caption over its control. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div data-part="field">
      <Lbl>{label}</Lbl>
      {children}
    </div>
  );
}

/** The sheets' `input.form-input`. */
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return <input {...rest} className={cx(styles['input'], className)} data-part="input" />;
}

/** …and its `textarea.form-input`. */
export function Area({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }) {
  return <textarea {...rest} className={cx(styles['input'], className)} data-part="area" />;
}

/** A dropdown of the sheets' kind (the branded one the classic pages swap every `select.form-input` for). */
export function Pick({
  id,
  value,
  options,
  onChange,
}: {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (v: string) => void;
}) {
  return (
    <BrandSelect
      {...(id ? { id } : {})}
      part="pick"
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

/**
 * The document's own Status as a dropdown, drawn from the options the administrator has left it (renamed, recoloured, added
 * to). The stored value survives an option being renamed (keys are stable) and is kept as one more choice when its option was
 * deleted, so that editing a document cannot quietly change its status.
 */
export function StatusPick({
  columns,
  value,
  onChange,
  id,
}: {
  columns: Columns;
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  const options = columns.col('status')?.options ?? [];
  const current = value || options[0]?.key || '';
  const known = options.some(o => o.key === current);
  const list: SelectOption[] = options.map(o => ({ value: o.key, label: o.label }));
  if (!known && current) list.push({ value: current, label: current });
  return <Pick id={id} value={current} options={list} onChange={onChange} />;
}
