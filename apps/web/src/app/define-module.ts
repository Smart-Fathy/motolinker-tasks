import { screenOf } from '@motolinker/contracts/modules';
import type { ComponentType } from 'react';

/**
 * What a screen is made of once it has moved to the new app. Which screens there are, who gets them and where they stand in the
 * navigation is the catalogue's (packages/contracts/src/modules.js); this is only what the app adds: the page it draws. A
 * screen that is in the catalogue and has no module here is still in the classic portal, and says so (see Unported).
 */
export interface ModuleDef {
  /** the screen's page; it may be lazy */
  Page: ComponentType;
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
