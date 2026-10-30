import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../../app/context';
import { ApiError } from '../../lib/api';
import { adminMe } from '../../test/helpers';
import { commentsKey, issuesKey, sendReport, useComments, useIssues } from './data';
import type { Issue, IssueComment } from './model';

afterEach(cleanup);

const ticket = (id: number, over: Partial<Issue> = {}): Issue => ({
  id,
  title: `Ticket ${id}`,
  description: '',
  file_url: '',
  reporter_id: 9,
  reporter_name: 'Sara Ali',
  status: 'open',
  created_at: '2026-10-01T09:30:00.000Z',
  resolved_at: null,
  resolved_by: '',
  ...over,
});
const reply = (id: number, over: Partial<IssueComment> = {}): IssueComment => ({
  id,
  issue_id: 4,
  author_key: 'employee_9',
  author_name: 'Sara Ali',
  body: `Reply ${id}`,
  file_url: '',
  file_name: '',
  file_size: null,
  file_type: '',
  created_at: '2026-10-01T10:00:00.000Z',
  ...over,
});

type Call = (path: string, ...rest: unknown[]) => Promise<unknown>;

/** The hooks, mounted under a fake session whose server answers with what the test gives it. */
function setup({
  get = async () => ({ items: [ticket(4), ticket(5)] }) as unknown,
  patch = async () => ticket(4, { status: 'resolved' }) as unknown,
  post = async () => reply(7) as unknown,
  postForm = async () => ({ ok: true, file: '' }) as unknown,
}: { get?: Call; patch?: Call; post?: Call; postForm?: Call } = {}) {
  const me = adminMe();
  const api = {
    get: vi.fn(get),
    patch: vi.fn(patch),
    post: vi.fn(post),
    postForm: vi.fn(postForm),
  };
  // the app's own client keeps data fresh for 30 s; here nothing is ever fresh, so that only what the hooks ask for shows
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const value = { portal: 'admin', me, api } as unknown as SessionValue;
  const seen: { issues?: ReturnType<typeof useIssues>; comments?: ReturnType<typeof useComments> } =
    {};
  function Probe({ id }: { id: number | null }) {
    seen.issues = useIssues();
    return id === null ? null : <Comments id={id} />;
  }
  function Comments({ id }: { id: number }) {
    seen.comments = useComments(id);
    return null;
  }
  const mount = (id: number | null = null) =>
    render(
      <QueryClientProvider client={client}>
        <SessionContext value={value}>
          <Probe id={id} />
        </SessionContext>
      </QueryClientProvider>,
    );
  return {
    api,
    client,
    mount,
    issues: () => seen.issues!,
    comments: () => seen.comments!,
    key: issuesKey(me.actor.key),
    asked: (path: string) => api.get.mock.calls.filter(c => c[0] === path).length,
  };
}

describe('the keys', () => {
  it('are kept per person, and the queue and a ticket’s replies are separate things to invalidate', () => {
    expect(issuesKey('admin')).toEqual(['issues', 'admin', 'list']);
    expect(issuesKey('employee_4')).not.toEqual(issuesKey('admin'));
    expect(commentsKey('admin', 4)).toEqual(['issues', 'admin', 'comments', 4]);
    expect(commentsKey('admin', 4)).not.toEqual(commentsKey('admin', 5));
    // invalidating the queue (a key is a prefix) must not take the replies with it
    const q = issuesKey('admin');
    const c = commentsKey('admin', 4);
    expect(c.slice(0, q.length)).not.toEqual([...q]);
  });
});

describe('the queue', () => {
  it('is asked of /api/v1/issues, and is the loader until it comes', async () => {
    const s = setup();
    s.mount();
    expect(s.issues().loading).toBe(true);
    expect(s.issues().items).toEqual([]);
    await waitFor(() => expect(s.issues().loading).toBe(false));
    expect(s.issues().items.map(i => i.id)).toEqual([4, 5]);
    expect(s.issues().error).toBeNull();
    expect(s.asked('/api/v1/issues')).toBe(1);
  });

  it('is asked again each time the screen opens, however recently it was asked', async () => {
    const s = setup();
    const first = s.mount();
    await waitFor(() => expect(s.asked('/api/v1/issues')).toBe(1));
    first.unmount();
    s.mount();
    await waitFor(() => expect(s.asked('/api/v1/issues')).toBe(2));
  });

  it("says why it could not be had, in the server's words", async () => {
    const s = setup({
      get: async () => {
        throw new ApiError(403, 'Not permitted');
      },
    });
    s.mount();
    await waitFor(() => expect(s.issues().error).toBe('Not permitted'));
    expect(s.issues().loading).toBe(false);
    expect(s.issues().items).toEqual([]);
  });

  it('refuses an answer that is not a list of tickets, rather than draw what it cannot read', async () => {
    for (const body of [{ rows: [] }, [ticket(4)], null, 'ok', { items: [{ id: 'x' }] }]) {
      const s = setup({ get: async () => body });
      const view = s.mount();
      await waitFor(() =>
        expect(s.issues().error).toBe('The issues came back in a form this app does not know.'),
      );
      view.unmount();
    }
  });

  it('keeps the queue it has when asking again fails', async () => {
    let calls = 0;
    const s = setup({
      get: async () => {
        if (++calls > 1) throw new ApiError(503, 'down');
        return { items: [ticket(4)] };
      },
    });
    const first = s.mount();
    await waitFor(() => expect(s.issues().items).toHaveLength(1));
    first.unmount();
    s.mount();
    await waitFor(() => expect(s.asked('/api/v1/issues')).toBe(2));
    // (asked is not answered: the refusal has to have been taken before there is anything to say it did not spoil)
    await waitFor(() => expect(s.client.getQueryState(s.key)?.status).toBe('error'));
    expect(s.issues().items).toHaveLength(1);
    expect(s.issues().error).toBeNull();
  });
});

describe('closing and reopening a ticket', () => {
  it('asks the server with PATCH, and puts the ticket as the server returned it in the queue — without asking for the queue again', async () => {
    const s = setup({
      patch: async () =>
        ticket(4, {
          status: 'resolved',
          resolved_by: 'Admin',
          resolved_at: '2026-10-02T08:00:00.000Z',
        }),
    });
    s.mount();
    await waitFor(() => expect(s.issues().loading).toBe(false));
    let out: Awaited<ReturnType<ReturnType<typeof s.issues>['setStatus']>> | undefined;
    await act(async () => {
      out = await s.issues().setStatus(4, 'resolved');
    });
    expect(out).toMatchObject({
      ok: true,
      value: { id: 4, status: 'resolved', resolved_by: 'Admin' },
    });
    expect(s.api.patch).toHaveBeenCalledWith('/api/v1/issues/4', { status: 'resolved' });
    await waitFor(() =>
      expect(s.issues().items.map(i => [i.id, i.status])).toEqual([
        [4, 'resolved'],
        [5, 'open'],
      ]),
    );
    expect(s.asked('/api/v1/issues')).toBe(1);
  });

  it('says why when the server would not, and leaves the queue as it was', async () => {
    const s = setup({
      patch: async () => {
        throw new ApiError(403, 'Not permitted');
      },
    });
    s.mount();
    await waitFor(() => expect(s.issues().loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await s.issues().setStatus(4, 'resolved');
    });
    expect(out).toEqual({ ok: false, message: 'Not permitted' });
    expect(s.issues().items.map(i => i.status)).toEqual(['open', 'open']);
  });

  it('says "Failed" when the answer is not a ticket, and "Error: …" for trouble that is not the server saying no', async () => {
    const odd = setup({ patch: async () => ({ ok: true }) });
    odd.mount();
    await waitFor(() => expect(odd.issues().loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await odd.issues().setStatus(4, 'resolved');
    });
    expect(out).toEqual({ ok: false, message: 'Failed' });
    cleanup();

    const broken = setup({
      patch: async () => {
        throw new TypeError('boom');
      },
    });
    broken.mount();
    await waitFor(() => expect(broken.issues().loading).toBe(false));
    await act(async () => {
      out = await broken.issues().setStatus(4, 'open');
    });
    expect(out).toEqual({ ok: false, message: 'Error: boom' });
  });
});

describe('the replies on a ticket', () => {
  const comments = async (path: string) => {
    expect(path).toBe('/api/v1/issues/4/comments');
    return { items: [reply(1), reply(2)] };
  };

  it('are asked of the ticket’s own address, and are the loader until they come', async () => {
    const s = setup({
      get: async (p: string) => (p === '/api/v1/issues' ? { items: [ticket(4)] } : comments(p)),
    });
    s.mount(4);
    expect(s.comments().loading).toBe(true);
    await waitFor(() => expect(s.comments().loading).toBe(false));
    expect(s.comments().items.map(c => c.id)).toEqual([1, 2]);
    expect(s.comments().error).toBeNull();
  });

  it("say why they could not be had, in the server's words — and refuse what is not a list of replies", async () => {
    const denied = setup({
      get: async (p: string) => {
        if (p === '/api/v1/issues') return { items: [] };
        throw new ApiError(403, 'Not permitted');
      },
    });
    denied.mount(4);
    await waitFor(() => expect(denied.comments().error).toBe('Not permitted'));
    cleanup();

    const odd = setup({
      get: async (p: string) => (p === '/api/v1/issues' ? { items: [] } : { rows: [] }),
    });
    odd.mount(4);
    await waitFor(() =>
      expect(odd.comments().error).toBe('The replies came back in a form this app does not know.'),
    );
  });

  it('are sent as words, and then asked for again', async () => {
    const s = setup({
      get: async (p: string) => (p === '/api/v1/issues' ? { items: [] } : comments(p)),
    });
    s.mount(4);
    await waitFor(() => expect(s.asked('/api/v1/issues/4/comments')).toBe(1));
    let out: unknown;
    await act(async () => {
      out = await s.comments().post('On it.');
    });
    expect(out).toEqual({ ok: true, value: undefined });
    expect(s.api.post).toHaveBeenCalledWith('/api/v1/issues/4/comments', { body: 'On it.' });
    await waitFor(() => expect(s.asked('/api/v1/issues/4/comments')).toBe(2));
  });

  it('keep the replies they have when asking again fails', async () => {
    let calls = 0;
    const s = setup({
      get: async (p: string) => {
        if (p === '/api/v1/issues') return { items: [] };
        if (++calls > 1) throw new ApiError(503, 'down');
        return { items: [reply(1)] };
      },
    });
    const first = s.mount(4);
    await waitFor(() => expect(s.comments().items).toHaveLength(1));
    first.unmount();
    s.mount(4);
    await waitFor(() => expect(s.asked('/api/v1/issues/4/comments')).toBe(2));
    await waitFor(() =>
      expect(s.client.getQueryState(commentsKey(adminMe().actor.key, 4))?.status).toBe('error'),
    );
    expect(s.comments().items).toHaveLength(1);
    expect(s.comments().error).toBeNull();
  });

  it('say why when the server would not take the reply, and are not asked for again', async () => {
    const s = setup({
      get: async (p: string) => (p === '/api/v1/issues' ? { items: [] } : comments(p)),
      post: async () => {
        throw new ApiError(400, 'Write a reply, or attach a file.');
      },
    });
    s.mount(4);
    await waitFor(() => expect(s.asked('/api/v1/issues/4/comments')).toBe(1));
    let out: unknown;
    await act(async () => {
      out = await s.comments().post('x');
    });
    expect(out).toEqual({ ok: false, message: 'Write a reply, or attach a file.' });
    await new Promise(r => setTimeout(r, 30));
    expect(s.asked('/api/v1/issues/4/comments')).toBe(1);
  });
});

describe('a report', () => {
  it('goes to /api/v1/issues as a form: the two fields, and the file when there is one', async () => {
    const s = setup();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const out = await sendReport(s.api as never, {
      title: 'Cannot log hours',
      description: 'Nothing happens',
      file,
    });
    expect(out).toEqual({ ok: true, value: undefined });
    const [path, form] = s.api.postForm.mock.calls[0] as unknown as [string, FormData];
    expect(path).toBe('/api/v1/issues');
    expect(form.get('title')).toBe('Cannot log hours');
    expect(form.get('description')).toBe('Nothing happens');
    expect((form.get('file') as File).name).toBe('shot.png');
  });

  it('has no file field when nothing is attached', async () => {
    const s = setup();
    await sendReport(s.api as never, { title: 'x', description: '', file: null });
    const form = s.api.postForm.mock.calls[0]![1] as unknown as FormData;
    expect(form.has('file')).toBe(false);
    expect(form.get('description')).toBe('');
  });

  it('says why when the server would not take it: "Error: " and its words, or ours', async () => {
    const no = setup({
      postForm: async () => {
        throw new ApiError(502, 'The attachment could not be stored. Try again in a moment.');
      },
    });
    expect(await sendReport(no.api as never, { title: 'x', description: '', file: null })).toEqual({
      ok: false,
      message: 'Error: The attachment could not be stored. Try again in a moment.',
    });
    const gone = setup({
      postForm: async () => {
        throw new TypeError('offline');
      },
    });
    expect(
      await sendReport(gone.api as never, { title: 'x', description: '', file: null }),
    ).toEqual({
      ok: false,
      message: 'Error: offline',
    });
  });
});
