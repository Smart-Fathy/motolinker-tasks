import { screenOf } from '@motolinker/contracts/modules';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * A screen's page that the browser fetches when the screen is first opened, not with the app: the app opens with the frame
 * (rail, top bar, sign-in) and each screen comes in its own file, with its own styles. `preload` asks for it early — the rail
 * does, the moment a person points at the item — so that by the time they click it is usually already there.
 */
export type LazyPage = LazyExoticComponent<ComponentType> & { preload: () => void };

export function isLazyPage(page: ComponentType | LazyPage): page is LazyPage {
  return typeof (page as Partial<LazyPage>).preload === 'function';
}

/**
 * `lazyPage(() => import('./Gchat'), 'Gchat')`: the page that file exports under that name, fetched on first use. A fetch that
 * failed is not remembered as the answer, so asking again (pointing at the item again) tries again.
 */
export function lazyPage<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyPage {
  let pending: Promise<{ default: ComponentType }> | undefined;
  const fetchPage = (): Promise<{ default: ComponentType }> => {
    pending ??= load().then(
      loaded => ({ default: loaded[name] }),
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  return Object.assign(lazy(fetchPage), {
    preload: () => void fetchPage().catch(() => undefined),
  });
}

/**
 * What a screen is made of once it has moved to the new app. Which screens there are, who gets them and where they stand in the
 * navigation is the catalogue's (packages/contracts/src/modules.js); this is only what the app adds: the page it draws. A
 * screen that is in the catalogue and has no module here is still in the classic portal, and says so (see Unported).
 */
export interface ModuleDef {
  /** the screen's page; `lazyPage` for one that comes in its own file when the screen is opened */
  Page: ComponentType | LazyPage;
}

export interface Module extends ModuleDef {
  readonly id: string;
}

/** Declare a module. The id must be a screen of the catalogue: a typo is an error when the app starts, not a link that goes nowhere. */
export function defineModule(id: string, def: ModuleDef): Module {
  if (!screenOf(id)) {
    throw new Error(
      `defineModule: "${id}" is not a screen in the catalogue (packages/contracts/src/modules.js)`,
    );
  }
  return Object.freeze({ id, ...def });
}
