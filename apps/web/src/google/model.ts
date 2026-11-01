// What My Drive and My Sheets are made of, apart from how they are drawn: how the server's answers are recognised, which icon a
// file gets, where the inline viewer looks, and the words. The classic portals carry these twice (public/assets/dashboard.js and
// employee.js, "Drive / Sheets"); the routes behind them are the server's own, one pair per portal (tests/driveroutes.js).
import type { Portal } from '../lib/env';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The two screens that browse a Google account's files: all of it, or only the spreadsheets. */
export type Kind = 'drive' | 'sheets';

// ── The link ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What GET …/drive/status says (packages/contracts: schemas.DriveStatus): no Google project here, none linked, or linked. */
export type DriveStatus =
  | { configured: false }
  | { configured: true; connected: false }
  | { configured: true; connected: true; email?: string; name?: string; canUpload: boolean };

const optionalText = (v: unknown) => v === undefined || typeof v === 'string';

export function isDriveStatus(v: unknown): v is DriveStatus {
  if (!isObject(v)) return false;
  if (v['configured'] === false) return true;
  if (v['configured'] !== true) return false;
  if (v['connected'] === false) return true;
  return (
    v['connected'] === true &&
    typeof v['canUpload'] === 'boolean' &&
    optionalText(v['email']) &&
    optionalText(v['name'])
  );
}

/** …as the page tells it: there is no Google project, there is a project and no link, or there is a link and whose it is. */
export type Link =
  | { state: 'unconfigured' }
  | { state: 'unlinked' }
  | {
      state: 'linked';
      email: string;
      name: string;
      /** false: the link was made before uploads were asked for, and attaching a client file will fail until it is made again */
      canUpload: boolean;
    };

export function linkOf(s: DriveStatus): Link {
  if (!s.configured) return { state: 'unconfigured' };
  if (!s.connected) return { state: 'unlinked' };
  return { state: 'linked', email: s.email ?? '', name: s.name ?? '', canUpload: s.canUpload };
}

/** The letter in the circle: the first of the name, as typed (the classic page does not capitalise), or a question mark. */
export const initialOf = (name: string): string => name.charAt(0) || '?';

// ── The files ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A file as Drive lists it (schemas.DriveFile). */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
}

export function isDriveFile(v: unknown): v is DriveFile {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['mimeType'] === 'string' &&
    optionalText(v['modifiedTime']) &&
    optionalText(v['webViewLink']) &&
    optionalText(v['iconLink']) &&
    optionalText(v['size'])
  );
}

export const isDriveFileList = (v: unknown): v is DriveFile[] =>
  Array.isArray(v) && v.every(isDriveFile);

/** The address Drive gave for opening a file in Google, if it is one a browser should be sent to (an https one); nothing otherwise. */
export const viewLinkOf = (f: Pick<DriveFile, 'webViewLink'>): string =>
  f.webViewLink && /^https:\/\//i.test(f.webViewLink) ? f.webViewLink : '';

/** "3 files", "1 file": the count over the list. */
export const countOf = (n: number): string => `${n} file${n !== 1 ? 's' : ''}`;

/** The day a file changed, in the reader's own way of writing a date; a dash where Drive did not say. */
export const modifiedOf = (f: Pick<DriveFile, 'modifiedTime'>): string =>
  f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—';

// ── What a file looks like ─────────────────────────────────────────────────────────────────────────────────────────

export type Glyph =
  | 'paperclip'
  | 'folder'
  | 'sheet'
  | 'file-text'
  | 'presentation'
  | 'file-type'
  | 'image'
  | 'video'
  | 'music';

/** The colour of a glyph, by the name of the theme's own token (nothing: the text's). */
export type Tone = 'plain' | 'success' | 'info' | 'warning' | 'danger' | 'primary';

export interface FileIcon {
  glyph: Glyph;
  tone: Tone;
}

const PLAIN: FileIcon = { glyph: 'paperclip', tone: 'plain' };
const GOOGLE = 'application/vnd.google-apps.';

/** Folders, Google's own documents, PDFs, pictures, films — and, in the admin's page alone, sound; everything else is a paperclip. */
export function iconOf(mimeType: string | undefined, portal: Portal): FileIcon {
  if (!mimeType) return PLAIN;
  if (mimeType === GOOGLE + 'folder') return { glyph: 'folder', tone: 'plain' };
  if (mimeType === GOOGLE + 'spreadsheet') return { glyph: 'sheet', tone: 'success' };
  if (mimeType === GOOGLE + 'document') return { glyph: 'file-text', tone: 'info' };
  if (mimeType === GOOGLE + 'presentation') return { glyph: 'presentation', tone: 'warning' };
  if (mimeType === 'application/pdf') return { glyph: 'file-type', tone: 'danger' };
  if (mimeType.startsWith('image/')) return { glyph: 'image', tone: 'primary' };
  if (mimeType.startsWith('video/')) return { glyph: 'video', tone: 'warning' };
  if (portal === 'admin' && mimeType.startsWith('audio/'))
    return { glyph: 'music', tone: 'primary' };
  return PLAIN;
}

/** Where the inline viewer looks: Google's own preview of the document, or Drive's of anything else. Nothing without an id. */
export function embedUrl(f: Pick<DriveFile, 'id' | 'mimeType'>): string {
  if (!f.id) return '';
  if (f.mimeType === GOOGLE + 'spreadsheet')
    return `https://docs.google.com/spreadsheets/d/${f.id}/preview`;
  if (f.mimeType === GOOGLE + 'document')
    return `https://docs.google.com/document/d/${f.id}/preview`;
  if (f.mimeType === GOOGLE + 'presentation')
    return `https://docs.google.com/presentation/d/${f.id}/preview`;
  return `https://drive.google.com/file/d/${f.id}/preview`;
}

// ── Where the routes are ───────────────────────────────────────────────────────────────────────────────────────────

export interface Routes {
  status: string;
  connect: string;
  disconnect: string;
  files: string;
  sheets: string;
  /** a question that is answered if the person is still signed in, and by nothing else (the team's page asks it before it leaves) */
  check: string | null;
}

/** The administrator's routes are not under /api/dashboard (they are Drive's own); the team's are under /api/employee/drive. */
export function routesOf(portal: Portal): Routes {
  if (portal === 'admin') {
    return {
      status: '/api/drive/status',
      connect: '/api/drive/connect',
      disconnect: '/api/drive/disconnect',
      files: '/api/drive/files',
      sheets: '/api/drive/sheets',
      check: null,
    };
  }
  return {
    status: '/api/employee/drive/status',
    connect: '/api/employee/drive/connect',
    disconnect: '/api/employee/drive/disconnect',
    files: '/api/employee/drive/files',
    sheets: '/api/employee/drive/sheets',
    check: '/api/employee/check',
  };
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TITLES: Readonly<Record<Kind, string>> = { drive: 'My Drive', sheets: 'My Sheets' };

export const SAID = {
  loading: 'Loading…',
  connect: 'Connect Google Drive',
  disconnect: 'Disconnect',
  view: 'View',
  open: 'Open ↗',
  openInGoogle: 'Open in Google ↗',
  close: '×',
  noFiles: 'No files found',
  /** the admin's page: the title of the card when there is no Google project, and what to do about it */
  adminUnconfiguredTitle: 'Connect Google Drive',
  adminUnconfigured: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars then redeploy.',
  adminUnlinked: 'Connect your Google account to browse your Drive files.',
  teamUnconfigured: 'Google Drive integration not configured. Contact your admin.',
  teamUnlinked: 'Connect your Google account to access your files.',
  /** …and to a member who may see the files but not link an account */
  teamUnlinkedLocked: 'No Google account is linked. Ask your admin to link one for you.',
  /** …the notice of a link made before uploads were asked for, round the word that makes it again */
  reconnectBefore:
    'This connection was authorised before uploads were supported, so attaching a client file will fail. ',
  reconnect: 'Reconnect',
  reconnectAfter: ' to fix it.',
  unreadable: 'Google Drive could not be read.',
  /** the team member may read spreadsheets and not the Drive status that says whose account it is: the classic page told them it was not set up */
  noAccess: 'Google Drive is not switched on for you. Ask your admin.',
} as const;
