import { cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';

// (the map: Leaflet comes from a CDN, which a test does not reach — what loads, or does not, is the test's to say)
const leaflet = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./leaflet', () => ({ loadLeaflet: () => leaflet.load() }));

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
  leaflet.load.mockReset();
  leaflet.load.mockRejectedValue(new Error('Leaflet did not load'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const box = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  container_no: 'CSQU3054383',
  container_type: "40' HIGH CUBE",
  bl_number: '',
  carrier: 'MSC',
  status: 'in_transit',
  latest_move: 'Vessel departure',
  latest_move_at: '2026-10-02T00:00:00.000Z',
  pod_eta: '2026-11-20',
  vessel_name: 'MSC AURORA',
  vessel_imo: '9876543',
  pol_code: 'CNSHA',
  pol_name: 'Shanghai',
  pod_code: 'EGALY',
  pod_name: 'Alexandria',
  atd: '2026-10-02T00:00:00.000Z',
  eta: '2026-11-19T22:00:00.000Z',
  moves: [],
  po_id: null,
  supplier: '',
  notes: '',
  units: [],
  ...over,
});
const BOXES = () => [
  box(1, {
    moves: [
      {
        at: '2026-10-02T00:00:00.000Z',
        event: 'Vessel departure',
        place: 'Shanghai',
        vessel: 'MSC AURORA',
      },
      {
        at: '2026-11-19T00:00:00.000Z',
        event: 'Discharge (expected)',
        place: 'Alexandria',
        vessel: '',
      },
    ],
    vessel_lat: 31.2,
    vessel_lon: 29.9,
    vessel_speed: 12.34,
    vessel_course: 90,
    vessel_position_at: new Date(Date.now() - 20 * 60000).toISOString(),
    units: [
      {
        vin: 'LGXC76C41P0123456',
        stock_id: 7,
        make: 'BYD',
        model: 'Seal',
        trim: 'Design',
        colour: 'White',
        consignee: 'Hany',
      },
      { vin: 'UNKNOWNVIN000001', unrecorded: true },
    ],
  }),
  box(2, {
    container_no: 'MSKU9070327',
    status: 'arrived',
    carrier: '',
    container_type: null,
    latest_move: null,
    vessel_name: '',
    vessel_imo: '',
    pol_code: '',
    pol_name: '',
    pod_code: '',
    pod_name: '',
    atd: null,
    eta: null,
    pod_eta: null,
  }),
];
const CARS = [
  {
    id: 7,
    make: 'BYD',
    model: 'Seal',
    trim: 'Design',
    price: 0,
    quantity: 3,
    notes: '',
    units: [
      { vin: 'LGXC76C41P0123456', colour: 'White', status: 'in_logistics', consignee: 'Hany' },
      { vin: 'LGXC76C41P0123457', colour: 'Grey', status: 'delivered' },
      { vin: 'lgxc76c41p0123458', colour: 'Red', status: 'delivered' },
      { vin: '', colour: 'Blue', status: 'delivered' },
    ],
  },
];

const ALL = {
  stock: true,
  stockActions: { view: true, browse: true, create: true, edit: true, tracking: true },
};
type Body = Record<string, unknown>;
interface World {
  boxes: unknown[] | 'failing' | 'forbidden' | 'not-a-list' | 'odd';
  lookups: Record<string, unknown>;
  lookupError: string | null;
  lookupGate: Promise<void> | null;
  provider: unknown;
  providerFails: boolean;
  register: unknown;
  refresh: unknown;
  refreshError: string | null;
  saveError: string | null;
  saveGate: Promise<void> | null;
  deleteFails: boolean;
  linkError: string | null;
  linkGate: Promise<void> | null;
  unlinkFails: boolean;
  cars: unknown[] | 'forbidden';
  writes: { method: string; path: string; body: Body | null }[];
  listGate: Promise<void> | null;
  listCalls: number;
}

function boot(
  portal: 'admin' | 'team',
  perms: Record<string, unknown> = ALL,
  init: Partial<World> = {},
) {
  const w: World = {
    boxes: BOXES(),
    lookups: {},
    lookupError: null,
    lookupGate: null,
    provider: {
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
    },
    providerFails: false,
    register: { ok: true, status: 'registered', provider: 'safecube' },
    refresh: null,
    refreshError: null,
    saveError: null,
    saveGate: null,
    deleteFails: false,
    linkError: null,
    linkGate: null,
    unlinkFails: false,
    cars: CARS,
    writes: [],
    listGate: null,
    listCalls: 0,
    ...init,
  };
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const asBody = (i: RequestInit): Body | null =>
    i.body && typeof i.body === 'string' ? (JSON.parse(i.body) as Body) : null;
  const record = (path: string, i: RequestInit) =>
    w.writes.push({ method: String(i.method), path, body: asBody(i) });
  const savedRow = (id: number, sent: Body | null) => ({
    ...box(id),
    ...(sent ?? {}),
    check: { no: 'CSQU3054383', valid: true, checkOk: true, expected: 3 },
  });
  const more: Record<string, Answer> = {
    [`${base}/containers`]: i => {
      if (i.method === 'POST') {
        record(`${base}/containers`, i);
        const reply = () =>
          w.saveError ? json(400, { error: w.saveError }) : json(200, savedRow(9, asBody(i)));
        return w.saveGate ? w.saveGate.then(reply) : reply();
      }
      w.listCalls++;
      const answer = () => {
        if (w.boxes === 'failing')
          return json(500, { error: 'relation "shipment_containers" does not exist' });
        if (w.boxes === 'forbidden') return json(403, { error: 'Not permitted' });
        if (w.boxes === 'not-a-list') return json(200, { nothing: true });
        if (w.boxes === 'odd') return json(200, [{ id: 'x' }]);
        return json(200, w.boxes);
      };
      return w.listGate ? w.listGate.then(answer) : answer();
    },
    [`${base}/containers/provider-status?probe=1`]: () =>
      w.providerFails ? json(500, { error: 'no' }) : json(200, w.provider),
    [`${base}/containers/register`]: i => {
      record(`${base}/containers/register`, i);
      return json(200, w.register);
    },
    [`${base}/stock`]: () =>
      w.cars === 'forbidden' ? json(403, { error: 'Not permitted' }) : json(200, w.cars),
    [`${base}/columns/stock`]: () => json(200, { columns: null, entity: 'stock' }),
  };
  for (const no of ['CSQU3054383', 'MSKU9070327', 'HLCU7654321', 'TGHU1234567']) {
    more[`${base}/containers/lookup/${no}`] = () => {
      const answer = () =>
        w.lookupError ? json(400, { error: w.lookupError }) : json(200, w.lookups[no]);
      return w.lookupGate ? w.lookupGate.then(answer) : answer();
    };
  }
  for (const id of [1, 2, 9]) {
    more[`${base}/containers/${id}`] = i => {
      record(`${base}/containers/${id}`, i);
      if (i.method === 'DELETE')
        return w.deleteFails ? json(404, { error: 'no' }) : json(200, { ok: true });
      return w.saveError ? json(400, { error: w.saveError }) : json(200, savedRow(id, asBody(i)));
    };
    more[`${base}/containers/${id}/refresh`] = i => {
      record(`${base}/containers/${id}/refresh`, i);
      return w.refreshError ? json(500, { error: w.refreshError }) : json(200, w.refresh);
    };
    more[`${base}/containers/${id}/units`] = i => {
      record(`${base}/containers/${id}/units`, i);
      const answer = () =>
        w.linkError
          ? json(400, { error: w.linkError })
          : json(200, { ok: true, vin: String(asBody(i)?.['vin']) });
      return w.linkGate ? w.linkGate.then(answer) : answer();
    };
  }
  for (const vin of ['LGXC76C41P0123456', 'UNKNOWNVIN000001']) {
    more[`${base}/containers/1/units/${vin}`] = i => {
      record(`${base}/containers/1/units/${vin}`, i);
      return w.unlinkFails ? json(500, {}) : json(200, { ok: true });
    };
  }
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(perms), {
    entries: ['/stock'],
    more,
  });
  return { ...s, w, base };
}

const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const onTracking = async () => {
  await waitFor(() => expect(q('[data-part=tab]')).not.toBeNull());
  await userEvent.click(qa('[data-part=tab]').find(t => words(t) === 'Tracking')!);
  await waitFor(() => expect(q('[data-part=trackingPane]')).not.toBeNull());
};
const loaded = async () => {
  await onTracking();
  await waitFor(() => expect(q('[data-part=containers] [data-part=loading]')).toBeNull());
};
const toast = () => qa('[data-part=toast]').map(words);
const type = async (text: string) => {
  const input = q('#logi-ct-search') as HTMLInputElement;
  await userEvent.clear(input);
  await userEvent.type(input, text);
  return input;
};
const track = async (text: string) => {
  await type(text);
  await userEvent.click(q('[data-part=track]'));
};

describe('Inventory & Logistics — the Tracking tab', () => {
  it('draws the bar over the boxes, in each portal', async () => {
    boot('admin');
    await loaded();
    expect(words(q('[data-part=track]'))).toBe('Track');
    expect(words(q('[data-part=addBox]'))).toBe('Add manually');
    expect(words(q('[data-part=check]'))).toBe('Test connection');
    expect(q('[data-part=check]').getAttribute('title')).toBe(
      'Check the carrier key and what it covers',
    );
    expect((q('#logi-ct-search') as HTMLInputElement).placeholder).toBe(
      'Container number, e.g. MSDU7337230',
    );
    cleanup();
    boot('team');
    await loaded();
    expect(words(q('[data-part=track]'))).toBe('Track');
  });

  it('asks for the boxes each time the tab opens, and the loader takes the place of what it showed before', async () => {
    const s = boot('admin');
    await loaded();
    expect(s.w.listCalls).toBe(1);
    expect(qa('[data-part=container]').length).toBe(2);
    await userEvent.click(qa('[data-part=tab]').find(t => words(t) === 'Models')!);
    await waitFor(() => expect(q('[data-part=trackingPane]')).toBeNull());
    const gate = deferred<void>();
    s.w.listGate = gate.promise;
    await userEvent.click(qa('[data-part=tab]').find(t => words(t) === 'Tracking')!);
    await waitFor(() =>
      expect(words(q('[data-part=containers] [data-part=loading]'))).toBe('Loading containers…'),
    );
    expect(s.w.listCalls).toBe(2);
    expect(qa('[data-part=container]').length).toBe(0);
    gate.resolve();
    await waitFor(() => expect(qa('[data-part=container]').length).toBe(2));
  });

  it('shows the loader while the boxes are asked for, and says what it found when there are none', async () => {
    const gate = deferred<void>();
    boot('admin', ALL, { listGate: gate.promise });
    await onTracking();
    await waitFor(() =>
      expect(words(q('[data-part=containers] [data-part=loading]'))).toBe('Loading containers…'),
    );
    gate.resolve();
    await waitFor(() => expect(q('[data-part=board]')).not.toBeNull());
    cleanup();
    boot('admin', ALL, { boxes: [] });
    await loaded();
    expect(words(q('[data-part=nothing]'))).toBe(
      'Nothing is being tracked yet. Enter a container number above to start.',
    );
  });

  it('says why the boxes could not be had: the server’s words, or its own', async () => {
    boot('admin', ALL, { boxes: 'failing' });
    await loaded();
    expect(words(q('[data-part=containers] [data-part=error]'))).toBe(
      'relation "shipment_containers" does not exist',
    );
    cleanup();
    boot('admin', ALL, { boxes: 'odd' });
    await loaded();
    expect(words(q('[data-part=containers] [data-part=error]'))).toBe(
      'The containers came back in a form this app does not know.',
    );
    cleanup();
    boot('team', ALL, { boxes: 'forbidden' });
    await loaded();
    expect(words(q('[data-part=containers] [data-part=error]'))).toBe('Not permitted');
    cleanup();
    boot('admin', ALL, { boxes: 'not-a-list' });
    await loaded();
    expect(q('[data-part=nothing]')).not.toBeNull();
  });

  it('draws a card for each box with what the carrier’s own card shows', async () => {
    boot('admin');
    await loaded();
    const cards = qa('[data-part=container]');
    expect(cards.length).toBe(2);
    const one = cards[0]!;
    expect(words(one.querySelector('[data-part=ctStatus]'))).toBe('In transit');
    expect(words(one.querySelector('[data-part=carrier]'))).toBe('MSC');
    expect([...one.querySelectorAll('[data-part=ctRow]')].map(r => words(r))).toEqual([
      'ContainerCSQU3054383',
      "Type40' HIGH CUBE",
      'Latest moveVessel departure',
      'POD ETA20/11/2026',
    ]);
    const two = cards[1]!;
    expect(words(two.querySelector('[data-part=ctStatus]'))).toBe('Arrived');
    expect([...two.querySelectorAll('[data-part=ctValue]')].map(words)).toEqual([
      'MSKU9070327',
      '—',
      '—',
      '—',
    ]);
  });

  it('draws the voyage — the ship, the leg, the ports and the times — or says there is none', async () => {
    boot('admin');
    await loaded();
    const voy = qa('[data-part=voyage]');
    expect(words(voy[0])).toContain('MSC AURORA');
    expect(words(voy[0])).toContain('IMO 9876543');
    expect(words(voy[0])).toContain('Departure from Shanghai');
    expect(words(voy[0])).toContain('Arrival at Alexandria');
    expect(words(voy[0])).toContain('CNSHAEGALY');
    expect(words(voy[0])).toContain('Actual departure');
    expect(words(voy[0])).toContain('Reported ETA');
    expect(words(voy[1])).toBe(
      'No voyage recorded yet — edit the container to add the vessel and its ports.',
    );
  });

  it('draws the little of a voyage that is known and says what is not: the ship not set, the ports by their ends, a dash for a code', async () => {
    boot('admin', ALL, {
      boxes: [
        box(1, {
          vessel_name: '',
          vessel_imo: '',
          pol_code: 'CNSHA',
          pol_name: '',
          pod_code: '',
          pod_name: '',
          atd: null,
          eta: null,
        }),
        box(2, {
          container_no: 'MSKU9070327',
          vessel_name: 'MSC X',
          vessel_imo: '1234567',
          pol_code: '',
          pol_name: 'Shanghai',
          pod_code: 'EGALY',
          pod_name: 'Alexandria',
          atd: null,
          eta: null,
        }),
      ],
    });
    await loaded();
    const [one, two] = qa('[data-part=voyage]');
    expect(one!.querySelector('[data-part=voyNone]')).toBeNull();
    expect(words(one!.querySelector('[data-part=voyName]'))).toBe('Vessel not set');
    expect(one!.querySelector('[data-part=voyImo]')).toBeNull();
    expect(words(one!.querySelector('[data-part=voyEnds]'))).toBe('Load portDischarge port');
    expect(words(one!.querySelector('[data-part=voyCodes]'))).toBe('CNSHA—');
    expect(words(two!.querySelector('[data-part=voyName]'))).toBe('MSC X');
    expect(words(two!.querySelector('[data-part=voyImo]'))).toBe('IMO 1234567');
    expect(words(two!.querySelector('[data-part=voyEnds]'))).toBe(
      'Departure from ShanghaiArrival at Alexandria',
    );
    expect(words(two!.querySelector('[data-part=voyCodes]'))).toBe('—EGALY');
    // (without both its times, how far along it is cannot be said, so it is not drawn)
    expect(q('[data-part=voyDone]')).toBeNull();
    expect(q('[data-part=voyShipIc]')).toBeNull();
    expect(words(one!.querySelector('[data-part=voyTimes]'))).toBe(
      'Actual departure—Reported ETA—',
    );
  });

  it('says how far along its leg a ship is, by the time, to the hundredth', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    try {
      boot('admin', ALL, {
        boxes: [box(1, { atd: '2026-10-01T00:00:00Z', eta: '2026-10-04T00:00:00Z' })],
      });
      await loaded();
      expect(q('[data-part=voyDone]').getAttribute('style')).toMatch(/\b0\.33\b/);
      expect(q('[data-part=voyShipIc]').getAttribute('style')).toMatch(/\b0\.33\b/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists the port calls, collapsed, an unconfirmed one marked as expected', async () => {
    boot('admin');
    await loaded();
    const moves = q('[data-part=moves]') as HTMLDetailsElement;
    expect(moves.open).toBe(false);
    expect(words(moves.querySelector('summary'))).toBe('Port calls 2');
    const rows = [...moves.querySelectorAll('[data-part=move]')].map(words);
    expect(rows).toEqual([
      '02/10/2026Vessel departureShanghai · MSC AURORA',
      '19/11/2026Discharge expectedAlexandria',
    ]);
    expect(moves.querySelectorAll('[data-part=move]')[1]!.className).toMatch(/moveEst/);
    expect(qa('[data-part=moves]').length).toBe(1);
  });

  it('says where the ship is and how old that is, over a map; or, with no map to be had, where and a link to one', async () => {
    boot('admin');
    await loaded();
    const pos = q('[data-part=position]');
    expect(words(pos.querySelector('[class*=posCo]'))).toBe('31.200° N, 29.900° E');
    expect(words(pos)).toContain('· 12.3 kn');
    expect(words(q('[data-part=posAge]'))).toBe('20 min ago');
    expect(q('[data-part=posAge]').className).toMatch(/fresh/);
    await waitFor(() => expect(q('[data-part=mapFallback]')).not.toBeNull());
    expect(words(q('[data-part=mapFallback]'))).toBe(
      'Map unavailable offline — position 31.200° N, 29.900° E (open a map)',
    );
    expect((q('[data-part=mapFallback] a') as HTMLAnchorElement).href).toContain(
      'openstreetmap.org/?mlat=31.2&mlon=29.9',
    );
    expect(qa('[data-part=position]').length).toBe(1);
  });

  it('mounts the map at the fix, the ship pointing the way it is going, and takes it down with the card', async () => {
    const map = { setView: vi.fn(), invalidateSize: vi.fn(), remove: vi.fn() };
    map.setView.mockReturnValue(map);
    const popup = vi.fn();
    const marker = { addTo: vi.fn(() => ({ bindPopup: popup })) };
    const L = {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
      divIcon: vi.fn((o: unknown) => o),
      marker: vi.fn(() => marker),
    };
    leaflet.load.mockResolvedValue(L);
    boot('admin');
    await loaded();
    await waitFor(() => expect(L.marker).toHaveBeenCalled());
    expect(L.map.mock.calls[0]![1]).toMatchObject({ scrollWheelZoom: false, zoomControl: true });
    expect(map.setView).toHaveBeenCalledWith([31.2, 29.9], 4);
    expect(L.marker.mock.calls[0]![0]).toEqual([31.2, 29.9]);
    expect(String((L.divIcon.mock.calls[0]![0] as { html: string }).html)).toContain(
      'rotate(90deg)',
    );
    expect(q('[data-part=mapFallback]')).toBeNull();
    // (named by the ship; sized once the card has been laid out)
    expect(popup).toHaveBeenCalledWith('MSC AURORA');
    await waitFor(() => expect(map.invalidateSize).toHaveBeenCalled());
    cleanup();
    expect(map.remove).toHaveBeenCalled();
    // (a ship with no name is still a vessel)
    popup.mockClear();
    boot('admin', ALL, { boxes: [BOXES()[0]!].map(b => ({ ...b, vessel_name: '' })) });
    await loaded();
    await waitFor(() => expect(popup).toHaveBeenCalledWith('Vessel'));
  });

  it('draws a position only where there is a latitude and a longitude, and a speed only where there is one', async () => {
    boot('admin', ALL, {
      boxes: [
        box(1, { vessel_lat: 31.2, vessel_lon: null }),
        box(2, { container_no: 'MSKU9070327', vessel_lat: null, vessel_lon: 29.9 }),
        box(3, {
          container_no: 'HLCU7654321',
          vessel_lat: 31.2,
          vessel_lon: 29.9,
          vessel_speed: null,
          vessel_position_at: null,
        }),
        box(4, {
          container_no: 'TGHU1234567',
          vessel_lat: 31.2,
          vessel_lon: 29.9,
          vessel_speed: '',
          vessel_position_at: null,
        }),
      ],
    });
    await loaded();
    expect(qa('[data-part=position]').length).toBe(2);
    for (const p of qa('[data-part=position]')) expect(words(p)).not.toContain(' kn');
    expect(words(q('[data-part=posAge]'))).toBe('age unknown');
    expect(q('[data-part=posAge]').className).toMatch(/stale/);
  });

  it('shows the cars inside a box, a car nobody has recorded marked so, and a box with none says so', async () => {
    boot('admin');
    await loaded();
    const cars = qa('[data-part=cars]');
    expect(words(cars[0]!.querySelector('span'))).toBe('Vehicles inside');
    const chips = [...cars[0]!.querySelectorAll('[data-part=car]')];
    expect(chips.map(c => words(c).replace('×', ''))).toEqual([
      'LGXC76C41P0123456',
      'UNKNOWNVIN000001',
    ]);
    expect(chips[0]!.getAttribute('title')).toBe('BYD · Seal · Design · White · Hany');
    expect(chips[1]!.getAttribute('title')).toBe('This VIN is not in the Models tab yet');
    expect(words(cars[1]!.querySelector('span'))).toBe('No vehicles linked yet');
  });

  it('warns of a number whose check digit is not the one the others call for', async () => {
    boot('admin');
    await loaded();
    const warns = qa('[data-part=checkWarn]');
    expect(warns.length).toBe(1);
    expect(words(warns[0])).toBe('Check digit should be 3 — worth confirming against the B/L.');
  });

  it('draws no refresh, edit or car buttons for a member who may not follow containers — and no tab to reach the pane', async () => {
    boot('team', {
      stock: true,
      stockActions: { view: true, browse: true, create: false, edit: false, tracking: false },
    });
    await waitFor(() => expect(q('[data-part=tab]')).not.toBeNull());
    expect(qa('[data-part=tab]').map(words)).toEqual(['Models']);
  });
});

describe('Inventory & Logistics — looking a box up', () => {
  it('needs four letters and seven digits, and says so without asking', async () => {
    const s = boot('admin');
    await loaded();
    await track('ABC12');
    expect(words(q('[data-part=resultError]'))).toBe(
      'A container number is four letters then seven digits, like MSDU7337230.',
    );
    expect(s.asked.some(a => a.path.includes('/lookup/'))).toBe(false);
  });

  it('says it is looking while the answer is awaited, and then puts the answer in its place', async () => {
    const gate = deferred<void>();
    boot('admin', ALL, {
      lookupGate: gate.promise,
      lookups: {
        MSKU9070327: {
          found: true,
          check: { no: 'MSKU9070327', valid: true, checkOk: true, expected: 7 },
          container: BOXES()[1],
        },
      },
    });
    await loaded();
    await track('MSKU9070327');
    await waitFor(() =>
      expect(words(q('[data-part=result] [data-part=loading]'))).toBe('Looking it up…'),
    );
    gate.resolve();
    await waitFor(() => expect(q('[data-part=result] [data-part=container]')).not.toBeNull());
    expect(q('[data-part=result] [data-part=loading]')).toBeNull();
  });

  it('asks for the number written cleanly, puts it back in the box that way, and shows the card of one we track', async () => {
    const s = boot('admin', ALL, {
      lookups: {
        MSKU9070327: {
          found: true,
          check: { no: 'MSKU9070327', valid: true, checkOk: true, expected: 7 },
          container: BOXES()[1],
        },
      },
    });
    await loaded();
    const input = await type(' msku-9070327 ');
    await userEvent.type(input, '{Enter}');
    await waitFor(() => expect(q('[data-part=result] [data-part=container]')).not.toBeNull());
    expect(input.value).toBe('MSKU9070327');
    expect(s.asked.some(a => a.path.endsWith('/lookup/MSKU9070327'))).toBe(true);
    expect(words(q('[data-part=result] [data-part=ctValue]'))).toBe('MSKU9070327');
  });

  it('says why a box the carrier cannot give is not tracked, in one sentence, with the carrier’s words as a hint', async () => {
    const miss = (over: Record<string, unknown>) => ({
      found: false,
      check: { no: 'HLCU7654321', valid: true, checkOk: true, expected: 1 },
      prefill: null,
      provider: 'x',
      code: 'not-configured',
      detail: null,
      provider_name: 'none',
      can_register: false,
      ...over,
    });
    boot('admin', ALL, { lookups: { HLCU7654321: miss({}) } });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=notTracked]')).not.toBeNull());
    expect(words(q('[data-part=notTracked] [class*=emptyHead]'))).toBe(
      'HLCU7654321 is not tracked yet',
    );
    expect(words(q('[data-part=why]'))).toBe(
      'Automatic lookup is not set up, so enter what the carrier shows.',
    );
    expect(q('[data-part=register]')).toBeNull();
    expect(words(q('[data-part=start]'))).toBe('Start tracking it');
    cleanup();
    boot('admin', ALL, {
      lookups: {
        HLCU7654321: miss({
          code: 'unauthorized',
          detail: 'Invalid key',
          provider_name: 'terminal49',
          can_register: true,
        }),
      },
    });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=why]')).not.toBeNull());
    expect(words(q('[data-part=why]'))).toBe(
      'Terminal49 did not recognise the key at all. Check CONTAINER_TRACKING_KEY, and that it is the right kind of key.',
    );
    expect(q('[data-part=why]').getAttribute('title')).toBe('Invalid key');
    expect(words(q('[data-part=register]'))).toBe('Ask Terminal49 to track it');
  });

  it('offers to start tracking with what the carrier prefilled, and with nothing the member may not do', async () => {
    const found = {
      found: false,
      check: { no: 'HLCU7654321', valid: true, checkOk: true, expected: 1 },
      prefill: { carrier: 'MSC', vessel_name: 'MSC AURORA II' },
      provider: 'ok',
      code: 'ok',
      detail: null,
      provider_name: 'safecube',
      can_register: false,
    };
    boot('admin', ALL, { lookups: { HLCU7654321: found } });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=start]')).not.toBeNull());
    expect(words(q('[data-part=why]'))).toBe('Prefilled from the carrier.');
    await userEvent.click(q('[data-part=start]'));
    expect(
      words(q('[data-part=dialog] [class*=title], [data-part=dialog] [data-part=title]')),
    ).toBe('Track a container');
    expect((q('#ct-no') as HTMLInputElement).value).toBe('HLCU7654321');
    const values = qa('[data-part=boxForm] input').map(i => (i as HTMLInputElement).value);
    expect(values).toContain('MSC');
    expect(values).toContain('MSC AURORA II');
  });

  it('puts away what a look-up found nothing of once the box it was starting is saved', async () => {
    const found = {
      found: false,
      check: { no: 'HLCU7654321', valid: true, checkOk: true, expected: 1 },
      prefill: null,
      provider: 'x',
      code: 'not-configured',
      detail: null,
      provider_name: 'none',
      can_register: false,
    };
    boot('admin', ALL, { lookups: { HLCU7654321: found } });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=start]')).not.toBeNull());
    await userEvent.click(q('[data-part=start]'));
    await userEvent.click(q('[data-part=save]'));
    await waitFor(() => expect(q('[data-part=dialog]')).toBeNull());
    expect(toast()).toContain('Now tracking HLCU7654321.');
    expect(q('[data-part=notTracked]')).toBeNull();
  });

  it('warns, under a box that is not tracked, of a check digit that is not the one the others call for', async () => {
    boot('admin', ALL, {
      lookups: {
        HLCU7654321: {
          found: false,
          check: { no: 'HLCU7654321', valid: true, checkOk: false, expected: 0 },
          prefill: null,
          provider: 'x',
          code: 'not-configured',
          detail: null,
          provider_name: 'none',
          can_register: false,
        },
      },
    });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=notTracked] [data-part=checkWarn]')).not.toBeNull());
  });

  it('gives the server’s words when the look-up is refused, and its own when it could not be asked', async () => {
    boot('admin', ALL, {
      lookupError:
        'Container tracking is not set up yet — apply migrations/019_units_payments_tracking.sql.',
    });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=resultError]')).not.toBeNull());
    expect(words(q('[data-part=resultError]'))).toMatch(/apply migrations\/019/);
  });

  it('asks the carrier’s platform to watch a box, and opens the card to save when it says yes', async () => {
    const found = {
      found: false,
      check: { no: 'HLCU7654321', valid: true, checkOk: true, expected: 1 },
      prefill: null,
      provider: 'x',
      code: 'not-tracked-yet',
      detail: null,
      provider_name: 'safecube',
      can_register: true,
    };
    const s = boot('admin', ALL, { lookups: { HLCU7654321: found } });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=register]')).not.toBeNull());
    expect(words(q('[data-part=why]'))).toBe(
      'Safecube is not watching this container yet. Register it below to start.',
    );
    await userEvent.click(q('[data-part=register]'));
    await waitFor(() => expect(q('[data-part=dialog]')).not.toBeNull());
    expect(toast()).toContain('Registering with the carrier…');
    expect(toast()).toContain(
      'Registered — registered. Updates now arrive on their own; nothing to refresh. Save the card below so they have somewhere to land.',
    );
    expect(s.w.writes[0]).toMatchObject({
      method: 'POST',
      path: '/api/dashboard/containers/register',
      body: { container_no: 'HLCU7654321' },
    });
    expect((q('#ct-no') as HTMLInputElement).value).toBe('HLCU7654321');
  });

  it('tells what the platform said when it would not, and opens nothing', async () => {
    const found = {
      found: false,
      check: { no: 'HLCU7654321', valid: true, checkOk: true, expected: 1 },
      prefill: null,
      provider: 'x',
      code: 'not-tracked-yet',
      detail: null,
      provider_name: 'terminal49',
      can_register: true,
    };
    boot('admin', ALL, {
      lookups: { HLCU7654321: found },
      register: { ok: false, code: 'plan-required', reason: 'x' },
    });
    await loaded();
    await track('HLCU7654321');
    await waitFor(() => expect(q('[data-part=register]')).not.toBeNull());
    await userEvent.click(q('[data-part=register]'));
    await waitFor(() =>
      expect(toast()).toContain('That needs a paid plan on the carrier platform.'),
    );
    expect(q('[data-part=dialog]')).toBeNull();
  });
});

describe('Inventory & Logistics — testing the carrier’s key', () => {
  const status = (over: Record<string, unknown>) => ({
    provider: 'terminal49',
    configured: true,
    auth_header: 'Authorization',
    carrier_has_position: false,
    ais: 'not-configured',
    webhook_ready: false,
    probe: 'unauthorized',
    reachable: false,
    http: 401,
    detail: 'Invalid key',
    ...over,
  });
  it('says in one line what the settings come to', async () => {
    boot('admin');
    await loaded();
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(toast()).toContain('No carrier feed is configured'));
    expect(toast()).toContain('Testing the carrier connection…');
  });
  it('leaves what a look-up found where it is when the test has no diagnosis to add', async () => {
    boot('admin', ALL, {
      lookups: {
        MSKU9070327: {
          found: true,
          check: { no: 'MSKU9070327', valid: true, checkOk: true, expected: 7 },
          container: BOXES()[1],
        },
      },
    });
    await loaded();
    await track('MSKU9070327');
    await waitFor(() => expect(q('[data-part=result] [data-part=container]')).not.toBeNull());
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(toast()).toContain('No carrier feed is configured'));
    expect(q('[data-part=result] [data-part=container]')).not.toBeNull();
    expect(q('[data-part=diagnosis]')).toBeNull();
  });
  it('says so when the check could not be run', async () => {
    boot('admin', ALL, { providerFails: true });
    await loaded();
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(toast()).toContain('Could not run the check.'));
  });
  it('shows what the server found trying the key every way, in the three outcomes that need three answers', async () => {
    boot('admin', ALL, {
      provider: status({
        auth: {
          ok: false,
          stage: 'permission',
          reason: 'The account is not permitted',
          attempts: [{ shape: 'Authorization: Token <key>', code: 'forbidden', status: 403 }],
          baseAttempts: [{ base: '/public', code: 'forbidden', status: 403 }],
          shape: 'Authorization: Token <key>',
        },
      }),
    });
    await loaded();
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(q('[data-part=diagnosis]')).not.toBeNull());
    expect(words(q('[data-part=diagnosis]'))).toContain(
      'The key is valid — the account is not permitted',
    );
    expect(words(q('[data-part=diagnosis]'))).toContain(
      'Authorization: Token <key> → forbidden (403)',
    );
    expect(words(q('[data-part=diagnosis]'))).toContain(
      'Base paths tried with Authorization: Token <key>:',
    );
    cleanup();
    boot('admin', ALL, {
      provider: status({
        auth: { ok: true, already: true, shape: 'API_KEY: <key>', base: 'https://x/public' },
      }),
    });
    await loaded();
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(q('[data-part=diagnosis]')).not.toBeNull());
    expect(words(q('[data-part=diagnosis]'))).toContain(
      'The key works and the header is already right',
    );
    expect(words(q('[data-part=diagnosis]'))).toContain('Nothing to change here.');
    cleanup();
    boot('admin', ALL, {
      provider: status({
        auth: {
          ok: true,
          already: false,
          shape: 'X-Api-Key: <key>',
          env: 'CONTAINER_TRACKING_HEADER=X-Api-Key',
        },
      }),
    });
    await loaded();
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(q('[data-part=diagnosis]')).not.toBeNull());
    expect(words(q('[data-part=diagnosis]'))).toContain(
      'The key works — it just needs a different header',
    );
    expect(words(q('[data-part=diagnosis]'))).toContain('CONTAINER_TRACKING_HEADER=X-Api-Key');
    cleanup();
    boot('admin', ALL, {
      provider: status({
        auth: {
          ok: false,
          stage: 'header',
          attempts: [{ shape: 'API_KEY: <key>', code: 'unauthorized', status: 401 }],
        },
      }),
    });
    await loaded();
    await userEvent.click(q('[data-part=check]'));
    await waitFor(() => expect(q('[data-part=diagnosis]')).not.toBeNull());
    expect(words(q('[data-part=diagnosis]'))).toContain('Every header shape was refused');
    expect(words(q('[data-part=diagnosis]'))).toContain(
      'The key itself looks wrong, or is not active yet.',
    );
  });
});

describe('Inventory & Logistics — changing the boxes', () => {
  it('refreshes a box from the carrier, says what each feed said, and asks for the board again', async () => {
    const s = boot('admin', ALL, {
      refresh: {
        ok: true,
        carrier: { ok: true },
        position: { ok: false, code: 'no-vessel-id', reason: 'x' },
        changed: 3,
        container: box(1),
      },
    });
    await loaded();
    const before = s.w.listCalls;
    await userEvent.click(qa('[data-part=refresh]')[0]!);
    await waitFor(() =>
      expect(toast()).toContain('carrier updated · no IMO on this container yet (3 fields)'),
    );
    expect(toast()).toContain('Checking the carrier…');
    await waitFor(() => expect(s.w.listCalls).toBeGreaterThan(before));
    expect(s.w.writes[0]).toMatchObject({
      method: 'POST',
      path: '/api/dashboard/containers/1/refresh',
    });
  });
  it('says so, and does not ask for the board again, when nothing moved', async () => {
    const s = boot('admin', ALL, {
      refresh: {
        ok: false,
        carrier: { ok: false, code: 'not-configured', reason: 'not-configured' },
        position: null,
        changed: 0,
        container: box(1),
      },
    });
    await loaded();
    const before = s.w.listCalls;
    await userEvent.click(qa('[data-part=refresh]')[0]!);
    await waitFor(() => expect(toast()).toContain('no carrier feed set up'));
    expect(s.w.listCalls).toBe(before);
  });
  it('gives the server’s words when a refresh is refused', async () => {
    boot('admin', ALL, { refreshError: 'Container tracking is down' });
    await loaded();
    await userEvent.click(qa('[data-part=refresh]')[0]!);
    await waitFor(() => expect(toast()).toContain('Container tracking is down'));
  });

  it('starts tracking a box by hand: the number cleaned, everything else as typed, then the board again and a word on it', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(q('[data-part=addBox]'));
    expect(words(q('[data-part=dialog] [data-part=title]'))).toBe('Track a container');
    expect(words(q('[data-part=save]'))).toBe('Start tracking');
    // (a box not yet tracked has nothing to stop tracking)
    expect(q('[data-part=delete]')).toBeNull();
    await userEvent.type(q('#ct-no'), ' msdu-7337230 ');
    await userEvent.type(qa('[data-part=boxForm] input')[1]!, 'Hapag');
    await userEvent.click(q('[data-part=save]'));
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    expect(s.w.writes[0]).toMatchObject({ method: 'POST', path: '/api/dashboard/containers' });
    expect(s.w.writes[0]!.body).toMatchObject({
      container_no: 'MSDU7337230',
      carrier: 'Hapag',
      status: 'in_transit',
    });
    await waitFor(() => expect(q('[data-part=dialog]')).toBeNull());
    expect(toast()).toContain('Now tracking MSDU7337230.');
    // (and the board is asked for again, so that the new box is on it)
    await waitFor(() => expect(s.w.listCalls).toBe(2));
  });
  it('sends a box once, though Save is pressed again while the server is still answering', async () => {
    const gate = deferred<void>();
    const s = boot('admin', ALL, { saveGate: gate.promise });
    await loaded();
    await userEvent.click(q('[data-part=addBox]'));
    await userEvent.type(q('#ct-no'), 'MSDU7337230');
    await userEvent.click(q('[data-part=save]'));
    await userEvent.click(q('[data-part=save]'));
    await userEvent.click(q('[data-part=save]'));
    expect(s.w.writes.length).toBe(1);
    gate.resolve();
    await waitFor(() => expect(q('[data-part=dialog]')).toBeNull());
    expect(s.w.writes.length).toBe(1);
  });
  it('asks for a good number and sends nothing without one; shows the server’s refusal and stays open', async () => {
    const s = boot('admin', ALL, { saveError: 'MSDU7337230 is already being tracked.' });
    await loaded();
    await userEvent.click(q('[data-part=addBox]'));
    await userEvent.type(q('#ct-no'), 'ABC');
    await userEvent.click(q('[data-part=save]'));
    expect(words(q('[data-part=formError]'))).toBe(
      'A container number is four letters then seven digits, like MSDU7337230.',
    );
    expect(s.w.writes).toEqual([]);
    await userEvent.clear(q('#ct-no'));
    await userEvent.type(q('#ct-no'), 'MSDU7337230');
    await userEvent.click(q('[data-part=save]'));
    await waitFor(() =>
      expect(words(q('[data-part=formError]'))).toBe('MSDU7337230 is already being tracked.'),
    );
    expect(q('[data-part=dialog]')).not.toBeNull();
  });
  it('opens a box for change with what it holds, the dates cut to the boxes that take them, and saves a change', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(qa('[data-part=edit]')[0]!);
    expect(words(q('[data-part=dialog] [data-part=title]'))).toBe('Container CSQU3054383');
    expect(words(q('[data-part=save]'))).toBe('Save changes');
    const values = qa('[data-part=boxForm] input').map(i => (i as HTMLInputElement).value);
    expect(values).toContain('CSQU3054383');
    expect(values).toContain('2026-11-20');
    expect(values).toContain('CNSHA');
    await userEvent.type(qa('[data-part=boxForm] input')[3]!, ' via Suez');
    await userEvent.click(q('[data-part=save]'));
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    expect(s.w.writes[0]).toMatchObject({ method: 'PUT', path: '/api/dashboard/containers/1' });
    expect((s.w.writes[0]!.body as Body)['latest_move']).toBe('Vessel departure via Suez');
    expect(toast()).toContain('Container updated.');
  });
  it('deletes a box after asking, in the administrator’s page only', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(qa('[data-part=edit]')[0]!);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(q('[data-part=delete]'));
    expect(ask).toHaveBeenCalledWith(
      'Stop tracking this container? The vehicles inside it are not deleted.',
    );
    expect(s.w.writes).toEqual([]);
    ask.mockReturnValue(true);
    await userEvent.click(q('[data-part=delete]'));
    await waitFor(() =>
      expect(s.w.writes.map(w => w.method + ' ' + w.path)).toEqual([
        'DELETE /api/dashboard/containers/1',
      ]),
    );
    await waitFor(() => expect(q('[data-part=dialog]')).toBeNull());
    await waitFor(() => expect(s.w.listCalls).toBe(2));
    cleanup();
    boot('team');
    await loaded();
    await userEvent.click(qa('[data-part=edit]')[0]!);
    expect(q('[data-part=dialog]')).not.toBeNull();
    expect(q('[data-part=delete]')).toBeNull();
  });
  it('says so when a box could not be deleted, and keeps it', async () => {
    boot('admin', ALL, { deleteFails: true });
    await loaded();
    await userEvent.click(qa('[data-part=edit]')[0]!);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(q('[data-part=delete]'));
    await waitFor(() => expect(toast()).toContain('Could not delete that container.'));
    expect(q('[data-part=dialog]')).not.toBeNull();
  });

  it('puts a car in a box from the cars that are in none, and takes one out', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(qa('[data-part=link]')[1]!);
    await waitFor(() => expect(q('[data-part=carPick]')).not.toBeNull());
    expect(words(q('[data-part=dialog] [data-part=title]'))).toBe('Add a vehicle to the container');
    await userEvent.click(q('[data-part=carPick]'));
    // (the one in box 1, and the one without a VIN, are not offered; a VIN is written cleanly)
    expect(qa('[role=option]').map(words)).toEqual([
      'LGXC76C41P0123457 · BYD Seal Design · Grey',
      'LGXC76C41P0123458 · BYD Seal Design · Red',
    ]);
    await userEvent.click(qa('[role=option]')[1]!);
    await userEvent.click(q('[data-part=add]'));
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    expect(s.w.writes[0]).toMatchObject({
      method: 'POST',
      path: '/api/dashboard/containers/2/units',
      body: { vin: 'LGXC76C41P0123458' },
    });
    await waitFor(() => expect(q('[data-part=dialog]')).toBeNull());
    await waitFor(() => expect(s.w.listCalls).toBe(2)); // (the board again, with the car in)
    await userEvent.click(qa('[data-part=unlink]')[0]!);
    await waitFor(() =>
      expect(s.w.writes.map(w => w.method + ' ' + w.path)).toContain(
        'DELETE /api/dashboard/containers/1/units/LGXC76C41P0123456',
      ),
    );
    await waitFor(() => expect(s.w.listCalls).toBe(3)); // (…and again, with it out)
  });
  it('says so when a car could not be taken out of a box, and keeps it there', async () => {
    const s = boot('admin', ALL, { unlinkFails: true });
    await loaded();
    await userEvent.click(qa('[data-part=unlink]')[0]!);
    await waitFor(() => expect(toast()).toContain('Could not remove that vehicle.'));
    expect(qa('[data-part=car]').length).toBe(2);
    expect(s.w.listCalls).toBe(1);
  });
  it('says so when there is no car to offer — none with a VIN, or all in a box already', async () => {
    boot('admin', ALL, {
      cars: [
        {
          id: 1,
          make: 'A',
          model: 'B',
          trim: '',
          price: 0,
          quantity: 0,
          notes: '',
          units: [{ vin: '' }],
        },
      ],
    });
    await loaded();
    await userEvent.click(qa('[data-part=link]')[0]!);
    await waitFor(() =>
      expect(toast()).toContain(
        'No vehicles with a VIN in the Models tab yet — add one there first.',
      ),
    );
    cleanup();
    boot('admin', ALL, {
      cars: [
        {
          id: 1,
          make: 'A',
          model: 'B',
          trim: '',
          price: 0,
          quantity: 0,
          notes: '',
          units: [{ vin: 'LGXC76C41P0123456' }],
        },
      ],
    });
    await loaded();
    await userEvent.click(qa('[data-part=link]')[0]!);
    await waitFor(() =>
      expect(toast()).toContain('Every vehicle with a VIN is already in a container.'),
    );
    cleanup();
    boot('admin', ALL, { cars: 'forbidden' });
    await loaded();
    await userEvent.click(qa('[data-part=link]')[0]!);
    await waitFor(() =>
      expect(toast()).toContain(
        'No vehicles with a VIN in the Models tab yet — add one there first.',
      ),
    );
  });
  it('offers the first of the cars to begin with, so that Add alone puts it in', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(qa('[data-part=link]')[1]!);
    await waitFor(() => expect(q('[data-part=carPick]')).not.toBeNull());
    expect(words(q('[data-part=carPick]'))).toBe('LGXC76C41P0123457 · BYD Seal Design · Grey');
    await userEvent.click(q('[data-part=add]'));
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    expect(s.w.writes[0]).toMatchObject({
      path: '/api/dashboard/containers/2/units',
      body: { vin: 'LGXC76C41P0123457' },
    });
  });
  it('takes a refusal away as soon as it is tried again', async () => {
    const s = boot('admin', ALL, { linkError: 'Pick a vehicle to add.' });
    await loaded();
    await userEvent.click(qa('[data-part=link]')[1]!);
    await waitFor(() => expect(q('[data-part=carPick]')).not.toBeNull());
    await userEvent.click(q('[data-part=add]'));
    await waitFor(() => expect(words(q('[data-part=formError]'))).toBe('Pick a vehicle to add.'));
    const gate = deferred<void>();
    s.w.linkError = null;
    s.w.linkGate = gate.promise;
    await userEvent.click(q('[data-part=add]'));
    await waitFor(() => expect(s.w.writes.length).toBe(2));
    expect(q('[data-part=formError]')).toBeNull();
    gate.resolve();
    await waitFor(() => expect(q('[data-part=dialog]')).toBeNull());
  });
  it('shows what the server said when a car could not be put in', async () => {
    boot('admin', ALL, { linkError: 'Pick a vehicle to add.' });
    await loaded();
    await userEvent.click(qa('[data-part=link]')[1]!);
    await waitFor(() => expect(q('[data-part=carPick]')).not.toBeNull());
    await userEvent.click(q('[data-part=add]'));
    await waitFor(() => expect(words(q('[data-part=formError]'))).toBe('Pick a vehicle to add.'));
    expect(q('[data-part=dialog]')).not.toBeNull();
  });
});
