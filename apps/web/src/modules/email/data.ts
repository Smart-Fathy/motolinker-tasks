// What My Email asks of the server: whose Gmail is linked (and what its grant reaches), the inbox, a message opened, and sending.
// The classic pages read all of it again each time they are opened and so does this (a link made or lost in another tab is what the
// next visit shows), and nothing is kept for the next visit: a page that showed the last visit's inbox while it asked again would
// show mail that may have been read, moved or let go of since.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { useGoogleLink, type LinkSpec, type LinkState } from '../../google';
import { ApiError } from '../../lib/api';
import type { Outcome } from '../../lib/outcome';
import {
  isGmailStatus,
  isMailList,
  isMailMessage,
  isMailSent,
  mailLinkOf,
  routesOf,
  SAID,
  type MailLink,
  type MailMessage,
  type MailSummary,
  type SendBody,
} from './model';

/** What the screen has read is kept under this key, each thing for one person: the link, and (under `mail`) what was read with it. */
const ROOT = 'google-email';
export const statusKey = (actorKey: string) => [ROOT, 'status', actorKey] as const;
export const inboxKey = (actorKey: string) => [ROOT, 'mail', 'inbox', actorKey] as const;
export const messageKey = (actorKey: string, id: string) =>
  [ROOT, 'mail', 'message', actorKey, id] as const;

/** Whose Gmail the person has linked, if any, and whether the link reaches as far as sending. */
export function useMailLink(): LinkState<MailLink> {
  const { portal } = useSession();
  const spec = useMemo<LinkSpec<MailLink>>(
    () => ({
      key: statusKey,
      routes: routesOf(portal),
      read: body => (isGmailStatus(body) ? mailLinkOf(body) : null),
      strange: SAID.strange,
      forget: [ROOT, 'mail'],
    }),
    [portal],
  );
  return useGoogleLink(spec);
}

export interface InboxState {
  /** the list has not come yet */
  loading: boolean;
  messages: MailSummary[];
  /** why it could not be had, in words (the server's, where it said some) */
  error: string | null;
}

/** The inbox of the linked account, newest first as Gmail gives it. Only once there is a link to read it with. */
export function useInbox(enabled: boolean): InboxState {
  const { api, me, portal } = useSession();
  const routes = useMemo(() => routesOf(portal), [portal]);
  const query = useQuery({
    queryKey: inboxKey(me.actor.key),
    queryFn: async ({ signal }): Promise<MailSummary[]> => {
      const body = await api.get<unknown>(routes.messages, { signal });
      if (!isMailList(body)) throw new ApiError(502, SAID.strange);
      return body;
    },
    enabled,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  return {
    loading: enabled && query.isPending,
    messages: query.data ?? [],
    error: query.isError ? query.error.message : null,
  };
}

export interface MessageState {
  /** the message has not come yet */
  loading: boolean;
  message: MailMessage | null;
  error: string | null;
}

/** One message of the inbox, opened (nothing, until there is one to open). */
export function useMessage(id: string | null): MessageState {
  const { api, me, portal } = useSession();
  const routes = useMemo(() => routesOf(portal), [portal]);
  const query = useQuery({
    queryKey: messageKey(me.actor.key, id ?? ''),
    queryFn: async ({ signal }): Promise<MailMessage> => {
      const body = await api.get<unknown>(routes.message(id ?? ''), { signal });
      if (!isMailMessage(body)) throw new ApiError(502, SAID.strange);
      // (Gmail not finding a message is not an error to the route: it answers a message with nothing in it, no id and no thread — a
      // card with no sender and no words, and a Reply that goes nowhere, is not what a person is shown for that)
      if (body.id === undefined) throw new ApiError(404, SAID.gone);
      return body;
    },
    enabled: id !== null,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  return {
    loading: id !== null && query.isPending,
    message: id !== null ? (query.data ?? null) : null,
    error: id !== null && query.isError ? query.error.message : null,
  };
}

/** Send an email, or a reply: the words of the server's refusal where it gave some (the screen puts its own in front of them). */
export function useSend(): (body: SendBody) => Promise<Outcome> {
  const { api, portal } = useSession();
  const route = useMemo(() => routesOf(portal).send, [portal]);
  return useCallback(
    async body => {
      let answer: unknown;
      try {
        answer = await api.post<unknown>(route, body);
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      // (a 200 that is not "sent" is not told as one)
      if (!isMailSent(answer)) return { ok: false, message: SAID.strangeSend };
      return { ok: true, value: undefined };
    },
    [api, route],
  );
}

/**
 * Start the page over, as its Refresh does: whose account it is is asked again (and the page waits for the answer, as it does when
 * it is opened), and so is everything read with it — afterwards, not now: what is on the page is put away with the page, and is
 * not read twice.
 */
export function useRefresh(): () => void {
  const qc = useQueryClient();
  const { me } = useSession();
  const actor = me.actor.key;
  return useCallback(() => {
    qc.removeQueries({ queryKey: [ROOT, 'mail'] });
    void qc.resetQueries({ queryKey: statusKey(actor) });
  }, [qc, actor]);
}
