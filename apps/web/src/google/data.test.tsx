import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessOf } from '../app/access';
import { SessionContext, type SessionValue } from '../app/context';
import { ApiError, type Me } from '../lib/api';
import { makeQueryClient } from '../lib/query';
import { adminMe, teamMe } from '../test/helpers';
import { useDriveFiles, useDriveLink } from './data';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

type Handler = (body?: unknown) => unknown;

const FILE = { id: 'f1', name: 'Price list', mimeType: 'application/pdf' };
const LINKED = {
  configured: true,
  connected: true,
  email: 'a@b.test',
  name: 'Ana',
  canUpload: true,
};

/**
 * The hooks, mounted under a fake session whose server answers `METHOD path` with what the test gives it (a thrown error is a
 * refusal; a path nobody listed is a 404).
 */
function setup(
  routes: Record<string, Handler>,
  { me = adminMe(), portal = 'admin' }: { me?: Me; portal?: 'admin' | 'team' } = {},
) {
  const asked: string[] = [];
  const run = async (method: string, path: string, body?: unknown) => {
    const key = `${method} ${path}`;
    asked.push(key);
    const handler = routes[key];
    if (!handler) throw new ApiError(404, `no route ${key}`);
    return handler(body);
  };
  const api = {
    base: portal === 'admin' ? '/api/dashboard' : '/api/employee',
    get: vi.fn((path: string) => run('GET', path)),
    post: vi.fn((path: string, body?: unknown) => run('POST', path, body)),
  };
  const toasts = { show: vi.fn() };
  const client = makeQueryClient();
  const value = { portal, me, access: accessOf(me), api, toasts } as unknown as SessionValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionContext value={value}>{children}</SessionContext>
    </QueryClientProvider>
  );
  return {
    wrapper,
    api,
    toasts,
    asked,
    times: (key: string) => asked.filter(a => a === key).length,
  };
}

const TEAM = { portal: 'team', me: teamMe({ drive: true, sheets: true }) } as const;

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
});

describe('whose Google account is linked', () => {
  it('asks the administrator’s own route, which is not under /api/dashboard', async () => {
    const s = setup({ 'GET /api/drive/status': () => LINKED });
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(s.asked).toEqual(['GET /api/drive/status']);
    expect(result.current.link).toEqual({
      state: 'linked',
      email: 'a@b.test',
      name: 'Ana',
      canUpload: true,
    });
    expect(result.current.error).toBeNull();
    expect(result.current.forbidden).toBe(false);
  });

  it('asks the team’s route for a team member', async () => {
    const s = setup({ 'GET /api/employee/drive/status': () => LINKED }, TEAM);
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(s.asked).toEqual(['GET /api/employee/drive/status']);
    expect(result.current.link?.state).toBe('linked');
  });

  it('reads the three states', async () => {
    for (const [body, state] of [
      [{ configured: false }, 'unconfigured'],
      [{ configured: true, connected: false }, 'unlinked'],
      [LINKED, 'linked'],
    ] as const) {
      const s = setup({ 'GET /api/drive/status': () => body });
      const { result, unmount } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.link?.state).toBe(state);
      unmount();
    }
  });

  it('says so when the person may not ask (the team’s status needs the Drive grant)', async () => {
    const s = setup(
      {
        'GET /api/employee/drive/status': () => {
          throw new ApiError(403, 'Not permitted');
        },
      },
      TEAM,
    );
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.forbidden).toBe(true);
    expect(result.current.error).toBe('Not permitted');
    expect(result.current.link).toBeNull();
    expect(s.times('GET /api/employee/drive/status')).toBe(1);
  });

  it('is not “forbidden” by any other refusal: they are words to tell, and no more', async () => {
    for (const status of [0, 401, 404, 500]) {
      const s = setup({
        'GET /api/drive/status': () => {
          throw new ApiError(status, 'Nope ' + status);
        },
      });
      const { result, unmount } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.forbidden).toBe(false);
      expect(result.current.error).toBe('Nope ' + status);
      unmount();
    }
  });

  it('does not take an answer it does not know for one', async () => {
    for (const body of [
      null,
      'x',
      [],
      {},
      { configured: true },
      { configured: true, connected: true },
    ]) {
      const s = setup({ 'GET /api/drive/status': () => body });
      const { result, unmount } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.link).toBeNull();
      expect(result.current.error).toMatch(/form this app does not know/);
      unmount();
    }
  });

  it('does not ask again and again for an answer that was refused', async () => {
    const s = setup({
      'GET /api/drive/status': () => {
        throw new ApiError(500, 'Down');
      },
    });
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await new Promise(r => setTimeout(r, 30));
    expect(s.times('GET /api/drive/status')).toBe(1);
  });
});

describe('whose account it is is not carried from one person to the next', () => {
  // A hook that stays mounted while the person it speaks for changes (it should never happen, and the cache must not make it worse):
  // what was read for one is not shown as what is true for the other.
  function twoPeople(status: () => unknown, files: () => unknown) {
    const client = makeQueryClient();
    const holder = { me: adminMe() as Me };
    const api = {
      base: '/api/dashboard',
      get: vi.fn(async (path: string) => (path.endsWith('/status') ? status() : files())),
      post: vi.fn(),
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <SessionContext
          value={
            {
              portal: 'admin',
              me: holder.me,
              access: accessOf(holder.me),
              api,
              toasts: { show: vi.fn() },
            } as unknown as SessionValue
          }
        >
          {children}
        </SessionContext>
      </QueryClientProvider>
    );
    const other = (): Me => {
      const me = adminMe();
      return { ...me, actor: { ...me.actor, key: 'employee_9' } } as Me;
    };
    return { holder, wrapper, other, api };
  }

  it('asks again, and shows the loader, for a different person', async () => {
    let answer: unknown = LINKED;
    const t = twoPeople(
      () => answer,
      () => [],
    );
    const { result, rerender } = renderHook(() => useDriveLink(), { wrapper: t.wrapper });
    await waitFor(() => expect(result.current.link?.state).toBe('linked'));
    answer = { configured: true, connected: false };
    t.holder.me = t.other();
    rerender();
    expect(result.current.loading).toBe(true);
    expect(result.current.link).toBeNull();
    await waitFor(() => expect(result.current.link?.state).toBe('unlinked'));
  });

  it('keeps the files of one person from another, and of one screen from the other', async () => {
    let answer: unknown = [FILE];
    const t = twoPeople(
      () => LINKED,
      () => answer,
    );
    const { result, rerender } = renderHook(
      ({ kind }: { kind: 'drive' | 'sheets' }) => useDriveFiles(kind, true),
      {
        wrapper: t.wrapper,
        initialProps: { kind: 'drive' as 'drive' | 'sheets' },
      },
    );
    await waitFor(() => expect(result.current.files).toEqual([FILE]));
    answer = [];
    t.holder.me = t.other();
    rerender({ kind: 'drive' });
    expect(result.current.loading).toBe(true);
    expect(result.current.files).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    answer = [FILE];
    rerender({ kind: 'sheets' });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.files).toEqual([FILE]));
  });

  it('forgets the account when the screen is left, so that the next visit starts with the loader and not with what was true last time', async () => {
    let answer: unknown = LINKED;
    const t = twoPeople(
      () => answer,
      () => [FILE],
    );
    const first = renderHook(() => useDriveLink(), { wrapper: t.wrapper });
    await waitFor(() => expect(first.result.current.link?.state).toBe('linked'));
    first.unmount();
    await new Promise(r => setTimeout(r, 30));
    answer = { configured: true, connected: false };
    const second = renderHook(() => useDriveLink(), { wrapper: t.wrapper });
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.link).toBeNull();
    await waitFor(() => expect(second.result.current.link?.state).toBe('unlinked'));
  });

  it('forgets the files in the same way', async () => {
    let answer: unknown = [FILE];
    const t = twoPeople(
      () => LINKED,
      () => answer,
    );
    const first = renderHook(() => useDriveFiles('drive', true), { wrapper: t.wrapper });
    await waitFor(() => expect(first.result.current.files).toEqual([FILE]));
    first.unmount();
    await new Promise(r => setTimeout(r, 30));
    answer = [];
    const second = renderHook(() => useDriveFiles('drive', true), { wrapper: t.wrapper });
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.files).toEqual([]);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
  });
});

describe('going to Google', () => {
  it('takes the administrator straight there, with the session in the address (a navigation carries no header)', async () => {
    localStorage.setItem('ml_admin_token', 'adm tok/1');
    const s = setup({ 'GET /api/drive/status': () => ({ configured: true, connected: false }) });
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/drive/connect?_t=adm%20tok%2F1');
    expect(s.asked).toEqual(['GET /api/drive/status']);
  });

  it('asks a team member’s session first, and then goes', async () => {
    localStorage.setItem('ml_emp_token', 'emp-tok');
    const s = setup(
      {
        'GET /api/employee/drive/status': () => ({ configured: true, connected: false }),
        'GET /api/employee/check': () => ({ ok: true }),
      },
      TEAM,
    );
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(s.asked).toEqual(['GET /api/employee/drive/status', 'GET /api/employee/check']);
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/employee/drive/connect?_t=emp-tok');
    expect(s.toasts.show).not.toHaveBeenCalled();
  });

  it('stays, and says why, when the server cannot be reached', async () => {
    localStorage.setItem('ml_emp_token', 'emp-tok');
    const s = setup(
      {
        'GET /api/employee/drive/status': () => ({ configured: true, connected: false }),
        'GET /api/employee/check': () => {
          throw new ApiError(0, 'Cannot reach the server. Check the connection and try again.');
        },
      },
      TEAM,
    );
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(assign).not.toHaveBeenCalled();
    expect(s.toasts.show).toHaveBeenCalledExactlyOnceWith(
      'Cannot reach the server — try again in a moment.',
    );
  });

  it('stays, and does not say the server cannot be reached, when it answered with an error of its own', async () => {
    localStorage.setItem('ml_emp_token', 'emp-tok');
    for (const status of [403, 404, 500, 502]) {
      const s = setup(
        {
          'GET /api/employee/drive/status': () => ({ configured: true, connected: false }),
          'GET /api/employee/check': () => {
            throw new ApiError(status, 'Nope ' + status);
          },
        },
        TEAM,
      );
      const { result, unmount } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(() => result.current.connect());
      expect(assign).not.toHaveBeenCalled();
      expect(s.toasts.show).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('stays, and says nothing, when the session is over (the app has dealt with that)', async () => {
    localStorage.setItem('ml_emp_token', 'emp-tok');
    const s = setup(
      {
        'GET /api/employee/drive/status': () => ({ configured: true, connected: false }),
        'GET /api/employee/check': () => {
          throw new ApiError(401, 'Unauthorized');
        },
      },
      TEAM,
    );
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(assign).not.toHaveBeenCalled();
    expect(s.toasts.show).not.toHaveBeenCalled();
  });

  it('goes with an empty token where the browser has none (the server turns that away, as it does for the classic page)', async () => {
    const s = setup({ 'GET /api/drive/status': () => ({ configured: true, connected: false }) });
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/drive/connect?_t=');
  });
});

describe('letting go', () => {
  it('posts to the portal’s own route, and reads the link again from the beginning', async () => {
    let linked = true;
    const s = setup({
      'GET /api/drive/status': () => (linked ? LINKED : { configured: true, connected: false }),
      'POST /api/drive/disconnect': () => {
        linked = false;
        return { ok: true };
      },
    });
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.link?.state).toBe('linked'));
    let said: Awaited<ReturnType<typeof result.current.disconnect>> | undefined;
    await act(async () => {
      said = await result.current.disconnect();
    });
    expect(said).toEqual({ ok: true, value: undefined });
    await waitFor(() => expect(result.current.link?.state).toBe('unlinked'));
    expect(s.asked).toEqual([
      'GET /api/drive/status',
      'POST /api/drive/disconnect',
      'GET /api/drive/status',
    ]);
  });

  it('posts to the team’s route for a team member', async () => {
    const s = setup(
      {
        'GET /api/employee/drive/status': () => LINKED,
        'POST /api/employee/drive/disconnect': () => ({ ok: true }),
      },
      TEAM,
    );
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.link?.state).toBe('linked'));
    await act(async () => void (await result.current.disconnect()));
    expect(s.times('POST /api/employee/drive/disconnect')).toBe(1);
  });

  it('puts the files away with the link: they are not shown to the next account', async () => {
    let linked = true;
    const s = setup({
      'GET /api/drive/status': () => (linked ? LINKED : { configured: true, connected: false }),
      'GET /api/drive/files': () => [FILE],
      'POST /api/drive/disconnect': () => {
        linked = false;
        return { ok: true };
      },
    });
    const both = renderHook(
      () => {
        const link = useDriveLink();
        const files = useDriveFiles('drive', link.link?.state === 'linked');
        return { link, files };
      },
      { wrapper: s.wrapper },
    );
    await waitFor(() => expect(both.result.current.files.files).toEqual([FILE]));
    await act(async () => void (await both.result.current.link.disconnect()));
    await waitFor(() => expect(both.result.current.link.link?.state).toBe('unlinked'));
    expect(both.result.current.files.files).toEqual([]);
    expect(s.times('GET /api/drive/files')).toBe(1);
  });

  it('tells in words what went wrong, and reads nothing again', async () => {
    const s = setup({
      'GET /api/drive/status': () => LINKED,
      'POST /api/drive/disconnect': () => {
        throw new ApiError(500, 'Down');
      },
    });
    const { result } = renderHook(() => useDriveLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.link?.state).toBe('linked'));
    let said: Awaited<ReturnType<typeof result.current.disconnect>> | undefined;
    await act(async () => {
      said = await result.current.disconnect();
    });
    expect(said).toEqual({ ok: false, message: 'Down' });
    expect(result.current.link?.state).toBe('linked');
    expect(s.times('GET /api/drive/status')).toBe(1);
  });
});

describe('the files', () => {
  it('asks for all of them on My Drive and for the spreadsheets on My Sheets, from the portal’s own routes', async () => {
    const admin = setup({
      'GET /api/drive/files': () => [FILE],
      'GET /api/drive/sheets': () => [{ ...FILE, id: 's1' }],
    });
    const a = renderHook(() => useDriveFiles('drive', true), { wrapper: admin.wrapper });
    const b = renderHook(() => useDriveFiles('sheets', true), { wrapper: admin.wrapper });
    await waitFor(() => expect(a.result.current.files).toEqual([FILE]));
    await waitFor(() => expect(b.result.current.files).toEqual([{ ...FILE, id: 's1' }]));
    expect(admin.asked.sort()).toEqual(['GET /api/drive/files', 'GET /api/drive/sheets']);

    const team = setup(
      {
        'GET /api/employee/drive/files': () => [FILE],
        'GET /api/employee/drive/sheets': () => [],
      },
      TEAM,
    );
    const c = renderHook(() => useDriveFiles('drive', true), { wrapper: team.wrapper });
    const d = renderHook(() => useDriveFiles('sheets', true), { wrapper: team.wrapper });
    await waitFor(() => expect(c.result.current.loading).toBe(false));
    await waitFor(() => expect(d.result.current.loading).toBe(false));
    expect(team.asked.sort()).toEqual([
      'GET /api/employee/drive/files',
      'GET /api/employee/drive/sheets',
    ]);
  });

  it('asks nothing until there is a link to read them with', async () => {
    const s = setup({ 'GET /api/drive/files': () => [FILE] });
    const { result, rerender } = renderHook(({ on }) => useDriveFiles('drive', on), {
      wrapper: s.wrapper,
      initialProps: { on: false },
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.files).toEqual([]);
    await new Promise(r => setTimeout(r, 20));
    expect(s.asked).toEqual([]);
    rerender({ on: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.files).toEqual([FILE]));
  });

  it('tells Google’s own words when it said no', async () => {
    const s = setup({
      'GET /api/drive/files': () => {
        throw new ApiError(500, 'Request had insufficient authentication scopes.');
      },
    });
    const { result } = renderHook(() => useDriveFiles('drive', true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Request had insufficient authentication scopes.');
    expect(result.current.files).toEqual([]);
    await new Promise(r => setTimeout(r, 30));
    expect(s.times('GET /api/drive/files')).toBe(1);
  });

  it('does not take an answer it does not know for a list', async () => {
    for (const body of [null, {}, { files: [FILE] }, [{ id: 3 }], 'x']) {
      const s = setup({ 'GET /api/drive/files': () => body });
      const { result, unmount } = renderHook(() => useDriveFiles('drive', true), {
        wrapper: s.wrapper,
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.files).toEqual([]);
      expect(result.current.error).toMatch(/form this app does not know/);
      unmount();
    }
  });

  it('keeps one person’s files apart from another’s, and one screen’s from the other’s', async () => {
    const s = setup({ 'GET /api/drive/files': () => [FILE], 'GET /api/drive/sheets': () => [] });
    const a = renderHook(() => useDriveFiles('drive', true), { wrapper: s.wrapper });
    await waitFor(() => expect(a.result.current.files).toEqual([FILE]));
    const b = renderHook(() => useDriveFiles('sheets', true), { wrapper: s.wrapper });
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current.files).toEqual([]);
    expect(a.result.current.files).toEqual([FILE]);
  });
});
