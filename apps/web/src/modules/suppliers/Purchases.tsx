import { GRID_CELL, GRID_HEAD } from '../../columns';
import { cx } from '../../ui/cx';
import { PaneError, PaneLoading } from './Detail';
import { usePurchases } from './data';
import { carOf, money } from './model';
import styles from './suppliers.module.css';

/** What was actually bought from a supplier: the cars received, the lines ordered, and the figures over both. */
export function Purchases({ id }: { id: number }) {
  const q = usePurchases(id);
  if (q.loading) return <PaneLoading />;
  if (q.error) return <PaneError message={q.error} />;
  const p = q.data ?? {
    units: [],
    poLines: [],
    totals: { vehicles: 0, ordered: 0, avg_unit_price: 0, avg_po_price: 0, lead_times: [] },
  };
  const t = p.totals;
  return (
    <>
      <div className={styles['tiles']} data-part="tiles">
        {(
          [
            ['Cars received', t.vehicles || 0],
            ['Ordered on POs', t.ordered || 0],
            ['Avg price paid', money(t.avg_unit_price)],
            ['Avg PO price', money(t.avg_po_price)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className={styles['tile']} data-part="tile">
            <div className={styles['tileTitle']}>{label}</div>
            <div className={styles['tileBig']}>{value}</div>
          </div>
        ))}
      </div>
      {t.lead_times.length > 0 && (
        <div className={styles['leadTimes']} data-part="leadTimes">
          Quoted lead times seen: {t.lead_times.join(' · ')}
        </div>
      )}
      <div className={styles['secLabel']}>Cars received ({p.units.length})</div>
      {p.units.length ? (
        <div className={cx(styles['box'], styles['boxGap'])} data-part="unitsBox">
          <table className={styles['plainTable']}>
            <thead>
              <tr>
                <th className={GRID_HEAD}>Model</th>
                <th className={GRID_HEAD}>VIN</th>
                <th className={GRID_HEAD}>Colour</th>
                <th className={GRID_HEAD} style={{ textAlign: 'right' }}>
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {p.units.map((u, i) => (
                <tr key={i}>
                  <td className={GRID_CELL}>{carOf(u)}</td>
                  <td className={GRID_CELL}>{u.vin || '—'}</td>
                  <td className={GRID_CELL}>{u.colour || '—'}</td>
                  <td className={GRID_CELL} style={{ textAlign: 'right' }}>
                    {u.price ? money(u.price) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles['noneUnits']} data-part="noUnits">
          None attributed to this supplier yet. Stock units carry a supplier — set it there and it
          shows here.
        </div>
      )}
      <div className={styles['secLabel']}>Purchase-order lines ({p.poLines.length})</div>
      {p.poLines.length ? (
        <div className={styles['box']} data-part="linesBox">
          <table className={styles['plainTable']}>
            <thead>
              <tr>
                <th className={GRID_HEAD}>PO</th>
                <th className={GRID_HEAD}>Model</th>
                <th className={GRID_HEAD}>Qty</th>
                <th className={GRID_HEAD} style={{ textAlign: 'right' }}>
                  Price
                </th>
                <th className={GRID_HEAD}>Lead time</th>
              </tr>
            </thead>
            <tbody>
              {p.poLines.map((l, i) => (
                <tr key={i}>
                  <td className={GRID_CELL}>{l.po_number || ''}</td>
                  <td className={GRID_CELL}>{carOf(l)}</td>
                  <td className={GRID_CELL}>{l.qty}</td>
                  <td className={GRID_CELL} style={{ textAlign: 'right' }}>
                    {l.price ? money(l.price) : '—'}
                  </td>
                  <td className={GRID_CELL}>{l.lead_time || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles['noneLines']} data-part="noLines">
          No purchase orders yet.
        </div>
      )}
    </>
  );
}
