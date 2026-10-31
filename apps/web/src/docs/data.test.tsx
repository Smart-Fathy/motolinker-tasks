import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../app/context';
import { ApiError } from '../lib/api';
import { RFQ_SPEC } from '../modules/rfq/spec';
import { PO_SPEC } from '../modules/purchaseorders/spec';
import { adminMe, deferred, teamMe } from '../test/helpers';
import {
  buildPdf,
  buildXlsx,
  useDocList,
  useDocStart,
  useDocWrites,
  useLeads,
  useOfferLoader,
} from './data';

afterEach(cleanup);

const WORDS = 'came back in a form this app does not know.';
const rfqRow = (id: number) => ({
  id,
  rfq_no: `MT-${id}`,
  title: 'x',
  supplier_name: null,
  issuer: null,
  rfq_date: null,
  status: 'draft',
  customer_id: null,
  items: [],
  created_by: null,
  created_at: null,
});
const rfqFull = (id: number) => ({
  ...rfqRow(id),
  supplier_id: null,
  supplier_contact: null,
  supplier_address: null,
  supplier_country: null,
  payment_terms: null,
  delivery_location: null,
  service_provider: null,
  contact: null,
  documents_required: null,
  custom_fields: {},
});
const rfqDefaults = (over: Record<string, unknown> = {}) => ({
  rfq_no: 'MT-NEW',
  rfq_date: '2026-10-31',
  items: [{}],
  payment_terms: '',
  documents_required: '',
  customer_id: null,
  ...over,
});
const poRow = (id: number) => ({
  id,
  po_number: `PO-${id}`,
  title: 'x',
  supplier: null,
  po_date: null,
  currency: 'USD',
  status: 'draft',
  customer_id: null,
  items: [],
  created_by: null,
  created_at: null,
});

type Handler = (body?: unknown) => unknown;

/**
 * The hooks, mounted under a fake session whose server answers `METHOD path` with what the test gives it (a thrown ApiError is a
 * refusal; a path nobody listed is a 404). The query client is the app's, except that nothing is ever fresh.
 */
function setup(routes: Record<string, Handler>, portal: 'admin' | 'team' = 'admin') {
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const asked: string[] = [];
  const bodies: Record<string, unknown> = {};
  const run = async (method: string, path: string, body?: unknown) => {
    const key = `${method} ${path}`;
    asked.push(key);
    bodies[key] = body;
    const handler = routes[key];
    if (!handler) throw new ApiError(404, `no route ${key}`);
    return handler(body);
  };
  const api = {
    base,
    get: vi.fn((path: string) => run('GET', path)),
    post: vi.fn((path: string, body?: unknown) => run('POST', path, body)),
    put: vi.fn((path: string, body?: unknown) => run('PUT', path, body)),
    del: vi.fn((path: string) => run('DELETE', path)),
    postForm: vi.fn((path: string, form: FormData) => run('POST', path, form)),
  };
  const toasts = { show: vi.fn() };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const value = {
    portal,
    me: portal === 'admin' ? adminMe() : teamMe({}),
    api,
    toasts,
  } as unknown as SessionValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionContext value={value}>{children}</SessionContext>
    </QueryClientProvider>
  );
  return {
    wrapper,
    api,
    toasts,
    asked,
    bodies,
    base,
    client,
    times: (k: string) => asked.filter(a => a === k).length,
  };
}

describe('a kind of document', () => {
  it('has its own place on the server, its own cache and its own noun', () => {
    expect([RFQ_SPEC.key, RFQ_SPEC.path, RFQ_SPEC.noun]).toEqual(['rfq', 'rfqs', 'RFQ']);
    expect([PO_SPEC.key, PO_SPEC.path, PO_SPEC.noun]).toEqual([
      'po',
      'purchase-orders',
      'purchase order',
    ]);
  });
});

describe('the list of documents', () => {
  it("is what the portal's own route lists, asked for when the screen opens", async () => {
    const s = setup({ 'GET /api/dashboard/rfqs': () => [rfqRow(2), rfqRow(1)] });
    const { result } = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map(i => i.id)).toEqual([2, 1]);
    expect(result.current.error).toBeNull();
  });
  it("is asked of the team's own route in the team portal", async () => {
    const s = setup({ 'GET /api/employee/purchase-orders': () => [poRow(1)] }, 'team');
    const { result } = renderHook(() => useDocList(PO_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(s.asked).toEqual(['GET /api/employee/purchase-orders']);
  });
  it('is asked for again each time the screen opens (even where a list is kept fresh for a while)', async () => {
    const s = setup({ 'GET /api/dashboard/rfqs': () => [rfqRow(1)] });
    const first = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times('GET /api/dashboard/rfqs')).toBe(2));
    second.unmount();
  });
  it('is no documents when the answer is not a list (as the classic page read it)', async () => {
    const s = setup({ 'GET /api/dashboard/rfqs': () => ({ nothing: true }) });
    const { result } = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });
  it('says so, in words, when a list holds something that is not a document', async () => {
    const s = setup({ 'GET /api/dashboard/rfqs': () => [rfqRow(1), { id: 'x' }] });
    const { result } = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({ status: 502, message: `The RFQs ${WORDS}` });
    expect(result.current.items).toEqual([]);
  });
  it("gives the server's words, and its status, for a refusal", async () => {
    const s = setup({
      'GET /api/dashboard/purchase-orders': () => {
        throw new ApiError(500, 'relation "purchase_orders" does not exist');
      },
    });
    const { result } = renderHook(() => useDocList(PO_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({
      status: 500,
      message: 'relation "purchase_orders" does not exist',
    });
  });
  it('is "could not reach it" (status 0) when the network is the trouble', async () => {
    const s = setup({
      'GET /api/dashboard/rfqs': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const { result } = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.status).toBe(0);
    expect(result.current.error?.message).toBe('Failed to fetch');
  });
  it('is asked for again on request', async () => {
    let n = 0;
    const s = setup({
      'GET /api/dashboard/rfqs': () => (n++ ? [rfqRow(1), rfqRow(2)] : [rfqRow(1)]),
    });
    const { result } = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
  });
  it('is loading again while it is asked for again, and keeps what it has until the answer comes', async () => {
    const gate = deferred<void>();
    let n = 0;
    const s = setup({
      'GET /api/dashboard/rfqs': () =>
        n++ ? gate.promise.then(() => [rfqRow(1), rfqRow(2)]) : [rfqRow(1)],
    });
    const { result } = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.items).toHaveLength(1);
    gate.resolve();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.loading).toBe(false);
  });
  it("is each person's own: what one portal's actor was shown is not shown to another", async () => {
    const admin = setup({ 'GET /api/dashboard/rfqs': () => [rfqRow(1)] });
    const a = renderHook(() => useDocList(RFQ_SPEC), { wrapper: admin.wrapper });
    await waitFor(() => expect(a.result.current.items).toHaveLength(1));
    const keys = admin.client
      .getQueryCache()
      .getAll()
      .map(q => q.queryKey);
    expect(keys).toContainEqual(['docs', adminMe().actor.key, 'rfq', 'list']);
  });
});

describe('a document, or the starting form of a new one', () => {
  it('an existing document is its record, asked for by its number', async () => {
    const s = setup({ 'GET /api/dashboard/rfqs/4': () => rfqFull(4) });
    const { result } = renderHook(() => useDocStart(RFQ_SPEC, 4, null), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({ saved: { id: 4 } });
    expect(result.current.error).toBeNull();
  });
  it('a new one is what the server starts it with', async () => {
    const s = setup({ 'GET /api/dashboard/rfqs/new/defaults': () => rfqDefaults() });
    const { result } = renderHook(() => useDocStart(RFQ_SPEC, null, null), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ fresh: rfqDefaults() });
  });
  it('a new one made for a lead asks for the form made from that lead', async () => {
    const s = setup({
      'GET /api/dashboard/rfqs/new/defaults?customer_id=7': () => rfqDefaults({ customer_id: 7 }),
    });
    const { result } = renderHook(() => useDocStart(RFQ_SPEC, null, 7), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({ fresh: { customer_id: 7 } });
    expect(s.asked).toEqual(['GET /api/dashboard/rfqs/new/defaults?customer_id=7']);
  });
  it('is the same for a purchase order, at its own address', async () => {
    const s = setup(
      {
        'GET /api/employee/purchase-orders/new/defaults': () => ({
          po_number: 'PO-N',
          po_date: '2026-10-31',
          currency: 'USD',
          items: [{}],
          customer_id: null,
        }),
      },
      'team',
    );
    const { result } = renderHook(() => useDocStart(PO_SPEC, null, null), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({ fresh: { po_number: 'PO-N' } });
  });
  it('says so, in words, when a record is not a document', async () => {
    const s = setup({ 'GET /api/dashboard/rfqs/4': () => ({ id: 4 }) });
    const { result } = renderHook(() => useDocStart(RFQ_SPEC, 4, null), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(`The RFQ ${WORDS}`);
    expect(result.current.data).toBeUndefined();
  });
  it('says so, in words, when the starting form is not one', async () => {
    const s = setup({
      'GET /api/dashboard/purchase-orders/new/defaults': () => ({ po_number: 3 }),
    });
    const { result } = renderHook(() => useDocStart(PO_SPEC, null, null), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(`The starting form of a new purchase order ${WORDS}`);
  });
  it("gives the server's words for a refusal (a document that is not there)", async () => {
    const s = setup({
      'GET /api/dashboard/rfqs/9': () => {
        throw new ApiError(404, 'RFQ not found');
      },
    });
    const { result } = renderHook(() => useDocStart(RFQ_SPEC, 9, null), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.error).toBe('RFQ not found'));
  });
  it("is never kept for the next form: a new document's number is made on the server each time it is asked for", async () => {
    let n = 0;
    const s = setup({
      'GET /api/dashboard/rfqs/new/defaults': () => rfqDefaults({ rfq_no: `MT-${++n}` }),
    });
    const first = renderHook(() => useDocStart(RFQ_SPEC, null, null), { wrapper: s.wrapper });
    await waitFor(() =>
      expect(first.result.current.data).toEqual({ fresh: rfqDefaults({ rfq_no: 'MT-1' }) }),
    );
    first.unmount();
    const second = renderHook(() => useDocStart(RFQ_SPEC, null, null), { wrapper: s.wrapper });
    await waitFor(() =>
      expect(second.result.current.data).toEqual({ fresh: rfqDefaults({ rfq_no: 'MT-2' }) }),
    );
    expect(s.times('GET /api/dashboard/rfqs/new/defaults')).toBe(2);
  });
});

describe('what is done to a document', () => {
  it('a new document is posted to the list, and the list is asked for again', async () => {
    let listed = 0;
    const s = setup({
      'GET /api/dashboard/rfqs': () => (++listed ? [rfqRow(1)] : []),
      'POST /api/dashboard/rfqs': () => rfqFull(1),
    });
    const list = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    const writes = renderHook(() => useDocWrites(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(list.result.current.loading).toBe(false));
    const out = await writes.result.current.save(null, { rfq_no: 'MT-1', items: [] });
    expect(out).toEqual({ ok: true });
    expect(s.bodies['POST /api/dashboard/rfqs']).toEqual({ rfq_no: 'MT-1', items: [] });
    await waitFor(() => expect(s.times('GET /api/dashboard/rfqs')).toBe(2));
  });
  it('a document that has a number is put at its own address', async () => {
    const s = setup({
      'PUT /api/dashboard/purchase-orders/9': () => ({ ...poRow(9), notes: null }),
    });
    const writes = renderHook(() => useDocWrites(PO_SPEC), { wrapper: s.wrapper });
    const out = await writes.result.current.save(9, { notes: 'x' });
    expect(out).toEqual({ ok: true });
    expect(s.asked).toEqual(['PUT /api/dashboard/purchase-orders/9']);
    expect(s.bodies['PUT /api/dashboard/purchase-orders/9']).toEqual({ notes: 'x' });
  });
  it("a refusal is the server's words, and the list is not asked for again", async () => {
    const s = setup({
      'POST /api/dashboard/rfqs': () => {
        throw new ApiError(400, 'RFQ number already exists');
      },
    });
    const writes = renderHook(() => useDocWrites(RFQ_SPEC), { wrapper: s.wrapper });
    const out = await writes.result.current.save(null, {});
    expect(out).toEqual({ ok: false, message: 'RFQ number already exists' });
    expect(s.asked).toEqual(['POST /api/dashboard/rfqs']);
  });
  it('an answer that is not a document is said so, and nothing is pretended saved', async () => {
    const s = setup({ 'POST /api/dashboard/rfqs': () => ({ ok: true }) });
    const writes = renderHook(() => useDocWrites(RFQ_SPEC), { wrapper: s.wrapper });
    const out = await writes.result.current.save(null, {});
    expect(out).toEqual({ ok: false, message: `The saved RFQ ${WORDS}` });
    expect(s.asked).toEqual(['POST /api/dashboard/rfqs']);
  });
  it('a network failure is a refusal too, with its own words', async () => {
    const s = setup({
      'PUT /api/dashboard/rfqs/3': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const writes = renderHook(() => useDocWrites(RFQ_SPEC), { wrapper: s.wrapper });
    expect(await writes.result.current.save(3, {})).toEqual({
      ok: false,
      message: 'Failed to fetch',
    });
  });
  it('a document is deleted at its own address, and the list is asked for again', async () => {
    const s = setup({
      'GET /api/dashboard/rfqs': () => [],
      'DELETE /api/dashboard/rfqs/5': () => ({ ok: true }),
    });
    const list = renderHook(() => useDocList(RFQ_SPEC), { wrapper: s.wrapper });
    const writes = renderHook(() => useDocWrites(RFQ_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(list.result.current.loading).toBe(false));
    await writes.result.current.remove(5);
    expect(s.times('DELETE /api/dashboard/rfqs/5')).toBe(1);
    await waitFor(() => expect(s.times('GET /api/dashboard/rfqs')).toBe(2));
    expect(s.toasts.show).not.toHaveBeenCalled();
  });
  it('a refused delete says why in a notice, and the list is asked for again all the same (it may have changed)', async () => {
    const s = setup({
      'GET /api/dashboard/purchase-orders': () => [poRow(1)],
      'DELETE /api/dashboard/purchase-orders/1': () => {
        throw new ApiError(403, 'Not permitted');
      },
    });
    const list = renderHook(() => useDocList(PO_SPEC), { wrapper: s.wrapper });
    const writes = renderHook(() => useDocWrites(PO_SPEC), { wrapper: s.wrapper });
    await waitFor(() => expect(list.result.current.loading).toBe(false));
    await writes.result.current.remove(1);
    expect(s.toasts.show).toHaveBeenCalledWith('Not permitted');
    await waitFor(() => expect(s.times('GET /api/dashboard/purchase-orders')).toBe(2));
  });
});

describe('what a document becomes', () => {
  const apiOf = (routes: Record<string, Handler>) =>
    setup(routes).api as unknown as Parameters<typeof buildXlsx>[0];
  it("a saved RFQ's workbook is made from its record, by its number", async () => {
    const s = setup({ 'POST /api/dashboard/rfqs/4/xlsx': () => ({ xlsx: 'UEs=', name: 'Yu' }) });
    const out = await buildXlsx(s.api as unknown as Parameters<typeof buildXlsx>[0], { id: 4 });
    expect(out).toEqual({ xlsx: 'UEs=', name: 'Yu' });
    expect(s.bodies['POST /api/dashboard/rfqs/4/xlsx']).toBeUndefined();
  });
  it("an unsaved form's workbook is made from what the form says", async () => {
    const s = setup({ 'POST /api/dashboard/rfqs/xlsx': () => ({ xlsx: 'UEs=', name: 'Yu' }) });
    const payload = { supplier_name: 'Yu', items: [{ brand: 'BYD' }] };
    const out = await buildXlsx(s.api as unknown as Parameters<typeof buildXlsx>[0], { payload });
    expect(out.name).toBe('Yu');
    expect(s.bodies['POST /api/dashboard/rfqs/xlsx']).toEqual(payload);
  });
  it('a workbook the server did not make is said so', async () => {
    const api = apiOf({ 'POST /api/dashboard/rfqs/4/xlsx': () => ({ xlsx: 3 }) });
    await expect(buildXlsx(api, { id: 4 })).rejects.toThrow(`The workbook ${WORDS}`);
  });
  it("a refused workbook is the server's words", async () => {
    const api = apiOf({
      'POST /api/dashboard/rfqs/4/xlsx': () => {
        throw new ApiError(500, 'Failed to build the workbook');
      },
    });
    await expect(buildXlsx(api, { id: 4 })).rejects.toThrow('Failed to build the workbook');
  });
  it("a purchase order's PDF is made from the form (or the record) as it stands", async () => {
    const s = setup({
      'POST /api/dashboard/purchase-orders/pdf': () => ({ pdf: 'JVBER', name: 'PO-1' }),
    });
    const payload = { po_number: 'PO-1' };
    const out = await buildPdf(s.api as unknown as Parameters<typeof buildPdf>[0], payload);
    expect(out).toEqual({ pdf: 'JVBER', name: 'PO-1' });
    expect(s.bodies['POST /api/dashboard/purchase-orders/pdf']).toEqual(payload);
  });
  it('a PDF may come with no name (an unsaved order has none to give)', async () => {
    const api = apiOf({ 'POST /api/dashboard/purchase-orders/pdf': () => ({ pdf: 'JVBER' }) });
    expect(await buildPdf(api, {})).toEqual({ pdf: 'JVBER' });
  });
  it('a document the server did not make is said so', async () => {
    const api = apiOf({ 'POST /api/dashboard/purchase-orders/pdf': () => ({ name: 'x' }) });
    await expect(buildPdf(api, {})).rejects.toThrow(`The document ${WORDS}`);
  });
});

describe('the leads a document can be attached to', () => {
  it("are the administrator's whole register, by name", async () => {
    const s = setup({
      'GET /api/dashboard/customers': () => [
        { id: 2, name: 'Zed', phone: '+2' },
        { id: 1, name: 'Ali', phone: null },
        { id: 3, name: null },
      ],
    });
    const { result } = renderHook(() => useLeads(), { wrapper: s.wrapper });
    expect(result.current.leads).toEqual([]);
    await waitFor(() => expect(result.current.leads).toHaveLength(3));
    expect(result.current.leads.map(l => l.id)).toEqual([3, 1, 2]);
    expect(s.asked).toEqual(['GET /api/dashboard/customers']);
  });
  it("are a team member's own leads, from the team's own route (the classic page asked for the administrator's, and never filled the list)", async () => {
    const s = setup({ 'GET /api/employee/leads': () => [{ id: 4, name: 'Sara' }] }, 'team');
    const { result } = renderHook(() => useLeads(), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.leads).toHaveLength(1));
    expect(s.asked).toEqual(['GET /api/employee/leads']);
  });
  it('are none where the person may not see them (a refusal is no leads, not an error)', async () => {
    const s = setup(
      {
        'GET /api/employee/leads': () => {
          throw new ApiError(403, 'Not permitted');
        },
      },
      'team',
    );
    const { result } = renderHook(() => useLeads(), { wrapper: s.wrapper });
    await waitFor(() => expect(s.asked).toHaveLength(1));
    await waitFor(() => expect(s.client.isFetching()).toBe(0)); // (it has been answered, not merely asked)
    expect(result.current.leads).toEqual([]);
  });
  it('are none when the answer is not a list of people', async () => {
    const s = setup({ 'GET /api/dashboard/customers': () => [{ name: 'no id' }] });
    const { result } = renderHook(() => useLeads(), { wrapper: s.wrapper });
    await waitFor(() => expect(s.asked).toHaveLength(1));
    await waitFor(() => expect(s.client.isFetching()).toBe(0));
    expect(result.current.leads).toEqual([]);
  });
  it('are none when the answer is not a list at all', async () => {
    const s = setup({ 'GET /api/dashboard/customers': () => ({ error: 'no' }) });
    const { result } = renderHook(() => useLeads(), { wrapper: s.wrapper });
    await waitFor(() => expect(s.asked).toHaveLength(1));
    await waitFor(() => expect(s.client.isFetching()).toBe(0));
    expect(result.current.leads).toEqual([]);
  });
});

describe("what the suppliers' catalogues offer", () => {
  const offer = (id: number) => ({
    id,
    supplier_id: 1,
    brand: 'BYD',
    model: 'Seal',
    trim: '',
    model_year: null,
    availability: '',
    fob_price: null,
    currency: 'USD',
    lead_time: '',
    accessories: '',
    notes: '',
    custom_fields: {},
    supplier_name: 'Yu',
  });
  it('is asked for when the picker opens, and a moment kept', async () => {
    const s = setup({ 'GET /api/dashboard/supplier-vehicles': () => [offer(1), offer(2)] });
    const { result } = renderHook(() => useOfferLoader(), { wrapper: s.wrapper });
    expect(s.asked).toEqual([]);
    const first = await result.current();
    expect(first.map(o => o.id)).toEqual([1, 2]);
    expect((await result.current()).map(o => o.id)).toEqual([1, 2]);
    expect(s.times('GET /api/dashboard/supplier-vehicles')).toBe(1);
  });
  it('is nothing where it cannot be had (a refusal, or an answer that is not a catalogue)', async () => {
    const refused = setup(
      {
        'GET /api/employee/supplier-vehicles': () => {
          throw new ApiError(403, 'Not permitted');
        },
      },
      'team',
    );
    const a = renderHook(() => useOfferLoader(), { wrapper: refused.wrapper });
    expect(await a.result.current()).toEqual([]);
    const odd = setup({ 'GET /api/dashboard/supplier-vehicles': () => [{ id: 'x' }] });
    const b = renderHook(() => useOfferLoader(), { wrapper: odd.wrapper });
    expect(await b.result.current()).toEqual([]);
  });
  it('is asked for once while an answer is awaited (two presses are one question)', async () => {
    const gate = deferred<unknown[]>();
    const s = setup({ 'GET /api/dashboard/supplier-vehicles': () => gate.promise });
    const { result } = renderHook(() => useOfferLoader(), { wrapper: s.wrapper });
    const a = result.current();
    const b = result.current();
    gate.resolve([offer(1)]);
    expect((await a).length).toBe(1);
    expect((await b).length).toBe(1);
    expect(s.times('GET /api/dashboard/supplier-vehicles')).toBe(1);
  });
});
