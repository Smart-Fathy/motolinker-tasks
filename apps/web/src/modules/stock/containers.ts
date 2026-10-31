// What the Tracking tab asks of the server — the portal's own routes (…/containers), which are one handler for both portals (but
// deleting a box, which is the administrator's) — and the changes it makes. The board is asked for each time the tab opens, and
// again after every change (the classic page loaded it all again: the board gives way to the loader while it does).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import {
  isCarLinked,
  isContainerList,
  isLookup,
  isProviderStatus,
  isRefreshed,
  isRegistered,
  isSaved,
  type Container,
  type ContainerSaved,
  type FreeCar,
  type Lookup,
  type ProviderStatus,
  type Refreshed,
  type Registered,
} from './tracking';
import { isVehicleList } from './model';

export const containersKey = (actorKey: string) => ['stock', actorKey, 'containers'] as const;

/** What the board says when it could not be had and the server had no words for it. */
export const SAID_FAILED_TO_LOAD = 'Could not load containers.';
const SAY_NOT_KNOWN = 'came back in a form this app does not know.';

/**
 * The words of a failure: the server's own, or — where nothing reached it, or it had none — the classic page's for the thing that
 * was being done.
 */
export function wordsOf(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0 || /^The server answered with an error \(\d+\)\.$/.test(e.message))
      return fallback;
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

async function fetchContainers(api: Api, signal: AbortSignal): Promise<Container[]> {
  const body = await api.get<unknown>(`${api.base}/containers`, { signal });
  // (an answer that is not a list is no containers, as it was)
  if (!Array.isArray(body)) return [];
  if (!isContainerList(body)) throw new ApiError(502, `The containers ${SAY_NOT_KNOWN}`);
  return body;
}

export interface BoardState {
  items: readonly Container[];
  loading: boolean;
  error: string | null;
}

export function useContainers(): BoardState {
  const { api, me } = useSession();
  const q = useQuery({
    queryKey: containersKey(me.actor.key),
    queryFn: ({ signal }) => fetchContainers(api, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
    // (what the board showed before is not shown while it loads again: it gives way to the loader)
    gcTime: 0,
  });
  return {
    items: q.data ?? [],
    loading: q.isFetching,
    error: q.isError ? wordsOf(q.error, SAID_FAILED_TO_LOAD) : null,
  };
}

export type Said = { ok: true } | { ok: false; message: string };
type Got<T> = { ok: true; value: T } | { ok: false; message: string };

export function useContainerWrites() {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const actor = me.actor.key;
  const reload = useCallback(
    () => void qc.invalidateQueries({ queryKey: containersKey(actor) }),
    [qc, actor],
  );
  const base = `${api.base}/containers`;
  return {
    reload,
    /** look a box up by its number: found among ours, or what the carrier could say of it */
    async lookup(no: string): Promise<Got<Lookup>> {
      try {
        const d = await api.get<unknown>(`${base}/lookup/${encodeURIComponent(no)}`);
        return isLookup(d) ? { ok: true, value: d } : { ok: false, message: 'Lookup failed.' };
      } catch (e) {
        return { ok: false, message: wordsOf(e, 'Lookup failed.') };
      }
    },
    /** "is the carrier key working?" as one call — a real one, on the standard's own example number */
    async providerCheck(): Promise<Got<ProviderStatus>> {
      try {
        const d = await api.get<unknown>(`${base}/provider-status?probe=1`);
        return isProviderStatus(d)
          ? { ok: true, value: d }
          : { ok: false, message: 'Could not run the check.' };
      } catch {
        return { ok: false, message: 'Could not run the check.' };
      }
    },
    async register(no: string): Promise<Got<Registered>> {
      try {
        const d = await api.post<unknown>(`${base}/register`, { container_no: no });
        return isRegistered(d)
          ? { ok: true, value: d }
          : { ok: false, message: 'Could not register that container.' };
      } catch (e) {
        return { ok: false, message: wordsOf(e, 'Could not register that container.') };
      }
    },
    /** save a box (a new one where there is no id): the server's words on a refusal */
    async save(id: number | null, body: Record<string, string>): Promise<Got<ContainerSaved>> {
      try {
        const row = id
          ? await api.put<unknown>(`${base}/${id}`, body)
          : await api.post<unknown>(base, body);
        if (!isSaved(row)) return { ok: false, message: 'Could not save.' };
        reload();
        return { ok: true, value: row };
      } catch (e) {
        return { ok: false, message: wordsOf(e, 'Could not save.') };
      }
    },
    /** the administrator's: stop tracking a box (the vehicles inside it are not deleted) */
    async remove(id: number): Promise<Said> {
      try {
        await api.del(`${base}/${id}`);
      } catch {
        return { ok: false, message: 'Could not delete that container.' };
      }
      reload();
      return { ok: true };
    },
    /** ask the carrier (and the ship feed) again about a box: what each said */
    async refresh(id: number): Promise<Got<Refreshed>> {
      try {
        const d = await api.post<unknown>(`${base}/${id}/refresh`);
        return isRefreshed(d) ? { ok: true, value: d } : { ok: false, message: 'Refresh failed.' };
      } catch (e) {
        return { ok: false, message: wordsOf(e, 'Refresh failed.') };
      }
    },
    /** put a car in a box, by its VIN */
    async link(id: number, vin: string): Promise<Said> {
      try {
        const d = await api.post<unknown>(`${base}/${id}/units`, { vin });
        if (!isCarLinked(d)) return { ok: false, message: 'Could not add.' };
      } catch (e) {
        return { ok: false, message: wordsOf(e, 'Could not add.') };
      }
      reload();
      return { ok: true };
    },
    /** …and take it out */
    async unlink(id: number, vin: string): Promise<Said> {
      try {
        await api.del(`${base}/${id}/units/${encodeURIComponent(vin)}`);
      } catch {
        return { ok: false, message: 'Could not remove that vehicle.' };
      }
      reload();
      return { ok: true };
    },
    /**
     * The cars a box can carry: every car in the register that has a VIN. There is no separate register — every car the business
     * owns lives in the Models tab, as a unit inside a model — and a car with no VIN yet is left out on purpose: the VIN is how
     * the link is stored. A register that cannot be read (the member may not browse it) offers nothing.
     */
    async cars(): Promise<FreeCar[]> {
      try {
        const d = await api.get<unknown>(`${api.base}/stock`);
        if (!isVehicleList(d)) return [];
        return d.flatMap(v =>
          (Array.isArray(v.units) ? v.units : [])
            .filter(u => String(u.vin || '').trim())
            .map(u => ({
              vin: String(u.vin)
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, ''),
              make: v.make || '',
              model: v.model || '',
              trim: v.trim || '',
              colour: u.colour || '',
              status: u.status || '',
              consignee: u.consignee || '',
            })),
        );
      } catch {
        return [];
      }
    },
  };
}
