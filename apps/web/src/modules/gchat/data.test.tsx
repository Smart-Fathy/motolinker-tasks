import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessOf } from '../../app/access';
import { SessionContext, type SessionValue } from '../../app/context';
import { ApiError, type Me } from '../../lib/api';
import { makeQueryClient } from '../../lib/query';
import { adminMe, deferred, teamMe } from '../../test/helpers';
import {
  messagesKey,
  POLL_MS,
  spacesKey,
  statusKey,
  useChatLink,
  useMessages,
  useRefresh,
  useSend,
  useSpaces,
} from './data';
import { SAID } from './model';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  Reflect.deleteProperty(document, 'visibilityState');
});

type Handler = (body?: unknown) => unknown;

const SPACE = { name: 'spaces/AAA1', title: 'Sales team', type: 'SPACE' };
const MESSAGE = {
  id: 'spaces/AAA1/messages/m1',
  text: 'Hello',
  senderName: 'Ben B.',
  senderId: 'users/22',
  createTime: '2026-10-20T10:03:00Z',
};
const CAPS = { spaces: true, read: true, send: true };
const LINKED = { configured: true, connected: true, email: 'a@b.test', name: 'Ana', caps: CAPS };
const SPACES_PATH = '/api/dashboard/gchat/spaces';
const MESSAGES_PATH = '/api/dashboard/gchat/messages?space=spaces%2FAAA1';
const SEND_PATH = '/api/dashboard/gchat/messages';

/**
 * The hooks, mounted under a fake session whose server answers `METHOD path` with what the test gives it (a thrown error is a
 * refusal; a path nobody listed is a 404).
 */
function setup(
  routes: Record<string, Handler>,
  { me = adminMe(), portal = 'admin' }: { me?: Me; portal?: 'admin' | 'team' } = {},
) {
  const asked: string[] = [];
  const sent: { path: string; body: unknown }[] = [];
  const run = async (method: string, path: string, body?: unknown) => {
    const key = `${method} ${path}`;
    asked.push(key);
    if (method === 'POST') sent.push({ path, body });
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
    client,
    api,
    toasts,
    asked,
    sent,
    times: (key: string) => asked.filter(a => a === key).length,
  };
}

const TEAM = { portal: 'team', me: teamMe({ gchat: true }) } as const;

/** The page goes out of view, and comes back into it (the browser tells the page when it does). */
const seen = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });
};
const leave = async () => {
  seen('hidden');
  await vi.advanceTimersByTimeAsync(0);
};
const comeBack = async () => {
  seen('visible');
  await vi.advanceTimersByTimeAsync(50);
};

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  localStorage.setItem('ml_admin_token', 'adm-tok');
  localStorage.setItem('ml_emp_token', 'emp-tok');
});

describe('whose Google Chat is linked', () => {
  it('asks the administrator’s route, under /api/dashboard', async () => {
    const s = setup({ 'GET /api/dashboard/gchat/status': () => LINKED });
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(s.asked).toEqual(['GET /api/dashboard/gchat/status']);
    expect(result.current.link).toEqual({
      state: 'linked',
      email: 'a@b.test',
      name: 'Ana',
      caps: CAPS,
    });
  });

  it('asks the team’s route, under /api/employee', async () => {
    const s = setup({ 'GET /api/employee/gchat/status': () => LINKED }, TEAM);
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(s.asked).toEqual(['GET /api/employee/gchat/status']);
    expect(result.current.link?.state).toBe('linked');
  });

  it('reads each of the four things a status can say', async () => {
    const says: [unknown, unknown][] = [
      [{ configured: false }, { state: 'unconfigured' }],
      [{ configured: true, connected: false }, { state: 'unlinked' }],
      [
        { configured: true, connected: false, reconnect: true, email: 'a@b.test' },
        { state: 'lost', email: 'a@b.test' },
      ],
      [LINKED, { state: 'linked', email: 'a@b.test', name: 'Ana', caps: CAPS }],
    ];
    for (const [status, link] of says) {
      const s = setup({ 'GET /api/dashboard/gchat/status': () => status });
      const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.link).toEqual(link);
      cleanup();
    }
  });

  it('is told when the person may not ask (a team member with the screen and not the right to see it)', async () => {
    const s = setup(
      {
        'GET /api/employee/gchat/status': () => {
          throw new ApiError(403, 'Not permitted');
        },
      },
      TEAM,
    );
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.forbidden).toBe(true);
    expect(result.current.link).toBeNull();
  });

  it('does not take an answer it does not know for one', async () => {
    const s = setup({ 'GET /api/dashboard/gchat/status': () => ({ configured: 'maybe' }) });
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.link).toBeNull();
    expect(result.current.error).toBe(SAID.strange);
  });

  it('puts away what was read with a link when the link is let go of (the spaces and the messages), and reads whose it is anew', async () => {
    const s = setup({
      'GET /api/dashboard/gchat/status': () => LINKED,
      'POST /api/dashboard/gchat/disconnect': () => ({ ok: true }),
    });
    s.client.setQueryData(spacesKey('admin'), { ok: true, spaces: [SPACE] });
    s.client.setQueryData(messagesKey('admin', 'spaces/AAA1'), { ok: true, messages: [MESSAGE] });
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(s.client.getQueryData(spacesKey('admin'))).toBeDefined();
    expect(s.client.getQueryData(messagesKey('admin', 'spaces/AAA1'))).toBeDefined();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.disconnect();
    });
    expect(outcome).toEqual({ ok: true, value: undefined });
    expect(s.times('POST /api/dashboard/gchat/disconnect')).toBe(1);
    expect(s.client.getQueryData(spacesKey('admin'))).toBeUndefined();
    expect(s.client.getQueryData(messagesKey('admin', 'spaces/AAA1'))).toBeUndefined();
    // (and whose account it is is asked anew)
    await waitFor(() => expect(s.times('GET /api/dashboard/gchat/status')).toBe(2));
  });

  it('goes to Google with the session in the address, the administrator’s at once', async () => {
    const s = setup({ 'GET /api/dashboard/gchat/status': () => LINKED });
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/dashboard/gchat/connect?_t=adm-tok');
    expect(s.asked).toEqual(['GET /api/dashboard/gchat/status']);
  });

  it('…and the team’s once it has asked that the session is still good', async () => {
    const s = setup(
      {
        'GET /api/employee/gchat/status': () => LINKED,
        'GET /api/employee/check': () => ({ ok: true }),
      },
      TEAM,
    );
    const { result } = renderHook(() => useChatLink(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.connect());
    expect(s.asked).toEqual(['GET /api/employee/gchat/status', 'GET /api/employee/check']);
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/employee/gchat/connect?_t=emp-tok');
  });
});

describe('what is kept, and for whom', () => {
  it('is kept for one person at a time, and what was read with a link under one root (so a link let go of takes it all with it)', () => {
    expect(statusKey('admin')).toEqual(['google-chat', 'status', 'admin']);
    expect(spacesKey('admin')).toEqual(['google-chat', 'chat', 'spaces', 'admin']);
    expect(messagesKey('admin', 'spaces/AAA1')).toEqual([
      'google-chat',
      'chat',
      'messages',
      'admin',
      'spaces/AAA1',
    ]);
    expect(statusKey('employee_5')).not.toEqual(statusKey('admin'));
    expect(spacesKey('employee_5')).not.toEqual(spacesKey('admin'));
    expect(messagesKey('admin', 'spaces/BBB2')).not.toEqual(messagesKey('admin', 'spaces/AAA1'));
  });
});

describe('the spaces', () => {
  it('are asked for once there is a link to ask with', async () => {
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [SPACE] }) });
    const { result } = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toEqual({ ok: true, spaces: [SPACE] });
    expect(s.asked).toEqual([`GET ${SPACES_PATH}`]);
  });

  it('are not asked for before then', async () => {
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [SPACE] }) });
    const { result } = renderHook(() => useSpaces(false), { wrapper: s.wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
    expect(s.asked).toEqual([]);
  });

  it('are the team’s own, from the team’s route', async () => {
    const s = setup({ 'GET /api/employee/gchat/spaces': () => ({ spaces: [SPACE] }) }, TEAM);
    const { result } = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.result?.ok).toBe(true));
    expect(s.asked).toEqual(['GET /api/employee/gchat/spaces']);
  });

  it('say why there are none: forbidden, a link to make again, or anything else', async () => {
    const says: [string, unknown][] = [
      ['forbidden', { ok: false, reason: 'forbidden' }],
      ['reconnect', { ok: false, reason: 'reconnect' }],
      ['failed', { ok: false, reason: 'failed' }],
      ['not_connected', { ok: false, reason: 'failed' }],
    ];
    for (const [error, result] of says) {
      const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [], error, detail: 'x' }) });
      const hook = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
      await waitFor(() => expect(hook.result.current.result).not.toBeNull());
      expect(hook.result.current.result).toEqual(result);
      cleanup();
    }
  });

  it('are Chat being out of reach when the call did not go (as the classic pages tell it)', async () => {
    const s = setup({
      [`GET ${SPACES_PATH}`]: () => {
        throw new ApiError(0, 'Cannot reach the server.');
      },
    });
    const { result } = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result).toEqual({ ok: false, reason: 'failed' });
  });

  it('are Chat being out of reach when the server refuses (a grant that is off, say)', async () => {
    const s = setup({
      [`GET ${SPACES_PATH}`]: () => {
        throw new ApiError(403, 'Not permitted');
      },
    });
    const { result } = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result).toEqual({ ok: false, reason: 'failed' });
  });

  it('are not made up out of an answer that is not a list', async () => {
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: 'lots' }) });
    const { result } = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result).toEqual({ ok: false, reason: 'failed' });
  });

  it('are asked for again on every visit, and nothing is kept for the next', async () => {
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [SPACE] }) });
    const first = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.result).not.toBeNull());
    first.unmount();
    await new Promise(r => setTimeout(r, 30));
    const second = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    // (the loader, and not the last visit's list while it asks again)
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.result).toBeNull();
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(s.times(`GET ${SPACES_PATH}`)).toBe(2);
  });

  it('are asked again by a page that opens while another still holds what was read (a visit never shows an older visit’s list)', async () => {
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [SPACE] }) });
    const first = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.result).not.toBeNull());
    const second = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times(`GET ${SPACES_PATH}`)).toBe(2));
    await waitFor(() => expect(second.result.current.result).not.toBeNull());
  });

  it('are not asked again because the person came back to the page, however long they were away (the list changes when they say so)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [SPACE] }) });
    const view = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(view.result.current.result).not.toBeNull());
    await leave();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await comeBack();
    expect(s.times(`GET ${SPACES_PATH}`)).toBe(1);
  });

  it('are asked with a way to take the question back, so that a visit that ends does not leave one behind', async () => {
    const s = setup({ [`GET ${SPACES_PATH}`]: () => ({ spaces: [SPACE] }) });
    const view = renderHook(() => useSpaces(true), { wrapper: s.wrapper });
    await waitFor(() => expect(view.result.current.result).not.toBeNull());
    const [, options] = s.api.get.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('the messages of a space', () => {
  it('are asked for by the space’s address, in the team’s route as in the administrator’s', async () => {
    const a = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const ha = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: a.wrapper });
    await waitFor(() => expect(ha.result.current.result).not.toBeNull());
    expect(ha.result.current.result).toEqual({ ok: true, messages: [MESSAGE] });
    expect(a.asked).toEqual([`GET ${MESSAGES_PATH}`]);
    cleanup();
    const t = setup(
      { 'GET /api/employee/gchat/messages?space=spaces%2FAAA1': () => ({ messages: [] }) },
      TEAM,
    );
    const ht = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: t.wrapper });
    await waitFor(() => expect(ht.result.current.result).not.toBeNull());
    expect(t.asked).toEqual(['GET /api/employee/gchat/messages?space=spaces%2FAAA1']);
  });

  it('are not asked for with no space open, or where the link may not read', async () => {
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const none = renderHook(() => useMessages(null, true), { wrapper: s.wrapper });
    const unread = renderHook(() => useMessages('spaces/AAA1', false), { wrapper: s.wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(none.result.current).toMatchObject({ loading: false, result: null });
    expect(unread.result.current).toMatchObject({ loading: false, result: null });
    expect(s.asked).toEqual([]);
  });

  it('say why there are none, with Google’s words where it gave some', async () => {
    const s = setup({
      [`GET ${MESSAGES_PATH}`]: () => ({ messages: [], error: 'forbidden', detail: 'No way' }),
    });
    const { result } = renderHook(() => useMessages('spaces/AAA1', true), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result).toEqual({ ok: false, reason: 'forbidden', detail: 'No way' });
  });

  it('are Chat being out of reach when the call did not go, and when the answer is not a list', async () => {
    const down = setup({
      [`GET ${MESSAGES_PATH}`]: () => {
        throw new ApiError(0, 'Cannot reach the server.');
      },
    });
    const a = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: down.wrapper });
    await waitFor(() => expect(a.result.current.result).not.toBeNull());
    expect(a.result.current.result).toEqual({ ok: false, reason: 'failed', detail: '' });
    cleanup();
    const odd = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: 7 }) });
    const b = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: odd.wrapper });
    await waitFor(() => expect(b.result.current.result).not.toBeNull());
    expect(b.result.current.result).toEqual({ ok: false, reason: 'failed', detail: '' });
  });

  it('are asked for again every twenty seconds for as long as they are on the page', async () => {
    // (twenty seconds as the classic pages count them: setInterval(…, 20000))
    expect(POLL_MS).toBe(20_000);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const { unmount } = renderHook(() => useMessages('spaces/AAA1', true), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS - 500);
    });
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(3);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(3);
  });

  it('are not asked for again while the page is out of view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(1));
    const seen = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2 + 100);
    });
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(1);
    seen.mockReturnValue('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    });
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBeGreaterThan(1);
  });

  it('are asked for again at once when the screen says so (after a send)', async () => {
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const { result } = renderHook(() => useMessages('spaces/AAA1', true), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    act(() => result.current.again());
    await waitFor(() => expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(2));
    // (and what is on the page stays there while it asks: no loader over a conversation that is being added to)
    expect(result.current.loading).toBe(false);
    expect(result.current.result?.ok).toBe(true);
  });

  it('are asked for again on every visit, and nothing is kept for the next (not the last visit’s messages while it asks)', async () => {
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const first = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.result).not.toBeNull());
    first.unmount();
    await new Promise(r => setTimeout(r, 30));
    const second = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.result).toBeNull();
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(2);
  });

  it('are asked again by a page that opens while another still holds what was read', async () => {
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const first = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.result).not.toBeNull());
    const second = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(2));
    await waitFor(() => expect(second.result.current.result).not.toBeNull());
  });

  it('are asked with a way to take the question back, so that leaving a space does not leave one behind', async () => {
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const view = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(view.result.current.result).not.toBeNull());
    const [, options] = s.api.get.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('are asked for at once when the person comes back to a page they had been away from for longer than a tick, and not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const view = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(view.result.current.result).not.toBeNull());
    await leave();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    // (the clock does not run while the page is out of view)
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(1);
    await comeBack();
    await waitFor(() => expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(2));
  });

  it('are not asked for again at once by a person who was away for less than a tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const view = renderHook(() => useMessages('spaces/AAA1', true), { wrapper: s.wrapper });
    await waitFor(() => expect(view.result.current.result).not.toBeNull());
    await leave();
    await vi.advanceTimersByTimeAsync(POLL_MS / 4);
    await comeBack();
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(1);
  });

  it('have the loader again for another space, not the last one’s messages', async () => {
    const other = '/api/dashboard/gchat/messages?space=spaces%2FBBB2';
    const gate = deferred<unknown>();
    const s = setup({
      [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }),
      [`GET ${other}`]: () => gate.promise,
    });
    const { result, rerender } = renderHook(({ space }) => useMessages(space, true), {
      wrapper: s.wrapper,
      initialProps: { space: 'spaces/AAA1' },
    });
    await waitFor(() => expect(result.current.result?.ok).toBe(true));
    rerender({ space: 'spaces/BBB2' });
    expect(result.current.loading).toBe(true);
    expect(result.current.result).toBeNull();
    gate.resolve({ messages: [] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toEqual({ ok: true, messages: [] });
  });

  it('look different to different people', async () => {
    const s = setup({ [`GET ${MESSAGES_PATH}`]: () => ({ messages: [MESSAGE] }) });
    const { result } = renderHook(() => useMessages('spaces/AAA1', true), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    const keys = s.client
      .getQueryCache()
      .getAll()
      .map(q => q.queryKey);
    expect(keys).toEqual([['google-chat', 'chat', 'messages', 'admin', 'spaces/AAA1']]);
  });
});

describe('sending', () => {
  it('posts the space and the words to the route of the portal, and says it went', async () => {
    const s = setup({ [`POST ${SEND_PATH}`]: () => ({ ok: true, id: 'spaces/AAA1/messages/n1' }) });
    const { result } = renderHook(() => useSend(), { wrapper: s.wrapper });
    await expect(result.current('spaces/AAA1', 'Hello')).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(s.sent).toEqual([{ path: SEND_PATH, body: { space: 'spaces/AAA1', text: 'Hello' } }]);
  });

  it('posts to the team’s route in the team’s portal', async () => {
    const s = setup({ 'POST /api/employee/gchat/messages': () => ({ ok: true }) }, TEAM);
    const { result } = renderHook(() => useSend(), { wrapper: s.wrapper });
    await expect(result.current('spaces/AAA1', 'Hello')).resolves.toMatchObject({ ok: true });
    expect(s.sent[0]?.path).toBe('/api/employee/gchat/messages');
  });

  it('says Google’s own words where Chat said no, and a sentence where it gave none', async () => {
    for (const [answer, message] of [
      [
        { ok: false, error: 'forbidden', detail: 'Request had insufficient scopes.' },
        'Request had insufficient scopes.',
      ],
      [{ ok: false, error: 'reconnect' }, 'Your Google session expired.'],
      [{ ok: false, error: 'forbidden' }, SAID.forbidden],
      [{ ok: false, error: 'not_connected' }, 'Google Chat is not connected.'],
      [{ ok: false, error: 'failed' }, SAID.unreachable],
    ] as const) {
      const s = setup({ [`POST ${SEND_PATH}`]: () => answer });
      const { result } = renderHook(() => useSend(), { wrapper: s.wrapper });
      await expect(result.current('spaces/AAA1', 'Hello')).resolves.toEqual({ ok: false, message });
      cleanup();
    }
  });

  it('puts into words the refusals the route makes itself (no such space, nothing to say)', async () => {
    for (const [error, message] of [
      ['bad_space', 'That space could not be found.'],
      ['empty', 'There is nothing to send.'],
    ] as const) {
      const s = setup({
        [`POST ${SEND_PATH}`]: () => {
          throw new ApiError(400, error);
        },
      });
      const { result } = renderHook(() => useSend(), { wrapper: s.wrapper });
      await expect(result.current('spaces/AAA1', 'x')).resolves.toEqual({ ok: false, message });
      cleanup();
    }
  });

  it('tells the server’s words for any other refusal, and the failure of a call that did not go', async () => {
    const denied = setup({
      [`POST ${SEND_PATH}`]: () => {
        throw new ApiError(403, 'Not permitted');
      },
    });
    const a = renderHook(() => useSend(), { wrapper: denied.wrapper });
    await expect(a.result.current('spaces/AAA1', 'x')).resolves.toEqual({
      ok: false,
      message: 'Not permitted',
    });
    cleanup();
    const down = setup({
      [`POST ${SEND_PATH}`]: () => {
        throw new ApiError(0, 'Cannot reach the server.');
      },
    });
    const b = renderHook(() => useSend(), { wrapper: down.wrapper });
    await expect(b.result.current('spaces/AAA1', 'x')).resolves.toEqual({
      ok: false,
      message: 'Cannot reach the server.',
    });
  });

  it('tells the words of a failure that was not the server’s as they are, and never puts the route’s own words into a thing that is not its refusal', async () => {
    const failing = (thrown: unknown) => {
      const s = setup({
        [`POST ${SEND_PATH}`]: () => {
          throw thrown;
        },
      });
      return renderHook(() => useSend(), { wrapper: s.wrapper }).result.current;
    };
    await expect(failing(new Error('boom'))('spaces/AAA1', 'x')).resolves.toEqual({
      ok: false,
      message: 'boom',
    });
    await expect(failing('plain words')('spaces/AAA1', 'x')).resolves.toEqual({
      ok: false,
      message: 'plain words',
    });
    // (a 400 is the route's own refusal only when it is the server's: something else that happens to carry that number is not)
    await expect(
      failing(Object.assign(new Error('empty'), { status: 400 }))('spaces/AAA1', 'x'),
    ).resolves.toEqual({ ok: false, message: 'empty' });
  });

  it('does not tell an answer it does not know as either', async () => {
    const s = setup({ [`POST ${SEND_PATH}`]: () => ({ ok: 'maybe' }) });
    const { result } = renderHook(() => useSend(), { wrapper: s.wrapper });
    await expect(result.current('spaces/AAA1', 'x')).resolves.toEqual({
      ok: false,
      message: SAID.strangeSend,
    });
  });
});

describe('starting the page over', () => {
  it('asks the spaces and the open conversation again, and not whose account it is, where there is a link', async () => {
    let holdSpaces: Promise<unknown> | null = null;
    let holdMessages: Promise<unknown> | null = null;
    const s = setup({
      'GET /api/dashboard/gchat/status': () => LINKED,
      [`GET ${SPACES_PATH}`]: () => holdSpaces ?? { spaces: [SPACE] },
      [`GET ${MESSAGES_PATH}`]: () => holdMessages ?? { messages: [MESSAGE] },
    });
    const hooks = renderHook(
      () => ({
        link: useChatLink(),
        spaces: useSpaces(true),
        messages: useMessages('spaces/AAA1', true),
        refresh: useRefresh(),
      }),
      { wrapper: s.wrapper },
    );
    await waitFor(() => expect(hooks.result.current.messages.result).not.toBeNull());
    expect(hooks.result.current.spaces.result).not.toBeNull();
    const spaces = deferred<unknown>();
    const messages = deferred<unknown>();
    holdSpaces = spaces.promise.then(() => ({ spaces: [SPACE] }));
    holdMessages = messages.promise.then(() => ({ messages: [MESSAGE] }));
    act(() => hooks.result.current.refresh(true));
    // (the loader first, as the classic pages draw it, and then the answer)
    await waitFor(() => expect(hooks.result.current.spaces.loading).toBe(true));
    await waitFor(() => expect(hooks.result.current.messages.loading).toBe(true));
    expect(hooks.result.current.spaces.result).toBeNull();
    expect(hooks.result.current.messages.result).toBeNull();
    spaces.resolve(null);
    messages.resolve(null);
    await waitFor(() => expect(hooks.result.current.spaces.loading).toBe(false));
    await waitFor(() => expect(hooks.result.current.messages.loading).toBe(false));
    expect(s.times(`GET ${SPACES_PATH}`)).toBe(2);
    expect(s.times(`GET ${MESSAGES_PATH}`)).toBe(2);
    expect(s.times('GET /api/dashboard/gchat/status')).toBe(1);
  });

  it('asks whose account it is again, where there is none to ask with', async () => {
    let hold: Promise<unknown> | null = null;
    const s = setup({
      'GET /api/dashboard/gchat/status': () => hold ?? { configured: true, connected: false },
    });
    const hooks = renderHook(() => ({ link: useChatLink(), refresh: useRefresh() }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(hooks.result.current.link.loading).toBe(false));
    const answer = deferred<unknown>();
    hold = answer.promise.then(() => ({ configured: true, connected: false }));
    act(() => hooks.result.current.refresh(false));
    await waitFor(() => expect(hooks.result.current.link.loading).toBe(true));
    answer.resolve(null);
    await waitFor(() => expect(hooks.result.current.link.loading).toBe(false));
    expect(s.times('GET /api/dashboard/gchat/status')).toBe(2);
  });
});
