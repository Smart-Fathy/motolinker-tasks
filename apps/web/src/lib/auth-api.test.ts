import { describe, expect, it } from 'vitest';
import { makeAuthApi } from './auth-api';

interface Call {
  path: string;
  init: RequestInit;
  body: unknown;
}

/** A fetch that answers from a script, in order, and remembers what it was asked. */
function scripted(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      path: String(input),
      init,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = (status: number) =>
  new Response('<html><body>Bad gateway</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
const down = () => new TypeError('Failed to fetch');

describe('signing in with a password', () => {
  it('asks the admin route for the admin portal and the employee route for the team portal', async () => {
    const a = scripted(json(200, { token: 't' }));
    await makeAuthApi('admin', a.fetchImpl).signIn('boss', 'pw');
    expect(a.calls[0]?.path).toBe('/api/auth/login');
    const t = scripted(json(200, { token: 't' }));
    await makeAuthApi('team', t.fetchImpl).signIn('sara', 'pw');
    expect(t.calls[0]?.path).toBe('/api/employee/login');
  });

  it('sends the username and password as JSON, by POST, and nothing else', async () => {
    const s = scripted(json(200, { token: 't' }));
    await makeAuthApi('team', s.fetchImpl).signIn('sara', 'p w');
    const call = s.calls[0]!;
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ username: 'sara', password: 'p w' });
    expect(new Headers(call.init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(call.init.headers).has('authorization')).toBe(false);
  });

  it('is signed in when the server hands over a session', async () => {
    const s = scripted(json(200, { token: 'abc', username: 'boss' }));
    expect(await makeAuthApi('admin', s.fetchImpl).signIn('boss', 'pw')).toEqual({
      kind: 'signed-in',
      token: 'abc',
    });
  });

  it('has a challenge to answer, and no session, when the account has a second step', async () => {
    const s = scripted(json(200, { mfa_required: true, mfa_token: 'challenge', name: 'Sara' }));
    expect(await makeAuthApi('team', s.fetchImpl).signIn('sara', 'pw')).toEqual({
      kind: 'code-needed',
      mfaToken: 'challenge',
    });
  });

  it('has a challenge only when the server says so: a stray mfa_token beside a session is not one', async () => {
    const s = scripted(json(200, { token: 'abc', mfa_token: 'stray' }));
    expect(await makeAuthApi('team', s.fetchImpl).signIn('sara', 'pw')).toEqual({
      kind: 'signed-in',
      token: 'abc',
    });
  });

  it('is never signed in on an answer that contradicts itself', async () => {
    // a session AND a challenge, or a challenge with nothing to answer it with: not something to sign in on
    for (const body of [
      { token: 'abc', mfa_required: true },
      { mfa_required: true },
      { mfa_required: true, mfa_token: '' },
      { token: '' },
      {},
    ]) {
      const r = await makeAuthApi('team', scripted(json(200, body)).fetchImpl).signIn('s', 'p');
      expect(r.kind, JSON.stringify(body)).toBe('failed');
    }
  });

  it('shows the server’s own words for a refusal, whatever the portal', async () => {
    const wrong = await makeAuthApi(
      'admin',
      scripted(json(401, { error: 'Invalid username or password' })).fetchImpl,
    ).signIn('boss', 'nope');
    expect(wrong).toEqual({ kind: 'failed', status: 401, message: 'Invalid username or password' });

    const limited = await makeAuthApi(
      'team',
      scripted(json(429, { error: 'Too many attempts. Try again in 30 seconds.', retryAfter: 30 }))
        .fetchImpl,
    ).signIn('sara', 'nope');
    expect(limited).toMatchObject({
      kind: 'failed',
      status: 429,
      message: expect.stringContaining('30 seconds'),
    });

    const unavailable = await makeAuthApi(
      'team',
      scripted(
        json(503, { error: 'Could not check your sign-in right now. Try again in a moment.' }),
      ).fetchImpl,
    ).signIn('sara', 'pw');
    expect(unavailable).toMatchObject({
      kind: 'failed',
      status: 503,
      message: expect.stringContaining('right now'),
    });
  });

  it('says something plain when the server says nothing readable', async () => {
    const gateway = await makeAuthApi('team', scripted(html(502)).fetchImpl).signIn('s', 'p');
    expect(gateway).toEqual({
      kind: 'failed',
      status: 502,
      message: 'The server could not answer just now. Try again in a moment.',
    });
    const limited = await makeAuthApi('team', scripted(json(429, {})).fetchImpl).signIn('s', 'p');
    expect(limited).toMatchObject({
      kind: 'failed',
      message: 'Too many attempts. Try again in a moment.',
    });
    const bare = await makeAuthApi('team', scripted(json(400, {})).fetchImpl).signIn('s', 'p');
    expect(bare).toMatchObject({ kind: 'failed', status: 400, message: 'Could not sign in.' });
    const blank = await makeAuthApi('team', scripted(json(401, { error: '  ' })).fetchImpl).signIn(
      's',
      'p',
    );
    expect(blank).toMatchObject({ kind: 'failed', message: 'Could not sign in.' });
  });

  it('is not a thrown error when the server cannot be reached', async () => {
    expect(await makeAuthApi('team', scripted(down()).fetchImpl).signIn('s', 'p')).toEqual({
      kind: 'network',
    });
  });
});

describe('answering the second step', () => {
  it('sends the challenge and the code to the portal’s own route', async () => {
    const a = scripted(json(200, { token: 't' }));
    await makeAuthApi('admin', a.fetchImpl).verifyCode('challenge', '123456');
    expect(a.calls[0]?.path).toBe('/api/auth/login/2fa');
    expect(a.calls[0]?.body).toEqual({ mfa_token: 'challenge', code: '123456' });
    const t = scripted(json(200, { token: 't' }));
    await makeAuthApi('team', t.fetchImpl).verifyCode('challenge', 'abcde-fghij');
    expect(t.calls[0]?.path).toBe('/api/employee/login/2fa');
    expect(t.calls[0]?.body).toEqual({ mfa_token: 'challenge', code: 'abcde-fghij' });
  });

  it('is signed in on the session the server hands over', async () => {
    const s = scripted(json(200, { token: 'abc', name: 'Sara' }));
    expect(await makeAuthApi('team', s.fetchImpl).verifyCode('c', '1')).toEqual({
      kind: 'signed-in',
      token: 'abc',
    });
  });

  it('knows when the challenge is gone, and says what the server said', async () => {
    const gone = await makeAuthApi(
      'team',
      scripted(
        json(401, { error: 'Your sign-in expired. Enter your password again.', expired: true }),
      ).fetchImpl,
    ).verifyCode('c', '1');
    expect(gone).toEqual({
      kind: 'expired',
      message: 'Your sign-in expired. Enter your password again.',
    });
    const bare = await makeAuthApi(
      'team',
      scripted(json(401, { expired: true })).fetchImpl,
    ).verifyCode('c', '1');
    expect(bare).toEqual({
      kind: 'expired',
      message: 'Your sign-in expired. Enter your password again.',
    });
  });

  it('stays on the step for a wrong code, a rate limit, or a database that cannot check', async () => {
    const wrong = await makeAuthApi(
      'team',
      scripted(json(401, { error: 'That code is not right.', attemptsLeft: 3 })).fetchImpl,
    ).verifyCode('c', '000000');
    expect(wrong).toEqual({ kind: 'failed', status: 401, message: 'That code is not right.' });
    const limited = await makeAuthApi(
      'admin',
      scripted(json(429, { error: 'One moment — still checking the last code.' })).fetchImpl,
    ).verifyCode('c', '1');
    expect(limited).toMatchObject({ kind: 'failed', status: 429 });
    const unavailable = await makeAuthApi(
      'admin',
      scripted(json(503, { error: 'Could not check the code right now.' })).fetchImpl,
    ).verifyCode('c', '1');
    expect(unavailable).toMatchObject({ kind: 'failed', status: 503 });
    const nothing = await makeAuthApi('admin', scripted(json(400, {})).fetchImpl).verifyCode(
      'c',
      '1',
    );
    expect(nothing).toMatchObject({ kind: 'failed', message: 'That code did not work.' });
  });

  it('is not a session on a 200 with no token, or a token on an error', async () => {
    expect(
      (await makeAuthApi('team', scripted(json(200, {})).fetchImpl).verifyCode('c', '1')).kind,
    ).toBe('failed');
    expect(
      (
        await makeAuthApi('team', scripted(json(401, { token: 'abc' })).fetchImpl).verifyCode(
          'c',
          '1',
        )
      ).kind,
    ).toBe('failed');
  });

  it('is not a thrown error when the server cannot be reached', async () => {
    expect(await makeAuthApi('team', scripted(down()).fetchImpl).verifyCode('c', '1')).toEqual({
      kind: 'network',
    });
  });
});

describe('the team portal’s password reset', () => {
  it('asks for a link by email, and is done when the server accepts (whether or not the address is known)', async () => {
    const s = scripted(json(200, { ok: true }));
    expect(await makeAuthApi('team', s.fetchImpl).forgotPassword('sara@example.com')).toEqual({
      kind: 'done',
    });
    expect(s.calls[0]?.path).toBe('/api/employee/forgot-password');
    expect(s.calls[0]?.body).toEqual({ email: 'sara@example.com' });
  });

  it('shows what the server refuses with', async () => {
    const r = await makeAuthApi(
      'team',
      scripted(json(503, { error: 'Email service not configured. Contact your admin.' })).fetchImpl,
    ).forgotPassword('a@b.c');
    expect(r).toEqual({
      kind: 'failed',
      status: 503,
      message: 'Email service not configured. Contact your admin.',
    });
    expect(await makeAuthApi('team', scripted(down()).fetchImpl).forgotPassword('a@b.c')).toEqual({
      kind: 'network',
    });
  });

  it('sets a new password with the token from the email', async () => {
    const s = scripted(json(200, { ok: true, sessionsRevoked: 2 }));
    expect(await makeAuthApi('team', s.fetchImpl).resetPassword('tok', 'a-new-password')).toEqual({
      kind: 'done',
    });
    expect(s.calls[0]?.path).toBe('/api/employee/reset-password');
    expect(s.calls[0]?.body).toEqual({ token: 'tok', newPassword: 'a-new-password' });
  });

  it('shows what the server refuses with (a used or expired link, a short password)', async () => {
    const r = await makeAuthApi(
      'team',
      scripted(json(400, { error: 'Invalid or expired reset link' })).fetchImpl,
    ).resetPassword('tok', 'a-new-password');
    expect(r).toEqual({ kind: 'failed', status: 400, message: 'Invalid or expired reset link' });
  });
});

describe('signing out', () => {
  it('tells the server which session is ending, on the portal’s own route', async () => {
    const a = scripted(json(200, { ok: true }));
    await makeAuthApi('admin', a.fetchImpl).signOut('tok-a');
    expect(a.calls[0]?.path).toBe('/api/auth/logout');
    expect(new Headers(a.calls[0]?.init.headers).get('authorization')).toBe('Bearer tok-a');
    const t = scripted(json(200, { ok: true }));
    await makeAuthApi('team', t.fetchImpl).signOut('tok-t');
    expect(t.calls[0]?.path).toBe('/api/employee/logout');
    expect(new Headers(t.calls[0]?.init.headers).get('authorization')).toBe('Bearer tok-t');
  });

  it('never fails: a server that will not answer does not keep a person from leaving', async () => {
    await expect(
      makeAuthApi('team', scripted(down()).fetchImpl).signOut('t'),
    ).resolves.toBeUndefined();
    await expect(
      makeAuthApi('team', scripted(html(502)).fetchImpl).signOut('t'),
    ).resolves.toBeUndefined();
  });
});
