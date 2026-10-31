// What the Suppliers screen asks of the server — the portal's own routes (…/suppliers, …/supplier-vehicles, …/stock), which are
// one handler for both portals — and the changes it makes. The register is asked for each time the screen opens, and again after
// every change (the classic page loaded it all again: the list gives way to the loader while it does).
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import {
  isDocList,
  isPurchases,
  isSupplier,
  isSupplierList,
  isVehicle,
  isVehicleList,
  statsOf,
  type Purchases,
  type Stats,
  type Supplier,
  type SupplierDoc,
  type Vehicle,
} from './model';

export const suppliersKey = (actorKey: string) => ['suppliers', actorKey] as const;
const statsKey = (actorKey: string, what: 'catalogue' | 'stock') =>
  ['suppliers', actorKey, 'stats', what] as const;
const oneKey = (actorKey: string, id: number, what: 'vehicles' | 'docs' | 'purchases') =>
  ['suppliers', actorKey, 'one', id, what] as const;

const SAY_NOT_KNOWN = 'came back in a form this app does not know.';

/** What the register says when it could not be had: nothing reached the server, or the server said why. */
export const SAID_FAILED_TO_LOAD = 'Failed to load suppliers.';

// ── The register ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function fetchSuppliers(api: Api, signal: AbortSignal): Promise<Supplier[]> {
  const body = await api.get<unknown>(`${api.base}/suppliers`, { signal });
  // (an answer that is not a list is no suppliers, as it was)
  if (!Array.isArray(body)) return [];
  if (!isSupplierList(body)) throw new ApiError(502, `The suppliers ${SAY_NOT_KNOWN}`);
  return body;
}

/** A list somebody else's section owns: what it said, or nothing where it would not say (a 403 costs the figure, not the page). */
async function fetchOrNull(api: Api, path: string, signal: AbortSignal): Promise<unknown> {
  try {
    return await api.get<unknown>(`${api.base}${path}`, { signal });
  } catch {
    return null;
  }
}

export interface SuppliersState {
  items: readonly Supplier[];
  stats: Stats;
  /** the register, the figures on its cards and the columns are being asked for: the page gives way to the loader */
  loading: boolean;
  /** why the register could not be had, in words: a server's, or "could not reach it" */
  error: { status: number; message: string } | null;
  reload: () => void;
}

export function useSuppliers(columnsLoaded: boolean): SuppliersState {
  const { api, me } = useSession();
  const actor = me.actor.key;
  const list = useQuery({
    queryKey: suppliersKey(actor),
    queryFn: ({ signal }) => fetchSuppliers(api, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [catalogue, stock] = useQueries({
    queries: (['catalogue', 'stock'] as const).map(what => ({
      queryKey: statsKey(actor, what),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchOrNull(api, what === 'catalogue' ? '/supplier-vehicles' : '/stock', signal),
      refetchOnMount: 'always' as const,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
  const stats = useMemo(
    () => statsOf(catalogue?.data, stock?.data),
    [catalogue?.data, stock?.data],
  );
  const qc = useQueryClient();
  const reload = useCallback(
    () => void qc.invalidateQueries({ queryKey: suppliersKey(actor) }),
    [qc, actor],
  );
  const error = list.isError
    ? {
        status: list.error instanceof ApiError ? list.error.status : 0,
        message: list.error.message,
      }
    : null;
  return {
    items: list.data ?? [],
    stats,
    loading: list.isFetching || !!catalogue?.isFetching || !!stock?.isFetching || !columnsLoaded,
    error,
    reload,
  };
}

/** The register, for whoever needs to pick a supplier (the RFQ and purchase-order forms will). */
export function useSupplierList() {
  const { api, me } = useSession();
  return useQuery({
    queryKey: suppliersKey(me.actor.key),
    queryFn: ({ signal }) => fetchSuppliers(api, signal),
    refetchOnWindowFocus: false,
    retry: false,
  });
}

// ── What is done to it ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SupplierBody {
  name: string;
  contact: string;
  country: string;
  address: string;
  notes: string;
  custom_fields: Record<string, unknown>;
}

export function useSupplierWrites() {
  const { api, toasts } = useSession();
  const refresh = useRefresh();
  return {
    /** save a supplier (a new one where there is no id): the server's words on a refusal */
    async save(
      id: number | null,
      body: SupplierBody,
    ): Promise<{ ok: true } | { ok: false; message: string }> {
      try {
        const base = `${api.base}/suppliers`;
        const row = id
          ? await api.put<unknown>(`${base}/${id}`, body)
          : await api.post<unknown>(base, body);
        if (!isSupplier(row)) return { ok: false, message: `The saved supplier ${SAY_NOT_KNOWN}` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      refresh();
      return { ok: true };
    },
    async remove(id: number): Promise<void> {
      try {
        await api.del(`${api.base}/suppliers/${id}`);
      } catch (e) {
        toasts.show(e instanceof Error ? e.message : String(e));
      }
      refresh();
    },
  };
}

function useRefresh() {
  const { me } = useSession();
  const qc = useQueryClient();
  const actor = me.actor.key;
  return useCallback(
    () => void qc.invalidateQueries({ queryKey: suppliersKey(actor) }),
    [qc, actor],
  );
}

// ── One supplier's pages ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Pane<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function usePane<T>(
  id: number,
  what: 'vehicles' | 'docs' | 'purchases',
  guard: (v: unknown) => v is T,
): Pane<T> {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => oneKey(me.actor.key, id, what), [me.actor.key, id, what]);
  const q = useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<T> => {
      const body = await api.get<unknown>(`${api.base}/suppliers/${id}/${what}`, { signal });
      if (!guard(body)) throw new ApiError(502, `The ${what} ${SAY_NOT_KNOWN}`);
      return body;
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
    // (what was shown of a page before is not shown for the next one while it loads: the pane gives way to the loader)
    gcTime: 0,
  });
  const reload = useCallback(() => void qc.invalidateQueries({ queryKey: key }), [qc, key]);
  return { data: q.data, loading: q.isPending, error: q.isError ? q.error.message : null, reload };
}

export const useVehicles = (id: number) => usePane<Vehicle[]>(id, 'vehicles', isVehicleList);
export const useDocs = (id: number) => usePane<SupplierDoc[]>(id, 'docs', isDocList);
export const usePurchases = (id: number) => usePane<Purchases>(id, 'purchases', isPurchases);

export type Said = { ok: true } | { ok: false; message: string };

export function useVehicleWrites(id: number) {
  const { api } = useSession();
  const qc = useQueryClient();
  const { me } = useSession();
  const reload = () =>
    void qc.invalidateQueries({ queryKey: oneKey(me.actor.key, id, 'vehicles') });
  const failure = (e: unknown): Said => ({
    ok: false,
    message: e instanceof Error ? e.message : String(e),
  });
  return {
    async add(): Promise<Said> {
      try {
        const row = await api.post<unknown>(`${api.base}/suppliers/${id}/vehicles`, {
          brand: 'New',
          model: '',
        });
        if (!isVehicle(row))
          return { ok: false, message: 'came back in a form this app does not know.' };
      } catch (e) {
        return failure(e);
      }
      reload();
      return { ok: true };
    },
    async save(vid: number, body: Record<string, unknown>): Promise<Said> {
      try {
        await api.put(`${api.base}/suppliers/${id}/vehicles/${vid}`, body);
      } catch (e) {
        return failure(e);
      }
      return { ok: true };
    },
    async remove(vid: number): Promise<Said> {
      try {
        await api.del(`${api.base}/suppliers/${id}/vehicles/${vid}`);
      } catch (e) {
        return failure(e);
      }
      reload();
      return { ok: true };
    },
  };
}

export function useDocWrites(id: number) {
  const { api, me } = useSession();
  const qc = useQueryClient();
  return {
    async upload(file: File): Promise<Said> {
      const form = new FormData();
      form.append('file', file);
      try {
        await api.postForm(`${api.base}/suppliers/${id}/docs`, form);
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      void qc.invalidateQueries({ queryKey: oneKey(me.actor.key, id, 'docs') });
      return { ok: true };
    },
  };
}
