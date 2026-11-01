// What My Email is made of, apart from how it is drawn: how the server's answers are recognised, how a sender, a date and a reply are
// written, where the routes are, and the words. The classic portals carry these twice (public/assets/dashboard.js and employee.js,
// "Email"); the routes behind them are the server's own, one set for each portal (tests/emailroutes.js).
import type { Portal } from '../../lib/env';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const optionalText = (v: unknown) => v === undefined || typeof v === 'string';

// ── The link ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What GET …/email/status says (packages/contracts: schemas.GmailStatus): no Google project here, none linked, or linked. */
export type GmailStatus =
  | { configured: false }
  | { configured: true; connected: false }
  | { configured: true; connected: true; email?: string; name?: string; canSend: boolean };

export function isGmailStatus(v: unknown): v is GmailStatus {
  if (!isObject(v)) return false;
  if (v['configured'] === false) return true;
  if (v['configured'] !== true) return false;
  if (v['connected'] === false) return true;
  return (
    v['connected'] === true &&
    typeof v['canSend'] === 'boolean' &&
    optionalText(v['email']) &&
    optionalText(v['name'])
  );
}

/** …as the page tells it: there is no Google project, there is a project and no link, or there is a link and whose it is. */
export type MailLink =
  | { state: 'unconfigured' }
  | { state: 'unlinked' }
  | {
      state: 'linked';
      email: string;
      name: string;
      /** false: the link was made before sending was asked for, and a reply or a new email will fail until it is made again */
      canSend: boolean;
    };

export function mailLinkOf(s: GmailStatus): MailLink {
  if (!s.configured) return { state: 'unconfigured' };
  if (!s.connected) return { state: 'unlinked' };
  return { state: 'linked', email: s.email ?? '', name: s.name ?? '', canSend: s.canSend };
}

// ── The messages ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A line of the inbox (schemas.GmailMessageSummary): the sender and subject as the message wrote them, its date, a snippet, and whether it is unread. */
export interface MailSummary {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export function isMailSummary(v: unknown): v is MailSummary {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    typeof v['subject'] === 'string' &&
    typeof v['from'] === 'string' &&
    typeof v['date'] === 'string' &&
    typeof v['snippet'] === 'string' &&
    typeof v['unread'] === 'boolean'
  );
}

export const isMailList = (v: unknown): v is MailSummary[] =>
  Array.isArray(v) && v.every(isMailSummary);

/**
 * A message opened (schemas.GmailMessage). Gmail not finding it is not an error to the route: it answers a message with nothing in
 * it, no id and no thread — so those two may be missing.
 */
export interface MailMessage {
  id?: string;
  threadId?: string;
  labelIds: string[];
  subject: string;
  from: string;
  to: string;
  date: string;
  /** the message's own Message-ID header, which a reply names as what it answers */
  messageId: string;
  body: string;
  /** the body is a page of HTML (shown in a frame that runs nothing) rather than text */
  isHtml: boolean;
}

export function isMailMessage(v: unknown): v is MailMessage {
  return (
    isObject(v) &&
    optionalText(v['id']) &&
    optionalText(v['threadId']) &&
    Array.isArray(v['labelIds']) &&
    v['labelIds'].every(l => typeof l === 'string') &&
    typeof v['subject'] === 'string' &&
    typeof v['from'] === 'string' &&
    typeof v['to'] === 'string' &&
    typeof v['date'] === 'string' &&
    typeof v['messageId'] === 'string' &&
    typeof v['body'] === 'string' &&
    typeof v['isHtml'] === 'boolean'
  );
}

/** What POST …/email/send answers when it went (schemas.GmailSent). */
export const isMailSent = (v: unknown): boolean =>
  isObject(v) && v['ok'] === true && optionalText(v['id']);

// ── How a message is written ────────────────────────────────────────────────────────────────────────────────────────

/** The sender as the list writes them: what stands before the address, or all of it where nothing does. */
export const senderOf = (from: string): string => from.replace(/<.*>/, '').trim() || from;

/** …and the address alone: what is between the brackets, or all of it. */
export const addressOf = (from: string): string => /<(.+)>/.exec(from)?.[1] || from;

/** The subject a reply is given: the original's, once "Re:" has been put in front of it (and not again where it already is). */
export const replySubjectOf = (subject: string): string =>
  subject.startsWith('Re:') ? subject : 'Re: ' + subject;

const dateOf = (text: string): Date | null => {
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The date at the right of a line of the inbox, in the reader's own way of writing one: the admin's page writes the whole day, the
 * team's the month and the day. Nothing where the message gave no date that can be read (the classic pages wrote "Invalid Date").
 */
export function listDateOf(date: string, portal: Portal): string {
  const d = dateOf(date);
  if (!d) return '';
  return portal === 'team'
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleDateString();
}

/** The date in the head of a message: the admin's page writes the day and the time as the reader writes them, the team's the header as it came. */
export function detailDateOf(date: string, portal: Portal): string {
  if (portal === 'team') return date;
  const d = dateOf(date);
  return d ? d.toLocaleString() : '';
}

// ── What is sent ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SendBody {
  to: string;
  subject: string;
  body: string;
  /** the conversation a reply belongs to, and the message it answers */
  threadId?: string;
  inReplyTo?: string;
}

/** What goes to the server: the three things every email has, and the two a reply adds where there are some. */
export function sendBodyOf(
  fields: { to: string; subject: string; body: string },
  reply: { threadId?: string | undefined; messageId?: string | undefined } = {},
): SendBody {
  return {
    to: fields.to,
    subject: fields.subject,
    body: fields.body,
    ...(reply.threadId ? { threadId: reply.threadId } : {}),
    ...(reply.messageId ? { inReplyTo: reply.messageId } : {}),
  };
}

// ── Where the routes are ───────────────────────────────────────────────────────────────────────────────────────────

export interface Routes {
  status: string;
  connect: string;
  disconnect: string;
  messages: string;
  message: (id: string) => string;
  send: string;
  /** a question that is answered if the person is still signed in, and by nothing else (the team's page asks it before it leaves) */
  check: string | null;
}

/** The administrator's routes are not under /api/dashboard (they are Gmail's own); the team's are under /api/employee/email. */
export function routesOf(portal: Portal): Routes {
  const base = portal === 'admin' ? '/api/email' : '/api/employee/email';
  return {
    status: base + '/status',
    connect: base + '/connect',
    disconnect: base + '/disconnect',
    messages: base + '/messages',
    message: id => base + '/messages/' + encodeURIComponent(id),
    send: base + '/send',
    check: portal === 'admin' ? null : '/api/employee/check',
  };
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SAID = {
  /** the screen's name (the card of a member who has the screen without the right to see the mail is headed with it) */
  title: 'My Email',
  /** the admin's loader while the link is asked for, and the team's */
  checking: 'Checking Gmail…',
  loadingTeam: 'Loading email…',
  loadingMessages: 'Loading messages…',
  loadingOne: 'Loading…',

  connect: 'Connect Gmail',
  disconnect: 'Disconnect',
  /** no Google project here: the admin's card names what to add; the team's is lines of text */
  adminUnconfiguredTitle: 'Connect Gmail',
  adminUnconfigured: 'Add these env vars in Railway then redeploy:',
  adminEnv: 'GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\nAPP_URL=https://your-app.railway.app',
  teamUnconfiguredTitle: 'Email not configured',
  teamUnconfigured: 'Google OAuth is not set up. Contact your admin.',
  /** a project and no account */
  unlinkedTitle: 'Connect Your Gmail',
  adminUnlinked: 'Sign in with Google to view your inbox in this dashboard.',
  teamUnlinked: 'Connect your Google account to access your personal inbox.',
  /** …and to a member who may read the mail and not link an account */
  teamUnlinkedLocked: 'No Google account is linked. Ask your admin to link one for you.',
  /** the status is out of reach of a member who has the screen without the right to see the mail */
  noAccess: 'Gmail is not switched on for you. Ask your admin.',
  unreadable: 'Gmail could not be read.',
  strange: 'Gmail came back in a form this app does not know.',
  /** a message that Gmail did not give (the route answers it as a message with nothing in it) */
  gone: 'Gmail did not give this message. It may have been moved or deleted.',
  strangeSend:
    'Gmail answered in a form this app does not know, so it is not known whether the email went.',

  inbox: 'Inbox',
  refresh: 'Refresh',
  compose: 'Compose',
  adminNone: 'No messages',
  teamNone: 'No messages in inbox',
  select: 'Select an email to read it',
  back: '← Back',
  teamBack: 'Back',
  noSubject: '(no subject)',
  empty: '(empty)',
  from: 'From:',
  to: 'To:',
  date: 'Date:',
  reply: 'Reply',
  forward: 'Forward',

  /** the administrator's sheet for a new email or a reply */
  newEmail: 'New Email',
  replyTitle: 'Reply',
  labelTo: 'To *',
  labelSubject: 'Subject *',
  labelMessage: 'Message *',
  placeholderTo: 'recipient@example.com',
  placeholderSubject: 'Subject…',
  placeholderMessage: 'Write your message…',
  cancel: 'Cancel',
  send: 'Send',
  sending: 'Sending…',
  required: 'To, subject and message are required',
  sentAdmin: 'Email sent successfully!',
  failedAdmin: 'Failed to send: ',

  /** the team's reply, under the message */
  placeholderReply: 'Write your reply…',
  sendReply: 'Send Reply',
  sent: 'Sent!',
  failedTeam: 'Error: ',

  /** a link made before sending was asked for, round the word that makes it again */
  reconnectBeforeAdmin:
    'This connection was authorised before sending was supported, so Compose and Reply will fail. ',
  reconnectBeforeTeam:
    'This connection was authorised before sending was supported, so replies will fail. ',
  reconnectAfter: ' to fix it.',
  reconnectLocked: 'Ask your admin to reconnect it.',
} as const;
