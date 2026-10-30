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
  ApiError,
};
