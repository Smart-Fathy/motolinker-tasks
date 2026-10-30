import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';

/** What GET /api/v1/me answers; the schema lives in packages/contracts, so the server and this app cannot drift. */
export type Me = z.infer<typeof schemas.MeResponse>;

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

/**
 * Is this what /api/v1/me answers? The app reads these fields and no others, so these are the ones checked;
 * api.test.ts holds this to the schema in packages/contracts (the bundle does not carry zod just for this).
 */
export function isMe(v: unknown): v is Me {
  if (!isObject(v)) return false;
  const { actor, caps, sections, scope, workspace, flags } = v;
  if (!isObject(actor) || (actor['kind'] !== 'admin' && actor['kind'] !== 'employee')) return false;
  if (!(actor['id'] === null || Number.isInteger(actor['id']))) return false;
  if (
    typeof actor['key'] !== 'string' ||
    typeof actor['name'] !== 'string' ||
    typeof actor['jobTitle'] !== 'string'
  )
    return false;
  if (!isCapList(caps) || !isCapList(sections)) return false;
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
