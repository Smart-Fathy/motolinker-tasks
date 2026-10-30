import { ApiError } from './api';

/** What was asked of the server and how it went: the value, or the words to tell the person. */
export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

/** A call that did not go, in words: the server's own where it said some, "Error: …" where it was not reached or made no sense. */
export const failed = (e: unknown): { ok: false; message: string } => ({
  ok: false,
  message:
    e instanceof ApiError ? e.message : `Error: ${e instanceof Error ? e.message : String(e)}`,
});
