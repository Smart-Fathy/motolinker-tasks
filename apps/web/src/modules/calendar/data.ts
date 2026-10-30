// What the Calendar asks for: the window of days it is showing, each time it moves (the one before stays on show while the next
// is on its way, as the classic page keeps the old month until the new one comes), and — for the admin — whether new tasks are
// being added to a Google Calendar.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import { failed, type Outcome } from '../../lib/outcome';
import { readToken } from '../../lib/session';
import { isCalendarFeed, syncOf, type CalendarFeed, type SyncStatus } from './model';

/** The Meet module drops everything under this key when a meeting is scheduled, changed or cancelled. */
export const calendarKey = (actorKey: string, from: string, to: string) =>
  ['calendar', actorKey, from, to] as const;

async function fetchFeed(
  api: Api,
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<CalendarFeed> {
  const body = await api.get<unknown>(`/api/v1/calendar?from=${from}&to=${to}`, { signal });
  if (!isCalendarFeed(body)) {
    throw new ApiError(502, 'The calendar came back in a form this app does not know.');
  }
  return body;
}

export interface FeedState {
  /** the window last had (the one on show while the next is on its way) */
  feed: CalendarFeed | null;
  /** a window is on its way */
  fetching: boolean;
  /** why it could not be had, in words */
  error: string | null;
}

/** The feed for a window of days (YYYY-MM-DD, inclusive). */
export function useFeed(from: string, to: string): FeedState {
  const { api, me } = useSession();
  const query = useQuery({
    queryKey: calendarKey(me.actor.key, from, to),
    queryFn: ({ signal }) => fetchFeed(api, from, to, signal),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  return {
    feed: query.data ?? null,
    fetching: query.isFetching,
    error: query.isError ? query.error.message : null,
  };
}

const STATUS = '/api/calendar/status';

export interface SyncState {
  /** the answer has not come yet */
  loading: boolean;
  status: SyncStatus;
  /** stop adding new tasks to the calendar */
  disconnect: () => Promise<Outcome>;
  /** go to Google to let it (the page is left; the sign-in comes back to the Calendar) */
  connect: () => void;
}

/** The admin's Google Calendar link: only the admin has one to show (the team's calendars are their own). */
export function useCalendarSync(enabled: boolean): SyncState {
  const { api, me, portal } = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => ['calendar-sync', me.actor.key] as const, [me.actor.key]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<unknown>(STATUS, { signal }).then(syncOf),
    enabled,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const disconnect = useCallback(async (): Promise<Outcome> => {
    try {
      await api.post('/api/calendar/disconnect');
    } catch (e) {
      return failed(e);
    }
    await qc.invalidateQueries({ queryKey: key });
    return { ok: true, value: undefined };
  }, [api, qc, key]);
  const connect = useCallback(() => {
    // OAuth is a redirect — the token in the address keeps the session through the round trip
    const token = readToken(portal);
    window.location.assign(
      '/api/calendar/connect' + (token ? '?_t=' + encodeURIComponent(token) : ''),
    );
  }, [portal]);
  return {
    loading: enabled && query.isPending,
    status: query.data ?? syncOf(null),
    disconnect,
    connect,
  };
}
