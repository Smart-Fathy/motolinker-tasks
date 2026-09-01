// Domain vocabulary shared across features.
//
// These lived scattered through index.js, several of them declared hundreds of
// lines AFTER the code that reads them — legal only because the reads happen at
// request time. That forward reference is what stopped feature blocks from being
// pulled into their own modules, so the shared vocabulary lives here instead.

const LEADS_ENUM_DEFAULTS = {
  status: [['cold','Cold'],['warm','Warm'],['hot','Hot'],['immediate_delivery','Immediate Delivery'],['not_interested','Not Interested'],['blacklist','Blacklist']],
  source: [['fb_ad','FB Ad.'],['whatsapp','Whatsapp'],['messenger','Messenger'],['direct_call','Direct Call'],['ig_ads','IG ads'],['website','Website'],['walk_in','Walk-in'],['marketplace','Marketplace']],
  next_action: [['followed_by_sales','Followed By Sales'],['need_follow_up','Need Follow Up'],['closed','Closed'],['no_answer','No Answer']],
};

const PO_LINE_STATUSES = [
  { key: 'send_to_supplier', label: 'SEND TO SUPPLIER',      bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'in_preparation',   label: 'Car in Preparation',    bg: '#f3ddf7', fg: '#7b2d8e' },
  { key: 'in_logistics',     label: 'In Logistics',          bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'delivered',        label: 'Car Delivered to moto', bg: '#d7f2d9', fg: '#1e6b2a' },
];
const PO_LINE_STATUS_KEYS = PO_LINE_STATUSES.map(s => s.key);

const BRAND_LOGO_URL = 'https://images.motolinkers.com/avatar-11-max-reev/motolinkers-logo-black-text-preview.png';

// Attachments on a task. The client posts each file to /api/*/tasks/upload and
// sends back the {url,name,size,type} objects that route returns, so this only
// has to reject anything that did not come from there. Enforced server-side
// because a hand-written POST does not go through the client's file picker.
const TASK_ATTACH_MAX = 10;
function sanitizeAttachments(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(a => a && typeof a === 'object')
    // Only our own storage bucket. Without this the column is a stored-XSS
    // vector the moment anything renders it as a link.
    .filter(a => /^https:\/\//i.test(String(a.url || '')))
    .slice(0, TASK_ATTACH_MAX)
    .map(a => ({
      url: String(a.url).slice(0, 2048),
      name: String(a.name || 'file').slice(0, 200),
      size: Number(a.size) > 0 ? Math.floor(Number(a.size)) : null,
      type: String(a.type || '').slice(0, 100),
    }));
}

// ── Logistics and money ──────────────────────────────────────────────────────
// The company buys in USD and sells in EGP, so "how much" is never a single
// number. Everything money-shaped carries the currency it happened in plus the
// rate that converted it, and BASE_CURRENCY is what totals are reported in.
const BASE_CURRENCY = 'EGP';
const CURRENCIES = ['EGP', 'USD', 'EUR', 'AED', 'SAR', 'CNY', 'JPY', 'GBP'];

// The life of one physical vehicle, in order. The order is the point: the UI
// draws it as a timeline and `unitStageIndex` reads progress off it.
const UNIT_STATUSES = [
  { key: 'ordered',    label: 'Ordered',        bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'produced',   label: 'In production',  bg: '#f3ddf7', fg: '#7b2d8e' },
  { key: 'shipped',    label: 'Shipped',        bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'landed',     label: 'Landed',         bg: '#ffe9d6', fg: '#9a4b12' },
  { key: 'cleared',    label: 'Customs cleared',bg: '#e2f0d9', fg: '#3d6b1e' },
  { key: 'in_stock',   label: 'In stock',       bg: '#d7f2d9', fg: '#1e6b2a' },
  { key: 'allocated',  label: 'Allocated',      bg: '#d6ecff', fg: '#14568c' },
  { key: 'delivered',  label: 'Delivered',      bg: '#d7f2d9', fg: '#1e6b2a' },
  { key: 'cancelled',  label: 'Cancelled',      bg: '#f7dada', fg: '#8e2d2d' },
];
const UNIT_STATUS_KEYS = UNIT_STATUSES.map(s => s.key);

// What a payment is for. `supplier` and `refund` are the two that move the other
// way, which is why direction is stored separately rather than inferred.
const PAYMENT_KINDS = [
  { key: 'reservation',  label: 'Reservation',   dir: 'in'  },
  { key: 'down_payment', label: 'Down payment',  dir: 'in'  },
  { key: 'instalment',   label: 'Instalment',    dir: 'in'  },
  { key: 'final',        label: 'Final payment', dir: 'in'  },
  { key: 'refund',       label: 'Refund',        dir: 'out' },
  { key: 'supplier',     label: 'Supplier',      dir: 'out' },
  { key: 'freight',      label: 'Freight',       dir: 'out' },
  { key: 'customs',      label: 'Customs',       dir: 'out' },
];
const PAYMENT_KIND_KEYS = PAYMENT_KINDS.map(k => k.key);
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'instapay', 'other'];
const PAYMENT_DIRECTIONS = ['in', 'out'];

const CONTAINER_STATUSES = [
  { key: 'booked',     label: 'Booked',      bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'in_transit', label: 'In transit',  bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'arrived',    label: 'Arrived',     bg: '#d6ecff', fg: '#14568c' },
  { key: 'discharged', label: 'Discharged',  bg: '#e2f0d9', fg: '#3d6b1e' },
  { key: 'cleared',    label: 'Cleared',     bg: '#d7f2d9', fg: '#1e6b2a' },
  { key: 'closed',     label: 'Closed',      bg: '#e6e6e6', fg: '#555555' },
];
const CONTAINER_STATUS_KEYS = CONTAINER_STATUSES.map(s => s.key);

// The sizes that show up on a carrier's container card, verbatim.
const CONTAINER_TYPES = [
  "20' DRY", "40' DRY", "40' HIGH CUBE", "45' HIGH CUBE",
  "20' REEFER", "40' REEFER", "20' OPEN TOP", "40' OPEN TOP",
  "20' FLAT RACK", "40' FLAT RACK", 'OTHER',
];

// ── ISO 6346 ────────────────────────────────────────────────────────────────
// A container number is four letters (the last of which is the category, almost
// always U) then six digits and a check digit, and the check digit is derived
// from the rest. Typing one off a screenshot is exactly the situation the check
// digit exists for, so it is computed on entry — a mismatch is reported to the
// person entering it rather than refused, because a wrong-but-real number on a
// bill of lading still has to be trackable.
//
// Letters take values 10..38 skipping every multiple of 11; each of the first
// ten characters is weighted by 2^position; the sum modulo 11 is the check
// digit, with 10 written as 0.
// A..Z as 10..38 with every multiple of 11 left out. Written out rather than
// computed: the arithmetic that generates it is a two-line trap (skipping 11, 22
// and 33 is not the same as skipping every eleventh index) and this is checked
// against the standard's own example in tests/logistics.js.
const CONTAINER_LETTER_VALUES = [
  10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38,
];
function containerCheckDigit(no) {
  const s = String(no || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{4}[0-9]{6}/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    const v = (c >= '0' && c <= '9') ? c.charCodeAt(0) - 48
                                     : CONTAINER_LETTER_VALUES[c.charCodeAt(0) - 65];
    sum += v * Math.pow(2, i);
  }
  const d = sum % 11;
  return d === 10 ? 0 : d;
}
const CONTAINER_NO_RE = /^[A-Z]{4}[0-9]{7}$/;
function normContainerNo(no) {
  return String(no || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
}
// { no, valid, checkOk, expected } — `valid` is the shape, `checkOk` the digit.
function inspectContainerNo(raw) {
  const no = normContainerNo(raw);
  const valid = CONTAINER_NO_RE.test(no);
  if (!valid) return { no, valid: false, checkOk: false, expected: null };
  const expected = containerCheckDigit(no);
  return { no, valid: true, checkOk: expected != null && expected === Number(no[10]), expected };
}

module.exports = { LEADS_ENUM_DEFAULTS, PO_LINE_STATUSES, PO_LINE_STATUS_KEYS, BRAND_LOGO_URL, TASK_ATTACH_MAX, sanitizeAttachments,
  BASE_CURRENCY, CURRENCIES, UNIT_STATUSES, UNIT_STATUS_KEYS,
  PAYMENT_KINDS, PAYMENT_KIND_KEYS, PAYMENT_METHODS, PAYMENT_DIRECTIONS,
  CONTAINER_STATUSES, CONTAINER_STATUS_KEYS, CONTAINER_TYPES,
  containerCheckDigit, normContainerNo, inspectContainerNo, CONTAINER_NO_RE };
