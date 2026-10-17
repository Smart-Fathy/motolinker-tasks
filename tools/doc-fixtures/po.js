'use strict';
// Sample purchase orders for rendering and tests.

const ACC = 'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump';
const line = (o) => ({ client: '', consignee: '', units: 1, brand: '', model: '', trim: '', color: '', year: '', accessories: ACC,
  payment_term: '', pi_price: 0, status: 'send_to_supplier', vin: '', file_link: '', ...o });

const base = {
  po_number: 'PO2610-4821', title: 'PCH auto — October order', supplier: 'PCH auto', po_date: '2026-10-12', currency: 'USD',
  supplier_name: 'PCH auto', supplier_contact: 'Yoyo / +8613380783532',
  supplier_address: "NO. 211, Baofa Company, Jinwan Avenue, Dachan Bay, Haoye Community, Xixiang Street, Bao'an District, Shenzhen City, Guangdong Province",
  supplier_country: 'China', issuer: 'Mohamed Yasser', quote_id: 'MT28W88Y26',
  incoterm: 'FOB', delivery_location: 'Shanghai Port', service_provider: 'Sino Trans Logistics', contact: 'Ahmed Ali / +20 100 555 0199',
  payment_terms: '30% deposit to confirm the order\n70% balance due after the vehicle arrives in Shanghai Port (VIN code and PDI vehicle video and document to be provided for confirmation)',
  documents_required: 'MSDS / UN3.8 / Commercial Invoice / Shipping order / Packing List / Temporary Licence and Plate / Sales contract / Export Licence / SGS PDI or Certificate of Conformity (CoC) / CIF ONLY ( B/L / Telex Release / Insurance Policy)',
  notes: 'Please confirm the production slot and the VIN list within 3 working days of receiving this order.',
  client_name: 'Omar Hassan', status: 'sent', settings: {},
  items: [
    line({ client: 'Omar Hassan', brand: 'Deepal', model: 'S05', trim: '620 Laser Edition', color: 'EXT: Grey INT: Nebula Purple/White', year: '2027', units: 1, pi_price: 17800 }),
    line({ client: 'Sara Mostafa', consignee: 'Mostafa Trading', brand: 'Deepal', model: 'S05', trim: '215 Max', color: 'EXT: Grey INT: Grey', year: '2027', units: 2, pi_price: 15900 }),
    line({ client: 'Karim Adel', brand: 'Xpeng', model: 'L03', trim: '1330 Max', color: 'Ext: Black INT: Purple', year: '2027', units: 1, pi_price: 13250 }),
    line({ client: 'Hana Fouad', brand: 'Xpeng', model: 'L03', trim: '625 Max', color: 'Ext: Black INT: Purple', year: '2027', units: 3, pi_price: 14100, accessories: 'English system , wall mount charging cable' }),
    line({ client: '', consignee: 'Nile Motors', brand: 'Mazda', model: 'EZ60', trim: 'EV 600 Max', color: 'EXT: White INT: Black', year: '2026', units: 1, pi_price: 22500 }),
  ],
};

module.exports = {
  po: base,
  // Fewer than the five rows the printed form always shows.
  poOneLine: { ...base, notes: '', items: [base.items[0]] },
  // Enough lines to run onto a second page: the header row and the footer must repeat.
  poLong: {
    ...base,
    items: Array.from({ length: 19 }, (_, i) => line({
      client: `Client ${i + 1}`, brand: ['Deepal', 'Xpeng', 'BYD', 'Mazda'][i % 4], model: ['S05', 'L03', 'Seal', 'EZ60'][i % 4],
      trim: ['620 Laser Edition', '1330 Max', 'Design', 'EV 600 Max'][i % 4], color: 'EXT: Grey INT: Nebula Purple/White',
      year: '2027', units: (i % 3) + 1, pi_price: 14000 + i * 420,
    })),
  },
  // No supplier details, no lines — nothing may break or print "undefined".
  poMinimal: { po_number: 'PO2601-0001', po_date: '', currency: 'USD', items: [], settings: {} },
  // Markup in every free-text field: it must print as text, never as HTML.
  poHostile: {
    ...base, supplier_name: '<img src=x onerror=alert(1)> PCH & "Co"', notes: '<script>alert(1)</script>',
    items: [line({ client: '<b>Omar</b>', brand: '</td><td>X', model: '"quoted"', pi_price: 1000 })],
  },
};
