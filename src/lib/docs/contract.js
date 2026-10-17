'use strict';
// Contracts. A contract's `data.template` says which wording it was drawn up on:
//   'sale-v2'  the car-sale (import) contract — built here, in the current look
//   anything else  the original agency-style contract, rendered by ./contract-legacy.js
// so a contract saved before the switch re-exports with exactly the words it was signed on.

const { shell } = require('./brand');
const { buildLegacyContractHtml } = require('./contract-legacy');

const SALE_TEMPLATE = 'sale-v2';

// STUB — replaced by the real car-sale contract builder.
function buildSaleContractHtml(data) {
  return shell({ title: 'عقد بيع سيارة استيراد', dir: 'rtl', settings: (data || {}).settings, body: '<div class="h-title">عقد بيع سيارة استيراد</div>' });
}

function buildContractHtml(data) {
  const d = data || {};
  return d.template === SALE_TEMPLATE ? buildSaleContractHtml(d) : buildLegacyContractHtml(d);
}

module.exports = { SALE_TEMPLATE, buildContractHtml, buildSaleContractHtml };
