import { describe, expect, it } from 'vitest';
import { parseWorkerMessage, portalOfWorker, scopeOf, workerUrl } from './shared';

describe("a portal's worker", () => {
  it('is loaded from its own address and holds its own scope', () => {
    expect(workerUrl('admin')).toBe('/sw-ui-dashboard.js');
    expect(workerUrl('team')).toBe('/sw-ui-employee.js');
    expect(scopeOf('admin')).toBe('/dashboard');
    expect(scopeOf('team')).toBe('/employee');
  });

  it('knows which portal it is for by the address it was loaded from, and only by that', () => {
    expect(portalOfWorker('/sw-ui-dashboard.js')).toBe('admin');
    expect(portalOfWorker('/sw-ui-employee.js')).toBe('team');
    for (const other of [
      '/ui/sw.js',
      '/sw-dashboard.js', // the classic one
      '/sw-employee.js',
      '/sw-ui-dashboard.js/',
      '/sw-ui-employee.json',
      '/legacy/sw-ui-dashboard.js',
      '',
    ])
      expect(portalOfWorker(other), other).toBeNull();
  });
});

describe('what the worker asks of a page', () => {
  it('is to open an address', () => {
    expect(parseWorkerMessage({ ml: 'sw', v: 1, type: 'open', url: '/dashboard?chat=7' })).toEqual({
      ml: 'sw',
      v: 1,
      type: 'open',
      url: '/dashboard?chat=7',
    });
  });

  it('is nothing else', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'open',
      7,
      [],
      {},
      { type: 'open_chat_room', roomId: '7' }, // what the classic pages are told
      { ml: 'sw', v: 1, type: 'open' },
      { ml: 'sw', v: 1, type: 'open', url: 7 },
      { ml: 'sw', v: 2, type: 'open', url: '/x' },
      { ml: 'embed', v: 1, type: 'open', url: '/x' },
      { ml: 'sw', v: 1, type: 'close', url: '/x' },
    ];
    for (const m of bad) expect(parseWorkerMessage(m), JSON.stringify(m)).toBeNull();
  });
});
