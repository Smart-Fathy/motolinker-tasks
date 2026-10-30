import { describe, expect, it } from 'vitest';
import { takeArrival, type Where } from './arrival';

/** A page at `href`, with a history that records what it was told and a storage that keeps what it is given. */
function page(
  href: string,
  { storage = 'works' }: { storage?: 'works' | 'refuses' | 'none' } = {},
) {
  const replaced: string[] = [];
  const kept = new Map<string, string>();
  const where: Where = {
    location: { href: `https://app.example.com${href}` },
    history: {
      state: { keep: 'me' },
      replaceState: (_s, _t, url) => void replaced.push(String(url)),
    },
    storage:
      storage === 'none'
        ? null
        : {
            setItem: (k: string, v: string) => {
              if (storage === 'refuses') throw new Error('QuotaExceededError');
              kept.set(k, v);
            },
          },
  };
  return { where, replaced, kept };
}

describe('a page opened for a reason', () => {
  it('is an ordinary visit when the address says nothing, and the address is left alone', () => {
    const p = page('/employee?ui=next');
    expect(takeArrival('team', p.where)).toEqual({});
    expect(p.replaced).toEqual([]);
    expect(p.kept.size).toBe(0);
  });

  it('is Google’s return with a session: kept like any sign-in, and out of the address bar', () => {
    const p = page('/employee?emp_token=abc123');
    expect(takeArrival('team', p.where)).toEqual({ token: 'abc123' });
    expect([...p.kept]).toEqual([['ml_emp_token', 'abc123']]);
    expect(p.replaced).toEqual(['/employee']);
  });

  it('is Google’s return with a second step to take: the challenge, and out of the address bar', () => {
    const p = page('/employee?mfa_token=chal');
    expect(takeArrival('team', p.where)).toEqual({ mfaToken: 'chal' });
    expect(p.replaced).toEqual(['/employee']);
    expect(p.kept.size).toBe(0);
  });

  it('is Google’s refusal: its words, as text, once decoded', () => {
    const p = page(
      '/employee?google_login_error=No%20account%20linked%20to%20this%20Google%20address.',
    );
    expect(takeArrival('team', p.where)).toEqual({
      error: 'No account linked to this Google address.',
    });
    expect(p.replaced).toEqual(['/employee']);
  });

  it('decodes the refusal once, so a percent sign in it is a percent sign and not a crash', () => {
    const p = page('/employee?google_login_error=100%25%20wrong');
    expect(takeArrival('team', p.where)).toEqual({ error: '100% wrong' });
  });

  it('does not put more than a sentence or two of somebody else’s words in front of a person', () => {
    const p = page(`/employee?google_login_error=${'x'.repeat(5000)}`);
    expect(takeArrival('team', p.where).error).toHaveLength(200);
  });

  it('is the link in a password-reset email', () => {
    const p = page('/employee?reset=0123456789abcdef');
    expect(takeArrival('team', p.where)).toEqual({ resetToken: '0123456789abcdef' });
    expect(p.replaced).toEqual(['/employee']);
  });

  it('takes a session over everything else it was told, and keeps nothing it should not', () => {
    const p = page('/employee?emp_token=abc&mfa_token=chal&reset=r&google_login_error=no');
    expect(takeArrival('team', p.where)).toEqual({ token: 'abc' });
    expect([...p.kept]).toEqual([['ml_emp_token', 'abc']]);
    expect(p.replaced).toEqual(['/employee']);
  });

  it('takes out its own four parameters and no others, and keeps the path and the hash', () => {
    const p = page('/employee/tasks?ui=next&reset=r&tab=open#row-4');
    expect(takeArrival('team', p.where)).toEqual({ resetToken: 'r' });
    expect(p.replaced).toEqual(['/employee/tasks?ui=next&tab=open#row-4']);
  });

  it('leaves the history entry’s own state as it was (a router keeps its place there)', () => {
    const states: unknown[] = [];
    const where: Where = {
      location: { href: 'https://app.example.com/employee?reset=r' },
      history: { state: { key: 'k1' }, replaceState: s => void states.push(s) },
    };
    takeArrival('team', where);
    expect(states).toEqual([{ key: 'k1' }]);
  });

  it('still has the session when storage refuses to keep it: it is the page’s to use now', () => {
    const refusing = page('/employee?emp_token=abc', { storage: 'refuses' });
    expect(takeArrival('team', refusing.where)).toEqual({ token: 'abc' });
    expect(refusing.replaced).toEqual(['/employee']);
    const missing = page('/employee?emp_token=abc', { storage: 'none' });
    expect(takeArrival('team', missing.where)).toEqual({ token: 'abc' });
  });

  it('treats an empty value as nothing, and still takes it out of the address bar', () => {
    const p = page('/employee?emp_token=&reset=');
    expect(takeArrival('team', p.where)).toEqual({});
    expect(p.kept.size).toBe(0);
    expect(p.replaced).toEqual(['/employee']);
  });

  it('is not the admin portal’s business: it ignores all of it and leaves the address as it is', () => {
    const p = page('/dashboard?emp_token=abc&mfa_token=c&reset=r&google_login_error=x');
    expect(takeArrival('admin', p.where)).toEqual({});
    expect(p.replaced).toEqual([]);
    expect(p.kept.size).toBe(0);
  });
});
