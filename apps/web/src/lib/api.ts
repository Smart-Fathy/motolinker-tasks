import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';
import type { Portal } from './env';

/** What GET /api/v1/me answers; the schema lives in packages/contracts, so the server and this app cannot drift. */
export type Me = z.infer<typeof schemas.MeResponse>;

/** What an employee keeps about themselves (the account menu shows and changes it); the administrator has none. */
export type Profile = z.infer<typeof schemas.Profile>;

export type MeResult =
  | { kind: 'ok'; me: Me }
  /** the token is not (or no longer) a session */
  | { kind: 'unauthorized' }
  /** the server answered, but not with a person: its database is down (503), it failed, or it said something unreadable */
  | { kind: 'unavailable'; status: number }
  /** the server could not be reached at all */
  | { kind: 'network' };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): boolean =>
  Array.isArray(v) && v.every(x => typeof x === 'string');
const isCapList = (v: unknown): boolean => v === '*' || isStringList(v);
const isProfile = (v: unknown): boolean =>
  isObject(v) &&
  typeof v['username'] === 'string' &&
  typeof v['avatarUrl'] === 'string' &&
  typeof v['statusText'] === 'string' &&
  typeof v['statusEmoji'] === 'string';

/**
 * Is this what /api/v1/me answers? The app reads these fields and no others, so these are the ones checked;
 * api.test.ts holds this to the schema in packages/contracts (the bundle does not carry zod just for this).
 */
export function isMe(v: unknown): v is Me {
  if (!isObject(v)) return false;
  const { actor, caps, sections, scope, profile, workspace, flags } = v;
  if (!isObject(actor) || (actor['kind'] !== 'admin' && actor['kind'] !== 'employee')) return false;
  if (!(actor['id'] === null || Number.isInteger(actor['id']))) return false;
  if (
    typeof actor['key'] !== 'string' ||
    typeof actor['name'] !== 'string' ||
    typeof actor['jobTitle'] !== 'string'
  )
    return false;
  if (!isCapList(caps) || !isCapList(sections)) return false;
  // an employee's own (the administrator's answer has none)
  if (profile !== undefined && !isProfile(profile)) return false;
  if (
    !isObject(scope) ||
    typeof scope['assignedOnly'] !== 'boolean' ||
    !isStringList(scope['dealStages']) ||
    !isStringList(scope['leadStatuses'])
  )
    return false;
  if (
    !isObject(workspace) ||
    typeof workspace['name'] !== 'string' ||
    typeof workspace['logo_url'] !== 'string'
  )
    return false;
  if (!(workspace['updated_at'] === null || typeof workspace['updated_at'] === 'string'))
    return false;
  if (workspace['degraded'] !== undefined && typeof workspace['degraded'] !== 'boolean')
    return false;
  if (!isObject(flags) || !Object.values(flags).every(x => typeof x === 'boolean')) return false;
  return true;
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export interface ApiOptions {
  signal?: AbortSignal;
  /** for tests; the page's own fetch otherwise */
  fetchImpl?: typeof fetch;
}

/** Ask the server who this token belongs to. A cancelled request throws its AbortError: that is not an answer. */
export async function getMe(
  token: string,
  { signal, fetchImpl }: ApiOptions = {},
): Promise<MeResult> {
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch('/api/v1/me', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: signal ?? null,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    return { kind: 'network' };
  }
  if (res.status === 401) return { kind: 'unauthorized' };
  if (!res.ok) return { kind: 'unavailable', status: res.status };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unavailable', status: res.status };
  }
  return isMe(body) ? { kind: 'ok', me: body } : { kind: 'unavailable', status: res.status };
}

/** What a call to the server came back with when it was not an answer: `status` 0 is "could not be reached". */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** The server, as a signed-in screen asks it questions. */
export interface Api {
  /** the portal's own routes (`/api/dashboard`, `/api/employee`), for the screens that are not on /api/v1 yet */
  readonly base: string;
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  /** a multipart form (a file goes with its words): the browser writes the content type, boundary and all */
  postForm<T = unknown>(path: string, form: FormData, options?: RequestOptions): Promise<T>;
}

export interface ApiDeps {
  portal: Portal;
  token: string;
  /** a call came back 401; the owner of the session decides whether that is the token (see useMe) */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

const SAY_UNREACHABLE = 'Cannot reach the server. Check the connection and try again.';

export const portalBase = (portal: Portal): string =>
  portal === 'team' ? '/api/employee' : '/api/dashboard';

/**
 * Asks the server as the person who is signed in. An answer that is not a success is an ApiError carrying the server's
 * own words (`{ error }`); an unreadable body is not the end of the call. A 401 is reported to `onUnauthorized` and
 * thrown: whether it means the session is over is not decided here — a screen's own route can refuse for its own
 * reasons, and only the server's answer about the token itself (GET /api/v1/me) ends a session.
 */
export function makeApi({ portal, token, onUnauthorized, fetchImpl }: ApiDeps): Api {
  const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  async function call<T>(
    method: string,
    path: string,
    body: unknown,
    { signal }: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    const form = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(path, {
        method,
        headers,
        body: body === undefined ? null : form ? body : JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new ApiError(0, SAY_UNREACHABLE);
    }
    let parsed: unknown;
    try {
      const text = await res.text();
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (res.ok) return parsed as T;
    if (res.status === 401) onUnauthorized?.();
    const said = isObject(parsed) ? parsed : {};
    const message =
      typeof said['error'] === 'string' && said['error']
        ? said['error']
        : `The server answered with an error (${res.status}).`;
    throw new ApiError(
      res.status,
      message,
      typeof said['code'] === 'string' ? said['code'] : undefined,
    );
  }
  return {
    base: portalBase(portal),
    get: (path, options) => call('GET', path, undefined, options),
    post: (path, body, options) => call('POST', path, body ?? {}, options),
    put: (path, body, options) => call('PUT', path, body ?? {}, options),
    patch: (path, body, options) => call('PATCH', path, body ?? {}, options),
    del: (path, options) => call('DELETE', path, undefined, options),
    postForm: (path, form, options) => call('POST', path, form, options),
  };
}
