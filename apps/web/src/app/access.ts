import type { Actor } from '@motolinker/contracts/access';
import { allows, screenOf } from '@motolinker/contracts/modules';
import type { Me } from '../lib/api';

/** The actor GET /api/v1/me describes, as the rules in packages/contracts ask for it (sets for the lists). */
export function actorOf(me: Me): Actor {
  return {
    kind: me.actor.kind,
    id: me.actor.id,
    key: me.actor.key,
    name: me.actor.name,
    jobTitle: me.actor.jobTitle,
    caps: me.caps === '*' ? '*' : new Set(me.caps),
    sections: me.sections === '*' ? '*' : new Set(me.sections),
    scope: me.scope,
  };
}

/** What this person may open: the navigation and the routes ask the same question, of the same rules the server's guards use. */
export interface Access {
  readonly actor: Actor;
  readonly flags: Readonly<Record<string, boolean>>;
  /** may this person open the screen? false for a screen that does not exist */
  allows(screenId: string): boolean;
}

export function accessOf(me: Me): Access {
  const actor = actorOf(me);
  return {
    actor,
    flags: me.flags,
    allows(screenId) {
      const screen = screenOf(screenId);
      return !!screen && allows(actor, screen, me.flags);
    },
  };
}
