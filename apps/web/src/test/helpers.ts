import { vi } from 'vitest';
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
