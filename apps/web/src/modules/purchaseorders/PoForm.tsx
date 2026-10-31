import { useCallback, useRef, useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import {
  ColumnsBar,
  ColumnsLayer,
  isTicked,
  missingRequired,
  useColumns,
  type Column,
  type Columns,
} from '../../columns';
import { Catalogue } from '../../docs/Catalogue';
import { Extras } from '../../docs/Extras';
import { Area, Field, Grid, Input, Lbl, Pick, StatusPick } from '../../docs/Fields';
import { LinesGrid } from '../../docs/Lines';
import { useDocStart, useDocWrites, useLeads, useOfferLoader } from '../../docs/data';
import {
  DOC_ICONS,
  lineTotal,
  PO_LINE_COLUMNS,
  poLineFilled,
  savedLines,
  thousands,
  titleOf,
  type Line,
  type Po,
  type PoDefaults,
} from '../../docs/model';
import { useRows } from '../../docs/useRows';
import { Btn, Sheet } from '../../ui';
import { useSupplierList, type Offer, type Supplier } from '../suppliers';
import styles from '../../docs/docs.module.css';
import { PO_SPEC } from './spec';

const text = (rec: Record<string, unknown>, key: string): string =>
  rec[key] == null ? '' : String(rec[key]);

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

/** A purchase-order line made of a vehicle of a supplier's catalogue (one unit; the price is the supplier's FOB). */
export const lineOfOffer = (v: Offer): Line => ({
  brand: v.brand,
  model: v.model,
  trim: v.trim,
  year: v.model_year || '',
  accessories: v.accessories || '',
  units: 1,
  pi_price: v.fob_price == null ? '' : v.fob_price,
});

/**
 * A purchase order's form, whole: asked for when it opens, drawn from the columns the administrator has arranged for the
 * document and for its lines. "Save & preview PDF" saves, closes the form and hands the order to the page, which shows it.
 */
export function PoForm({
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
  /** a saved order to show as a PDF */
  onPreview: (payload: Record<string, unknown>) => void;
}) {
  const items = useColumns('po_items', PO_LINE_COLUMNS);
  const start = useDocStart(PO_SPEC, id, lead);
  if (!start.data || !items.loaded || !docColumns.loaded) {
    return (
      <Sheet
        title={id ? 'Purchase order' : 'New purchase order'}
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
      rec={rec}
      lead={lead}
      items={items}
      docColumns={docColumns}
      onClose={onClose}
      onPreview={onPreview}
    />
  );
}

function Body({
  id,
  rec,
  lead,
  items,
  docColumns,
  onClose,
  onPreview,
}: {
  id: number | null;
  rec: Po | PoDefaults;
  lead: number | null;
  items: Columns;
  docColumns: Columns;
  onClose: () => void;
  onPreview: (payload: Record<string, unknown>) => void;
}) {
  const { toasts } = useSession();
  const writes = useDocWrites(PO_SPEC);
  const r = rec as unknown as Record<string, unknown>;
  const lines = (Array.isArray(r['items']) ? r['items'] : []) as Line[];
  // A line that has no status starts as the first of the options it has been given, not as a fixed one: whoever renamed or
  // reordered the statuses gets what they configured on the next new line.
  const statusStart = useCallback(
    () => ({ status: items.col('status')?.options?.[0]?.key || 'send_to_supplier' }),
    [items],
  );
  const rows = useRows(lines, items.shown, statusStart);
  const [f, setF] = useState({
    po_number: text(r, 'po_number'),
    po_date: text(r, 'po_date'),
    supplier: text(r, 'supplier'),
    currency: text(r, 'currency') || 'USD',
    status: text(r, 'status'),
    customer_id: text(r, 'customer_id') || (lead ? String(lead) : ''),
    supplier_id: text(r, 'supplier_id'),
    supplier_contact: text(r, 'supplier_contact'),
    supplier_address: text(r, 'supplier_address'),
    supplier_country: text(r, 'supplier_country'),
    issuer: text(r, 'issuer'),
    quote_id: text(r, 'quote_id'),
    payment_terms: text(r, 'payment_terms'),
    incoterm: text(r, 'incoterm') || 'FOB',
    delivery_location: text(r, 'delivery_location'),
    service_provider: text(r, 'service_provider'),
    contact: text(r, 'contact'),
    documents_required: text(r, 'documents_required'),
    notes: text(r, 'notes'),
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
    const x: Supplier | undefined = suppliers.find(s => String(s.id) === value);
    setF(was => ({
      ...was,
      supplier_id: value,
      ...(x
        ? {
            supplier: x.name || '',
            supplier_contact: x.contact || '',
            supplier_address: x.address || '',
            supplier_country: x.country || '',
          }
        : {}),
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

  const edited = savedLines(
    rows.rows.map(x => x.base),
    rows.rows.map(x => x.values),
  );

  const save = async (thenPreview: boolean) => {
    if (sending.current) return;
    const filled = edited.filter(poLineFilled);
    if (!filled.length) return setError('Add at least one vehicle line (client, brand or model).');
    const custom = docColumns.shown.filter(c => !c.builtin);
    const missing = missingRequired(custom, extras);
    if (missing.length) return setError('Required: ' + missing.join(', '));
    const t = (v: string) => v.trim();
    const payload: Record<string, unknown> = {
      po_number: t(f.po_number),
      po_date: f.po_date || null,
      supplier: t(f.supplier),
      currency: t(f.currency) || 'USD',
      status: f.status || docColumns.col('status')?.options?.[0]?.key || 'draft',
      custom_fields: {
        ...((r['custom_fields'] as Record<string, unknown> | null | undefined) ?? {}),
        ...Object.fromEntries(custom.map(c => [c.key, extras[c.key] ?? ''])),
      },
      customer_id: f.customer_id || null,
      notes: t(f.notes),
      items: edited,
      supplier_id: f.supplier_id || null,
      supplier_contact: t(f.supplier_contact),
      supplier_address: t(f.supplier_address),
      supplier_country: t(f.supplier_country),
      issuer: t(f.issuer),
      quote_id: t(f.quote_id),
      payment_terms: t(f.payment_terms),
      incoterm: t(f.incoterm),
      delivery_location: t(f.delivery_location),
      service_provider: t(f.service_provider),
      contact: t(f.contact),
      documents_required: t(f.documents_required),
    };
    payload['title'] = titleOf(String(payload['supplier']), 'PO', filled.length);
    sending.current = true;
    setError(null);
    const out = await writes.save(id, payload);
    sending.current = false;
    if (!out.ok) return setError(out.message || 'Failed to save.');
    onClose();
    if (thenPreview) onPreview(payload);
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
      title={id ? `Purchase order ${f.po_number}` : 'New purchase order'}
      onClose={onClose}
      wide
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
      <div className={styles['form']} data-part="docForm">
        <Grid min={150}>
          <Field label="PO number">
            <Input
              id="po-number"
              value={f.po_number}
              readOnly={!!id}
              onChange={e => set('po_number', e.target.value)}
            />
          </Field>
          <Field label="Date">
            <Input
              id="po-date"
              type="date"
              value={f.po_date}
              onChange={e => set('po_date', e.target.value)}
            />
          </Field>
          <Field label="Supplier">
            <Input
              id="po-supplier"
              placeholder="e.g. BYD Auto Industry"
              value={f.supplier}
              onChange={e => set('supplier', e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Input
              id="po-currency"
              value={f.currency}
              onChange={e => set('currency', e.target.value)}
            />
          </Field>
          <Field label="Status">
            <StatusPick
              id="po-status"
              columns={docColumns}
              value={f.status}
              onChange={v => set('status', v)}
            />
          </Field>
          <Field
            label={
              <>
                Lead <span className={styles['lblHint']}>(attach to profile)</span>
              </>
            }
          >
            <Pick
              id="po-customer-id"
              value={f.customer_id}
              options={leadOptions}
              onChange={v => set('customer_id', v)}
            />
          </Field>
        </Grid>

        <div data-part="lines">
          <Lbl spaced>Vehicle lines</Lbl>
          <LinesGrid
            columns={items}
            rows={rows.rows}
            change={rows.change}
            remove={rows.remove}
            number={{ label: 'No', width: 38 }}
            minWidth={1500}
            removeTitle="Remove line"
          />
          <div className={styles['linesBar']} data-part="linesBar">
            <Btn
              style={{ padding: '5px 10px', fontSize: 12 }}
              data-part="addLine"
              onClick={() => rows.add()}
            >
              + Add vehicle line
            </Btn>{' '}
            <ColumnsBar columns={items} />
            <Btn
              style={{ padding: '5px 10px', fontSize: 12, marginLeft: 6 }}
              data-part="fromCatalogue"
              onClick={() => void fromCatalogue()}
            >
              <Icon name={DOC_ICONS.catalogue} size={13} /> From supplier catalogue
            </Btn>
            <div className={styles['linesTotal']} data-part="linesTotal">
              {rows.rows.length} line(s) · Total {f.currency || 'USD'}{' '}
              {thousands(lineTotal(edited))}
            </div>
          </div>
        </div>

        <div data-part="supplierBlock">
          <Lbl spaced>Supplier details (printed on the PO)</Lbl>
          <Grid min={160}>
            <Field label="From register">
              <Pick
                id="po-supplier-id"
                value={f.supplier_id}
                options={supplierOptions}
                onChange={pickSupplier}
              />
            </Field>
            <Field label="Contact">
              <Input
                id="po-supplier-contact"
                value={f.supplier_contact}
                onChange={e => set('supplier_contact', e.target.value)}
              />
            </Field>
            <Field label="Address">
              <Input
                id="po-supplier-address"
                value={f.supplier_address}
                onChange={e => set('supplier_address', e.target.value)}
              />
            </Field>
            <Field label="Country of origin">
              <Input
                id="po-supplier-country"
                value={f.supplier_country}
                onChange={e => set('supplier_country', e.target.value)}
              />
            </Field>
            <Field label="Issuer">
              <Input
                id="po-issuer"
                value={f.issuer}
                onChange={e => set('issuer', e.target.value)}
              />
            </Field>
            <Field label="Quote / RFQ ID">
              <Input
                id="po-quote-id"
                value={f.quote_id}
                onChange={e => set('quote_id', e.target.value)}
              />
            </Field>
          </Grid>
        </div>

        <div>
          <Lbl>Payment Terms</Lbl>
          <Area
            id="po-payment"
            rows={2}
            placeholder="Leave blank for the standard 30% / 70% terms"
            value={f.payment_terms}
            onChange={e => set('payment_terms', e.target.value)}
          />
        </div>
        <Grid min={160}>
          <Field label="Incoterm">
            <Input
              id="po-incoterm"
              value={f.incoterm}
              onChange={e => set('incoterm', e.target.value)}
            />
          </Field>
          <Field label="Delivery Location">
            <Input
              id="po-delivery"
              value={f.delivery_location}
              onChange={e => set('delivery_location', e.target.value)}
            />
          </Field>
          <Field label="Service Provider">
            <Input
              id="po-service"
              value={f.service_provider}
              onChange={e => set('service_provider', e.target.value)}
            />
          </Field>
          <Field label="Contact">
            <Input
              id="po-contact"
              value={f.contact}
              onChange={e => set('contact', e.target.value)}
            />
          </Field>
        </Grid>
        <div>
          <Lbl>Documents Required</Lbl>
          <Area
            id="po-docs"
            rows={2}
            placeholder="Leave blank for the standard document list"
            value={f.documents_required}
            onChange={e => set('documents_required', e.target.value)}
          />
        </div>
        <div>
          <Lbl>Notes</Lbl>
          <Area
            id="po-notes"
            rows={2}
            placeholder="Shipping instructions, remarks…"
            value={f.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>
        <Extras
          columns={docColumns}
          values={extras}
          onChange={(k, v) => setExtras(was => ({ ...was, [k]: v }))}
          prefix="po"
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
