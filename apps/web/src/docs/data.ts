// What the document screens ask of the server — the portals' own routes (…/rfqs, …/purchase-orders, …/customers or …/leads,
// …/supplier-vehicles), which are one handler for both portals — and the changes they make. A list is asked for each time its
// screen opens, and again after every change; a record and the form's starting values are asked for when a form opens, and
// never kept for the next one (a new document's number is made on the server, each time).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSession } from '../app/context';
import { ApiError, type Api } from '../lib/api';
import { isOfferList, type Offer } from '../modules/suppliers';
import { isLeadList, isPdf, isXlsx, type LeadOption } from './model';

const SAY_NOT_KNOWN = 'came back in a form this app does not know.';

/** What differs between one kind of document and the next: where it lives on the server and how its answers are read. */
export interface DocSpec<Row, Full, Defaults> {
  /** the cache key's part, and the words in the notices */
  key: 'rfq' | 'po' | 'contract';
  /** under the portal's base */
  path: 'rfqs' | 'purchase-orders' | 'contracts';
  /** "RFQ", "purchase order" — what a notice calls it */
  noun: string;
  isList: (v: unknown) => v is Row[];
  isOne: (v: unknown) => v is Full;
  isDefaults: (v: unknown) => v is Defaults;
}

const listKey = (actor: string, key: string) => ['docs', actor, key, 'list'] as const;

// ── A kind of document's list ───────────────────────────────────────────────────────────────────────────────────────────────

export interface DocList<Row> {
  items: readonly Row[];
  loading: boolean;
  /** why it could not be had, in words: a server's, or "could not reach it" (status 0) */
  error: { status: number; message: string } | null;
  reload: () => void;
}

export function useDocList<Row, Full, Defaults>(spec: DocSpec<Row, Full, Defaults>): DocList<Row> {
  const { api, me } = useSession();
  const actor = me.actor.key;
  const q = useQuery({
    queryKey: listKey(actor, spec.key),
    queryFn: async ({ signal }): Promise<Row[]> => {
      const body = await api.get<unknown>(`${api.base}/${spec.path}`, { signal });
      // (an answer that is not a list is no documents, as it was)
      if (!Array.isArray(body)) return [];
      if (!spec.isList(body)) throw new ApiError(502, `The ${spec.noun}s ${SAY_NOT_KNOWN}`);
      return body;
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  const qc = useQueryClient();
  const reload = useCallback(
    () => void qc.invalidateQueries({ queryKey: listKey(actor, spec.key) }),
    [qc, actor, spec.key],
  );
  return {
    items: q.data ?? [],
    loading: q.isFetching,
    error: q.isError
      ? { status: q.error instanceof ApiError ? q.error.status : 0, message: q.error.message }
      : null,
    reload,
  };
}

// ── One document, or the starting values of a new one ───────────────────────────────────────────────────────────────────────

export interface DocStart<Full, Defaults> {
  /** the record being edited, or what a new one starts from */
  data: { saved: Full } | { fresh: Defaults } | undefined;
  loading: boolean;
  error: string | null;
}

/** The record of an existing document (`id`), or the starting form of a new one (made for this lead, if one is named). */
export function useDocStart<Row, Full, Defaults>(
  spec: DocSpec<Row, Full, Defaults>,
  id: number | null,
  lead: number | null,
): DocStart<Full, Defaults> {
  const { api, me } = useSession();
  const q = useQuery({
    queryKey: ['docs', me.actor.key, spec.key, id === null ? ['new', lead] : ['one', id]] as const,
    queryFn: async ({ signal }): Promise<{ saved: Full } | { fresh: Defaults }> => {
      if (id !== null) {
        const body = await api.get<unknown>(`${api.base}/${spec.path}/${id}`, { signal });
        if (!spec.isOne(body)) throw new ApiError(502, `The ${spec.noun} ${SAY_NOT_KNOWN}`);
        return { saved: body };
      }
      const qs = lead ? `?customer_id=${encodeURIComponent(String(lead))}` : '';
      const body = await api.get<unknown>(`${api.base}/${spec.path}/new/defaults${qs}`, { signal });
      if (!spec.isDefaults(body))
        throw new ApiError(502, `The starting form of a new ${spec.noun} ${SAY_NOT_KNOWN}`);
      return { fresh: body };
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
    // (a form is opened from what the server says now: nothing is kept for the next one)
    gcTime: 0,
  });
  return { data: q.data, loading: q.isPending, error: q.isError ? q.error.message : null };
}

// ── What is done to a document ──────────────────────────────────────────────────────────────────────────────────────────────

export type Saved = { ok: true } | { ok: false; message: string };

export function useDocWrites<Row, Full, Defaults>(spec: DocSpec<Row, Full, Defaults>) {
  const { api, me, toasts } = useSession();
  const qc = useQueryClient();
  const actor = me.actor.key;
  const refresh = () => void qc.invalidateQueries({ queryKey: listKey(actor, spec.key) });
  return {
    /** save a document (a new one where there is no id): the server's words on a refusal */
    async save(id: number | null, body: Record<string, unknown>): Promise<Saved> {
      try {
        const base = `${api.base}/${spec.path}`;
        const row = id
          ? await api.put<unknown>(`${base}/${id}`, body)
          : await api.post<unknown>(base, body);
        if (!spec.isOne(row))
          return { ok: false, message: `The saved ${spec.noun} ${SAY_NOT_KNOWN}` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      refresh();
      return { ok: true };
    },
    async remove(id: number): Promise<void> {
      try {
        await api.del(`${api.base}/${spec.path}/${id}`);
      } catch (e) {
        toasts.show(e instanceof Error ? e.message : String(e));
      }
      refresh();
    },
  };
}

// ── What a document becomes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** An RFQ as the workbook the supplier fills in: a saved one (by id) or the form as it stands (its payload). */
export async function buildXlsx(
  api: Api,
  what: { id: number } | { payload: Record<string, unknown> },
): Promise<{ xlsx: string; name: string }> {
  const out =
    'id' in what
      ? await api.post<unknown>(`${api.base}/rfqs/${what.id}/xlsx`)
      : await api.post<unknown>(`${api.base}/rfqs/xlsx`, what.payload);
  if (!isXlsx(out)) throw new ApiError(502, `The workbook ${SAY_NOT_KNOWN}`);
  return out;
}

/** A purchase order as a PDF, from the form (or the record) as it stands. */
export async function buildPdf(
  api: Api,
  payload: Record<string, unknown>,
): Promise<{ pdf: string; name?: string }> {
  const out = await api.post<unknown>(`${api.base}/purchase-orders/pdf`, payload);
  if (!isPdf(out)) throw new ApiError(502, `The document ${SAY_NOT_KNOWN}`);
  return out;
}

/** A contract as a PDF, from its data as the form (or the saved record) holds it. */
export async function buildContractPdf(
  api: Api,
  data: Record<string, unknown>,
): Promise<{ pdf: string; name?: string }> {
  const out = await api.post<unknown>(`${api.base}/contracts/pdf`, { data });
  if (!isPdf(out)) throw new ApiError(502, `The document ${SAY_NOT_KNOWN}`);
  return out;
}

// ── The lists a form picks from ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The leads a document can be attached to: the administrator's whole register, a team member's own (the classic page asked
 * the team's portal for the administrator's route and never filled the list). Whatever cannot be had is no leads.
 */
export function useLeads(): { leads: readonly LeadOption[] } {
  const { api, me, portal } = useSession();
  const q = useQuery({
    queryKey: ['docs', me.actor.key, 'leads'] as const,
    queryFn: async ({ signal }): Promise<LeadOption[]> => {
      try {
        const body = await api.get<unknown>(
          `${api.base}/${portal === 'admin' ? 'customers' : 'leads'}`,
          {
            signal,
          },
        );
        if (!isLeadList(body)) return [];
        return [...body].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      } catch {
        return [];
      }
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  return { leads: q.data ?? [] };
}

/** What every supplier offers (the catalogue a line can be pulled from): asked for when the picker is opened, and a moment kept. */
export function useOfferLoader(): () => Promise<readonly Offer[]> {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const actor = me.actor.key;
  return useCallback(
    () =>
      qc.fetchQuery({
        queryKey: ['docs', actor, 'offers'] as const,
        queryFn: async ({ signal }): Promise<Offer[]> => {
          try {
            const body = await api.get<unknown>(`${api.base}/supplier-vehicles`, { signal });
            return isOfferList(body) ? body : [];
          } catch {
            return [];
          }
        },
        staleTime: 30_000,
      }),
    [api, actor, qc],
  );
}
