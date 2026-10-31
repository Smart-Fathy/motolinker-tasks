import { useRef, useState } from 'react';
import { FieldInput, isTicked, missingRequired, type Column } from '../../columns';
import type { Columns } from '../../columns';
import { BrandSelect, Btn, Sheet } from '../../ui';
import { Control, FormGroup, FormLabel } from '../../ui/Form';
import { useSupplierWrites, type SupplierBody } from './data';
import type { Supplier } from './model';
import styles from './suppliers.module.css';

type BuiltinKey = 'name' | 'contact' | 'country' | 'address' | 'notes';

const known = (col: Column, v: string) => (col.options ?? []).some(o => o.key === v);

/** What a field of the form starts with: what the supplier has (for a dropdown, only if it is still one of its options). */
function initial(col: Column, x: Supplier | null): string | boolean {
  const raw = col.builtin
    ? (x as unknown as Record<string, unknown> | null)?.[col.key]
    : (x?.custom_fields ?? {})[col.key];
  if (col.type === 'checkbox') return isTicked(raw);
  const v = raw == null ? '' : String(raw);
  return (col.type === 'select' || col.type === 'radio') && !known(col, v) ? '' : v;
}

/**
 * A supplier, as a form made of the register's own columns: the five fields of a supplier, in the order and under the names the
 * administrator gave them and as the type they chose (a country can be a dropdown), then whatever fields were added. What the
 * form does not show is kept: a field that was hidden from the register still has its value after the supplier is edited.
 */
export function SupplierForm({
  columns,
  supplier,
  onClose,
}: {
  columns: Columns;
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const writes = useSupplierWrites();
  const shown = columns.shown;
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(shown.map(c => [c.key, initial(c, supplier)])),
  );
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const set = (key: string, v: string | boolean) => setValues(was => ({ ...was, [key]: v }));

  const save = async () => {
    if (sending.current) return;
    const custom = shown.filter(c => !c.builtin);
    const missing = missingRequired(custom, values);
    if (missing.length) return setError('Required: ' + missing.join(', '));
    const seen = (key: BuiltinKey) =>
      shown.some(c => c.builtin && c.key === key)
        ? String(values[key] ?? '').trim()
        : String(supplier?.[key] ?? '');
    const body: SupplierBody = {
      name: seen('name'),
      contact: seen('contact'),
      country: seen('country'),
      address: seen('address'),
      notes: seen('notes'),
      // (what the supplier has under fields that are not on the form stays)
      custom_fields: {
        ...(supplier?.custom_fields ?? {}),
        ...Object.fromEntries(custom.map(c => [c.key, values[c.key] ?? ''])),
      },
    };
    if (!body.name) return setError('Supplier name is required.');
    sending.current = true;
    const out = await writes.save(supplier?.id ?? null, body);
    sending.current = false;
    if (!out.ok) return setError(out.message || 'Failed to save.');
    onClose();
  };

  return (
    <Sheet
      title={supplier ? 'Edit supplier' : 'Add supplier'}
      onClose={onClose}
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="primary" data-part="save" onClick={() => void save()}>
            Save
          </Btn>
        </>
      }
    >
      <div className={styles['fields']} data-part="fields">
        {shown.map(c => {
          const id = 'sup-' + c.key;
          if (!c.builtin)
            return (
              <FieldInput
                key={c.key}
                id={id}
                col={c}
                value={values[c.key]}
                onChange={v => set(c.key, v)}
              />
            );
          const v = String(values[c.key] ?? '');
          if (c.type === 'select' || c.type === 'radio') {
            const options = [
              { value: '', label: '—' },
              ...(c.options ?? []).map(o => ({ value: o.key, label: o.label })),
            ];
            return (
              <FormGroup key={c.key} part="field">
                <FormLabel htmlFor={id} part="fieldLabel">
                  {c.label}
                </FormLabel>
                <BrandSelect
                  id={id}
                  part="fieldSelect"
                  value={v}
                  options={options}
                  onChange={x => set(c.key, x)}
                />
              </FormGroup>
            );
          }
          return (
            <FormGroup key={c.key} part="field">
              <FormLabel htmlFor={id} part="fieldLabel">
                {c.label}
              </FormLabel>
              <Control
                id={id}
                part="fieldInput"
                type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
                value={v}
                onChange={e => set(c.key, e.target.value)}
              />
            </FormGroup>
          );
        })}
      </div>
      {error && (
        <div className={styles['error']} data-part="formError" role="alert">
          {error}
        </div>
      )}
    </Sheet>
  );
}
