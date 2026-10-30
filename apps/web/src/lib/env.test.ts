import { describe, expect, it } from 'vitest';
import { classicUrl, readEnv, switchToClassicUrl, wording } from './env';

describe('what the server tells the page', () => {
  it('is read from window.__ML__ as the server writes it', () => {
    expect(
      readEnv({ v: 1, portal: 'team', ui: 'next', workspace: { name: 'Acme Motors', logo: '' } }),
    ).toEqual({
      portal: 'team',
      workspaceName: 'Acme Motors',
      texts: {},
      ui: 'next',
    });
  });

  it('falls back to the admin portal and the default name when there is nothing, or something else', () => {
    const fallback = { portal: 'admin', workspaceName: 'MotoLinker', texts: {}, ui: 'dev' };
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

describe('the wording an admin replaced', () => {
  const told = {
    workspace: { name: 'Acme', texts: { admin_title: 'Welcome back', team_sub: '{ws} crew' } },
  };

  it('is read as lines of text, and anything that is not text is left out', () => {
    expect(readEnv(told).texts).toEqual({ admin_title: 'Welcome back', team_sub: '{ws} crew' });
    expect(readEnv({ workspace: { texts: { a: 'x', b: 7, c: null, d: ['y'] } } }).texts).toEqual({
      a: 'x',
    });
    expect(readEnv({ workspace: { texts: 'Welcome' } }).texts).toEqual({});
    expect(readEnv({ workspace: { texts: null } }).texts).toEqual({});
  });

  it('replaces the default line, and {ws} says the workspace’s name in either', () => {
    const env = readEnv(told);
    expect(wording(env, 'admin_title', 'Admin Access')).toBe('Welcome back');
    expect(wording(env, 'team_sub', '{ws} · Log hours')).toBe('Acme crew');
    expect(wording(env, 'team_title', 'Team Portal')).toBe('Team Portal');
    expect(wording(env, 'team_title', '{ws} Portal, {ws}')).toBe('Acme Portal, Acme');
  });

  it('keeps the default for a line nobody replaced, however the server wrote the others', () => {
    expect(wording(readEnv(undefined), 'admin_title', 'Admin Access')).toBe('Admin Access');
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
