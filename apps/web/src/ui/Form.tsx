import type { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Form.module.css';

/** The classic sheets' `.form-group`: one field with its label. */
export function FormGroup({
  children,
  part,
  style,
}: {
  children: ReactNode;
  part?: string;
  /** a group that is not the plain column of a label over a field (a row of two small ones) says how */
  style?: CSSProperties;
}) {
  return (
    <div className={styles['group']} style={style} data-part={part ?? 'group'}>
      {children}
    </div>
  );
}

/** …its `.form-label`. */
export function FormLabel({
  children,
  htmlFor,
  part,
}: {
  children: ReactNode;
  htmlFor?: string;
  part?: string;
}) {
  return (
    <label className={styles['label']} htmlFor={htmlFor} data-part={part ?? 'label'}>
      {children}
    </label>
  );
}

type WithPart<T> = T & { part?: string };

/** …and its `.form-control`: a line of text, a number, a date, a link. */
export function Control({
  part,
  className,
  ...rest
}: WithPart<InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <input {...rest} className={cx(styles['control'], className)} data-part={part ?? 'control'} />
  );
}

/** …or several lines. */
export function TextControl({
  part,
  className,
  ...rest
}: WithPart<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  return (
    <textarea
      {...rest}
      className={cx(styles['control'], className)}
      data-part={part ?? 'control'}
    />
  );
}
