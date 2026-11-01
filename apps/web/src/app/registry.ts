import { isLazyPage, type Module } from './define-module';

/**
 * The modules that have moved to the new app, found rather than listed: every `modules/<id>/index.ts` default-exports what
 * defineModule made, and the registry is whatever is there. A module lives in the directory of its own id — a file that
 * says otherwise would register under the wrong name, so the app refuses to start.
 */
export function registryFrom(
  found: Record<string, { default?: Module }>,
): ReadonlyMap<string, Module> {
  const out = new Map<string, Module>();
  for (const [file, mod] of Object.entries(found)) {
    const dir = /\/modules\/([^/]+)\/index\.[tj]sx?$/.exec(file)?.[1];
    const def = mod.default;
    if (!dir || !def) throw new Error(`${file} must default-export defineModule(...)`);
    if (def.id !== dir) {
      throw new Error(`${file} defines "${def.id}": a module lives in the directory of its own id`);
    }
    out.set(def.id, def);
  }
  return out;
}

export const registry: ReadonlyMap<string, Module> = registryFrom(
  import.meta.glob<{ default?: Module }>('../modules/*/index.ts', { eager: true }),
);

/** Start fetching a screen's page, if it is one that is fetched when it is opened: the rail asks as a person points at an item. */
export function preloadScreen(id: string, from: ReadonlyMap<string, Module> = registry): void {
  const page = from.get(id)?.Page;
  if (page && isLazyPage(page)) page.preload();
}
