// A table's configuration as the server keeps it: read when a screen that has one opens, and written whole after each change
// (the classic engine did the same: one PUT of the list, whatever the change was). Reading never fails a screen — a list that
// cannot be had is "nothing arranged", and the screen's own columns stand, as they did.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../app/context';
import type { Api } from '../lib/api';
import { isColumnsResponse, type Column } from './model';

export const columnsKey = (actorKey: string, entity: string) =>
  ['columns', actorKey, entity] as const;

/** What was said when a change could not be kept (it is taken back, and the list is asked for again). */
export const SAID_NOT_SAVED =
  'Could not save the columns. The list shown is the one on the server.';

async function fetchColumns(
  api: Api,
  entity: string,
  signal: AbortSignal,
): Promise<Column[] | null> {
  try {
    const body = await api.get<unknown>(`${api.base}/columns/${entity}`, { signal });
    return isColumnsResponse(body) ? body.columns : null;
  } catch (e) {
    // (a cancelled request is not an answer; anything else is "nothing arranged")
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return null;
  }
}

export interface ColumnConfig {
  /** the list saved, or null where nothing was (or it could not be read) */
  saved: Column[] | null;
  /** it has been asked for, and answered or not */
  loaded: boolean;
  /** show this list now and keep it on the server */
  keep: (next: Column[]) => void;
}

export function useColumnConfig(entity: string): ColumnConfig {
  const { api, me, toasts } = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => columnsKey(me.actor.key, entity), [me.actor.key, entity]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchColumns(api, entity, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  const keep = useCallback(
    (next: Column[]) => {
      qc.setQueryData(key, next);
      api.put(`${api.base}/columns/${entity}`, { columns: next }).catch(() => {
        toasts.show(SAID_NOT_SAVED);
        void qc.invalidateQueries({ queryKey: key });
      });
    },
    [api, qc, key, entity, toasts],
  );
  return { saved: query.data ?? null, loaded: !query.isPending, keep };
}
