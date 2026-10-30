import { describe, expect, it } from 'vitest';
import { clearToken, readToken, TOKEN_KEY, writeToken } from './session';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
};

describe('the session token', () => {
  it('keeps the keys the classic portals use, so signing in on either is signing in on both', () => {
    expect(TOKEN_KEY).toEqual({ admin: 'ml_admin_token', team: 'ml_emp_token' });
  });

  it('is read from the portal’s own key and no other', () => {
    const s = fakeStorage({ ml_admin_token: 'a', ml_emp_token: 't' });
    expect(readToken('admin', s)).toBe('a');
    expect(readToken('team', s)).toBe('t');
  });

  it('is null when there is none, or it is empty', () => {
    expect(readToken('admin', fakeStorage())).toBeNull();
    expect(readToken('admin', fakeStorage({ ml_admin_token: '' }))).toBeNull();
    expect(readToken('admin', null)).toBeNull();
  });

  it('is null, not a crash, when storage throws (a private window, blocked site data)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readToken('admin', throwing)).toBeNull();
    expect(() => clearToken('admin', throwing)).not.toThrow();
  });

  it('is cleared only for the portal asked', () => {
    const s = fakeStorage({ ml_admin_token: 'a', ml_emp_token: 't' });
    clearToken('team', s);
    expect([...s.data.keys()]).toEqual(['ml_admin_token']);
  });

  it('is written to the portal’s own key, where the classic portal reads it, and reported as kept', () => {
    const s = fakeStorage();
    expect(writeToken('team', 'abc', s)).toBe(true);
    expect([...s.data]).toEqual([['ml_emp_token', 'abc']]);
    expect(readToken('team', s)).toBe('abc');
    expect(readToken('admin', s)).toBeNull();
  });

  it('is reported as not kept, not a crash, when storage refuses or is missing', () => {
    const refusing = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeToken('admin', 'abc', refusing)).toBe(false);
    expect(writeToken('admin', 'abc', null)).toBe(false);
  });
});
