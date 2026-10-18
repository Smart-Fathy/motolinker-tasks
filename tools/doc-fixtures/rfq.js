'use strict';
// Sample RFQs for rendering and tests (node tools/render-docs.js rfq rfqAnswered …).
// The first mirrors the company's real RFQ sheet (MT26W216Y26, PCH auto) so the redesign
// can be compared with the original; the rest are the cases a workbook has to survive.

const ACC = 'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump';
const item = (o) => ({ brand: '', model: '', trim: '', colour: '', year: '', accessories: ACC, lead_time: '', fob_price: 0, cif_price: 0, ...o });

const base = {
  rfq_no: 'MT26W216Y26', title: 'PCH auto — 4 vehicle(s)', rfq_date: '2026-09-10', issuer: 'Mohamed Yasser',
  supplier_name: 'PCH auto', supplier_contact: 'Yoyo / +8613380783532',
  supplier_address: "NO. 211, Baofa Company, Jinwan Avenue, Dachan Bay, Haoye Community, Xixiang Street, Bao'an District, Shenzhen City, Guangdong Province",
  supplier_country: 'China',
  items: [
    item({ brand: 'Deepal', model: 'S05', trim: '620 Laser Edition', colour: 'EXT: Grey INT: Nebula Purple/White', year: '2027' }),
    item({ brand: 'Deepal', model: 'S05', trim: '215 Max', colour: 'EXT: Grey INT: Grey', year: '2027' }),
    item({ brand: 'Xpeng', model: 'L03', trim: '1330 Max', colour: 'Ext: Black INT: Purple', year: '2027' }),
    item({ brand: 'Xpeng', model: 'L03', trim: '625 Max', colour: 'Ext: Black INT: Purple', year: '2027' }),
  ],
  payment_terms: '100% upfront to confirm the order\nBefore vehicle payment (VIN code and PDI vehicle video and document to be provided for confirmation)',
  delivery_location: '', service_provider: '', contact: '', documents_required: '',
  custom_fields: {}, status: 'sent', settings: {},
};

// The column configuration the admin's grid editor saves (src/routes/columns.js): two fields
// added to the RFQ lines, one retired, and one extra field on the document itself.
const col = (key, label, type, o) => ({ key, label, type: type || 'text', builtin: false, visible: true, ...(o || {}) });
const ITEM_COLUMNS = [
  col('cf_battery_kwh', 'Battery (kWh)', 'number', { width: 110 }),
  col('cf_steering', 'Steering', 'select', { options: [{ key: 'lhd', label: 'Left-hand drive' }, { key: 'rhd', label: 'Right-hand drive' }] }),
  col('cf_spec_sheet', 'Spec sheet', 'link'),
  col('cf_retired', 'Retired column', 'text', { visible: false }),
];
const DOC_COLUMNS = [
  { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true },
  col('cf_priority', 'Priority', 'select', { options: [{ key: 'urgent', label: 'Urgent — reply within 48 h' }, { key: 'normal', label: 'Normal' }] }),
  col('cf_project', 'Project'),
];

module.exports = {
  rfq: base,
  // Answered: prices and lead times filled in.
  rfqAnswered: {
    ...base, status: 'answered',
    items: base.items.map((it, i) => ({ ...it, lead_time: ['25 days', '25 days', '40 days', '40 days'][i], fob_price: [17800, 15900, 13250, 14100][i], cif_price: [19400, 17450, 14800, 15650][i], notes: i === 2 ? 'Price valid until 30 Oct 2026' : '' })),
    delivery_location: 'Alexandria Port', service_provider: 'Sino Trans Logistics', contact: 'Ahmed Ali / +20 100 555 0199',
    documents_required: 'MSDS / UN3.8 / Commercial Invoice / Shipping order / Packing List / Temporary Licence and Plate / Sales contract / Export Licence / SGS PDI or Certificate of Conformity (CoC) / CIF ONLY ( B/L / Telex Release / Insurance Policy)',
  },
  // More lines than one printed page holds: the grid head repeats on the next page.
  rfqLong: {
    ...base,
    items: Array.from({ length: 24 }, (_, i) => item({
      brand: ['Deepal', 'Xpeng', 'BYD', 'Mazda'][i % 4], model: ['S05', 'L03', 'Seal', 'EZ60'][i % 4],
      trim: ['620 Laser Edition', '1330 Max', 'Design', 'EV 600 Max'][i % 4], colour: 'EXT: Grey INT: Nebula Purple/White', year: '2027',
    })),
  },
  // Blank supplier, no lines — must still open, with the fields ready to type into.
  rfqBlank: { rfq_no: 'MT01W01Y26', rfq_date: '', items: [], settings: {} },
  // Arabic and markup/formula-looking text — nothing may be executed, mangled or cut off.
  rfqHostile: {
    ...base, supplier_name: 'شركة النيل للسيارات', supplier_contact: '=HYPERLINK("http://evil.example","click")',
    supplier_address: '<b>Zone 5</b>, "Free" Zone & Port',
    items: [item({ brand: '+SUM(1,1)', model: '@cmd', trim: '-2+3', colour: '=1+1', year: '2027' })],
  },
  // The admin's extra columns after Notes, the document's own extra fields, and the company
  // details overridden from settings.
  rfqExtras: {
    ...base, rfq_no: 'MT42W318Y26', supplier_name: 'Nile Motors — شركة النيل', supplier_country: 'Egypt',
    items: [
      item({ brand: 'Deepal', model: 'S07', trim: 'Ultra', colour: 'EXT: White INT: Black', year: '2027', lead_time: '30 days', fob_price: 21500.5, cif_price: 23100, notes: 'Left-hand drive only',
        cf_battery_kwh: '82.5', cf_steering: 'lhd', cf_spec_sheet: 'https://example.com/specs/s07.pdf', cf_retired: 'not shown' }),
      item({ brand: 'Zeekr', model: '001', trim: 'You', colour: 'EXT: Grey INT: Tan', year: '2026/2027', accessories: '',
        cf_battery_kwh: '100', cf_steering: 'rhd' }),
    ],
    custom_fields: { cf_priority: 'urgent', cf_project: 'Q4 fleet order', cf_removed: 'kept as text' },
    settings: {
      company_name: 'Motolinkers Trading', company_address: 'Unit 12, Nile Business Park, New Cairo', company_email: 'rfq@motolinkers.example',
      company_website: 'www.motolinkers.example', company_phone: '+20 2 555 0100', company_tax_id: '111222333', company_reg_no: '98765',
      footer_note: 'Prices are confidential',
      'columns_config:rfq_items': JSON.stringify(ITEM_COLUMNS),
      'columns_config:rfq_doc': JSON.stringify(DOC_COLUMNS),
    },
  },
};
