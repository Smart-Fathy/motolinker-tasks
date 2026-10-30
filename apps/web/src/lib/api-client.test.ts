import { describe, expect, it, vi } from 'vitest';
import { ApiError, makeApi, portalBase } from './api';
import { makeQueryClient, worthRetrying } from './query';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(respond: () => Response | Promise<Response>, portal: 'admin' | 'team' = 'admin') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
  const onUnauthorized = vi.fn();
  return {
    api: makeApi({ portal, token: 'tok', onUnauthorized, fetchImpl }),
    calls,
    onUnauthorized,
  };
}

describe('makeApi', () => {
  it('asks as the person and reads the answer', async () => {
    const { api, calls } = setup(() => json({ a: 1 }));
    await expect(api.get('/api/v1/thing')).resolves.toEqual({ a: 1 });
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'application/json',
    });
    expect(calls[0]?.init.body).toBeNull();
  });

  it('sends what it is given as JSON, and says so', async () => {
    const { api, calls } = setup(() => json({ ok: true }));
    await api.put('/api/x/ui-prefs', { mode: 'light' });
    await api.post('/api/x/read');
    await api.del('/api/x/1');
    expect(calls.map(c => c.init.method)).toEqual(['PUT', 'POST', 'DELETE']);
    expect(calls[0]?.init.body).toBe('{"mode":"light"}');
    expect((calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(calls[1]?.init.body).toBe('{}');
    expect(calls[2]?.init.body).toBeNull();
    expect((calls[2]?.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('is not troubled by an answer with nothing in it', async () => {
    const { api } = setup(() => new Response(null, { status: 204 }));
    await expect(api.del('/api/x/1')).resolves.toBeUndefined();
  });

  it("carries the server's own words when it says no", async () => {
    const { api } = setup(() => json({ error: 'You cannot do that.', code: 'forbidden' }, 403));
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 403,
      message: 'You cannot do that.',
      code: 'forbidden',
    });
  });

  it('has words of its own when the server had none, or could not be read', async () => {
    const a = setup(() => new Response('<html>oops</html>', { status: 502 }));
    await expect(a.api.get('/x')).rejects.toMatchObject({
      status: 502,
      message: 'The server answered with an error (502).',
    });
    const b = setup(() => json({ error: '' }, 500));
    await expect(b.api.get('/x')).rejects.toMatchObject({
      status: 500,
      message: 'The server answered with an error (500).',
    });
  });

  it('reports a 401 to whoever owns the session, and still throws it — a route can refuse for its own reasons', async () => {
    const { api, onUnauthorized } = setup(() => json({ error: 'Unauthorized' }, 401));
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not call any other refusal a sign-out', async () => {
    for (const status of [400, 403, 404, 429, 500, 503]) {
      const { api, onUnauthorized } = setup(() => json({ error: 'no' }, status));
      await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
      expect(onUnauthorized).not.toHaveBeenCalled();
    }
  });

  it('says so when the server cannot be reached, as status 0, and does not report it as unauthorized', async () => {
    const { api, onUnauthorized } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 0,
      message: 'Cannot reach the server. Check the connection and try again.',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('lets a cancelled call be cancelled, rather than calling it a network failure', async () => {
    const { api } = setup(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(api.get('/x')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it("names each portal's own routes", () => {
    expect(portalBase('admin')).toBe('/api/dashboard');
    expect(portalBase('team')).toBe('/api/employee');
    expect(setup(() => json({}), 'team').api.base).toBe('/api/employee');
  });
});

describe('the query client', () => {
  it('asks again, twice at most, when the server could not be reached or fell over', () => {
    expect(worthRetrying(0, new ApiError(0, 'x'))).toBe(true);
    expect(worthRetrying(1, new ApiError(503, 'x'))).toBe(true);
    expect(worthRetrying(2, new ApiError(503, 'x'))).toBe(false);
  });

  it('does not ask again when the answer was no', () => {
    for (const status of [400, 401, 403, 404, 409, 429])
      expect(worthRetrying(0, new ApiError(status, 'x'))).toBe(false);
  });

  it('asks again about trouble it does not recognise, a couple of times', () => {
    expect(worthRetrying(0, new Error('x'))).toBe(true);
    expect(worthRetrying(2, new Error('x'))).toBe(false);
  });

  it("is a new client each time, so one session's data cannot show to the next", () => {
    expect(makeQueryClient()).not.toBe(makeQueryClient());
    const c = makeQueryClient();
    expect(c.getDefaultOptions().queries?.retry).toBe(worthRetrying);
    expect(c.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
