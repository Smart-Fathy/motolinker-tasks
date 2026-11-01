// What Google Chat is made of, apart from how it is drawn: how the server's answers are recognised, how a space, a message and its time are
// written, where the routes are, and the words. The classic portals carry these twice (public/assets/dashboard.js and employee.js, "Google
// Chat panel"); the routes behind them are the server's own, one set mounted for each portal (tests/gchatroutes.js).
import type { Portal } from '../../lib/env';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const optionalText = (v: unknown) => v === undefined || typeof v === 'string';

// ── The link ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a link reaches: the grant Google gave, which can be less than was asked for (a person may untick boxes on its consent screen). */
export interface ChatCaps {
  spaces: boolean;
  read: boolean;
  send: boolean;
}

const isCaps = (v: unknown): v is ChatCaps =>
  isObject(v) &&
  typeof v['spaces'] === 'boolean' &&
  typeof v['read'] === 'boolean' &&
  typeof v['send'] === 'boolean';

/** What GET …/gchat/status says (packages/contracts: schemas.GchatStatus): not set up here, no link (or one that was lost), or a link. */
export type GchatStatus =
  | { configured: false }
  | { configured: true; connected: false; reconnect?: true; email?: string }
  | { configured: true; connected: true; email?: string; name?: string; caps: ChatCaps };

export function isGchatStatus(v: unknown): v is GchatStatus {
  if (!isObject(v)) return false;
  if (v['configured'] === false) return true;
  if (v['configured'] !== true) return false;
  if (v['connected'] === false)
    return (v['reconnect'] === undefined || v['reconnect'] === true) && optionalText(v['email']);
  return (
    v['connected'] === true &&
    optionalText(v['email']) &&
    optionalText(v['name']) &&
    isCaps(v['caps'])
  );
}

/** …as the page tells it: Chat is not set up here, there is no link, the link was lost (Google no longer honours it), or there is one. */
export type ChatLink =
  | { state: 'unconfigured' }
  | { state: 'unlinked' }
  | { state: 'lost'; email: string }
  | { state: 'linked'; email: string; name: string; caps: ChatCaps };

export function chatLinkOf(s: GchatStatus): ChatLink {
  if (!s.configured) return { state: 'unconfigured' };
  if (!s.connected) {
    // (a link is only found to be lost when something asks Chat, so a status that says so is the first to)
    return s.reconnect === true ? { state: 'lost', email: s.email ?? '' } : { state: 'unlinked' };
  }
  return { state: 'linked', email: s.email ?? '', name: s.name ?? '', caps: s.caps };
}

// ── The spaces ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A space as the server renames what Chat lists (schemas.GchatSpace): its address, what to call it, and Chat's word for the kind. */
export interface Space {
  name: string;
  title: string;
  type: string;
}

const isSpace = (v: unknown): v is Space =>
  isObject(v) &&
  typeof v['name'] === 'string' &&
  typeof v['title'] === 'string' &&
  typeof v['type'] === 'string';

/** What GET …/gchat/spaces says (schemas.GchatSpaceList): the spaces, or none and the reason beside them (and Google's words, if it gave some). */
export interface SpaceList {
  spaces: Space[];
  error?: string;
  detail?: string;
}

export const isSpaceList = (v: unknown): v is SpaceList =>
  isObject(v) &&
  Array.isArray(v['spaces']) &&
  v['spaces'].every(isSpace) &&
  optionalText(v['error']) &&
  optionalText(v['detail']);

/** Why Chat could not be asked, as far as the page tells it apart: it will not (forbidden), the link is no good (reconnect), or anything else. */
export type SpacesFailure = 'forbidden' | 'reconnect' | 'failed';

export type Spaces = { ok: true; spaces: Space[] } | { ok: false; reason: SpacesFailure };

export function spacesOf(list: SpaceList): Spaces {
  if (!list.error) return { ok: true, spaces: list.spaces };
  if (list.error === 'forbidden') return { ok: false, reason: 'forbidden' };
  if (list.error === 'reconnect') return { ok: false, reason: 'reconnect' };
  return { ok: false, reason: 'failed' };
}

/** The picture in a space's circle: the first letter of each of its first two words (a letter, not half of one). */
export const initialsOf = (title: string): string =>
  (title || '?')
    .split(' ')
    .map(w => Array.from(w)[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** A space of people (the circle is square-cornered) rather than a conversation of two. */
export const isGroup = (space: Space): boolean => space.type === 'SPACE';

/** The line under a space's name. */
export const kindOf = (space: Space): string =>
  space.type === 'DIRECT_MESSAGE' ? 'Direct message' : 'Space';

// ── The messages ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A message of a space (schemas.GchatMessage): who wrote it as Chat names them (may be nobody), when, and the words (none, for a card). */
export interface ChatMessage {
  id: string;
  text: string;
  senderName: string;
  senderId: string;
  createTime: string;
}

const isMessage = (v: unknown): v is ChatMessage =>
  isObject(v) &&
  typeof v['id'] === 'string' &&
  typeof v['text'] === 'string' &&
  typeof v['senderName'] === 'string' &&
  typeof v['senderId'] === 'string' &&
  typeof v['createTime'] === 'string';

/** What GET …/gchat/messages says (schemas.GchatMessageList): the messages, oldest first, or none and the reason beside them. */
export interface MessageList {
  messages: ChatMessage[];
  error?: string;
  detail?: string;
}

export const isMessageList = (v: unknown): v is MessageList =>
  isObject(v) &&
  Array.isArray(v['messages']) &&
  v['messages'].every(isMessage) &&
  optionalText(v['error']) &&
  optionalText(v['detail']);

export type Messages =
  | { ok: true; messages: ChatMessage[] }
  /** `reason` is the server's own word for it; `detail` is Google's words, where it gave some */
  | { ok: false; reason: string; detail: string };

export function messagesOf(list: MessageList): Messages {
  if (!list.error) return { ok: true, messages: list.messages };
  return { ok: false, reason: list.error, detail: list.detail ?? '' };
}

/** The message is the person's own (the classic pages tell by the name: the link's, as Google gave it, against the message's as Chat did). */
export const isMine = (m: ChatMessage, link: { email: string; name: string }): boolean =>
  !!link.email && !!m.senderName && link.name === m.senderName;

/** The time at the foot of a message (hours and minutes, the 24-hour way); nothing where the message has none that can be read. */
export function timeOf(createTime: string): string {
  if (!createTime) return '';
  const d = new Date(createTime);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Whether a message is the last of a list, by its address: how a poll tells that something new has come. */
export const lastIdOf = (messages: ChatMessage[]): string =>
  messages[messages.length - 1]?.id ?? '';

// ── What is sent ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What POST …/gchat/messages answers (schemas.GchatSent): the id Chat gave the message, or why Chat (or the link) said no. */
export type Sent = { ok: true; id?: string } | { ok: false; error: string; detail?: string };

export function isSent(v: unknown): v is Sent {
  if (!isObject(v)) return false;
  if (v['ok'] === true) return optionalText(v['id']);
  return v['ok'] === false && typeof v['error'] === 'string' && optionalText(v['detail']);
}

// ── Where the routes are ───────────────────────────────────────────────────────────────────────────────────────────

export interface Routes {
  status: string;
  connect: string;
  disconnect: string;
  spaces: string;
  messages: (space: string) => string;
  send: string;
  /** a question that is answered if the person is still signed in, and by nothing else (the team's page asks it before it leaves) */
  check: string | null;
}

/** Both portals' are one set of routes, mounted under the administrator's /api/dashboard and the team's /api/employee. */
export function routesOf(portal: Portal): Routes {
  const base = portal === 'admin' ? '/api/dashboard/gchat' : '/api/employee/gchat';
  return {
    status: base + '/status',
    connect: base + '/connect',
    disconnect: base + '/disconnect',
    spaces: base + '/spaces',
    messages: space => base + '/messages?space=' + encodeURIComponent(space),
    send: base + '/messages',
    check: portal === 'admin' ? null : '/api/employee/check',
  };
}

// ── Pictures ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The pictures the screen draws, by what they stand for (shell/icons.test.ts holds every one to the app's set). */
export const CHAT_ICONS = {
  refresh: 'refresh-cw',
  placeholder: 'message-square',
  unlinked: 'message-square',
  unconfigured: 'plug',
  noAccess: 'plug',
  lost: 'rotate-ccw',
  returned: 'alert-triangle',
  unavailable: 'alert-circle',
  failed: 'alert-circle',
  history: 'eye-off',
  send: 'send',
  back: 'arrow-left',
} as const;

// ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SAID = {
  /** the screen's name: the head of the list of spaces */
  title: 'Google Chat',
  refresh: 'Refresh',
  select: 'Select a space',
  back: 'Back',

  /** no Google project here, or Chat not switched on: the variable to set, round it */
  unconfiguredTitle: 'Google Chat is not set up',
  unconfiguredBefore: 'Ask an administrator to enable it (',
  unconfiguredEnv: 'GOOGLE_CHAT_ENABLED=1',
  unconfiguredAfter: '). Google Chat requires a Google Workspace account.',
  /** the status is out of reach of a member who has the screen without the right to see it */
  noAccess: 'Google Chat is not switched on for you. Ask your admin.',
  /** the status could not be had, or came in a form this app does not know */
  unavailableTitle: 'Google Chat unavailable',
  unreadable: 'Google Chat could not be read.',
  strange: 'Google Chat came back in a form this app does not know.',

  /** no account linked */
  unlinkedTitle: 'Connect Google Chat',
  unlinkedBody: 'See your spaces and messages here, and reply without leaving the app.',
  connect: 'Connect Google Chat',
  /** a link Google no longer honours */
  lostTitle: 'Reconnect Google Chat',
  lostBody:
    'Your Google session expired. Unverified apps in testing mode lose access every 7 days.',
  reconnect: 'Reconnect',
  /** back from Google's consent screen with a reason it would not link */
  returnTitle: "Couldn't connect Google Chat",
  tryAgain: 'Try again',

  /** the spaces */
  noSpacesLead: 'No spaces yet.',
  noSpacesRest: 'Group chats and DMs only appear here once they have at least one message.',
  forbidden:
    "Google Chat isn't available for your organization. A Workspace admin needs to allow this app.",
  expired: 'Your Google session expired.',
  unreachable: 'Could not reach Google Chat.',

  /** a space opened */
  noMessages: 'No messages in this space yet.',
  historyTitle: 'Message history not shared',
  historyBody: "You didn't grant permission to read messages. You can still send.",
  grantRead: 'Grant read access',
  messagesFailed: 'Could not load messages',
  unknown: 'Unknown',
  /** the foot of a space the person may read and not write in */
  readOnly: "Read-only — you didn't grant permission to send.",
  readOnlyAdmin: 'Read-only — your admin has not granted sending.',
  send: 'Send',
  sendFailed: 'Could not send: ',
  strangeSend:
    'Google Chat answered in a form this app does not know, so it is not known whether the message went.',
} as const;

/** The placeholder of the box a message is written in. */
export const placeholderOf = (title: string): string => `Message ${title}… (sent as you)`;

/** What a reason the server gave for not showing a space's messages is in words, where Google gave none of its own. */
export function reasonWords(reason: string): string {
  switch (reason) {
    case 'reconnect':
      return SAID.expired;
    case 'forbidden':
      return SAID.forbidden;
    case 'not_connected':
      return 'Google Chat is not connected.';
    case 'not_configured':
      return SAID.unconfiguredTitle + '.';
    case 'bad_space':
      return 'That space could not be found.';
    case 'empty':
      return 'There is nothing to send.';
    default:
      return SAID.unreachable;
  }
}
