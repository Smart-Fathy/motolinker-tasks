'use strict';
// What Inventory & Logistics is made of before anybody has arranged anything: the columns a car in the stock register has, the
// statuses and the sizes a container can be, and the container number's own check (ISO 6346). The administrator can rename,
// recolour, add and hide a car's columns (the column editor); these are what exists until they do.
//
// The server keeps its own copy of the container lists and of the check (src/lib/constants.js): tests/containerroutes.js holds the
// two alike, key by key and number by number, so the app and the routes cannot come to mean different things by "Cleared". A car's
// Status is a purchase order line's (PO_LINE_STATUSES in documents.js) — tests/stockroutes.js holds that list to what a save keeps.

/** @typedef {readonly [key: string, label: string, width: number]} UnitField */

/**
 * What each car in a model's row has, with the width each column starts at. Eight columns, in this order, before the column
 * editor changes any. (A car's Colour is one field, "exterior / interior".)
 * @type {readonly UnitField[]}
 */
const STOCK_UNIT_FIELDS = [
  ['consignee', 'Consignee', 120],
  ['colour', 'Colour EXT / INT', 120],
  ['vin', 'VIN', 120],
  ['status', 'Status', 120],
  ['price_list', 'Price List', 120],
  ['discounted', 'Discounted', 120],
  ['logistics', 'Logistics', 120],
  ['supplier', 'Supplier', 120],
];
/** Which of those hold a number. */
const STOCK_UNIT_NUMBERS = ['price_list', 'discounted'];

/** The columns of the CSV the register is bulk-loaded from (the template the administrator downloads has exactly these). */
const STOCK_CSV_HEADERS = ['make', 'model', 'trim', 'price', 'units', 'notes'];

/**
 * Where a box is on its way. `fg` is the colour the status badge is painted in; `bg` is the wash behind it. The first is what a
 * box starts as only when it is booked by hand; a box the server saves without a (known) status is "in transit".
 */
const CONTAINER_STATUSES = [
  { key: 'booked', label: 'Booked', bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'in_transit', label: 'In transit', bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'arrived', label: 'Arrived', bg: '#d6ecff', fg: '#14568c' },
  { key: 'discharged', label: 'Discharged', bg: '#e2f0d9', fg: '#3d6b1e' },
  { key: 'cleared', label: 'Cleared', bg: '#d7f2d9', fg: '#1e6b2a' },
  { key: 'closed', label: 'Closed', bg: '#e6e6e6', fg: '#555555' },
];
const CONTAINER_STATUS_KEYS = CONTAINER_STATUSES.map(s => s.key);

/** What a box can be, as the carrier's own card writes it (the form's select; a type the carrier uses that is not here is kept as typed). */
const CONTAINER_TYPES = [
  "20' DRY",
  "40' DRY",
  "40' HIGH CUBE",
  "45' HIGH CUBE",
  "20' REEFER",
  "40' REEFER",
  "20' OPEN TOP",
  "40' OPEN TOP",
  "20' FLAT RACK",
  "40' FLAT RACK",
  'OTHER',
];

// ── ISO 6346 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// A container number is four letters (the last the category, nearly always U), six digits and a check digit derived from the rest.
// Typed off a screenshot, a number is exactly what the check digit is for — so it is reported to the person entering it, never
// refused: a wrong-but-real number on a bill of lading still has to be trackable. Letters take the values 10..38 skipping every
// multiple of 11, each of the first ten characters is weighted by 2^position, the sum modulo 11 is the digit, and 10 is written 0.
const CONTAINER_LETTER_VALUES = [
  10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36,
  37, 38,
];
const CONTAINER_NO_RE = /^[A-Z]{4}[0-9]{7}$/;

/**
 * How a container number is written down: upper case, letters and digits only, at most eleven of them.
 * @param {unknown} no
 */
function normContainerNo(no) {
  return String(no || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 11);
}

/** The check digit the first ten characters call for, or null when they are not four letters then six digits. @param {unknown} no */
function containerCheckDigit(no) {
  const s = String(no || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{4}[0-9]{6}/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s.charAt(i);
    const v =
      c >= '0' && c <= '9'
        ? c.charCodeAt(0) - 48
        : (CONTAINER_LETTER_VALUES[c.charCodeAt(0) - 65] ?? 0);
    sum += v * Math.pow(2, i);
  }
  const d = sum % 11;
  return d === 10 ? 0 : d;
}

/**
 * What a typed container number amounts to. `valid` is its shape (four letters then seven digits), `checkOk` whether the last
 * digit is the one the others call for, `expected` that digit.
 * @param {unknown} raw
 * @returns {{ no: string, valid: boolean, checkOk: boolean, expected: number | null }}
 */
function inspectContainerNo(raw) {
  const no = normContainerNo(raw);
  const valid = CONTAINER_NO_RE.test(no);
  if (!valid) return { no, valid: false, checkOk: false, expected: null };
  const expected = containerCheckDigit(no);
  return {
    no,
    valid: true,
    checkOk: expected != null && expected === Number(no.charAt(10)),
    expected,
  };
}

module.exports = {
  STOCK_UNIT_FIELDS,
  STOCK_UNIT_NUMBERS,
  STOCK_CSV_HEADERS,
  CONTAINER_STATUSES,
  CONTAINER_STATUS_KEYS,
  CONTAINER_TYPES,
  normContainerNo,
  containerCheckDigit,
  inspectContainerNo,
};
