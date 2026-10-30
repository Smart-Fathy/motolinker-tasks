# src/modules

The server's new feature modules: one folder per feature, each the same three files.

```
src/modules/<id>/
  service.js   the rules. Takes its dependencies (the database, a clock, …) as arguments — never `ctx`, never a request —
               and knows who is asking only as an actor (`actor.key` is 'admin' or 'employee_<id>', the value rows are filed
               under). It says when something could not be done; what to tell the caller is the route's business.
  routes.js    HTTP. `mount<Feature>({ v1, service, json })` registers `/api/v1/...` routes through `v1()` (which puts
               `requireActor` and `requireCan` in front), checks a body against the schema in `@motolinker/contracts`, and
               answers in the one error shape, `{ error, code, issues? }` (`src/http/errors.js`). A database's own message
               is logged, never returned.
  index.js     what the rest of the server may import.
```

A resource the two classic portals each had a route for becomes one service, and the classic routes become thin
adapters over it that answer exactly what they always answered (`src/routes/notif-streams.js` is the example; `src/routes/submissions.js`, `src/routes/meetings.js`, `src/routes/calendar-feed.js` and the Issues routes in `index.js` are the others). Before
that move, `tests/<id>.js` records what the classic routes do — rows, order, queries, what a failing database
answers — and it must pass unchanged after it. `/api/v1` is stricter than the classic routes were (a body that is not
what the contract says is a 400, a database that is down is a 503), because the new app needs to tell "nothing" from
"could not ask".

Two of the modules show how far this goes. `meetings` does work behind its answer: the service returns `{ meeting, behind }`,
the route answers and then starts `behind()` (the Google Calendar writes and the notifications), so scheduling never waits for
Google and a test can wait for it. `calendar` has one method, `feed(actor, query, { strict })`: the classic routes ask leniently
(a source the database cannot read is an empty source, as ever), `/api/v1` asks strictly and says which source could not be read.

This code is type-checked through JSDoc (`tsc -p src/modules`), linted and formatted with the rest of the new code;
`tests/actor.js` crosses every route here with every kind of actor.
