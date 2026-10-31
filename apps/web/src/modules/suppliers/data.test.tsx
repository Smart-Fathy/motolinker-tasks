import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../../app/context';
import { ApiError } from '../../lib/api';
import { adminMe, deferred } from '../../test/helpers';
import {
  useDocs,
  useDocWrites,
  usePurchases,
  useSuppliers,
  useSupplierWrites,
  useVehicles,
  useVehicleWrites,
} from './data';

afterEach(cleanup);

const BASE = '/api/dashboard';
const supplier = (id: number) => ({
  id,
  name: `Supplier ${id}`,
  contact: '',
  address: '',
  country: '',
  notes: '',
  custom_fields: {},
});
const vehicle = (id: number) => ({
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
});

type Handler = (body?: unknown) => unknown;

/**
 * The hooks, mounted under a fake session whose server answers `METHOD path` with what the test gives it (a thrown ApiError is a
 * refusal; a path nobody listed is a 404). The query client is the app's, except that nothing is ever fresh, so that only what a
 * hook asks for shows: the app's own keeps a list fresh for 30 s.
 */
function setup(routes: Record<string, Handler>) {
  const asked: string[] = [];
  const run = async (method: string, path: string, body?: unknown) => {
    const key = `${method} ${path}`;
    asked.push(key);
    const handler = routes[key];
    if (!handler) throw new ApiError(404, `no route ${key}`);
    return handler(body);
  };
  const api = {
    base: BASE,
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
  const value = { portal: 'admin', me: adminMe(), api, toasts } as unknown as SessionValue;
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
    times: (key: string) => asked.filter(a => a === key).length,
  };
}

const REGISTER = `GET ${BASE}/suppliers`;
const CATALOGUE = `GET ${BASE}/supplier-vehicles`;
const STOCK = `GET ${BASE}/stock`;
const WORDS = 'came back in a form this app does not know.';

describe('the register', () => {
  const answers = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
    [REGISTER]: () => [supplier(1), supplier(2)],
    [CATALOGUE]: () => [{ supplier_id: 1 }, { supplier_id: 1 }],
    [STOCK]: () => [{ units: [{ supplier: 'Supplier 1', price_list: 100 }] }],
    ...over,
  });

  it('is the suppliers the server lists, with the figures of the two lists beside it', async () => {
    const s = setup(answers());
    const { result } = renderHook(() => useSuppliers(true), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map(i => i.name)).toEqual(['Supplier 1', 'Supplier 2']);
    expect(result.current.error).toBeNull();
    expect(result.current.stats.totalCatalogue).toBe(2);
    expect(result.current.stats.totalUnits).toBe(1);
  });

  it('is the loader until the register, the figures and the columns have each been answered', async () => {
    const s = setup(answers());
    const { result, rerender } = renderHook(({ ready }) => useSuppliers(ready), {
      wrapper: s.wrapper,
      initialProps: { ready: false },
    });
    await waitFor(() => expect(s.times(STOCK)).toBe(1));
    await waitFor(() => expect(result.current.items.length).toBe(2));
    expect(result.current.loading).toBe(true);
    rerender({ ready: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('is asked again — and so are its figures — each time the screen opens, however recently it was asked', async () => {
    const s = setup(answers());
    const first = renderHook(() => useSuppliers(true), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useSuppliers(true), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times(REGISTER)).toBe(2));
    await waitFor(() => expect(s.times(STOCK)).toBe(2));
    await waitFor(() => expect(s.times(CATALOGUE)).toBe(2));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
  });

  it('takes an answer that is not a list for no suppliers, as the classic page did', async () => {
    for (const body of [{}, null, 'no', 7]) {
      const s = setup(answers({ [REGISTER]: () => body }));
      const { result, unmount } = renderHook(() => useSuppliers(true), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.items).toEqual([]);
      expect(result.current.error).toBeNull();
      unmount();
    }
  });

  it('says so when the list is a list of something else, rather than draw what it cannot read', async () => {
    for (const body of [[{ id: 'x' }], [supplier(1), { name: 'no id' }], [null]]) {
      const s = setup(answers({ [REGISTER]: () => body }));
      const { result, unmount } = renderHook(() => useSuppliers(true), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.error).toEqual({ status: 502, message: `The suppliers ${WORDS}` });
      expect(result.current.items).toEqual([]);
      unmount();
    }
  });

  it('says what the server said — and that nothing reached it — as the status tells them apart', async () => {
    const refused = setup(
      answers({
        [REGISTER]: () => {
          throw new ApiError(500, 'relation "suppliers" does not exist');
        },
      }),
    );
    const a = renderHook(() => useSuppliers(true), { wrapper: refused.wrapper });
    await waitFor(() => expect(a.result.current.error).not.toBeNull());
    expect(a.result.current.error).toEqual({
      status: 500,
      message: 'relation "suppliers" does not exist',
    });
    const down = setup(
      answers({
        [REGISTER]: () => {
          throw new TypeError('offline');
        },
      }),
    );
    const b = renderHook(() => useSuppliers(true), { wrapper: down.wrapper });
    await waitFor(() => expect(b.result.current.error).not.toBeNull());
    expect(b.result.current.error?.status).toBe(0);
  });

  it('has no figure for a list another section would not give — and none later, when it stops giving it', async () => {
    let stock: Handler = () => [{ units: [{ supplier: 'Supplier 1', price_list: 100 }] }];
    const s = setup(answers({ [STOCK]: body => stock(body) }));
    const { result } = renderHook(() => useSuppliers(true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats.haveStock).toBe(true);
    stock = () => {
      throw new ApiError(403, 'Not permitted');
    };
    act(() => result.current.reload());
    await waitFor(() => expect(s.times(STOCK)).toBe(2));
    await waitFor(() => expect(result.current.stats.haveStock).toBe(false));
    expect(result.current.items.length).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.stats.haveCatalogue).toBe(true);
  });
});

describe('what is done to a supplier', () => {
  const body = {
    name: 'Yu',
    contact: '',
    country: '',
    address: '',
    notes: '',
    custom_fields: {},
  };

  it('adds one by POST and edits one by PUT, and asks for the register again after either', async () => {
    const s = setup({
      [REGISTER]: () => [supplier(1)],
      [`POST ${BASE}/suppliers`]: b => ({ ...supplier(9), ...(b as object) }),
      [`PUT ${BASE}/suppliers/4`]: b => ({ ...supplier(4), ...(b as object) }),
    });
    const { result } = renderHook(() => ({ list: useSuppliers(true), w: useSupplierWrites() }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await result.current.w.save(null, body);
    });
    expect(out).toEqual({ ok: true });
    expect(s.api.post).toHaveBeenCalledWith(`${BASE}/suppliers`, body);
    await waitFor(() => expect(s.times(REGISTER)).toBe(2));
    await act(async () => {
      out = await result.current.w.save(4, body);
    });
    expect(out).toEqual({ ok: true });
    expect(s.api.put).toHaveBeenCalledWith(`${BASE}/suppliers/4`, body);
    await waitFor(() => expect(s.times(REGISTER)).toBe(3));
  });

  it('says what the server said where it refuses, and does not ask for the register again', async () => {
    const s = setup({
      [REGISTER]: () => [supplier(1)],
      [`POST ${BASE}/suppliers`]: () => {
        throw new ApiError(400, 'Supplier name is required');
      },
    });
    const { result } = renderHook(() => ({ list: useSuppliers(true), w: useSupplierWrites() }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await result.current.w.save(null, body);
    });
    expect(out).toEqual({ ok: false, message: 'Supplier name is required' });
    expect(s.times(REGISTER)).toBe(1);
  });

  it('does not take for saved a supplier that came back as something else', async () => {
    for (const answer of [{ ok: true }, null, [], { id: 'x', name: 'Yu' }]) {
      const s = setup({
        [REGISTER]: () => [supplier(1)],
        [`POST ${BASE}/suppliers`]: () => answer,
      });
      const { result, unmount } = renderHook(
        () => ({ list: useSuppliers(true), w: useSupplierWrites() }),
        { wrapper: s.wrapper },
      );
      await waitFor(() => expect(result.current.list.loading).toBe(false));
      let out: unknown;
      await act(async () => {
        out = await result.current.w.save(null, body);
      });
      expect(out).toEqual({ ok: false, message: `The saved supplier ${WORDS}` });
      expect(s.times(REGISTER)).toBe(1);
      unmount();
    }
  });

  it('says what the server said where it would not delete, and asks for the register again all the same', async () => {
    const s = setup({
      [REGISTER]: () => [supplier(1)],
      [`DELETE ${BASE}/suppliers/1`]: () => {
        throw new ApiError(409, 'In use by a purchase order');
      },
    });
    const { result } = renderHook(() => ({ list: useSuppliers(true), w: useSupplierWrites() }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    await act(async () => {
      await result.current.w.remove(1);
    });
    expect(s.toasts.show).toHaveBeenCalledWith('In use by a purchase order');
    await waitFor(() => expect(s.times(REGISTER)).toBe(2));
  });
});

describe("a supplier's pages", () => {
  const VEHICLES = `GET ${BASE}/suppliers/1/vehicles`;

  it('are asked of the supplier, and refused when they are not what they should be', async () => {
    const good = setup({ [VEHICLES]: () => [vehicle(1)] });
    const a = renderHook(() => useVehicles(1), { wrapper: good.wrapper });
    expect(a.result.current.loading).toBe(true);
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    expect(a.result.current.data?.map(v => v.id)).toEqual([1]);
    expect(a.result.current.error).toBeNull();
    for (const [hook, path] of [
      [useVehicles, 'vehicles'],
      [useDocs, 'docs'],
      [usePurchases, 'purchases'],
    ] as const) {
      const bad = setup({ [`GET ${BASE}/suppliers/1/${path}`]: () => [{ id: 'x' }] });
      const b = renderHook(() => hook(1), { wrapper: bad.wrapper });
      await waitFor(() => expect(b.result.current.error).not.toBeNull());
      expect(b.result.current.error).toBe(`The ${path} ${WORDS}`);
      expect(b.result.current.data).toBeUndefined();
      b.unmount();
    }
  });

  it('are the loader again when they are opened again: what a page showed before is not shown while it loads', async () => {
    const slow = deferred<unknown>();
    let answer: Handler = () => [vehicle(1)];
    const s = setup({ [VEHICLES]: () => answer() });
    const first = renderHook(() => useVehicles(1), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    await act(async () => {
      await new Promise(r => setTimeout(r, 20));
    });
    answer = () => slow.promise;
    const second = renderHook(() => useVehicles(1), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times(VEHICLES)).toBe(2));
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.data).toBeUndefined();
    slow.resolve([vehicle(2)]);
    await waitFor(() => expect(second.result.current.data?.map(v => v.id)).toEqual([2]));
  });

  it('add a vehicle as "New" with no model, and refuse an answer that is not a vehicle', async () => {
    const s = setup({
      [VEHICLES]: () => [vehicle(1)],
      [`POST ${BASE}/suppliers/1/vehicles`]: () => vehicle(50),
    });
    const { result } = renderHook(() => ({ list: useVehicles(1), w: useVehicleWrites(1) }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await result.current.w.add();
    });
    expect(out).toEqual({ ok: true });
    expect(s.api.post).toHaveBeenCalledWith(`${BASE}/suppliers/1/vehicles`, {
      brand: 'New',
      model: '',
    });
    await waitFor(() => expect(s.times(VEHICLES)).toBe(2));

    const odd = setup({
      [VEHICLES]: () => [vehicle(1)],
      [`POST ${BASE}/suppliers/1/vehicles`]: () => ({ ok: true }),
    });
    const b = renderHook(() => ({ list: useVehicles(1), w: useVehicleWrites(1) }), {
      wrapper: odd.wrapper,
    });
    await waitFor(() => expect(b.result.current.list.loading).toBe(false));
    await act(async () => {
      out = await b.result.current.w.add();
    });
    expect(out).toEqual({ ok: false, message: WORDS });
    expect(odd.times(VEHICLES)).toBe(1);
  });

  it('save a vehicle by PUT without asking for the page again, and remove one by DELETE and ask for it', async () => {
    const s = setup({
      [VEHICLES]: () => [vehicle(1)],
      [`PUT ${BASE}/suppliers/1/vehicles/1`]: () => vehicle(1),
      [`DELETE ${BASE}/suppliers/1/vehicles/1`]: () => ({ ok: true }),
    });
    const { result } = renderHook(() => ({ list: useVehicles(1), w: useVehicleWrites(1) }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await result.current.w.save(1, { brand: 'X' });
    });
    expect(out).toEqual({ ok: true });
    expect(s.api.put).toHaveBeenCalledWith(`${BASE}/suppliers/1/vehicles/1`, { brand: 'X' });
    expect(s.times(VEHICLES)).toBe(1);
    await act(async () => {
      out = await result.current.w.remove(1);
    });
    expect(out).toEqual({ ok: true });
    await waitFor(() => expect(s.times(VEHICLES)).toBe(2));
  });

  it('say what the server said where it would not save or remove, and leave the page as it is', async () => {
    const s = setup({
      [VEHICLES]: () => [vehicle(1)],
      [`PUT ${BASE}/suppliers/1/vehicles/1`]: () => {
        throw new ApiError(500, 'save failed');
      },
      [`DELETE ${BASE}/suppliers/1/vehicles/1`]: () => {
        throw new ApiError(500, 'remove failed');
      },
    });
    const { result } = renderHook(() => ({ list: useVehicles(1), w: useVehicleWrites(1) }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await result.current.w.save(1, {});
    });
    expect(out).toEqual({ ok: false, message: 'save failed' });
    await act(async () => {
      out = await result.current.w.remove(1);
    });
    expect(out).toEqual({ ok: false, message: 'remove failed' });
    expect(s.times(VEHICLES)).toBe(1);
  });

  it('send a document as the form field "file", and ask for the documents again', async () => {
    const DOCS = `GET ${BASE}/suppliers/1/docs`;
    const s = setup({ [DOCS]: () => [], [`POST ${BASE}/suppliers/1/docs`]: () => ({ ok: true }) });
    const { result } = renderHook(() => ({ list: useDocs(1), w: useDocWrites(1) }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    const file = new File(['x'], 'licence.png', { type: 'image/png' });
    let out: unknown;
    await act(async () => {
      out = await result.current.w.upload(file);
    });
    expect(out).toEqual({ ok: true });
    const sent = s.api.postForm.mock.calls[0]?.[1];
    expect(sent?.get('file')).toBe(file);
    await waitFor(() => expect(s.times(DOCS)).toBe(2));
  });

  it('say what the server said where it would not take the file', async () => {
    const DOCS = `GET ${BASE}/suppliers/1/docs`;
    const s = setup({
      [DOCS]: () => [],
      [`POST ${BASE}/suppliers/1/docs`]: () => {
        throw new ApiError(413, 'File too large (25 MB limit)');
      },
    });
    const { result } = renderHook(() => ({ list: useDocs(1), w: useDocWrites(1) }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    let out: unknown;
    await act(async () => {
      out = await result.current.w.upload(new File(['x'], 'big.bin'));
    });
    expect(out).toEqual({ ok: false, message: 'File too large (25 MB limit)' });
    expect(s.times(DOCS)).toBe(1);
  });
});
