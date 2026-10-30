// The meetings, as the Meet page asks for them: the list each time the screen opens (and again after a meeting is scheduled,
// changed or cancelled), and the people and chat rooms the scheduling sheet offers. Nothing is guessed ahead of the server:
// a meeting is in the list when the server has said so.
import { can } from '@motolinker/contracts/access';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import type { Portal } from '../../lib/env';
import { failed, type Outcome } from '../../lib/outcome';
import {
  isMeeting,
  isMeetingList,
  peopleOf,
  roomsOf,
  type Meeting,
  type MeetingBody,
  type Person,
  type Room,
} from './model';

const LIST = '/api/v1/meetings';

export const meetingsKey = (actorKey: string) => ['meetings', actorKey, 'list'] as const;

async function fetchMeetings(api: Api, signal: AbortSignal): Promise<Meeting[]> {
  const body = await api.get<unknown>(LIST, { signal });
  if (!isMeetingList(body)) {
    throw new ApiError(502, 'The meetings came back in a form this app does not know.');
  }
  return body.items;
}

const NONE: readonly never[] = [];

export interface MeetingActions {
  /** schedule a meeting (no id) or change one; the list is then asked for again */
  save: (id: number | null, body: MeetingBody) => Promise<Outcome<Meeting>>;
  /** cancel a meeting; the list is then asked for again */
  cancel: (id: number) => Promise<Outcome>;
}

/** What follows a change to the meetings: the list is asked for again, and so is every calendar that draws them. */
function changed(qc: QueryClient, actorKey: string) {
  void qc.invalidateQueries({ queryKey: ['meetings', actorKey] });
  // (the Calendar module keeps its windows under this key)
  void qc.invalidateQueries({ queryKey: ['calendar', actorKey] });
}

/** Scheduling, changing and cancelling, for whoever draws a button for them (the Meet page, the Calendar). */
export function useMeetingActions(): MeetingActions {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const actorKey = me.actor.key;
  const save = useCallback(
    async (id: number | null, body: MeetingBody): Promise<Outcome<Meeting>> => {
      let saved: unknown;
      try {
        saved =
          id === null
            ? await api.post<unknown>(LIST, body)
            : await api.put<unknown>(`${LIST}/${id}`, body);
      } catch (e) {
        return failed(e);
      }
      if (!isMeeting(saved)) return { ok: false, message: 'Failed to save.' };
      changed(qc, actorKey);
      return { ok: true, value: saved };
    },
    [api, qc, actorKey],
  );
  const cancel = useCallback(
    async (id: number): Promise<Outcome> => {
      try {
        await api.del(`${LIST}/${id}`);
      } catch (e) {
        return failed(e);
      }
      changed(qc, actorKey);
      return { ok: true, value: undefined };
    },
    [api, qc, actorKey],
  );
  return { save, cancel };
}

export interface MeetingsState extends MeetingActions {
  items: readonly Meeting[];
  /** the list has not come yet */
  loading: boolean;
  /** why it could not be had, in words (a list already in hand is kept when asking again fails) */
  error: string | null;
}

export function useMeetings(): MeetingsState {
  const { api, me, access } = useSession();
  const actions = useMeetingActions();
  const key = useMemo(() => meetingsKey(me.actor.key), [me.actor.key]);
  // Somebody who may not see the meetings is not shown any (and the server would say so): the cards are all there is.
  const enabled = can(access.actor, 'meet.view');
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchMeetings(api, signal),
    enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  return {
    ...actions,
    items: query.data ?? NONE,
    loading: enabled && query.isPending,
    error: query.isError && !query.data ? query.error.message : null,
  };
}

/** The people the sheet offers, and where each portal keeps them (the team's list is every colleague, the admin's every employee). */
const PEOPLE: Record<Portal, string> = {
  admin: '/api/dashboard/employees-for-tasks',
  team: '/api/employee/coworkers',
};

/** What the sheet offers to invite and to hold a huddle in, asked for when it is opened. Whatever cannot be had is nobody, and no rooms. */
export async function fetchChoices(
  qc: QueryClient,
  api: Api,
  portal: Portal,
  actorKey: string,
): Promise<{ people: Person[]; rooms: Room[] }> {
  const ask = <T>(key: string, path: string, read: (v: unknown) => T[]): Promise<T[]> =>
    qc
      .fetchQuery({
        queryKey: ['meetings', actorKey, key],
        queryFn: ({ signal }) => api.get<unknown>(path, { signal }).then(read),
        staleTime: 30_000,
        retry: false,
      })
      .catch(() => []);
  const [people, rooms] = await Promise.all([
    ask('people', PEOPLE[portal], peopleOf),
    ask('rooms', `${api.base}/chat/rooms`, roomsOf),
  ]);
  return { people, rooms };
}
