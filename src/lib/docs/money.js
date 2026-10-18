'use strict';
// The money maths a quotation prints. One definition, shared by the route layer
// (src/routes/quotations.js publishes these on ctx) and the quotation builder, so the
// total on the page can never disagree with the total the editor showed.

function fmtNum(n) {
  const v = parseFloat(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('en-US');
}

function calcEgp(priceUsd, units, exchange) {
  const p = parseFloat(priceUsd);
  const u = parseFloat(units) || 1;
  const e = parseFloat(exchange) || 1;
  if (!isFinite(p)) return null;
  return Math.round(p * u * e);
}

module.exports = { fmtNum, calcEgp };
