'use strict';
// The wording the company's supplier-facing forms start from. These are DATA the team
// edits per document (payment terms, the documents a supplier must send, the standard
// accessories), not part of the design, so they live apart from the look in ./brand.js.

const DOC_DEFAULT_PAYMENT_TERMS =
  '30% deposit to confirm the order\n70% balance due after the vehicle arrives in XXXXX (VIN code and PDI vehicle video and document to be provided for confirmation)';
const DOC_DEFAULT_DOCUMENTS =
  'MSDS / UN3.8 / Commercial Invoice / Shipping order / Packing List / Temporary Licence and Plate / Sales contract / Export Licence / SGS PDI or Certificate of Conformity (CoC) / CIF ONLY ( B/L / Telex Release / Insurance Policy)';
const DOC_DEFAULT_ACCESSORIES =
  'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump';

module.exports = { DOC_DEFAULT_ACCESSORIES, DOC_DEFAULT_DOCUMENTS, DOC_DEFAULT_PAYMENT_TERMS };
