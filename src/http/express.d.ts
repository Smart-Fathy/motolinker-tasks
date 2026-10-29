// What the guards in index.js attach to a request (they are plain JavaScript there).
import type { Actor } from '@motolinker/contracts';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth / requireEmployeeAuth / requireActor. */
      actor?: Actor;
      /** The employee session, set by requireEmployeeAuth (absent for the admin). */
      employee?: any;
      session?: any;
      sessionToken?: string;
    }
  }
}

export {};
