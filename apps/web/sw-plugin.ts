import { createHash } from 'node:crypto';
import path from 'node:path';
import { build, type Plugin, type ResolvedConfig, type Rollup } from 'vite';

// Builds the new app's service worker (src/sw/sw.ts) into the same folder as the app, as sw.js, once the app itself is
// written: the worker has to be given the list of files the app's first load is made of, and those have hashed names
// that only exist at that point. The list is the entry's files and what they import at once — not the files a screen
// loads when it is opened (those are kept the first time they are used), which is the point of splitting the app.

/** The files the app's first load needs: the entry script, everything it imports at once, and their styles. */
export function firstLoad(bundle: Rollup.OutputBundle): string[] {
  const files = new Set<string>();
  const visit = (name: string): void => {
    const item = bundle[name];
    if (!item || files.has(name)) return;
    files.add(name);
    if (item.type !== 'chunk') return;
    for (const imported of item.imports) visit(imported);
    for (const css of item.viteMetadata?.importedCss ?? []) visit(css);
    for (const asset of item.viteMetadata?.importedAssets ?? []) visit(asset);
  };
  for (const item of Object.values(bundle))
    if (item.type === 'chunk' && item.isEntry) visit(item.fileName);
  return [...files].sort();
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  let urls: string[] = [];
  return {
    name: 'ml-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_options, bundle) {
      urls = firstLoad(bundle).map(file => config.base + file);
    },
    async closeBundle() {
      await build({
        root: config.root,
        configFile: false,
        publicDir: false,
        logLevel: 'warn',
        define: {
          __PRECACHE__: JSON.stringify(urls),
          __BUILD__: JSON.stringify(
            createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 10),
          ),
        },
        build: {
          outDir: path.resolve(config.root, config.build.outDir),
          emptyOutDir: false,
          target: 'es2022',
          lib: {
            entry: path.resolve(config.root, 'src/sw/sw.ts'),
            formats: ['iife'],
            name: 'MlServiceWorker',
            fileName: () => 'sw.js',
          },
        },
      });
    },
  };
}
