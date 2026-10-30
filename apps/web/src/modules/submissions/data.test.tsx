import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../../app/context';
import { ApiError } from '../../lib/api';
import { adminMe } from '../../test/helpers';
import { submissionsKey, useSubmissions } from './data';
import type { Submission } from './model';

afterEach(cleanup);

const row = (id: number): Submission => ({
  id,
  name: `Visitor ${id}`,
  email: `v${id}@example.com`,
  phone: '',
  message: '',
  car_interest: '',
  source: 'website',
  customer_id: null,
  lead_name: '',
  created_at: '2026-09-21T10:30:00.000Z',
});

/** The hook, mounted under a fake session whose server answers with what the test gives it. */
function setup({
  get = async () => ({ items: [row(1), row(2)] }) as unknown,
  del = async () => ({ ok: true }) as unknown,
}: { get?: () => Promise<unknown>; del?: (path: string) => Promise<unknown> } = {}) {
  const me = adminMe();
  const api = { get: vi.fn(get), del: vi.fn(del) };
  // the app's own client keeps a list fresh for 30 s; here nothing is ever fresh, so that only what the hook asks for shows
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const value = { portal: 'admin', me, api } as unknown as SessionValue;
  let seen: ReturnType<typeof useSubmissions> | undefined;
  function Probe() {
    seen = useSubmissions();
    return null;
  }
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <SessionContext value={value}>
          <Probe />
        </SessionContext>
      </QueryClientProvider>,
    );
  const first = mount();
  return {
    api,
    client,
    mount,
    unmount: first.unmount,
    state: () => seen!,
    key: submissionsKey(me.actor.key),
    asked: () => api.get.mock.calls.length,
  };
}

describe('the submissions list', () => {
  it('is kept per person: it is held under the key of the actor who is signed in', () => {
    expect(submissionsKey('admin')).toEqual(['submissions', 'admin']);
    expect(submissionsKey('employee_4')).not.toEqual(submissionsKey('admin'));
  });

  it('is asked of /api/v1/submissions, and is the loader until it comes', async () => {
    const s = setup();
    expect(s.state().loading).toBe(true);
    expect(s.state().items).toEqual([]);
    await waitFor(() => expect(s.state().loading).toBe(false));
    expect(s.state().items.map(i => i.id)).toEqual([1, 2]);
    expect(s.state().error).toBeNull();
    expect(s.api.get).toHaveBeenCalledTimes(1);
    expect(s.api.get.mock.calls[0]).toEqual(['/api/v1/submissions', expect.any(Object)]);
  });

  it('is asked again each time the screen opens, however recently it was asked', async () => {
    const s = setup();
    await waitFor(() => expect(s.asked()).toBe(1));
    s.unmount();
    s.mount();
    await waitFor(() => expect(s.asked()).toBe(2));
  });

  it('is asked again by Refresh', async () => {
    const s = setup();
    await waitFor(() => expect(s.state().loading).toBe(false));
    act(() => s.state().refresh());
    await waitFor(() => expect(s.asked()).toBe(2));
    await waitFor(() => expect(s.state().loading).toBe(false));
  });

  it("says why it could not be had, in the server's words", async () => {
    const s = setup({
      get: async () => {
        throw new ApiError(403, 'You may not read submissions.');
      },
    });
    await waitFor(() => expect(s.state().error).toBe('You may not read submissions.'));
    expect(s.state().items).toEqual([]);
  });

  it('refuses an answer that is not a list, rather than draw what it cannot read', async () => {
    for (const body of [{ rows: [] }, [row(1)], null, 'ok', { items: [{ id: 'x' }] }]) {
      const s = setup({ get: async () => body });
      await waitFor(() =>
        expect(s.state().error).toBe('Submissions came back in a form this app does not know.'),
      );
      expect(s.state().items).toEqual([]);
      s.unmount();
    }
  });

  it('deletes one by its number, and asks for the list again', async () => {
    const s = setup();
    await waitFor(() => expect(s.state().loading).toBe(false));
    let done: boolean | undefined;
    await act(async () => {
      done = await s.state().remove(2);
    });
    expect(done).toBe(true);
    expect(s.api.del).toHaveBeenCalledWith('/api/v1/submissions/2');
    await waitFor(() => expect(s.asked()).toBe(2));
  });

  it('says false when the server would not, and does not ask for the list again', async () => {
    const s = setup({
      del: async () => {
        throw new ApiError(503, 'Submissions are unavailable right now.');
      },
    });
    await waitFor(() => expect(s.state().loading).toBe(false));
    let done: boolean | undefined;
    await act(async () => {
      done = await s.state().remove(1);
    });
    expect(done).toBe(false);
    await new Promise(r => setTimeout(r, 30));
    expect(s.asked()).toBe(1);
  });
});
