import type { Plugin } from 'vite';

// The app's rules live in layers (src/styles/base.css declares them: reset, base, ui, lowest first), and layers rank in the
// order they are first named across all the page's stylesheets. With one stylesheet that was the order of the imports in
// main.tsx; now that each screen comes with a sheet of its own, and the pieces several screens share come in sheets of theirs,
// which of them the page names first is up to the build, and a sheet that names `ui` before base.css does puts every
// component under the reset: every padding and margin in the app turns to zero, and nothing else notices.
//
// So every sheet the build writes begins by saying the order. Whichever the browser reads first, the order is the same.

/** The layers, lowest first — the declaration base.css makes (tests/spashell.js holds the two together). */
export const LAYER_ORDER = '@layer reset,base,ui;';

type Written = { type: string; fileName: string; source?: string | Uint8Array };

/** Put the order at the head of a built sheet. */
export function withLayerOrder(css: string): string {
  return LAYER_ORDER + css;
}

export function layerOrder(): Plugin {
  return {
    name: 'ml-layer-order',
    apply: 'build',
    generateBundle: {
      // after the build has written the sheets
      order: 'post',
      handler(_options, bundle) {
        for (const item of Object.values(bundle) as Written[]) {
          if (item.type !== 'asset' || !item.fileName.endsWith('.css') || item.source === undefined)
            continue;
          const text =
            typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
          item.source = withLayerOrder(text);
        }
      },
    },
  };
}
