# My Email — the classic portals and the new app

**My Email** — a screen in the Google group of the rail, in both portals, over one idea: show the inbox of the Gmail account a person has
linked, let them read a message and answer it, and let them link an account and let go of it. The administrator's page is a split view
(the inbox, and beside it the message that is open) with **Compose**, **Reply** and **Forward** in a sheet over the page; the team's is a
card with the inbox and, under it, the message with a box to answer it in. From the module `apps/web/src/modules/email` over
`apps/web/src/google` (the link to the account, the cards that say there is nothing to read yet, the account line, the loader: what
My Drive and My Sheets use too). The server side is not new: each portal already had its own six routes for it, and
`packages/contracts` now holds the schemas of their answers (`GmailStatus`, `GmailMessageList`, `GmailMessage`, `GmailSent`). Two things
about the server changed in this run and are named below. The classic code (`public/assets/dashboard.js` and `employee.js`, "Email")
stays where it is until the cutover.

Test files named below: **R** `tests/emailroutes.js` (the routes of both portals — who may ask for each, each grant on its own, what
Google is asked and what is kept, the round trip through the one callback, a link renewed and let go of, what makes a link unable to send;
every answer held to its schema; Google stood in for), **P** `tests/emparity.js` (look, in a real browser; two suites, one per portal),
**E** `tests/webemail.js` (the real server, the built app, a real browser, the round trip to Google and back), **U**
`apps/web/src/modules/email/` (`model.test.ts`, `data.test.tsx`, `email.test.tsx`) and `apps/web/src/google/` (the link both screens
share), **M** `apps/web/src/app/registry.test.ts` (it is a module of the app now), **W** `tests/webframe.js` (and it is not framed any
more), **V** `tests/emailview.js` (the classic administrator's viewer against an attacker's message, which is unchanged).

## What the server is asked

| Classic | New | Held by |
|---|---|---|
| `GET /api/email/status` (the administrator's; not under `/api/dashboard`), `GET /api/employee/email/status` (`email.view`) — no Google project here, a project and no account, or an account: its email and name | The same, asked on every visit, **and whether the link can send** (`canSend`: Google says what it granted, and a grant of `gmail.send`, `gmail.compose`, `gmail.modify` or the whole of Gmail can send; a grant that was never recorded is let through). An answer that is none of those is "Gmail came back in a form this app does not know." | R · U · E |
| `GET …/email/connect?_t=<token>` (the administrator's; the team's needs `email.connect`) — a 302 to Google's consent screen; 400 when there is no Google project | The same, **asking for the right to send as well as to read** (the administrator's connection left sending out until now, so Compose and Reply always came back "insufficient authentication scopes"), with a state nobody could guess. A navigation carries no header, so the token goes in the address, as in the classic page; the team's page first asks `/api/employee/check` (the classic page does) so that a session that is over is dealt with before leaving | R · U · E |
| `GET /api/email/callback` — the one return every Google consent screen of the app comes back to; a state that was handed out for Gmail trades the code, asks who the person is and keeps the link; the browser lands on `/dashboard#email` or `/employee#email` | The same. **A return this server did not hand out is turned away with a 400** (the administrator's Gmail connection handed out no state, and the callback took a return it did not recognise for the administrator's Gmail: a code from any Google account would have become the administrator's mailbox). The app turns the hash into the screen (`/dashboard/email`, `/employee/email`) | R · E |
| `POST …/email/disconnect` (the administrator's; the team's needs `email.connect`) — forgets the link and empties its row in `google_tokens` | The same, then reads the link anew | R · U · E |
| `GET …/email/messages` (`email.view`) — the 15 newest messages of the inbox, each with sender, subject, date, snippet and whether it is unread; an access token that has run out is renewed with the refresh token first (the team's renewed link is kept for a restart) | The same | R · U · E |
| `GET …/email/messages/:id` (`email.view`) — one message in full: its headers, and a body that is HTML where the message is HTML or has an HTML part among its top-level parts, and text otherwise | The same | R · U · E |
| `POST …/email/send` (`email.send`) — `to`, `subject`, `body`, and for a reply `threadId` and `inReplyTo` (sent as a plain-text message with `In-Reply-To` and `References`) | The same. What is blank is left out (the classic team page sent empty strings) | R · U · E |
| A person with no account asking for the inbox is told "Gmail not connected" (400, the administrator's; 500, the team's); Google saying no to a send is its own words (500) | The same words, in place of the list or the message | R · U · E |

## What the screens do

| Classic | New | Held by |
|---|---|---|
| Opening the screen shows the loader, then the answer. The administrator's page: a block with the spinner above "Checking Gmail…"; the team's: a line, "Loading email…" | The same | P (`loading`) · U · E |
| No Google project: the administrator's page is a card in the middle of the page with no picture ("Connect Gmail", "Add these env vars in Railway then redeploy:" and the three variables in a block); the team's is lines of text under the mail icon ("Email not configured", "Google OAuth is not set up. Contact your admin."). Neither has a button | The same | P (`unconfigured`) · U · E |
| An account is not linked: the same card with "Connect Your Gmail", "Sign in with Google to view your inbox in this dashboard." and a full-width **Connect Gmail**; the team's lines with "Connect your Google account to access your personal inbox." and the usual button, with the mail icon in it | The same | P (`unlinked`) · U · E |
| An account is linked: a circle with the first letter of the name, the name and the email; the administrator's **Compose** and **Disconnect** beside them, the team's **Disconnect** alone | The same | P (`linked`) · U · E |
| The inbox: a line for each message — a dot where it is unread, the sender's name (what stands before the address), the date, the subject, a snippet — bold where unread. The administrator's is a table card ("Inbox", **Refresh**) in a pane 380px wide, with a placeholder ("Select an email to read it") beside it until a message is chosen; the team's is a card, the line that is open tinted | The same. Every line can be opened from the keyboard (Enter or Space) | P (`linked`, `empty`, `listLoading`) · U · E |
| An inbox with nothing in it: "No messages" (the administrator's), "No messages in inbox" (the team's) | The same | P (`empty`) · U · E |
| A message opened: the administrator's pane has the subject, From, To (when there is one), the day and time as the reader writes them, **Reply** and **Forward**, and the body; the team's panel under the inbox has **Back**, the subject, From, To and Date as the header came, the body, and a box to answer in | The same | P (`open`, `msgLoading`) · U · E |
| A phone: the administrator's two panes become one at a time — the inbox, or the message with a **← Back** | The same | P (390, 670) |
| A message of HTML is drawn in a frame that runs nothing (`sandbox="allow-same-origin"`: no script, no form, no top navigation); the administrator's frame is made as tall as what is in it, the team's is 400px at least. A message of text is drawn as text | The same, and the frame is handed **exactly what Gmail gave** (the team's classic page put it in the page as an attribute and turned only the quotes into entities, so an `&amp;` or `&lt;` in the message was read one time too many) | P (`openHtml`) · U · E · V |
| **Compose** opens a sheet "New Email" — To, Subject, Message (all three required) — with **Cancel** and **Send**; **Reply** opens it as "Reply", filled in with the sender's address and the subject, in the message's conversation; **Forward** opens a New Email addressed to the sender and no more | The same. The sheet stays until the email has gone, and what was written stays when it did not | P (`compose`, `reply`) · U · E |
| Sending: the button reads "Sending…" and is held; an `alert` says "Email sent successfully!", or "Failed to send: …", or "To, subject and message are required" | The same, **in the messages at the foot of the screen** (not `alert`s) | U · E |
| The team's box: **Send Reply** sends to whoever wrote the message, in its conversation, under "Re: …"; the button says "Sent!" for three seconds and the box is emptied; a refusal is an `alert` "Error: …" | The same, in a message at the foot; the words stay in the box | U · E |
| **Refresh** (the administrator's) starts the page over: the loader, whose account it is, the inbox again, no message open | The same | U · E |
| **Disconnect** lets go of the account and the page asks again | The same; the button is held while it is asked, and a refusal is told in a message at the foot | U · E |

## Where the new app is deliberately not the classic page

Each of these was found by holding the new screens to the classic ones, and is a decision rather than a slip.

- **A connection that cannot send says so, and offers to be made again.** The server now says whether a link can send (`canSend`), and
  both pages tell a link that cannot — "This connection was authorised before sending was supported, so Compose and Reply will fail. **Reconnect**
  to fix it." (the team's: "…so replies will fail…", and for a member who may not link an account, "Ask your admin to reconnect it."). The
  administrator's was always one: its connection did not ask for the right to send. A person who unticks it on Google's consent screen
  gets one too. Compose and Reply are not taken away: they are told to fail, not hidden.
- **The administrator's Gmail return is only trusted if the server asked for it** (see the table). The classic page connected with no
  state, and the callback took any return it did not recognise for the administrator's Gmail.
- **Sending, linking and reading are grants of their own** (`email.send`, `email.connect`, `email.view`), and the new team page offers
  each only to those who have it. The classic team page showed the reply box, **Connect Gmail** and **Disconnect** to everyone and sent a member
  without the grant to a raw error at the end. A member who may read and may not link an account is told "No Google account is linked. Ask
  your admin to link one for you."; one who has the screen without the right to see whose mail it is is told "Gmail is not switched on for you.
  Ask your admin."
- **Each message has its own box to answer in.** The classic team page had one box under whichever message was open, so what was typed under
  one message was sent to the sender of the next one you opened, and a reply sent while the next message was still loading went to the
  sender of the one before. Here the box is drawn once a message is there, and what was typed is not carried to another.
- **A reply's subject has one "Re:"** in both portals (the classic team page put another in front of the subject of every reply to a reply).
- **When Gmail would not give the inbox, the page says why** in the server's words, with the account and **Disconnect** kept. The classic
  administrator's page read an error as an inbox with nothing in it ("No messages").
- **When Gmail did not give a message, the page says so** ("Gmail did not give this message. It may have been moved or deleted."). The server
  answers that as a message with nothing in it, and the classic pages drew a blank card — with a **Reply** that opened a New Email to nobody.
- **A date that cannot be read is left blank**; the classic pages wrote "Invalid Date".
- **Every visit starts with the loader.** Nothing is kept for the next one, so a page never shows the last visit's inbox (which may have
  been read, moved or let go of since) while it asks again.
- **`alert()` is a message at the foot of the screen**, as everywhere else in the new app.
- **The administrator's picture on the cards is blank**, as it is in the classic page (an emoji was lost from it long ago): the same empty
  block, the same size.

## What was noticed on the server and left alone in this run

- **Gmail failing to list the inbox reads as an empty inbox**: the server answers `[]` whatever Gmail said (a revoked grant, a quota), so
  "No messages" can be a lie. The new page cannot tell it apart; the route is pinned as it is (`tests/emailroutes.js`).
- **An HTML body found two levels down** — as in most messages that have an attachment — is found, but not marked as HTML, so it is shown
  as text (the markup in it as words).
- **A message Gmail will not give answers 200 with a message with nothing in it** (no id, no thread). The new page recognises that (above);
  the route is unchanged.
- **The administrator's inbox route renews an access token that has run out and does not keep the new one** (the team's keeps it); the
  next call renews it again. Harmless but wasteful.
- **The two portals answer "not connected" differently**: the administrator's list is a 400, the team's a 500, and the administrator's
  message and send are 500s.
- **Forward does no more than open a New Email to the sender** — no "Fwd:" subject, nothing quoted, no attachments. It is what the
  classic page does, so it is what this does; a real Forward is a product decision.
- **The attachments of a message are not listed or downloadable** in either page, as before.

## How it was checked

`tests/emailroutes.js` holds the server's side (59 checks, and the no-Google-project process); `apps/web/src/modules/email` holds the
screen against a script (146 tests, the guards held to the schemas by a corpus of every wrong value of every field) and
`apps/web/src/google` the link both screens share (117 tests); `tests/emparity.js` holds the look to the classic pages' computed style,
value by value (both portals, two looks, both modes, four widths, 11 states on the administrator's page and 9 on the team's, about 420,000
values); `tests/webemail.js` runs it all against a real server and a real browser (47 checks, including the round trip through Google's
consent screen, a consent that left out the right to send, a message of hostile markup in every field, and what Gmail was sent).

One-line changes to the code were tried one at a time — 242 in the screen and the link hook, 26 in the server, 92 in the stylesheet —
and each one the tests did not notice got a test (or, in the stylesheet, a part or a property for the parity suite to read: the
spans that hold the sender and the recipient, and `resize`, `word-break`, `overflow-wrap` and `vertical-align`). The one the mutations found
that a person would have seen: the administrator's **Connect Gmail** button was drawn with the team's mail icon in it, which the classic
button has not; the parity suite now reads it. The ones left are equivalent, and are named here so that they are not mistaken for gaps:

- the second `.+` in the address pattern (`<(.*)>` finds the same address, because an empty one falls back to the whole sender);
- the message and error fields when no message is chosen (the query is off, so there is nothing for them to say either way);
- the `instanceof ApiError` that only narrows a type, and the default of the "no message to answer" text (a state that cannot be reached);
- the `key` that remounts the team's message (the box is unmounted anyway while the next message loads, and so loses what was typed);
- the clean-up of the "Sent!" timer when the page is left (React no longer minds a state set after that);
- the null guard in `gmailCanSend` (it is only called with a link that exists);
- the stylesheet's `gap` between a sender and a date (the sender is cut at 180px, so they never meet) and the team text's `font-family`
  (`inherit` is the same face as `var(--font)` there).
