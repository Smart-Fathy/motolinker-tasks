'use strict';
// The purchase order PDF.
//
// po: the purchase_orders row (+ client_name, settings) — see poBuildRow in
//     src/routes/purchase-orders.js for the fields.

const { shell } = require('./brand');

// STUB — replaced by the real purchase-order builder.
function buildPurchaseOrderHtml(po) {
  const p = po || {};
  return shell({ title: 'Purchase Order', settings: p.settings, body: '<div class="h-title">Purchase Order</div>' });
}

module.exports = { buildPurchaseOrderHtml };
