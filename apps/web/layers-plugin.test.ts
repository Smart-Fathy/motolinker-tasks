import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, layerOrder, withLayerOrder } from './layers-plugin.ts';

type Generate = (options: unknown, bundle: Rollup.OutputBundle) => void;
const run = (bundle: Record<string, unknown>) => {
  const plugin = layerOrder();
  const hook = plugin.generateBundle as unknown as { order: string; handler: Generate };
  hook.handler.call({}, {}, bundle as unknown as Rollup.OutputBundle);
  return hook.order;
};

describe('the order of the layers', () => {
  it('is reset, base, ui: the lowest first (tests/spashell.js holds it to the one base.css declares)', () => {
    expect(LAYER_ORDER).toBe('@layer reset,base,ui;');
  });

  it('is said at the head of a sheet, before anything else in it', () => {
    expect(withLayerOrder('@layer ui{.a{color:red}}')).toBe(
      `${LAYER_ORDER}@layer ui{.a{color:red}}`,
    );
  });

  it('is put at the head of every sheet the build writes, and of nothing else', () => {
    const bundle = {
      'assets/index.css': { type: 'asset', fileName: 'assets/index.css', source: '@layer ui{}' },
      'assets/Stock.css': {
        type: 'asset',
        fileName: 'assets/Stock.css',
        source: new TextEncoder().encode('@layer ui{.s{}}'),
      },
      'assets/font.woff2': { type: 'asset', fileName: 'assets/font.woff2', source: 'binary' },
      // (a sheet the build has nothing written for is left as it is, not made into a sheet that is only the order)
      'assets/odd.css': { type: 'asset', fileName: 'assets/odd.css' },
      'assets/index.js': { type: 'chunk', fileName: 'assets/index.js', code: '' },
    };
    expect(run(bundle)).toBe('post');
    expect(bundle['assets/index.css']?.source).toBe(`${LAYER_ORDER}@layer ui{}`);
    expect(bundle['assets/Stock.css']?.source).toBe(`${LAYER_ORDER}@layer ui{.s{}}`);
    expect(bundle['assets/font.woff2']?.source).toBe('binary');
    expect(bundle['assets/odd.css']).not.toHaveProperty('source');
    expect(bundle['assets/index.js']).not.toHaveProperty('source');
  });

  it('is left to the build, not the dev server, whose sheets arrive in the order of the imports', () => {
    expect(layerOrder().apply).toBe('build');
  });
});
