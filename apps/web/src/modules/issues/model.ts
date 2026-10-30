// What a ticket is to the app, and the small rules the Issues centre and the report form share: how the server's rows are
// recognised, how a time and a name are written, which tickets a filter shows. The classic team portal carries these in
// public/assets/employee.js; src/modules/issues is the server's side of the same thing.

/** A ticket, as GET /api/v1/issues lists it (packages/contracts: schemas.Issue). */
export interface Issue {
  id: number;
  title: string;
  description: string;
  /** the attachment's address, or empty */
  file_url: string;
  reporter_id: number | null;
  reporter_name: string;
  status: IssueStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string;
}

export type IssueStatus = 'open' | 'resolved';

/** A reply on a ticket (schemas.IssueComment). */
export interface IssueComment {
  id: number;
  issue_id: number;
  author_key: string;
  author_name: string;
  body: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  file_type: string;
  created_at: string;
}

/** The chips above the queue: everything, what is still open, what is closed. */
export type IssueFilter = '' | 'open' | 'resolved';

/** The words the person is told when it works. */
export const SAID = {
  solved: 'Marked solved — the reporter has been told.',
  reopened: 'Reopened',
  sent: 'Ticket sent to the CTO — thank you!',
} as const;

/** The glyphs the centre draws (the icon registry in app/shell/icons.tsx holds them, and a test holds it to this list). */
export const ISSUE_ICONS = {
  empty: 'inbox',
  attachment: 'paperclip',
  solved: 'check-circle',
  report: 'bug',
} as const;

/** How big a file may be attached to a report, as the form says and the server enforces. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

/**
 * Is this a ticket? The page reads these fields, so these are the ones checked; model.test.ts holds the guards to the
 * schemas in packages/contracts (the bundle does not carry zod just for this).
 */
export function isIssue(v: unknown): v is Issue {
  if (!isObject(v)) return false;
  return (
    isInt(v['id']) &&
    typeof v['title'] === 'string' &&
    typeof v['description'] === 'string' &&
    typeof v['file_url'] === 'string' &&
    (v['reporter_id'] === null || isInt(v['reporter_id'])) &&
    typeof v['reporter_name'] === 'string' &&
    (v['status'] === 'open' || v['status'] === 'resolved') &&
    typeof v['created_at'] === 'string' &&
    (v['resolved_at'] === null || typeof v['resolved_at'] === 'string') &&
    typeof v['resolved_by'] === 'string'
  );
}

export function isIssueList(v: unknown): v is { items: Issue[] } {
  return isObject(v) && Array.isArray(v['items']) && v['items'].every(isIssue);
}

export function isIssueComment(v: unknown): v is IssueComment {
  if (!isObject(v)) return false;
  return (
    isInt(v['id']) &&
    isInt(v['issue_id']) &&
    typeof v['author_key'] === 'string' &&
    typeof v['author_name'] === 'string' &&
    typeof v['body'] === 'string' &&
    typeof v['file_url'] === 'string' &&
    typeof v['file_name'] === 'string' &&
    (v['file_size'] === null || (isInt(v['file_size']) && v['file_size'] >= 0)) &&
    typeof v['file_type'] === 'string' &&
    typeof v['created_at'] === 'string'
  );
}

export function isIssueCommentList(v: unknown): v is { items: IssueComment[] } {
  return isObject(v) && Array.isArray(v['items']) && v['items'].every(isIssueComment);
}

/** Anything that is not "resolved" is open, as the classic page reads a status. */
export const isOpen = (i: Issue): boolean => i.status !== 'resolved';

/** Which tickets a filter shows. */
export const shows = (filter: IssueFilter, i: Issue): boolean =>
  filter === '' || (isOpen(i) ? 'open' : 'resolved') === filter;

/** How many tickets there are, and how many of them are open and closed (the numbers on the chips). */
export function countsOf(items: readonly Issue[]): { all: number; open: number; resolved: number } {
  const open = items.filter(isOpen).length;
  return { all: items.length, open, resolved: items.length - open };
}

/** The line under the page's title; before the queue has come it says what the page is for. */
export const FOR_TICKETS = 'Tickets the team raised from “Report an issue”';
export const subtitleOf = (open: number): string =>
  open ? `${open} still open` : 'Nothing open — all clear';

/** When, as the classic page writes it: day, short month, year, 24-hour time, in British order. */
export function whenOf(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Up to two capitals, from the first two words of a name. */
export function initialsOf(name: string | null | undefined): string {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0] || '')
      .join('')
      .toUpperCase() || '?'
  );
}

/**
 * Where a stored file can be opened from: an address on this site, or a web address, normalised; nothing else (a
 * `javascript:` address in a row is not a link). The classic page's chatFileHref.
 */
export function fileHref(u: unknown): string {
  const s = String(u == null ? '' : u).trim();
  if (/^\/(?!\/)/.test(s)) return s;
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    return new URL(s).href;
  } catch {
    return '';
  }
}

/** What is said of a file chosen for a report, under the paperclip. */
export function fileHint(file: { name: string; size: number } | null | undefined): string {
  if (!file) return 'Click to attach a screenshot or file';
  return `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

/** What a report is missing or has too much of, in words, or null when it can be sent (the classic form's own two checks). */
export function problemWith(report: {
  title: string;
  description: string;
  file: { size: number } | null | undefined;
}): string | null {
  if (!report.title.trim() && !report.description.trim()) return 'Please describe the issue';
  if (report.file && report.file.size > MAX_FILE_BYTES) return 'File must be under 10 MB';
  return null;
}
