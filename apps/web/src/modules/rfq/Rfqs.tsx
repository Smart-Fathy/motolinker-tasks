import { can } from '@motolinker/contracts/access';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { Badge, ColumnsLayer, useColumns } from '../../columns';
import { buildXlsx, useDocList, useDocWrites } from '../../docs/data';
import { downloadXlsx } from '../../docs/files';
import { DocPage, Loading } from '../../docs/Page';
import { useLeadParam } from '../../docs/useLeadParam';
import { docStatusColumn, RFQ_STATUSES, whenOf, type RfqRow } from '../../docs/model';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import styles from '../../docs/docs.module.css';
import { RfqForm } from './RfqForm';
import { RFQ_SPEC } from './spec';

/** The row buttons are drawn small, with their size said on the button itself (as the classic page does, so a phone's larger buttons do not grow them). */
const ROW_BUTTON = { padding: '4px 8px', fontSize: 12 };

const DOC_COLUMNS = [docStatusColumn(RFQ_STATUSES)];

/** The requests for quotation sent to suppliers: a list, and a form for each (their lines are the vehicles asked about). */
export function Rfqs() {
  const { api, access, toasts } = useSession();
  const columns = useColumns('rfq_doc', DOC_COLUMNS);
  const list = useDocList(RFQ_SPEC);
  const writes = useDocWrites(RFQ_SPEC);
  const [form, setForm] = useState<{ id: number | null; lead: number | null } | null>(null);
  const may = {
    create: can(access.actor, 'rfq.create'),
    edit: can(access.actor, 'rfq.edit'),
    export: can(access.actor, 'rfq.export'),
    delete: can(access.actor, 'rfq.delete'),
  };

  // A new RFQ for a lead, from the lead's own page: "/rfq?lead=<id>" opens the form, made from that lead, and is not kept.
  useLeadParam(may.create, lead => setForm({ id: null, lead }));

  const exportOne = async (x: RfqRow) => {
    try {
      const book = await buildXlsx(api, { id: x.id });
      downloadXlsx(book.xlsx, book.name);
    } catch (e) {
      toasts.show('Could not export this RFQ: ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const remove = (x: RfqRow) => {
    if (!window.confirm(`Delete RFQ ${x.rfq_no}?`)) return;
    void writes.remove(x.id);
  };

  let body;
  if (list.loading || !columns.loaded) body = <Loading what="RFQs" />;
  else if (list.error) {
    body = (
      <div className={styles['errorBox']} data-part="error">
        {list.error.status === 0 ? (
          'Failed to load RFQs.'
        ) : (
          <>
            {list.error.message}
            <br />
            <span className={styles['hintSmall']}>
              If this mentions a missing <code>rfqs</code> table, run{' '}
              <code>migrations/003_logistics_deals_docs.sql</code>.
            </span>
          </>
        )}
      </div>
    );
  } else if (!list.items.length) {
    body = (
      <div className={styles['none']} data-part="none">
        No RFQs yet.
      </div>
    );
  } else {
    body = (
      <div className={styles['tableScroll']} data-part="tableScroll">
        <table className={styles['table']} data-part="table">
          <thead>
            <tr className={styles['headRow']} data-part="headRow">
              <th className={styles['th']}>ID</th>
              <th className={styles['th']}>Supplier</th>
              <th className={cx(styles['th'], styles['right'])}>Lines</th>
              <th className={styles['th']}>Status</th>
              <th className={styles['th']}>Date</th>
              <th className={cx(styles['th'], styles['right'])}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map(r => (
              <tr key={r.id} className={styles['row']} data-part="row">
                <td className={cx(styles['td'], styles['num'])} data-label="ID">
                  {r.rfq_no}
                </td>
                <td className={styles['td']} data-label="Supplier">
                  {r.supplier_name || '—'}
                </td>
                <td className={cx(styles['td'], styles['right'])} data-label="Lines">
                  {r.items.length}
                </td>
                <td className={styles['td']} data-label="Status">
                  <Badge col={columns.col('status')} value={r.status} />
                </td>
                <td className={cx(styles['td'], styles['muted'])} data-label="Date">
                  {whenOf(r.rfq_date, r.created_at)}
                </td>
                <td className={cx(styles['td'], styles['actions'])} data-label="Actions">
                  {may.edit && (
                    <Btn
                      style={ROW_BUTTON}
                      data-part="rowEdit"
                      onClick={() => setForm({ id: r.id, lead: null })}
                    >
                      Edit
                    </Btn>
                  )}{' '}
                  {may.export && (
                    <Btn style={ROW_BUTTON} data-part="rowExport" onClick={() => void exportOne(r)}>
                      Excel
                    </Btn>
                  )}{' '}
                  {may.delete && (
                    <Btn danger style={ROW_BUTTON} data-part="rowDelete" onClick={() => remove(r)}>
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
      title="RFQ"
      hint="Request for Quotation sent to a supplier. Prefills from a lead, like the quotation."
      add={
        may.create ? { label: 'New RFQ', onClick: () => setForm({ id: null, lead: null }) } : null
      }
      sheets={
        <>
          <ColumnsLayer columns={columns} />
          {form && (
            <RfqForm
              id={form.id}
              lead={form.lead}
              docColumns={columns}
              onClose={() => setForm(null)}
            />
          )}
        </>
      }
    >
      {body}
    </DocPage>
  );
}
