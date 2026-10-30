import { describe, expect, it } from 'vitest';
import {
  cacheName,
  isPortalWindow,
  keepAsset,
  keepPage,
  notificationOf,
  pageKey,
  routeOf,
  staleCaches,
  targetOf,
} from './logic';

const ORIGIN = 'https://portal.example';

describe('the caches', () => {
  it("are named for the portal and the build, apart from every other worker's", () => {
    expect(cacheName('admin', 'abc123')).toBe('ml-ui-dashboard-abc123');
    expect(cacheName('team', 'abc123')).toBe('ml-ui-employee-abc123');
  });

  it("are cleared of older builds of this portal's app, and of nothing else", () => {
    const now = cacheName('admin', 'new');
    const all = [
      cacheName('admin', 'old'),
      cacheName('admin', 'older'),
      now,
      cacheName('team', 'old'), // the other portal's
      'motolinker-dash-v153', // the classic workers'
      'motolinker-emp-v133',
      'ml-ui-dashboardx-old',
      'workbox-precache',
      '',
    ];
    expect(staleCaches(all, 'admin', now)).toEqual([
      'ml-ui-dashboard-old',
      'ml-ui-dashboard-older',
    ]);
    expect(staleCaches(all, 'team', cacheName('team', 'old'))).toEqual([]);
  });

  it("keep the portal's page at one address", () => {
    expect(pageKey('admin', ORIGIN)).toBe(ORIGIN + '/dashboard');
    expect(pageKey('team', ORIGIN)).toBe(ORIGIN + '/employee');
  });
});

describe('what the worker answers', () => {
  const ask = (url: string, mode = 'cors', method = 'GET') => ({ url, mode, method });
  const route = (url: string, portal: 'admin' | 'team' = 'admin', mode = 'cors', method = 'GET') =>
    routeOf(ask(url, mode, method), portal, ORIGIN);

  it("keeps the app's own files, its icons and the fonts", () => {
    expect(route(ORIGIN + '/ui/assets/index-abc.js')).toBe('asset');
    expect(route(ORIGIN + '/ui/assets/Gallery-abc.css')).toBe('asset');
    expect(route(ORIGIN + '/icons/icon-192.png')).toBe('icon');
    expect(route('https://fonts.googleapis.com/css2?family=Manrope')).toBe('font');
    expect(route('https://fonts.gstatic.com/s/manrope/v1/x.woff2', 'admin', 'no-cors')).toBe(
      'font',
    );
  });

  it("keeps the portal's install manifest, its own only", () => {
    expect(route(ORIGIN + '/manifest-dashboard.json')).toBe('manifest');
    expect(route(ORIGIN + '/manifest-employee.json')).toBe('pass');
    expect(route(ORIGIN + '/manifest-employee.json', 'team')).toBe('manifest');
  });

  it("answers a visit to the portal's address, and to any address inside it", () => {
    for (const path of [
      '/dashboard',
      '/dashboard/',
      '/dashboard/leads',
      '/dashboard?safe=1',
      '/dashboard/leads?x=1#top',
    ])
      expect(route(ORIGIN + path, 'admin', 'navigate'), path).toBe('page');
    expect(route(ORIGIN + '/employee/hours', 'team', 'navigate')).toBe('page');
  });

  it('leaves everything else to the browser', () => {
    const passes: [string, string?, string?][] = [
      ['/api/dashboard/tasks'],
      ['/api/dashboard/notifications/stream?hd=2'],
      ['/api/v1/me'],
      ['/dashboard', 'cors'], // a script asking, not a visit
      ['/dashboard/leads', 'same-origin'],
      ['/dashboardx', 'navigate'],
      ['/dashboard.html', 'navigate'],
      ['/legacy/dashboard', 'navigate'], // the classic page the app shows in a frame
      ['/legacy/dashboard?embed=1', 'navigate'],
      ['/employee', 'navigate'], // the other portal's
      ['/assets/dashboard.js'], // the classic pages' files
      ['/sw-ui-dashboard.js'],
      ['/ui/index.html'],
      ['/ui/assets', 'cors'],
      ['/ui/assets/index-abc.js', 'cors', 'POST'],
      ['/icons/icon-192.png', 'cors', 'DELETE'],
      ['/iconsx/icon-192.png'],
      ['/api/dashboard/icons/x.png'],
      ['/'],
    ];
    for (const [path, mode, method] of passes)
      expect(route(ORIGIN + path, 'admin', mode, method), `${method ?? 'GET'} ${path}`).toBe(
        'pass',
      );
  });

  it('leaves other hosts alone, whatever they call themselves', () => {
    for (const url of [
      'https://elsewhere.example/ui/assets/index-abc.js',
      'https://elsewhere.example/dashboard',
      'https://fonts.googleapis.com.elsewhere.example/css2',
      'https://unpkg.com/lucide',
      'http://portal.example/ui/assets/index-abc.js', // not this origin
    ])
      expect(route(url, 'admin', 'navigate'), url).toBe('pass');
  });
});

describe('which answers are kept', () => {
  const answer = (status: number, ui?: string) => ({
    status,
    headers: { get: (name: string) => (name === 'X-ML-UI' && ui ? ui : null) },
  });

  it("keeps the app's own page", () => {
    expect(keepPage(answer(200, 'next'), ORIGIN + '/dashboard')).toBe(true);
    expect(keepPage(answer(200, 'next'), ORIGIN + '/dashboard/leads?x=1')).toBe(true);
  });

  it('does not keep the classic page, an error, a redirect, or a page from before the label', () => {
    expect(keepPage(answer(200, 'legacy'), ORIGIN + '/dashboard')).toBe(false);
    expect(keepPage(answer(200), ORIGIN + '/dashboard')).toBe(false);
    expect(keepPage(answer(503, 'next'), ORIGIN + '/dashboard')).toBe(false);
    expect(keepPage(answer(404, 'next'), ORIGIN + '/dashboard')).toBe(false);
    expect(keepPage(answer(0, 'next'), ORIGIN + '/dashboard')).toBe(false); // an opaque redirect
    expect(keepPage(answer(302, 'next'), ORIGIN + '/dashboard')).toBe(false);
  });

  it("does not keep the original-look page, which would come back in somebody else's session", () => {
    expect(keepPage(answer(200, 'next'), ORIGIN + '/dashboard?safe=1')).toBe(false);
    expect(keepPage(answer(200, 'next'), ORIGIN + '/dashboard/leads?safe=1')).toBe(false);
  });

  it('keeps a file that arrived, and a font (which arrives opaque), and no failure', () => {
    expect(keepAsset({ ok: true, type: 'basic' })).toBe(true);
    expect(keepAsset({ ok: false, type: 'opaque' })).toBe(true);
    expect(keepAsset({ ok: false, type: 'basic' })).toBe(false); // a 404 is not a file
    expect(keepAsset({ ok: false, type: 'error' })).toBe(false);
  });
});

describe('a push', () => {
  it('is shown in the words it came with', () => {
    const n = notificationOf({
      title: 'New lead',
      body: 'Acme called',
      tag: 'lead-9',
      url: '/dashboard#customers',
    });
    expect(n?.title).toBe('New lead');
    expect(n?.options).toMatchObject({
      body: 'Acme called',
      tag: 'lead-9',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      renotify: true,
      data: { url: '/dashboard#customers', roomId: undefined },
    });
  });

  it('is titled by what the push says first, and tagged by the tag it brought before any room', () => {
    const n = notificationOf({ title: 'Reminder', senderName: 'Rana', tag: 'mine', roomId: 'r-1' });
    expect(n?.title).toBe('Reminder');
    expect(n?.options.tag).toBe('mine');
  });

  it('says who a chat message is from, and groups a room together', () => {
    const n = notificationOf({ senderName: 'Rana', body: 'On my way', roomId: 'r-1' });
    expect(n?.title).toBe('Rana');
    expect(n?.options.tag).toBe('chat-room-r-1');
    expect(n?.options.data).toEqual({ url: undefined, roomId: 'r-1' });
  });

  it('has words of its own when the push brought none', () => {
    const n = notificationOf({});
    expect(n?.title).toBe('MotoLinker');
    expect(n?.options.body).toBe('New message');
    expect(n?.options.tag).toBe('motolinker');
  });

  it('takes only text for words', () => {
    const n = notificationOf({
      title: 7,
      senderName: '',
      body: { x: 1 },
      tag: [],
      roomId: 5,
      url: false,
    });
    expect(n?.title).toBe('MotoLinker');
    expect(n?.options.body).toBe('New message');
    expect(n?.options.tag).toBe('motolinker');
    expect(n?.options.data).toEqual({ url: undefined, roomId: undefined });
  });

  it('is nothing when it is not a message', () => {
    for (const nothing of [null, undefined, 'hello', 42, true, [], [{ title: 'x' }]])
      expect(notificationOf(nothing)).toBeNull();
  });
});

describe('where a tapped notification goes', () => {
  const go = (data: unknown, portal: 'admin' | 'team' = 'admin') => targetOf(data, portal, ORIGIN);

  it('is the address the push named, on this origin', () => {
    expect(go({ url: '/employee#requests' }, 'team')).toBe('/employee#requests');
    expect(go({ url: '/dashboard/leads?x=1#top' })).toBe('/dashboard/leads?x=1#top');
    expect(go({ url: ORIGIN + '/dashboard?chat=7' })).toBe('/dashboard?chat=7');
  });

  it("is the room's chat when the push named no address", () => {
    expect(go({ roomId: 'r 1/2' })).toBe('/dashboard?chat=r%201%2F2');
    expect(go({ roomId: 'r1' }, 'team')).toBe('/employee?chat=r1');
  });

  it('is the portal itself when it named nothing', () => {
    expect(go({})).toBe('/dashboard');
    expect(go(null, 'team')).toBe('/employee');
    expect(go('x')).toBe('/dashboard');
    expect(go({ url: '', roomId: '' })).toBe('/dashboard');
  });

  it('is never another site, whatever the push says', () => {
    for (const url of [
      'https://elsewhere.example/dashboard',
      '//elsewhere.example/dashboard',
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://portal.example/dashboard',
      'http://[bad', // not an address at all
    ])
      expect(go({ url }), url).toBe('/dashboard');
    expect(go({ url: 'https://elsewhere.example/x', roomId: 'r1' })).toBe('/dashboard?chat=r1');
  });
});

describe("an open window that is the portal's", () => {
  it('is its page, or any address inside it — the new app or the classic page at the same address', () => {
    for (const url of [
      ORIGIN + '/dashboard',
      ORIGIN + '/dashboard/',
      ORIGIN + '/dashboard/leads?x=1',
      ORIGIN + '/dashboard#customers',
    ])
      expect(isPortalWindow(url, 'admin'), url).toBe(true);
  });

  it('is not the classic page at /legacy, another portal, or an address that only starts the same', () => {
    for (const url of [
      ORIGIN + '/legacy/dashboard',
      ORIGIN + '/employee',
      ORIGIN + '/dashboardx',
      ORIGIN + '/',
      ORIGIN + '/ui/assets/x.js',
    ])
      expect(isPortalWindow(url, 'admin'), url).toBe(false);
    expect(isPortalWindow(ORIGIN + '/employee/hours', 'team')).toBe(true);
  });
});
