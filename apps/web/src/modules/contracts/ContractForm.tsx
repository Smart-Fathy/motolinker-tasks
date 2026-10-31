import { CONTRACT_PAYMENT_WHEN } from '@motolinker/contracts/documents';
import { useRef, useState } from 'react';
import { missingRequired, type Columns } from '../../columns';
import { Extras } from '../../docs/Extras';
import { Input, Pick, StatusPick } from '../../docs/Fields';
import { useDocStart, useDocWrites, useLeads } from '../../docs/data';
import { extrasOf, type Contract, type ContractDefaults } from '../../docs/model';
import { Btn, Sheet } from '../../ui';
import styles from '../../docs/docs.module.css';
import {
  blocksOf,
  dataOf,
  fieldId,
  fixedPaysOf,
  getPath,
  isSale,
  newPayRow,
  payRowsOf,
  seedOf,
  startValues,
  textOf,
  titleOf,
  withLead,
  type Data,
  type FixedPay,
  type PayRow,
} from './model';
import { CONTRACT_SPEC } from './spec';

/**
 * A contract's form, whole: asked for when it opens (the record, or the starting form of a new one — made for the lead it was
 * opened from, if it was), drawn from the blanks of the paper form and the fields the administrator has added to every contract.
 * "Save & preview PDF" saves, closes the form and hands the contract to the page, which shows it.
 */
export function ContractForm({
  id,
  lead,
  docColumns,
  onClose,
  onPreview,
}: {
  id: number | null;
  lead: number | null;
  docColumns: Columns;
  onClose: () => void;
  /** a saved contract to show as a PDF: its data, and the number it is printed under */
  onPreview: (made: { data: Data; no: string }) => void;
}) {
  const start = useDocStart(CONTRACT_SPEC, id, lead);
  if (!start.data || !docColumns.loaded) {
    return (
      <Sheet
        title={id ? 'Contract' : 'New contract'}
        onClose={onClose}
        footer={
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
        }
      >
        {start.error ? (
          <div className={styles['errorLine']} data-part="formError" role="alert">
            {start.error}
          </div>
        ) : (
          <div className={styles['loading']} data-part="loading">
            <div className={styles['spinner']} /> Loading…
          </div>
        )}
      </Sheet>
    );
  }
  const rec = 'saved' in start.data ? start.data.saved : start.data.fresh;
  return (
    <Body
      id={id}
      lead={lead}
      rec={rec}
      docColumns={docColumns}
      onClose={onClose}
      onPreview={onPreview}
    />
  );
}

function Body({
  id,
  lead,
  rec,
  docColumns,
  onClose,
  onPreview,
}: {
  id: number | null;
  lead: number | null;
  rec: Contract | ContractDefaults;
  docColumns: Columns;
  onClose: () => void;
  onPreview: (made: { data: Data; no: string }) => void;
}) {
  const writes = useDocWrites(CONTRACT_SPEC);
  const was = rec.data as Data;
  const sale = isSale(was);
  const contractNo = rec.contract_no;
  const saved = 'status' in rec ? rec : null;
  const [values, setValues] = useState(() => startValues(was));
  const [pays, setPays] = useState<PayRow[]>(() => payRowsOf(was));
  const [fixed, setFixed] = useState<FixedPay[]>(() => fixedPaysOf(was));
  const next = useRef(pays.length);
  const [status, setStatus] = useState(saved?.status ?? '');
  const [customer, setCustomer] = useState(() =>
    saved?.customer_id ? String(saved.customer_id) : lead ? String(lead) : '',
  );
  const [extras, setExtras] = useState(() => extrasOf(docColumns.shown, was['custom_fields']));
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const { leads } = useLeads();

  const set = (path: string, value: string) => setValues(v => ({ ...v, [path]: value }));
  const pickLead = (value: string) => {
    setCustomer(value);
    const picked = seedOf(
      leads.find(l => String(l.id) === value) as Record<string, unknown> | undefined,
    );
    if (picked) setValues(v => withLead(v, picked));
  };
  const changePay = (rowId: number, key: 'amount' | 'when', value: string) =>
    setPays(was => was.map(p => (p.id === rowId ? { ...p, [key]: value } : p)));

  const save = async (thenPreview: boolean) => {
    if (sending.current) return;
    const custom = docColumns.shown.filter(c => !c.builtin);
    const data = dataOf(was, values, sale ? pays : fixed, extras, contractNo);
    const buyer = textOf(getPath(data, 'buyer.name'));
    if (!buyer) return setError('Buyer name is required.');
    const missing = missingRequired(custom, extras);
    if (missing.length) return setError('Required: ' + missing.join(', '));
    sending.current = true;
    setError(null);
    const out = await writes.save(id, {
      contract_no: contractNo,
      title: titleOf(buyer),
      data,
      status: status || docColumns.col('status')?.options?.[0]?.key || 'draft',
      customer_id: customer || null,
    });
    sending.current = false;
    if (!out.ok) return setError(out.message || 'Failed to save.');
    onClose();
    if (thenPreview) onPreview({ data, no: contractNo });
  };

  const leadOptions = [
    { value: '', label: '— No lead —' },
    ...leads.map(l => ({ value: String(l.id), label: l.name + (l.phone ? ' · ' + l.phone : '') })),
  ];

  return (
    <Sheet
      title={id ? `Contract ${contractNo}` : 'New contract'}
      onClose={onClose}
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn data-part="savePreview" onClick={() => void save(true)}>
            Save &amp; preview PDF
          </Btn>
          <Btn kind="primary" data-part="save" onClick={() => void save(false)}>
            Save
          </Btn>
        </>
      }
    >
      <div className={styles['ctForm']} data-part="docForm">
        {blocksOf(was).map(block => (
          <div key={block.id} data-part={`ctBlock-${block.id}`}>
            <label className={styles['ctLabel']}>{block.title}</label>
            {block.rows.map((row, i) => (
              <div
                key={i}
                className={styles['ctGrid']}
                style={i ? { marginTop: 10 } : undefined}
                data-part="ctGrid"
              >
                {row.map(([path, label]) => (
                  <div key={path} data-part="ctField">
                    <div className={styles['ctCaption']}>{label}</div>
                    <Input
                      id={fieldId(path)}
                      value={values[path] ?? ''}
                      onChange={e => set(path, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            ))}
            {block.id === 'money' && (
              <div style={{ marginTop: 10 }} data-part="payments">
                {sale ? (
                  <>
                    <div className={styles['ctCaption']} style={{ marginBottom: 4 }}>
                      Payment lines · <bdi>“مبلغ قدره … يتم سداده …”</bdi> — printed one by one in{' '}
                      <bdi>البند الثالث</bdi>
                    </div>
                    <div data-part="payList">
                      {pays.map(p => (
                        <div key={p.id} className={styles['payRow']} data-part="payRow">
                          <Input
                            placeholder="Amount"
                            value={p.amount}
                            onChange={e => changePay(p.id, 'amount', e.target.value)}
                            data-pay="amount"
                          />
                          <Input
                            dir="auto"
                            placeholder={CONTRACT_PAYMENT_WHEN}
                            value={p.when}
                            onChange={e => changePay(p.id, 'when', e.target.value)}
                            data-pay="when"
                          />
                          <Btn
                            type="button"
                            style={{ padding: '4px 0' }}
                            title="Remove this payment line"
                            data-part="payRemove"
                            onClick={() => setPays(was => was.filter(x => x.id !== p.id))}
                          >
                            &times;
                          </Btn>
                        </div>
                      ))}
                    </div>
                    <Btn
                      type="button"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      data-part="addPay"
                      onClick={() => setPays(was => [...was, newPayRow(next.current++)])}
                    >
                      + Add payment line
                    </Btn>
                  </>
                ) : (
                  fixed.map((p, i) => (
                    <div key={i} className={styles['payFixed']} data-part="payFixed">
                      <Input
                        placeholder="Amount"
                        value={p.amount}
                        onChange={e =>
                          setFixed(was =>
                            was.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                          )
                        }
                      />
                      <div className={styles['payNote']}>{p.note}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
        <div className={styles['ctPair']} data-part="ctPair">
          <div>
            <label className={styles['ctLabel']}>
              Lead <span className={styles['lblHint']}>(attach to profile)</span>
            </label>
            <Pick id="ct-customer-id" value={customer} options={leadOptions} onChange={pickLead} />
          </div>
          <div>
            <label className={styles['ctLabel']}>Status</label>
            <StatusPick id="ct-status" columns={docColumns} value={status} onChange={setStatus} />
          </div>
        </div>
        <Extras
          columns={docColumns}
          values={extras}
          onChange={(k, v) => setExtras(was => ({ ...was, [k]: v }))}
          prefix="ct"
        />
        {error && (
          <div className={styles['errorLine']} data-part="formError" role="alert">
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}
