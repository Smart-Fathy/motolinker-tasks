# Generated documents

Quotation, contract and purchase order are PDFs; the RFQ is an Excel workbook (the
supplier fills the prices in and sends it back). All four share one look.

| Document | Builder | Output | Entry points |
|---|---|---|---|
| Quotation | `quotation.js` → `buildQuotationHtml(data)` | PDF | `POST /api/*/quotation/generate`, `…/quotations/:id/pdf`, client folder |
| Contract | `contract.js` → `buildContractHtml(data)` | PDF (Arabic, RTL) | `…/contracts/pdf`, `…/contracts/:id/pdf`, client folder, auto-draft on a won deal |
| Purchase order | `purchase-order.js` → `buildPurchaseOrderHtml(po)` | PDF | `…/purchase-orders/pdf`, `…/:id/pdf`, client folder |
| RFQ | `rfq-xlsx.js` → `buildRfqXlsx(rfq)` | `.xlsx` | `…/rfqs/xlsx`, `…/rfqs/:id/xlsx`, client folder |

The route files only load the record and call the builder; the look is all here.

## Identity

The palette comes from the logo: wordmark `#043627` (dark green, "ink"), road mark
`#3A8E0E` (brand green), and the mint tints the company's RFQ sheet already used
(`#F5F9F3`, `#EAF4E5`). The typeface is **Poppins**; Arabic is set in **Cairo**. Both are
bundled in `src/assets/fonts` and embedded as data URIs, as are the logos in
`src/assets/brand` (colour, white, reverse for dark backgrounds, and the road mark alone),
so a document looks the same on any machine and never waits on a CDN. Everything is
defined once, in `brand.js`; change a colour there, not in a document.

## How a PDF is built

`brand.shell({ body, settings, header, footer, extraCss, dir })` returns the whole HTML
document:

* a **fixed header** (logo, tagline, two-tone rule) and **fixed footer** (office, contact,
  registration, note), which Chrome repeats on every printed page;
* a **flow table** whose empty `<thead>`/`<tfoot>` reserve exactly the room those two take,
  so the content never runs under them, and a document of any length paginates itself;
* a **"Page n of N"** counter in the page margin (`@page` margin box; Arabic in an RTL doc).

Give blocks that must not split `break-inside: avoid`; give a heading `break-after: avoid`.
Tables repeat their header row on each page (`thead` is `display: table-header-group`).

Components in the base stylesheet: `.eyebrow`, `.h-title`, `.h-sub`, `.sec-title`, `.card`
(+ `h4`), `.meta` (`.k`/`.v` pairs), `table.kv` (label/value rows), `table.tbl` (the data
table: dark head, zebra rows, `.num`, `.ctr`, `.strong`, `.free`), `.total` (dark total
block), `.pill`, `.rule`. A document adds its own rules through `extraCss`.

`renderPdf(html)` (`render.js`) is the one HTML→PDF path. It refuses any request that
isn't a `data:` or `https:` URL.

## Looking at a document

```
node tools/render-docs.js --list          # the sample documents (tools/doc-fixtures/)
node tools/render-docs.js quotation po    # render some; PDFs and PNGs land in .doc-samples/
node tools/render-docs.js contract --dpi 110 --out /tmp/docs
```

PNGs need `pdftoppm`; the RFQ's PNGs need LibreOffice (`soffice`). The samples include an
empty/blank one, a long one that runs onto further pages, and one full of markup, so the
edge cases get looked at too.

## Rules the documents keep

* **Text is text.** Everything a person typed goes through `esc()`; nothing is interpolated
  as HTML. In the workbook every cell is written as a string/number, never a formula.
* **A saved record re-renders as it was signed.** A contract carries `data.template`; one
  without it renders the original wording (`contract-legacy.js`, kept verbatim).
* **Blanks print as blanks.** A missing value never prints `undefined`; where the paper
  form had a line to fill in by hand, the blank keeps its line.
