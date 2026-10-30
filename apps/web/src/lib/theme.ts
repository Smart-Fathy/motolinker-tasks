// The workspace's look and each person's colour mode, kept right while the app is open. The same rules, line for line, as
// public/assets/workspace.js (the classic portals' copy of this), so a person moving between the two sees one behaviour:
//
//  - the server wrote the page's first paint (the look as a <style id="ws-theme">, the mode on <html data-mode>); what
//    happens here is the rest of its life. A change the admin makes arrives over the stream ('workspace') and is applied
//    at once by the same code that wrote it (public/assets/theme-core.js); a profile older than the one being worn is not
//    worn, and neither is one from a database that did not answer;
//  - a person's own choice of dark, light or automatic (`ml_mode`, shared with the classic portals in this browser) wins
//    when the workspace lets people choose; the choice is sent to the server so it follows them to another device;
//  - a page opened with ?safe=1 wears the original look whatever is saved: the name and picture still apply, the look and
//    the mode choice do not, and the colour-mode button is not offered. It is the way back in if a look ever makes the
//    screen hard to use.
import ThemeCore, { type Profile } from '@theme-core';
import type { Api } from './api';

export type Mode = 'dark' | 'light' | 'auto';
export const MODES: readonly Mode[] = ['dark', 'light', 'auto'];
export const MODE_NAMES: Record<Mode, string> = { dark: 'Dark', light: 'Light', auto: 'Automatic' };
const NEXT: Record<Mode, Mode> = { dark: 'light', light: 'auto', auto: 'dark' };

export const DEFAULT_NAME = 'MotoLinker';
const MODE_KEY = 'ml_mode';
const REMEMBER_KEY = 'ml_workspace';

export interface ThemeState {
  name: string;
  logoUrl: string;
  /** the lines an admin replaced, `{ws}` already the workspace's name */
  texts: Readonly<Record<string, string>>;
  /** what the page is set to: the person's own choice if they may make one, else the workspace's */
  mode: Mode;
  /** dark or light, what `auto` came to */
  effective: 'dark' | 'light';
  /** may a person choose? (the workspace can fix the mode, and safe mode never offers the choice) */
  canChoose: boolean;
}

export interface ThemeDeps {
  doc?: Document;
  win?: Window;
  /** null: the browser will not keep anything (private mode) */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  safe?: boolean;
  /** what the server said at page load: name and the replaced lines */
  initial?: { name: string; texts: Readonly<Record<string, string>> };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isMode = (v: unknown): v is Mode => v === 'dark' || v === 'light' || v === 'auto';

function pageStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class Theme {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly safe: boolean;
  private readonly listeners = new Set<() => void>();
  private ws = { name: DEFAULT_NAME, logoUrl: '' };
  private look: Profile | null = null;
  private stamp: string;
  private rawTexts: Readonly<Record<string, string>>;
  private titleTemplate: string | null = null;
  private favicon: string | null = null;
  private snapshot: ThemeState;
  private api: Pick<Api, 'get' | 'put' | 'base'> | null = null;

  constructor({ doc, win, storage, safe, initial }: ThemeDeps = {}) {
    this.doc = doc ?? document;
    this.win = win ?? window;
    this.storage = storage === undefined ? pageStorage() : storage;
    this.safe = !!safe;
    this.stamp = this.doc.documentElement.getAttribute('data-ws-stamp') ?? '';
    this.ws.name = initial?.name?.trim() || DEFAULT_NAME;
    this.rawTexts = initial?.texts ?? {};
    this.snapshot = this.compute();
    // The last profile seen is kept, so a page served from the service worker's cache while offline still wears
    // the look it last had (and a stale copy never overwrites a newer one: see apply).
    try {
      const seen: unknown = JSON.parse(this.storage?.getItem(REMEMBER_KEY) ?? 'null');
      if (isObject(seen)) this.apply(seen);
    } catch {
      /* nothing remembered, or not readable */
    }
  }

  // ── what the app reads ────────────────────────────────────────────────────────────────────────
  getSnapshot = (): ThemeState => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private compute(): ThemeState {
    const mode = this.mode();
    const texts: Record<string, string> = {};
    const lines = this.look?.['texts'] as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(lines ?? this.rawTexts))
      if (typeof v === 'string') texts[k] = v.replaceAll('{ws}', this.ws.name);
    return {
      name: this.ws.name,
      logoUrl: this.ws.logoUrl,
      texts,
      mode,
      effective: this.effective(mode),
      canChoose: !this.safe && this.allowed(),
    };
  }

  private publish(): void {
    const next = this.compute();
    const prev = this.snapshot;
    const same =
      prev.name === next.name &&
      prev.logoUrl === next.logoUrl &&
      prev.mode === next.mode &&
      prev.effective === next.effective &&
      prev.canChoose === next.canChoose &&
      JSON.stringify(prev.texts) === JSON.stringify(next.texts);
    if (same) return;
    this.snapshot = next;
    for (const fn of [...this.listeners]) fn();
  }

  // ── the workspace: name, picture, look ───────────────────────────────────────────────────────
  /**
   * Wear a workspace profile (the server's, from /api/workspace or the stream). A degraded answer is the server saying
   * it has not heard from its database: it describes nothing and must not overwrite what is already known. A profile
   * older than the one being worn — a slow answer overtaken by a push, a copy kept for offline use — is not worn.
   */
  apply(p: unknown): void {
    if (!isObject(p) || p['degraded']) return;
    const stamp = String(p['updated_at'] ?? '');
    if (this.stamp && stamp && stamp < this.stamp) return;
    const name = String(p['name'] ?? '').trim() || DEFAULT_NAME;
    const logo =
      typeof p['logo_url'] === 'string' && /^https?:\/\//i.test(p['logo_url']) ? p['logo_url'] : '';
    this.ws = { name, logoUrl: logo };
    this.paintIdentity(name, logo);
    this.applyLook(p);
    try {
      this.storage?.setItem(REMEMBER_KEY, JSON.stringify({ ...p, name, logo_url: logo }));
    } catch {
      /* private mode: the page still wears it */
    }
    this.publish();
  }

  private paintIdentity(name: string, logo: string): void {
    const doc = this.doc;
    const title = doc.querySelector('title');
    if (title && this.titleTemplate === null) {
      this.titleTemplate =
        title.dataset['wsTitle'] ??
        (doc.title.includes(DEFAULT_NAME) ? doc.title.replace(DEFAULT_NAME, '{ws}') : '');
    }
    if (this.titleTemplate) doc.title = this.titleTemplate.replace('{ws}', name);
    const root = doc.documentElement;
    // Quoted, with the characters that could end the url("…") encoded.
    if (logo) {
      root.style.setProperty(
        '--ws-logo',
        'url("' + logo.replace(/["\\\n\r]/g, c => encodeURIComponent(c)) + '")',
      );
    } else {
      root.style.removeProperty('--ws-logo');
    }
    root.classList.toggle('ws-custom-logo', !!logo);
    const icon = doc.querySelector('link[rel="icon"]');
    if (icon) {
      if (this.favicon === null)
        this.favicon = icon.getAttribute('data-default-href') ?? icon.getAttribute('href') ?? '';
      const want = logo || this.favicon;
      if (icon.getAttribute('href') !== want) icon.setAttribute('href', want);
    }
  }

  private applyLook(p: Record<string, unknown>): void {
    if (this.safe) return;
    if (!('theme' in p || 'typography' in p || 'shape' in p || 'texts' in p)) return; // an older answer: nothing to wear
    if (p['updated_at']) this.stamp = String(p['updated_at']);
    this.look = ThemeCore.normalize(p);
    // The tokens: the same <style> the server wrote, rewritten. It goes last in <head>, after the sheets, because
    // its dark tokens are :root rules like theirs and have to win.
    let st = this.doc.getElementById('ws-theme');
    if (!st) {
      st = this.doc.createElement('style');
      st.id = 'ws-theme';
      this.doc.head.appendChild(st);
    }
    const css = ThemeCore.renderThemeCss(this.look);
    if (st.textContent !== css) st.textContent = css;
    // The faces. (The default pair is the link the page has always carried.)
    const link = this.doc.querySelector('link[href^="https://fonts.googleapis.com/css2?"]');
    if (link) {
      const want = ThemeCore.fontsHref(this.look);
      if (link.getAttribute('href') !== want) link.setAttribute('href', want);
    }
    this.applyMode();
  }

  // ── dark, light or automatic ──────────────────────────────────────────────────────────────────
  private stored(): Mode | null {
    try {
      const m = this.storage?.getItem(MODE_KEY);
      return isMode(m) ? m : null;
    } catch {
      return null;
    }
  }

  private allowed(): boolean {
    const theme = this.look?.['theme'] as Record<string, unknown> | undefined;
    return !(theme && theme['allow_user_mode'] === false);
  }

  private mode(): Mode {
    const own = !this.safe && this.allowed() ? this.stored() : null;
    if (own) return own;
    if (this.look) return ThemeCore.defaultMode(this.look);
    const open = this.doc.documentElement.getAttribute('data-mode');
    return open === 'light' ? 'light' : 'dark';
  }

  private effective(mode: Mode): 'dark' | 'light' {
    if (mode !== 'auto') return mode;
    const light = this.win.matchMedia?.('(prefers-color-scheme: light)').matches;
    return light ? 'light' : 'dark';
  }

  /** Put the page in the right mode. Until the workspace's look is known, what the page opened in stays (always, in safe mode). */
  private applyMode(): void {
    if (!this.look) return;
    const eff = this.effective(this.mode());
    const root = this.doc.documentElement;
    if (root.getAttribute('data-mode') !== eff) root.setAttribute('data-mode', eff);
    const meta = this.doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', ThemeCore.themeColor(this.look, eff));
    // A translucent dark status bar over a light page is unreadable on a phone.
    const bar = this.doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) {
      if (!bar.getAttribute('data-default'))
        bar.setAttribute('data-default', bar.getAttribute('content') ?? 'default');
      bar.setAttribute(
        'content',
        eff === 'light' ? 'default' : (bar.getAttribute('data-default') ?? 'default'),
      );
    }
    this.publish();
  }

  /** Choose dark, light or automatic. Nothing happens if the workspace has fixed the mode, or for a mode that is not one. */
  setMode(m: Mode): void {
    if (!isMode(m) || this.safe || !this.allowed()) return;
    try {
      this.storage?.setItem(MODE_KEY, m);
    } catch {
      /* private mode: this page still follows the choice */
    }
    this.applyMode();
    this.publish();
    this.push(m);
  }

  cycleMode(): void {
    this.setMode(NEXT[this.snapshot.mode]);
  }

  // ── a person's choice follows them ────────────────────────────────────────────────────────────
  private push(mode: Mode): void {
    void this.api?.put(`${this.api.base}/ui-prefs`, { mode }).catch(() => undefined);
  }

  /**
   * The browser's copy is applied first (it is what the page opened with); the server's is what another device left.
   * Whichever device chose last is right, so a copy only travels when this browser has one the server does not.
   */
  async syncPrefs(api: Pick<Api, 'get' | 'put' | 'base'>): Promise<void> {
    this.api = api;
    if (this.safe) return;
    try {
      const p = await api.get<unknown>(`${api.base}/ui-prefs`);
      const theirs = isObject(p) && isMode(p['mode']) ? p['mode'] : null;
      const own = this.stored();
      if (theirs && !own) {
        try {
          this.storage?.setItem(MODE_KEY, theirs);
        } catch {
          /* private mode */
        }
        this.applyMode();
        this.publish();
      } else if (own && theirs !== own && this.allowed()) {
        this.push(own);
      }
    } catch {
      /* offline, or not allowed to say: the page keeps what it has */
    }
  }

  /** Ask the server for the workspace as it is now (a page served from cache may be behind). */
  async load(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<void> {
    try {
      const r = await fetchImpl('/api/workspace', { cache: 'no-store' });
      if (r.ok) this.apply(await r.json());
    } catch {
      /* offline: the remembered one stays */
    }
  }

  // ── while the page is open ────────────────────────────────────────────────────────────────────
  /** Automatic follows the device; another tab of this browser changing the mode is followed. Returns the way to stop. */
  start(): () => void {
    const onMedia = () => {
      if (this.snapshot.mode === 'auto') {
        this.applyMode();
        this.publish();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === MODE_KEY) {
        this.applyMode();
        this.publish();
      }
    };
    const mq = this.win.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener('change', onMedia);
    this.win.addEventListener('storage', onStorage);
    return () => {
      mq?.removeEventListener('change', onMedia);
      this.win.removeEventListener('storage', onStorage);
    };
  }
}
