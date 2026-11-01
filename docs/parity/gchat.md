# Google Chat — the classic portals and the new app

**Google Chat** — a screen in the Google group of the rail, in both portals, over one idea: show the spaces (rooms and conversations) of the
Google account a person has linked, let them read one and write in it, and let them link an account when none is. It is one page of two
panes: the spaces on the left, the open one on the right. From the module `apps/web/src/modules/gchat` over `apps/web/src/google` (the
link to the account, the loader: what My Drive, My Sheets and My Email use too). The server side is not new and **did not change in this
run**: one factory (`mountChatRoutes`, `index.js`) writes the six routes for each portal, and `packages/contracts` now holds the schemas of
their answers (`GchatStatus`, `GchatSpaceList`, `GchatMessageList`, `GchatSent`). The classic code (`public/assets/dashboard.js` and
`employee.js`, "Google Chat panel") stays where it is until the cutover.

The classic page is drawn with the main Chat's stylesheet rules (`.chat-layout`, `.chat-room-item`, `.chat-msg`, …), because the two
share a look. The main Chat has not moved into the app yet, so what Google Chat borrows from it is written in the module's own
stylesheet, for each portal, until it does.

Test files named below: **R** `tests/gchatroutes.js` (the routes of both portals — who may ask for each, each grant on its own, what
Google is asked and what is kept, the round trip through the one callback and the way back that failed, a link renewed, lost and let go of,
what a link reaches; every answer held to its schema; Google stood in for; and five smaller runs for what is decided when the server
starts), **P** `tests/gcparity.js` (look, in a real browser; two suites, one per portal), **E** `tests/webgchat.js` (the real server, the
built app, a real browser, the round trip to Google and back), **U** `apps/web/src/modules/gchat/` (`model.test.ts`, `data.test.tsx`,
`gchat.test.tsx`) and `apps/web/src/lib/chat-return.test.ts` (the reason Google sends someone back with), **M**
`apps/web/src/app/registry.test.ts` (it is a module of the app now), **W** `tests/webframe.js` (and it is not framed any more), **I**
`apps/web/src/app/shell/icons.test.ts` (every picture the screen draws is in the app's set).

## What the server is asked

| Classic | New | Held by |
|---|---|---|
| `GET …/gchat/status` (`gchat.view`) — Chat not set up here (`GOOGLE_CHAT_ENABLED` is not `1`, or there is no client to ask Google with), set up and no account, an account Google no longer honours (`reconnect`, and whose it was), or an account: its email and name and what its grant reaches (`caps`: spaces, reading, sending) | The same. A link is only found to be lost when something asks Chat, so a status says so from the visit after | R · U · E |
| `GET …/gchat/connect?_t=<token>` (`gchat.view`: there is no grant of its own for linking) — a 302 to Google's consent screen as Chat's own client (the app's, with none of its own), asking for the spaces, sending and reading messages (reading is left out when `GOOGLE_CHAT_READ=0`) beside who the person is; 400 as plain text when Chat is not enabled or there is no client | The same: the session goes in the address, as in My Drive and My Email (the team's page first asks that it is still good) | R · U · E |
| `GET /api/email/callback` — the one return every Google consent screen of the app comes back to; a state that was handed out for Chat trades the code with Chat's client, asks who the person is and keeps the link with the scope Google actually granted (which can be less than was asked for); the person lands on `/dashboard#gchat` or `/employee#gchat`. When Google would not trade the code, the person is sent to `/dashboard` or `/employee` with `?gchat_error=<why>#gchat` (a refusal for scopes gets a sentence that says what to do) | The same; the new app reads the reason **when it starts** and takes it out of the address bar (the redirect to the screen's own address would drop it), and says it once | R · U · E |
| `POST …/gchat/disconnect` (`gchat.view`) — forgets the link and empties its row in `google_tokens` | The same. **No screen has a button for it** (neither does the classic page: its `gchatDisconnect()` was never called), so the new one has none | R |
| `GET …/gchat/spaces` (`gchat.view`) — up to 100 spaces, each with Chat's address for it, what to call it (its name; "Direct message" for a conversation of two; "Untitled space" for a group with no name) and Chat's word for the kind. When Chat says no the answer is still a 200: an empty list with the reason beside it (`forbidden`, `reconnect`, `failed`, `not_connected`, `not_configured`) and Google's own words where it gave some | The same words, in place | R · U · E |
| `GET …/gchat/messages?space=spaces/<id>` (`gchat.view`) — the 50 newest messages of a space, oldest first, each with its address, its words, who wrote it as Chat names them and when; an address of any other shape is `bad_space`, and Chat is not asked. When Chat says no: an empty list and the reason, as for the spaces | The same; asked again every twenty seconds while the conversation is on the page and the page is in view | R · U · E |
| `POST …/gchat/messages` `{ space, text }` (`gchat.send`) — the words trimmed and cut at 4,000; `{ ok: true, id }`, or `{ ok: false, error, detail }` when Chat (or the link) said no; a 400 `{ error: 'bad_space' | 'empty' }` for what the route turns away itself | The same; the words of a refusal are told at the foot of the screen | R · U · E |
| An access token that has run out is traded for a new one with the refresh token, by Chat's client, and kept; a renewal Google refuses as a grant that is gone marks the link as lost (in memory only) and every route says `reconnect`; any other failure of a renewal is not reported and the old token is tried | The same | R |

## What the screens do

| Classic | New | Held by |
|---|---|---|
| Opening the screen shows the list with the spinner in it, and "Select a space" in the main pane, until it is known whose Chat it is | The same | P (`loading`) · U · E |
| Chat is not set up here: a card in the main pane with a plug, "Google Chat is not set up", and "Ask an administrator to enable it (`GOOGLE_CHAT_ENABLED=1`). Google Chat requires a Google Workspace account."; the list is empty | The same | P (`unconfigured`) · U |
| No account linked: "Connect Google Chat", "See your spaces and messages here, and reply without leaving the app." and a **Connect Google Chat** button | The same; the button goes to Google and the person comes back to the screen | P (`unlinked`) · U · E |
| A link Google no longer honours: "Reconnect Google Chat", "Your Google session expired. Unverified apps in testing mode lose access every 7 days." and **Reconnect** | The same | P (`lost`) · U · E |
| Sent back from Google with a reason in the address: "Couldn't connect Google Chat", the reason, and **Try again** (which goes to Google again) | The same, once | P (`returned`) · U · E |
| The spaces: a row for each — a circle with the first letters of its first two words (square-cornered for a space of people), its name, "Direct message" or "Space" under it; "No spaces yet. Group chats and DMs only appear here once they have at least one message." where there are none | The same | P (`spaces`, `noSpaces`) · U |
| Chat will not list the spaces: a card "Google Chat unavailable" that says the organization does not allow it, or that the Google session expired (with **Reconnect**), or that Chat could not be reached | The same | P (`spacesDenied`, `spacesExpired`, `spacesFailed`) · U · E |
| A space opened: its name over its messages, and a box to write in (a round button beside it). The person's own messages are on the right in the accent colour, the others' on the left under their writer's name (or "Unknown"), each with its time as hours and minutes | The same | P (`open`) · U · E |
| The messages are on their way: the spinner in the messages' place | The same | P (`msgLoading`) · U · E |
| A space with nothing in it: "No messages in this space yet." | The same | P (`noMessages`) · U · E |
| The messages could not be had: a card "Could not load messages" with Google's words (with **Reconnect** where the link has gone) | The same; where Google gave no words the card says the reason in a sentence | P (`msgDenied`, `msgExpired`) · U · E |
| A link that was not granted reading: the messages are not asked for; "Message history not shared", "You didn't grant permission to read messages. You can still send." and **Grant read access** (which goes to Google again) | The same | P (`noRead`) · U · E |
| A link that was not granted sending: a line "Read-only — you didn't grant permission to send." with **Reconnect**, where the box would be. For a team member who does not hold the right to send, "Read-only — your admin has not granted sending." | The same | P (`readOnly`) · U · E |
| Writing: Enter sends, Shift+Enter breaks the line; the button is held while the message goes; the box is emptied only once Chat took the message, and the messages are asked for again; a refusal is an `alert` "Could not send: …" | The same, with the refusal at the foot of the screen | U · E |
| **Refresh** (the small button over the list) asks the spaces again, with the spinner first, and opens the open space again | The same, and in a state with no spaces to ask for (not set up, no account, a lost link) it asks whose account it is again | P · U · E |

## Where the new app is deliberately not the classic page

Each of these was found by holding the new screens to the classic ones, and is a decision rather than a slip.

- **On a phone it works.** The classic stylesheets hide both panes at 700px and under unless they are marked `.mob-show`, which the main
  Chat does when it opens a room and Google Chat never does — so on a phone the classic Google Chat page shows nothing at all. The new
  screen shows one pane at a time, the list or the open space (or the card, where there is one), and the open space has a back button.
  The parity suite marks the classic page the way the main Chat marks its own, and holds the new screen to that.
- **The open space is marked in the list.** The classic page takes the mark off every row when a space is opened and never puts it on the
  one that was (it is put on only when the list is drawn again). The new screen marks it; the suite compares it to a classic row marked as
  the page's own list would mark it.
- **Polling does not stop for good.** The classic page remembered the open space across visits, and so did not start asking for its
  messages again when the person came back to the page after being away. The new screen asks every twenty seconds for as long as the
  conversation is on the page and the page is in view (the clock stops while the page is out of view, so a person who comes back after
  longer than a tick is asked for at once: what they find is never more than a tick old, as on the classic page), and every visit starts
  with the spaces (nothing is kept for the next visit).
- **A member without the right to see Chat is told so.** The classic team page read the refusal as "not set up" and showed the variable to
  set. The new one says "Google Chat is not switched on for you. Ask your admin." A status that cannot be had at all is "Google Chat
  unavailable", with the server's words.
- **Words, not codes.** Where Google gave no words for a message it would not give, the classic card showed the server's bare word
  ("reconnect", "failed"). The new one says it. A refusal to send is put into words too ("There is nothing to send."), and `alert()`
  is a message at the foot of the screen.
- **The reader is not taken away from what they are reading.** The classic page scrolled the messages to the foot every twenty seconds,
  wherever the reader had scrolled to. The new one keeps the foot in view when the conversation opens, after the person sends, and when
  something new comes while the reader is at the foot; a reader who has scrolled up is left there.
- **A message is sent once.** The classic box could send the same words again while the first were still on their way (Enter pressed
  twice), and sent on an Enter that finished a word being composed. The new one holds while a message goes and waits for the word to end.
- **A first letter is a whole letter.** The circle takes the first code point of a word, not half of one (an emoji at the start of a
  space's name drew a broken character).
- **An unreadable time is blank** (the classic page wrote "Invalid Date").

## Noticed on the server and left alone

- The classic page has no button to let go of an account, although the route exists: the only way to change which account is linked is
  to link another. (`gchat.view` is all that linking and letting go need; there is no grant of their own, as there is for Drive and Gmail.)
- Spaces beyond the first 100 and messages beyond the newest 50 are not reachable: neither route pages.
- Who wrote a message is told by comparing the name Google gave the link with the name Chat gave the message, so two people of one name
  are the same person to the page.
- A link is only found to be lost when something asks Chat: a status can say "linked" for an account Google has already revoked, and the
  first thing asked then says "reconnect". A renewal that fails for any other reason is not reported (the old token is tried).
- A grant whose scopes were never recorded reaches nothing (the page then shows the history card and the read-only line), where a
  Gmail link in the same case is let through.

## How it was checked

`tests/gchatroutes.js` holds the server's side (75 checks, and five smaller processes for what is decided when the server starts: Chat not
switched on, "true" asked for in place of 1, nothing to ask Google with, no reading asked for, and Chat's client falling back to the app's);
`apps/web/src/modules/gchat` holds the screen against a script (206 tests: the guards held to the schemas by a corpus of every wrong value
of every field, the hooks against a fake server, both screens in both portals) and `apps/web/src/lib/chat-return.test.ts` the reason Google
sends a person back with (9); `tests/gcparity.js` holds the look to the classic pages' computed style, value by value (both portals, two looks,
both modes, four widths, 18 states, 290 checks in each portal's suite and about 650,000 values in all, and the corners of a bubble, the outline
of the box and whether a list hands its scroll on to the page are read too); `tests/webgchat.js` runs it all against a real server and a real
browser (38 checks, including the round trip through Google's consent screen, a return with a reason, a link that was granted less, a phone,
and what Chat was sent). The whole serial run is 147 suites, all green.

One-line changes to the code were tried one at a time — 400 in the screen, the link hook and the return reason, 236 in the server, 245 in
the stylesheet — and each one the tests did not notice got a test, a part or a property for the parity suite to read, or a change in the
code. What the mutations found that a person would have seen:

- **a phone could be left on "Select a space" with no way back**: when the list was asked for again (Refresh) with a space open and came back
  with no spaces, the page stayed on the pane of the open space, which by then showed only its placeholder. The pane was chosen by "a
  space is open" as well as by "there is a card to show"; now only by the card, and the list says there are none;
- **the team's page lacked the classic page's `overscroll-behavior-y: contain`** (on the page, as well as on the messages): nothing read the
  property; the parity suite reads it now;
- **the pause of the poll while the page is out of view** (a deliberate difference, above) left a person who came back looking at messages as old
  as their absence: the messages are now asked for at once on return after longer than a tick;
- **two tests that could not fail**: the real-browser suite's "on a desktop the back button is not drawn" looked at a conversation that had been
  closed, so there was no button to see (it re-opens one first now), and a screen test of the list's loader read the page before the spaces were on
  their way, which is the loader of something else.

The server's suite also learned what it had not held: the shape of a space's address in both directions (a `-` and a `_` are in it, a dot and a
missing slash are not), a token that is about to run out, one whose expiry was never recorded and one whose renewal came without a lifetime
(an hour is taken), that a link Google has refused is not written to the table as lost (a restart tries again), that a consent that says nothing
of its scope is a link that reaches nothing, that Google's words survive the trip through the address whole, that a message of a card has no words
of its own, and the content type Chat is sent.

What the mutations showed to be dead was taken out: the title a space was given when it was not in the list (the row that was pressed is passed
on instead), a word nothing used, the re-throw of a call that was taken back (a query throws away what becomes of a cancelled call), and two of
the three things the effect that keeps the foot of a conversation in view waited for (the last message's address changes whenever either would).

The ones left are equivalent, and are named here so that they are not mistaken for gaps:

- the check that a thing is not an array before its fields are read (an array has none of them), the guard on an empty time (the next line
  catches it), and `minute: '2-digit'` against `'numeric'` (with an hour shown, the minutes are two digits anyway);
- `retry: false` on the queries that read the spaces and the messages (they never fail: a call that did not go is an answer, "Chat could not be
  reached"), and the `result` of a messages query with no space (it is off, so it has nothing);
- the two names of one picture (`unavailable` and `failed` are both the alert circle, `unconfigured` and `noAccess` are both the plug — the names
  keep the uses apart, and swapping them changes nothing until the pictures differ), the sentence for a link with no words (a failed status always
  has some), and the two halves of "the spaces have not come" and of "the messages have not come" (each is true exactly when the other is);
- in the server: the guard on a link that is not there in the code that says what it reaches (it is only called with one), the Map entry a let-go
  link leaves (null, where it could have none: nothing reads it but by its key), `undefined` and `null` for "no token", the headers a caller could
  add to a call to Chat (none does), the order of two checks that cannot both be true, the `|| ''` of an address that is not there (the word
  "undefined" is not an address either), an unencoded space in a query that the URL encodes, and the address a consent returns to when none was
  asked for (both audiences ask for one);
- in the stylesheet: the `display` of the circle's wrapper (a flex item is a block), the safe-area inset of the team's phone height (it is 0 in
  the test browser, so only the rest of the expression can be held), the centring of the arrow in the way back (the button is exactly as high as
  its arrow), and a textarea's `overflow-y: visible` (the browser takes it for `auto`).
