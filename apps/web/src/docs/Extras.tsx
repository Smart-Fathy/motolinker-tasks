import { ColumnsBar, FieldInput, type Column, type Columns } from '../columns';
import styles from './docs.module.css';

/**
 * The extra fields the administrator added to this kind of document, under "Additional fields", with the way to add more
 * ("Columns" and "+ Field", for the administrator alone). A document with none and nobody who may add one has no such block.
 * The values ride in the record's `custom_fields`; a field that is hidden is not drawn but keeps its value.
 */
export function Extras({
  columns,
  values,
  onChange,
  prefix,
}: {
  columns: Columns;
  values: Readonly<Record<string, string | boolean>>;
  onChange: (key: string, value: string | boolean) => void;
  /** the form's own, so that two forms never share an id */
  prefix: string;
}) {
  const extras: Column[] = columns.shown.filter(c => !c.builtin);
  if (!extras.length && !columns.canEdit) return null;
  return (
    <div data-part="extras">
      <div className={styles['extrasHead']} data-part="extrasHead">
        <div className={styles['lbl']} data-part="lbl">
          Additional fields
        </div>
        <div className={styles['extrasButtons']} data-part="extrasButtons">
          <ColumnsBar columns={columns} />
        </div>
      </div>
      {extras.length ? (
        <div className={styles['extrasGrid']} data-part="extrasGrid">
          {extras.map(c => (
            <FieldInput
              key={c.key}
              id={`${prefix}-cf-${c.key}`}
              col={c}
              value={values[c.key]}
              onChange={v => onChange(c.key, v)}
            />
          ))}
        </div>
      ) : (
        <div className={styles['extrasNone']} data-part="extrasNone">
          None yet — "+ Field" adds one to every document of this kind.
        </div>
      )}
    </div>
  );
}
