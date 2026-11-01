import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../test/helpers';
import { open, type Answer } from '../test/session';
import type { DriveFile } from './model';

const SHEET = 'application/vnd.google-apps.spreadsheet';
const PRICE: DriveFile = {
  id: 'f1',
  name: 'Price list.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  modifiedTime: '2026-10-20T09:00:00.000Z',
  webViewLink: 'https://drive.google.com/file/d/f1/view',
};
const COUNT: DriveFile = {
  id: 'f2',
  name: 'Stock count',
  mimeType: SHEET,
  modifiedTime: '2026-10-19T09:00:00.000Z',
  webViewLink: 'https://docs.google.com/spreadsheets/d/f2/edit',
};
const NOTES: DriveFile = { id: 'f3', name: 'Shared with nobody', mimeType: 'application/pdf' };
const LINKED = {
  configured: true,
  connected: true,
  email: 'ana@motolinker.test',
  name: 'Ana A.',
  canUpload: true,
};

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  localStorage.clear();
  localStorage.setItem('ml_admin_token', 'adm-tok');
  localStorage.setItem('ml_emp_token', 'emp-tok');
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

interface World {
  status: unknown;
  files: DriveFile[];
  sheets: DriveFile[];
  /** a call that is answered with an error: path suffix → [status, words] */
  no?: Record<string, [number, string]>;
  /** a call that waits until the test lets it go */
  wait?: Record<string, Promise<unknown>>;
}

function boot(
  portal: 'admin' | 'team',
  screen: 'drive' | 'sheets',
  over: Partial<World> = {},
  permissions: Record<string, unknown> = { drive: true, sheets: true },
) {
  const w: World = { status: LINKED, files: [PRICE, COUNT, NOTES], sheets: [COUNT], ...over };
  const base = portal === 'admin' ? '/api/drive' : '/api/employee/drive';
  const gate = (suffix: string, body: () => unknown): Answer => {
    return async () => {
      const wait = w.wait?.[suffix];
      if (wait) await wait;
      const no = w.no?.[suffix];
      return no ? json(no[0], { error: no[1] }) : json(200, body());
    };
  };
  const more: Record<string, Answer> = {
    [base + '/status']: gate('status', () => w.status),
    [base + '/files']: gate('files', () => w.files),
    [base + '/sheets']: gate('sheets', () => w.sheets),
    [base + '/disconnect']: gate('disconnect', () => {
      w.status = { configured: true, connected: false };
      return { ok: true };
    }),
    '/api/employee/check': () => json(200, { ok: true }),
  };
  const me = portal === 'admin' ? adminMe() : teamMe(permissions);
  return { ...open(portal, me, { entries: ['/' + screen], more }), world: w, base };
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const parts = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-part=${name}]`)];
const text = (name: string) => part(name)?.textContent ?? null;
const names = () => parts('cellName').map(c => c.textContent!.trim());

describe.each(['admin', 'team'] as const)('My Drive, in the %s portal', portal => {
  it('shows the loader until it knows whose account it is', async () => {
    const gate = deferred<unknown>();
    boot(portal, 'drive', { wait: { status: gate.promise } });
    await waitFor(() => expect(part('loading')).not.toBeNull());
    expect(text('loading')!.trim()).toBe('Loading…');
    expect(part('connectCard')).toBeNull();
    expect(part('table')).toBeNull();
    gate.resolve(null);
    await waitFor(() => expect(part('loading')).toBeNull());
  });

  it('shows the loader again while the files are on their way, and not an account with no files in it', async () => {
    const gate = deferred<unknown>();
    boot(portal, 'drive', { wait: { files: gate.promise } });
    await waitFor(() => expect(part('loading')).not.toBeNull());
    await new Promise(r => setTimeout(r, 30));
    expect(part('loading')).not.toBeNull();
    expect(part('account')).toBeNull();
    expect(part('fileCount')).toBeNull();
    expect(part('empty')).toBeNull();
    gate.resolve(null);
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(part('loading')).toBeNull();
  });

  it('says that there is no Google project here, and offers no way out of it', async () => {
    boot(portal, 'drive', { status: { configured: false } });
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    if (portal === 'admin') {
      expect(text('connectIcon')).toBe('Drive');
      expect(text('connectTitle')).toBe('Connect Google Drive');
      expect(text('connectSub')).toBe(
        'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars then redeploy.',
      );
    } else {
      expect(text('connectTitle')).toBe('My Drive');
      expect(text('connectSub')).toBe(
        'Google Drive integration not configured. Contact your admin.',
      );
      expect(part('connectIcon')!.querySelector('svg')).not.toBeNull();
    }
    expect(part('connectBtn')).toBeNull();
    expect(part('account')).toBeNull();
  });

  it('offers to link an account when there is none, and goes to Google when asked', async () => {
    const user = userEvent.setup();
    const view = boot(portal, 'drive', { status: { configured: true, connected: false } });
    await waitFor(() => expect(part('connectBtn')).not.toBeNull());
    expect(text('connectTitle')).toBe('My Drive');
    expect(text('connectSub')).toBe(
      portal === 'admin'
        ? 'Connect your Google account to browse your Drive files.'
        : 'Connect your Google account to access your files.',
    );
    if (portal === 'admin') expect(text('connectIcon')).toBe('Drive');
    expect(text('connectBtn')).toBe('Connect Google Drive');
    await user.click(part('connectBtn')!);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(
      portal === 'admin'
        ? '/api/drive/connect?_t=adm-tok'
        : '/api/employee/drive/connect?_t=emp-tok',
    );
    // (the team's page asks that the session is still good before it leaves a page that cannot say so afterwards)
    expect(view.calls('/api/employee/check')).toHaveLength(portal === 'team' ? 1 : 0);
  });

  it('shows whose account it is, how many files there are and each of them', async () => {
    boot(portal, 'drive');
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(text('accountAvatar')).toBe('A');
    expect(text('accountName')).toBe('Ana A.');
    expect(text('accountEmail')).toBe('ana@motolinker.test');
    expect(text('disconnect')).toBe('Disconnect');
    expect(text('fileCount')).toBe('3 files');
    expect(text('tableTitle')!.replace(/\s+/g, ' ').trim()).toBe(
      portal === 'admin' ? 'Drive My Drive' : 'My Drive',
    );
    expect(names()).toEqual(['Price list.xlsx', 'Stock count', 'Shared with nobody']);
    expect(parts('cellDate').map(c => c.textContent)).toEqual([
      new Date(PRICE.modifiedTime!).toLocaleDateString(),
      new Date(COUNT.modifiedTime!).toLocaleDateString(),
      '—',
    ]);
    expect([...document.querySelectorAll('th')].map(h => h.textContent)).toEqual([
      'Name',
      'Modified',
      '',
    ]);
  });

  it('gives each file the picture its kind has', async () => {
    boot(portal, 'drive', {
      files: [
        { id: 'a', name: 'a', mimeType: 'application/vnd.google-apps.folder' },
        COUNT,
        { id: 'b', name: 'b', mimeType: 'application/vnd.google-apps.document' },
        { id: 'c', name: 'c', mimeType: 'application/vnd.google-apps.presentation' },
        NOTES,
        { id: 'd', name: 'd', mimeType: 'image/png' },
        { id: 'e', name: 'e', mimeType: 'video/mp4' },
        { id: 'g', name: 'g', mimeType: 'audio/mpeg' },
        { id: 'h', name: 'h', mimeType: 'text/plain' },
      ],
    });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(9));
    expect(parts('fileGlyph').map(g => g.getAttribute('data-glyph'))).toEqual([
      'folder',
      'sheet',
      'file-text',
      'presentation',
      'file-type',
      'image',
      portal === 'admin' ? 'video' : 'video',
      portal === 'admin' ? 'music' : 'paperclip',
      'paperclip',
    ]);
    const tones = parts('fileGlyph').map(g => /tone-([a-z]+)/.exec(g.getAttribute('class')!)?.[1]);
    expect(tones).toEqual([
      'plain',
      'success',
      'info',
      'warning',
      'danger',
      'primary',
      'warning',
      portal === 'admin' ? 'primary' : 'plain',
      'plain',
    ]);
  });

  it('opens a file in Google from a link that says it opens elsewhere, if Drive gave one', async () => {
    boot(portal, 'drive', {
      files: [
        PRICE,
        NOTES,
        { ...NOTES, id: 'f4', name: 'Odd one', webViewLink: 'javascript:alert(1)' },
        { ...NOTES, id: 'f5', name: 'Plain http', webViewLink: 'http://drive.google.com/x' },
      ],
    });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(4));
    const links = parts('open');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('Open ↗');
    expect(links[0]!.getAttribute('href')).toBe(PRICE.webViewLink);
    expect([links[0]!.getAttribute('target'), links[0]!.getAttribute('rel')]).toEqual([
      '_blank',
      'noopener',
    ]);
    expect(parts('view')).toHaveLength(4);
    expect(parts('view')[0]!.textContent).toBe('View');
  });

  it('shows a name as text, whatever it contains', async () => {
    boot(portal, 'drive', { files: [{ ...NOTES, name: '<b>bold</b> & "quoted"' }] });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(1));
    expect(names()).toEqual(['<b>bold</b> & "quoted"']);
    expect(document.querySelector('[data-part=cellName] b')).toBeNull();
  });

  it('says one file is one file', async () => {
    boot(portal, 'drive', { files: [PRICE] });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(1));
    expect(text('fileCount')).toBe('1 file');
  });

  it('shows a Drive with nothing in it as the admin’s empty table and the team’s words', async () => {
    boot(portal, 'drive', { files: [] });
    await waitFor(() => expect(text('fileCount')).toBe('0 files'));
    expect(parts('fileRow')).toHaveLength(0);
    if (portal === 'admin') {
      expect(part('table')).not.toBeNull();
      expect(part('empty')).toBeNull();
    } else {
      expect(part('table')).toBeNull();
      expect(text('empty')).toBe('No files found');
    }
  });

  it('opens a file in the viewer over the page, with Google’s own preview of it', async () => {
    const user = userEvent.setup();
    boot(portal, 'drive');
    await waitFor(() => expect(parts('view')).toHaveLength(3));
    await user.click(parts('view')[1]!);
    const viewer = part('viewer')!;
    expect(viewer.parentElement).toBe(document.body);
    expect(viewer.getAttribute('role')).toBe('dialog');
    expect(viewer.getAttribute('aria-label')).toBe('Stock count');
    expect(text('viewerTitle')).toBe('Stock count');
    expect(part('viewerFrame')!.getAttribute('src')).toBe(
      'https://docs.google.com/spreadsheets/d/f2/preview',
    );
    const out = part('viewerOpen')!;
    expect(out.textContent).toBe('Open in Google ↗');
    expect(out.getAttribute('href')).toBe(COUNT.webViewLink);
    expect(out.getAttribute('target')).toBe('_blank');
    expect(viewer.contains(document.activeElement)).toBe(true);
    await user.click(part('viewerClose')!);
    expect(part('viewer')).toBeNull();
  });

  it('previews what Drive does not make a document of in Drive’s own viewer', async () => {
    const user = userEvent.setup();
    boot(portal, 'drive');
    await waitFor(() => expect(parts('view')).toHaveLength(3));
    await user.click(parts('view')[2]!);
    expect(part('viewerFrame')!.getAttribute('src')).toBe(
      'https://drive.google.com/file/d/f3/preview',
    );
    // (a file Drive gave no link for has none to open in Google)
    expect(part('viewerOpen')!.getAttribute('href')).toBe('#');
  });

  it('puts the viewer away with Escape, and gives the focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    boot(portal, 'drive');
    await waitFor(() => expect(parts('view')).toHaveLength(3));
    const button = parts('view')[0]!;
    await user.click(button);
    expect(part('viewer')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(part('viewer')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('lets go of the account, and then offers to link one', async () => {
    const user = userEvent.setup();
    const view = boot(portal, 'drive');
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    await user.click(part('disconnect')!);
    await waitFor(() => expect(part('connectBtn')).not.toBeNull());
    expect(view.calls(view.base + '/disconnect')).toHaveLength(1);
    expect(view.calls(view.base + '/disconnect')[0]!.init.method).toBe('POST');
    expect(view.calls(view.base + '/status')).toHaveLength(2);
    expect(part('account')).toBeNull();
    expect(part('table')).toBeNull();
    expect(parts('fileRow')).toHaveLength(0);
  });

  it('shows the loader again while it reads the link anew', async () => {
    const user = userEvent.setup();
    boot(portal, 'drive');
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    await user.click(part('disconnect')!);
    // (between the click and the answer there is nothing of the old account on show)
    await waitFor(() => expect(part('account')).toBeNull());
  });

  it('holds the button while it lets go, so that it is not asked twice', async () => {
    const user = userEvent.setup();
    const gate = deferred<unknown>();
    const view = boot(portal, 'drive', { wait: { disconnect: gate.promise } });
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    const button = part('disconnect') as HTMLButtonElement;
    await user.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    await user.click(button);
    gate.resolve(null);
    await waitFor(() => expect(part('connectBtn')).not.toBeNull());
    expect(view.calls(view.base + '/disconnect')).toHaveLength(1);
  });

  it('says in a message at the foot when the link could not be let go, and stays as it was', async () => {
    const user = userEvent.setup();
    boot(portal, 'drive', { no: { disconnect: [500, 'Down for now'] } });
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    await user.click(part('disconnect')!);
    expect(await screen.findByText('Down for now')).toBeTruthy();
    expect(part('account')).not.toBeNull();
    expect((part('disconnect') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the account and the way to let go of it when Google would not list the files, and says why in Google’s words', async () => {
    boot(portal, 'drive', {
      no: { files: [500, 'Request had insufficient authentication scopes.'] },
    });
    await waitFor(() => expect(part('error')).not.toBeNull());
    expect(text('error')).toBe('Request had insufficient authentication scopes.');
    expect(text('accountName')).toBe('Ana A.');
    expect(part('disconnect')).not.toBeNull();
    expect(part('table')).toBeNull();
    expect(part('error')!.getAttribute('role')).toBe('alert');
  });

  it('says why when the link itself could not be read, and offers nothing', async () => {
    boot(portal, 'drive', { no: { status: [500, 'Down for now'] } });
    await waitFor(() => expect(part('error')).not.toBeNull());
    expect(text('error')).toBe('Down for now');
    expect(part('connectBtn')).toBeNull();
    expect(part('account')).toBeNull();
  });

  it('reads it all again each time it is opened', async () => {
    const view = boot(portal, 'drive');
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(view.calls(view.base + '/status')).toHaveLength(1);
    expect(view.calls(view.base + '/files')).toHaveLength(1);
    expect(view.calls(view.base + '/sheets')).toHaveLength(0);
  });
});

describe('My Drive, in the admin’s portal', () => {
  it('sets the account and the files in the page body that the administrator’s pages have, and the team’s has none', async () => {
    boot('admin', 'drive');
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(part('pageBody')!.contains(part('account')!)).toBe(true);
    expect(part('pageBody')!.contains(part('tableCard')!)).toBe(true);
    cleanup();
    boot('team', 'drive');
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(part('pageBody')).toBeNull();
  });

  it('tells a link made before uploads were asked for to make it again, and goes to Google when it is asked to', async () => {
    const user = userEvent.setup();
    boot('admin', 'drive', { status: { ...LINKED, canUpload: false } });
    await waitFor(() => expect(part('reconnectNotice')).not.toBeNull());
    expect(text('reconnectNotice')!.replace(/\s+/g, ' ').trim()).toBe(
      'This connection was authorised before uploads were supported, so attaching a client file will fail. Reconnect to fix it.',
    );
    const link = within(part('reconnectNotice')!).getByText('Reconnect');
    expect(link.tagName).toBe('A');
    await user.click(link);
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/drive/connect?_t=adm-tok');
    // (it did not follow the link's own address)
    expect(window.location.hash).toBe('');
  });

  it('says nothing of it when the link can upload', async () => {
    boot('admin', 'drive');
    await waitFor(() => expect(part('account')).not.toBeNull());
    expect(part('reconnectNotice')).toBeNull();
  });

  it('shows the notice above the files, not instead of them', async () => {
    boot('admin', 'drive', { status: { ...LINKED, canUpload: false } });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    const notice = part('reconnectNotice')!;
    const table = part('tableCard')!;
    expect(notice.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('My Drive, in the team’s portal', () => {
  it('has never told anyone about the old link, even one that cannot upload', async () => {
    boot('team', 'drive', { status: { ...LINKED, canUpload: false } });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(part('reconnectNotice')).toBeNull();
  });

  it('says so, in words, to a member who may read spreadsheets and not the Drive status that says whose account it is', async () => {
    boot('team', 'sheets', { no: { status: [403, 'Not permitted'] } });
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    expect(text('connectSub')).toBe('Google Drive is not switched on for you. Ask your admin.');
    expect(text('connectTitle')).toBe('My Sheets');
    expect(part('connectBtn')).toBeNull();
    expect(part('error')).toBeNull();
  });

  it('offers a member who may see the files and may not link an account no way to link one', async () => {
    boot(
      'team',
      'drive',
      { status: { configured: true, connected: false } },
      {
        drive: true,
        driveActions: { view: true, connect: false },
      },
    );
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    expect(text('connectSub')).toBe(
      'No Google account is linked. Ask your admin to link one for you.',
    );
    expect(part('connectBtn')).toBeNull();
  });

  it('shows such a member the account that was linked, and no way to let go of it', async () => {
    boot('team', 'drive', {}, { drive: true, driveActions: { view: true, connect: false } });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(text('accountName')).toBe('Ana A.');
    expect(part('disconnect')).toBeNull();
  });

  it('shows a member who may link an account both', async () => {
    boot('team', 'drive', {}, { drive: true, driveActions: { view: true, connect: true } });
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(part('disconnect')).not.toBeNull();
  });

  it('keeps the first column in view when the table is wider than the page', async () => {
    boot('team', 'drive');
    await waitFor(() => expect(parts('fileRow')).toHaveLength(3));
    expect(part('tableScroll')!.contains(part('table'))).toBe(true);
  });
});

describe.each(['admin', 'team'] as const)('My Sheets, in the %s portal', portal => {
  it('asks for the spreadsheets, not for all the files, and calls itself by its own name', async () => {
    const view = boot(portal, 'sheets');
    await waitFor(() => expect(parts('fileRow')).toHaveLength(1));
    expect(names()).toEqual(['Stock count']);
    expect(text('fileCount')).toBe('1 file');
    expect(text('tableTitle')!.replace(/\s+/g, ' ').trim()).toBe(
      portal === 'admin' ? 'Sheets My Sheets' : 'My Sheets',
    );
    expect(view.calls(view.base + '/sheets')).toHaveLength(1);
    expect(view.calls(view.base + '/files')).toHaveLength(0);
    expect(view.calls(view.base + '/status')).toHaveLength(1);
  });

  it('offers to link an account under its own name', async () => {
    boot(portal, 'sheets', { status: { configured: true, connected: false } });
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    expect(text('connectTitle')).toBe('My Sheets');
    if (portal === 'admin') expect(text('connectIcon')).toBe('Sheets');
  });

  it('says there is no Google project here as My Drive does, with the admin’s card still in the name of Drive', async () => {
    boot(portal, 'sheets', { status: { configured: false } });
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    if (portal === 'admin') {
      expect(text('connectIcon')).toBe('Sheets');
      expect(text('connectTitle')).toBe('Connect Google Drive');
    } else {
      expect(text('connectTitle')).toBe('My Sheets');
    }
  });

  it('lets go of the account for both screens at once', async () => {
    const user = userEvent.setup();
    const view = boot(portal, 'sheets');
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    await user.click(part('disconnect')!);
    await waitFor(() => expect(part('connectBtn')).not.toBeNull());
    expect(view.calls(view.base + '/disconnect')).toHaveLength(1);
    expect(part('table')).toBeNull();
  });
});
