// The workspace's look is worked out by one file, public/assets/theme-core.js: the server writes the page's first paint with
// it, the classic portals re-apply it, and this app does too (it is imported through the `@theme-core` alias in vite.config.ts,
// so there is one copy of the colour maths). It is plain JavaScript that predates the app; this says what the app uses of it.
declare module '@theme-core' {
  /** a workspace profile as the server sends it, or as ThemeCore.normalize has cleaned it */
  export type Profile = Record<string, unknown>;
  export interface ThemeCoreApi {
    PRESETS: Record<string, { mode: 'dark' | 'light'; label?: string } & Record<string, unknown>>;
    PRESET_ORDER: readonly string[];
    /** what the pages say when nothing has been replaced; `{ws}` is the workspace's name */
    TEXT_DEFAULTS: Record<string, string>;
    DEFAULT_PRESET: string;
    normalize(raw: unknown): Profile;
    renderThemeCss(profile: Profile): string;
    fontsHref(profile: Profile): string;
    defaultMode(profile: Profile): 'dark' | 'light' | 'auto';
    themeColor(profile: Profile, mode?: 'dark' | 'light'): string;
    custom(profile: Profile): { colors: boolean } & Record<string, unknown>;
    report(profile: Profile): {
      mode: string;
      id: string;
      label: string;
      fg: string;
      bg: string;
      ratio: number;
      min: number;
      level: 'ok' | 'warn' | 'error';
    }[];
  }
  const ThemeCore: ThemeCoreApi;
  export default ThemeCore;
}
