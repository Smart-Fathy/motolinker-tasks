// The submissions the signed-in person may read: asked of /api/v1/submissions each time the screen opens (it is the place you go
// to see what the website sent), asked again by its Refresh button, and again once one is deleted.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import { isSubmissionList, type Submission } from './model';

const LIST = '/api/v1/submissions';

export const submissionsKey = (actorKey: string) => ['submissions', actorKey] as const;

async function fetchItems(api: Api, signal: AbortSignal): Promise<Submission[]> {
  const body = await api.get<unknown>(LIST, { signal });
  if (!isSubmissionList(body)) {
    throw new ApiError(502, 'Submissions came back in a form this app does not know.');
  }
  return body.items;
}

export interface SubmissionsState {
  items: readonly Submission[];
  /** being asked for — the first time, and again on Refresh: the table gives way to the loader, as it always has */
  loading: boolean;
  /** why they could not be had, in words */
  error: string | null;
  refresh: () => void;
  /** delete one, and ask again; false when the server would not */
  remove: (id: number) => Promise<boolean>;
}

export function useSubmissions(): SubmissionsState {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => submissionsKey(me.actor.key), [me.actor.key]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchItems(api, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const remove = useCallback(
    async (id: number) => {
      try {
        await api.del(`${LIST}/${id}`);
      } catch {
        return false;
      }
      void qc.invalidateQueries({ queryKey: key });
      return true;
    },
    [api, qc, key],
  );
  return {
    items: query.data ?? [],
    loading: query.isFetching,
    error: query.isError ? query.error.message : null,
    refresh,
    remove,
  };
}
