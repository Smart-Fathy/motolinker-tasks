// The link to a person's Google account, which every screen of the Google group begins with: whose account it is (asked again on
// every visit), the trip to Google that makes the link, and letting go of it. My Drive and My Sheets ask the Drive routes, My Email
// asks Gmail's; the steps are the same, and what differs (the routes, how an answer is read, what hangs on the link) is handed in.
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSession } from '../app/context';
import { ApiError } from '../lib/api';
import { failed, type Outcome } from '../lib/outcome';
import { readToken } from '../lib/session';

/** What the team's pages say when the server cannot be reached before leaving for Google. */
export const SAY_UNREACHABLE = 'Cannot reach the server — try again in a moment.';

export interface LinkRoutes {
  status: string;
  connect: string;
  disconnect: string;
  /** a question that is answered if the person is still signed in, and by nothing else (the team's pages ask it before they leave) */
  check: string | null;
}

export interface LinkSpec<L> {
  /** where the answer is kept, for one person */
  key: (actorKey: string) => QueryKey;
  routes: LinkRoutes;
  /** the answer as the screen tells it; nothing where it is not an answer this app knows */
  read: (body: unknown) => L | null;
  /** what is said of an answer that is not one */
  strange: string;
  /** what was read with the link, and is put away when it is let go of */
  forget: QueryKey;
}

export interface LinkState<L> {
  /** the answer has not come yet */
  loading: boolean;
  /** whose account it is, once it is known */
  link: L | null;
  /** the person may not ask (the team's status needs a grant of its own) */
  forbidden: boolean;
  /** why it could not be had, in words */
  error: string | null;
  /** go to Google to make the link (the page is left, and Google brings the person back to this screen) */
  connect: () => Promise<void>;
  /** let go of the link, and read it again */
  disconnect: () => Promise<Outcome>;
}

/** Whose Google account the person has linked, if any, by the routes and the reading of `spec` (which must not change between renders). */
export function useGoogleLink<L>(spec: LinkSpec<L>): LinkState<L> {
  const { api, me, portal, toasts } = useSession();
  const qc = useQueryClient();
  const { key, routes, read, strange, forget } = spec;
  const query = useQuery({
    queryKey: key(me.actor.key),
    queryFn: async ({ signal }): Promise<L> => {
      const body = await api.get<unknown>(routes.status, { signal });
      const link = read(body);
      if (link === null) throw new ApiError(502, strange);
      return link;
    },
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    // (nothing is kept for the next visit: a page that shows the last visit's account while it asks again would show one that may
    // have been let go of since)
    gcTime: 0,
  });

  const connect = useCallback(async () => {
    // The team's page asks, before it leaves, whether the person is still signed in (a page that is left cannot say so afterwards):
    // a refusal means the session has been dealt with, and no answer at all is said in a message.
    if (routes.check) {
      try {
        await api.get(routes.check);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) toasts.show(SAY_UNREACHABLE);
        return;
      }
    }
    // OAuth is a navigation, and a navigation carries no header: the token in the address is the session through the round trip.
    const token = readToken(portal);
    window.location.assign(routes.connect + '?_t=' + encodeURIComponent(token ?? ''));
  }, [api, portal, routes.check, routes.connect, toasts]);

  const disconnect = useCallback(async (): Promise<Outcome> => {
    try {
      await api.post(routes.disconnect);
    } catch (e) {
      return failed(e);
    }
    // Back to the beginning: what was read with the link is put away (and not read again: there is no account left to read it with),
    // and the link is read anew, which shows as loading, as the classic pages do.
    qc.removeQueries({ queryKey: forget });
    await qc.resetQueries({ queryKey: key(me.actor.key) });
    return { ok: true, value: undefined };
  }, [api, qc, routes.disconnect, forget, key, me.actor.key]);

  return {
    loading: query.isPending,
    link: query.data ?? null,
    forbidden: query.isError && query.error instanceof ApiError && query.error.status === 403,
    error: query.isError ? query.error.message : null,
    connect,
    disconnect,
  };
}
