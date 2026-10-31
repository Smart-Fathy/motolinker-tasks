# Inventory & Logistics — the classic portals and the new app

**Inventory & Logistics** — two tabs on one screen. **Models** is the register of the cars the business holds: the figures over it, a
row for each car (or a lane for each status, or a card for each model with its cars inside), a form made of the model's words and
one row per physical car, and the administrator's bulk upload. **Tracking** is the boxes on the water: a card for each container
(its state, the ship and the leg it is on, the port calls, where the ship is now over a map, the arrival, the cars inside), a
look-up by number, a form to follow a box by hand, and a sheet that puts a car in a box. From the module
`apps/web/src/modules/stock` (the register, the board, the forms, the pure rules of both), `apps/web/src/columns` (the column
engine the car rows are made of), `apps/web/src/docs` (the small pieces it shares with the document screens) and
`apps/web/src/ui`. The server side is not new: both portals already shared every route (the administrator's alone are the delete of
a model or of a box and the CSV), and `packages/contracts` now holds the answers' schemas and the lists both ends agree on
(`logistics`: a box's states and sizes, the check on its number). The classic code (`public/assets/procurement.js` for Models,
`public/assets/logistics.js` for Tracking) stays where it is until the cutover.

Test files named below: **R** `tests/stockroutes.js` and `tests/containerroutes.js` (the routes of both portals — who may ask for
each, what a save keeps, cleans and refuses, the CSV, the look-up, the refresh, the registration, the cars in a box; every answer held
to its schema; the classic scripts' lists held to the contracts'), **P** `tests/stparity.js` (look, in a real browser; two suites, one
per portal), **E** `tests/webstock.js` (the real server, the built app, a real browser), **U** `apps/web/src/modules/stock/`
(`model.test.ts`, `tracking.test.ts`, `hooks.test.tsx`, `stock.test.tsx`, `tracking.test.tsx`), **M** `tests/modules.js` and
`apps/web/src/app/registry.test.ts` (Inventory is a screen of the Logistics group, beside Suppliers, behind the `stock.browse` action),
**W** `tests/webframe.js`.

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/stock` — every model, each with its cars (`units`) (`stock.browse`) | The same, asked each time the screen opens and again after every change (the list gives way to the loader while it does). A list of something else is "The stock came back in a form this app does not know." | R · U · E |
| `POST …/stock`, `PUT …/stock/:id` (`stock.create`, `stock.edit`) — the cars are rebuilt from the form's rows (the eight fixed columns and the ones the administrator added), the count is the number of cars, a status is one of the standard ones or one the administrator arranged | The same; the form sends the cars it holds and nothing it did not show is lost (below) | R · U · E |
| `DELETE …/stock/:id`, `POST …/stock/bulk`, `GET …/stock/template.csv` — the administrator's alone (404 in the team's portal) | The same; the team's page has no Delete on a card and no bulk upload | R · U · E |
| `GET …/columns/stock`, `PUT …/columns/stock` — the fields the administrator added to every car and how the columns are arranged (status options and colours included) | The same, through the column engine; the team sees the same arrangement and cannot change it | R · U · E |
| `GET …/containers[?status=&q=]` — the boxes, soonest arrival first, each with the cars linked to it (`stock.tracking`; one grant opens every container route) | The same | R · U · E |
| `GET …/containers/lookup/:no` — found among ours, or what the carrier could say of the number (never saved) | The same; the number is cleaned first and a bad one is turned away without asking | R · U · E |
| `POST …/containers/register` — ask the carrier's platform to watch a box | The same | R · U |
| `POST …/containers`, `PUT …/containers/:id`, `DELETE …/containers/:id` — a change writes only the columns it carries (and always the number); delete is the administrator's | The same | R · U · E |
| `POST …/containers/:id/refresh` — ask the carrier and the ship feed again; a hand-edited field is not overwritten | The same; the board is asked for again only when something moved | R · U · E |
| `GET …/containers/provider-status?probe=1` — "is the carrier key working?" as one call | The same (Test connection) | R · U |
| `POST …/containers/:id/units`, `DELETE …/containers/:id/units/:vin` — a car in a box by its VIN, and out | The same | R · U · E |

## What the Models tab does

| Classic | New | Held by |
|---|---|---|
| Heading "Inventory & Logistics" with **Bulk upload CSV** and **Add model** (the administrator's page); the team's page: a card title "Inventory", its hint, the search and **Add model**. **Add model** needs `stock.create`, is hidden on the Tracking tab, and the team's **Tracking** tab needs `stock.tracking` | The same, in each portal's own arrangement | P (`stList`) · U · E |
| The figures over the register: the number of cars, the composition (a bar and a legend, a segment for each status that has cars), the register's value and how many models it holds; and, where an older save counted cars nobody named, "N units are unmatched" with **Review** (which opens the first such model) | The same | P (`stList`, `stEmpty`) · U · E |
| Three views of one register, remembered across visits: **All vehicles** (a row for each car: model and trim, then the columns the administrator arranged, then Edit), **By status** (a lane for each status with its cars, value and share), **By model** (a card for each model with its cars inside, its price, its notes and Edit / Delete) | The same; on a phone each row is a card, labelled from its table's heading | P (`stList`, `stStatus`, `stModel`) · U · E |
| **Filter** (a status; a chip says which and takes it away) and **Group: Supplier** (All vehicles only; the names in order, the cars of no supplier together). The classic page keeps both for as long as the page stays open | Both start clear at each visit | P (`stFilter`) · U · E |
| Search over make, model, trim and VIN; a model with no cars stays when its words match | The same | U · E |
| Loader "Loading stock…" (the team's page begins with "Loading inventory…" until the columns are had); empty: "No vehicles in stock yet." with what to do (and "No vehicles match your search." when a search finds none); failure: "Failed to load stock." when nothing came | The same words | P (`stLoading`, `stEmpty`, `stError`) · U |
| **Edit** opens the form for a model; **Delete** (the administrator's card) asks, then deletes with the cars inside it | The same | U · E |
| The form: Make, Model, Trim, Price, a grid of cars (one row each; the columns are the administrator's, with **Columns** and **+ Field** for the administrator), **+ Add unit**, Notes; "Make and Model are required." | The same blanks in the same order; the cars grid is the column engine's | P (`stForm`, `stFormEdit`) · U · E |
| The bulk upload: the columns, a sample to download, a file box, **Upload**; "Imported N vehicle(s)" with the rows that did not go in; "Please choose a CSV file." | The same | P (`stCsv`, `stCsvPick`, `stCsvDone`) · U · E |

## What the Tracking tab does

| Classic | New | Held by |
|---|---|---|
| A number box, **Track**, **Add manually** (`stock.tracking`), **Test connection** | The same | P (`tkList`) · U · E |
| A number is four letters then seven digits; a bad one is turned away with that sentence; a good one is written back in capitals | The same | U · E |
| A number we track shows its card under the buttons; one we do not says so ("<number> is not tracked yet"), why in one sentence (no carrier set up, not watched yet, key refused, a plan limit, rate limit, …; the carrier's own words stay as a hint), warns when the check digit is not the one the others call for, and offers **Start tracking it** (with what the carrier prefilled) and, where the carrier can, **Ask <carrier> to track it** | The same | P (`tkLookup`) · U · E |
| The board: a card for each box — status pill and carrier; **Container**, **Type**, **Latest move**; a check-digit warning; the voyage (ship, IMO, the two ports and their codes, a track with the share of it done, the departure and the reported arrival), or "No voyage recorded yet — edit the container to add the vessel and its ports."; the **Port calls** (collapsed; an unconfirmed leg dimmed and marked *expected*); the ship's position (coordinates, speed, how old the fix is) over a map; the **POD ETA** with Refresh and Edit; the cars inside as chips with × and **Add vehicle** | The same | P (`tkList`, `tkMoves`) · U · E |
| The map is Leaflet, loaded from a CDN the first time a card with a fix is drawn; where it cannot be had the card says "Map unavailable offline — position …" with a link out | The same (the app loads it the same way, once) | P (`tkList`) · U |
| Loader "Loading containers…"; empty: "Nothing is being tracked yet. Enter a container number above to start."; failure: the server's words, or "Could not load containers." | The same words | P (`tkLoading`, `tkEmpty`, `tkError`) · U |
| **Track a container** / **Container <number>**: the card's fields, the vessel and its ports and times, the position (latitude, longitude, when, course, speed, MMSI), notes; only the number is required; **Delete** (the administrator's) | The same, with the dates cut to the boxes that take them | P (`tkForm`, `tkFormEdit`) · U · E |
| **Add vehicle** lists the cars in the register that have a VIN and are in no box; "No vehicles with a VIN in the Models tab yet — add one there first." / "Every vehicle with a VIN is already in a container." | The same | P (`tkLink`) · U · E |
| **Refresh** says what the carrier and the ship feed each said; **Test connection** says what the key can do, and when it is refused, which header shape the vendor does accept and the variable to set | The same | U · E |

## Look

`tests/stparity.js` compares the classic page and the new app in the Models states `stList`, `stLoading`, `stEmpty`, `stError`,
`stFilter`, `stStatus`, `stModel`, `stForm`, `stFormEdit` and (the administrator's) `stCsv`, `stCsvPick`, `stCsvDone`, and the
Tracking states `tkList`, `tkMoves` (the port calls opened), `tkLoading`, `tkEmpty`, `tkError`, `tkLookup`, `tkDiag` and
`tkDiagRefused` (Test connection when the server tried the key every way), `tkForm`, `tkFormEdit` and `tkLink`, in the way described for [RFQs](rfq.md): both portals, both colour modes, two looks, four widths, every named part
and the words in it. Two parts are left out of one state, and say why in the suite: the foot of the team's box form (below).

## Decisions and deliberate differences

- **A register that could not be read says so.** When the server answers with an error the classic page drew an empty register ("No
  vehicles in stock yet."); it said "Failed to load stock." only when nothing came at all. The new page says the server's words in both cases, and
  leaves the figures out: the classic left the figures of the last good read above its error.
- **The team's box form has no Delete.** The classic team page offered one that asked a route the team does not have, so it could
  only fail; deleting a box is the administrator's.
- **The administrator's Delete on a model's card is not red**, as in the classic page: its sheet makes every outline button the text
  colour with `!important`, which wins over the red the button asks for. (The red stays where the sheet lets it: the team's cancel
  buttons.)
- **A form keeps what it does not show.** A car's fields that no column of the form names, a model's fields the form has no box for,
  and the extra fields of a hidden column are saved as they were, with what the form shows put over them.
- **The template link keeps its token.** The sample CSV is downloaded with the administrator's own token in the address, as the
  classic link did, because a download cannot carry a header.
- **The loader says what the classic page's said**, in the order the classic page said it: the team's "Loading inventory…" until the
  columns are had, then "Loading stock…".
- **A table is a card for each row on a phone, labelled from its own heading**, including the empty label of the Edit column, as
  `mobile.js` does it; so the Edit button sits after an empty label there.
- **Both portals' calls are the portals' own routes**, not `/api/v1` (one handler already serves both).

## Not in this module (so not here)

The payments panel of the classic logistics script (`openPaymentsPanel`, reached from a sale in Deals — it moves with Deals); the
webhooks the carrier platforms post to (the server's, with no screen); the supplier's pages that list a supplier's stock (they
moved with [Suppliers](suppliers.md)).
