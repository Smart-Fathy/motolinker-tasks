import { adminActor, describeActor, employeeActor } from '@motolinker/contracts/access';
import contracts from '@motolinker/contracts';
import { describe, expect, it, vi } from 'vitest';
import { getMe, isMe } from './api';

const MeResponse = contracts.schemas.MeResponse;

const workspace = { name: 'MotoLinker', logo_url: '', updated_at: null };
const adminMe = () => ({ ...describeActor(adminActor()), workspace, flags: {} });
const employeeMe = () => ({
  ...describeActor(
    employeeActor({
      id: 7,
      name: 'Sara',
      job_title: 'Sales',
      permissions: { leads: true, leadsActions: { view: true, edit: true } },
    }),
  ),
  profile: {
    username: 'sara',
    avatarUrl: 'https://cdn.example.test/sara.png',
    statusText: 'In a meeting',
    statusEmoji: '📅',
  },
  workspace: { ...workspace, updated_at: '2026-03-04T10:00:00.000Z' },
  flags: { preview: true },
});

const reply = (status: number, body?: unknown) =>
  vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

describe('the /me answer the app accepts', () => {
  // The bundle does not carry zod just to check one response; this is what keeps the hand-written check honest.
  const cases: Array<[string, unknown]> = [
    ['an admin', adminMe()],
    ['an employee', employeeMe()],
    ['a degraded workspace', { ...adminMe(), workspace: { ...workspace, degraded: true } }],
    ['a field the app does not know', { ...adminMe(), somethingNew: 1 }],
    [
      'an employee with a profile that has an empty picture and status',
      {
        ...employeeMe(),
        profile: { username: 'sara', avatarUrl: '', statusText: '', statusEmoji: '' },
      },
    ],
    [
      'a profile with no username',
      { ...employeeMe(), profile: { ...employeeMe().profile, username: undefined } },
    ],
    [
      'a profile whose picture is a number',
      { ...employeeMe(), profile: { ...employeeMe().profile, avatarUrl: 3 } },
    ],
    ['a profile that is a string', { ...employeeMe(), profile: 'sara' }],
    ['a profile that is null', { ...employeeMe(), profile: null }],
    ['nothing', undefined],
    ['null', null],
    ['an array', []],
    ['no workspace', { ...adminMe(), workspace: undefined }],
    ['a workspace with no name', { ...adminMe(), workspace: { logo_url: '', updated_at: null } }],
    ['an unknown kind of actor', { ...adminMe(), actor: { ...adminMe().actor, kind: 'root' } }],
    [
      'an id that is not a whole number',
      { ...employeeMe(), actor: { ...employeeMe().actor, id: 1.5 } },
    ],
    ['capabilities that are a number', { ...adminMe(), caps: 91 }],
    ['sections with a non-text entry', { ...employeeMe(), sections: ['leads', 7] }],
    ['a scope without its lists', { ...adminMe(), scope: { assignedOnly: false } }],
    ['flags that are not true/false', { ...adminMe(), flags: { preview: 'yes' } }],
    ['flags that are a list', { ...adminMe(), flags: [] }],
    ['an updated_at that is missing', { ...adminMe(), workspace: { name: 'X', logo_url: '' } }],
    [
      'a degraded that is not true/false',
      { ...adminMe(), workspace: { ...workspace, degraded: 'yes' } },
    ],
  ];
  it.each(cases)('agrees with the schema in packages/contracts about %s', (_label, payload) => {
    expect(isMe(payload)).toBe(MeResponse.safeParse(payload).success);
  });

  it('accepts what the server really sends, for the admin and for an employee', () => {
    expect(isMe(adminMe())).toBe(true);
    expect(isMe(employeeMe())).toBe(true);
  });
});

describe('asking the server who this is', () => {
  it('sends the token as a bearer token to /api/v1/me', async () => {
    const f = reply(200, adminMe());
    await getMe('tok-123', { fetchImpl: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
  });

  it('returns the person on a good answer', async () => {
    const r = await getMe('t', { fetchImpl: reply(200, employeeMe()) as unknown as typeof fetch });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.me.actor.key).toBe('employee_7');
  });

  it('says "unauthorized" for a 401, which is the one answer that means the token is no good', async () => {
    expect(
      await getMe('t', {
        fetchImpl: reply(401, { error: 'Unauthorized' }) as unknown as typeof fetch,
      }),
    ).toEqual({ kind: 'unauthorized' });
  });

  it('does NOT say that for a database that is down (503) or any other failure: nobody is signed out by an outage', async () => {
    expect(
      await getMe('t', { fetchImpl: reply(503, { error: 'x' }) as unknown as typeof fetch }),
    ).toEqual({ kind: 'unavailable', status: 503 });
    expect(await getMe('t', { fetchImpl: reply(500, {}) as unknown as typeof fetch })).toEqual({
      kind: 'unavailable',
      status: 500,
    });
  });

  it('treats a 200 it cannot read as unavailable, not as a person', async () => {
    expect(
      await getMe('t', { fetchImpl: reply(200, { hello: 'world' }) as unknown as typeof fetch }),
    ).toEqual({ kind: 'unavailable', status: 200 });
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await getMe('t', { fetchImpl: notJson as unknown as typeof fetch })).toEqual({
      kind: 'unavailable',
      status: 200,
    });
  });

  it('says "network" when the server cannot be reached', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await getMe('t', { fetchImpl: down as unknown as typeof fetch })).toEqual({
      kind: 'network',
    });
  });

  it('lets a cancelled request be cancelled instead of reporting it as a result', async () => {
    const cancelled = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(getMe('t', { fetchImpl: cancelled as unknown as typeof fetch })).rejects.toThrow(
      /aborted/,
    );
  });
});
