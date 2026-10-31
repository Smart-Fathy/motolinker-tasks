# RFQ — the classic portals and the new app

**RFQ** — the request for quotation sent to a supplier: a list of them (number, supplier, how many vehicles, status, date), a form
in a wide sheet (the supplier block, the vehicles asked about as a grid the administrator arranges, the terms, the fields the
administrator added to every RFQ), and each RFQ as a workbook the supplier fills the prices into. From the module
`apps/web/src/modules/rfq` (the list, the form), `apps/web/src/docs` (what RFQs and purchase orders share: the answers' checks and
small words, the data, the page, the lines, the supplier-catalogue picker, the viewer — see [purchase orders](purchaseorders.md)),
`apps/web/src/columns` (the column engine, shared with [Suppliers](suppliers.md)) and `apps/web/src/ui`. The server side is not
new: `mountRfqRoutes` already served both portals with one handler, so the app calls the portals' own routes as they are
(`/api/dashboard/…`, `/api/employee/…`). The classic code (`public/assets/procurement.js`) stays where it is until the cutover.

Test files named below: **R** `tests/rfqpo.js` (the routes of both portals — who may ask for each, what a save keeps and refuses,
what the starting form holds, what an export hands back; every answer held to its schema in `packages/contracts`), **P**
`tests/docparity.js` (look, value by value, in a real browser; two suites, one per portal), **E** `tests/webdocs.js` (the real
server, the built app, a real browser, real workbooks and PDFs), **U** `apps/web/src/docs/` (`model.test.ts`, `data.test.tsx`,
`docs.test.tsx`) and `apps/web/src/modules/rfq/rfq.test.tsx`, **M** `tests/modules.js` and `apps/web/src/app/registry.test.ts` (the
catalogue: RFQ is a screen of the Tools group, behind the `rfq` section), **W** `tests/webframe.js` (RFQ is no longer
framed), **B** `tests/embed.js`, `apps/web/src/legacy/bridge.test.ts` and `LegacyFrame.test.tsx` (the lead handed over from the
framed Leads page), **C** `tests/colengine.js` (the classic engine itself, unchanged).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/rfqs` — the list, newest first, with what a row is drawn from (`rfq.view`; 403 without it) | The same route; its shape is `RfqList` in `packages/contracts`. An answer that is not a list is no RFQs; one that is a list of something else is "The RFQs came back in a form this app does not know." | R · U · E |
| `GET …/rfqs/:id` — one RFQ whole (404 "RFQ not found") | The same, asked when **Edit** is pressed | R · U · E |
| `GET …/rfqs/new/defaults[?customer_id=]` — the starting form: a number, today's date, the standing payment terms and documents wording, eight blank lines (the first made from the lead, if one is named); `rfq.create` | The same, asked afresh each time the form opens — nothing is kept for the next one | R · U · E |
| `POST …/rfqs`, `PUT …/rfqs/:id` — the fields trimmed, lines that name no vehicle dropped, the added fields in `custom_fields`, filed under whoever made it; `DELETE …/rfqs/:id` | The same routes. The body is what the classic form sent, with the same `title`; the form sends **all** of it (see the decisions) | R · U · E |
| `POST …/rfqs/:id/xlsx` and `POST …/rfqs/xlsx` — the workbook of a saved RFQ and of the form as it stands, as base64, named for the RFQ's number (`rfq.export`) | The same two routes; the workbook is handed to the browser as `RFQ_<number>.xlsx` and a real `.xlsx` | R · U · E |
| `GET …/columns/rfq_doc` (the document's status and added fields) and `rfq_items` (the lines) | The same, through the column engine; a list that cannot be had is "nothing arranged" and the screen's own columns are used | R · U · E |
| `GET …/suppliers` and `…/supplier-vehicles` (`suppliers.view`) — the register and the catalogue the form picks from | The same; a refusal or a failure is "none" (the pickers are empty and the form still opens) | U · E |
| `GET /api/dashboard/customers` — the leads the classic form lists (the team's page asked the same administrator route) | The administrator's `…/customers`, the team's own `…/leads` | U · E |

## What the list does

| Classic | New | Held by |
|---|---|---|
| Heading "RFQ" with **New RFQ** (the admin's page head; the team's card head) and "Request for Quotation sent to a supplier. Prefills from a lead, like the quotation." | The same, in each portal's own arrangement. **New RFQ** needs `rfq.create` | P · U · E |
| A table: **ID** (set in a fixed-width face), **Supplier** ("—" where none), **Lines**, **Status**, **Date**, **Actions** | The same; on a phone each row is a card, each cell labelled | P · U · E |
| The status is a badge in the colour the administrator gave its option, under the label they gave it; an option that has since been deleted is drawn plain | The same | P · U · E |
| The date is the RFQ's own, or the day it was made | The same | U |
| **Edit**, **Excel**, **Delete** — each only for whoever has `rfq.edit`, `rfq.export`, `rfq.delete` | The same | R · U · E |
| Empty: "No RFQs yet."; failure: the server's words with "If this mentions a missing `rfqs` table, run `migrations/003_logistics_deals_docs.sql`"; unreachable: "Failed to load RFQs."; loading: a spinner and "Loading RFQs…" | The same words. The loader also shows while the list is read again after a change | P (`rfqEmpty`, `rfqError`, `rfqLoading`) · U · E |
| Delete asks "Delete RFQ <number>?" and reloads the list | The same (the browser's own dialog) | U · E |
| **Excel** builds the workbook and downloads it | The same; a failure is said in a notice ("Could not export this RFQ: …") | U · E |

## What the form does

| Classic | New | Held by |
|---|---|---|
| "New RFQ" / "RFQ <number>", in a wide sheet; **Cancel**, **Save & export Excel**, **Save** | The same | P (`rfqForm`, `rfqFormEdit`) · U · E |
| The RFQ's number (read-only once it is saved), date, issuer, status, the lead it is for | The same. The status offers the options the administrator has left, the first being a new RFQ's; an RFQ keeps a status whose option has since been deleted | P · U |
| "Lead (attach to profile)": the leads by name and phone | The same; for a team member the list is their own leads | U · E |
| "Supplier details (printed on the RFQ)": **From register** fills the name, contact, address and country from the supplier chosen (a field the supplier has nothing in is emptied); **— None —** leaves the block as it is | The same | U |
| The vehicles asked about, as a grid by the columns the administrator arranged (`rfq_items`): a number, then the shown columns in their order and under their names, a × to take a line away; **+ Add line**; **From supplier catalogue** (search, a box to tick for each vehicle, **Add selected**; "Pick at least one vehicle."; "Line added from the catalogue." / "N lines added."; "No supplier vehicles yet — add them under Suppliers → Open → Vehicles.") | The same; a line made from a vehicle of the catalogue carries its brand, model, trim, year, accessories, lead time and FOB price | P · U · E |
| Payment terms, delivery location, service provider, contact, documents required | The same fields; a new RFQ starts with the standing wording the server fills | P · U · E |
| "Additional fields": the fields the administrator added to every RFQ, as the type they gave them (text, number, date, link, dropdown, radio, tick box), a required one marked; **Columns** and **+ Field** over the lines and the extras, for the administrator alone | The same | P (`rfqFormEdit`) · U · E |
| "Add at least one vehicle line (brand, model or trim)." and "Required: <fields>" in the sheet; the server's refusal in the same place | The same words | P (`rfqFormError`) · U · E |
| **Save** keeps the RFQ and reloads the list; **Save & export Excel** keeps it, puts the sheet away and hands over the workbook of what was kept | The same; a workbook that cannot be made is said in a notice | U · E |

## Look

`tests/docparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two looks (the
original and a loud one), at 390, 670, 800 and 1100 px, in the states `rfqList`, `rfqLoading`, `rfqEmpty`, `rfqError`, `rfqForm`,
`rfqFormEdit`, `rfqFormError` (and `poList` … `poFormError`, `catalogue` and `viewer` for [purchase orders](purchaseorders.md)),
with what the server says stood in for the same on both sides, and compares the computed style of every named part — the page head,
the table's head and cells, each row's buttons, the sheet and each section of its form (the supplier block, the grid of fields, the
lines grid with its head, cells and inputs, the extras, the footer) — and the words in them. No difference is accepted: the list in
the file is empty, and a suite that finds one fails. It runs as two suites, one per portal (`docparityadmin`, `docparityteam`), so
CI can deal them out.

## Decisions and deliberate differences

- **A form keeps what it does not show.** The classic form saved what was on the page and emptied the rest: hide a column of the
  lines, edit an RFQ, and the words under it were gone; the same for an added field that is hidden from the form. The new form
  sends each line as it was with what the grid shows put over it, and merges the added fields over the ones the RFQ has.
- **A team member's leads are their own.** The classic team page asked for the administrator's list of leads and so never filled
  the picker; the new form asks the team's own route.
- **The form opens at once.** The sheet is there when the button is pressed, with a loader in it, instead of nothing happening
  until the starting form arrives; a record that cannot be had is said in the sheet, with only **Cancel** offered.
- **Saving cannot be pressed twice.** A second press while the first is on its way does nothing, so an RFQ is not made twice.
- **The loader shows whenever the list is being read**, also after a change, so a list is never shown as the current one while
  it is out of date.
- **A new RFQ for a lead has an address.** `/rfq?lead=<id>` opens the form made from that lead and cleans the address (a reload
  or a way back does not open it again). Whoever may not make an RFQ is not shown the form. The classic Leads page, still framed,
  hands the lead over: its drawer's **RFQ** button tells the app whose it is with the move, and the app opens `/rfq?lead=<id>`
  (the classic page opened its own form for it). When Leads moves, its button links there.
- **The catalogue sheet is its own layer.** Escape closes it and leaves the form under it where it was; Escape on the form closes
  the form.
- **Failures are said.** A delete the server refused, a workbook it could not make and a catalogue that has nothing in it are
  each said in a notice; the classic page said nothing of the first.
- **The workbook is named for the number** (`RFQ_<number>.xlsx`), as the classic page did and the server answers.
- **Both portals' calls are the portals' own routes**, not `/api/v1`: one handler already serves both, so nothing is unified,
  and they move under `/api/v1` when the classic portals retire.

## Not in this module (so not here)

The contract and quotation documents that use the same pieces (batch 2's next slice and the quotation, with the Leads screen);
the Leads drawer's own buttons (they move with Leads); deleting a line's extra column values from the records (the engine's
*Delete column* only hides them, as the classic one did).
