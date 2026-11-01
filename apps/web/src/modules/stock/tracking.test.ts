import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  callOf,
  carLabel,
  carrierName,
  carTitle,
  checkWarning,
  diagnosisOf,
  dm,
  dtLocal,
  fmtDate,
  fmtDateTime,
  formOf,
  hueVar,
  isCarLinked,
  isContainer,
  isContainerBase,
  isContainerList,
  isLookup,
  isProviderStatus,
  isRefreshed,
  isRegistered,
  isSaved,
  mapLink,
  positionAge,
  providerSaid,
  refreshSaid,
  registeredSaid,
  statusOf,
  voyageProgress,
  whyNotTracked,
  type ProviderStatus,
  type Refreshed,
} from './tracking';
import { oneAtATime } from '../../test/wrongly';

const base = (over: Record<string, unknown> = {}) => ({
  id: 1,
  container_no: 'CSQU3054383',
  container_type: "40' DRY",
  bl_number: '',
  carrier: 'MSC',
  status: 'in_transit',
  latest_move: 'Departed',
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
  moves: [{ at: '2026-10-02T00:00:00.000Z', event: 'Gate out', place: 'Shanghai', vessel: '' }],
  po_id: 12,
  supplier: 'BYD',
  notes: '',
  ...over,
});
const withCars = (over: Record<string, unknown> = {}) => ({
  ...base(),
  units: [
    { vin: 'LGXC76C41P0123456', stock_id: 7, make: 'BYD', model: 'Seal', colour: 'White' },
    { vin: 'UNKNOWN', unrecorded: true },
  ],
  ...over,
});
const check = { no: 'CSQU3054383', valid: true, checkOk: true, expected: 3 };

/** The guards are the schemas' (the bundle does not carry zod): each agrees with its schema on what it is shown. */
describe('the guards of the Tracking tab agree with the contract’s schemas', () => {
  const same = (
    guard: (v: unknown) => boolean,
    schema: { safeParse: (v: unknown) => { success: boolean } },
    v: unknown,
  ) => expect(guard(v), JSON.stringify(v).slice(0, 90)).toBe(schema.safeParse(v).success);

  it('for a box, with its cars and without', () => {
    for (const v of [
      base(),
      withCars(),
      base({
        vessel_lat: 31.2,
        vessel_lon: 29.9,
        vessel_position_at: '2026-11-01T00:00:00.000Z',
        vessel_course: 90,
        vessel_speed: 12,
        vessel_mmsi: '636012345',
        position_source: 'ais',
      }),
      base({ vessel_lat: '31.2' }),
      base({ moves: null, container_type: null, carrier: null, po_id: null }),
      base({ id: 'x' }),
      base({ moves: [{ at: 1, event: 'x', place: '', vessel: '' }] }),
      base({ po_id: '12' }),
      base({ status: undefined }),
      withCars({ units: [{ unrecorded: true }] }),
      withCars({ units: 'none' }),
      null,
      [],
      'text',
    ]) {
      same(isContainerBase, schemas.ContainerBase, v);
      same(isContainer, schemas.Container, v);
    }
    expect(isContainerList([withCars()])).toBe(true);
    expect(isContainerList([base()])).toBe(false);
    expect(isContainerList({})).toBe(false);
  });

  it('for what a save answers', () => {
    for (const v of [
      { ...base(), check },
      { ...base(), check: { ...check, expected: null } },
      { ...base(), check: {} },
      base(),
      { ...base(), check: null },
    ])
      same(isSaved, schemas.ContainerSaved, v);
  });

  it('for what a look-up answers, found and not', () => {
    const missing = {
      found: false,
      check,
      prefill: null,
      provider: 'not-configured',
      code: 'not-configured',
      detail: null,
      provider_name: 'none',
      can_register: false,
    };
    for (const v of [
      { found: true, check, container: withCars() },
      { found: true, check, container: base() },
      missing,
      { ...missing, prefill: { carrier: 'MSC' } },
      { ...missing, provider: undefined },
      { ...missing, can_register: 'yes' },
      { ...missing, code: undefined },
      { ...missing, found: 'no' },
      { found: true, check },
      {},
    ])
      same(isLookup, schemas.ContainerLookup, v);
  });

  it('for the test of the carrier’s key', () => {
    const ok = {
      provider: 'none',
      configured: false,
      auth_header: 'API_KEY',
      carrier_has_position: false,
      ais: 'not-configured',
      webhook_ready: false,
    };
    for (const v of [
      ok,
      {
        ...ok,
        probe: 'unauthorized',
        reachable: false,
        http: 401,
        detail: 'bad',
        auth: { ok: false },
      },
      { ...ok, http: null },
      { ...ok, ais: 3 },
      { ...ok, configured: 'yes' },
      {},
    ])
      same(isProviderStatus, schemas.ContainerProviderStatus, v);
  });

  it('for a refresh, a registration and a link', () => {
    for (const v of [
      { ok: true, carrier: { ok: true }, position: null, changed: 3, container: base() },
      {
        ok: false,
        carrier: { ok: false, code: 'unauthorized', reason: 'x', detail: null },
        position: { ok: false, reason: 'older' },
        changed: 0,
        container: base(),
      },
      {
        ok: true,
        carrier: null,
        position: { ok: true, at: '2026-11-01T00:00:00.000Z' },
        changed: 8,
        container: base(),
      },
      { ok: true, carrier: 'x', position: null, changed: 1, container: base() },
      { ok: true, carrier: null, position: null, changed: 'many', container: base() },
    ])
      same(isRefreshed, schemas.ContainerRefreshed, v);
    for (const v of [
      { ok: true, status: 'registered', provider: 'safecube' },
      { ok: false, code: 'forbidden', reason: 'x', detail: null },
      { ok: false },
      { ok: true },
      {},
    ])
      same(isRegistered, schemas.ContainerRegistered, v);
    for (const v of [{ ok: true, vin: 'V1' }, { ok: true }, { ok: false, vin: 'V1' }, {}])
      same(isCarLinked, schemas.ContainerCarLinked, v);
  });
});

/** The same, a field at a time: each field wrong in each way, and each left out. */
describe('the guards of the Tracking tab agree with the schemas on every field', () => {
  const same = (
    guard: (v: unknown) => boolean,
    schema: { safeParse: (v: unknown) => { success: boolean } },
    v: unknown,
  ) => expect(guard(v), JSON.stringify(v)?.slice(0, 90)).toBe(schema.safeParse(v).success);
  const full = {
    ...base({
      vessel_lat: 31.2,
      vessel_lon: 29.9,
      vessel_position_at: '2026-11-01T00:00:00.000Z',
      vessel_course: 90,
      vessel_speed: 12,
      vessel_mmsi: '636012345',
      position_source: 'ais',
      source: 'manual',
      last_synced_at: '2026-11-01T00:00:00.000Z',
      created_by: 'dashboard',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    }),
  };

  it('for a box, its port calls and its cars', () => {
    for (const v of oneAtATime(full)) same(isContainerBase, schemas.ContainerBase, v);
    const car = {
      vin: 'V1',
      unrecorded: false,
      stock_id: 7,
      make: 'BYD',
      model: 'Seal',
      trim: 'D',
      colour: 'W',
      status: 's',
      consignee: 'H',
    };
    for (const v of oneAtATime(withCars({ units: [car] }))) same(isContainer, schemas.Container, v);
    for (const units of oneAtATime(car).map(c => [c]))
      same(isContainer, schemas.Container, withCars({ units }));
    const move = {
      at: '2026-10-02T00:00:00.000Z',
      event: 'Gate out',
      place: 'Shanghai',
      vessel: 'X',
    };
    for (const m of oneAtATime(move))
      same(isContainerBase, schemas.ContainerBase, base({ moves: [m] }));
  });

  it('for what a save, a look-up and a refresh answer', () => {
    for (const v of oneAtATime({ ...full, check }) as Record<string, unknown>[])
      same(isSaved, schemas.ContainerSaved, v);
    for (const c of oneAtATime(check)) same(isSaved, schemas.ContainerSaved, { ...full, check: c });
    for (const c of oneAtATime(check))
      same(isLookup, schemas.ContainerLookup, { found: true, check: c, container: withCars() });
    const missing = {
      found: false,
      check,
      prefill: { carrier: 'MSC' },
      provider: 'safecube',
      code: 'ok',
      detail: 'text',
      provider_name: 'safecube',
      can_register: true,
    };
    for (const v of oneAtATime(missing)) same(isLookup, schemas.ContainerLookup, v);
    const feed = { ok: true, code: 'ok', reason: 'x', detail: 'y', at: '2026-11-01T00:00:00.000Z' };
    const refreshed = { ok: true, carrier: feed, position: feed, changed: 2, container: full };
    for (const v of oneAtATime(refreshed)) same(isRefreshed, schemas.ContainerRefreshed, v);
    for (const f of oneAtATime(feed))
      same(isRefreshed, schemas.ContainerRefreshed, { ...refreshed, carrier: f });
  });

  it('for the test of the carrier’s key, a registration and a link', () => {
    const status = {
      provider: 'safecube',
      configured: true,
      auth_header: 'API_KEY',
      carrier_has_position: true,
      ais: 'configured',
      webhook_ready: true,
      probe: 'ok',
      reachable: true,
      http: 200,
      detail: 'x',
    };
    for (const v of oneAtATime(status)) same(isProviderStatus, schemas.ContainerProviderStatus, v);
    for (const v of oneAtATime({ ok: true, status: 'registered', provider: 'safecube' }))
      same(isRegistered, schemas.ContainerRegistered, v);
    for (const v of oneAtATime({ ok: false, code: 'forbidden', reason: 'x', detail: 'y' }))
      same(isRegistered, schemas.ContainerRegistered, v);
    for (const v of oneAtATime({ ok: true, vin: 'V1' }))
      same(isCarLinked, schemas.ContainerCarLinked, v);
  });
});

describe('how a box is written', () => {
  it('dates as dd/mm/yyyy from the calendar day, never through the time zone; a dash where there is none', () => {
    expect(fmtDate('2026-11-20')).toBe('20/11/2026');
    expect(fmtDate('2026-11-20T23:30:00+03:00')).toBe('20/11/2026');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('soon')).toBe('—');
  });
  it('a moment as yyyy-mm-dd hh:mm in this browser’s time, and for a date-and-time box', () => {
    const d = new Date(2026, 9, 5, 8, 7);
    expect(fmtDateTime(d.toISOString())).toBe('2026-10-05 08:07');
    expect(dtLocal(d.toISOString())).toBe('2026-10-05T08:07');
    expect(fmtDateTime('')).toBe('—');
    // (nothing is a dash, whatever kind of nothing: a bare 0 would otherwise read as the year 2000)
    for (const nothing of [null, undefined, 0, false]) expect(fmtDateTime(nothing)).toBe('—');
    expect(fmtDateTime('nope')).toBe('—');
    expect(dtLocal('nope')).toBe('');
  });
  it('degrees as a chart writes them', () => {
    expect(dm(31.2, 'lat')).toBe('31.200° N');
    expect(dm(-33.918, 'lat')).toBe('33.918° S');
    expect(dm(18.4, 'lon')).toBe('18.400° E');
    expect(dm(-122.4, 'lon')).toBe('122.400° W');
    expect(dm('x', 'lat')).toBe('—');
    // (the equator and the meridian are north and east, as the classic page wrote them)
    expect(dm(0, 'lat')).toBe('0.000° N');
    expect(dm(0, 'lon')).toBe('0.000° E');
  });
  it('how old a fix is, and how far to trust it', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    const at = (mins: number) => new Date(now - mins * 60000).toISOString();
    expect(positionAge(at(5), now)).toEqual({ label: '5 min ago', cls: 'fresh' });
    expect(positionAge(at(59), now).label).toBe('59 min ago');
    expect(positionAge(at(60), now)).toEqual({ label: '1 h ago', cls: 'fresh' });
    expect(positionAge(at(90), now)).toEqual({ label: '2 h ago', cls: 'fresh' });
    expect(positionAge(at(91), now).cls).toBe('aging');
    expect(positionAge(at(12 * 60), now)).toEqual({ label: '12 h ago', cls: 'aging' });
    expect(positionAge(at(12 * 60 + 1), now).cls).toBe('stale');
    expect(positionAge(at(47 * 60), now).label).toBe('47 h ago');
    expect(positionAge(at(48 * 60), now).label).toBe('2 d ago');
    // (days are rounded, as hours are)
    expect(positionAge(at(59 * 60), now).label).toBe('2 d ago');
    expect(positionAge(at(60 * 60), now).label).toBe('3 d ago');
    expect(positionAge(null, now)).toEqual({ label: 'age unknown', cls: 'stale' });
    expect(positionAge(at(-30), now).label).toBe('0 min ago');
  });
  it('how far along its leg a ship is, by time, held between the ends', () => {
    const a = '2026-10-01T00:00:00Z';
    const e = '2026-10-11T00:00:00Z';
    expect(voyageProgress(a, e, Date.parse('2026-10-06T00:00:00Z'))).toBe(0.5);
    expect(voyageProgress(a, e, Date.parse('2026-09-01T00:00:00Z'))).toBe(0);
    expect(voyageProgress(a, e, Date.parse('2026-12-01T00:00:00Z'))).toBe(1);
    expect(voyageProgress(a, a, 0)).toBeNull();
    expect(voyageProgress(e, a, 0)).toBeNull();
    expect(voyageProgress(null, e, 0)).toBeNull();
    expect(voyageProgress(a, 'x', 0)).toBeNull();
  });
  it('a port call that is only expected is a plan, not a fact', () => {
    expect(
      callOf({ at: '', event: 'Discharge (expected)', place: 'Alexandria', vessel: 'MSC' }),
    ).toEqual({
      expected: true,
      label: 'Discharge',
      where: 'Alexandria · MSC',
    });
    expect(callOf({ at: '', event: 'Gate out', place: '', vessel: '' })).toEqual({
      expected: false,
      label: 'Gate out',
      where: '',
    });
    // (only a word of its own at the end says so: not glued to another, not in the middle)
    expect(callOf({ at: '', event: 'Gate out(expected)', place: '', vessel: '' })).toMatchObject({
      expected: false,
      label: 'Gate out(expected)',
    });
    expect(callOf({ at: '', event: 'Gate (expected) out', place: '', vessel: '' })).toMatchObject({
      expected: false,
      label: 'Gate (expected) out',
    });
  });
  it('a status the list does not have is drawn as the first, a colour as a theme token where it can be', () => {
    expect(statusOf('arrived').label).toBe('Arrived');
    expect(statusOf('nonsense').label).toBe('Booked');
    expect(hueVar('#8a5a00')).toBe('var(--h-8a5a00,#8a5a00)');
    // (the token is named in lower case, whatever case the colour was written in; the colour itself is kept as written)
    expect(hueVar('#8A5A0B')).toBe('var(--h-8a5a0b,#8A5A0B)');
    // (three digits are no token)
    expect(hueVar('#8a5')).toBe('#8a5');
    expect(hueVar('var(--muted)')).toBe('var(--muted)');
  });
  it('a link out to where the ship is', () => {
    expect(mapLink(31.2, -29.9)).toBe(
      'https://www.openstreetmap.org/?mlat=31.2&mlon=-29.9#map=5/31.2/-29.9',
    );
  });
  it('the car in a box, and in the list of those that can go in one', () => {
    const car = {
      vin: 'V1',
      make: 'BYD',
      model: 'Seal',
      trim: 'Design',
      colour: 'White',
      status: '',
      consignee: 'Hany',
    };
    expect(carLabel(car)).toBe('V1 · BYD Seal Design · White · Hany');
    expect(carLabel({ ...car, make: '', model: '', trim: '', colour: '', consignee: '' })).toBe(
      'V1',
    );
    expect(carTitle({ vin: 'V1', make: 'BYD', model: 'Seal', colour: 'White' })).toBe(
      'BYD · Seal · White',
    );
    expect(carTitle({ vin: 'V1', unrecorded: true })).toBe('This VIN is not in the Models tab yet');
  });
});

describe('what a carrier’s answer comes to', () => {
  it('names the platform, and says it of a platform it does not know', () => {
    expect(carrierName('terminal49')).toBe('Terminal49');
    expect(carrierName('safecube')).toBe('Safecube');
    expect(carrierName('generic')).toBe('The carrier feed');
    expect(carrierName('none')).toBe('The carrier platform');
    expect(carrierName(undefined)).toBe('The carrier platform');
  });
  it('turns each class of answer into one sentence that says what to do next', () => {
    const N = 'Safecube';
    expect(whyNotTracked('ok', N)).toBe('Prefilled from the carrier.');
    expect(whyNotTracked('not-configured', N)).toBe(
      'Automatic lookup is not set up, so enter what the carrier shows.',
    );
    expect(whyNotTracked('not-tracked-yet', N)).toBe(
      'Safecube is not watching this container yet. Register it below to start.',
    );
    expect(whyNotTracked('unknown', N)).toBe(
      'CONTAINER_TRACKING_PROVIDER is not a name I recognise — check the spelling.',
    );
    expect(whyNotTracked('plan-required', N)).toBe(
      'Safecube accepted the key, but reading containers back needs a paid plan — the free key may only register them. Register it below and follow it in Safecube, or enter the details by hand.',
    );
    expect(whyNotTracked('unauthorized', N)).toBe(
      'Safecube did not recognise the key at all. Check CONTAINER_TRACKING_KEY, and that it is the right kind of key.',
    );
    expect(whyNotTracked('forbidden', N)).toBe(
      'Safecube recognised the key and refused the request — an account, plan or scope limit rather than a wrong key. Test connection says which.',
    );
    expect(whyNotTracked('rate-limited', N)).toBe(
      'Safecube is rate-limiting us — try again shortly.',
    );
    expect(whyNotTracked('provider-down', N)).toBe('Safecube is not responding right now.');
    expect(whyNotTracked('timeout', N)).toBe('Safecube did not answer in time.');
    expect(whyNotTracked('unreachable', N)).toBe('Could not reach Safecube.');
    expect(whyNotTracked('not-found', N)).toBe('Safecube has no record of this container.');
    expect(whyNotTracked('sealine-unknown', N)).toBe(
      "Safecube could not work out which shipping line this container belongs to. Set SAFECUBE_SEALINE to the line's SCAC code (MSC is MSCU) and try again.",
    );
    expect(whyNotTracked('bad-number', N)).toBe(
      'Safecube rejected the number itself — check it against the bill of lading.',
    );
    expect(whyNotTracked('something-new', N)).toBe(
      'Carrier lookup unavailable — enter it by hand.',
    );
  });
  it('says what registering came to, by platform', () => {
    expect(registeredSaid({ ok: true, status: 'registered', provider: 'safecube' })).toMatch(
      /Registered — registered\. Updates now arrive on their own/,
    );
    expect(registeredSaid({ ok: true, status: 'pending', provider: 'terminal49' })).toBe(
      'Registered — status pending. Milestones arrive on the next refresh.',
    );
    expect(registeredSaid({ ok: false, code: 'plan-required' })).toBe(
      'That needs a paid plan on the carrier platform.',
    );
    expect(registeredSaid({ ok: false, code: 'unauthorized' })).toBe(
      'The carrier rejected the key.',
    );
    expect(registeredSaid({ ok: false, code: 'forbidden', reason: 'provider returned 403' })).toBe(
      'Carrier would not take it: provider returned 403',
    );
  });
  it('says what a refresh came to — each feed on its own, since one may move and the other not', () => {
    const r = (over: Partial<Refreshed>): Refreshed => ({
      ok: true,
      carrier: null,
      position: null,
      changed: 0,
      container: base() as never,
      ...over,
    });
    expect(refreshSaid(r({ carrier: { ok: true }, position: { ok: true }, changed: 3 }))).toEqual({
      text: 'carrier updated · position updated (3 fields)',
      reload: true,
    });
    expect(refreshSaid(r({ carrier: { ok: true }, changed: 1 })).text).toBe(
      'carrier updated (1 field)',
    );
    expect(
      refreshSaid(
        r({ carrier: { ok: false, code: 'unauthorized' }, position: { ok: true }, changed: 8 }),
      ).text,
    ).toBe('carrier did not recognise the key · position updated (8 fields)');
    expect(refreshSaid(r({ ok: false, carrier: { ok: false, code: 'not-configured' } }))).toEqual({
      text: 'no carrier feed set up',
      reload: false,
    });
    expect(
      refreshSaid(
        r({
          ok: false,
          carrier: { ok: false, code: 'odd', reason: 'why' },
          position: { ok: false, reason: 'older fix' },
        }),
      ).text,
    ).toBe('carrier: why · position: older fix');
    expect(refreshSaid(r({ ok: false })).text).toBe('Nothing to update.');
    expect(refreshSaid(r({ ok: true, carrier: { ok: true } }))).toEqual({
      text: 'Already up to date.',
      reload: true,
    });
  });
  it('says what the test of the key came to, accusing the key only where it is the key', () => {
    const s = (over: Partial<ProviderStatus>): ProviderStatus => ({
      provider: 'terminal49',
      configured: true,
      auth_header: 'Authorization',
      carrier_has_position: false,
      ais: 'not-configured',
      webhook_ready: false,
      ...over,
    });
    expect(providerSaid(s({ provider: 'none' }))).toBe('No carrier feed is configured');
    expect(providerSaid(s({ provider: 'unknown' }))).toBe(
      'CONTAINER_TRACKING_PROVIDER is not a name I recognise',
    );
    expect(providerSaid(s({ probe: 'ok', reachable: true }))).toBe(
      'Provider: terminal49 · key accepted · AIS: not-configured · no webhook secret',
    );
    expect(providerSaid(s({ probe: 'unauthorized', reachable: false, http: 401 }))).toBe(
      'Provider: terminal49 · key rejected — HTTP 401 · AIS: not-configured · no webhook secret',
    );
    expect(providerSaid(s({ probe: 'forbidden', reachable: false, http: 403 }))).toMatch(
      /key accepted, request refused — HTTP 403/,
    );
    expect(providerSaid(s({ probe: 'timeout', reachable: false }))).toMatch(
      /carrier did not answer in time/,
    );
    expect(providerSaid(s({ probe: 'plan-required', reachable: false }))).toMatch(
      /key accepted, reads need a paid plan/,
    );
    expect(providerSaid(s({ probe: 'weird', reachable: false }))).toMatch(/check failed \(weird\)/);
    // (each way a probe can fail has its own few words: the key is accused only by the two that mean it)
    for (const [probe, said] of Object.entries({
      unauthorized: 'key rejected',
      forbidden: 'key accepted, request refused',
      timeout: 'carrier did not answer in time',
      unreachable: 'carrier unreachable',
      'rate-limited': 'carrier is rate-limiting us',
      'provider-down': 'carrier is down',
      'plan-required': 'key accepted, reads need a paid plan',
      'sealine-unknown': 'key accepted, carrier not auto-detected',
      'bad-number': 'key accepted, probe number refused',
      'not-configured': 'no key set',
    }))
      expect(providerSaid(s({ probe, reachable: false })).split(' · ')[1], probe).toBe(said);
    expect(
      providerSaid(
        s({
          provider: 'safecube',
          carrier_has_position: true,
          webhook_ready: true,
          probe: 'ok',
          reachable: true,
        }),
      ),
    ).toBe('Provider: safecube · key accepted · positions included · webhook secret set');
  });
  it('reads the diagnosis of a refused key, where there is one', () => {
    const s: ProviderStatus = {
      provider: 'terminal49',
      configured: true,
      auth_header: 'x',
      carrier_has_position: false,
      ais: '',
      webhook_ready: false,
      auth: { ok: false, stage: 'header' },
    };
    expect(diagnosisOf(s)).toEqual({ ok: false, stage: 'header' });
    expect(diagnosisOf({ ...s, auth: undefined })).toBeNull();
    expect(diagnosisOf({ ...s, auth: 'x' })).toBeNull();
  });
});

describe('the form of a box', () => {
  it('starts as the box is, a status of “in transit” where it has none, the dates cut to the boxes that take them', () => {
    const f = formOf({
      ...base(),
      vessel_lat: 31.2,
      vessel_position_at: '2026-11-01T12:00:00.000Z',
      status: '',
    });
    expect(f.container_no).toBe('CSQU3054383');
    expect(f.status).toBe('in_transit');
    expect(f.pod_eta).toBe('2026-11-20');
    // (a date box takes a day, not the moment a feed may have written)
    expect(formOf({ ...base(), pod_eta: '2026-11-20T21:00:00.000Z' }).pod_eta).toBe('2026-11-20');
    expect(f.vessel_lat).toBe('31.2');
    expect(f.atd).toBe(dtLocal('2026-10-02T00:00:00.000Z'));
    expect(f.eta).toBe(dtLocal('2026-11-19T22:00:00.000Z'));
    expect(f.vessel_position_at).toBe(dtLocal('2026-11-01T12:00:00.000Z'));
    // (and none of them is a moment the box cannot take: the server's, with its seconds and its Z, would be refused)
    for (const k of ['atd', 'eta', 'vessel_position_at'] as const)
      expect(f[k], k).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(f.notes).toBe('');
    expect(formOf(undefined).status).toBe('in_transit');
    expect(formOf({ container_no: 'MSDU7337230', carrier: 'Hapag' }).carrier).toBe('Hapag');
  });
  it('sends the number cleaned and the rest as typed', () => {
    const b = bodyOf(formOf({ container_no: ' csqu-3054383 ', carrier: ' MSC ' }));
    expect(b['container_no']).toBe('CSQU3054383');
    expect(b['carrier']).toBe(' MSC ');
    expect(Object.keys(b).length).toBe(22);
  });
  it('warns of a check digit that is not the one the others call for, and says nothing otherwise', () => {
    expect(checkWarning('CSQU3054383')).toBeNull();
    expect(checkWarning('CSQU3054384')).toBe(
      'Check digit should be 3 — worth confirming against the B/L.',
    );
    expect(checkWarning('nope')).toBeNull();
  });
});
