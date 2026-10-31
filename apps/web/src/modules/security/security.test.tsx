import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pwa from '../../lib/pwa';
import { adminMe, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';

vi.mock('../../lib/pwa', async importOriginal => ({
  ...(await importOriginal<typeof pwa>()),
  refreshPush: vi.fn(async () => true),
}));

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
  vi.mocked(pwa.refreshPush).mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const session = (over: Record<string, unknown> = {}) => ({
  sid: 'here-sid',
  device: 'Chrome on Windows',
  ip: '10.0.0.1',
  createdAt: Date.now() - 3 * 3_600_000,
  lastSeenAt: Date.now() - 20_000,
  method: 'password',
  current: true,
  ...over,
});
const login = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-30T10:00:00.000Z',
  event: 'login',
  device: 'Chrome on Windows',
  ip: '10.0.0.1',
  method: 'password',
  new_device: false,
  ...over,
});
const twofa = (over: Record<string, unknown> = {}) => ({
  available: true,
  reason: null,
  enabled: false,
  enabledAt: null,
  recoveryLeft: 0,
  encrypted: true,
  ...over,
});
const overview = (over: Record<string, unknown> = {}) => ({
  account: { kind: 'employee', name: 'Sara', canChangePassword: true },
  twofa: twofa(),
  sessions: [session()],
  logins: [login()],
  history: true,
  alerts: 'new',
  ...over,
});
const adminOverview = (over: Record<string, unknown> = {}) =>
  overview({ account: { kind: 'admin', name: 'Admin', canChangePassword: false }, ...over });

type Calls = Record<string, Answer>;

/** The panel's server, as a little state machine the test can steer: what GET …/security says now, and what each action answers. */
function server(portal: 'admin' | 'team', first: unknown, actions: Calls = {}) {
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  let now: unknown = first;
  const more: Calls = {
    [`${base}/security`]: () => (now instanceof Response ? now : json(200, now)),
    ...Object.fromEntries(
      Object.entries(actions).map(([path, a]) => [`${base}/security${path}`, a]),
    ),
  };
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe({}, 'Sales'), { more });
  return {
    ...s,
    base,
    /** from now on GET …/security answers this */
    become: (next: unknown) => {
      now = next;
    },
    sent: (path: string, method: string) =>
      s.calls(`${base}/security${path}`).filter(c => c.init.method === method),
    body: (path: string, method = 'POST') =>
      JSON.parse(
        String(
          s
            .calls(`${base}/security${path}`)
            .filter(c => c.init.method === method)
            .at(-1)?.init.body,
        ),
      ),
    reads: () => s.calls(`${base}/security`).length,
  };
}

async function openPanel(user: ReturnType<typeof userEvent.setup>, portal: 'admin' | 'team') {
  if (portal === 'team') {
    await user.click(await screen.findByRole('button', { name: 'Your account' }));
    await user.click(screen.getByRole('button', { name: 'Security' }));
  } else {
    await screen.findByText(/Signed in as Admin/);
    await user.click(screen.getByRole('button', { name: 'Security' }));
  }
  return screen.findByRole('dialog', { name: 'Account security' });
}
const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const message = () => part('message')?.textContent ?? null;
const typeInto = async (user: ReturnType<typeof userEvent.setup>, p: string, text: string) =>
  user.type(document.querySelector<HTMLInputElement>(`[data-part=${p}]`)!, text);

describe('the way in', () => {
  it("opens from the team's account menu over the page the person is on, and the menu goes away behind it", async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    const dialog = await openPanel(user, 'team');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(await screen.findByText(/Sara · Protect your account/)).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    // (the page is still there, behind the curtain)
    expect(screen.getByText(/Signed in as Sam/)).toBeTruthy();
  });

  it("opens from the admin's footer, which has no account menu", async () => {
    const user = userEvent.setup({ delay: null });
    server('admin', adminOverview());
    await openPanel(user, 'admin');
    expect(await screen.findByText(/Admin · Protect your account/)).toBeTruthy();
  });

  it("is what '/security' means: the panel opens over the page the person was last on, and the address is that page's again", async () => {
    window.history.replaceState(null, '', '/');
    const s = open('team', teamMe({}, 'Sales'), {
      entries: ['/security'],
      more: { '/api/employee/security': () => json(200, overview()) },
    });
    expect(await screen.findByRole('dialog', { name: 'Account security' })).toBeTruthy();
    expect(await screen.findByText(/Signed in as Sam/)).toBeTruthy();
    expect(s.calls('/api/employee/security').length).toBeGreaterThan(0);
  });
});

describe('what it shows', () => {
  it('says it is loading until the answer comes, then lays out two-factor, the devices and the sign-ins', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    await openPanel(user, 'team');
    expect(await screen.findByText('Two-factor authentication')).toBeTruthy();
    expect(part('twofa')!.textContent).toContain('Off');
    expect(part('turnOn')).toBeTruthy();
    expect(part('here')!.textContent).toBe('This device');
    expect(part('session')!.textContent).toContain('Chrome on Windows');
    expect(part('session')!.textContent).toMatch(
      /10\.0\.0\.1 · signed in 3 h ago · last active just now · Password/,
    );
    expect(part('signOutDevice')).toBeNull();
    expect(part('login')!.textContent).toContain('10.0.0.1 · Password');
    expect(part('signOutOthers')).toBeNull();
  });

  it('gives the team a Password card, and the admin none (the administrator has no password to change here)', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('passwordCard')!.textContent).toContain(
      'Changing it signs out every other device.',
    );
    cleanup();
    server('admin', adminOverview());
    await openPanel(user, 'admin');
    await screen.findByText('Two-factor authentication');
    expect(part('passwordCard')).toBeNull();
  });

  it('says two-factor is on, since when, how many recovery codes are left, and warns at two', async () => {
    const user = userEvent.setup({ delay: null });
    server(
      'team',
      overview({
        twofa: twofa({ enabled: true, enabledAt: '2026-10-01T09:00:00.000Z', recoveryLeft: 2 }),
      }),
    );
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    const card = part('twofa')!;
    expect(card.textContent).toContain('On');
    expect(card.textContent).toMatch(
      /Signing in needs a 6-digit code from your authenticator app · turned on .*Oct/,
    );
    expect(card.textContent).toContain('2 recovery codes left — make new ones soon.');
    expect(part('newCodes')).toBeTruthy();
    expect(part('turnOff')).toBeTruthy();
    expect(part('turnOn')).toBeNull();
  });

  it('counts one recovery code in the singular, and does not nag when there are plenty', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview({ twofa: twofa({ enabled: true, recoveryLeft: 1 }) }));
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('twofa')!.textContent).toContain('1 recovery code left — make new ones soon.');
    cleanup();
    server('team', overview({ twofa: twofa({ enabled: true, recoveryLeft: 8 }) }));
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('twofa')!.textContent).toContain('8 recovery codes left.');
    expect(part('twofa')!.textContent).not.toContain('make new ones soon');
  });

  it('says why two-factor is not available — the migration to apply, or a database that did not answer', async () => {
    const user = userEvent.setup({ delay: null });
    server(
      'team',
      overview({
        twofa: twofa({ available: false, reason: 'migration' }),
        history: false,
        logins: [],
      }),
    );
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('twofa')!.textContent).toContain('Unavailable');
    expect(part('twofa')!.textContent).toContain('migration 023_account_security.sql');
    expect(part('turnOn')).toBeNull();
    expect(part('history')!.textContent).toContain(
      'The sign-in history needs the same database update (migration 023).',
    );
    cleanup();
    server('team', overview({ twofa: twofa({ available: false, reason: 'error' }) }));
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('twofa')!.textContent).toContain(
      'Could not load this right now. Close the panel and try again in a moment.',
    );
  });

  it('warns the admin, and only the admin, that secrets are kept unencrypted until the server has a key', async () => {
    const user = userEvent.setup({ delay: null });
    server('admin', adminOverview({ twofa: twofa({ encrypted: false }) }));
    await openPanel(user, 'admin');
    await screen.findByText('Two-factor authentication');
    expect(part('unencrypted')!.textContent).toContain('MFA_ENCRYPTION_KEY');
    cleanup();
    server('team', overview({ twofa: twofa({ encrypted: false }) }));
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('unencrypted')).toBeNull();
  });

  it('lists the other devices with a Sign out each, and one button for all of them', async () => {
    const user = userEvent.setup({ delay: null });
    server(
      'team',
      overview({
        sessions: [
          session(),
          session({
            sid: 'phone',
            device: 'Safari on iPhone',
            ip: '',
            current: false,
            method: 'google+2fa',
            createdAt: null,
            lastSeenAt: null,
          }),
        ],
      }),
    );
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    const rows = document.querySelectorAll('[data-part=session]');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain('Safari on iPhone');
    expect(rows[1]!.textContent).toContain(
      'unknown address · signed in unknown · last active unknown · Google + code',
    );
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(part('signOutOthers')!.textContent).toBe('Sign out all other devices');
  });

  it('marks the sign-ins from a device not seen before, says what alerts do, and when there are none', async () => {
    const user = userEvent.setup({ delay: null });
    server(
      'team',
      overview({
        logins: [login({ new_device: true, device: null, ip: null, method: 'google+recovery' })],
      }),
    );
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    const row = part('login')!;
    expect(row.textContent).toContain('Unknown device');
    expect(row.textContent).toContain('New device');
    expect(row.textContent).toContain('unknown address · Google + recovery code');
    expect(part('history')!.textContent).toContain(
      "You are alerted when someone signs in from a device you haven't used before.",
    );
    cleanup();
    server('team', overview({ logins: [], alerts: 'off' }));
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    expect(part('history')!.textContent).toContain('Alerts are off.');
    expect(part('history')!.textContent).toContain('Nothing recorded yet.');
  });

  it("says why when it could not be loaded — and nothing at all when the answer was a 401, which is the app's to act on", async () => {
    const user = userEvent.setup({ delay: null });
    const s = server('team', overview());
    s.become(json(500, { error: 'Something went wrong. Try again.' }));
    await openPanel(user, 'team');
    await waitFor(() => expect(message()).toBe('Something went wrong. Try again.'));
    cleanup();
    const t = server('team', overview());
    t.become(json(401, { error: 'Unauthorized' }));
    await openPanel(user, 'team');
    await waitFor(() => expect(t.reads()).toBeGreaterThan(0));
    expect(message()).toBeNull();
  });
});

describe('turning two-factor on', () => {
  const setup = {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauth: 'otpauth://totp/MotoLinker:sara?secret=JBSWY3DPEHPK3PXP',
    qr: 'data:image/png;base64,AAAA',
  };
  const codes = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff'];

  async function toScan(user: ReturnType<typeof userEvent.setup>, actions: Calls = {}) {
    const s = server('team', overview(), {
      '/2fa/setup': () => json(200, setup),
      '/2fa/enable': () => json(200, { ok: true, recoveryCodes: codes, sessionsRevoked: 2 }),
      ...actions,
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await typeInto(user, 'password', 'sara-password-1');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Scan this with your authenticator app');
    return s;
  }

  it('asks for the password first, and focuses the field', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(screen.getByText('Turn on two-factor authentication')).toBeTruthy();
    expect(screen.getByText(/First, confirm your password\./)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(part('password')));
    expect(part('password')!.getAttribute('type')).toBe('password');
    expect(part('password')!.getAttribute('autocomplete')).toBe('current-password');
  });

  it('says so when no password was typed, and does not ask the server', async () => {
    const user = userEvent.setup({ delay: null });
    const s = server('team', overview(), { '/2fa/setup': () => json(200, setup) });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(message()).toBe('Enter your password.');
    expect(s.sent('/2fa/setup', 'POST')).toHaveLength(0);
  });

  it("shows what the server refused a wrong password with, in the server's words, and stays on the form", async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview(), {
      '/2fa/setup': () => json(403, { error: 'That password is not right.' }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await typeInto(user, 'password', 'nope');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(message()).toBe('That password is not right.'));
    expect(part('password')).toBeTruthy();
    expect(part('go')!.textContent).toBe('Continue');
    expect((part('go') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the picture to scan, the key to type by hand in groups of four, and a link for the phone', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await toScan(user);
    expect(s.body('/2fa/setup')).toEqual({ password: 'sara-password-1' });
    expect(document.querySelector<HTMLImageElement>('[data-part=qr] img')!.src).toBe(setup.qr);
    expect(document.querySelector('[data-part=qr] img')!.getAttribute('alt')).toBe(
      'QR code to scan with your authenticator app',
    );
    expect(part('key')!.textContent).toBe('JBSW Y3DP EHPK 3PXP');
    expect(
      screen.getByRole('link', { name: 'Open in your authenticator app' }).getAttribute('href'),
    ).toBe(setup.otpauth);
    await waitFor(() => expect(document.activeElement).toBe(part('code')));
  });

  it('wants six digits (typed with a space or not) and says so, without asking the server', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await toScan(user);
    await typeInto(user, 'code', '12345');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(message()).toBe('Enter the 6-digit code from your app.');
    expect(s.sent('/2fa/enable', 'POST')).toHaveLength(0);
    await typeInto(user, 'code', '6');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await screen.findByText('Save your recovery codes');
    expect(s.body('/2fa/enable')).toEqual({ code: '123456' });
  });

  it('shows the codes once with the other devices that were signed out, holds Done until they are saved, then shows the new state', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await toScan(user);
    await typeInto(user, 'code', '123 456');
    s.become(
      overview({
        twofa: twofa({ enabled: true, enabledAt: new Date().toISOString(), recoveryLeft: 3 }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await screen.findByText('Save your recovery codes');
    expect(
      [...document.querySelectorAll('[data-part=codes] code')].map(c => c.textContent),
    ).toEqual(codes);
    expect(screen.getByText('2 other devices were signed out.')).toBeTruthy();
    const done = part('go') as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(part('saved')));
    await user.click(part('saved')!);
    expect(done.disabled).toBe(false);
    const before = s.reads();
    await user.click(done);
    await waitFor(() => expect(part('twofa')!.textContent).toContain('On'));
    expect(s.reads()).toBe(before + 1);
    expect(part('twofa')!.textContent).toContain('3 recovery codes left');
  });

  it('shows a code the server did not accept, in its words, and keeps the scan', async () => {
    const user = userEvent.setup({ delay: null });
    await toScan(user, {
      '/2fa/enable': () =>
        json(403, {
          error: "That code is not right. Check your phone's clock and try the next one.",
        }),
    });
    await typeInto(user, 'code', '000000');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(message()).toMatch(/That code is not right/));
    expect(part('key')).toBeTruthy();
  });

  it("tells the server again about this device's push subscription (it clears them with the sessions it signs out), and says nothing of it", async () => {
    const user = userEvent.setup({ delay: null });
    await toScan(user);
    const before = vi.mocked(pwa.refreshPush).mock.calls.length;
    await typeInto(user, 'code', '123456');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await screen.findByText('Save your recovery codes');
    expect(vi.mocked(pwa.refreshPush).mock.calls.length).toBe(before + 1);
  });

  it('puts the setup away on Cancel: back to the overview, nothing said', async () => {
    const user = userEvent.setup({ delay: null });
    await toScan(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(part('turnOn')).toBeTruthy();
    expect(part('key')).toBeNull();
    expect(message()).toBeNull();
  });

  it('holds the button while the server thinks, with what it is doing on it', async () => {
    const user = userEvent.setup({ delay: null });
    let finish: (r: Response) => void = () => undefined;
    server('team', overview(), {
      '/2fa/setup': () => new Promise<Response>(r => (finish = r)),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await typeInto(user, 'password', 'pw');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(part('go')!.textContent).toBe('Checking…'));
    expect((part('go') as HTMLButtonElement).disabled).toBe(true);
    finish(json(200, setup));
    await screen.findByText('Scan this with your authenticator app');
  });
});

describe('turning it off, and new recovery codes', () => {
  const on = () =>
    overview({
      twofa: twofa({ enabled: true, enabledAt: '2026-10-01T09:00:00.000Z', recoveryLeft: 5 }),
    });

  it('needs the password and a code, says so otherwise, and says it is off — with the other devices gone — when it is', async () => {
    const user = userEvent.setup({ delay: null });
    const s = server('team', on(), {
      '/2fa/disable': () => json(200, { ok: true, sessionsRevoked: 1 }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(screen.getByText('Turn off two-factor authentication')).toBeTruthy();
    expect(screen.getByText('Code from your app (or a recovery code)')).toBeTruthy();
    await user.click(part('go')!);
    expect(message()).toBe('Enter your password and a code.');
    await typeInto(user, 'password', 'pw');
    await user.click(part('go')!);
    expect(message()).toBe('Enter your password and a code.');
    await typeInto(user, 'code', 'abcde-12345');
    s.become(overview());
    const before = vi.mocked(pwa.refreshPush).mock.calls.length;
    await user.click(part('go')!);
    await waitFor(() =>
      expect(message()).toBe(
        'Two-factor authentication is off. Your other devices were signed out.',
      ),
    );
    expect(s.body('/2fa/disable')).toEqual({ password: 'pw', code: 'abcde-12345' });
    expect(part('twofa')!.textContent).toContain('Off');
    expect(vi.mocked(pwa.refreshPush).mock.calls.length).toBe(before + 1);
  });

  it('moves from the password field to the code field on Enter, and submits from the code field', async () => {
    const user = userEvent.setup({ delay: null });
    const s = server('team', on(), {
      '/2fa/disable': () => json(200, { ok: true, sessionsRevoked: 0 }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    await typeInto(user, 'password', 'pw{Enter}');
    expect(document.activeElement).toBe(part('code'));
    await typeInto(user, 'code', '123456{Enter}');
    await waitFor(() => expect(s.sent('/2fa/disable', 'POST')).toHaveLength(1));
  });

  it('keeps it on, and says why, when the server will not turn it off', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', on(), { '/2fa/disable': () => json(403, { error: 'That code is not right.' }) });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    await typeInto(user, 'password', 'pw');
    await typeInto(user, 'code', '000000');
    await user.click(part('go')!);
    await waitFor(() => expect(message()).toBe('That code is not right.'));
    expect(screen.getByText('Turn off two-factor authentication')).toBeTruthy();
  });

  it('makes new recovery codes with the password and six digits, shows them, and the old ones are said to be gone', async () => {
    const user = userEvent.setup({ delay: null });
    const s = server('team', on(), {
      '/2fa/recovery-codes': () =>
        json(200, { ok: true, recoveryCodes: ['11111-22222', '33333-44444'] }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'New recovery codes' }));
    expect(screen.getByText('The old codes stop working.')).toBeTruthy();
    await user.click(part('go')!);
    expect(message()).toBe('Enter your password and the 6-digit code.');
    await typeInto(user, 'password', 'pw');
    await typeInto(user, 'code', '12345');
    await user.click(part('go')!);
    expect(message()).toBe('Enter your password and the 6-digit code.');
    await typeInto(user, 'code', '6');
    await user.click(part('go')!);
    await screen.findByText('Save your recovery codes');
    expect(s.body('/2fa/recovery-codes')).toEqual({ password: 'pw', code: '123456' });
    expect(
      [...document.querySelectorAll('[data-part=codes] code')].map(c => c.textContent),
    ).toEqual(['11111-22222', '33333-44444']);
    expect(screen.queryByText(/other devices? w(as|ere) signed out/)).toBeNull();
  });
});

describe('the recovery codes', () => {
  async function showCodes(user: ReturnType<typeof userEvent.setup>) {
    server('team', overview({ twofa: twofa({ enabled: true, recoveryLeft: 5 }) }), {
      '/2fa/recovery-codes': () =>
        json(200, { ok: true, recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'] }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'New recovery codes' }));
    await typeInto(user, 'password', 'pw');
    await typeInto(user, 'code', '123456');
    await user.click(part('go')!);
    await screen.findByText('Save your recovery codes');
  }

  it('copies them, with whose they are and that each works once — and says so', async () => {
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await showCodes(user);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(message()).toBe('Copied.'));
    const text = String(writeText.mock.calls[0]![0]);
    expect(text).toContain('MotoLinker recovery codes for Sara');
    expect(text).toContain('Each code works once.');
    expect(text).toContain('aaaaa-bbbbb\nccccc-ddddd');
  });

  it('copies by hand where the clipboard is not offered, and says when even that is not possible', async () => {
    const user = userEvent.setup({ delay: null });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await showCodes(user);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(message()).toBe('Copied.'));
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    exec.mockImplementation(() => {
      throw new Error('no');
    });
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(message()).toBe('Could not copy — select the codes and copy them by hand.'),
    );
  });

  it('downloads them as a text file', async () => {
    const user = userEvent.setup({ delay: null });
    const made: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      value: (b: Blob) => (made.push(b), 'blob:codes'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('motolinker-recovery-codes.txt');
    });
    await showCodes(user);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(click).toHaveBeenCalled();
    expect(made).toHaveLength(1);
    expect(made[0]!.type).toBe('text/plain');
    expect(await made[0]!.text()).toContain('ccccc-ddddd');
  });
});

describe('the devices', () => {
  const two = () =>
    overview({
      sessions: [
        session(),
        session({ sid: 'phone/1', device: 'Safari on iPhone', current: false }),
      ],
    });

  it('signs one out by its handle (encoded), asks again for the list, and says so', async () => {
    const user = userEvent.setup({ delay: null });
    const s = server('team', two(), { '/sessions/phone%2F1': () => json(200, { ok: true }) });
    await openPanel(user, 'team');
    await screen.findByText('Safari on iPhone');
    s.become(overview());
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(message()).toBe('Signed out. If you did not recognise it, also change your password.'),
    );
    expect(s.sent('/sessions/phone%2F1', 'DELETE')).toHaveLength(1);
    expect(screen.queryByText('Safari on iPhone')).toBeNull();
  });

  it('says when it could not, after asking again — the failure is not wiped by the reload', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', two(), {
      '/sessions/phone%2F1': () => json(404, { error: 'That session is already gone.' }),
    });
    await openPanel(user, 'team');
    await screen.findByText('Safari on iPhone');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(message()).toBe('That session is already gone.'));
  });

  it('asks before signing out every other device, and does nothing if the answer is no', async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const s = server('team', two(), {
      '/sessions/revoke-others': () => json(200, { ok: true, sessionsRevoked: 1 }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
    expect(confirm).toHaveBeenCalledWith(
      'Sign out every other device? They will need to sign in again.',
    );
    expect(s.sent('/sessions/revoke-others', 'POST')).toHaveLength(0);
  });

  it("signs them all out, counts them, and tells the server about this device's push subscription again", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const s = server('team', two(), {
      '/sessions/revoke-others': () => json(200, { ok: true, sessionsRevoked: 1 }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
    s.become(overview());
    const before = vi.mocked(pwa.refreshPush).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Sign out all other devices' }));
    await waitFor(() => expect(message()).toBe('Signed out 1 other device.'));
    expect(vi.mocked(pwa.refreshPush).mock.calls.length).toBe(before + 1);
    expect(part('signOutOthers')).toBeNull();
  });

  it('does not call it a success when the server could not save the sign-outs: it says what the server said', async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server('team', two(), {
      '/sessions/revoke-others': () =>
        json(200, {
          ok: false,
          sessionsRevoked: 1,
          warning: 'Some sign-outs could not be saved. Try again.',
        }),
    });
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
    await waitFor(() => expect(message()).toBe('Some sign-outs could not be saved. Try again.'));
    expect(part('message')!.getAttribute('data-kind')).toBe('err');
  });
});

describe('putting it away', () => {
  it('closes on Escape, on ×, and on a press on the curtain — and not on a press inside the panel', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    await openPanel(user, 'team');
    await screen.findByText('Two-factor authentication');
    await user.pointer({ keys: '[MouseLeft>]', target: part('title')! });
    await user.pointer({ keys: '[/MouseLeft]' });
    expect(part('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(part('dialog')).toBeNull();

    await openPanel(user, 'team');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(part('dialog')).toBeNull();

    await openPanel(user, 'team');
    await user.pointer({ keys: '[MouseLeft>]', target: part('curtain')! });
    expect(part('dialog')).toBeNull();
  });

  it('is opened afresh each time: a form half-way through is not there when it comes back', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(part('password')).toBeTruthy();
    await user.keyboard('{Escape}');
    await openPanel(user, 'team');
    expect(await screen.findByText('Two-factor authentication')).toBeTruthy();
    expect(part('password')).toBeNull();
  });

  it('hands over to the password dialog from its Change password button, putting itself away first', async () => {
    const user = userEvent.setup({ delay: null });
    server('team', overview());
    await openPanel(user, 'team');
    await user.click(await screen.findByRole('button', { name: 'Change password' }));
    expect(screen.queryByRole('dialog', { name: 'Account security' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Change Password' })).toBeTruthy();
  });
});
