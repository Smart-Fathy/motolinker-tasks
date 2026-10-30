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

// What /api/v1 answers when it says no: words for a person, a word for a program, and what was wrong with the request.
const ApiError = z.object({
  error: z.string(),
  code: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

module.exports = {
  Scope,
  CapList,
  MeResponse,
  NotificationId,
  Notification,
  NotificationList,
  NotificationReadBody,
  NotificationReadResult,
  ApiError,
};
