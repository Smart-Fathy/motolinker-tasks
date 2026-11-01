// What My Drive and My Sheets ask of the server: whose Google account is linked (one answer, for both screens) and the files in it.
// The link itself — asking whose it is, making it (a trip to Google and back), letting it go — is the Google group's one hook
// (link.ts); the classic pages read all of it again each time they are opened and so does this (a link made or lost in another tab,
// or by the other screen, is what the next visit shows).
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSession } from '../app/context';
import { ApiError } from '../lib/api';
import { useGoogleLink, type LinkSpec, type LinkState } from './link';
import {
  isDriveFileList,
  isDriveStatus,
  linkOf,
  routesOf,
  type DriveFile,
  type Kind,
  type Link,
} from './model';

/** What the two screens have read is kept under this key, each for one person (and the files for each of the two screens). */
const ROOT = 'google-drive';
export const statusKey = (actorKey: string) => [ROOT, 'status', actorKey] as const;
export const filesKey = (actorKey: string, kind: Kind) => [ROOT, 'files', actorKey, kind] as const;

const SAY_STRANGE = 'Google Drive came back in a form this app does not know.';

/** Whose Google account the person has linked, if any: the same answer for My Drive and My Sheets. */
export function useDriveLink(): LinkState<Link> {
  const { portal } = useSession();
  const spec = useMemo<LinkSpec<Link>>(
    () => ({
      key: statusKey,
      routes: routesOf(portal),
      read: body => (isDriveStatus(body) ? linkOf(body) : null),
      strange: SAY_STRANGE,
      forget: [ROOT, 'files'],
    }),
    [portal],
  );
  return useGoogleLink(spec);
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
