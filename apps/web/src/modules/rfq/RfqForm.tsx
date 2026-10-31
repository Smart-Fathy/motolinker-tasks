import { useRef, useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import {
  isTicked,
  missingRequired,
  useColumns,
  ColumnsBar,
  ColumnsLayer,
  type Column,
  type Columns,
} from '../../columns';
import { Catalogue } from '../../docs/Catalogue';
import { Extras } from '../../docs/Extras';
import { Area, Field, Grid, Input, Lbl, Pick, StatusPick } from '../../docs/Fields';
import { downloadXlsx } from '../../docs/files';
import { LinesGrid } from '../../docs/Lines';
import { buildXlsx, useDocStart, useDocWrites, useLeads, useOfferLoader } from '../../docs/data';
import {
  DOC_ICONS,
  RFQ_LINE_COLUMNS,
  rfqLineFilled,
  savedLines,
  titleOf,
  type Line,
  type Rfq,
  type RfqDefaults,
} from '../../docs/model';
import { useRows } from '../../docs/useRows';
import { Btn, Sheet } from '../../ui';
import { RFQ_SPEC } from './spec';
import { useSupplierList, type Offer, type Supplier } from '../suppliers';
import styles from '../../docs/docs.module.css';

const NO_STARTS = () => ({});
const text = (rec: Record<string, unknown>, key: string): string =>
  rec[key] == null ? '' : String(rec[key]);

/** What the extras of the form start with: what the document has under each shown field. */
function extrasOf(shown: readonly Column[], fields: unknown): Record<string, string | boolean> {
  const have = (fields ?? {}) as Record<string, unknown>;
  const out: Record<string, string | boolean> = {};
  for (const c of shown) {
    if (c.builtin) continue;
    const raw = have[c.key];
    out[c.key] = c.type === 'checkbox' ? isTicked(raw) : raw == null ? '' : String(raw);
  }
  return out;
}

/** An RFQ line made of a vehicle of a supplier's catalogue. */
export const lineOfOffer = (v: Offer): Line => ({
  brand: v.brand,
  model: v.model,
  trim: v.trim,
  year: v.model_year || '',
  accessories: v.accessories || '',
  lead_time: v.lead_time || '',
  fob_price: v.fob_price == null ? '' : v.fob_price,
});

/**
 * An RFQ's form, whole: asked for when it opens (the record, or the starting form of a new one — made for the lead it was
 * opened from, if it was), drawn from the columns the administrator has arranged for the document and for its lines.
 */
export function RfqForm({
  id,
  lead,
  docColumns,
  onClose,
}: {
  id: number | null;
  lead: number | null;
  docColumns: Columns;
  onClose: () => void;
}) {
  const items = useColumns('rfq_items', RFQ_LINE_COLUMNS);
  const start = useDocStart(RFQ_SPEC, id, lead);
  const title = id ? 'RFQ' : 'New RFQ';
  if (!start.data || !items.loaded || !docColumns.loaded) {
    return (
      <Sheet
        title={title}
        onClose={onClose}
        wide
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
      saved={'saved' in start.data}
      rec={rec}
      items={items}
      docColumns={docColumns}
      onClose={onClose}
    />
  );
}

function Body({
  id,
  rec,
  items,
  docColumns,
  onClose,
}: {
  id: number | null;
  saved: boolean;
  rec: Rfq | RfqDefaults;
  items: Columns;
  docColumns: Columns;
  onClose: () => void;
}) {
  const { api, toasts } = useSession();
  const writes = useDocWrites(RFQ_SPEC);
  const r = rec as unknown as Record<string, unknown>;
  const lines = (Array.isArray(r['items']) ? r['items'] : []) as Line[];
  const rows = useRows(lines, items.shown, NO_STARTS);
  const [f, setF] = useState({
    rfq_no: text(r, 'rfq_no'),
    rfq_date: text(r, 'rfq_date'),
    issuer: text(r, 'issuer'),
    status: text(r, 'status'),
    customer_id: text(r, 'customer_id'),
    supplier_id: text(r, 'supplier_id'),
    supplier_name: text(r, 'supplier_name'),
    supplier_contact: text(r, 'supplier_contact'),
    supplier_address: text(r, 'supplier_address'),
    supplier_country: text(r, 'supplier_country'),
    payment_terms: text(r, 'payment_terms'),
    delivery_location: text(r, 'delivery_location'),
    service_provider: text(r, 'service_provider'),
    contact: text(r, 'contact'),
    documents_required: text(r, 'documents_required'),
  });
  const set = (key: keyof typeof f, v: string) => setF(was => ({ ...was, [key]: v }));
  const [extras, setExtras] = useState(() => extrasOf(docColumns.shown, r['custom_fields']));
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<readonly Offer[] | null>(null);
  const sending = useRef(false);
  const { leads } = useLeads();
  const suppliers = useSupplierList().data ?? [];
  const loadOffers = useOfferLoader();

  const pickSupplier = (value: string) => {
    set('supplier_id', value);
    const x: Supplier | undefined = suppliers.find(s => String(s.id) === value);
    if (!x) return;
    setF(was => ({
      ...was,
      supplier_id: value,
      supplier_name: x.name || '',
      supplier_contact: x.contact || '',
      supplier_address: x.address || '',
      supplier_country: x.country || '',
    }));
  };

  const fromCatalogue = async () => {
    const offers = await loadOffers();
    if (!offers.length) {
      toasts.show('No supplier vehicles yet — add them under Suppliers → Open → Vehicles.');
      return;
    }
    setPicker(offers);
  };
  const picked = (chosen: Offer[]) => {
    if (!chosen.length) {
      toasts.show('Pick at least one vehicle.');
      return;
    }
    chosen.forEach(v => rows.add(lineOfOffer(v)));
    setPicker(null);
    toasts.show(
      chosen.length === 1 ? 'Line added from the catalogue.' : chosen.length + ' lines added.',
    );
  };

  const save = async (thenExport: boolean) => {
    if (sending.current) return;
    const edited = savedLines(
      rows.rows.map(x => x.base),
      rows.rows.map(x => x.values),
    );
    const filled = edited.filter(rfqLineFilled);
    if (!filled.length) return setError('Add at least one vehicle line (brand, model or trim).');
    const custom = docColumns.shown.filter(c => !c.builtin);
    const missing = missingRequired(custom, extras);
    if (missing.length) return setError('Required: ' + missing.join(', '));
    const t = (v: string) => v.trim();
    const payload: Record<string, unknown> = {
      rfq_no: t(f.rfq_no),
      rfq_date: t(f.rfq_date) || null,
      issuer: t(f.issuer),
      status: t(f.status) || docColumns.col('status')?.options?.[0]?.key || 'draft',
      customer_id: t(f.customer_id) || null,
      supplier_id: t(f.supplier_id) || null,
      supplier_name: t(f.supplier_name),
      supplier_contact: t(f.supplier_contact),
      supplier_address: t(f.supplier_address),
      supplier_country: t(f.supplier_country),
      payment_terms: t(f.payment_terms),
      delivery_location: t(f.delivery_location),
      service_provider: t(f.service_provider),
      contact: t(f.contact),
      documents_required: t(f.documents_required),
      // (what the document has under fields that are not on the form stays)
      custom_fields: {
        ...((r['custom_fields'] as Record<string, unknown> | null | undefined) ?? {}),
        ...Object.fromEntries(custom.map(c => [c.key, extras[c.key] ?? ''])),
      },
      items: edited,
    };
    payload['title'] = titleOf(String(payload['supplier_name']), 'RFQ', filled.length);
    sending.current = true;
    setError(null);
    const out = await writes.save(id, payload);
    sending.current = false;
    if (!out.ok) return setError(out.message || 'Failed to save.');
    onClose();
    if (thenExport) {
      try {
        const book = await buildXlsx(api, { payload });
        downloadXlsx(book.xlsx, book.name);
      } catch (e) {
        toasts.show('Could not export this RFQ: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  };

  const leadOptions = [
    { value: '', label: '— No lead —' },
    ...leads.map(l => ({ value: String(l.id), label: l.name + (l.phone ? ' · ' + l.phone : '') })),
  ];
  const supplierOptions = [
    { value: '', label: '— None —' },
    ...suppliers.map(s => ({ value: String(s.id), label: s.name })),
  ];

  return (
    <Sheet
      title={id ? `RFQ ${f.rfq_no}` : 'New RFQ'}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn data-part="saveExport" onClick={() => void save(true)}>
            Save &amp; export Excel
          </Btn>
          <Btn kind="primary" data-part="save" onClick={() => void save(false)}>
            Save
          </Btn>
        </>
      }
    >
      <div className={styles['form']} data-part="docForm">
        <Grid min={160}>
          <Field label="ID">
            <Input
              id="rfq-no"
              value={f.rfq_no}
              readOnly={!!id}
              onChange={e => set('rfq_no', e.target.value)}
            />
          </Field>
          <Field label="Date">
            <Input
              id="rfq-date"
              type="date"
              value={f.rfq_date}
              onChange={e => set('rfq_date', e.target.value)}
            />
          </Field>
          <Field label="Issuer">
            <Input id="rfq-issuer" value={f.issuer} onChange={e => set('issuer', e.target.value)} />
          </Field>
          <Field label="Status">
            <StatusPick
              id="rfq-status"
              columns={docColumns}
              value={f.status}
              onChange={v => set('status', v)}
            />
          </Field>
          <Field
            label={
              <>
                Lead <span className={styles['lblHint']}>(attach)</span>
              </>
            }
          >
            <Pick
              id="rfq-customer-id"
              value={f.customer_id}
              options={leadOptions}
              onChange={v => set('customer_id', v)}
            />
          </Field>
        </Grid>

        <div data-part="supplierBlock">
          <Lbl spaced>Supplier</Lbl>
          <Grid min={160}>
            <Field label="From register">
              <Pick
                id="rfq-supplier-id"
                value={f.supplier_id}
                options={supplierOptions}
                onChange={pickSupplier}
              />
            </Field>
            <Field label="Name">
              <Input
                id="rfq-supplier-name"
                value={f.supplier_name}
                onChange={e => set('supplier_name', e.target.value)}
              />
            </Field>
            <Field label="Contact">
              <Input
                id="rfq-supplier-contact"
                value={f.supplier_contact}
                onChange={e => set('supplier_contact', e.target.value)}
              />
            </Field>
            <Field label="Address">
              <Input
                id="rfq-supplier-address"
                value={f.supplier_address}
                onChange={e => set('supplier_address', e.target.value)}
              />
            </Field>
            <Field label="Country of origin">
              <Input
                id="rfq-supplier-country"
                value={f.supplier_country}
                onChange={e => set('supplier_country', e.target.value)}
              />
            </Field>
          </Grid>
        </div>

        <div data-part="lines">
          <Lbl spaced>Requested vehicles</Lbl>
          <LinesGrid
            columns={items}
            rows={rows.rows}
            change={rows.change}
            remove={rows.remove}
            number={{ label: '#', width: 34 }}
            minWidth={1080}
            removeTitle="Remove"
          />
          <Btn
            style={{ marginTop: 8, padding: '5px 10px', fontSize: 12 }}
            data-part="addLine"
            onClick={() => rows.add()}
          >
            + Add line
          </Btn>{' '}
          <ColumnsBar columns={items} spaced />
          <Btn
            style={{ marginTop: 8, padding: '5px 10px', fontSize: 12, marginLeft: 6 }}
            data-part="fromCatalogue"
            onClick={() => void fromCatalogue()}
          >
            <Icon name={DOC_ICONS.catalogue} size={13} /> From supplier catalogue
          </Btn>
        </div>

        <div>
          <Lbl>Payment Terms</Lbl>
          <Area
            id="rfq-payment"
            rows={2}
            value={f.payment_terms}
            onChange={e => set('payment_terms', e.target.value)}
          />
        </div>
        <Grid min={160}>
          <Field label="Delivery Location">
            <Input
              id="rfq-delivery"
              value={f.delivery_location}
              onChange={e => set('delivery_location', e.target.value)}
            />
          </Field>
          <Field label="Service Provider">
            <Input
              id="rfq-service"
              value={f.service_provider}
              onChange={e => set('service_provider', e.target.value)}
            />
          </Field>
          <Field label="Contact">
            <Input
              id="rfq-contact"
              value={f.contact}
              onChange={e => set('contact', e.target.value)}
            />
          </Field>
        </Grid>
        <div>
          <Lbl>Documents Required</Lbl>
          <Area
            id="rfq-docs"
            rows={2}
            value={f.documents_required}
            onChange={e => set('documents_required', e.target.value)}
          />
        </div>
        <Extras
          columns={docColumns}
          values={extras}
          onChange={(k, v) => setExtras(was => ({ ...was, [k]: v }))}
          prefix="rfq"
        />
        {error && (
          <div className={styles['errorLine']} data-part="formError" role="alert">
            {error}
          </div>
        )}
      </div>
      <ColumnsLayer columns={items} />
      {picker && <Catalogue offers={picker} onPick={picked} onClose={() => setPicker(null)} />}
    </Sheet>
  );
}
