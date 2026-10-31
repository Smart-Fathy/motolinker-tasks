// What the Inventory screen asks of the server — the portal's own routes (…/stock), which are one handler for both portals for
// reading, adding and changing a vehicle, and the administrator's alone for deleting one and for the CSV — and the changes it
// makes. The register is asked for each time the screen opens, and again after every change (the classic page loaded it all again:
// the list gives way to the loader while it does).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import {
  isBulkResult,
  isVehicle,
  isVehicleList,
  type BulkResult,
  type Vehicle,
  type VehicleBody,
} from './model';

export const stockKey = (actorKey: string) => ['stock', actorKey] as const;

const SAY_NOT_KNOWN = 'came back in a form this app does not know.';

/** What the register says when it could not be had: nothing reached the server. */
export const SAID_FAILED_TO_LOAD = 'Failed to load stock.';

async function fetchStock(api: Api, signal: AbortSignal): Promise<Vehicle[]> {
  const body = await api.get<unknown>(`${api.base}/stock`, { signal });
  if (!isVehicleList(body)) throw new ApiError(502, `The stock ${SAY_NOT_KNOWN}`);
  return body;
}

export interface StockState {
  items: readonly Vehicle[];
  /** the register is being asked for: the page gives way to the loader */
  loading: boolean;
  /** why the register could not be had, in words: a server's, or "could not reach it" */
  error: { status: number; message: string } | null;
}

export function useStock(): StockState {
  const { api, me } = useSession();
  const list = useQuery({
    queryKey: stockKey(me.actor.key),
    queryFn: ({ signal }) => fetchStock(api, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  return {
    items: list.data ?? [],
    loading: list.isFetching,
    error: list.isError
      ? {
          status: list.error instanceof ApiError ? list.error.status : 0,
          message: list.error.message,
        }
      : null,
  };
}

export type Said = { ok: true } | { ok: false; message: string };

export function useStockWrites() {
  const { api, me, toasts } = useSession();
  const qc = useQueryClient();
  const actor = me.actor.key;
  const refresh = useCallback(
    () => void qc.invalidateQueries({ queryKey: stockKey(actor) }),
    [qc, actor],
  );
  const failure = (e: unknown): Said => ({
    ok: false,
    message: e instanceof Error ? e.message : String(e),
  });
  return {
    /** save a vehicle (a new one where there is no id): the server's words on a refusal */
    async save(id: number | null, body: VehicleBody): Promise<Said> {
      try {
        const base = `${api.base}/stock`;
        const row = id
          ? await api.put<unknown>(`${base}/${id}`, body)
          : await api.post<unknown>(base, body);
        if (!isVehicle(row)) return { ok: false, message: `The saved vehicle ${SAY_NOT_KNOWN}` };
      } catch (e) {
        return failure(e);
      }
      refresh();
      return { ok: true };
    },
    /** the administrator's: a vehicle carries its cars, and losing it loses their VINs with it */
    async remove(id: number): Promise<void> {
      try {
        await api.del(`${api.base}/stock/${id}`);
      } catch (e) {
        toasts.show(e instanceof Error ? e.message : String(e));
      }
      refresh();
    },
    /** the administrator's CSV: what went in and why a row did not */
    async importCsv(
      file: File,
    ): Promise<{ ok: true; result: BulkResult } | { ok: false; message: string }> {
      const form = new FormData();
      form.append('file', file);
      try {
        const result = await api.postForm<unknown>(`${api.base}/stock/bulk`, form);
        if (!isBulkResult(result)) return { ok: false, message: 'Upload failed' };
        refresh();
        return { ok: true, result };
      } catch (e) {
        return failure(e) as { ok: false; message: string };
      }
    },
  };
}
