import { normalisePermissions } from '@motolinker/contracts/permissions';
import { adminActor, describeActor, employeeActor } from '@motolinker/contracts/access';
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Me } from '../lib/api';
import type { AuthApi } from '../lib/auth-api';
import type { MlEnv } from '../lib/env';

export const admin: MlEnv = {
  portal: 'admin',
  workspaceName: 'Acme Motors',
  texts: {},
  ui: 'next',
};
export const team: MlEnv = { portal: 'team', workspaceName: 'Acme Motors', texts: {}, ui: 'next' };

/** A stand-in for localStorage: what it holds, and what it was asked to remove. */
export function storageWith(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
    data,
  };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The sign-in calls as spies: each test says what the server answers. */
export function fakeApi() {
  return {
    signIn: vi.fn<AuthApi['signIn']>(),
    verifyCode: vi.fn<AuthApi['verifyCode']>(),
    forgotPassword: vi.fn<AuthApi['forgotPassword']>(),
    resetPassword: vi.fn<AuthApi['resetPassword']>(),
    signOut: vi.fn<AuthApi['signOut']>(async () => undefined),
  } satisfies AuthApi;
}

/** A promise a test settles when it chooses: for what a screen shows while it is still waiting. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const WORKSPACE = { name: 'Acme Motors', logo_url: '', updated_at: null };
const DEPS = {
  dealStages: ['lead', 'quoted', 'won', 'lost'],
  normStatus: (s: unknown) => String(s).toLowerCase(),
};

/** What GET /api/v1/me answers for the admin. */
export const adminMe = (flags: Record<string, boolean> = {}): Me =>
  ({ ...describeActor(adminActor()), workspace: WORKSPACE, flags }) as unknown as Me;

/** …and for a team member with these permissions as stored (the server normalises them, as it does at sign-in). */
export const teamMe = (
  permissions: Record<string, unknown> = {},
  jobTitle = 'Sales',
  flags: Record<string, boolean> = {},
  profile: Partial<NonNullable<Me['profile']>> = {},
): Me =>
  ({
    ...describeActor(
      employeeActor({
        id: 4,
        name: 'Sam',
        job_title: jobTitle,
        permissions: normalisePermissions(permissions, DEPS),
      }),
    ),
    profile: { username: 'sam', avatarUrl: '', statusText: '', statusEmoji: '', ...profile },
    workspace: WORKSPACE,
    flags,
  }) as unknown as Me;

/** Choose an option of the app's dropdown (a button that opens a panel of options): open it, and press the option. */
export async function choose(user: UserEvent, trigger: HTMLElement, option: string): Promise<void> {
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: option }));
}

/** The options a dropdown offers, in order (it is opened to read them, and closed again). */
export async function optionsOf(user: UserEvent, trigger: HTMLElement): Promise<string[]> {
  await user.click(trigger);
  const names = screen.getAllByRole('option').map(o => o.textContent ?? '');
  await user.keyboard('{Escape}');
  return names;
}
