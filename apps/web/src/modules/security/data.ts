// The Security panel's questions to the server: the portal's own security routes (`/api/employee/security…`,
// `/api/dashboard/security…` — one handler serves both, and they move under /api/v1 when the classic portals retire). Each
// answer is checked before it is believed, and a refusal comes back in the server's own words with its status: a wrong
// password or code is a 403 (never a 401, which is the only answer that can mean "your session ended"), and too many tries
// is a 429 that says how long to wait.
import { ApiError, type Api } from '../../lib/api';
import { failed } from '../../lib/outcome';
import {
  isCodes,
  isDisabled,
  isDone,
  isEnabled,
  isOverview,
  isRevoked,
  isSetup,
  SAID,
} from './model';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string; status: number };

const refused = (e: unknown): { ok: false; message: string; status: number } => ({
  ...failed(e),
  status: e instanceof ApiError ? e.status : 0,
});

async function ask<T>(
  call: () => Promise<unknown>,
  read: (body: unknown) => body is T,
): Promise<Result<T>> {
  let body: unknown;
  try {
    body = await call();
  } catch (e) {
    return refused(e);
  }
  return read(body) ? { ok: true, value: body } : { ok: false, message: SAID.notRead, status: 502 };
}

/** The calls the panel makes, for the portal `api` belongs to. */
export function securityCalls(api: Api) {
  const at = (path: string) => `${api.base}/security${path}`;
  return {
    /** everything the panel shows */
    overview: () => ask(() => api.get(at('')), isOverview),
    /** the key and picture for the authenticator (asks for the password again) */
    startSetup: (password: string) => ask(() => api.post(at('/2fa/setup'), { password }), isSetup),
    /** the code the authenticator shows proves it is set up: the factor goes live and the recovery codes are given */
    enable: (code: string) => ask(() => api.post(at('/2fa/enable'), { code }), isEnabled),
    disable: (password: string, code: string) =>
      ask(() => api.post(at('/2fa/disable'), { password, code }), isDisabled),
    newCodes: (password: string, code: string) =>
      ask(() => api.post(at('/2fa/recovery-codes'), { password, code }), isCodes),
    /** one device, by the handle the list gave it */
    signOut: (sid: string) =>
      ask(() => api.del(at('/sessions/' + encodeURIComponent(sid))), isDone),
    signOutOthers: () => ask(() => api.post(at('/sessions/revoke-others'), {}), isRevoked),
  };
}

export type SecurityCalls = ReturnType<typeof securityCalls>;
