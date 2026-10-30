import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { firstLoad } from './sw-plugin.ts';

type Item = Rollup.OutputChunk | Rollup.OutputAsset;

const chunk = (
  fileName: string,
  more: { isEntry?: boolean; imports?: string[]; css?: string[]; assets?: string[] } = {},
) =>
  ({
    type: 'chunk',
    fileName,
    isEntry: more.isEntry ?? false,
    imports: more.imports ?? [],
    dynamicImports: [],
    viteMetadata: {
      importedCss: new Set(more.css ?? []),
      importedAssets: new Set(more.assets ?? []),
    },
  }) as unknown as Rollup.OutputChunk;
const asset = (fileName: string) => ({ type: 'asset', fileName }) as unknown as Rollup.OutputAsset;
const bundle = (...items: Item[]): Rollup.OutputBundle =>
  Object.fromEntries(items.map(i => [i.fileName, i])) as unknown as Rollup.OutputBundle;

describe("the files of the app's first load", () => {
  it('are the entry, its style, and what it imports at once with theirs', () => {
    const files = firstLoad(
      bundle(
        chunk('assets/index.js', {
          isEntry: true,
          imports: ['assets/vendor.js'],
          css: ['assets/index.css'],
        }),
        chunk('assets/vendor.js', { imports: ['assets/deeper.js'], css: ['assets/vendor.css'] }),
        chunk('assets/deeper.js', { assets: ['assets/font.woff2'] }),
        asset('assets/index.css'),
        asset('assets/vendor.css'),
        asset('assets/font.woff2'),
      ),
    );
    expect(files).toEqual([
      'assets/deeper.js',
      'assets/font.woff2',
      'assets/index.css',
      'assets/index.js',
      'assets/vendor.css',
      'assets/vendor.js',
    ]);
  });

  it('are not the files a screen loads when it is opened', () => {
    const files = firstLoad(
      bundle(
        chunk('assets/index.js', { isEntry: true, css: ['assets/index.css'] }), // (it imports Gallery only dynamically)
        chunk('assets/Gallery.js', { css: ['assets/Gallery.css'] }),
        chunk('assets/Orphan.js'),
        asset('assets/index.css'),
        asset('assets/Gallery.css'),
        asset('index.html'),
      ),
    );
    expect(files).toEqual(['assets/index.css', 'assets/index.js']);
  });

  it('are listed once, in a fixed order, however the chunks import each other', () => {
    const files = firstLoad(
      bundle(
        chunk('assets/z.js', { isEntry: true, imports: ['assets/b.js', 'assets/a.js'] }),
        chunk('assets/b.js', { imports: ['assets/a.js'] }),
        chunk('assets/a.js', { imports: ['assets/b.js'] }), // a cycle is still one visit each
        asset('index.html'),
      ),
    );
    expect(files).toEqual(['assets/a.js', 'assets/b.js', 'assets/z.js']);
  });

  it('leave out what the build does not hold (a package left external) and are none without an entry', () => {
    expect(
      firstLoad(bundle(chunk('assets/index.js', { isEntry: true, imports: ['react'] }))),
    ).toEqual(['assets/index.js']);
    expect(firstLoad(bundle(chunk('assets/a.js'), asset('assets/a.css')))).toEqual([]);
    expect(firstLoad(bundle())).toEqual([]);
  });
});
