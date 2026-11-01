// What Google Chat asks of the server: whose Chat is linked (and what its grant reaches), the spaces, the messages of the space that is
// open — asked for again while the page is in view, since Chat has no push without Workspace infrastructure of its own — and sending.
// The classic pages read it all again each time they are opened and so does this (a link made or lost in another tab is what the next
// visit shows), and nothing is kept for the next visit: a page that showed the last visit's messages while it asked again would show a
// conversation that may have moved on.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { useGoogleLink, type LinkSpec, type LinkState } from '../../google';
import { ApiError } from '../../lib/api';
import type { Outcome } from '../../lib/outcome';
import {
  chatLinkOf,
  isGchatStatus,
  isMessageList,
  isSent,
  isSpaceList,
  messagesOf,
  reasonWords,
  routesOf,
  SAID,
  spacesOf,
  type ChatLink,
  type Messages,
  type Spaces,
} from './model';

/** What the screen has read is kept under this key, each thing for one person: the link, and (under `chat`) what was read with it. */
const ROOT = 'google-chat';
export const statusKey = (actorKey: string) => [ROOT, 'status', actorKey] as const;
export const spacesKey = (actorKey: string) => [ROOT, 'chat', 'spaces', actorKey] as const;
export const messagesKey = (actorKey: string, space: string) =>
  [ROOT, 'chat', 'messages', actorKey, space] as const;

/** How often the open space is asked for its messages again, while the page is in view. */
export const POLL_MS = 20_000;

/** Whose Google Chat the person has linked, if any, and what the link reaches. */
export function useChatLink(): LinkState<ChatLink> {
  const { portal } = useSession();
  const spec = useMemo<LinkSpec<ChatLink>>(
    () => ({
      key: statusKey,
      routes: routesOf(portal),
      read: body => (isGchatStatus(body) ? chatLinkOf(body) : null),
      strange: SAID.strange,
      forget: [ROOT, 'chat'],
    }),
    [portal],
  );
  return useGoogleLink(spec);
}

export interface SpacesState {
  /** the list has not come yet */
  loading: boolean;
  /** the spaces, or why there are none to show (nothing, until it comes) */
  result: Spaces | null;
}

/** The spaces of the linked account. Only once there is a link to read them with. */
export function useSpaces(enabled: boolean): SpacesState {
  const { api, me, portal } = useSession();
  const routes = useMemo(() => routesOf(portal), [portal]);
  const query = useQuery({
    queryKey: spacesKey(me.actor.key),
    queryFn: async ({ signal }): Promise<Spaces> => {
      let body: unknown;
      try {
        body = await api.get<unknown>(routes.spaces, { signal });
      } catch {
        // (a call that did not go is Chat being out of reach, as the classic pages tell it; one that was taken back is not an answer, and
        // the query throws away whatever becomes of it)
        return { ok: false, reason: 'failed' };
      }
      return isSpaceList(body) ? spacesOf(body) : { ok: false, reason: 'failed' };
    },
    enabled,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  return { loading: enabled && query.isPending, result: query.data ?? null };
}

export interface MessagesState {
  /** the messages have not come yet */
  loading: boolean;
  result: Messages | null;
  /** ask again now (after a send) */
  again: () => void;
}

/**
 * The messages of the space that is open, oldest first, asked for again every twenty seconds for as long as the conversation is on the
 * page and the page is in view, and at once when the person comes back to a page they had been away from for longer than that. (The
 * classic pages stopped asking once the person had been away and come back.)
 */
export function useMessages(space: string | null, enabled: boolean): MessagesState {
  const { api, me, portal } = useSession();
  const routes = useMemo(() => routesOf(portal), [portal]);
  const qc = useQueryClient();
  const actor = me.actor.key;
  const query = useQuery({
    queryKey: messagesKey(actor, space ?? ''),
    queryFn: async ({ signal }): Promise<Messages> => {
      let body: unknown;
      try {
        body = await api.get<unknown>(routes.messages(space ?? ''), { signal });
      } catch {
        return { ok: false, reason: 'failed', detail: '' };
      }
      return isMessageList(body) ? messagesOf(body) : { ok: false, reason: 'failed', detail: '' };
    },
    enabled: enabled && space !== null,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    // (the clock stops while the page is out of view, so a person who comes back after longer than a tick is asked for at once: the
    // classic pages never stopped, and what was on the page when they came back was never more than a tick old)
    staleTime: POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
    refetchOnMount: 'always',
    gcTime: 0,
  });
  const again = useCallback(() => {
    if (space !== null) void qc.invalidateQueries({ queryKey: messagesKey(actor, space) });
  }, [qc, actor, space]);
  return {
    loading: enabled && space !== null && query.isPending,
    result: space !== null ? (query.data ?? null) : null,
    again,
  };
}

/** Send a message to a space: the words of the refusal where there is one (Google's own where it gave some). */
export function useSend(): (space: string, text: string) => Promise<Outcome> {
  const { api, portal } = useSession();
  const route = useMemo(() => routesOf(portal).send, [portal]);
  return useCallback(
    async (space, text) => {
      let answer: unknown;
      try {
        answer = await api.post<unknown>(route, { space, text });
      } catch (e) {
        // (the route's own refusals — no such space, nothing to say — are a word for a program)
        const said = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          message: e instanceof ApiError && e.status === 400 ? reasonWords(said) : said,
        };
      }
      // (a 200 that is not one of the two things it says is not told as either)
      if (!isSent(answer)) return { ok: false, message: SAID.strangeSend };
      if (!answer.ok) return { ok: false, message: answer.detail || reasonWords(answer.error) };
      return { ok: true, value: undefined };
    },
    [api, route],
  );
}

/**
 * Start the page over, as its Refresh does: where there is a link, the spaces and the open conversation are asked for again (the
 * spinner first, as the classic pages draw it); where there is none, whose account it is — the one thing the screen can ask.
 */
export function useRefresh(): (linked: boolean) => void {
  const qc = useQueryClient();
  const { me } = useSession();
  const actor = me.actor.key;
  return useCallback(
    linked => {
      if (linked) void qc.resetQueries({ queryKey: [ROOT, 'chat'] });
      else void qc.resetQueries({ queryKey: statusKey(actor) });
    },
    [qc, actor],
  );
}
