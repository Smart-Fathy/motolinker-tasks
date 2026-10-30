// The notifications the signed-in person has: read from /api/v1/notifications once, kept up to date by the live stream, and
// changed locally the moment they act (the server is told after, and asked again if it could not take it). Everything that
// shows a notification — the bell, the rail's badge, the Notification Center — reads the one list held here, so they cannot
// disagree; and how many are unread is counted from that list, so it cannot drift from it.
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAppTo, useSession, useStreamEvent } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import {
  countUnread,
  fromStream,
  isNotificationList,
  routeOf,
  toastText,
  urlOf,
  withAllRead,
  withLive,
  withRead,
  type Notification,
} from './model';

const LIST = '/api/v1/notifications';
const READ = '/api/v1/notifications/read';
const NONE: readonly Notification[] = [];

export const notificationsKey = (actorKey: string) => ['notifications', actorKey] as const;

async function fetchItems(api: Api, signal: AbortSignal): Promise<Notification[]> {
  const body = await api.get<unknown>(LIST, { signal });
  if (!isNotificationList(body)) {
    throw new ApiError(502, 'Notifications came back in a form this app does not know.');
  }
  return body.items;
}

/** The key of this person's list: the same array for as long as they are signed in, so what depends on it is not redone. */
function useKey() {
  const actorKey = useSession().me.actor.key;
  return useMemo(() => notificationsKey(actorKey), [actorKey]);
}

function useListOptions() {
  const { api } = useSession();
  const queryKey = useKey();
  return queryOptions({ queryKey, queryFn: ({ signal }) => fetchItems(api, signal) });
}

export interface NotificationsState {
  items: readonly Notification[];
  unread: number;
  /** the first reading is still on its way */
  loading: boolean;
  /** it could not be read, and nothing read before is held */
  unavailable: boolean;
  /** one is read: shown so at once; the server is told */
  markRead: (id: number | string) => void;
  /** all are read: shown so at once; the server is told */
  markAllRead: () => void;
  /** go to the notification's page, having read it */
  open: (n: Notification) => void;
}

/**
 * @param fresh ask the server again as the screen opens, even if the list was read a moment ago (the Notification Center
 *   does: it is the place you go to see what is there)
 */
export function useNotifications({ fresh = false }: { fresh?: boolean } = {}): NotificationsState {
  const { api, portal } = useSession();
  const to = useAppTo();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const options = useListOptions();
  const query = useQuery(fresh ? { ...options, refetchOnMount: 'always' } : options);
  const key = options.queryKey;

  const items = query.data ?? NONE;

  /** Change the list now, tell the server after; if it will not take it, ask what is true. */
  const change = useCallback(
    async (edit: (items: Notification[]) => Notification[], tell: () => Promise<unknown>) => {
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<Notification[]>(key, old => (old ? edit(old) : old));
      try {
        await tell();
      } catch {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    [qc, key],
  );

  const markRead = useCallback(
    (id: number | string) => {
      // A live-only one (it could not be stored: its id is "tmp-…") has nothing to mark on the server.
      const stored = !String(id).startsWith('tmp-');
      void change(
        list => withRead(list, id),
        () => (stored ? api.post(READ, { id }) : Promise.resolve()),
      );
    },
    [change, api],
  );

  const markAllRead = useCallback(() => {
    if (countUnread(qc.getQueryData<Notification[]>(key) ?? NONE) === 0) return;
    void change(withAllRead, () => api.post(READ, { all: true }));
  }, [change, api, qc, key]);

  const open = useCallback(
    (n: Notification) => {
      markRead(n.id);
      const path = routeOf(portal, urlOf(portal, n), n.type);
      if (path) void navigate(to(path));
    },
    [markRead, portal, navigate, to],
  );

  return {
    items,
    unread: countUnread(items),
    loading: query.isPending,
    unavailable: query.isError && query.data === undefined,
    markRead,
    markAllRead,
    open,
  };
}

/** How many are unread (the rail's badge). */
export function useUnreadCount(): number {
  const options = useListOptions();
  return useQuery({ ...options, select: countUnread }).data ?? 0;
}

/**
 * Keeps the list up to date for as long as the app is open, whichever screen it is on: a notification the stream brings goes
 * to the head of the list and up as a toast, and after the stream has been away, what it missed is asked for.
 */
export function useLiveNotifications(): void {
  const { stream, toasts } = useSession();
  const qc = useQueryClient();
  const key = useKey();

  useStreamEvent('notification', data => {
    let added: Notification | null = null;
    try {
      added = fromStream(JSON.parse(data));
    } catch {
      /* not JSON: not a notification */
    }
    if (!added) return;
    const live = added;
    qc.setQueryData<Notification[]>(key, old => withLive(old ?? NONE, live));
    toasts.show(toastText(live));
  });

  useEffect(() => {
    let seen = stream.status === 'open';
    return stream.onStatus(status => {
      if (status !== 'open') return;
      if (seen) void qc.invalidateQueries({ queryKey: key });
      seen = true;
    });
  }, [stream, qc, key]);
}
