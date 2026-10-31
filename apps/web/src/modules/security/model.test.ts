import contracts from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import {
  isCodes,
  isDisabled,
  isDone,
  isEnabled,
  isOverview,
  isRevoked,
  isSetup,
  ago,
  codesText,
  groups4,
  methodLabel,
  othersSignedOut,
  signedOutLine,
  sixDigits,
  stamp,
} from './model';
import {
  isAvatarResult,
  isPasswordResult,
  isStatusResult,
  isUsernameResult,
  passwordDone,
  passwordProblem,
} from './account';

const S = contracts.schemas;

const session = (over: Record<string, unknown> = {}) => ({
  sid: 'abc123',
  device: 'Chrome on Windows',
  ip: '10.0.0.1',
  createdAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
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
const overview = (over: Record<string, unknown> = {}) => ({
  account: { kind: 'employee', name: 'Sara', canChangePassword: true },
  twofa: {
    available: true,
    reason: null,
    enabled: false,
    enabledAt: null,
    recoveryLeft: 0,
    encrypted: true,
  },
  sessions: [session()],
  logins: [login()],
  history: true,
  alerts: 'new',
  ...over,
});

describe('the answers the Security panel accepts', () => {
  // The bundle does not carry zod; these tables are what keep each hand-written check honest against the schema.
  const cases: Array<[string, unknown]> = [
    ['an employee overview', overview()],
    [
      'an admin overview',
      overview({ account: { kind: 'admin', name: 'Admin', canChangePassword: false } }),
    ],
    [
      'two-factor on, with when',
      overview({
        twofa: {
          available: true,
          reason: null,
          enabled: true,
          enabledAt: '2026-10-01T09:00:00.000Z',
          recoveryLeft: 3,
          encrypted: false,
        },
      }),
    ],
    [
      'two-factor not available (the migration)',
      overview({
        twofa: {
          available: false,
          reason: 'migration',
          enabled: false,
          enabledAt: null,
          recoveryLeft: 0,
          encrypted: true,
        },
      }),
    ],
    ['no history', overview({ history: false, logins: [] })],
    ['alerts off', overview({ alerts: 'off' })],
    ['alerts for every sign-in', overview({ alerts: 'all' })],
    [
      'a session with no times',
      overview({ sessions: [session({ createdAt: null, lastSeenAt: null })] }),
    ],
    [
      'a sign-in the browser said nothing about',
      overview({ logins: [login({ device: null, ip: null, method: null })] }),
    ],
    ['nothing', undefined],
    ['null', null],
    ['an array', []],
    ['no account', overview({ account: undefined })],
    [
      'an unknown kind of account',
      overview({ account: { kind: 'root', name: 'X', canChangePassword: true } }),
    ],
    [
      'an account without a name',
      overview({ account: { kind: 'admin', canChangePassword: false } }),
    ],
    ['no two-factor section', overview({ twofa: undefined })],
    [
      'a reason that is not one of the two',
      overview({
        twofa: {
          available: false,
          reason: 'sunspots',
          enabled: false,
          enabledAt: null,
          recoveryLeft: 0,
          encrypted: true,
        },
      }),
    ],
    [
      'recovery codes left that are not a count',
      overview({
        twofa: {
          available: true,
          reason: null,
          enabled: true,
          enabledAt: null,
          recoveryLeft: -1,
          encrypted: true,
        },
      }),
    ],
    ['sessions that are not a list', overview({ sessions: 'many' })],
    ['a session with no handle', overview({ sessions: [session({ sid: undefined })] })],
    ['a session that is not current or not', overview({ sessions: [session({ current: 'yes' })] })],
    ['a sign-in with no time', overview({ logins: [login({ at: undefined })] })],
    ['a sign-in that is not new or not', overview({ logins: [login({ new_device: null })] })],
    ['history that is not true or false', overview({ history: 'yes' })],
    ['alerts of a kind nobody knows', overview({ alerts: 'sometimes' })],
  ];
  it.each(cases)('agrees with the schema in packages/contracts about %s', (_label, payload) => {
    expect(isOverview(payload)).toBe(S.SecurityOverview.safeParse(payload).success);
  });

  it('agrees about the rest of the answers too', () => {
    const rest: Array<
      [(v: unknown) => boolean, { safeParse: (v: unknown) => { success: boolean } }, unknown[]]
    > = [
      [
        isSetup,
        S.SecuritySetup,
        [{ secret: 'A', otpauth: 'otpauth://x', qr: 'data:' }, { secret: 'A' }, null, 3],
      ],
      [
        isEnabled,
        S.SecurityEnabled,
        [
          { ok: true, recoveryCodes: ['a-b'], sessionsRevoked: 2 },
          { ok: true, recoveryCodes: ['a-b'] },
          { ok: false, recoveryCodes: [], sessionsRevoked: 0 },
          { ok: true, recoveryCodes: [1], sessionsRevoked: 0 },
        ],
      ],
      [
        isDisabled,
        S.SecurityDisabled,
        [
          { ok: true, sessionsRevoked: 0 },
          { ok: true },
          { ok: false, sessionsRevoked: 1 },
          { sessionsRevoked: 1 },
        ],
      ],
      [
        isCodes,
        S.SecurityNewCodes,
        [
          { ok: true, recoveryCodes: ['a', 'b'] },
          { ok: true },
          { recoveryCodes: [] },
          { ok: true, recoveryCodes: 'a' },
        ],
      ],
      [
        isRevoked,
        S.SecurityRevoked,
        [
          { ok: true, sessionsRevoked: 1 },
          { ok: false, sessionsRevoked: 0, warning: 'Some sign-outs could not be saved.' },
          { ok: true, sessionsRevoked: 'one' },
          { ok: true, sessionsRevoked: 1, warning: 7 },
        ],
      ],
      [
        isStatusResult,
        S.StatusResult,
        [{ status_text: 'Focusing', status_emoji: '📚' }, { status_text: 'x' }, null],
      ],
      [isAvatarResult, S.AvatarResult, [{ avatar_url: 'https://x/y.png' }, {}, { avatar_url: 3 }]],
      [
        isUsernameResult,
        S.UsernameResult,
        [{ ok: true, username: 'sara' }, { ok: true }, { username: 'sara' }],
      ],
      [
        isPasswordResult,
        S.ChangePasswordResult,
        [
          { ok: true, sessionsRevoked: 2 },
          { ok: true, sessionsRevoked: 0, warning: 'we could not sign your other devices out' },
          { ok: true },
          { ok: false, sessionsRevoked: 1 },
        ],
      ],
    ];
    for (const [guard, schema, payloads] of rest)
      for (const payload of payloads)
        expect(guard(payload), JSON.stringify(payload)).toBe(schema.safeParse(payload).success);
    // (the sign-out of one device has no schema of its own: it is { ok: true })
    expect(isDone({ ok: true })).toBe(true);
    expect(isDone({ ok: false })).toBe(false);
    expect(isDone({})).toBe(false);
  });
});

describe('how long ago', () => {
  const now = 1_800_000_000_000;
  it.each([
    [null, 'unknown'],
    [undefined, 'unknown'],
    [0, 'unknown'],
    [now - 5_000, 'just now'],
    [now - 89_000, 'just now'],
    [now + 60_000, 'just now'],
    [now - 90_000, '2 min ago'],
    [now - 59 * 60_000, '59 min ago'],
    [now - 90 * 60_000, '2 h ago'],
    [now - 23 * 3_600_000, '23 h ago'],
    [now - 36 * 3_600_000, '2 days ago'],
    [now - 24 * 3_600_000 * 1.4, '1 day ago'],
    [now - 10 * 24 * 3_600_000, '10 days ago'],
  ])('%s is %s', (ms, words) => {
    expect(ago(ms as number | null | undefined, now)).toBe(words);
  });
});

describe('the small words', () => {
  it("says a moment in the browser's own way, and nothing for what is not a moment", () => {
    expect(stamp('2026-10-30T10:05:00.000Z')).toMatch(/30/);
    expect(stamp('2026-10-30T10:05:00.000Z')).toMatch(/Oct/);
    expect(stamp('')).toBe('');
    expect(stamp(null)).toBe('');
    expect(stamp('not a date')).toBe('');
  });
  it('names the ways of signing in, and shows one it does not know as the server wrote it', () => {
    expect(methodLabel('password')).toBe('Password');
    expect(methodLabel('google')).toBe('Google');
    expect(methodLabel('password+2fa')).toBe('Password + code');
    expect(methodLabel('google+2fa')).toBe('Google + code');
    expect(methodLabel('password+recovery')).toBe('Password + recovery code');
    expect(methodLabel('google+recovery')).toBe('Google + recovery code');
    expect(methodLabel('passkey')).toBe('passkey');
    expect(methodLabel('')).toBe('');
    expect(methodLabel(null)).toBe('');
  });
  it('writes a key in groups of four', () => {
    expect(groups4('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groups4('ABCDEF')).toBe('ABCD EF');
    expect(groups4('')).toBe('');
  });
  it('reads six digits, typed with a space or not, and nothing else', () => {
    expect(sixDigits('123456')).toBe('123456');
    expect(sixDigits(' 123 456 ')).toBe('123456');
    expect(sixDigits('12345')).toBeNull();
    expect(sixDigits('1234567')).toBeNull();
    expect(sixDigits('12345a')).toBeNull();
    expect(sixDigits('')).toBeNull();
  });
  it('writes the codes for Copy and Download: whose they are, when, and that each works once', () => {
    const text = codesText(['aaaaa-bbbbb', 'ccccc-ddddd'], 'Sara', new Date(2026, 9, 30, 10, 0));
    expect(text.split('\n')[0]).toBe('MotoLinker recovery codes for Sara');
    expect(text).toContain('Each code works once.');
    expect(text.endsWith('aaaaa-bbbbb\nccccc-ddddd\n')).toBe(true);
    expect(codesText(['x'], '').split('\n')[0]).toBe('MotoLinker recovery codes');
  });
  it('counts the other devices', () => {
    expect(othersSignedOut(0)).toBe('There were no other devices.');
    expect(othersSignedOut(1)).toBe('Signed out 1 other device.');
    expect(othersSignedOut(3)).toBe('Signed out 3 other devices.');
    expect(signedOutLine(1)).toBe('1 other device was signed out.');
    expect(signedOutLine(2)).toBe('2 other devices were signed out.');
  });
});

describe('the password, before it is sent', () => {
  it('wants the current one, a new one of at least eight characters, and the same new one twice — in that order', () => {
    expect(passwordProblem('', 'abcdefgh', 'abcdefgh')).toBe('Enter your current password.');
    expect(passwordProblem('old', '', '')).toBe('New password must be at least 8 characters.');
    expect(passwordProblem('old', '1234567', '1234567')).toBe(
      'New password must be at least 8 characters.',
    );
    expect(passwordProblem('old', 'abcdefgh', 'abcdefgX')).toBe('New passwords do not match.');
    expect(passwordProblem('old', 'abcdefgh', 'abcdefgh')).toBeNull();
  });
  it('says how many other devices were signed out', () => {
    expect(passwordDone(0)).toBe('Password updated successfully!');
    expect(passwordDone(1)).toBe('Password updated. 1 other device was signed out.');
    expect(passwordDone(4)).toBe('Password updated. 4 other devices were signed out.');
  });
});
