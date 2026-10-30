import { describe, expect, it } from 'vitest';
import { classicUrl, readEnv, switchToClassicUrl } from './env';

describe('what the server tells the page', () => {
  it('is read from window.__ML__ as the server writes it', () => {
    expect(
      readEnv({ v: 1, portal: 'team', ui: 'next', workspace: { name: 'Acme Motors', logo: '' } }),
    ).toEqual({
      portal: 'team',
      workspaceName: 'Acme Motors',
      ui: 'next',
    });
  });

  it('falls back to the admin portal and the default name when there is nothing, or something else', () => {
    const fallback = { portal: 'admin', workspaceName: 'MotoLinker', ui: 'dev' };
    expect(readEnv(undefined)).toEqual(fallback);
    expect(readEnv(null)).toEqual(fallback);
    expect(readEnv('portal=team')).toEqual(fallback);
    expect(readEnv({})).toEqual(fallback);
  });

  it('takes only the two portals it knows, whatever else it is told', () => {
    expect(readEnv({ portal: 'root' }).portal).toBe('admin');
    expect(readEnv({ portal: 'team' }).portal).toBe('team');
  });

  it('keeps a workspace name as text and ignores a blank or non-text one', () => {
    expect(readEnv({ workspace: { name: '<img src=x onerror=alert(1)>' } }).workspaceName).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(readEnv({ workspace: { name: '   ' } }).workspaceName).toBe('MotoLinker');
    expect(readEnv({ workspace: { name: 42 } }).workspaceName).toBe('MotoLinker');
  });
});

describe('the way back to the classic portal', () => {
  it('is always the classic page, and the switch sets the server’s cookie back', () => {
    expect(classicUrl('admin')).toBe('/legacy/dashboard');
    expect(classicUrl('team')).toBe('/legacy/employee');
    expect(switchToClassicUrl('admin')).toBe('/dashboard?ui=legacy');
    expect(switchToClassicUrl('team')).toBe('/employee?ui=legacy');
  });
});
