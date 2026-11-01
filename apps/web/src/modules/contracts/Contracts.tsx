import { can } from '@motolinker/contracts/access';
import { useState } from 'react';
import { useAssistantRecord } from '../../assistant';
import { useSession } from '../../app/context';
import { Badge, ColumnsLayer, useColumns } from '../../columns';
import { buildContractPdf, useDocList, useDocWrites } from '../../docs/data';
import { DocPage, Loading } from '../../docs/Page';
import {
  CONTRACT_STATUSES,
  docStatusColumn,
  fileName,
  isContract,
  type ContractRow,
} from '../../docs/model';
import { useLeadParam } from '../../docs/useLeadParam';
import { useViewer } from '../../docs/useViewer';
import { DocViewer } from '../../docs/Viewer';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import styles from '../../docs/docs.module.css';
import { ContractForm } from './ContractForm';
import { isAuto, type Data } from './model';
import { CONTRACT_SPEC } from './spec';

/** The row buttons are drawn small, with their size said on the button itself (as the classic page does, so a phone's larger buttons do not grow them). */
const ROW_BUTTON = { padding: '4px 8px', fontSize: 12 };

const DOC_COLUMNS = [docStatusColumn(CONTRACT_STATUSES)];

const Won = <strong>Won</strong>;

/** The Arabic car-sale contracts: a list, a form for each, and each as a PDF. A deal that reaches Won has one drafted for it. */
export function Contracts() {
  const { api, access, portal } = useSession();
  const columns = useColumns('contracts', DOC_COLUMNS);
  const list = useDocList(CONTRACT_SPEC);
  const writes = useDocWrites(CONTRACT_SPEC);
  const [form, setForm] = useState<{ id: number | null; lead: number | null } | null>(null);
  const viewer = useViewer();
  const may = {
    create: can(access.actor, 'contracts.create'),
    edit: can(access.actor, 'contracts.edit'),
    export: can(access.actor, 'contracts.export'),
    delete: can(access.actor, 'contracts.delete'),
  };

  // (what the assistant is told is open: the contract whose form is in front of the person; a new one is not a record yet)
  const editing = form?.id != null ? list.items.find(x => x.id === form.id) : undefined;
  useAssistantRecord(
    form?.id != null
      ? { kind: 'contract', id: String(form.id), title: editing?.contract_no ?? '', sub: '' }
      : null,
  );

  // A new contract for a lead, from the lead's own page: "/contracts?lead=<id>" opens the form, made from that lead.
  useLeadParam(may.create, lead => setForm({ id: null, lead }));

  /** A contract as a PDF, in the viewer: opened at once, and filled when the PDF is made (or the reason it could not be is said). */
  const show = (read: () => Promise<{ data: Data; no: string }>) =>
    void viewer.show('Contract', async say => {
      const { data, no } = await read();
      if (no) say(`Contract ${no}`);
      const out = await buildContractPdf(api, data);
      return { pdf: out.pdf, name: fileName(`Contract_${no || 'motolinkers'}`) };
    });

  const preview = (x: ContractRow) =>
    show(async () => {
      const rec = await api.get<unknown>(`${api.base}/contracts/${x.id}`);
      if (!isContract(rec))
        throw new Error('The contract came back in a form this app does not know.');
      return { data: rec.data, no: rec.contract_no };
    });
  const remove = (x: ContractRow) => {
    if (!window.confirm(`Delete contract ${x.contract_no}?`)) return;
    void writes.remove(x.id);
  };

  let body;
  if (list.loading || !columns.loaded) body = <Loading what="contracts" />;
  else if (list.error) {
    body = (
      <div className={styles['errorBox']} data-part="error">
        {list.error.status === 0 ? (
          'Failed to load contracts.'
        ) : (
          <>
            {list.error.message}
            <br />
            <span className={styles['hintSmall']}>
              If this mentions a missing <code>contracts</code> table, run{' '}
              <code>migrations/001_stock_specs_colors_contracts.sql</code> on the Supabase project.
            </span>
          </>
        )}
      </div>
    );
  } else if (!list.items.length) {
    body = (
      <div className={styles['none']} data-part="none">
        No contracts yet.
        <br />
        Click “New contract”, or move a deal to {Won} to have one drafted automatically.
      </div>
    );
  } else {
    body = (
      <div className={styles['tableScroll']} data-part="tableScroll">
        <table className={styles['table']} data-part="table">
          <thead>
            <tr className={styles['headRow']} data-part="headRow">
              <th className={styles['th']}>Contract #</th>
              <th className={styles['th']}>Title</th>
              <th className={styles['th']}>Status</th>
              <th className={styles['th']}>Created</th>
              <th className={cx(styles['th'], styles['right'])}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map(c => (
              <tr key={c.id} className={styles['row']} data-part="row">
                <td className={cx(styles['td'], styles['num'])} data-label="Contract #">
                  {c.contract_no}
                </td>
                <td className={styles['td']} data-label="Title">
                  {c.title || '—'}
                  {isAuto(c) && (
                    <>
                      {' '}
                      <span className={styles['autoPill']} data-part="auto">
                        auto
                      </span>
                    </>
                  )}
                </td>
                <td className={styles['td']} data-label="Status">
                  <Badge col={columns.col('status')} value={c.status} />
                </td>
                <td className={cx(styles['td'], styles['muted'])} data-label="Created">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}
                </td>
                <td className={cx(styles['td'], styles['actions'])} data-label="Actions">
                  {may.edit && (
                    <Btn
                      style={ROW_BUTTON}
                      data-part="rowEdit"
                      onClick={() => setForm({ id: c.id, lead: null })}
                    >
                      Edit
                    </Btn>
                  )}{' '}
                  {may.export && (
                    <Btn style={ROW_BUTTON} data-part="rowExport" onClick={() => preview(c)}>
                      PDF
                    </Btn>
                  )}{' '}
                  {may.delete && (
                    <Btn danger style={ROW_BUTTON} data-part="rowDelete" onClick={() => remove(c)}>
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
      screen="contracts"
      title="Contracts"
      hint={
        portal === 'admin' ? (
          <>
            Arabic vehicle import contract (عقد شراء وإستيراد سيارة لحساب الغير). A draft is created
            automatically whenever a deal moves to {Won}.
          </>
        ) : (
          <>
            Arabic vehicle import contract. A draft is created automatically whenever a deal moves
            to {Won}.
          </>
        )
      }
      add={
        may.create
          ? { label: 'New contract', onClick: () => setForm({ id: null, lead: null }) }
          : null
      }
      sheets={
        <>
          <ColumnsLayer columns={columns} />
          {form && (
            <ContractForm
              id={form.id}
              lead={form.lead}
              docColumns={columns}
              onClose={() => setForm(null)}
              onPreview={made => show(async () => made)}
            />
          )}
          {viewer.viewing && (
            <DocViewer
              viewing={viewer.viewing}
              onClose={viewer.close}
              variant={portal === 'admin' ? 'contract' : 'document'}
            />
          )}
        </>
      }
    >
      {body}
    </DocPage>
  );
}
