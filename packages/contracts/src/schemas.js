'use strict';
// What goes over the wire, as schemas: the server validates against them and the web app takes its
// types from them. One place, so the two cannot drift.

const { z } = require('zod');

const Scope = z.object({
  assignedOnly: z.boolean(),
  dealStages: z.array(z.string()),
  leadStatuses: z.array(z.string()),
});

const CapList = z.union([z.literal('*'), z.array(z.string())]);

// What an employee keeps about themselves, and the account menu shows and changes: the name they sign in with, their picture
// (a URL, or empty), and a status. The administrator has none of it — there is no account to keep it on.
const Profile = z.object({
  username: z.string(),
  avatarUrl: z.string(),
  statusText: z.string(),
  statusEmoji: z.string(),
});

// GET /api/v1/me — who is asking, and everything the app needs to draw itself for them.
const MeResponse = z.object({
  actor: z.object({
    kind: z.enum(['admin', 'employee']),
    id: z.number().int().nullable(),
    key: z.string(),
    name: z.string(),
    jobTitle: z.string(),
  }),
  caps: CapList,
  sections: CapList,
  scope: Scope,
  // an employee's own; the administrator's answer has none
  profile: Profile.optional(),
  workspace: z.object({
    name: z.string(),
    logo_url: z.string(),
    updated_at: z.string().nullable(),
    // true when the database could not be asked: the name is the default, not the real one
    degraded: z.boolean().optional(),
  }),
  // What the server knows about this installation that changes what the app draws; `gchat`: Google Chat is set up.
  flags: z.record(z.string(), z.boolean()),
});

// A notification, as the bell and the Notification Center list it — and as the live stream's `notification` event carries
// it (that row has also the member it belongs to, which this leaves out). Its id is a number for a stored one and a
// string ('tmp-…') for one that could not be stored and was only shown live.
const NotificationId = z.union([z.number().int(), z.string().min(1)]);
const Notification = z.object({
  id: NotificationId,
  // task | request | reminder | submission | lead | deal | hours | issue | followup | huddle | security | general …
  type: z.string(),
  title: z.string(),
  body: z.string(),
  // where it leads: '/dashboard#requests', '/employee#requests', or nothing
  url: z.string(),
  read: z.boolean(),
  created_at: z.string(),
});

// GET /api/v1/notifications — the newest fifty, newest first, and how many of those are unread.
const NotificationList = z.object({
  items: z.array(Notification),
  unread: z.number().int().nonnegative(),
});

// POST /api/v1/notifications/read — one notification, or all of them; nothing else is a request.
const NotificationReadBody = z.union(
  [z.strictObject({ id: NotificationId }), z.strictObject({ all: z.literal(true) })],
  { error: 'Send { id } to mark one notification read, or { all: true } to mark every one.' },
);
const NotificationReadResult = z.object({ ok: z.literal(true) });

// A website submission: what the public form sent, and the name of the lead it was matched to (or made). Nobody writes one
// here — the website does — so there is nothing to create or edit.
const Submission = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  message: z.string(),
  car_interest: z.string(),
  source: z.string(),
  // the lead it belongs to, when it has one; `lead_name` is that lead's name, or empty
  customer_id: z.number().int().nullable(),
  lead_name: z.string(),
  created_at: z.string(),
});

// GET /api/v1/submissions — the newest two hundred, newest first.
const SubmissionList = z.object({ items: z.array(Submission) });

// DELETE /api/v1/submissions/:id — gone (or already was).
const SubmissionDeleteResult = z.object({ ok: z.literal(true) });

// A ticket in the Issues centre: reported by a team member, read and closed by the people who manage the centre. A status that
// is not "resolved" is "open"; who closed it and when are empty/null until it is closed (and again when it is reopened).
const IssueStatus = z.enum(['open', 'resolved']);
const Issue = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  // the attachment's address, or empty
  file_url: z.string(),
  // the person who reported it, when there is one on record
  reporter_id: z.number().int().nullable(),
  reporter_name: z.string(),
  status: IssueStatus,
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  resolved_by: z.string(),
});

// GET /api/v1/issues — the newest two hundred, newest first.
const IssueList = z.object({ items: z.array(Issue) });

// PATCH /api/v1/issues/:id — close a ticket or reopen it; nothing else about a ticket changes.
const IssueStatusBody = z.strictObject({ status: IssueStatus });

// A reply on a ticket. `author_key` is 'admin' or 'employee_<id>'.
const IssueComment = z.object({
  id: z.number().int(),
  issue_id: z.number().int(),
  author_key: z.string(),
  author_name: z.string(),
  body: z.string(),
  file_url: z.string(),
  file_name: z.string(),
  file_size: z.number().int().nonnegative().nullable(),
  file_type: z.string(),
  created_at: z.string(),
});

// GET /api/v1/issues/:id/comments — oldest first.
const IssueCommentList = z.object({ items: z.array(IssueComment) });

// POST /api/v1/issues/:id/comments — words, a file the app stored, or both.
const IssueCommentBody = z
  .strictObject({
    body: z.string().max(2000).optional(),
    file_url: z.string().max(2048).optional(),
    file_name: z.string().max(200).optional(),
    file_size: z.number().int().nonnegative().nullable().optional(),
    file_type: z.string().max(100).optional(),
  })
  .refine(b => !!((b.body && b.body.trim()) || b.file_url), {
    error: 'Write a reply, or attach a file.',
    path: ['body'],
  });

// POST /api/v1/issues (multipart: these two fields, and `file` if there is one) — a summary or details, either.
const IssueReportBody = z
  .object({ title: z.string().max(150), description: z.string().max(2000) })
  .refine(b => !!(b.title.trim() || b.description.trim()), {
    error: 'Describe the problem: a summary, or the details.',
    path: ['description'],
  });
const IssueReportResult = z.object({ ok: z.literal(true), file: z.string() });

// A scheduled meeting: when, for how long, who is in it, and where it happens. `meet_link` is where to join — empty (Google makes a
// Meet link when the meeting is written to the calendar), a web address, or `huddle:<room>` for an in-app huddle. The server keeps
// the Google event ids to itself.
const Meeting = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  // an instant, as ISO 8601
  starts_at: z.string(),
  duration_min: z.number().int(),
  // employee ids, as text
  attendee_ids: z.array(z.string()),
  meet_link: z.string(),
  // 'admin' or 'employee_<id>'
  created_by: z.string(),
  created_at: z.string(),
});

// GET /api/v1/meetings — the upcoming meetings and the recent past, soonest first, a hundred at most.
const MeetingList = z.object({ items: z.array(Meeting) });

// POST /api/v1/meetings, PUT /api/v1/meetings/:id — a title and a start; the length is 5 to 480 minutes (30 when it is left out).
const MeetingBody = z.strictObject({
  title: z.string().trim().min(1, { error: 'Title is required' }).max(200),
  starts_at: z.iso.datetime({ offset: true, error: 'A valid start time is required' }),
  duration_min: z.number().int().min(5).max(480).optional(),
  attendee_ids: z
    .array(z.string().regex(/^\d{1,18}$/, { error: 'An attendee is an employee id' }))
    .max(200)
    .optional(),
  meet_link: z.string().trim().max(2048).optional(),
  description: z.string().max(2000).optional(),
});

// DELETE /api/v1/meetings/:id — cancelled (or already was).
const MeetingDeleteResult = z.object({ ok: z.literal(true) });

// GET /api/v1/calendar?from=&to= — what a person is expected at around two days (a day wider each side, so a month grid's
// loose ends are filled): the tasks due, the meetings they are in, the lead follow-ups they promised. Without a window it is now,
// for a month. The window's ends are days (YYYY-MM-DD) or instants.
const CalendarDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const CalendarQuery = z.object({ from: CalendarDate.optional(), to: CalendarDate.optional() });

const CalendarTask = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  // the day it is due, YYYY-MM-DD
  due_date: z.string(),
  status: z.string(),
  priority: z.string(),
  milestone: z.string(),
  // employee ids, as text
  assignee_ids: z.array(z.string()),
  channel_name: z.string(),
});

const CalendarFollowup = z.object({
  id: z.number().int(),
  // an instant, as ISO 8601
  due_at: z.string(),
  note: z.string(),
  customer_id: z.number().int(),
  // the lead's name; empty when the lead is gone
  customer_name: z.string(),
});

const CalendarFeed = z.object({
  // the first and last day asked of the database: the window a day wider each side
  from: z.string(),
  to: z.string(),
  tasks: z.array(CalendarTask),
  meetings: z.array(Meeting),
  followups: z.array(CalendarFollowup),
});

// ── Account security (GET/POST /api/employee/security…, and the same under /api/dashboard) ─────────────────────────────────
// One handler serves both portals, so these are the answers of both. A wrong password or code is a 403 — never a 401, which
// the portals read as "your session ended" — and too many tries is a 429 with the wait in `Retry-After`.

// A device the account is signed in on. The timestamps are milliseconds since 1970, or null where the session predates them.
const SecuritySession = z.object({
  // what names the session in a sign-out request (not the token)
  sid: z.string(),
  device: z.string(),
  ip: z.string(),
  createdAt: z.number().nullable(),
  lastSeenAt: z.number().nullable(),
  // password | google | password+2fa | google+2fa | password+recovery | google+recovery, or empty
  method: z.string(),
  // the device asking
  current: z.boolean(),
});

// A line of the sign-in history. Where the browser said nothing, there is nothing: the panel says "Unknown device".
const SecurityLogin = z.object({
  at: z.string(),
  event: z.string(),
  device: z.string().nullable(),
  ip: z.string().nullable(),
  method: z.string().nullable(),
  new_device: z.boolean(),
});

// GET …/security — everything the panel shows. `twofa.available` is false while the database cannot hold a second factor:
// `reason` 'migration' (its table was never made) or 'error' (the database did not answer); `history` is false for the same
// reason of the sign-in record. `alerts` is what the server does about a sign-in from a device it has not seen.
const SecurityOverview = z.object({
  account: z.object({
    kind: z.enum(['admin', 'employee']),
    name: z.string(),
    canChangePassword: z.boolean(),
  }),
  twofa: z.object({
    available: z.boolean(),
    reason: z.enum(['error', 'migration']).nullable(),
    enabled: z.boolean(),
    enabledAt: z.string().nullable(),
    recoveryLeft: z.number().int().nonnegative(),
    // false: the secrets are stored as they are, for want of MFA_ENCRYPTION_KEY
    encrypted: z.boolean(),
  }),
  sessions: z.array(SecuritySession),
  logins: z.array(SecurityLogin),
  history: z.boolean(),
  alerts: z.enum(['new', 'all', 'off']),
});

// POST …/security/2fa/setup — what the authenticator is given: the key, the link that opens it, and the same as a picture
// (a data: URL).
const SecuritySetup = z.object({
  secret: z.string(),
  otpauth: z.string(),
  qr: z.string(),
});

// POST …/security/2fa/enable — the factor is on, the other devices are signed out, and these are the only time the recovery
// codes are shown.
const SecurityEnabled = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()),
  sessionsRevoked: z.number().int().nonnegative(),
});

// POST …/security/2fa/disable
const SecurityDisabled = z.object({
  ok: z.literal(true),
  sessionsRevoked: z.number().int().nonnegative(),
});

// POST …/security/2fa/recovery-codes — new codes; the old ones no longer work.
const SecurityNewCodes = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()),
});

// POST …/security/sessions/revoke-others. `ok` is false (with a `warning`) where some sign-outs could not be saved.
const SecurityRevoked = z.object({
  ok: z.boolean(),
  sessionsRevoked: z.number().int().nonnegative(),
  warning: z.string().optional(),
});

// ── An employee's own account (the team portal's account menu) ─────────────────────────────────────────────────────────────
// PUT /api/employee/status — the answer is what is now stored (it is trimmed, and cut to 100 and 8 characters).
const StatusBody = z.object({ text: z.string(), emoji: z.string() });
const StatusResult = z.object({ status_text: z.string(), status_emoji: z.string() });

// POST /api/employee/avatar — a multipart form with an image (up to 5 MB) in `file`.
const AvatarResult = z.object({ avatar_url: z.string() });

// PUT /api/employee/username — 3 to 32 of letters, numbers, dots, dashes and underscores; taken names are a 409.
const UsernameBody = z.object({ username: z.string() });
const UsernameResult = z.object({ ok: z.literal(true), username: z.string() });

// POST /api/employee/change-password — the other devices are signed out; `warning` where some of them could not be.
const ChangePasswordBody = z.object({ currentPassword: z.string(), newPassword: z.string() });
const ChangePasswordResult = z.object({
  ok: z.literal(true),
  sessionsRevoked: z.number().int().nonnegative(),
  warning: z.string().optional(),
});

// ── Suppliers (both portals' own routes: …/suppliers, …/supplier-vehicles, …/columns/:entity; one handler each) ───────────────
// What the register keeps about a supplier, and what hangs off it. Text columns have a default of '' in the database, so they
// are strings; they are said to be possibly null because a row that was written some other way may have none. `custom_fields`
// carries the fields an administrator added to the register's columns (and is absent where migration 009 was never applied).
const CustomFields = z.record(z.string(), z.unknown()).nullable().optional();

const Supplier = z.object({
  id: z.number().int(),
  name: z.string(),
  contact: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  notes: z.string().nullable(),
  custom_fields: CustomFields,
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
const SupplierList = z.array(Supplier);

// POST / PUT …/suppliers — the name is required (a 400 without it); the others are trimmed.
const SupplierBody = z.object({
  name: z.string(),
  contact: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

// What a supplier offers: a vehicle with a quoted price and lead time. `fob_price` and `model_year` are numbers or nothing.
const SupplierVehicle = z.object({
  id: z.number().int(),
  supplier_id: z.number().int(),
  brand: z.string(),
  model: z.string(),
  trim: z.string().nullable(),
  model_year: z.number().int().nullable(),
  availability: z.string().nullable(),
  fob_price: z.number().nullable(),
  currency: z.string(),
  lead_time: z.string().nullable(),
  accessories: z.string().nullable(),
  notes: z.string().nullable(),
  custom_fields: CustomFields,
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
const SupplierVehicleList = z.array(SupplierVehicle);
// GET …/supplier-vehicles — every vehicle any supplier offers, with the supplier's name beside it (the pickers of the RFQ and
// purchase-order lines read it, and the register counts it).
const SupplierOffer = SupplierVehicle.extend({ supplier_name: z.string() });
const SupplierOfferList = z.array(SupplierOffer);

// POST / PUT …/suppliers/:id/vehicles — brand or model is required (a 400 without either); a price or a year may be typed as text.
const SupplierVehicleBody = z.object({
  brand: z.string().optional(),
  model: z.string().optional(),
  trim: z.string().optional(),
  model_year: z.union([z.string(), z.number()]).optional(),
  availability: z.string().optional(),
  fob_price: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  lead_time: z.string().optional(),
  accessories: z.string().optional(),
  notes: z.string().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

// A supplier's paperwork: the file is in Google Drive, the row says where.
const SupplierDoc = z.object({
  id: z.number().int(),
  supplier_id: z.number().int(),
  name: z.string(),
  drive_file_id: z.string().nullable(),
  web_link: z.string().nullable(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  uploaded_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
const SupplierDocList = z.array(SupplierDoc);

// GET …/suppliers/:id/purchases — what was actually bought from a supplier, worked out from the stock units and the purchase
// orders pointed at them (never typed in): the cars received, the lines ordered, and the figures over both.
const SupplierPurchases = z.object({
  units: z.array(
    z.object({
      stock_id: z.number().int(),
      make: z.string().nullable(),
      model: z.string().nullable(),
      trim: z.string().nullable(),
      vin: z.string(),
      colour: z.string(),
      status: z.string(),
      price: z.number(),
    }),
  ),
  poLines: z.array(
    z.object({
      po_id: z.number().int(),
      po_number: z.string().nullable(),
      po_date: z.string().nullable(),
      currency: z.string().nullable(),
      brand: z.string(),
      model: z.string(),
      trim: z.string(),
      qty: z.number(),
      price: z.number(),
      lead_time: z.string(),
    }),
  ),
  totals: z.object({
    vehicles: z.number().int(),
    ordered: z.number(),
    avg_unit_price: z.number(),
    avg_po_price: z.number(),
    lead_times: z.array(z.string()),
  }),
});

// ── The column engine's configuration (GET / PUT …/columns/:entity) ──────────────────────────────────────────────────────────
// Which fields a table or form has, in what order, of what type: one list per entity (`suppliers`, `supplier_vehicles`,
// `rfq_items`, `po_doc`, `stock`, `leads`, …), kept in the quotation settings. The server cleans it on the way in and on the
// way out, so what is read is always this shape: a column with an unknown type is text, a key with a quote or an angle
// bracket in it is dropped, an option's colour is #rrggbb or nothing. `columns` is null where nothing was ever saved: the
// screen's own built-in columns stand.
const ColumnOption = z.object({
  key: z.string(),
  label: z.string(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .optional(),
});
const Column = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'date', 'link', 'select', 'radio', 'checkbox', 'virtual']),
  // a column the screen has of its own (and cannot lose, only hide or soft-delete), against one somebody added (`cf_…`)
  builtin: z.boolean(),
  visible: z.boolean(),
  deleted: z.literal(true).optional(),
  required: z.literal(true).optional(),
  width: z.number().int().min(40).max(800).optional(),
  options: z.array(ColumnOption).optional(),
});
const ColumnsResponse = z.object({ columns: z.array(Column).nullable(), entity: z.string() });
const ColumnsBody = z.object({ columns: z.array(z.unknown()) });
const ColumnsSaved = z.object({ ok: z.literal(true), columns: z.array(Column) });

// What /api/v1 answers when it says no: words for a person, a word for a program, and what was wrong with the request.
const ApiError = z.object({
  error: z.string(),
  code: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

module.exports = {
  Scope,
  CapList,
  Profile,
  MeResponse,
  NotificationId,
  Notification,
  NotificationList,
  NotificationReadBody,
  NotificationReadResult,
  Submission,
  SubmissionList,
  SubmissionDeleteResult,
  IssueStatus,
  Issue,
  IssueList,
  IssueStatusBody,
  IssueComment,
  IssueCommentList,
  IssueCommentBody,
  IssueReportBody,
  IssueReportResult,
  Meeting,
  MeetingList,
  MeetingBody,
  MeetingDeleteResult,
  CalendarQuery,
  CalendarTask,
  CalendarFollowup,
  CalendarFeed,
  SecuritySession,
  SecurityLogin,
  SecurityOverview,
  SecuritySetup,
  SecurityEnabled,
  SecurityDisabled,
  SecurityNewCodes,
  SecurityRevoked,
  StatusBody,
  StatusResult,
  AvatarResult,
  UsernameBody,
  UsernameResult,
  ChangePasswordBody,
  ChangePasswordResult,
  Supplier,
  SupplierList,
  SupplierBody,
  SupplierVehicle,
  SupplierVehicleList,
  SupplierOffer,
  SupplierOfferList,
  SupplierVehicleBody,
  SupplierDoc,
  SupplierDocList,
  SupplierPurchases,
  ColumnOption,
  Column,
  ColumnsResponse,
  ColumnsBody,
  ColumnsSaved,
  ApiError,
};
