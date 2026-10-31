import { useCallback, useRef, useState } from 'react';
import { Icon } from '../../app/shell/icons';
import { ColumnsBar, type Columns } from '../../columns';
import { Input } from '../../docs/Fields';
import { LinesGrid } from '../../docs/Lines';
import { savedLines } from '../../docs/model';
import { useRows } from '../../docs/useRows';
import { Btn, Sheet } from '../../ui';
import { FormLabel } from '../../ui/Form';
import docStyles from '../../docs/docs.module.css';
import { useStockWrites } from './data';
import { problemWith, STOCK_ICONS, unitsOf, type Vehicle } from './model';
import styles from './stock.module.css';

/** The words under the grid of cars: one row for each, and the rows are the count. */
const SAID_ROWS =
  'One row per car. These are the stock count — there is no separate total to type in.';

/**
 * A model's form, whole: its make and model (both required), trim and price, a row for each physical car (the columns the
 * administrator has arranged), and notes. The form is asked for once the columns are known — it is made of them.
 */
export function ModelForm({
  id,
  vehicle,
  columns,
  onClose,
}: {
  id: number | null;
  vehicle: Vehicle | undefined;
  columns: Columns;
  onClose: () => void;
}) {
  const writes = useStockWrites();
  const v = id ? vehicle : undefined;
  const text = (x: unknown) => (x == null ? '' : String(x));
  const [make, setMake] = useState(text(v?.make));
  const [model, setModel] = useState(text(v?.model));
  const [trim, setTrim] = useState(text(v?.trim));
  const [price, setPrice] = useState(v?.price == null ? '' : String(v.price));
  const [notes, setNotes] = useState(text(v?.notes));
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  // A car with no status starts as the first of the options it has been given, not as a fixed one: whoever renamed or reordered
  // the statuses gets what they configured on the next new row.
  const statusStart = useCallback(
    () => ({ status: columns.col('status')?.options?.[0]?.key || 'send_to_supplier' }),
    [columns],
  );
  const rows = useRows(v ? [...unitsOf(v)] : [], columns.shown, statusStart, true);
  const legacy = v && !unitsOf(v).length ? Number(v.legacy_count) || 0 : 0;

  const save = async () => {
    if (sending.current) return;
    const body = {
      make: make.trim(),
      model: model.trim(),
      trim: trim.trim(),
      price,
      notes: notes.trim(),
      // (no filtering here: the server decides what counts as a car, and it counts a configured column)
      units: savedLines(
        rows.rows.map(r => r.base),
        rows.rows.map(r => r.values),
      ),
    };
    const problem = problemWith(body);
    if (problem) {
      setError(problem);
      return;
    }
    sending.current = true;
    setError(null);
    const said = await writes.save(id, body);
    sending.current = false;
    if (said.ok) onClose();
    else setError(said.message || 'Failed to save.');
  };

  return (
    <Sheet
      title={v ? 'Edit vehicle' : 'Add vehicle'}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="primary" data-part="save" onClick={() => void save()}>
            {v ? 'Save changes' : 'Add vehicle'}
          </Btn>
        </>
      }
    >
      <div className={styles['form']} data-part="form">
        <div className={styles['formPair']}>
          <div>
            <FormLabel className={styles['formLabel']}>Make *</FormLabel>
            <Input
              id="stk-make"
              value={make}
              placeholder="e.g. Toyota"
              onChange={e => setMake(e.target.value)}
            />
          </div>
          <div>
            <FormLabel className={styles['formLabel']}>Model *</FormLabel>
            <Input
              id="stk-model"
              value={model}
              placeholder="e.g. Corolla"
              onChange={e => setModel(e.target.value)}
            />
          </div>
        </div>
        <div>
          <FormLabel className={styles['formLabel']}>Trim</FormLabel>
          <Input
            id="stk-trim"
            value={trim}
            placeholder="e.g. GLI 1.6 (leave blank if none)"
            onChange={e => setTrim(e.target.value)}
          />
        </div>
        <div>
          <FormLabel className={styles['formLabel']}>Price (EGP)</FormLabel>
          <Input
            id="stk-price"
            type="number"
            min={0}
            step="any"
            value={price}
            placeholder="e.g. 1150000"
            onChange={e => setPrice(e.target.value)}
          />
        </div>
        <div>
          <FormLabel className={styles['formLabel']}>
            Units in stock <span className={styles['hintInline']}>(one row per physical car)</span>
          </FormLabel>
          <LinesGrid
            columns={columns}
            rows={rows.rows}
            change={rows.change}
            remove={rows.remove}
            number={{ label: '#', width: 34 }}
            minWidth={1080}
            removeTitle="Remove"
          />
          <Btn
            style={{ marginTop: 8, padding: '5px 10px', fontSize: 12 }}
            data-part="addUnit"
            onClick={() => rows.add()}
          >
            + Add unit
          </Btn>{' '}
          <ColumnsBar columns={columns} spaced />
          <div className={styles['hintSmall']} data-part="rowsHint">
            {SAID_ROWS}
          </div>
          {legacy > 0 && (
            <div className={styles['legacy']} data-part="legacyNote">
              <Icon name={STOCK_ICONS.warn} size={14} />
              <span>
                {legacy} car{legacy === 1 ? ' was' : 's were'} recorded here before VIN tracking.
                Add {legacy === 1 ? 'it' : 'them'} above to bring this model back into stock.
              </span>
            </div>
          )}
        </div>
        <div>
          <FormLabel className={styles['formLabel']}>Notes</FormLabel>
          <Input
            id="stk-notes"
            value={notes}
            placeholder="Options, delivery notes…"
            onChange={e => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <div className={docStyles['errorLine']} data-part="formError" role="alert">
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}
