// What the server tells the page about itself: src/lib/spa-shell.js writes `window.__ML__` into the head of the
// page it sends. It is read defensively all the same: a page opened from the dev server (`npm run dev -w
// apps/web`) has no such object, and nothing about the shape is worth a blank screen.
export type Portal = 'admin' | 'team';

export interface MlEnv {
  portal: Portal;
  workspaceName: string;
  /** the lines an admin has replaced (Workspace → wording): key → text, `{ws}` standing for the workspace's name */
  texts: Readonly<Record<string, string>>;
  /** 'next' when the server sent this page, 'dev' when it did not */
  ui: 'next' | 'dev';
}

const FALLBACK: MlEnv = { portal: 'admin', workspaceName: 'MotoLinker', texts: {}, ui: 'dev' };

export function readEnv(source: unknown = (globalThis as { __ML__?: unknown }).__ML__): MlEnv {
  if (!source || typeof source !== 'object') return FALLBACK;
  const s = source as Record<string, unknown>;
  const ws =
    s['workspace'] && typeof s['workspace'] === 'object'
      ? (s['workspace'] as Record<string, unknown>)
      : {};
  const name = ws['name'];
  const said = ws['texts'] && typeof ws['texts'] === 'object' ? ws['texts'] : {};
  const texts: Record<string, string> = {};
  for (const [key, line] of Object.entries(said)) if (typeof line === 'string') texts[key] = line;
  return {
    portal: s['portal'] === 'team' ? 'team' : 'admin',
    workspaceName: typeof name === 'string' && name.trim() ? name : FALLBACK.workspaceName,
    texts,
    ui: s['ui'] === 'next' ? 'next' : 'dev',
  };
}

/**
 * A line of text the admin can replace: theirs if they did, else `fallback`. Like the classic pages, `{ws}` in either
 * stands for the workspace's name.
 */
export const wording = (env: MlEnv, key: string, fallback: string): string =>
  (env.texts[key] ?? fallback).replaceAll('{ws}', env.workspaceName);

/** The classic portal, always available (whatever the switch says). */
export const classicUrl = (portal: Portal): string =>
  portal === 'team' ? '/legacy/employee' : '/legacy/dashboard';

/** The way back: the portal's own address with the switch set to the classic UI, which the server remembers. */
export const switchToClassicUrl = (portal: Portal): string =>
  (portal === 'team' ? '/employee' : '/dashboard') + '?ui=legacy';
