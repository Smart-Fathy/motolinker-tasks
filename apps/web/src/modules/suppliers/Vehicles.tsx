import { can } from '@motolinker/contracts/access';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import {
  ColumnHeader,
  ColumnsBar,
  ColumnsLayer,
  GRID_CELL,
  GRID_HEAD,
  GRID_ROW,
  GridInput,
  useColumns,
  type Column,
} from '../../columns';
import { Btn } from '../../ui';
import { PaneError, PaneLoading } from './Detail';
import { useVehicles, useVehicleWrites } from './data';
import { SUPPLIER_ICONS, VEHICLE_COLUMNS, type Vehicle } from './model';
import styles from './suppliers.module.css';

/** What a cell holds, for the grid: the builtin fields are the vehicle's own, anything added rides in `custom_fields`. */
function valueOf(v: Vehicle, c: Column): unknown {
  if (!c.builtin) return (v.custom_fields ?? {})[c.key] ?? '';
  const raw = (v as unknown as Record<string, unknown>)[c.key];
  return c.key === 'fob_price' && raw ? Number(raw) : (raw ?? '');
}

/**
 * The whole of a vehicle as the server takes it back: a change to one cell saves the row it is in, and the row keeps every
 * field the grid does not show (the currency, the notes, a column that was hidden, a field that was deleted) as it was.
 */
function bodyOf(
  v: Vehicle,
  cols: readonly Column[],
  edit: { col: Column; value: string | boolean },
) {
  const custom: Record<string, unknown> = { ...(v.custom_fields ?? {}) };
  const own: Record<string, unknown> = {
    brand: v.brand,
    model: v.model,
    trim: v.trim,
    model_year: v.model_year,
    availability: v.availability,
    fob_price: v.fob_price,
    currency: v.currency,
    lead_time: v.lead_time,
    accessories: v.accessories,
    notes: v.notes,
  };
  for (const c of cols) {
    if (c.key !== edit.col.key) continue;
    if (c.builtin) own[c.key] = edit.value;
    else custom[c.key] = edit.value;
  }
  return { ...own, custom_fields: custom };
}

function Row({
  v,
  cols,
  editable,
  save,
  remove,
}: {
  v: Vehicle;
  cols: readonly Column[];
  editable: boolean;
  save: (v: Vehicle, edit: { col: Column; value: string | boolean }) => void;
  remove: (v: Vehicle) => void;
}) {
  return (
    <tr className={GRID_ROW} data-part="vehicleRow" data-vid={v.id}>
      {cols.map(c =>
        editable ? (
          <GridInput
            key={c.key}
            col={c}
            value={valueOf(v, c)}
            onCommit={value => save(v, { col: c, value })}
          />
        ) : (
          <td key={c.key} className={GRID_CELL} data-part="gridCell">
            {String(valueOf(v, c) ?? '')}
          </td>
        ),
      )}
      <td className={GRID_CELL}>
        {editable && (
          <Btn
            danger
            style={{ padding: '2px 6px' }}
            data-part="vehicleDelete"
            onClick={() => remove(v)}
          >
            <Icon name={SUPPLIER_ICONS.gone} size={12} />
          </Btn>
        )}
      </td>
    </tr>
  );
}

/** What a supplier offers: the catalogue the RFQ and purchase-order lines pick from. Whoever may manage it edits it in place. */
export function Vehicles({ id }: { id: number }) {
  const { access, toasts } = useSession();
  const columns = useColumns('supplier_vehicles', VEHICLE_COLUMNS);
  const list = useVehicles(id);
  const writes = useVehicleWrites(id);
  const editable = can(access.actor, 'suppliers.catalogue');
  // (the rows as they are now: a cell saved is kept here, and the next one saves the row with it)
  const [latest, setLatest] = useState<Record<number, Vehicle>>({});

  if (list.loading || !columns.loaded) return <PaneLoading />;
  if (list.error) return <PaneError message={list.error} />;
  const rows = (list.data ?? []).map(v => latest[v.id] ?? v);

  const save = (v: Vehicle, edit: { col: Column; value: string | boolean }) => {
    const body = bodyOf(v, columns.shown, edit);
    setLatest(was => ({
      ...was,
      [v.id]: {
        ...v,
        ...(edit.col.builtin ? { [edit.col.key]: edit.value } : {}),
        custom_fields: body.custom_fields,
      } as Vehicle,
    }));
    void writes.save(v.id, body).then(out => {
      if (!out.ok) toasts.show('Could not save that change.');
    });
  };
  const add = () =>
    void writes.add().then(out => {
      if (!out.ok) toasts.show('Could not add that row.');
    });
  const remove = (v: Vehicle) => {
    if (!window.confirm('Remove this vehicle from the supplier list?')) return;
    void writes.remove(v.id).then(out => {
      if (!out.ok) toasts.show('Could not remove that vehicle.');
    });
  };

  return (
    <>
      <div className={styles['vehBar']} data-part="vehicleBar">
        <ColumnsBar columns={columns} />
        {editable && (
          <Btn small data-part="addVehicle" onClick={add}>
            <Icon name={SUPPLIER_ICONS.add} size={13} /> Add vehicle
          </Btn>
        )}
      </div>
      <div className={styles['gridBox']} data-part="gridBox">
        <table className={styles['gridTable']} data-part="gridTable">
          <thead>
            <tr>
              {columns.shown.map(c => (
                <ColumnHeader
                  key={c.key}
                  columns={columns}
                  col={c}
                  className={GRID_HEAD}
                  style={{ minWidth: c.width || 100 }}
                  part="gridHead"
                />
              ))}
              <th className={GRID_HEAD} style={{ width: 38 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(v => (
              <Row
                key={v.id}
                v={v}
                cols={columns.shown}
                editable={editable}
                save={save}
                remove={remove}
              />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className={styles['nothing']} data-part="nothing">
          Nothing listed yet. Add what this supplier offers so RFQs and purchase orders can pick
          from it.
        </div>
      )}
      <ColumnsLayer columns={columns} />
    </>
  );
}
