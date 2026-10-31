# Security and the account menu — the classic portals and the new app

**Account security** — the panel that holds two-factor authentication, the devices an account is signed in on and its recent sign-ins
(both portals; the team's adds the password), and the steps it goes through — and, in the team portal, the **account menu** behind a
person's own face: the picture, the name and its pencil, the status, and the dialogs that change them and the password. From the module
`apps/web/src/modules/security` (the answers' checks and small words, the data, the panel and its views, the account's calls and
dialogs), `apps/web/src/app/shell` (the menu, the footer entry, the frame that owns the panels), `apps/web/src/ui` (`Modal`, `Btn`). The
server side is not new: `src/routes/account-security.js` already served both portals with one handler, and the picture, status,
username and password routes (`src/routes/employee-portal.js`, `index.js`) have no twin, so the app calls them as they are. The
classic code (`public/assets/security.js`, the profile menu in `public/employee.html` and `public/assets/employee.js`) stays where it is
until the cutover.

Test files named below: **S** `tests/account.js` (the account routes and the Security answers, and that each is the shape the contract
says) and `tests/signintest.js` (the second factor itself: the limits, the replay protection, the alerts), **P** `tests/secparity.js` and
`tests/acctparity.js` (look, value by value, in a real browser), **E** `tests/websecurity.js` (the real server, the built app, a real
browser), **U** `apps/web/src/modules/security/` (`model.test.ts`, `security.test.tsx`, `account.test.tsx`), **M** `tests/modules.js`
(the catalogue: Security is a panel), **A** `tests/actor.js` (`/api/v1/me` carries the profile), **W** `tests/webframe.js` and
`tests/webshell.js`, **C** `tests/securityui.js` (the classic panel itself, unchanged).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/security` — the account, two-factor (available, why not, on, since when, codes left, whether secrets are encrypted), the devices (never their tokens), the sign-in record, whether there is one, what the server does about a new device | The same route and answer; its shape is `SecurityOverview` in `packages/contracts` | S (employee, admin; the migration missing; a database that does not answer; the other portal's login is 401) |
| `POST …/security/2fa/setup` — asks the password again (403 if wrong); the key, the link and the picture | The same | S · E · U |
| `POST …/security/2fa/enable` — the code from the app; ten recovery codes, once; every other device signed out | The same | S · E · U |
| `POST …/security/2fa/disable`, `…/2fa/recovery-codes` — the password and a code | The same | S · E · U |
| `DELETE …/security/sessions/:sid`, `POST …/security/sessions/revoke-others` | The same | S · E · U |
| `PUT /api/employee/status` · `POST /api/employee/avatar` (an image up to 5 MB) · `PUT /api/employee/username` (3–32 of letters, numbers `. _ -`; 409 if taken) · `POST /api/employee/change-password` (the other devices signed out; 403 if the current one is wrong; 5 wrong answers lock it) | The same routes | S (limits, trimming, the live session told, the other devices out, the person notified) · E · U |
| The profile: `GET /api/employee/check` (name, job, picture, status) | `GET /api/v1/me` carries it as `profile` (`username`, `avatarUrl`, `statusText`, `statusEmoji`) for an employee; the administrator has none | A · S · E ("opened afresh, the page has her picture, her status and her username") |

## What the panel does

| Classic | New | Held by |
|---|---|---|
| Opens over the page the person is on, from the account menu (team) or the footer (admin); `#security` opens it after the page has loaded and takes the hash off the address; a notification whose link ends `#security` opens it | The same: the menu's and the footer's buttons, and `/security` (what the notification's link and the alert email's become) open it over the page the person was last on and put the address back; Security is a **panel** in the catalogue (`panel: true`): never in a rail, never where somebody "was" or starts | U ("the way in") · E ("the links to it") · M |
| "Account security", "<name> · Protect your account and see where it is signed in." | The same | U · P |
| Two-factor off: "Add a second step…" and **Turn on**; on: "Signing in needs a 6-digit code…", the day it was turned on, "N recovery codes left" (and "— make new ones soon" at two or fewer), **New recovery codes** and **Turn off**; unavailable: the migration to apply, or "could not load this right now" | The same | U ("what it shows") · P (`off`, `on`, `unavailable`, `broken`) |
| Where you're signed in: this device marked, the others with how they signed in and **Sign out** each, and **Sign out all other devices** when there are any | The same | U · E · P |
| Recent sign-ins: the device, "New device" where it was one, the address and how, when; the alert line; "Nothing recorded yet."; the history needing the migration | The same | U · P |
| The team's Password card: **Change password** puts the panel away and opens the password dialog | The same | U · E |
| Turn on: the password again → the key (in groups of four), the picture, a link for the phone → six digits → ten recovery codes with **Copy** and **Download**, held by "I have saved these codes" until **Done** | The same | U ("turning two-factor on") · E · P |
| Turn off and New recovery codes: the password and a code; the wrong ones are the server's 403, said in the panel | The same; **a 403 does not end the visit** | U · E ("…and that is a 403, so she is still in the app") |
| Every other device is signed out by turning it on and off; the panel says how many, and the app tells the server about this device's push subscription again (the server clears them with the sessions) | The same (the app's own service worker does it) | U · E |
| Escape, the ×, a press on the curtain close it; it is opened afresh each time | The same | U · E |

## What the account menu does

| Classic | New | Held by |
|---|---|---|
| Your face in the top bar (the initials, or the picture) opens the menu: picture, name and a pencil, job title, status line, Report an issue, Change password, Security, Sign out | The same, with **Classic portal** (the way back to the classic page) between Security and Sign out; anything that opens a dialog puts the menu away first | U · P · E |
| The picture is the button that changes it (a camera at its corner): a file of 5 MB or less that is an image; "Please choose an image", "Image must be under 5 MB", "Upload failed: …", "Profile picture updated" | The same | U ("the picture") · E |
| The pencil: "Change Username", "3–32 characters: letters, numbers, dots, dashes, underscores.", the server's refusal in the dialog ("Username already taken"), "Username changed to <name>" | The same | U · E · P |
| The status line ("＋ Set status", or the emoji and the words, in the primary colour): Set status with four presets, **Clear status**, **Save**; "Status updated" / "Status cleared" | The same | U · E · P |
| Change Password: current, new, confirmed; "Enter your current password.", "New password must be at least 8 characters.", "New passwords do not match.", the server's words; "Password updated. N other device(s) was/were signed out." or "Password updated successfully!"; the warning where some devices could not be signed out; the fields emptied | The same | U · E · P |

## Look

`tests/secparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two looks (the
original and a loud one), at 390, 670, 800 and 1100 px, in fifteen states (the loader; two-factor off, on, unavailable and
"broken" — which also has alerts off and no sign-ins; the admin's unencrypted secrets; turning on at the password, at the mistake, at
the key and at the recovery codes; turning off; new codes; a device signed out), with what the server says stood in for the same on both
sides, and compares the computed style of every named part — the curtain, the box, its head, title, ×, lead and message, each card and
its heading, pill, text and buttons, each device and sign-in, each form's labels, fields and buttons, the picture and the key, the
codes — and the words in them: more than 735,000 values, none different, no difference accepted. It runs as two suites, one per
portal (`secparityadmin`, `secparityteam`), so CI can deal them out.

`tests/acctparity.js` does the same for the team's account menu (the button, the menu closed and open, with and without a picture and
a status) and its three dialogs (the status dialog empty and with a status, the username dialog and its refusal, the password dialog,
its mistake and its success): about 155,000 values, and two kinds of difference accepted, each with its reason in the file — the new menu is one
row taller (it has the way back to the classic portal), and a dialog taller than the window scrolls inside itself where the classic
one is cut off at the top and bottom of the screen.

## Decisions and deliberate differences

- **A Security overview that could not be loaded says why.** The classic panel set the message and then redrew itself, which wiped it:
  it showed "Loading…" for ever. (A 401 says nothing: whether the session is over is the app's to decide.)
- **A device that could not be signed out says so.** The classic panel wrote the failure and then asked for the list again, which wiped
  it; the new one says it after the list has been read.
- **A "sign out all other devices" the server could not save is a failure.** The server answers 200 with `ok: false` and a `warning`
  when some sign-outs could not be saved; the classic panel took the 200 for success and said "Signed out N other devices".
- **Security is a panel, not a page.** `/security` is a way to it, not somewhere to be: it opens the panel over the page the person was
  last on (or Home) and the address goes back to that page's own — as `#security` did.
- **The account's dialogs close on Escape and keep focus inside**, and the status line is a button for the keyboard too (Enter or
  Space). The classic dialogs had no keyboard handling at all.
- **A network failure says "Cannot reach the server. Check the connection and try again."**, where the classic password dialog said
  "Connection error".
- **A moment that is not a date is not shown** where the classic panel wrote "Invalid Date".
- **The server answers with `ApiError`'s words everywhere**: the classic fallbacks ("Could not start setup.") are only used where the
  server sent none, which it does not.
- **Both portals' Security calls are the portals' own routes** (`/api/employee/security`, `/api/dashboard/security`), not `/api/v1`: one
  handler already serves both, so nothing is unified, and they move under `/api/v1` when the classic portals retire.

## Not in this module (so not here)

Availability and the Home board's editor (they go with Home and Tasks); sign-in itself and its second step (the sign-in screens, which
were ported first: [signinparity](../../tests/signinparity.js), [webauth](../../tests/webauth.js)); the administrator resetting an
employee's second factor (the Employees screen, batch 8).
