# The assistant — the classic portals and the new app

**The assistant** — the *Ask AI* button in the top bar, the panel it opens, and the card at the top of a section's page, in both portals, over
one idea: a model that reads the section a person is on (only what they are allowed to see), answers questions about it, and may *propose*
things to do that the person confirms with a button. From the module `apps/web/src/assistant` (one provider, mounted by the Shell, so the
conversation stays where it is as the person goes from screen to screen). The server side is not new and **did not change in this run**: one
factory (`mountAssistant`, `src/routes/assistant.js`) writes the routes for each portal, and `packages/contracts` now holds the schemas of
their answers (`AiSections`, `AiStatus`, `AiInsights`, `AiChat`, `AiActionDone`). The classic code (`public/assets/assistant.js`, shared by
both portals) stays where it is until the cutover; **in a frame it now only reads** (see "A classic page in the app's frame" below).

Test files named below: **R** `tests/assistroutes.js` (the routes of both portals — who may ask for what, which sections a person is offered
and whether they are offered actions in them, what the model is told, what comes back when it answers, is busy, fails or is not there at
all, that a proposal is nothing until it is confirmed and is checked again when it is; every answer held to its schema; the model stood in
for at the provider, so the lookups it asks for are really made), **P** `tests/aiparity.js` (look, in a real browser; two suites, one per
portal), **E** `tests/webassist.js` (the real server, the built app, a real browser, a scripted model), **U** `apps/web/src/assistant/`
(`model.test.ts`, `histories.test.ts`, `screen.test.ts`, `assistant.test.tsx`), **F** `apps/web/src/legacy/` (`bridge.test.ts`,
`LegacyFrame.test.tsx`), **B** `tests/embed.js` (what the classic page says and does in a frame), **S** the record tests of the screens that
have records (`suppliers`, `issues`, `rfq`, `purchaseorders`, `contracts`, `stock`, `tracking`, `meet`), **W** `tests/webframe.js`.

## What the server is asked

| Classic | New | Held by |
|---|---|---|
| `GET …/ai/sections` — the sections this person may ask about (each with its label, a few things to ask in English and Arabic, and the actions the model may propose there), whether they may be proposed things to do (`assistant.act`), and which section a page borrows. A call that fails leaves Home alone | The same; Home alone where it cannot be had, and **no call at all** for a person without `assistant.chat` | R · U · E |
| `GET …/ai/status` — no model set up, or the state the last real call left it in (no call is spent to say it). Asked each time the panel is opened and each time the page changes while it is | The same | R · U · P (`status*`) · E |
| `POST …/ai/insights` `{ page, lang?, refresh }` — the card: highlights, risks, suggestions and (Leads) who to call first; cached for ten minutes unless `refresh`. The Accounting page carries its own | The same; the card is never asked for while it is put away, and never for Accounting | R · U · E |
| `POST …/ai/chat` `{ section, page, message, history, lang?, screen }` — the answer, the lookups the model made on the way, and the actions it proposes; `screen` is what is on the screen (the open record, the tab, the search, the filters, the rows ticked) | The same; the history is the conversation so far **without the question** (see below) | R · U · E |
| `POST …/ai/actions/run` `{ action }` — carries out a proposal the person confirmed, checking it again as if they had done it by hand | The same | R · U · E |

## What the screens do

| Classic | New | Held by |
|---|---|---|
| An **Ask AI** pill in the top bar, before Help, with the key that opens the panel (⌘K / Ctrl K) beside it; only for those who may ask. Opening the page with the pill: a gradient ring, the brain, the word, the key | The same; on a phone the pill is the brain alone, a round 44px target | P (`pill`, `pillOpen`) · U · E |
| The panel: a head (the brain, "Assistant · *Section*", how the model is doing, a language box, **New conversation**, **×**), a line for what is being looked at, the conversation, a box to write in and a round **Send**. Docked beside the page on a desktop (≥ 1024px: the page gives it its room), slides over the page on a tablet, rises as a sheet on a phone; a grip on its edge resizes it (340–760px, kept) | The same; the panel is its own file, fetched the first time it is wanted | P (`welcome`, `panelAway`) · U · E |
| How the model is doing, in the head: connected (and which model), busy ("out of capacity"), a key that fails (and why), no model set up (and what to set), or just ready | The same words and colours | P (`status*`) · U |
| The welcome: what the assistant reads, what it can do ("I can also propose things…" where the section allows actions), and a few things to ask as chips. **The chips go when the first question is asked; the welcome stays above it** until the panel is opened again | The same | P (`welcome`, `typing`) · U |
| A question: Enter sends, Shift+Enter breaks the line; the question is shown, "…" stands for the answer until it comes, and the box and **Send** are held meanwhile | The same; nothing is sent while a word is being composed | P (`typing`) · U · E |
| An answer: set from the right when it is in Arabic, the model's name under it, and — when the model looked something up — "Worked out with *n* lookups" to open (what it asked, and what it got; a sum is shown as a sum) | The same | P (`answer`, `answerOpen`, `answerAr`) · U · E |
| An answer that could not come: the model is busy ("…busy right now"), the key fails ("I could not answer just now: …"), no model is set up, or the call did not go ("Network error: …") | The same words | P (`answerError`) · U · E |
| A proposal comes under the answer as a card ("Proposed · *what*", what would be done, **Confirm**, **Dismiss**). **Nothing is done until it is confirmed** | The same | P (`proposals`) · U · E |
| Confirming carries it out; the card becomes "Done" with what was done, a toast says it too, and the page reads its data again. A refusal turns the card red with the server's words | The same, and the page's reading again is every query of the app (and, for a framed classic page, a message that has it read its loader again) | P (`done`, `failed`) · U · E · B |
| A conversation for each section, kept until the page is reloaded; a **new conversation** clears the section's | The same | U · E |
| A language box (Auto, EN, AR): the welcome's chips follow it, and it goes with the question | The same | U · E |
| **What is on the screen**: the record that is open (a lead's profile, a deal, a task, a supplier, a purchase order…) is registered when the portal's own open function runs and forgotten when its element closes; the panel says "Looking at *Supplier #3 · Yu Motors*" with a **×** to ignore it; the tab, the search with words in it, the selects and dates not at "everything" and the ticked rows are read from the page when a question goes out | The same, in two ways. A screen that has moved says which record is open (`useAssistantRecord`: supplier, ticket, stock model, container, RFQ, purchase order, contract, meeting) and the rest is read from the page by its `role`s and `type`s (`screen.ts`); a classic page in a frame is asked through the bridge | P (`record`) · U · S · F · B · E |
| **The card at the top of a section's page**: "AI insights · *Section*", who made it and when, **Refresh** (asks the model again, and the card says "Reading this section…" until the new one comes), **Ask** (opens the panel) and **Hide** / **Show** (kept, and a card that is put away asks the model for nothing); three columns of short lines ("Nothing to flag." for an empty one) and, in Leads, who to call first. Not on a page that is a full-height layout of its own (Chat, mail, Drive, the calendar…) | The same | P (`card*`) · U · E |
| Ctrl/⌘+K opens and closes the panel from anywhere; Escape closes it when it has the keyboard, or when nothing else is open over the page (a dialog keeps its own Escape) | The same | U · E |
| The panel is put back where it was on a desktop after a reload, without taking the keyboard; on a phone it is not | The same | U · E |

## A classic page in the app's frame

The classic scripts stand down in a frame (`?embed=1`) for everything the app now owns — and that included the assistant, which the app did not
have yet. Now it does, so what a framed page keeps is *reading*: `public/assets/assistant.js` builds no button, no panel, no card, exports
nothing and has no key of its own, and does two things through the bridge (`public/assets/embed.js`, `apps/web/src/legacy/bridge.ts`):

| What happens | How | Held by |
|---|---|---|
| The page tells the app which record is open on it: its kind, its number and what it is called — as it opens, again when its name arrives (it comes after a fetch), and as none when it closes or the page changes | `record{record}` | B · F · E |
| The app asks the page what is chosen on it as a question goes out, and the page answers by the number it was asked with (the tab, the search, the filters, the ticked rows; the rows are named for the section the *app* says the page belongs to); a page that does not answer within a second and a half does not hold the question back | `screen{id, section}` → `screen{id, screen}` | B · F · E |
| Once the person confirmed an action, the page on show reads its data again | `refresh{what:'page'}` | B · F |
| The card for the section stands **above the frame**, in the app | `LegacyFrame` | F · E |

Only the window that framed the page can ask it, and only it is heard; what comes back is held to its shape (a record it can hold, a screen it
can hold, each thing cut to the length the server keeps it to).

## Where the new app is deliberately not the classic page

Each of these was found by holding the new screens to the classic ones, and is a decision rather than a slip.

- **A proposal that was dismissed stays dismissed** when the panel is opened again; the classic panel took the card off the page but kept the
  proposal in the history, so it came back. **One that failed stays failed** (with the server's reason), where the classic card was drawn
  fresh and unconfirmed again.
- **The question is sent once.** The classic panel put the new question into the history *and* sent it as the message, so the model was shown it
  twice; the new panel sends the conversation so far and the question.
- **A call that did not go stays in the conversation** as a line in the panel ("Network error: …") and is not part of what the model is shown
  (it never saw it); the classic panel drew it and forgot it when the panel was opened again.
- **The chips are buttons**, so the keyboard reaches them; they look as the classic spans do (the same letter-spacing, the same corners).
- **A conversation is the section the person is on.** When the page changes to a section that has a conversation, the classic panel went on
  showing the old section's messages until it was opened again; the new panel shows the new section's.
- **A record is called by its name**, where the classic form's title was the form's ("Edit supplier"): the panel says "Supplier #3 · Yu Motors".
- **The card of a framed page stands above the frame**, where the classic card sat at the top of the page's body; once a screen moves into
  the app it is placed where the classic page put it.

## Noticed and left alone

Found while holding the new panel to the classic one; none is the new app's, and each is the server's or the classic page's to change.

- The server lets a proposal through for a person who may not act (the model is not given the means to propose, but a model that does anyway
  is not stopped): the card is drawn, and **Confirm** is refused with a 403. The new panel shows that refusal as it shows any other.
- The Accounting page (still the classic page, in the app's frame) has an assistant of its own that it builds when the page has none
  (`accounting.js` looks for `window.aiOpen`, and a framed page has never had it): so in the app's frame it still shows its own drawer, now
  beside the app's panel, and `acctAiContext` (the tab and the date range the Accounting page sends with a question) is not sent by the app's
  panel. Both go with the Accounting screen when it moves.
- What the app reads as a *filter* is a `<select>` or a date box that is not at "everything", as the classic panel reads them. A screen that
  draws its choice some other way (the app's own dropdown, `BrandSelect`) is not read as a filter; the screens that have moved say what
  matters through their tabs (`role="tab"`) and their search box, and the next batches' screens decide what they say.

## What holds it

| What | Numbers |
|---|---|
| `tests/assistroutes.js` | 84 checks, 72 mutants of the route code |
| `tests/aiparity.js` | one suite per portal, 482 checks each (about 492,000 computed values compared with the classic page's): original and loud looks, dark and light, 390 / 670 / 800 / 1100px, 30 states — among them the panel put away, the pointer on each button, and the look of a pressed Confirm that has no answer yet |
| `tests/webassist.js` | 40 checks: the real server, the built app, a real browser and a scripted model |
| `tests/embed.js` | 116 checks (59 admin, 57 team) |
| apps/web unit tests | 148 in `src/assistant` and `src/legacy` (the model's guards, the histories, what is read from a screen, the provider and every part of the panel, the layer and its failure, the bridge and the frame), and a record test in each of the eight screens that have records; the web suite is 2,443 |
| Mutation checks | 72 in the routes' code; 338 in the app's code (the model's guards and words, the histories, the screen reading, the provider, the panel, the pill, the card, the layer, the bridge and the frame); 34 in the two classic scripts; 360 in the stylesheet (every declaration, taken out on its own) — see below |
| Weight | the panel is its own file (about 3 kB gzipped), fetched the first time it is wanted; the app's first load is 174.1 kB gzipped (11 files; 164.7 kB before the assistant), inside the 200 kB budget `spashell` holds |

The parity suites of the other screens (`supparity`, `docparity`, `ctparity`, `stparity`, `subparity`, `issparity`, `meetparity`,
`calparity`, `emparity`, `gdparity`, `gcparity`, `secparity`, `acctparity`) used to put the classic page's card away, since the app drew
none; now the app draws one on the screens that have moved, so they put it away on both sides: what the card looks like is `tests/aiparity.js`'s,
and what the screen looks like is theirs.

## What the mutations found

One-line changes to the code were tried one at a time, and each one the tests did not notice got a test, a state for the parity suite to
read, or a name below. Nothing they found was a fault in the code; what they found was what nothing said, and now each of these is said:

- **The panel's keyboard.** Opened on purpose it puts the cursor in its box (not on a phone, whose keyboard would cover the answer; not when it
  is put back where it was after a reload) and leaves it be once it is put away. The width it was left at is taken back from 340 to 760
  inclusive (the edges were not tried). The key is named ⌘K on an Apple device and Ctrl K on any other.
- **One question at a time held across sections**: a chip in a section whose conversation is fresh does not go while the model is answering
  another section's question.
- **What is said about a record**: a record the page says again while it is let go of (its name arrived) stays let go of, and a different record
  is a new thing to look at; the classic page's `record` message is not sent twice for the same thing, and a section that is not a word is not
  taken for one.
- **How an answer is written**: a sum the way a person writes it (`1,234,567.8912`), and a lookup that found `0` says `0`; who said a
  message (the class and the part), which card is the one that failed, the working of a lookup is only there when there was one.
- **The card**: a list is set from the right when one of its lines is in Arabic, and only that list (the parity suite has a state for it now);
  a model that failed is not called busy; a card is shown where the browser will not say whether it was put away; the Accounting page,
  which has a card of its own, gets none from the app and its section is not asked.
- **The frame**: a record from a framed page may have a kind of 24 letters and a number of 40 characters, and a page that is on show when the
  assistant begins to listen is told of it at once; the lengths of everything a framed page says are cut to what the server keeps.
- **What the parity suite itself did not read**, found by taking declarations out of the stylesheet one at a time: the panel and the scrim
  *after* the panel has been put away (nothing of them may take a click or be seen — the suite read them open only), and the scrim's hidden
  button, in which the new stylesheet differed from the classic page's in two declarations (its touch target on a phone and its
  `user-select`); the look of every button with the pointer on it (the pill's glow, the card's Refresh, a chip, the ×, the grip), and the
  look of Confirm and Dismiss while the server has not answered. All of them are states of `tests/aiparity.js` now, and the classic page's
  supplier, which the record state opens as a modal over the page, is put away before the next state is read.

The ones left are equivalent, and are named here so that they are not mistaken for gaps:

- `??` against `||` where the value is an object, an array, a string that is not empty or a number that cannot be 0 at that place (a loaded
  answer, the conversations, the width read from storage, the kind labels, the model's own words); and the ones whose two sides come to the
  same words (`String(0 ?? '')` and `String(0 || '')` are both not Arabic);
- a literal in a TypeScript union (seven of them: `ai: false` against `ai: true` in the shapes of the answers): the type checker holds those,
  and fails each of them;
- guards the screen cannot reach: confirming a proposal that has no card or has already been settled (its buttons are gone by then), a record
  that has a kind and no number (every screen that says one says both), and `turns.length > 0` beside the mark that the welcome is kept (a
  second guard on the same fact: *New conversation* clears both);
- the framed page: `screen: null` against `{}` when it has no reader or its reader fails (the app takes both as nothing); a page loader that is
  not a function (`.then(undefined)` does nothing); the page's name defaulting to `home`; the page's hooks put in twice over (once when the
  page has loaded, once when the first page comes on show); and the count of times a name that has not come is looked for again, which each of
  the classic forms makes unnecessary by saying its record again when the name is in;
- the stylesheet (28 of its 360 declarations, each taken out on its own and none noticed by the parity suite): the default of `--ai-w` (the
  provider writes it before anything is drawn); a brain's width and its height, each of which follows from the other (the mark is square, with
  a `viewBox`); what a part takes from the part it is in, which is the same — the colour of the pill, of the "Looking at" line, of the bot's
  messages, of Confirm and of the status line (which has its own inline for every status that has words), the size and the `white-space` of
  the working of a lookup, and the `display` of a chip (a button is inline-block already); values the browser or the reset layer already say
  (`box-shadow: none`, `margin: 0` on the card's lists, `min-width: 0` on the head's text, where nothing is long enough to overflow); the
  transitions (the suite reads a page that is standing still); the scrim button's width and height (a button cannot be smaller than its
  border); and, on a phone, the sheet's `left`, `right` and `bottom` (the same as the panel's own) and the pill's width and height (the touch
  target of 44px says the same).
