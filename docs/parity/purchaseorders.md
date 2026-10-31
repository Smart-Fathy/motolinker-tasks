# Purchase orders — the classic portals and the new app

**Purchase orders** — the order sheet sent to a supplier: a list of them (number, supplier, how many vehicle lines, what they come
to, status, date), a form in a wide sheet (the order's number, date, currency and status, the lines — each vehicle with its client,
consignee, units, spec, PI price, tracking status and VIN — the supplier block, the delivery terms, the fields the administrator
added to every order), and each order as a PDF in a viewer. From the module `apps/web/src/modules/purchaseorders` (the list, the
form), `apps/web/src/docs` (what it shares with [RFQs](rfq.md): the answers' checks, the data, the page, the lines grid, the
supplier-catalogue picker, and the **viewer** that is the PDF's), `apps/web/src/columns` and `apps/web/src/ui`. The server side is
not new: `mountPurchaseOrderRoutes` already served both portals with one handler. The classic code
(`public/assets/procurement.js`) stays where it is until the cutover.

Test files named below: **R** `tests/rfqpo.js` (the routes — who may ask for each, what a save keeps and refuses, the starting
form, the PDF; every answer held to its schema), **P** `tests/docparity.js` (look, in a real browser; two suites, one per portal),
**E** `tests/webdocs.js` (the real server, the built app, a real browser, real PDFs), **U** `apps/web/src/docs/` and
`apps/web/src/modules/purchaseorders/purchaseorders.test.tsx`, **M** `tests/modules.js` and `apps/web/src/app/registry.test.ts`
(Purchase orders is a screen of the Tools group, behind the `purchaseorders` section), **W** `tests/webframe.js`, **B**
`tests/embed.js`, `legacy/bridge.test.ts` and `LegacyFrame.test.tsx` (the lead handed over from the framed Leads page).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/purchase-orders` — the list, newest first (`purchaseorders.view`) | The same; `PoList`. Not a list is no orders; a list of something else is "The purchase orders came back in a form this app does not know." | R · U · E |
| `GET …/purchase-orders/:id` (404 "Purchase order not found") | The same, for **Edit** and for **PDF** on a row | R · U · E |
| `GET …/purchase-orders/new/defaults[?customer_id=]` — a number, today's date, USD and one line (made from the lead's name, car, colour and year when one is named); `purchaseorders.create` | The same, asked afresh each time the form opens | R · U · E |
| `POST …/purchase-orders`, `PUT …/:id`, `DELETE …/:id` — the lines normalised (units at least one, a price read out of what was typed, a status that is a built-in or one the administrator added, anything else `send_to_supplier`), lines naming no client, brand, model or VIN dropped, filed under whoever made it | The same routes; the body is what the classic form sent, with the same `title`; the form sends **all** of it | R · U · E |
| `POST …/purchase-orders/pdf` (the form as it stands, or a saved order read first — what the page's **PDF** button does) and `POST …/purchase-orders/:id/pdf` (a saved order by itself — what the lead profile's attached documents use) — the order as base64 PDF (`purchaseorders.export`) | The first route, for both the form and a saved order (the record is read, then rendered). The second stays with the lead profile, which has not moved | R · U · E |
| `GET …/columns/po_doc` and `po_items` | The same, through the column engine | R · U · E |
| `GET …/suppliers`, `…/supplier-vehicles` (`suppliers.view`), `…/customers` / `…/leads` | As for [RFQs](rfq.md) | U · E |

## What the list does

| Classic | New | Held by |
|---|---|---|
| Heading "Purchase Orders" with **New purchase order** and "Order sheet sent to suppliers. Each PO holds one or more vehicle lines with their own client, spec, PI price and tracking status." | The same. **New purchase order** needs `purchaseorders.create` | P · U · E |
| A table: **PO #** (fixed-width face), **Supplier**, **Lines**, **Total** (the order's currency and what the lines come to, units times price), **Status** (a badge in the administrator's colour), **Date**, **Actions** | The same; on a phone each row is a card | P · U · E |
| **Edit**, **PDF**, **Delete** — each only for whoever has `purchaseorders.edit`, `.export`, `.delete` | The same | R · U · E |
| Empty: "No purchase orders yet. Click “New purchase order” to create one."; failure: the server's words and "If this mentions a missing `purchase_orders` table, run `migrations/002_purchase_orders.sql`"; unreachable: "Failed to load purchase orders."; loading: "Loading purchase orders…" | The same words | P (`poEmpty`, `poError`, `poLoading`) · U · E |
| Delete asks "Delete purchase order <number>?" | The same | U · E |

## What the form does

| Classic | New | Held by |
|---|---|---|
| "New purchase order" / "Purchase order <number>"; **Cancel**, **Save & preview PDF**, **Save** | The same | P (`poForm`, `poFormEdit`) · U · E |
| PO number (read-only once saved), date, supplier name, currency (USD), status, the lead it is for | The same; the status offers the document's options and keeps one that has since been deleted | P · U · E |
| **Vehicle lines**: a grid by the columns the administrator arranged (`po_items`) — client, consignee, units, brand, model, trim, colour, year, accessories, payment term, PI price, status (a dropdown), VIN, client file link — **+ Add vehicle line**, **From supplier catalogue**, a line taken away with ×; "N line(s) · Total USD 60,000" under it, following what is typed | The same. A line that has no status begins as the first of the options it has been given (the built-in *SEND TO SUPPLIER* until the administrator changes them); a line made from a vehicle of the catalogue is one unit at the supplier's FOB price | P · U · E |
| "Supplier details (printed on the PO)": **From register**, contact, address, country of origin, issuer, quote / RFQ ID | The same | P · U · E |
| Payment terms, incoterm (FOB), delivery location, service provider, contact, documents required, notes | The same | P · U · E |
| "Additional fields" and the controls over the columns, for the administrator alone | The same | P · U · E |
| "Add at least one vehicle line (client, brand or model)." and "Required: <fields>"; the server's refusal in the sheet | The same words | P (`poFormError`) · U · E |
| **Save & preview PDF** keeps the order, puts the sheet away and shows the PDF of what was kept | The same | U · E |

## What the viewer does

| Classic (`#doc-modal`) | New (`apps/web/src/docs/Viewer.tsx`) | Held by |
|---|---|---|
| A large card over a dimmed page: the title ("Purchase order <number>"), **Download** and **Close**, and the PDF in a frame; it opens at once with "Rendering PDF…" | The same | P (`viewer`) · U · E |
| A document that could not be made says "Could not render this document: <why>" in the same place | The same, also when the record itself could not be read | U · E |
| **Download** saves the PDF under the document's name (`Purchase_order_<number>.pdf`) | The same | U · E |
| **Close** gives the PDF back | The same, also on Escape and when the page goes away; opening another gives back the one before | U · E |

## Look

`tests/docparity.js` compares the classic page and the new app in the states `poList`, `poLoading`, `poEmpty`, `poError`, `poForm`,
`poFormEdit`, `poFormError`, `catalogue` (the supplier-catalogue sheet over a form) and `viewer`, in the way described for
[RFQs](rfq.md): both portals, both colour modes, two looks, four widths, every named part and the words in it, no accepted
difference.

## Decisions and deliberate differences

- All of [RFQs](rfq.md)'s: **a form keeps what it does not show**, **a team member's leads are their own**, **the form opens at
  once**, **saving cannot be pressed twice**, **the loader shows whenever the list is being read**, **a lead has an address**
  (`/purchaseorders?lead=<id>`, and the framed Leads drawer's **Purchase Order** button hands the lead over), **the catalogue
  sheet is its own layer**.
- **The viewer is one component for every document.** The PDF of an order is opened at once, filled when it is made, and a failure
  — also the failure to read a saved order — is said in it. The classic page read the record without a guard, so an order that
  could not be read was "rendered" from an error and failed in words about something else.
- **The PDF is given back.** The classic viewer kept the last PDF's address for the next; the new one gives it back when the viewer
  closes, when another is opened and when the screen goes away.
- **A line's status begins as the first option the administrator left.** The classic grid began new lines as the built-in first
  status whatever had been configured.
- **Both portals' calls are the portals' own routes**, not `/api/v1` (one handler already serves both).

## Not in this module (so not here)

The contract document and its PDF (the next slice of batch 2); the Leads drawer's own buttons (they move with Leads); the
supplier-side screens (done: [Suppliers](suppliers.md)).
