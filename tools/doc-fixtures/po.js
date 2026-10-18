'use strict';
// Sample purchase orders for rendering (node tools/render-docs.js po poLong …) and for tests/doc-po.js.
//
//   po          the usual order: five lines, a consignee, a quantity above 1, long colour text, notes
//   poOneLine   a short order: the grid still shows its five numbered rows
//   poLong      nineteen lines: runs onto a second page (head row, total and footer must follow)
//   poMinimal   nothing but a number: no supplier, no lines — every blank prints as a blank
//   poHostile   markup in the free text: it must print as text
//   poStress    the worst case for the grid: long names, words with no break, a 13-figure price,
//               a quantity of 120, a very long accessories text, long terms and delivery fields
//   poArabic    Arabic and Latin mixed in the names, the colours, the note and the terms

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

const UNBROKEN = 'Supercalifragilisticexpialidocious-Model-Name-Without-Any-Spaces-At-All-X';

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
  // The worst case for the grid and the cards: names that run long, words that cannot break, big numbers.
  poStress: {
    ...base,
    po_number: 'PO2610-9999', quote_id: 'MT28W88Y26-REV2-FINAL', po_date: '2026-10-12T09:30:00.000Z', currency: 'usd',
    supplier_name: 'Guangzhou Zhongxin International Automobile Import & Export Trading Company Limited',
    supplier_contact: 'Mr. Li Wei Jian (Sales Director) / +86 20 8765 4321 / +86 139 0000 1234 / wei.jian@gz-zhongxin-auto.example',
    supplier_address: 'Building-12/Unit-3/Floor-5/Room-501/Zhongshan-Avenue-West-Tianhe-District, Guangzhou City, Guangdong Province, 510630',
    supplier_country: "People's Republic of China", issuer: 'Mohamed Yasser Abdelrahman El-Sayed',
    delivery_location: 'Alexandria Port (Sea Port), Container Terminal 2, Gate 4', service_provider: 'Sino Trans Logistics & Freight Forwarding International Co., Ltd.',
    contact: 'Ahmed Ali (Operations) / +20 100 555 0199 / +20 122 333 4455',
    payment_terms: '40% advance with the order\n50% against the copy of the B/L (telex release)\n10% after the vehicles are received and inspected in XXXXX Port, to be confirmed by the logistics team before the vessel sails',
    documents_required: 'Commercial Invoice / Packing List\nCIF ONLY: Insurance Certificate + Bill of Lading\nCertificate of Origin (Form E) legalised by the Egyptian consulate in Shanghai',
    notes: 'Please confirm the production slot and the VIN list within 3 working days of receiving this order.\nAll vehicles must be delivered with the second key, the manual in English and a full battery charge.\nAny change to the specification after the order is confirmed must be agreed in writing by both parties before production starts.',
    items: [
      line({ client: 'Mohamed Abdelrahman El-Sayed Hassan Ibrahim', consignee: 'Al-Nahda Automotive Trading & Import Company (Cairo Branch)', brand: 'Mercedes-Benz', model: 'EQS 580 4MATIC SUV',
        trim: 'AMG Line Premium Plus Executive Package', color: 'EXT: Obsidian Black Metallic with Pearl Effect INT: Macchiato Beige / Black Nappa Leather with Contrast Stitching',
        year: '2027', units: 12, pi_price: 123456.5,
        accessories: 'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump\nExtended warranty certificate\nWinter tyre set with alloy wheels, roof rails and a panoramic roof sunshade' }),
      line({ client: UNBROKEN, brand: 'Supercalifragilistic', model: 'ModelNameWithoutAnySpacesAtAllX', trim: 'TrimNameWithoutAnySpacesAtAllXXXXXXXX',
        color: 'EXT:Grey/INT:Black/Piping:Orange/Stitching:Silver', year: '2027', units: 1, pi_price: 99999999.99,
        accessories: 'https://example.com/a/very/long/path/without/spaces/that/keeps/going/and/going?x=1&y=2' }),
      line({ client: 'Hana Fouad', brand: 'Xpeng', model: 'L03', trim: '625 Max', color: 'Ext: Black INT: Purple', year: '2027', units: 1, pi_price: 0 }),
      line({ client: 'Nile Motors', brand: 'Mazda', model: 'EZ60', trim: 'EV 600 Max', color: 'EXT: White INT: Black', year: '2026', units: 120, pi_price: 17800.25,
        accessories: 'Floor mats '.repeat(60).trim() }),
    ],
  },
  // Arabic and Latin mixed: each value takes its direction from its own first letter.
  poArabic: {
    ...base,
    supplier_name: 'شركة النيل للسيارات - Nile Auto', supplier_contact: 'السيد/ وانغ لي / +86 755 8888 1234', supplier_address: 'شنتشن، قوانغدونغ - Shenzhen, Guangdong',
    supplier_country: 'الصين', issuer: 'محمد ياسر', client_name: 'عمر حسن',
    notes: 'برجاء تأكيد موعد الإنتاج وقائمة أرقام الشاسيه خلال ٣ أيام عمل من استلام هذا الأمر.\nPlease confirm the production slot as well.',
    items: [
      line({ client: 'عمر حسن', brand: 'Deepal', model: 'S05', trim: '620 Laser Edition', color: 'EXT: رمادي INT: أسود', year: '2027', units: 1, pi_price: 17800 }),
      line({ client: 'سارة مصطفى', consignee: 'شركة مصطفى للتجارة', brand: 'ديبال', model: 'S05', trim: '215 Max', color: 'EXT: White INT: بيج', year: '2027', units: 2, pi_price: 15900, accessories: 'نظام لغة إنجليزية ، كابل شحن جداري ، دواسات أرضية ، English system' }),
      line({ client: '', consignee: '', brand: 'Xpeng', model: 'L03', trim: '1330 Max', color: 'EXT: Black INT: Purple', year: '2027', units: 1, pi_price: 13250 }),
    ],
  },
};
