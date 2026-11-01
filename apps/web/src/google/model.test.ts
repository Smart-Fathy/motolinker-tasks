import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import { oneAtATime } from '../test/wrongly';
import {
  countOf,
  embedUrl,
  iconOf,
  initialOf,
  isDriveFile,
  isDriveFileList,
  isDriveStatus,
  linkOf,
  modifiedOf,
  routesOf,
  SAID,
  TITLES,
  viewLinkOf,
  type DriveStatus,
} from './model';

const CONNECTED = {
  configured: true,
  connected: true,
  email: 'a@b.test',
  name: 'Ana',
  canUpload: true,
};
const FILE = {
  id: 'f1',
  name: 'Price list',
  mimeType: 'application/pdf',
  modifiedTime: '2026-10-20T09:00:00.000Z',
  webViewLink: 'https://drive.google.com/file/d/f1/view',
  iconLink: 'https://drive-thirdparty.googleusercontent.com/x',
  size: '20480',
};
const NOT_THINGS = [null, undefined, 7, 'x', true, [], [{}]];

describe('how the link is recognised', () => {
  // The browser does not carry zod for this: the guards are held to the contract's schemas, on what is right and on every
  // way each field can be wrong.
  it('has the status recognised as the schema recognises it', () => {
    const shapes: Record<string, unknown>[] = [
      { configured: false },
      { configured: true, connected: false },
      CONNECTED,
      { configured: true, connected: true, canUpload: false },
      { configured: false, connected: true },
      { configured: true, connected: false, email: 'a@b.test' },
      { ...CONNECTED, extra: 1 },
      {},
    ];
    for (const good of shapes) {
      for (const s of [good, ...oneAtATime(good)]) {
        expect([isDriveStatus(s), s]).toEqual([schemas.DriveStatus.safeParse(s).success, s]);
      }
    }
    for (const s of NOT_THINGS) {
      expect([isDriveStatus(s), s]).toEqual([schemas.DriveStatus.safeParse(s).success, s]);
    }
  });

  it('says there is no Google project, no link, or whose link it is', () => {
    expect(linkOf({ configured: false })).toEqual({ state: 'unconfigured' });
    expect(linkOf({ configured: true, connected: false })).toEqual({ state: 'unlinked' });
    expect(linkOf(CONNECTED as DriveStatus)).toEqual({
      state: 'linked',
      email: 'a@b.test',
      name: 'Ana',
      canUpload: true,
    });
  });

  it('keeps what a link made before uploads were asked for says of itself', () => {
    expect(linkOf({ ...CONNECTED, canUpload: false } as DriveStatus)).toMatchObject({
      state: 'linked',
      canUpload: false,
    });
  });

  it('has a link with no name or email as one with blanks (Google did not say)', () => {
    expect(linkOf({ configured: true, connected: true, canUpload: true })).toEqual({
      state: 'linked',
      email: '',
      name: '',
      canUpload: true,
    });
  });

  it('puts the first letter of the name in the circle, as typed, and a question mark where there is none', () => {
    expect(initialOf('ana')).toBe('a');
    expect(initialOf('Ana B')).toBe('A');
    expect(initialOf('')).toBe('?');
  });
});

describe('how the files are recognised', () => {
  it('has a file recognised as the schema recognises it', () => {
    const shapes: Record<string, unknown>[] = [
      FILE,
      { id: 'f2', name: 'Stock count', mimeType: 'application/vnd.google-apps.spreadsheet' },
      { ...FILE, extra: 1 },
    ];
    for (const good of shapes) {
      for (const f of [good, ...oneAtATime(good)]) {
        expect([isDriveFile(f), f]).toEqual([schemas.DriveFile.safeParse(f).success, f]);
      }
    }
    for (const f of NOT_THINGS) {
      expect([isDriveFile(f), f]).toEqual([schemas.DriveFile.safeParse(f).success, f]);
    }
  });

  it('has a list recognised as the schema recognises it: of files and of nothing else', () => {
    const lists: unknown[] = [
      [],
      [FILE],
      [FILE, { ...FILE, id: 'f2' }],
      [FILE, { ...FILE, id: 3 }],
      [FILE, null],
      [null],
      {},
      { files: [FILE] },
      'x',
      null,
      undefined,
    ];
    for (const l of lists) {
      expect([isDriveFileList(l), l]).toEqual([schemas.DriveFileList.safeParse(l).success, l]);
    }
  });

  it('counts them the way the classic pages do', () => {
    expect(countOf(0)).toBe('0 files');
    expect(countOf(1)).toBe('1 file');
    expect(countOf(2)).toBe('2 files');
    expect(countOf(50)).toBe('50 files');
  });

  it('writes the day a file changed in the reader’s own way, and a dash where Drive did not say', () => {
    expect(modifiedOf({ modifiedTime: '2026-10-20T09:00:00.000Z' })).toBe(
      new Date('2026-10-20T09:00:00.000Z').toLocaleDateString(),
    );
    expect(modifiedOf({})).toBe('—');
    expect(modifiedOf({ modifiedTime: '' })).toBe('—');
  });

  it('offers a link to Google only if it is an https one', () => {
    expect(viewLinkOf({ webViewLink: 'https://docs.google.com/spreadsheets/d/f2/edit' })).toBe(
      'https://docs.google.com/spreadsheets/d/f2/edit',
    );
    expect(viewLinkOf({ webViewLink: 'HTTPS://drive.google.com/x' })).toBe(
      'HTTPS://drive.google.com/x',
    );
    expect(viewLinkOf({ webViewLink: 'http://drive.google.com/x' })).toBe('');
    expect(viewLinkOf({ webViewLink: 'javascript:alert(1)' })).toBe('');
    expect(viewLinkOf({ webViewLink: '//drive.google.com/x' })).toBe('');
    expect(viewLinkOf({ webViewLink: '' })).toBe('');
    expect(viewLinkOf({})).toBe('');
  });
});

describe('what a file looks like', () => {
  const GOOGLE = 'application/vnd.google-apps.';
  const TABLE: [string | undefined, string, string][] = [
    [undefined, 'paperclip', 'plain'],
    ['', 'paperclip', 'plain'],
    [GOOGLE + 'folder', 'folder', 'plain'],
    [GOOGLE + 'spreadsheet', 'sheet', 'success'],
    [GOOGLE + 'document', 'file-text', 'info'],
    [GOOGLE + 'presentation', 'presentation', 'warning'],
    [GOOGLE + 'form', 'paperclip', 'plain'],
    ['application/pdf', 'file-type', 'danger'],
    ['image/png', 'image', 'primary'],
    ['image/svg+xml', 'image', 'primary'],
    ['imagery/x', 'paperclip', 'plain'],
    ['videos/x', 'paperclip', 'plain'],
    ['video/mp4', 'video', 'warning'],
    ['text/plain', 'paperclip', 'plain'],
    ['application/zip', 'paperclip', 'plain'],
  ];
  it.each(TABLE)('gives %s a %s, %s', (mime, glyph, tone) => {
    expect(iconOf(mime, 'admin')).toEqual({ glyph, tone });
    expect(iconOf(mime, 'team')).toEqual({ glyph, tone });
  });

  it('gives sound a note in the admin’s page, which is the only one that ever did', () => {
    expect(iconOf('audio/mpeg', 'admin')).toEqual({ glyph: 'music', tone: 'primary' });
    expect(iconOf('audio/mpeg', 'team')).toEqual({ glyph: 'paperclip', tone: 'plain' });
    expect(iconOf('audios/x', 'admin')).toEqual({ glyph: 'paperclip', tone: 'plain' });
  });
});

describe('where the viewer looks', () => {
  it('shows Google’s own preview of its documents, by what they are', () => {
    expect(embedUrl({ id: 'a1', mimeType: 'application/vnd.google-apps.spreadsheet' })).toBe(
      'https://docs.google.com/spreadsheets/d/a1/preview',
    );
    expect(embedUrl({ id: 'a1', mimeType: 'application/vnd.google-apps.document' })).toBe(
      'https://docs.google.com/document/d/a1/preview',
    );
    expect(embedUrl({ id: 'a1', mimeType: 'application/vnd.google-apps.presentation' })).toBe(
      'https://docs.google.com/presentation/d/a1/preview',
    );
  });

  it('shows Drive’s preview of anything else', () => {
    for (const mimeType of [
      'application/pdf',
      'image/png',
      'application/vnd.google-apps.folder',
      '',
    ]) {
      expect(embedUrl({ id: 'a1', mimeType })).toBe('https://drive.google.com/file/d/a1/preview');
    }
  });

  it('shows nothing of a file with no id', () => {
    expect(embedUrl({ id: '', mimeType: 'application/pdf' })).toBe('');
  });
});

describe('where the routes are', () => {
  it('has the administrator’s under Drive’s own address, not under /api/dashboard', () => {
    expect(routesOf('admin')).toEqual({
      status: '/api/drive/status',
      connect: '/api/drive/connect',
      disconnect: '/api/drive/disconnect',
      files: '/api/drive/files',
      sheets: '/api/drive/sheets',
      check: null,
    });
  });

  it('has the team’s under /api/employee/drive, with the question that is asked before leaving', () => {
    expect(routesOf('team')).toEqual({
      status: '/api/employee/drive/status',
      connect: '/api/employee/drive/connect',
      disconnect: '/api/employee/drive/disconnect',
      files: '/api/employee/drive/files',
      sheets: '/api/employee/drive/sheets',
      check: '/api/employee/check',
    });
  });
});

describe('the words', () => {
  it('names the two screens as the catalogue does', () => {
    expect(TITLES).toEqual({ drive: 'My Drive', sheets: 'My Sheets' });
  });

  it('has the notice of an old link read as one sentence round the word that makes it again', () => {
    expect(SAID.reconnectBefore + SAID.reconnect + SAID.reconnectAfter).toBe(
      'This connection was authorised before uploads were supported, so attaching a client file will fail. Reconnect to fix it.',
    );
  });
});
