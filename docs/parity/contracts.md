# Contracts — the classic portals and the new app

**Contracts** — the Arabic car-sale (import) contract: a list of them (number, title, status, date), a form in a sheet made of the
blanks of the paper contract (its date, the first party and its representative, the buyer, the vehicle, the money and the payment
lines, the fields the administrator added to every contract), and each contract as a PDF. From the module
`apps/web/src/modules/contracts` (the list, the form, the pure rules of the blanks), `apps/web/src/docs` (what it shares with
[RFQs](rfq.md) and [purchase orders](purchaseorders.md): the answers' checks, the data, the page, the **viewer** that is the PDF's),
`apps/web/src/columns` and `apps/web/src/ui`. The server side is not new: `mountContractRoutes` already served both portals with one
handler. The classic code (`public/assets/procurement.js`) stays where it is until the cutover.

Test files named below: **R** `tests/contractdocs.js` (the routes — who may ask for each, what a save keeps and refuses, the starting
form, the PDF, the contract a won deal drafts for itself; every answer held to its schema, and every blank the form offers held to
what the contract prints), **P** `tests/ctparity.js` (look, in a real browser; two suites, one per portal), **E**
`tests/webcontracts.js` (the real server, the built app, a real browser, real PDFs), **U** `apps/web/src/modules/contracts/`
(`model.test.ts`, `contracts.test.tsx`) and `apps/web/src/docs/`, **M** `tests/modules.js` and `apps/web/src/app/registry.test.ts`
(Contracts is a screen of the Tools group, behind the `contracts` section), **W** `tests/webframe.js`, **B** `tests/embed.js`,
`legacy/bridge.test.ts` and `LegacyFrame.test.tsx` (the lead handed over from the framed Leads page).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/contracts` — the list, newest first, a row without the contract itself (`contracts.view`) | The same; `ContractList`. Not a list is no contracts; a list of something else is "The contracts came back in a form this app does not know." | R · U · E |
| `GET …/contracts/:id` (404 "Contract not found") | The same, for **Edit** and for **PDF** on a row | R · U · E |
| `GET …/contracts/new/defaults[?customer_id=]` — a number, the car-sale template carrying that number, today's date, the company's standing details from the settings, one payment line with the standing wording; made from the lead's name, ID, address and car when one is named (`contracts.create`) | The same, asked afresh each time the form opens | R · U · E |
| `POST …/contracts`, `PUT …/:id`, `DELETE …/:id` — the number kept trimmed (or made), the title trimmed, a status that is one of the three (anything else is a draft), a car-sale contract carrying its own number inside its data, whole-number ids, filed under whoever made it, a note on the lead's timeline; an edit replaces what is sent, stamps the time and never changes the number | The same routes; the body is what the classic form sent — `contract_no`, `title`, `data`, `status`, `customer_id`; the form sends **all** of it | R · U · E |
| `POST …/contracts/pdf` (the contract as the form holds it, or a saved one read first — what the page's **PDF** button does) and `POST …/contracts/:id/pdf` (a saved contract by itself — what the lead profile's attached documents use) — the contract as base64 PDF (`contracts.export`) | The first route, for both the form and a saved contract. The second stays with the lead profile, which has not moved | R · U · E |
| `GET …/columns/contracts` — the status and the fields added to every contract | The same, through the column engine | R · U · E |
| `GET /api/dashboard/customers` — the leads the classic form lists (the team's page asked the same route under its own prefix, which the team does not have) | The administrator's `…/customers`, the team's own `…/leads` | U · E |
| A deal moved to **Won** has a contract drafted for it (`created_by` `auto_won`, once) | Nothing to change on the server; the list shows such a contract with an **auto** mark | R · E |

## What the list does

| Classic | New | Held by |
|---|---|---|
| Heading "Contracts" with **New contract** and "Arabic vehicle import contract (…). A draft is created automatically whenever a deal moves to **Won**." (the team's page: the same without the Arabic title of the contract) | The same, in each portal's own arrangement. **New contract** needs `contracts.create` | P · U · E |
| A table: **Contract #** (fixed-width face), **Title** (a dash where there is none, and the **auto** mark on one a deal drafted), **Status** (a badge in the administrator's colour), **Created** (a date; none where the row has none), **Actions** | The same; on a phone each row is a card | P (`ctList`) · U · E |
| **Edit**, **PDF**, **Delete** — each only for whoever has `contracts.edit`, `.export`, `.delete` | The same | R · U · E |
| Empty: "No contracts yet. Click “New contract”, or move a deal to **Won** to have one drafted automatically."; failure: the server's words and "If this mentions a missing `contracts` table, run `migrations/001_stock_specs_colors_contracts.sql`"; unreachable: "Failed to load contracts."; loading: "Loading contracts…" | The same words | P (`ctEmpty`, `ctError`, `ctLoading`) · U · E |
| Delete asks "Delete contract <number>?" | The same | U · E |

## What the form does

| Classic | New | Held by |
|---|---|---|
| "New contract" / "Contract <number>"; **Cancel**, **Save & preview PDF**, **Save** | The same | P (`ctForm`, `ctFormEdit`) · U · E |
| Five blocks in the order of the paper form, each a label over a grid of text boxes with their captions: the contract's date (day, DD, MM, YYYY), the first party (the company, then its representative), the second party (the buyer), the vehicle, the financials | The same blocks, captions and boxes, in the same grids; a box is the contract's value at its path (`buyer.name`), as words, and what is typed is kept trimmed | P · U · E |
| A contract written before the car-sale wording (no template) is offered the fields that wording had besides — the import country in the vehicle's grid, the late fee, its words and the delivery deadline in the financials' — and its payment lines as they are, only their amounts to change | The same; the fields join the grid they belong to | P (`ctFormOlder`) · U · E |
| The car-sale contract's **payment lines**: "Payment lines · “مبلغ قدره … يتم سداده …” — printed one by one in البند الثالث", an amount and a "when" for each (a new line begins with the standing wording, which is also the placeholder), × to take one away, **+ Add payment line**; a line keeps the label it came with | The same; the contract is saved with exactly the lines on screen, and its own number inside it | P · U · E |
| **Lead (attach to profile)**: the leads by name with their phone; picking one fills the buyer's name (always), ID and address and the car they asked about, split into make and model, where those are still empty | The same, in a dropdown that follows the app | U · E |
| **Status**, from the options the administrator arranged | The same; a status whose option has since gone is kept, not changed | P (`ctFormLead`) · U · E |
| "Additional fields" and the controls over the columns, for the administrator alone | The same | P · U · E |
| "Buyer name is required." and "Required: <fields>"; the server's refusal in the sheet | The same words, in the same order | P (`ctFormError`) · U · E |
| **Save & preview PDF** keeps the contract, puts the sheet away and shows the PDF of what was kept | The same | U · E |
| The title of a saved contract is "عقد — " and the buyer's name | The same | U · E |

## What the viewer does

| Classic | New (`apps/web/src/docs/Viewer.tsx`) | Held by |
|---|---|---|
| The administrator's **Contract Preview** (`#ct-modal`): a card over a dimmed page with a contract icon, **Download PDF** and **Close**, and the PDF in a frame under them | The same (the viewer's `contract` variant) | P (`ctViewer`) · U · E |
| The team's page has a **PDF** button too, but it looks for the administrator's `#ct-modal`, which the team's page does not have: the button does nothing at all | The team's PDF opens in the document viewer that every other document has in the team portal — titled "Contract <number>", **Download**, **Close** | U · E |
| The frame is blank while the PDF is made; a contract that could not be made is an `alert()` ("Could not render the contract: …") and the preview closes | It opens at once with "Rendering PDF…", and a contract that could not be made says "Could not render this document: <why>" in the same place — also when the record itself could not be read | U · E |
| **Download PDF** saves the PDF under `Contract_<number>.pdf` (`Contract_motolinkers.pdf` where there is no number) | The same | U · E |
| **Close** hides the preview; the PDF's address is kept for the next | **Close**, also Escape and the screen going away, **gives the PDF back**; opening another gives back the one before | U · E |

## Look

`tests/ctparity.js` compares the classic page and the new app in the states `ctList`, `ctLoading`, `ctEmpty`, `ctError`, `ctForm`
(and the same refused: `ctFormError`), `ctFormEdit`, `ctFormLead` (the administrator's page: the classic team page cannot list leads,
see below), `ctFormOlder` and `ctViewer` (the administrator's preview), in the way described for [RFQs](rfq.md): both portals, both
colour modes, two looks, four widths, every named part and the words in it, no accepted difference.

## Decisions and deliberate differences

- All of [RFQs](rfq.md)'s: **a form keeps what it does not show** (a field of the contract no row of the form names, an added field
  whose column is hidden, the payment lines' labels), **a team member's leads are their own**, **the form opens at once**, **saving
  cannot be pressed twice**, **the loader shows whenever the list is being read**, **a lead has an address**
  (`/contracts?lead=<id>`, and the framed Leads drawer's **Contract** button hands the lead over).
- **The team can see a contract's PDF.** The classic team page could not (above). The new team page uses the portal's document
  viewer, held to the classic one by `tests/docparity.js`.
- **The team's lead list is not empty.** The classic team page asked a route the team does not have for it, so the picker offered
  "— No lead —" and nothing else; the new one lists the member's own leads (`…/leads`), as for RFQs and purchase orders.
- **The preview says why a contract could not be made**, in place, instead of an `alert()` and a closed window; it opens at once.
- **The PDF is given back** when the viewer closes, when another is opened and when the screen goes away.
- **The download is named for the contract being shown.** The classic preview named it after the last form that had been opened, so
  a contract previewed from the list after another had been edited downloaded under the other's number.
- **The extra fields keep what is hidden.** The classic form saved the contract's extra fields as only the ones it showed; a field
  whose column the administrator has hidden lost its value. The new form puts its fields over what the contract had.
- **The older wording's fields are part of the grid they belong to**, as the classic editor drew them, not a row of their own.
- **Both portals' calls are the portals' own routes**, not `/api/v1` (one handler already serves both).

## Not in this module (so not here)

The lead profile's attached documents (they move with Leads); the quotation's own documents; stock and logistics (the next slice of
batch 2).
