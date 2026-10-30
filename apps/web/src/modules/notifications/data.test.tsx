import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../../app/context';
import type { StreamMessage, StreamStatus } from '../../lib/sse';
import { createToasts } from '../../lib/toasts';
import { adminMe } from '../../test/helpers';
import { notificationsKey, useLiveNotifications, useNotifications } from './data';
import type { Notification } from './model';

afterEach(cleanup);

const note = (id: number, extra: Partial<Notification> = {}): Notification => ({
  id,
  type: 'task',
  title: `Title ${id}`,
  body: '',
  url: '',
  read: false,
  created_at: '2026-10-01T09:00:00.000Z',
  ...extra,
});

/** A stream the test can speak through, and change the status of. */
function fakeStream(initial: StreamStatus) {
  let subscriptions = 0;
  const listeners = new Map<string, Set<(data: string, m: StreamMessage) => void>>();
  const statuses = new Set<(s: StreamStatus) => void>();
  const stream = {
    status: initial,
    start: () => undefined,
    close: () => undefined,
    reconnectNow: () => undefined,
    on(event: string, fn: (data: string, m: StreamMessage) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => void listeners.get(event)!.delete(fn);
    },
    onStatus(fn: (s: StreamStatus) => void) {
      subscriptions++;
      statuses.add(fn);
      return () => void statuses.delete(fn);
    },
  };
  return {
    stream,
    say: (event: string, data: string) =>
      listeners.get(event)?.forEach(fn => fn(data, { event, data, id: undefined })),
    subscriptions: () => subscriptions,
    become: (status: StreamStatus) => {
      stream.status = status;
      statuses.forEach(fn => fn(status));
    },
  };
}

function setup(status: StreamStatus = 'connecting') {
  const me = adminMe();
  const fake = fakeStream(status);
  const toasts = createToasts();
  let asked = 0;
  const api = {
    get: vi.fn(async () => {
      asked++;
      return { items: [note(1, { read: true })], unread: 0 };
    }),
    post: vi.fn(async () => ({ ok: true })),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const value = {
    portal: 'admin',
    me,
    api,
    stream: fake.stream,
    toasts,
  } as unknown as SessionValue;
  let seen: ReturnType<typeof useNotifications> | undefined;
  function Probe() {
    useLiveNotifications();
    seen = useNotifications();
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <SessionContext value={value}>
        <MemoryRouter>
          <Probe />
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  );
  return {
    fake,
    toasts,
    client,
    key: notificationsKey(me.actor.key),
    asked: () => asked,
    items: () => seen!.items,
  };
}

describe('the live notifications', () => {
  it('are kept per person: the list is held under the key of the actor who is signed in', () => {
    expect(notificationsKey('admin')).toEqual(['notifications', 'admin']);
    expect(notificationsKey('employee_4')).not.toEqual(notificationsKey('admin'));
  });

  it('read the list once, and again after the stream has been away', async () => {
    const s = setup('connecting');
    await waitFor(() => expect(s.asked()).toBe(1));
    act(() => s.fake.become('open'));
    await new Promise(r => setTimeout(r, 30));
    expect(s.asked()).toBe(1);
    act(() => s.fake.become('waiting'));
    act(() => s.fake.become('connecting'));
    await new Promise(r => setTimeout(r, 30));
    expect(s.asked()).toBe(1);
    act(() => s.fake.become('open'));
    await waitFor(() => expect(s.asked()).toBe(2));
  });

  it('count a stream that was already open when they started as having been open', async () => {
    const s = setup('open');
    await waitFor(() => expect(s.asked()).toBe(1));
    act(() => s.fake.become('waiting'));
    act(() => s.fake.become('open'));
    await waitFor(() => expect(s.asked()).toBe(2));
  });

  it("listen to the stream's state once, not again at every redraw", async () => {
    const s = setup('open');
    await waitFor(() => expect(s.items()).toHaveLength(1));
    for (const id of [2, 3, 4])
      act(() => s.fake.say('notification', JSON.stringify({ id, title: `n${id}` })));
    await waitFor(() => expect(s.items()).toHaveLength(4));
    expect(s.fake.subscriptions()).toBe(1);
  });

  it('stop asking for anything when the app goes', async () => {
    const s = setup('open');
    await waitFor(() => expect(s.asked()).toBe(1));
    cleanup();
    s.fake.become('waiting');
    s.fake.become('open');
    await new Promise(r => setTimeout(r, 30));
    expect(s.asked()).toBe(1);
  });

  it('put a notification at the head and up as a toast, whatever screen is open', async () => {
    const s = setup();
    await waitFor(() => expect(s.items()).toHaveLength(1));
    act(() =>
      s.fake.say(
        'notification',
        JSON.stringify({
          id: 2,
          title: 'Hello',
          body: 'World',
          created_at: '2026-10-02T00:00:00.000Z',
        }),
      ),
    );
    await waitFor(() => expect(s.items().map(n => n.id)).toEqual([2, 1]));
    expect(s.toasts.getSnapshot().map(t => t.text)).toEqual(['Hello · World']);
  });

  it('put a notification in the list even before the list has been read, and the list read after it stands', async () => {
    const s = setup();
    act(() => s.fake.say('notification', JSON.stringify({ id: 9, title: 'Early' })));
    expect(s.toasts.getSnapshot()).toHaveLength(1);
    await waitFor(() => expect(s.items().map(n => n.id)).toEqual([1]));
  });

  it('hear nothing in a frame that is not a notification', async () => {
    const s = setup();
    await waitFor(() => expect(s.items()).toHaveLength(1));
    act(() => s.fake.say('notification', 'not json'));
    act(() => s.fake.say('notification', '[]'));
    act(() => s.fake.say('notification', JSON.stringify({ id: 3 })));
    act(() => s.fake.say('workspace', JSON.stringify({ id: 4, title: 'Not a notification' })));
    expect(s.items().map(n => n.id)).toEqual([1]);
    expect(s.toasts.getSnapshot()).toEqual([]);
  });
});
