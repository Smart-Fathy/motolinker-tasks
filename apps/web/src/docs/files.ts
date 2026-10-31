// What a document becomes in the browser: the workbook an RFQ goes to its supplier as (a download), and the PDF a purchase order
// is read as (a frame). Both arrive from the server as base64.
import { fileName } from './model';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The bytes of a base64 answer, as a Blob of this kind. */
export function blobOf(base64: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

/** A PDF made from the server's answer, as an address a frame can show. The caller gives it back with `URL.revokeObjectURL`. */
export const pdfUrl = (base64: string): string =>
  URL.createObjectURL(blobOf(base64, 'application/pdf'));

/** Hands the browser a workbook to save as "RFQ_<name>.xlsx" (the address is given back ten seconds later, as the classic page does). */
export function downloadXlsx(base64: string, name: string): void {
  const url = URL.createObjectURL(blobOf(base64, XLSX_TYPE));
  const a = document.createElement('a');
  a.href = url;
  a.download = `RFQ_${fileName(name || 'motolinkers')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
