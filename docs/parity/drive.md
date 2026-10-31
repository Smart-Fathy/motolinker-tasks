# My Drive and My Sheets — the classic portals and the new app

**My Drive** and **My Sheets** — two screens in the Google group of the rail, in both portals, over one idea: show the files of the
Google account a person has linked, and let them link one and let go of it. My Drive lists everything in the account (the 50 newest
that are not in the bin); My Sheets lists the spreadsheets among them. From the module `apps/web/src/modules/drive` and
`modules/sheets` (each only the list it is) over `apps/web/src/google` (the pieces they share: the link, the files, the cards that say
there is nothing to browse yet, the viewer). The server side is not new: each portal already had its own five routes for them, and
`packages/contracts` now holds the schemas of their answers (`DriveStatus`, `DriveFile`, `DriveFileList`, `GoogleDisconnected`). The
classic code (`public/assets/dashboard.js` and `employee.js`, "Drive / Sheets") stays where it is until the cutover.

Test files named below: **R** `tests/driveroutes.js` (the routes of both portals — who may ask for each, each grant on its own, what Google
is asked and what is kept, the round trip through the one callback, a link renewed, a link let go of; every answer held to its schema;
Google stood in for), **P** `tests/gdparity.js` (look, in a real browser; two suites, one per portal), **E** `tests/webdrive.js` (the real
server, the built app, a real browser, the round trip to Google and back), **U** `apps/web/src/google/` (`model.test.ts`, `data.test.tsx`,
`google.test.tsx`), **M** `apps/web/src/app/registry.test.ts` (both are modules of the app now), **W** `tests/webframe.js` (and neither is
framed any more).

## What the server is asked

| Classic | New | Held by |
|---|---|---|
| `GET /api/drive/status` (the administrator's; not under `/api/dashboard`), `GET /api/employee/drive/status` (`drive.view`) — no Google project here, a project and no account, or an account: its email and name, and whether it can upload | The same, asked on every visit. An answer that is none of those is "Google Drive came back in a form this app does not know." | R · U · E |
| `canUpload` is false for a link made before uploads were asked for (Google says what it granted; a grant of `drive.file` or the whole of Drive can upload, a grant that was never recorded is let through) | The same; the administrator's page tells it to reconnect (the team's never did) | R · U · P (`old`) |
| `GET …/drive/connect?_t=<token>` (the administrator's; the team's needs `drive.connect`) — a 302 to Google's consent screen asking for read access to Drive, the right to create files the app makes, who the person is, offline access and the consent screen every time, with a state nobody could guess; 400 when there is no Google project | The same. A navigation carries no header, so the token goes in the address, as in the classic page; the team's page first asks `/api/employee/check` (the classic page does) so that a session that is over is dealt with before leaving | R · U · E |
| `GET /api/email/callback` — the one return every Google consent screen of the app comes back to; a state that was handed out for Drive trades the code, asks who the person is and keeps the link; the browser lands on `/dashboard#drive` or `/employee#drive` | The same; the app turns the hash into the screen (`/dashboard/drive`, `/employee/drive`) | R · E |
| `POST …/drive/disconnect` (the administrator's; the team's needs `drive.connect`) — forgets the link and empties its row in `google_tokens` (the row stays, empty: a restart finds nothing to bring back) | The same, then reads the link anew | R · U · E |
| `GET …/drive/files` (`drive.view`) and `GET …/drive/sheets` (`sheets.view`) — Drive's list with these fields; what is not in the bin, newest change first, 50 at a time; the spreadsheets are the same call with the type added; an access token that has run out is renewed with the refresh token first (and the team's renewed link is kept for a restart) | The same | R · U · E |
| A person with no account asking for files is told "Drive not connected" (500); Google saying no is its own words (500) | The same words, in place of the list | R · U · E |

## What the screens do

| Classic | New | Held by |
|---|---|---|
| Opening the screen shows the loader, then the answer. The administrator's page: a block with the spinner above "Loading…"; the team's: a line | The same | P (`loading`) · U · E |
| No Google project: the administrator's page is a card in the middle of the page (the word "Drive" or "Sheets" for a picture, "Connect Google Drive", "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars then redeploy."); the team's is lines of text under the screen's icon ("Google Drive integration not configured. Contact your admin."). Neither has a button | The same | P (`unconfigured`) · U · E |
| An account is not linked: the same card with "Connect your Google account to browse your Drive files." and a full-width **Connect Google Drive**; the team's lines with "Connect your Google account to access your files." and the usual button | The same | P (`unlinked`) · U · E |
| An account is linked: a circle with the first letter of the name, the name and the email, **Disconnect**; a card with the title and "N file(s)"; a table of **Name**, **Modified** (the date, in the reader's own way of writing one, or a dash) and two buttons — **View** and **Open ↗** (only for a file Drive gave a link for) | The same. The administrator's card is a table card; the team's a card with a scrolling table whose first column stays in view, and no less than 460px wide | P (`linked`) · U · E |
| The picture before a name: a folder, a sheet (green), a document (blue), slides (amber), a PDF (red), a picture, a film (amber), and — in the administrator's page alone — sound; anything else a paperclip | The same | P (`linked`) · U · E |
| A phone: a table is a card for each row (the classic `mobile.css`), labelled from its own heading — the team's cells carry the labels, the administrator's table card has none, so its labels are empty blocks | The same | P (390, 670) |
| An account with nothing in it: the administrator's table, empty under "0 files"; the team's "No files found" | The same | P (`empty`) · U · E |
| The administrator's page tells a link made before uploads were asked for: "This connection was authorised before uploads were supported, so attaching a client file will fail. **Reconnect** to fix it." | The same | P (`old`) · U |
| **View** opens the file over the whole page, in Google's own preview of it (a spreadsheet, a document, slides, or Drive's preview of anything else), with its name, **Open in Google ↗** and a **×** | The same; it is a dialog (the focus moves into it and goes back, Tab stays in it, Escape puts it away) | P (`viewer`) · U · E |
| **Disconnect** lets go of the account and the page asks again | The same; the button is held while it is asked, and a refusal is told in a message at the foot | U · E |

## Where the new app is deliberately not the classic page

Each of these was found by holding the new screens to the classic ones, and is a decision rather than a slip.

- **The team's Disconnect button does not work in the classic page.** Its label reads `')">Disconnect` and pressing it runs a script
  that does not parse: the page builds the button with the icon's markup inside an attribute that is quoted with the same quotes
  (`onclick="disconnectDrive('…','<i data-lucide="hard-drive" …>')"`). A team member has never been able to let go of their account
  from either screen. The new button says Disconnect and does it (`tests/gdparity.js` names the three values that differ, and checks
  that they still do). The administrator's button was always fine.
- **Link and unlink are a grant of their own** (`drive.connect`), and the new team page offers them only to those who have it. The classic
  page offered both to everyone and sent a member without the grant to Google and back to a raw error. A member who may see the files and
  may not link an account is told "No Google account is linked. Ask your admin to link one for you."
- **My Sheets without the Drive grant** (the team's status route needs `drive.view`, and Sheets can be granted without it): the classic
  page told that member the integration was "not configured. Contact your admin." The new one says "Google Drive is not switched on for you.
  Ask your admin."
- **When Google would not list the files**, the new page keeps the account and **Disconnect** and puts Google's words in place of the list.
  The classic administrator's page showed `files.map is not a function` and nothing else (no way to let go of an account Google had
  turned against); the classic team page showed "undefined files" over "No files found".
- **Disconnect on My Sheets (the administrator's)** reloaded My Drive in the classic page and left My Sheets as it was until it was left
  and opened again. Both screens are one account here, and both ask again.
- **The administrator's file icons** were drawn in the classic page only when something else asked the icon library to redraw the page,
  which this page never does by itself; here they are drawn at once.
- **Every visit starts with the loader.** Nothing is kept for the next one, so a page never shows the last visit's account (which may
  have been let go of since) while it asks again.
- **A link to Google is followed only if it is an https one**; the classic page put whatever Drive gave into `href`.

## What was noticed on the server and left alone in this run

- The administrator's file listing renews an access token that has run out and does not keep the new one (the team's listing does);
  the next listing renews it again. Harmless but wasteful.
- The administrator's Gmail connection (`/api/email/connect`) hands out no state, and the callback treats a return whose state it did not
  hand out as a Gmail return, so a code obtained elsewhere would be accepted for the administrator's mailbox. It is the next screen's
  (My Email), where it will be raised.

## How it was checked

`tests/driveroutes.js` holds the server's side (54 checks, and the no-Google-project process); `apps/web/src/google` holds the pieces and
both screens against a script (117 tests, the guards held to the schemas by a corpus of every wrong value of every field); `tests/gdparity.js`
holds the look to the classic pages' computed style, value by value (both portals, two looks, both modes, four widths, 361,000 values);
`tests/webdrive.js` runs it all against a real server and a real browser (34 checks, including the round trip through Google's consent
screen, stood in for). One-line changes to the code were tried one at a time (171 of them, across the guards, the routes, the cache
keys, the grants, the states and the stylesheet), and each one the tests did not notice got a test; two are equivalent and are left: the
`instanceof ApiError` that only narrows a type, and the null row a restart skips (a link that is null reads as none either way).
