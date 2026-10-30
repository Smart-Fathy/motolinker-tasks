import ThemeCore from '@theme-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Theme, type Mode } from './theme';

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    peek: (k: string) => m.get(k),
  };
};

/** a window with a colour scheme the test can change */
function fakeWindow(light = false) {
  let matches = light;
  const media = new Set<() => void>();
  const events = new Map<string, (e: unknown) => void>();
  return {
    win: {
      matchMedia: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (_t: string, fn: () => void) => media.add(fn),
        removeEventListener: (_t: string, fn: () => void) => media.delete(fn),
      }),
      addEventListener: (t: string, fn: (e: unknown) => void) => events.set(t, fn),
      removeEventListener: (t: string) => events.delete(t),
    } as unknown as Window,
    setLight(v: boolean) {
      matches = v;
      media.forEach(f => f());
    },
    fire: (t: string, e: unknown) => events.get(t)?.(e),
    listening: () => media.size + events.size,
  };
}

const profile = (over: Record<string, unknown> = {}) => ({
  name: 'Acme',
  logo_url: '',
  updated_at: '2026-10-01T10:00:00.000Z',
  theme: { preset: 'moto' },
  typography: {},
  shape: {},
  texts: {},
  ...over,
});

function page(attrs: Record<string, string> = {}) {
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
  for (const a of [...document.documentElement.attributes])
    document.documentElement.removeAttribute(a.name);
  for (const [k, v] of Object.entries({ 'data-mode': 'dark', ...attrs }))
    document.documentElement.setAttribute(k, v);
  document.head.innerHTML = `
    <title data-ws-title="{ws} · Admin Dashboard">MotoLinker · Admin Dashboard</title>
    <link rel="icon" href="/icons/favicon.png">
    <meta name="theme-color" content="#1e2130">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link href="https://fonts.googleapis.com/css2?family=Manrope" rel="stylesheet">
    <style id="ws-theme">/* the server's */</style>`;
}
const mode = () => document.documentElement.getAttribute('data-mode');
const meta = (name: string) =>
  document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');

beforeEach(() => page());

describe("the workspace's name and picture", () => {
  it('puts the name in the title, and the picture on the page and the tab', () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ logo_url: 'https://cdn.example/l.png' }));
    expect(t.getSnapshot().name).toBe('Acme');
    expect(document.title).toBe('Acme · Admin Dashboard');
    expect(document.documentElement.style.getPropertyValue('--ws-logo')).toBe(
      'url("https://cdn.example/l.png")',
    );
    expect(document.documentElement.classList.contains('ws-custom-logo')).toBe(true);
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
      'https://cdn.example/l.png',
    );
  });

  it('puts the original tab icon back when the picture is taken away', () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ logo_url: 'https://cdn.example/l.png' }));
    t.apply(profile({ logo_url: '', updated_at: '2026-10-01T11:00:00.000Z' }));
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
      '/icons/favicon.png',
    );
    expect(document.documentElement.style.getPropertyValue('--ws-logo')).toBe('');
    expect(document.documentElement.classList.contains('ws-custom-logo')).toBe(false);
  });

  it('only believes a picture that is a web address, and cannot be talked out of its quotes', () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ logo_url: 'javascript:alert(1)' }));
    expect(t.getSnapshot().logoUrl).toBe('');
    t.apply(
      profile({ logo_url: 'https://x.example/a"b.png', updated_at: '2026-10-01T11:00:00.000Z' }),
    );
    expect(document.documentElement.style.getPropertyValue('--ws-logo')).toBe(
      'url("https://x.example/a%22b.png")',
    );
  });

  it('calls the workspace by its default name when the profile has none', () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ name: '   ' }));
    expect(t.getSnapshot().name).toBe('MotoLinker');
  });

  it('does not wear what is not a profile, or what the server says it could not read', () => {
    const t = new Theme({ storage: store(), initial: { name: 'First', texts: {} } });
    for (const bad of [
      null,
      undefined,
      'x',
      7,
      [],
      { ...profile(), degraded: true, name: 'Default' },
    ])
      t.apply(bad);
    expect(t.getSnapshot().name).toBe('First');
  });

  it('does not wear a profile older than the one it wears, and wears an equal or newer one', () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ name: 'New', updated_at: '2026-10-02T00:00:00.000Z' }));
    t.apply(profile({ name: 'Old', updated_at: '2026-10-01T00:00:00.000Z' }));
    expect(t.getSnapshot().name).toBe('New');
    t.apply(profile({ name: 'Same', updated_at: '2026-10-02T00:00:00.000Z' }));
    expect(t.getSnapshot().name).toBe('Same');
  });

  it('knows the stamp of the profile the server wrote the page from, and does not wear older ones over it', () => {
    page({ 'data-ws-stamp': '2026-10-05T00:00:00.000Z' });
    const t = new Theme({ storage: store() });
    t.apply(profile({ name: 'Stale', updated_at: '2026-10-01T00:00:00.000Z' }));
    expect(t.getSnapshot().name).toBe('MotoLinker');
  });

  it('keeps the last profile it wore, and wears it again when opened offline', () => {
    const s = store();
    new Theme({ storage: s }).apply(profile({ name: 'Remembered' }));
    expect(JSON.parse(s.peek('ml_workspace') ?? '{}').name).toBe('Remembered');
    const again = new Theme({ storage: s });
    expect(again.getSnapshot().name).toBe('Remembered');
  });

  it('is not troubled by a browser that keeps nothing, or a copy it cannot read', () => {
    const broken = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    };
    const t = new Theme({ storage: broken });
    expect(() => t.apply(profile())).not.toThrow();
    expect(t.getSnapshot().name).toBe('Acme');
    expect(new Theme({ storage: null }).getSnapshot().name).toBe('MotoLinker');
  });

  it('tells whoever is listening only when something changed', () => {
    const t = new Theme({ storage: store() });
    const heard = vi.fn();
    t.subscribe(heard);
    const before = t.getSnapshot();
    t.apply(profile());
    expect(heard).toHaveBeenCalledTimes(1);
    expect(t.getSnapshot()).not.toBe(before);
    const now = t.getSnapshot();
    t.apply(profile());
    expect(heard).toHaveBeenCalledTimes(1);
    expect(t.getSnapshot()).toBe(now);
  });

  it('stops telling whoever has stopped listening', () => {
    const t = new Theme({ storage: store() });
    const heard = vi.fn();
    const off = t.subscribe(heard);
    off();
    t.apply(profile());
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('the look', () => {
  it('rewrites the tokens the server wrote, with what ThemeCore makes of the profile, in the same element', () => {
    const t = new Theme({ storage: store() });
    const p = profile({ theme: { preset: 'cyberpunk' } });
    t.apply(p);
    const styles = document.querySelectorAll('style#ws-theme');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(ThemeCore.renderThemeCss(ThemeCore.normalize(p)));
  });

  it('adds the element when the page had none', () => {
    document.getElementById('ws-theme')?.remove();
    new Theme({ storage: store() }).apply(profile());
    expect(document.getElementById('ws-theme')?.textContent).toContain('--');
  });

  it('asks for the faces the look chose', () => {
    const p = profile({ typography: { heading: 'playfair', body: 'inter' } });
    new Theme({ storage: store() }).apply(p);
    expect(
      document
        .querySelector('link[href^="https://fonts.googleapis.com/css2?"]')
        ?.getAttribute('href'),
    ).toBe(ThemeCore.fontsHref(ThemeCore.normalize(p)));
  });

  it('leaves the look alone for an answer that only knows the name', () => {
    const t = new Theme({ storage: store() });
    t.apply({ name: 'Just a name', logo_url: '', updated_at: '2026-10-01T10:00:00.000Z' });
    expect(t.getSnapshot().name).toBe('Just a name');
    expect(document.getElementById('ws-theme')?.textContent).toBe("/* the server's */");
  });

  it("puts the wording the admin replaced where the app reads it, with the workspace's name in it", () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ texts: { admin_badge: 'Control room', admin_role: 'Owner of {ws}' } }));
    expect(t.getSnapshot().texts).toMatchObject({
      admin_badge: 'Control room',
      admin_role: 'Owner of Acme',
    });
    t.apply(profile({ texts: {}, updated_at: '2026-10-01T12:00:00.000Z' }));
    expect(t.getSnapshot().texts).toEqual({});
  });

  it('starts from the wording the server wrote into the page', () => {
    const t = new Theme({
      storage: store(),
      initial: { name: 'Acme', texts: { team_role: 'Crew of {ws}' } },
    });
    expect(t.getSnapshot().texts).toEqual({ team_role: 'Crew of Acme' });
  });
});

describe('safe mode', () => {
  it('wears the name and picture but never the look, never the mode, and offers no choice', () => {
    const w = fakeWindow(true);
    const s = store({ ml_mode: 'dark' });
    const t = new Theme({ storage: s, safe: true, win: w.win });
    t.apply(profile({ logo_url: 'https://cdn.example/l.png', theme: { preset: 'cyberpunk' } }));
    expect(t.getSnapshot().name).toBe('Acme');
    expect(document.documentElement.classList.contains('ws-custom-logo')).toBe(true);
    expect(document.getElementById('ws-theme')?.textContent).toBe("/* the server's */");
    expect(mode()).toBe('dark');
    expect(t.getSnapshot().canChoose).toBe(false);
    t.setMode('light');
    expect(s.peek('ml_mode')).toBe('dark'); // not stored: safe mode is the original look and nothing more
    expect(mode()).toBe('dark');
  });

  it('does not ask the server about modes either', async () => {
    const api = { base: '/api/dashboard', get: vi.fn(), put: vi.fn() };
    await new Theme({ storage: store(), safe: true }).syncPrefs(api);
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('dark, light or automatic', () => {
  it("opens in the workspace's own mode when the person has not chosen", () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ theme: { preset: 'moto', default_mode: 'light' } }));
    expect(mode()).toBe('light');
    expect(t.getSnapshot()).toMatchObject({ mode: 'light', effective: 'light', canChoose: true });
  });

  it("prefers the person's own choice", () => {
    const t = new Theme({ storage: store({ ml_mode: 'dark' }) });
    t.apply(profile({ theme: { preset: 'moto', default_mode: 'light' } }));
    expect(mode()).toBe('dark');
    expect(t.getSnapshot().mode).toBe('dark');
  });

  it('ignores a stored choice that is not one', () => {
    const t = new Theme({ storage: store({ ml_mode: 'purple' }) });
    t.apply(profile({ theme: { preset: 'moto', default_mode: 'light' } }));
    expect(t.getSnapshot().mode).toBe('light');
  });

  it("ignores the person's choice when the workspace has fixed the mode, and offers none", () => {
    const s = store({ ml_mode: 'dark' });
    const t = new Theme({ storage: s });
    t.apply(profile({ theme: { preset: 'moto', default_mode: 'light', allow_user_mode: false } }));
    expect(mode()).toBe('light');
    expect(t.getSnapshot().canChoose).toBe(false);
    t.setMode('auto');
    expect(mode()).toBe('light');
    expect(s.peek('ml_mode')).toBe('dark'); // the choice is not kept either
  });

  it("colours the browser bar for the mode, and puts the phone's status bar right on a light page", () => {
    const t = new Theme({ storage: store({ ml_mode: 'light' }) });
    const p = profile();
    t.apply(p);
    expect(meta('theme-color')).toBe(ThemeCore.themeColor(ThemeCore.normalize(p), 'light'));
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('default');
    t.setMode('dark');
    expect(meta('theme-color')).toBe(ThemeCore.themeColor(ThemeCore.normalize(p), 'dark'));
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent');
  });

  it('follows the device while the choice is automatic, and only then', () => {
    const w = fakeWindow(false);
    const t = new Theme({ storage: store({ ml_mode: 'auto' }), win: w.win });
    t.apply(profile());
    t.start();
    expect(mode()).toBe('dark');
    w.setLight(true);
    expect(mode()).toBe('light');
    expect(t.getSnapshot()).toMatchObject({ mode: 'auto', effective: 'light' });
    t.setMode('dark');
    w.setLight(false);
    w.setLight(true);
    expect(mode()).toBe('dark');
  });

  it('follows another tab of this browser that changed the mode, and nothing else that changes', () => {
    const w = fakeWindow(false);
    const s = store();
    const t = new Theme({ storage: s, win: w.win });
    t.apply(profile({ theme: { preset: 'moto', default_mode: 'dark' } }));
    t.start();
    s.setItem('ml_mode', 'light');
    w.fire('storage', { key: 'something_else' });
    expect(mode()).toBe('dark');
    w.fire('storage', { key: 'ml_mode' });
    expect(mode()).toBe('light');
  });

  it('stops listening when told to stop', () => {
    const w = fakeWindow();
    const stop = new Theme({ storage: store(), win: w.win }).start();
    expect(w.listening()).toBe(2);
    stop();
    expect(w.listening()).toBe(0);
  });

  it('goes round dark, light, automatic, dark', () => {
    const t = new Theme({ storage: store() });
    t.apply(profile({ theme: { preset: 'moto', default_mode: 'dark' } }));
    const seen: Mode[] = [t.getSnapshot().mode];
    for (let i = 0; i < 4; i++) {
      t.cycleMode();
      seen.push(t.getSnapshot().mode);
    }
    expect(seen).toEqual(['dark', 'light', 'auto', 'dark', 'light']);
  });

  it('keeps the choice, and does not accept one that is not a mode', () => {
    const s = store();
    const t = new Theme({ storage: s });
    t.apply(profile());
    t.setMode('light');
    expect(s.peek('ml_mode')).toBe('light');
    t.setMode('purple' as Mode);
    expect(s.peek('ml_mode')).toBe('light');
  });

  it("keeps what the page opened in until the workspace's look is known, but remembers the choice", () => {
    const s = store();
    const t = new Theme({ storage: s });
    t.setMode('light');
    expect(s.peek('ml_mode')).toBe('light');
    expect(mode()).toBe('dark');
    t.apply(profile());
    expect(mode()).toBe('light');
  });

  it('tells the server what was chosen, once it knows how to reach it, and is not troubled when it cannot', async () => {
    const api = {
      base: '/api/employee',
      get: vi.fn().mockResolvedValue({}),
      put: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const t = new Theme({ storage: store() });
    t.apply(profile());
    t.setMode('light'); // not reachable yet: nothing to send, nothing wrong
    await t.syncPrefs(api);
    api.put.mockClear();
    t.setMode('auto');
    expect(api.put).toHaveBeenCalledWith('/api/employee/ui-prefs', { mode: 'auto' });
    await Promise.resolve();
  });
});

describe('a choice that follows the person', () => {
  const api = (answer: unknown, fail = false) => ({
    base: '/api/dashboard',
    get: fail ? vi.fn().mockRejectedValue(new Error('down')) : vi.fn().mockResolvedValue(answer),
    put: vi.fn().mockResolvedValue({}),
  });

  it('takes the choice another device left when this browser has none', async () => {
    const s = store();
    const t = new Theme({ storage: s });
    t.apply(profile());
    const a = api({ mode: 'light' });
    await t.syncPrefs(a);
    expect(s.peek('ml_mode')).toBe('light');
    expect(mode()).toBe('light');
    expect(t.getSnapshot().mode).toBe('light');
    expect(a.put).not.toHaveBeenCalled();
  });

  it('sends the choice this browser has when the server has a different one, or none', async () => {
    for (const theirs of [{ mode: 'dark' }, {}]) {
      const t = new Theme({ storage: store({ ml_mode: 'light' }) });
      t.apply(profile());
      const a = api(theirs);
      await t.syncPrefs(a);
      expect(a.put).toHaveBeenCalledWith('/api/dashboard/ui-prefs', { mode: 'light' });
    }
  });

  it('says nothing when they agree', async () => {
    const t = new Theme({ storage: store({ ml_mode: 'light' }) });
    t.apply(profile());
    const a = api({ mode: 'light' });
    await t.syncPrefs(a);
    expect(a.put).not.toHaveBeenCalled();
  });

  it('does not send a choice the workspace has stopped allowing', async () => {
    const t = new Theme({ storage: store({ ml_mode: 'light' }) });
    t.apply(profile({ theme: { preset: 'moto', allow_user_mode: false } }));
    const a = api({ mode: 'dark' });
    await t.syncPrefs(a);
    expect(a.put).not.toHaveBeenCalled();
  });

  it('keeps what it has when the server cannot answer, or answers with nonsense', async () => {
    const s = store({ ml_mode: 'light' });
    const t = new Theme({ storage: s });
    t.apply(profile());
    await t.syncPrefs(api(null, true));
    await t.syncPrefs(api({ mode: 'purple' }));
    await t.syncPrefs(api('nonsense'));
    expect(s.peek('ml_mode')).toBe('light');
  });
});

describe('asking for the workspace', () => {
  it('wears what the server answers, bypassing caches', async () => {
    const t = new Theme({ storage: store() });
    const f = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(profile({ name: 'Fresh' })), { status: 200 }));
    await t.load(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('/api/workspace', { cache: 'no-store' });
    expect(t.getSnapshot().name).toBe('Fresh');
  });

  it('keeps what it has when offline or refused', async () => {
    const t = new Theme({ storage: store(), initial: { name: 'Kept', texts: {} } });
    await t.load(vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch);
    await t.load(
      vi.fn().mockResolvedValue(new Response('no', { status: 500 })) as unknown as typeof fetch,
    );
    expect(t.getSnapshot().name).toBe('Kept');
  });
});
