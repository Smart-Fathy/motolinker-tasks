# Suppliers and the column editor — the classic portals and the new app

**Suppliers** — the register behind the supplier pickers of the RFQ, purchase-order and stock screens: who is bought from, as cards
with each supplier's figures or as the table the administrator arranges; the form that adds and edits a supplier; and, behind a card
or a row, a supplier's pages — what they offer (the catalogue the RFQ and purchase-order lines pick from), their paperwork, and what
was bought from them. With it the **column editor** that every register-style table will share (Leads, Stock, the RFQ and
purchase-order forms, …): the menu behind a header, the *Columns* list, and the dialogs that add a field or change its type, options
and colours. From the modules `apps/web/src/modules/suppliers` (the answers' checks and small words, the data, the register, the form,
a supplier's pages) and `apps/web/src/columns` (the engine: how a saved list is read against a screen's own columns and what
renaming, moving, hiding and deleting do to it, its data, menu, dialogs, inputs and badges), `apps/web/src/ui` (`Sheet`, `Form`,
`BrandSelect`, `Btn`). The server side is not new: `mountSupplierRoutes` and `mountSupplierCatalogueRoutes` already served both portals
with one handler and `src/routes/columns.js` holds the column configuration for both, so the app calls them as they are. The classic
code (`public/assets/procurement.js`, `public/assets/columns.js`) stays where it is until the cutover.

Test files named below: **S** `tests/suppliers.js` (the routes of both portals — who may ask for each, what is kept, what is refused,
what a configuration is cleaned to — each answer held to its schema), **P** `tests/supparity.js` (look, value by value, in a real
browser; two suites, one per portal), **E** `tests/websuppliers.js` (the real server, the built app, a real browser, Google Drive stood
in for), **U** `apps/web/src/modules/suppliers/` (`model.test.ts`, `suppliers.test.tsx`) and `apps/web/src/columns/` (`model.test.ts`,
`columns.test.tsx`), **M** `tests/modules.js` and `apps/web/src/app/registry.test.ts` (the catalogue: Suppliers is a screen of the
Logistics group, behind the `suppliers` section), **W** `tests/webframe.js` (Suppliers is no longer framed), **C** `tests/colengine.js`
(the classic engine itself, unchanged, and the one the new engine's rules are run against).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/suppliers` — the register, by name; the admin's and the team's alike. `suppliers.view` for the team (403 without it) | The same route; its shape is `SupplierList` in `packages/contracts`. An answer that is not a list is no suppliers; one that is a list of something else is "came back in a form this app does not know." | S (employee, admin; the other portal's token is 401; a database that does not answer is a 500 with its words — never an empty register) · U · E |
| `POST …/suppliers` and `PUT …/suppliers/:id` — the five fields trimmed, the added fields in `custom_fields`, a name required (400) and one of spaces is none; filed under whoever made it | The same; the body is `SupplierBody`, and the form sends **all** of it (the fields it does not show keep what the supplier has — see below) | S · U · E |
| `DELETE …/suppliers/:id` | The same | S · U · E |
| `GET …/supplier-vehicles` and `GET …/stock` — what the cards' *Catalogue*, *Units* and *Value* are made of; they belong to other sections (a 403 is a dash on the card, not a zero) | The same two routes, asked beside the register; a refusal or a failure is "no figure" for that figure, and the cards and the count line say so | S · U ("the figures") · E · P (`cardsBare`) |
| `GET/POST …/suppliers/:id/vehicles`, `PUT/DELETE …/vehicles/:vid` — the catalogue; readable with the register (`suppliers.view`), edited with `suppliers.catalogue`; brand or model required; a price is read out of what was typed; the row is saved whole; only through its own supplier | The same routes. A cell saved sends the whole row: what the grid does not show (currency, notes, a hidden column, a deleted field's value) is sent back as it was | S · U · E |
| `GET/POST …/suppliers/:id/docs` — the documents, newest first (`suppliers.docs`); an upload is multipart, kept in Google Drive under *MotoLinker / Suppliers*, 25 MB at most (413 says so), 409 where Google is not set up, 400 with no file | The same routes (`DELETE …/docs/:id` exists on the server and is drawn by neither page) | S · E ("a file is stored, and shown with its size") · U |
| `GET …/suppliers/:id/purchases` — the cars held against stock (by id, or by name where the id is missing), the lines ordered, the figures over both (`suppliers.purchases`) | The same | S · U · E |
| `GET …/columns/:entity` (`suppliers`, `supplier_vehicles`) — what the administrator arranged, or `null` where nothing was ever saved; cleaned on the way out as well as in; `suppliers.view` for the team | The same route; `ColumnsResponse` in the contract. A list that cannot be had is "nothing arranged" and the screen's own columns stand, as they always did | S · U · E |
| `PUT …/columns/:entity` — the whole list, administrator only (the team gets 403 whatever it is granted); an unknown type is text, a key with a quote is dropped, a repeated key is kept once, an option's colour is `#rrggbb` or nothing, a width outside 40–800 is none, at most 60 columns | The same: one PUT of the whole list after every change (what the classic engine did). A refusal or a failure is said ("Could not save the columns. The list shown is the one on the server.") and the list is asked for again | S · U · E |

## What the register does

| Classic | New | Held by |
|---|---|---|
| Heading "Suppliers" with **Add supplier** (the admin's page head; the team's card head) and "Suppliers you order from. Used by RFQs, purchase orders and stock units." | The same, in each portal's own arrangement. **Add supplier** needs `suppliers.create` | P · U · E |
| Cards by default, the table one tab away; the choice is remembered (`ml_sup_view`) | The same, in the same key — a classic page and the new app agree on which view the register was left in | U ("the view it remembers") · E |
| The line above: "N suppliers", and, where the person may know them, "· N units in the register · N catalogue vehicles" | The same words | U · P |
| A card: the initials, the name, "country · contact", the edit and delete buttons (each only for whoever may), **Units**, **Value** (as `EGP 1.5M`) and **Catalogue**, and the buttons *Vehicles*, *Documents* and *Purchases* (the last two only for whoever may) that open the supplier's page at that tab | The same | P (`cards`) · U · E |
| Figures: units and their value are the stock units that name this supplier (by name, case-folded), the catalogue count is by supplier id | The same | U (`statsOf`, `cardFigures`) · E |
| The table: the columns the administrator arranged, in their order and under their names — text, number, date, link, dropdown and radio (a coloured badge), a tick box, plain added fields — then **Actions**: *Open*, *Edit*, *Delete* (each only for whoever may) | The same | P (`table`) · U · E |
| Empty: "No suppliers yet." — with the field controls still offered (a register's columns are worth setting up before the first supplier); loading: a spinner and "Loading suppliers…"; failure: the server's words with the migration hint | The same | P (`empty`, `loading`, `error`) · U |
| Delete asks "Delete supplier <name>?" | The same (the browser's own dialog) | U · E |
| Every change reloads the register behind the loader | The same | U |

## What the form does

| Classic | New | Held by |
|---|---|---|
| "Add supplier" / "Edit supplier": the register's own columns as fields, in the order and under the names the administrator gave them and as the type they chose (a country can be a dropdown, a date picker, a number), then the fields they added | The same, in a sheet | P (`form`, `formEdit`) · U · E |
| "Supplier name is required." and "Required: <fields>" (a field marked required) in the sheet; the server's refusal in the same place; **Cancel** and **Save** | The same | P (`formError`) · U · E |
| A dropdown starts on what the supplier has — if that is still one of its options | The same | U |

## What a supplier's pages do

| Classic | New | Held by |
|---|---|---|
| A wide sheet titled with the supplier's name; tabs *Vehicles*, *Documents*, *Purchases* — a tab the person has no grant for is not there | The same | P · U · E |
| **Vehicles**: the catalogue as a grid the administrator arranges (the `supplier_vehicles` columns), with **Columns** and **+ Field** over it for the administrator and **Add vehicle** for whoever has `suppliers.catalogue`; a cell is saved when it is left; a row is removed after "Remove this vehicle from the supplier list?"; "Nothing listed yet. Add what this supplier offers so RFQs and purchase orders can pick from it." | The same; for a person with `suppliers.view` only, the same grid with no controls | P (`vehicles`, `vehiclesNone`) · U · E |
| **Documents**: **Upload document** and "Stored in Google Drive, under MotoLinker / Suppliers.", each file as a card with its size, opened from its link; "No documents yet."; "Uploading…" and a refusal in words | The same | P (`docs`, `docsNone`) · U · E |
| **Purchases**: four tiles (*Cars received*, *Ordered on POs*, *Avg price paid*, *Avg PO price*), the lead times seen, the cars received and the PO lines as tables, and what to do when there are none | The same | P (`purchases`, `purchasesNone`) · U · E |

## What the column editor does

| Classic (`public/assets/columns.js`) | New (`apps/web/src/columns`) | Held by |
|---|---|---|
| A table's saved columns are read against the screen's own: never saved or empty is the screen's columns; otherwise the saved ones (a builtin the screen no longer has is dropped, an added field is kept), then any builtin the screen gained since, at the end; a dropdown always has its options and an option saved before colours existed has its builtin's | The same rules, as plain functions (`mergeColumns` and the others in `model.ts`), **run against the classic engine itself on the same lists** | U (`model.test.ts`: 104 checks, many of them differential) · C |
| A header's chevron opens the menu: *Edit field…*, *Rename*, *Change type*, *Edit options* (for a dropdown), *Move left/right* (disabled at the ends), *Hide column*, *Delete column* — placed at the pointer and kept on the screen; the **Columns** button opens the list (an eye to show or hide each column, a pencil to edit it, *Add field*) | The same, for the administrator only; the team sees plain headers | P (`menu`, `picker`) · U · E |
| *Rename* and *Delete column* use the browser's own prompt and confirm ("Delete column "X"? Saved values stay on the records but won't be shown.") | The same | U · E |
| The dialogs — *Add Column*, *Edit Field — X*, *Change Type — X*, *Edit Options — X* — in their own layer above whatever is open (a sheet being filled in, a supplier's catalogue), closing back to it; type chips, one row per option with a colour, "The color paints the value's badge in tables and cards." | The same | P (`addField`, `editField`, `typeDialog`, `optionsDialog`) · U · E |
| A dropdown's options written one per line or as rows: blank lines are nothing; an option whose label was already one keeps its key and colour (renaming never orphans the values stored under it); a new one gets a key made of its label, numbered where two would be alike | The same | U |
| The inputs a form and a grid draw for each type; a coloured badge for a dropdown value; a link made safe (a bare domain gets `https://`; a scheme other than `http` or `https` is never made clickable) | The same | U |

## Look

`tests/supparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two looks (the
original and a loud one), at 390, 670, 800 and 1100 px, in the states `cards`, `cardsBare`, `table`, `loading`, `empty`, `error`,
`form`, `formEdit`, `formError`, `vehicles`, `vehiclesNone`, `docs`, `docsNone`, `purchases`, `purchasesNone` and, for the
administrator, `menu`, `picker`, `addField`, `editField`, `typeDialog` and `optionsDialog`, with what the server says stood in for the
same on both sides, and compares the computed style of every named part — the page head, the count, the view tabs, the controls over
the table, each card and its avatar, name, figures and buttons, the table's head and cells, the sheet and its form, the grid, the
tiles, the files, the editor's menu, list and dialogs — and the words in them. No difference is accepted: the list in the file is
empty, and a suite that finds one fails. It runs as two suites, one per portal (`supparityadmin`, `supparityteam`), so CI can deal
them out.

## Decisions and deliberate differences

- **A form keeps what it does not show.** The classic form saved the five fields from the inputs on the page and emptied the ones
  whose column was hidden: hide *Notes* from the register, edit a supplier, and its notes were gone. The new form sends the supplier's
  own value for a field that is not on the form, and keeps the added fields' values that are not on it either (`custom_fields` is
  merged over what the supplier has).
- **A catalogue cell saves the whole row.** The classic grid sent only the cells on the page, so the server's "replace the row" emptied
  the currency, the notes and any column that was hidden. The new grid sends every field the vehicle has, with the cell's change
  applied, and the next cell saved is saved on top of the first.
- **Failures are said.** A supplier the server refused to delete, a vehicle it refused to remove, and a change to the columns it did
  not keep (the list shown is put back to the server's) are each said in a notice; the classic page said nothing of those three. A
  vehicle row it refused to add or to save is said as it always was ("Could not add that row.", "Could not save that change.").
  Nothing is shown as done that was not.
- **The same file can be uploaded twice.** The classic file box kept its last choice, so choosing the same file again did nothing; the
  new one is emptied after each choice.
- **The editor's dialogs keep Tab among themselves, and the editor's menu closes on Escape.** The classic dialogs closed on Escape
  (the layer only, never the sheet beneath) but let Tab wander into the page behind them, and the classic menu had no keyboard
  handling. The header's chevron answers Enter and Space for the keyboard as well.
- **The register's own loader and failure.** The cards and the table are not drawn until the register, the two other lists the cards
  are made of, and the saved columns have each been answered, so there is no flash of unarranged columns; an answer that is a list of
  something else is said, not drawn.
- **Both portals' calls are the portals' own routes** (`/api/dashboard/…`, `/api/employee/…`), not `/api/v1`: one handler already
  serves both, so nothing is unified, and they move under `/api/v1` when the classic portals retire.
- **One engine, shared.** Leads, Stock and the RFQ and purchase-order forms still draw their columns with the classic engine; each
  moves onto `apps/web/src/columns` with its own screen. The engine's rules are held to the classic engine's, so a screen that moves
  does not change what a saved configuration means.

## Not in this module (so not here)

The RFQ, purchase-order, contract, stock and logistics screens that pick a supplier (the rest of batch 2: the register's
`useSupplierList` is ready for them) and the supplier pickers themselves; deleting a supplier's document (the server has the route,
neither page has the button); dragging a header onto another to move it (only the Leads table has it: the engine's `reorder` rule is
ready, and held to the classic one, for when Leads moves); the column editor on Leads, Stock and the document forms (the screens
that move with it).
