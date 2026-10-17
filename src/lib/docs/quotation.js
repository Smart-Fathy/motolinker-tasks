'use strict';
// The quotation PDF.
//
// data: { id, date, validTo, name, vehicleModel, items:[{name,unit,priceUsd}],
//         logistics:[{label,priceUsd}], currency, exchange, issuer, imageDataUrls:[],
//         customSpecs:[{key,val}], settings:{…quotation_settings}, template }

const { shell } = require('./brand');

// STUB — replaced by the real quotation builder.
function buildQuotationHtml(data) {
  const d = data || {};
  return shell({ title: 'Quotation', settings: d.settings, body: '<div class="h-title">Quotation</div>' });
}

module.exports = { buildQuotationHtml };
