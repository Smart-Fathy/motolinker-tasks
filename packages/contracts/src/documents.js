'use strict';
// What the documents sent to suppliers are made of, before anybody has arranged anything: the statuses a document and a purchase
// order's line may have, and the fields a line has. The administrator can rename, recolour, add and hide (the column editor), but
// these are what exists until they do — and what the server's own lists are: tests/rfqpo.js holds every key here to what the
// routes accept, keep and refuse, so the app and the server cannot come to mean different things by "Confirmed".

/** @typedef {readonly [key: string, label: string]} Choice */
/** @typedef {readonly [key: string, label: string, width: number]} LineField */

/** What an RFQ's Status can be, in the order the select lists them (the first is what a new one starts as). @type {readonly Choice[]} */
const RFQ_STATUSES = [
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['answered', 'Answered'],
  ['closed', 'Closed'],
];

/** …and a purchase order's. @type {readonly Choice[]} */
const PO_STATUSES = [
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['confirmed', 'Confirmed'],
  ['closed', 'Closed'],
];

/** The colour a status badge starts with, by status key (every kind of document's, so a contract's will find its own here too). */
const DOC_STATUS_COLORS = {
  draft: '#b9b3a4',
  sent: '#e69650',
  answered: '#6dd8a4',
  confirmed: '#6dd8a4',
  signed: '#6dd8a4',
  closed: '#888888',
  cancelled: '#dc2626',
};

/**
 * Where a purchase order's vehicle line is in its journey (each line, not the order). `fg` is the colour the status badge is
 * painted in; `bg` is the wash the classic sheets drew behind it.
 */
const PO_LINE_STATUSES = [
  { key: 'send_to_supplier', label: 'SEND TO SUPPLIER', bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'in_preparation', label: 'Car in Preparation', bg: '#f3ddf7', fg: '#7b2d8e' },
  { key: 'in_logistics', label: 'In Logistics', bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'delivered', label: 'Car Delivered to moto', bg: '#d7f2d9', fg: '#1e6b2a' },
];

/** The fields an RFQ's requested vehicle has, with the width each column starts at. @type {readonly LineField[]} */
const RFQ_LINE_FIELDS = [
  ['brand', 'BRAND', 90],
  ['model', 'MODEL', 96],
  ['trim', 'TRIM', 90],
  ['colour', 'COLOR EXT / INT', 130],
  ['year', 'YEAR', 60],
  ['accessories', 'ACCESSORIES / REMARKS', 190],
  ['lead_time', 'LEAD TIME', 90],
  ['fob_price', 'FOB PRICE', 90],
  ['cif_price', 'CIF PRICE (RoRo)', 100],
];
/** Which of those hold a number. */
const RFQ_LINE_NUMBERS = ['fob_price', 'cif_price'];

/** …and a purchase order's vehicle line. @type {readonly LineField[]} */
const PO_LINE_FIELDS = [
  ['client', 'CLIENT', 150],
  ['consignee', 'CONSIGNEE', 150],
  ['units', 'UNITS', 62],
  ['brand', 'BRAND', 92],
  ['model', 'MODEL', 110],
  ['trim', 'TRIM', 120],
  ['color', 'COLOR EXT / INT', 160],
  ['year', 'YEAR', 66],
  ['accessories', 'ACCESSORIES / REMARKS', 200],
  ['payment_term', 'PAYMENT TERM', 130],
  ['pi_price', 'PI PRICE', 100],
  ['status', 'STATUS', 168],
  ['vin', 'VIN', 150],
  ['file_link', 'Client file Link', 140],
];
const PO_LINE_NUMBERS = ['units', 'pi_price'];

/** What a contract's Status can be, in the order the select lists them (the first is what a new one starts as). @type {readonly Choice[]} */
const CONTRACT_STATUSES = [
  ['draft', 'Draft'],
  ['signed', 'Signed'],
  ['cancelled', 'Cancelled'],
];

/**
 * What a payment line of the car-sale contract says it is paid "when" until somebody writes otherwise: "on signing this contract".
 * (src/lib/docs/contract-sale-text.js prints the same words for a line that has none; tests/contractdocs.js holds the two alike.)
 */
const CONTRACT_PAYMENT_WHEN = 'فور التوقيع علي هذا العقد';

/**
 * The template a new contract is written on: its form has the payment lines the person adds and takes away. A contract saved on
 * the older wording (no template) keeps the fields it had, and the form shows those.
 */
const CONTRACT_SALE_TEMPLATE = 'sale-v2';

/**
 * @typedef {readonly [path: string, label: string]} ContractField   a field of the contract's `data`, by its dotted path
 * @typedef {{ id: string, title: string, rows: readonly (readonly ContractField[])[], older?: readonly (readonly ContractField[])[] }} ContractSection
 *   a block of the form: each row is a line of fields; `older` are the rows only a contract on the older wording has
 */

/**
 * The blocks of the contract's form, in the order the paper form has them, each field under the label (the Arabic beside it where
 * the paper form has one) the classic editor gave it. tests/contractdocs.js holds every path here to what the contract prints, so a
 * field the form offers is a blank the paper fills in.
 * @type {readonly ContractSection[]}
 */
const CONTRACT_SECTIONS = [
  {
    id: 'date',
    title: 'Contract date · تاريخ العقد',
    rows: [
      [
        ['contractDate.day', 'Day (اليوم)'],
        ['contractDate.d', 'DD'],
        ['contractDate.m', 'MM'],
        ['contractDate.y', 'YYYY'],
      ],
    ],
  },
  {
    id: 'company',
    title: 'First party — company · الطرف الأول',
    rows: [
      [
        ['company.name', 'Company name'],
        ['company.commercialReg', 'Commercial register'],
        ['company.taxId', 'Tax ID'],
        ['company.address', 'Address'],
        ['company.repIn', 'Represented by'],
      ],
      [
        ['rep.name', 'Rep. name'],
        ['rep.nationalId', 'Rep. national ID'],
        ['rep.idDate', 'ID issue date'],
        ['rep.nationality', 'Nationality'],
        ['rep.religion', 'Religion'],
        ['rep.address', 'Rep. address'],
        ['rep.role', 'Capacity (بصفة)'],
      ],
    ],
  },
  {
    id: 'buyer',
    title: 'Second party — buyer · الطرف الثاني',
    rows: [
      [
        ['buyer.name', 'Buyer name'],
        ['buyer.nationalId', 'National ID'],
        ['buyer.idDate', 'ID issue date'],
        ['buyer.nationality', 'Nationality'],
        ['buyer.religion', 'Religion'],
        ['buyer.address', 'Address'],
      ],
    ],
  },
  {
    id: 'vehicle',
    title: 'Vehicle · بيانات السيارة',
    rows: [
      [
        ['vehicle.make', 'Make (ماركة)'],
        ['vehicle.model', 'Model (موديل)'],
        ['vehicle.color', 'Colour (اللون)'],
        ['vehicle.year', 'Year (سنة الصنع)'],
        ['vehicle.notes', 'Notes (ملاحظات)'],
      ],
    ],
    older: [[['importCountry', 'Import country']]],
  },
  {
    id: 'money',
    title: 'Financials · البند الثالث',
    rows: [
      [
        ['total', 'Total amount'],
        ['totalWords', 'Amount in words'],
      ],
    ],
    older: [
      [
        ['lateFee', 'Late fee / day'],
        ['lateFeeWords', 'Late fee in words'],
        ['deliveryDeadline', 'Delivery deadline (البند الرابع)'],
      ],
    ],
  },
];

module.exports = {
  CONTRACT_STATUSES,
  CONTRACT_PAYMENT_WHEN,
  CONTRACT_SALE_TEMPLATE,
  CONTRACT_SECTIONS,
  RFQ_STATUSES,
  PO_STATUSES,
  DOC_STATUS_COLORS,
  PO_LINE_STATUSES,
  RFQ_LINE_FIELDS,
  RFQ_LINE_NUMBERS,
  PO_LINE_FIELDS,
  PO_LINE_NUMBERS,
};
