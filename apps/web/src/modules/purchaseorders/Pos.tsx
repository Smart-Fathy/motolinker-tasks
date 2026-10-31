import { can } from '@motolinker/contracts/access';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { Badge, ColumnsLayer, useColumns } from '../../columns';
import { buildPdf, useDocList, useDocWrites } from '../../docs/data';
import { DocPage, Loading } from '../../docs/Page';
import { useLeadParam } from '../../docs/useLeadParam';
import { useViewer } from '../../docs/useViewer';
import {
  docStatusColumn,
  fileName,
  isPo,
  lineTotal,
  PO_STATUSES,
  thousands,
  whenOf,
  type PoRow,
} from '../../docs/model';
import { DocViewer } from '../../docs/Viewer';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import styles from '../../docs/docs.module.css';
import { PoForm } from './PoForm';
import { PO_SPEC } from './spec';

/** The row buttons are drawn small, with their size said on the button itself (as the classic page does, so a phone's larger buttons do not grow them). */
const ROW_BUTTON = { padding: '4px 8px', fontSize: 12 };

const DOC_COLUMNS = [docStatusColumn(PO_STATUSES)];

/** The purchase orders sent to suppliers: a list, a form for each (their lines are the vehicles bought), and each as a PDF. */
export function Pos() {
  const { api, access } = useSession();
  const columns = useColumns('po_doc', DOC_COLUMNS);
  const list = useDocList(PO_SPEC);
  const writes = useDocWrites(PO_SPEC);
  const [form, setForm] = useState<{ id: number | null; lead: number | null } | null>(null);
  const viewer = useViewer();
  const may = {
    create: can(access.actor, 'purchaseorders.create'),
    edit: can(access.actor, 'purchaseorders.edit'),
    export: can(access.actor, 'purchaseorders.export'),
    delete: can(access.actor, 'purchaseorders.delete'),
  };

  // A new order for a lead, from the lead's own page: "/purchaseorders?lead=<id>" opens the form, made from that lead.
  useLeadParam(may.create, lead => setForm({ id: null, lead }));

  /** An order as a PDF, in the viewer: opened at once, with the order's number as its title, and filled when the PDF is made. */
  const show = (make: () => Promise<Record<string, unknown>>) =>
    void viewer.show('Purchase order', async say => {
      const payload = await make();
      const title = payload['po_number']
        ? `Purchase order ${String(payload['po_number'])}`
        : 'Purchase order';
      say(title);
      const out = await buildPdf(api, payload);
      return { pdf: out.pdf, name: fileName(String(out.name || title)) };
    });

  const preview = (x: PoRow) =>
    show(async () => {
      const rec = await api.get<unknown>(`${api.base}/purchase-orders/${x.id}`);
      if (!isPo(rec))
        throw new Error('The purchase order came back in a form this app does not know.');
      return rec as unknown as Record<string, unknown>;
    });
  const remove = (x: PoRow) => {
    if (!window.confirm(`Delete purchase order ${x.po_number}?`)) return;
    void writes.remove(x.id);
  };

  let body;
  if (list.loading || !columns.loaded) body = <Loading what="purchase orders" />;
  else if (list.error) {
    body = (
      <div className={styles['errorBox']} data-part="error">
        {list.error.status === 0 ? (
          'Failed to load purchase orders.'
        ) : (
          <>
            {list.error.message}
            <br />
            <span className={styles['hintSmall']}>
              If this mentions a missing <code>purchase_orders</code> table, run{' '}
              <code>migrations/002_purchase_orders.sql</code> on the Supabase project.
            </span>
          </>
        )}
      </div>
    );
  } else if (!list.items.length) {
    body = (
      <div className={styles['none']} data-part="none">
        No purchase orders yet.
        <br />
        Click “New purchase order” to create one.
      </div>
    );
  } else {
    body = (
      <div className={styles['tableScroll']} data-part="tableScroll">
        <table className={styles['table']} data-part="table">
          <thead>
            <tr className={styles['headRow']} data-part="headRow">
              <th className={styles['th']}>PO #</th>
              <th className={styles['th']}>Supplier</th>
              <th className={cx(styles['th'], styles['right'])}>Lines</th>
              <th className={cx(styles['th'], styles['right'])}>Total</th>
              <th className={styles['th']}>Status</th>
              <th className={styles['th']}>Date</th>
              <th className={cx(styles['th'], styles['right'])}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map(p => (
              <tr key={p.id} className={styles['row']} data-part="row">
                <td className={cx(styles['td'], styles['num'])} data-label="PO #">
                  {p.po_number}
                </td>
                <td className={styles['td']} data-label="Supplier">
                  {p.supplier || '—'}
                </td>
                <td className={cx(styles['td'], styles['right'])} data-label="Lines">
                  {p.items.length}
                </td>
                <td className={cx(styles['td'], styles['right'])} data-label="Total">
                  {p.currency || 'USD'} {thousands(lineTotal(p.items))}
                </td>
                <td className={styles['td']} data-label="Status">
                  <Badge col={columns.col('status')} value={p.status} />
                </td>
                <td className={cx(styles['td'], styles['muted'])} data-label="Date">
                  {whenOf(p.po_date, p.created_at)}
                </td>
                <td className={cx(styles['td'], styles['actions'])} data-label="Actions">
                  {may.edit && (
                    <Btn
                      style={ROW_BUTTON}
                      data-part="rowEdit"
                      onClick={() => setForm({ id: p.id, lead: null })}
                    >
                      Edit
                    </Btn>
                  )}{' '}
                  {may.export && (
                    <Btn style={ROW_BUTTON} data-part="rowExport" onClick={() => preview(p)}>
                      PDF
                    </Btn>
                  )}{' '}
                  {may.delete && (
                    <Btn danger style={ROW_BUTTON} data-part="rowDelete" onClick={() => remove(p)}>
                      Delete
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <DocPage
      title="Purchase Orders"
      hint="Order sheet sent to suppliers. Each PO holds one or more vehicle lines with their own client, spec, PI price and tracking status."
      add={
        may.create
          ? { label: 'New purchase order', onClick: () => setForm({ id: null, lead: null }) }
          : null
      }
      sheets={
        <>
          <ColumnsLayer columns={columns} />
          {form && (
            <PoForm
              id={form.id}
              lead={form.lead}
              docColumns={columns}
              onClose={() => setForm(null)}
              onPreview={payload => show(async () => payload)}
            />
          )}
          {viewer.viewing && <DocViewer viewing={viewer.viewing} onClose={viewer.close} />}
        </>
      }
    >
      {body}
    </DocPage>
  );
}
