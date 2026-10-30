import { useId, type InputHTMLAttributes, type Ref } from 'react';
import styles from './Field.module.css';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  /** What the field is for. Always present for a screen reader; drawn only where the look has a label. */
  label: string;
  ref?: Ref<HTMLInputElement>;
}

export function Field({ label, ref, ...input }: FieldProps) {
  const id = useId();
  return (
    <div className={styles['field']} data-part="field">
      <label htmlFor={id} className={styles['label']} data-part="label">
        {label}
      </label>
      <input {...input} ref={ref} id={id} className={styles['input']} data-part="input" />
    </div>
  );
}
