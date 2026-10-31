// What My Drive and My Sheets ask of the server: whose Google account is linked (one answer, for both screens), the files in it, and
// the two things a person can do about the link — make it, which is a trip to Google and back, and let it go. The classic pages
// read all of it again each time they are opened and so does this (a link made or lost in another tab, or by the other screen,
// is what the next visit shows).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../app/context';
import { ApiError } from '../lib/api';
import { failed, type Outcome } from '../lib/outcome';
import { readToken } from '../lib/session';
import {
  isDriveFileList,
  isDriveStatus,
  linkOf,
  routesOf,
  SAID,
  type DriveFile,
  type Kind,
  type Link,
} from './model';

/** What the two screens have read is kept under this key, each for one person (and the files for each of the two screens). */
const ROOT = 'google-drive';
export const statusKey = (actorKey: string) => [ROOT, 'status', actorKey] as const;
export const filesKey = (actorKey: string, kind: Kind) => [ROOT, 'files', actorKey, kind] as const;

const SAY_STRANGE = 'Google Drive came back in a form this app does not know.';

export interface LinkState {
  /** the answer has not come yet */
  loading: boolean;
  /** whose account it is, once it is known */
  link: Link | null;
  /** the person may not ask (the team's status needs the Drive grant, and Sheets can be granted without it) */
  forbidden: boolean;
  /** why it could not be had, in words */
  error: string | null;
  /** go to Google to make the link (the page is left, and Google brings the person back to this screen) */
  connect: () => Promise<void>;
  /** let go of the link, and read it again */
  disconnect: () => Promise<Outcome>;
}

/** Whose Google account the person has linked, if any: the same answer for My Drive and My Sheets. */
export function useDriveLink(): LinkState {
  const { api, me, portal, toasts } = useSession();
  const qc = useQueryClient();
  const routes = useMemo(() => routesOf(portal), [portal]);
  const query = useQuery({
    queryKey: statusKey(me.actor.key),
    queryFn: async ({ signal }): Promise<Link> => {
      const body = await api.get<unknown>(routes.status, { signal });
      if (!isDriveStatus(body)) throw new ApiError(502, SAY_STRANGE);
      return linkOf(body);
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
        if (e instanceof ApiError && e.status === 0) toasts.show(SAID.unreachable);
        return;
      }
    }
    // OAuth is a navigation, and a navigation carries no header: the token in the address is the session through the round trip.
    const token = readToken(portal);
    window.location.assign(routes.connect + '?_t=' + encodeURIComponent(token ?? ''));
  }, [api, portal, routes, toasts]);

  const disconnect = useCallback(async (): Promise<Outcome> => {
    try {
      await api.post(routes.disconnect);
    } catch (e) {
      return failed(e);
    }
    // Back to the beginning: the files are put away (and not read again: there is no account left to read them with), and the link
    // is read anew, which shows as loading, as the classic page does.
    qc.removeQueries({ queryKey: [ROOT, 'files'] });
    await qc.resetQueries({ queryKey: statusKey(me.actor.key) });
    return { ok: true, value: undefined };
  }, [api, qc, routes, me.actor.key]);

  const error = query.isError ? query.error.message : null;
  return {
    loading: query.isPending,
    link: query.data ?? null,
    forbidden: query.isError && query.error instanceof ApiError && query.error.status === 403,
    error,
    connect,
    disconnect,
  };
}

export interface FilesState {
  /** the list has not come yet */
  loading: boolean;
  files: DriveFile[];
  /** why it could not be had, in words (Google's own, where it said some) */
  error: string | null;
}

/** The files of the linked account: all of them (My Drive) or the spreadsheets (My Sheets). Only once there is a link to read them with. */
export function useDriveFiles(kind: Kind, enabled: boolean): FilesState {
  const { api, me, portal } = useSession();
  const routes = useMemo(() => routesOf(portal), [portal]);
  const query = useQuery({
    queryKey: filesKey(me.actor.key, kind),
    queryFn: async ({ signal }): Promise<DriveFile[]> => {
      const body = await api.get<unknown>(kind === 'drive' ? routes.files : routes.sheets, {
        signal,
      });
      if (!isDriveFileList(body)) throw new ApiError(502, SAY_STRANGE);
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
    files: query.data ?? [],
    error: query.isError ? query.error.message : null,
  };
}
