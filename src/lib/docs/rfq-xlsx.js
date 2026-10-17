'use strict';
// The RFQ — Request for Quotation — as an Excel workbook. Suppliers fill the price,
// lead-time and notes columns in and send it back, so it is a spreadsheet, not a PDF.
//
// rfq: the rfqs row (+ settings) — see rfqBuildRow in src/routes/rfq.js for the fields.
// Resolves to a Buffer holding the .xlsx file.

const ExcelJS = require('exceljs');

// STUB — replaced by the real RFQ workbook builder.
async function buildRfqXlsx(rfq) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RFQ');
  ws.getCell('B2').value = 'Request for Quotation';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = { XLSX_MIME, buildRfqXlsx };
