// What the Security panel and the account menu deal in: the answers of the server and the checks that tell one from nonsense,
// and the small things the classic panel (public/assets/security.js) wrote in words — how long ago, which way somebody signed in,
// how a key and the recovery codes are shown. The shapes are packages/contracts' (schemas.js); the checks are written by hand
// because the bundle does not carry zod, and model.test.ts holds each one to its schema.
import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';

export type Overview = z.infer<typeof schemas.SecurityOverview>;
export type SecuritySession = z.infer<typeof schemas.SecuritySession>;
export type SecurityLogin = z.infer<typeof schemas.SecurityLogin>;
export type Setup = z.infer<typeof schemas.SecuritySetup>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isTextOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isNumberOrNull = (v: unknown): boolean => v === null || typeof v === 'number';

function isSession(v: unknown): v is SecuritySession {
  return (
    isObject(v) &&
    typeof v['sid'] === 'string' &&
    typeof v['device'] === 'string' &&
    typeof v['ip'] === 'string' &&
    isNumberOrNull(v['createdAt']) &&
    isNumberOrNull(v['lastSeenAt']) &&
    typeof v['method'] === 'string' &&
    typeof v['current'] === 'boolean'
  );
}

function isLogin(v: unknown): v is SecurityLogin {
  return (
    isObject(v) &&
    typeof v['at'] === 'string' &&
    typeof v['event'] === 'string' &&
    isTextOrNull(v['device']) &&
    isTextOrNull(v['ip']) &&
    isTextOrNull(v['method']) &&
    typeof v['new_device'] === 'boolean'
  );
}

/** Is this what GET …/security answers? */
export function isOverview(v: unknown): v is Overview {
  if (!isObject(v)) return false;
  const { account, twofa } = v;
  if (!isObject(account) || (account['kind'] !== 'admin' && account['kind'] !== 'employee'))
    return false;
  if (typeof account['name'] !== 'string' || typeof account['canChangePassword'] !== 'boolean')
    return false;
  if (!isObject(twofa)) return false;
  if (
    typeof twofa['available'] !== 'boolean' ||
    !(twofa['reason'] === null || twofa['reason'] === 'error' || twofa['reason'] === 'migration') ||
    typeof twofa['enabled'] !== 'boolean' ||
    !isTextOrNull(twofa['enabledAt']) ||
    !isCount(twofa['recoveryLeft']) ||
    typeof twofa['encrypted'] !== 'boolean'
  )
    return false;
  const { sessions, logins, history, alerts } = v;
  return (
    Array.isArray(sessions) &&
    sessions.every(isSession) &&
    Array.isArray(logins) &&
    logins.every(isLogin) &&
    typeof history === 'boolean' &&
    (alerts === 'new' || alerts === 'all' || alerts === 'off')
  );
}

/** …POST …/security/2fa/setup */
export const isSetup = (v: unknown): v is Setup =>
  isObject(v) &&
  typeof v['secret'] === 'string' &&
  typeof v['otpauth'] === 'string' &&
  typeof v['qr'] === 'string';

/** …the recovery codes that come with turning it on, or with making new ones */
export const isCodes = (v: unknown): v is { ok: true; recoveryCodes: string[] } =>
  isObject(v) && v['ok'] === true && isStrings(v['recoveryCodes']);

/** …POST …/security/2fa/enable: the codes, and how many other devices were signed out */
export const isEnabled = (
  v: unknown,
): v is { ok: true; recoveryCodes: string[]; sessionsRevoked: number } =>
  isCodes(v) && isCount((v as unknown as Record<string, unknown>)['sessionsRevoked']);

/** …POST …/security/2fa/disable */
export const isDisabled = (v: unknown): v is { ok: true; sessionsRevoked: number } =>
  isObject(v) && v['ok'] === true && isCount(v['sessionsRevoked']);

/** …POST …/security/sessions/revoke-others; `ok` is false where some sign-outs could not be saved */
export const isRevoked = (
  v: unknown,
): v is { ok: boolean; sessionsRevoked: number; warning?: string } =>
  isObject(v) &&
  typeof v['ok'] === 'boolean' &&
  isCount(v['sessionsRevoked']) &&
  (v['warning'] === undefined || typeof v['warning'] === 'string');

// ── In words ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long ago, as the panel says it ("just now", "5 min ago", "3 h ago", "2 days ago"); nothing known is "unknown". */
export function ago(ms: number | null | undefined, now: number = Date.now()): string {
  if (!ms) return 'unknown';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** A moment, as a person in this browser's own locale reads it: "30 Oct, 14:05". Nothing that is not a date is anything. */
export function stamp(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const METHODS: Record<string, string> = {
  password: 'Password',
  google: 'Google',
  'password+2fa': 'Password + code',
  'google+2fa': 'Google + code',
  'password+recovery': 'Password + recovery code',
  'google+recovery': 'Google + recovery code',
};
/** The way somebody signed in, in words (a way this app does not know is shown as the server wrote it). */
export const methodLabel = (m: string | null | undefined): string => (m && METHODS[m]) || m || '';

/** A key in groups of four, for reading it out: "JBSW Y3DP EHPK 3PXP". */
export const groups4 = (key: string): string =>
  String(key || '')
    .replace(/(.{4})/g, '$1 ')
    .trim();

/** The six digits an authenticator shows, typed with or without the space it prints in the middle. */
export const sixDigits = (typed: string): string | null => {
  const code = typed.replace(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
};

/** What "Copy" and "Download" give: the codes, with whose they are and when they were made. */
export function codesText(codes: readonly string[], name: string, made: Date = new Date()): string {
  return `MotoLinker recovery codes${name ? ' for ' + name : ''}\nMade ${made.toLocaleString()}\nEach code works once.\n\n${codes.join('\n')}\n`;
}

/** What the panel says, where it says it in the same words more than once. */
export const SAID = {
  password: 'Enter your password.',
  passwordAndCode: 'Enter your password and a code.',
  passwordAndSix: 'Enter your password and the 6-digit code.',
  six: 'Enter the 6-digit code from your app.',
  loadFailed: 'Could not load your security settings.',
  off: 'Two-factor authentication is off. Your other devices were signed out.',
  gone: 'Signed out. If you did not recognise it, also change your password.',
  copied: 'Copied.',
  copyFailed: 'Could not copy — select the codes and copy them by hand.',
  notRead: 'The answer came back in a form this app does not know. Try again.',
  unsure: 'Some devices could not be signed out. Try again.',
} as const;

/** "Signed out 2 other devices." — or that there were none. */
export const othersSignedOut = (n: number): string =>
  n ? `Signed out ${n} other device${n === 1 ? '' : 's'}.` : 'There were no other devices.';

/** After turning two-factor on: "3 other devices were signed out." */
export const signedOutLine = (n: number): string =>
  `${n} other device${n === 1 ? ' was' : 's were'} signed out.`;

/** …DELETE …/security/sessions/:sid */
export const isDone = (v: unknown): v is { ok: true } => isObject(v) && v['ok'] === true;

/** The icons the account menu draws beside what it opens (lucide's names; the shell's table holds them). */
export const ACCOUNT_ICONS = { password: 'key', picture: 'camera', username: 'pencil' } as const;
