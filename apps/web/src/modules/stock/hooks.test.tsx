import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessOf } from '../../app/access';
import { SessionContext, type SessionValue } from '../../app/context';
import { ApiError, type Me } from '../../lib/api';
import { makeQueryClient } from '../../lib/query';
import { adminMe, deferred, teamMe } from '../../test/helpers';
import { Tracking } from './Tracking';
import { SAID_FAILED_TO_LOAD, useContainers, useContainerWrites, wordsOf } from './containers';
import { SAID_FAILED_TO_LOAD as SAID_STOCK_FAILED, useStock, useStockWrites } from './data';

afterEach(cleanup);

const BASE = '/api/dashboard';
const TEAM = '/api/employee';

type Handler = (body?: unknown) => unknown;

/**
 * The hooks, mounted under a fake session whose server answers `METHOD path` with what the test gives it (a thrown error is a
 * refusal; a path nobody listed is a 404). The query client is the app's own, so a list that was read a moment ago is still fresh
 * — only what a hook asks for again on purpose is asked again.
 */
function setup(
  routes: Record<string, Handler>,
  { me = adminMe(), portal = 'admin' }: { me?: Me; portal?: 'admin' | 'team' } = {},
) {
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
    base: portal === 'admin' ? BASE : TEAM,
    get: vi.fn((path: string) => run('GET', path)),
    post: vi.fn((path: string, body?: unknown) => run('POST', path, body)),
    put: vi.fn((path: string, body?: unknown) => run('PUT', path, body)),
    del: vi.fn((path: string) => run('DELETE', path)),
    postForm: vi.fn((path: string, form: FormData) => run('POST', path, form)),
  };
  const toasts = { show: vi.fn() };
  const client = makeQueryClient();
  const value = { portal, me, access: accessOf(me), api, toasts } as unknown as SessionValue;
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
    times: (key: string) => asked.filter(a => a === key).length,
  };
}

/** Let what a hook started on its own (and what it garbage-collects) happen. */
const settle = () => new Promise<void>(r => setTimeout(r, 15));

// ── What the server answers ──────────────────────────────────────────────────────────────────────────────────────────────────

const CHECK = { no: 'CSQU3054383', valid: true, checkOk: true, expected: 3 };
const box = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  container_no: 'CSQU3054383',
  container_type: null,
  bl_number: null,
  carrier: null,
  status: 'in_transit',
  latest_move: null,
  latest_move_at: null,
  pod_eta: null,
  vessel_name: null,
  vessel_imo: null,
  pol_code: null,
  pol_name: null,
  pod_code: null,
  pod_name: null,
  atd: null,
  eta: null,
  supplier: null,
  notes: null,
  moves: null,
  po_id: null,
  units: [],
  ...over,
});
const MISS = {
  found: false,
  check: CHECK,
  prefill: null,
  provider: 'x',
  code: 'not-configured',
  detail: null,
  provider_name: 'none',
  can_register: false,
};
const STATUS = {
  provider: 'none',
  configured: false,
  auth_header: 'API_KEY',
  carrier_has_position: false,
  ais: 'not-configured',
  webhook_ready: false,
  probe: 'not-configured',
  reachable: false,
  http: null,
  detail: 'not-configured',
};
const unit = (over: Record<string, unknown> = {}) => ({
  consignee: '',
  colour: '',
  vin: '',
  status: 'send_to_supplier',
  price_list: 0,
  discounted: 0,
  logistics: '',
  supplier: '',
  ...over,
});
const vehicle = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  make: 'BYD',
  model: 'Seal',
  trim: '',
  price: 0,
  quantity: 0,
  units: [],
  notes: '',
  legacy_count: null,
  created_by: 'dashboard',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  ...over,
});

// …and what goes wrong
const NOTHING_REACHED: Handler = () => {
  throw new ApiError(0, 'Cannot reach the server. Check the connection and try again.');
};
const NO_WORDS: Handler = () => {
  throw new ApiError(500, 'The server answered with an error (500).');
};
const REFUSED: Handler = () => {
  throw new ApiError(400, 'The server said so.');
};
const STRANGE: Handler = () => ({ nothing: true });

// ── The words of a failure ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the words of a failure', () => {
  const OWN = 'Could not do it.';

  it('are the server’s own where it had some', () => {
    expect(wordsOf(new ApiError(400, 'MSDU7337230 is already being tracked.'), OWN)).toBe(
      'MSDU7337230 is already being tracked.',
    );
  });
  it('are the call’s own where nothing reached the server', () => {
    expect(
      wordsOf(new ApiError(0, 'Cannot reach the server. Check the connection and try again.'), OWN),
    ).toBe(OWN);
  });
  it('are the call’s own where the server had none, and only the status the app made words of is left', () => {
    for (const status of [400, 404, 500, 503])
      expect(
        wordsOf(new ApiError(status, `The server answered with an error (${status}).`), OWN),
      ).toBe(OWN);
  });
  it('keep a message that merely starts or ends like that one', () => {
    for (const said of [
      'Oops. The server answered with an error (500).',
      'The server answered with an error (500). Try later.',
      'The server answered with an error ().',
    ])
      expect(wordsOf(new ApiError(500, said), OWN)).toBe(said);
  });
  it('are those of any other error that has words, else the call’s own', () => {
    expect(wordsOf(new Error('boom'), OWN)).toBe('boom');
    expect(wordsOf(new Error(''), OWN)).toBe(OWN);
    expect(wordsOf('boom', OWN)).toBe(OWN);
    expect(wordsOf(undefined, OWN)).toBe(OWN);
  });
});

// ── The Tracking tab for a member who may not follow containers ─────────────────────────────────────────────────────────────

describe('the Tracking tab drawn for a member who may or may not follow containers', () => {
  const MISSING = {
    found: false,
    check: CHECK,
    prefill: null,
    provider: 'x',
    code: 'not-tracked-yet',
    detail: null,
    provider_name: 'safecube',
    can_register: true,
  };
  const draw = async (permissions: Record<string, unknown>) => {
    const s = setup(
      {
        [`GET ${TEAM}/containers`]: () => [box(1, { units: [{ vin: 'LGXC76C41P0123456' }] })],
        [`GET ${TEAM}/containers/lookup/HLCU7654321`]: () => MISSING,
      },
      { me: teamMe(permissions), portal: 'team' },
    );
    render(<Tracking />, { wrapper: s.wrapper });
    await waitFor(() => expect(document.querySelector('[data-part=container]')).not.toBeNull());
    await userEvent.type(document.querySelector('#logi-ct-search') as HTMLElement, 'HLCU7654321');
    await userEvent.click(document.querySelector('[data-part=track]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-part=notTracked]')).not.toBeNull());
  };
  const has = (part: string) => document.querySelector(`[data-part=${part}]`) !== null;
  const BUTTONS = ['addBox', 'refresh', 'edit', 'link', 'unlink', 'register', 'start'];

  it('has the bar, the cards and what a look-up found, and no way to change anything', async () => {
    await draw({
      stock: true,
      stockActions: { view: true, browse: true, create: false, edit: false, tracking: false },
    });
    for (const part of ['track', 'check', 'container', 'car', 'notTracked', 'why'])
      expect(has(part), part).toBe(true);
    for (const part of BUTTONS) expect(has(part), part).toBe(false);
  });

  it('has every way to change things for one who may follow them', async () => {
    await draw({
      stock: true,
      stockActions: { view: true, browse: true, create: false, edit: false, tracking: true },
    });
    for (const part of BUTTONS) expect(has(part), part).toBe(true);
  });
});

// ── The board ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the board of containers', () => {
  const LIST = `GET ${BASE}/containers`;

  it('is the boxes the server lists, and the loader until it has', async () => {
    const s = setup({ [LIST]: () => [box(1), box(2, { container_no: 'MSKU9070327' })] });
    const { result } = renderHook(() => useContainers(), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map(c => c.container_no)).toEqual(['CSQU3054383', 'MSKU9070327']);
    expect(result.current.error).toBeNull();
  });

  it('is no boxes where the answer is not a list, and says so where it is a list of something else', async () => {
    const none = setup({ [LIST]: STRANGE });
    const a = renderHook(() => useContainers(), { wrapper: none.wrapper });
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    expect(a.result.current.items).toEqual([]);
    expect(a.result.current.error).toBeNull();
    const odd = setup({ [LIST]: () => [{ id: 'x' }] });
    const b = renderHook(() => useContainers(), { wrapper: odd.wrapper });
    await waitFor(() => expect(b.result.current.error).not.toBeNull());
    expect(b.result.current.error).toBe(
      'The containers came back in a form this app does not know.',
    );
    expect(b.result.current.items).toEqual([]);
  });

  it('says why the boxes could not be had: the server’s words, or its own', async () => {
    for (const [handler, said] of [
      [
        () => {
          throw new ApiError(403, 'Not permitted');
        },
        'Not permitted',
      ],
      [NOTHING_REACHED, SAID_FAILED_TO_LOAD],
      [NO_WORDS, SAID_FAILED_TO_LOAD],
    ] as const) {
      const s = setup({ [LIST]: handler });
      const { result, unmount } = renderHook(() => useContainers(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.error).toBe(said));
      expect(result.current.loading).toBe(false);
      unmount();
    }
    expect(SAID_FAILED_TO_LOAD).toBe('Could not load containers.');
  });

  it('is asked for each time the tab opens, and shows nothing of the last visit while the new boxes are had', async () => {
    const gate = deferred<void>();
    let gated = false;
    const s = setup({
      [LIST]: () => (gated ? gate.promise.then(() => [box(3)]) : [box(1), box(2)]),
    });
    const first = renderHook(() => useContainers(), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.items.length).toBe(2));
    first.unmount();
    await settle();
    gated = true;
    const second = renderHook(() => useContainers(), { wrapper: s.wrapper });
    expect(second.result.current.items).toEqual([]);
    expect(second.result.current.loading).toBe(true);
    expect(s.times(LIST)).toBe(2);
    gate.resolve();
    await waitFor(() => expect(second.result.current.items.map(c => c.id)).toEqual([3]));
  });
});

// ── What the Tracking tab asks of the server ──────────────────────────────────────────────────────────────────────────────────

describe('what the Tracking tab asks of the server', () => {
  const LIST = `GET ${BASE}/containers`;
  const writes = (routes: Record<string, Handler>) => {
    const s = setup({ [LIST]: () => [box(1)], ...routes });
    const r = renderHook(() => ({ board: useContainers(), w: useContainerWrites() }), {
      wrapper: s.wrapper,
    });
    return { ...s, ...r };
  };
  const board = async (s: { result: { current: { board: { loading: boolean } } } }) =>
    waitFor(() => expect(s.result.current.board.loading).toBe(false));

  describe('when it goes wrong, each call has words of its own', () => {
    type Run = (
      w: ReturnType<typeof useContainerWrites>,
    ) => Promise<{ ok: boolean; message?: string }>;
    const CALLS: {
      name: string;
      key: string;
      run: Run;
      own: string;
      /** gives the server’s words where it had some (the others keep their own) */
      says: boolean;
      /** holds the answer to a shape */
      shape: boolean;
    }[] = [
      {
        name: 'a look-up',
        key: `GET ${BASE}/containers/lookup/HLCU7654321`,
        run: w => w.lookup('HLCU7654321'),
        own: 'Lookup failed.',
        says: true,
        shape: true,
      },
      {
        name: 'the test of the key',
        key: `GET ${BASE}/containers/provider-status?probe=1`,
        run: w => w.providerCheck(),
        own: 'Could not run the check.',
        says: false,
        shape: true,
      },
      {
        name: 'a registration',
        key: `POST ${BASE}/containers/register`,
        run: w => w.register('HLCU7654321'),
        own: 'Could not register that container.',
        says: true,
        shape: true,
      },
      {
        name: 'the saving of a new box',
        key: `POST ${BASE}/containers`,
        run: w => w.save(null, { container_no: 'HLCU7654321' }),
        own: 'Could not save.',
        says: true,
        shape: true,
      },
      {
        name: 'the saving of a change',
        key: `PUT ${BASE}/containers/5`,
        run: w => w.save(5, { container_no: 'HLCU7654321' }),
        own: 'Could not save.',
        says: true,
        shape: true,
      },
      {
        name: 'the deleting of a box',
        key: `DELETE ${BASE}/containers/5`,
        run: w => w.remove(5),
        own: 'Could not delete that container.',
        says: false,
        shape: false,
      },
      {
        name: 'a refresh',
        key: `POST ${BASE}/containers/5/refresh`,
        run: w => w.refresh(5),
        own: 'Refresh failed.',
        says: true,
        shape: true,
      },
      {
        name: 'the putting of a car in a box',
        key: `POST ${BASE}/containers/5/units`,
        run: w => w.link(5, 'LGXC76C41P0123456'),
        own: 'Could not add.',
        says: true,
        shape: true,
      },
      {
        name: 'the taking of a car out',
        key: `DELETE ${BASE}/containers/5/units/LGXC76C41P0123456`,
        run: w => w.unlink(5, 'LGXC76C41P0123456'),
        own: 'Could not remove that vehicle.',
        says: false,
        shape: false,
      },
    ];
    describe.each(CALLS)('$name', spec => {
      const said = async (handler: Handler) => {
        const s = setup({ [spec.key]: handler });
        const { result } = renderHook(() => useContainerWrites(), { wrapper: s.wrapper });
        const got = await spec.run(result.current);
        expect(got.ok).toBe(false);
        return got.message;
      };
      it('says its own words where nothing reached the server, or the server had none', async () => {
        expect(await said(NOTHING_REACHED)).toBe(spec.own);
        expect(await said(NO_WORDS)).toBe(spec.own);
      });
      it(
        spec.says
          ? 'gives the server’s words where it had some'
          : 'keeps its own words, whatever the server said',
        async () => {
          expect(await said(REFUSED)).toBe(spec.says ? 'The server said so.' : spec.own);
        },
      );
      if (spec.shape)
        it('says its own words where the answer is not one the app knows', async () => {
          expect(await said(STRANGE)).toBe(spec.own);
        });
    });
  });

  it('looks a number up at an address written for it, and hands back what it found', async () => {
    const found = { found: true, check: CHECK, container: box(1) };
    const s = writes({
      [`GET ${BASE}/containers/lookup/A%20B%2FC`]: () => MISS,
      [`GET ${BASE}/containers/lookup/CSQU3054383`]: () => found,
    });
    expect(await s.result.current.w.lookup('A B/C')).toEqual({ ok: true, value: MISS });
    expect(await s.result.current.w.lookup('CSQU3054383')).toEqual({ ok: true, value: found });
  });

  it('tests the key with the probe on, and hands back what the server found', async () => {
    const s = writes({ [`GET ${BASE}/containers/provider-status?probe=1`]: () => STATUS });
    expect(await s.result.current.w.providerCheck()).toEqual({ ok: true, value: STATUS });
  });

  it('registers a number with the platform, and an answer that says no is still an answer', async () => {
    const yes = { ok: true, status: 'registered', provider: 'safecube' };
    const no = { ok: false, code: 'plan-required', reason: 'x' };
    let answer: unknown = yes;
    const s = writes({ [`POST ${BASE}/containers/register`]: () => answer });
    expect(await s.result.current.w.register('HLCU7654321')).toEqual({ ok: true, value: yes });
    expect(s.bodies[`POST ${BASE}/containers/register`]).toEqual({ container_no: 'HLCU7654321' });
    answer = no;
    expect(await s.result.current.w.register('HLCU7654321')).toEqual({ ok: true, value: no });
  });

  it('writes a new box with POST and a changed one with PUT, and asks for the board again', async () => {
    const s = writes({
      [`POST ${BASE}/containers`]: b => ({ ...box(9), ...(b as object), check: CHECK }),
      [`PUT ${BASE}/containers/1`]: b => ({ ...box(1), ...(b as object), check: CHECK }),
    });
    await board(s);
    const made = await s.result.current.w.save(null, {
      container_no: 'MSDU7337230',
      carrier: 'Hapag',
    });
    expect(made).toMatchObject({ ok: true, value: { id: 9, container_no: 'MSDU7337230' } });
    expect(s.bodies[`POST ${BASE}/containers`]).toEqual({
      container_no: 'MSDU7337230',
      carrier: 'Hapag',
    });
    await waitFor(() => expect(s.times(LIST)).toBe(2));
    const changed = await s.result.current.w.save(1, { container_no: 'CSQU3054383', notes: 'n' });
    expect(changed).toMatchObject({ ok: true, value: { id: 1, notes: 'n' } });
    expect(s.bodies[`PUT ${BASE}/containers/1`]).toEqual({
      container_no: 'CSQU3054383',
      notes: 'n',
    });
    await waitFor(() => expect(s.times(LIST)).toBe(3));
  });

  it('does not ask for the board again after a change that did not go through', async () => {
    const s = writes({
      [`POST ${BASE}/containers`]: REFUSED,
      [`DELETE ${BASE}/containers/5`]: REFUSED,
      [`POST ${BASE}/containers/5/units`]: REFUSED,
      [`DELETE ${BASE}/containers/5/units/V1`]: REFUSED,
    });
    await board(s);
    await s.result.current.w.save(null, { container_no: 'HLCU7654321' });
    await s.result.current.w.remove(5);
    await s.result.current.w.link(5, 'V1');
    await s.result.current.w.unlink(5, 'V1');
    await settle();
    expect(s.times(LIST)).toBe(1);
  });

  it('stops tracking a box, and asks for the board again', async () => {
    const s = writes({ [`DELETE ${BASE}/containers/5`]: () => ({ ok: true }) });
    await board(s);
    expect(await s.result.current.w.remove(5)).toEqual({ ok: true });
    await waitFor(() => expect(s.times(LIST)).toBe(2));
  });

  it('asks the carrier again about a box with nothing sent, and leaves the board to the screen', async () => {
    const refreshed = {
      ok: true,
      carrier: { ok: true },
      position: null,
      changed: 1,
      container: box(5),
    };
    const s = writes({ [`POST ${BASE}/containers/5/refresh`]: () => refreshed });
    await board(s);
    expect(await s.result.current.w.refresh(5)).toEqual({ ok: true, value: refreshed });
    expect(s.api.post).toHaveBeenCalledWith(`${BASE}/containers/5/refresh`);
    await settle();
    expect(s.times(LIST)).toBe(1);
  });

  it('puts a car in a box by its VIN exactly as given, takes it out by an address written for it, and asks for the board again each time', async () => {
    const s = writes({
      [`POST ${BASE}/containers/5/units`]: b => ({ ok: true, vin: (b as { vin: string }).vin }),
      [`DELETE ${BASE}/containers/5/units/A%2FB%20C`]: () => ({ ok: true }),
    });
    await board(s);
    expect(await s.result.current.w.link(5, 'LGXC76C41P0123456')).toEqual({ ok: true });
    expect(s.bodies[`POST ${BASE}/containers/5/units`]).toEqual({ vin: 'LGXC76C41P0123456' });
    await waitFor(() => expect(s.times(LIST)).toBe(2));
    expect(await s.result.current.w.unlink(5, 'A/B C')).toEqual({ ok: true });
    await waitFor(() => expect(s.times(LIST)).toBe(3));
  });

  describe('the cars that can go in a box', () => {
    const STOCK = `GET ${BASE}/stock`;
    it('are the cars of the register that have a VIN, each written cleanly, with what is known of it', async () => {
      const s = writes({
        [STOCK]: () => [
          vehicle(1, {
            make: 'BYD',
            model: 'Seal',
            trim: 'Design',
            units: [
              unit({
                vin: ' lgxc76-c41p0123456 ',
                colour: 'White',
                status: 'delivered',
                consignee: 'Hany',
              }),
              unit({ vin: '' }),
              unit({ vin: '   ' }),
            ],
          }),
          vehicle(2, { make: '', model: '', trim: '', units: [unit({ vin: 'V2', status: '' })] }),
        ],
      });
      expect(await s.result.current.w.cars()).toEqual([
        {
          vin: 'LGXC76C41P0123456',
          make: 'BYD',
          model: 'Seal',
          trim: 'Design',
          colour: 'White',
          status: 'delivered',
          consignee: 'Hany',
        },
        { vin: 'V2', make: '', model: '', trim: '', colour: '', status: '', consignee: '' },
      ]);
    });
    it('are none where the register cannot be read, or is not a register', async () => {
      const refused = writes({
        [STOCK]: () => {
          throw new ApiError(403, 'Not permitted');
        },
      });
      expect(await refused.result.current.w.cars()).toEqual([]);
      const strange = writes({ [STOCK]: STRANGE });
      expect(await strange.result.current.w.cars()).toEqual([]);
    });
  });
});

// ── The register ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the register of models', () => {
  const LIST = `GET ${BASE}/stock`;

  it('is the models the server lists, and the loader until it has', async () => {
    const s = setup({ [LIST]: () => [vehicle(1), vehicle(2, { model: 'Atto 3' })] });
    const { result } = renderHook(() => useStock(), { wrapper: s.wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map(v => v.model)).toEqual(['Seal', 'Atto 3']);
    expect(result.current.error).toBeNull();
  });

  it('says why it could not be had: the server’s status and words, or that nothing came', async () => {
    const cases: [Handler, { status: number; message: string }][] = [
      [
        () => {
          throw new ApiError(403, 'Not permitted');
        },
        { status: 403, message: 'Not permitted' },
      ],
      [
        NOTHING_REACHED,
        { status: 0, message: 'Cannot reach the server. Check the connection and try again.' },
      ],
      [STRANGE, { status: 502, message: 'The stock came back in a form this app does not know.' }],
      [
        () => {
          throw new Error('boom');
        },
        { status: 0, message: 'boom' },
      ],
    ];
    for (const [handler, error] of cases) {
      const s = setup({ [LIST]: handler });
      const { result, unmount } = renderHook(() => useStock(), { wrapper: s.wrapper });
      await waitFor(() => expect(result.current.error).toEqual(error));
      expect(result.current.items).toEqual([]);
      unmount();
    }
    expect(SAID_STOCK_FAILED).toBe('Failed to load stock.');
  });

  it('is asked for again each time the screen opens, though what was read a moment ago is still fresh', async () => {
    const s = setup({ [LIST]: () => [vehicle(1)] });
    const first = renderHook(() => useStock(), { wrapper: s.wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useStock(), { wrapper: s.wrapper });
    await waitFor(() => expect(s.times(LIST)).toBe(2));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
  });

  it('is the loader again while it is asked for after a change, though the last read is still in hand', async () => {
    const gate = deferred<void>();
    let gated = false;
    const s = setup({
      [LIST]: () => (gated ? gate.promise.then(() => [vehicle(1)]) : [vehicle(1), vehicle(2)]),
      [`DELETE ${BASE}/stock/2`]: () => ({ ok: true }),
    });
    const { result } = renderHook(() => ({ stock: useStock(), w: useStockWrites() }), {
      wrapper: s.wrapper,
    });
    await waitFor(() => expect(result.current.stock.items.length).toBe(2));
    gated = true;
    await result.current.w.remove(2);
    await waitFor(() => expect(result.current.stock.loading).toBe(true));
    expect(result.current.stock.items.length).toBe(2);
    gate.resolve();
    await waitFor(() => expect(result.current.stock.items.length).toBe(1));
    expect(result.current.stock.loading).toBe(false);
  });

  describe('what is written to it', () => {
    const writes = (routes: Record<string, Handler>) => {
      const s = setup({ [LIST]: () => [vehicle(1)], ...routes });
      const r = renderHook(() => ({ stock: useStock(), w: useStockWrites() }), {
        wrapper: s.wrapper,
      });
      return { ...s, ...r };
    };
    const loaded = (s: { result: { current: { stock: { loading: boolean } } } }) =>
      waitFor(() => expect(s.result.current.stock.loading).toBe(false));
    const body = { make: 'Geely', model: 'Monjaro', trim: '', price: '1', notes: '', units: [] };

    it('adds a model with POST and changes one with PUT, and asks for the register again', async () => {
      const s = writes({
        [`POST ${BASE}/stock`]: b => vehicle(9, b as Record<string, unknown>),
        [`PUT ${BASE}/stock/1`]: b => vehicle(1, b as Record<string, unknown>),
      });
      await loaded(s);
      expect(await s.result.current.w.save(null, body as never)).toEqual({ ok: true });
      expect(s.bodies[`POST ${BASE}/stock`]).toEqual(body);
      await waitFor(() => expect(s.times(LIST)).toBe(2));
      expect(await s.result.current.w.save(1, body as never)).toEqual({ ok: true });
      expect(s.bodies[`PUT ${BASE}/stock/1`]).toEqual(body);
      await waitFor(() => expect(s.times(LIST)).toBe(3));
    });

    it('says so, and asks for nothing again, when what was saved came back in a form the app does not know', async () => {
      const s = writes({ [`POST ${BASE}/stock`]: STRANGE });
      await loaded(s);
      expect(await s.result.current.w.save(null, body as never)).toEqual({
        ok: false,
        message: 'The saved vehicle came back in a form this app does not know.',
      });
      await settle();
      expect(s.times(LIST)).toBe(1);
    });

    it('gives the words of whatever went wrong in a save, and asks for nothing again', async () => {
      for (const [handler, message] of [
        [REFUSED, 'The server said so.'],
        [
          () => {
            throw 'boom';
          },
          'boom',
        ],
      ] as const) {
        const s = writes({ [`POST ${BASE}/stock`]: handler });
        await loaded(s);
        expect(await s.result.current.w.save(null, body as never)).toEqual({ ok: false, message });
        await settle();
        expect(s.times(LIST)).toBe(1);
      }
    });

    it('deletes a model, and asks for the register again; when it cannot, says why and asks all the same', async () => {
      const ok = writes({ [`DELETE ${BASE}/stock/1`]: () => ({ ok: true }) });
      await loaded(ok);
      await ok.result.current.w.remove(1);
      await waitFor(() => expect(ok.times(LIST)).toBe(2));
      expect(ok.toasts.show).not.toHaveBeenCalled();
      for (const [handler, said] of [
        [
          () => {
            throw new ApiError(403, 'Only the administrator may delete a model');
          },
          'Only the administrator may delete a model',
        ],
        [
          () => {
            throw 'boom';
          },
          'boom',
        ],
      ] as const) {
        const bad = writes({ [`DELETE ${BASE}/stock/1`]: handler });
        await loaded(bad);
        await bad.result.current.w.remove(1);
        expect(bad.toasts.show).toHaveBeenCalledWith(said);
        await waitFor(() => expect(bad.times(LIST)).toBe(2));
      }
    });

    describe('the administrator’s CSV', () => {
      const BULK = `POST ${BASE}/stock/bulk`;
      const file = new File(['make,model\nBYD,Seal'], 'stock.csv', { type: 'text/csv' });
      it('goes up as the field the server reads it from, and what the server says went in is handed back', async () => {
        const s = writes({ [BULK]: () => ({ inserted: 2, errors: ['Row 3: Model is required'] }) });
        await loaded(s);
        expect(await s.result.current.w.importCsv(file)).toEqual({
          ok: true,
          result: { inserted: 2, errors: ['Row 3: Model is required'] },
        });
        expect(s.api.postForm).toHaveBeenCalledWith(`${BASE}/stock/bulk`, expect.any(FormData));
        const sent = s.bodies[BULK] as FormData;
        expect([...sent.keys()]).toEqual(['file']);
        expect((sent.get('file') as File).name).toBe('stock.csv');
        await waitFor(() => expect(s.times(LIST)).toBe(2));
      });
      it('says “Upload failed” where the answer is not one the app knows, and asks for nothing again', async () => {
        const s = writes({ [BULK]: STRANGE });
        await loaded(s);
        expect(await s.result.current.w.importCsv(file)).toEqual({
          ok: false,
          message: 'Upload failed',
        });
        await settle();
        expect(s.times(LIST)).toBe(1);
      });
      it('says why where the server refused it', async () => {
        const s = writes({
          [BULK]: () => {
            throw new ApiError(400, 'CSV has no data rows');
          },
        });
        await loaded(s);
        expect(await s.result.current.w.importCsv(file)).toEqual({
          ok: false,
          message: 'CSV has no data rows',
        });
        await settle();
        expect(s.times(LIST)).toBe(1);
      });
    });
  });
});
