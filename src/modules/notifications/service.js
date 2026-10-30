'use strict';
// Notifications: what a member sees in the bell and the Notification Center, and marking them read.
//
// One piece of code for both portals and for /api/v1: the member is the actor (its `key` is 'admin' or 'employee_<id>', the
// value every row is filed under), and nothing here knows about requests. It takes the database as an argument, not from
// the context, and it says when the database could not be asked: what to tell the caller about that is theirs to decide
// (the classic routes answer an empty list, as they always have; /api/v1 says it is unavailable).

/** How many a member is shown: the newest. */
const LIMIT = 50;

/** What the id of a stored notification looks like: digits, no more than a bigint holds. */
const STORED_ID = /^\d{1,18}$/;

/** The database could not be asked, or refused. */
class NotificationsUnavailable extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'notifications are unavailable');
    this.name = 'NotificationsUnavailable';
  }
}

/**
 * A stored row. Its text columns have defaults but can be null; `member_key` is the owner.
 * @typedef {{
 *   id: number | string,
 *   member_key: string,
 *   type: string | null,
 *   title: string,
 *   body: string | null,
 *   url: string | null,
 *   read: boolean | null,
 *   created_at: string,
 * }} NotificationRow
 * @typedef {{ id: number | string } | { all: true }} ReadInput
 */

/**
 * @param {{ supabase: any }} deps
 */
function createNotificationsService({ supabase }) {
  return {
    /**
     * The member's newest notifications, newest first, and how many of those are unread.
     * @param {import('@motolinker/contracts').Actor} actor
     * @returns {Promise<{ rows: NotificationRow[], unread: number }>}
     */
    async list(actor) {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('member_key', actor.key)
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw new NotificationsUnavailable(error.message);
      /** @type {NotificationRow[]} */
      const rows = data || [];
      return { rows, unread: rows.filter(n => !n.read).length };
    },

    /**
     * Mark one of the member's notifications read, or all of the ones that are not. Another member's is never touched.
     * @param {import('@motolinker/contracts').Actor} actor
     * @param {ReadInput} input
     * @returns {Promise<void>}
     */
    async markRead(actor, input) {
      // Only a number can be an id here (the column is a bigint): a live-only notification, which could not be stored, has
      // a "tmp-…" id and nothing under it to mark, and asking the database would be an error and not an answer.
      if ('id' in input && !STORED_ID.test(String(input.id))) return;
      let q = supabase.from('notifications').update({ read: true }).eq('member_key', actor.key);
      q = 'id' in input ? q.eq('id', input.id) : q.eq('read', false);
      const { error } = await q;
      if (error) throw new NotificationsUnavailable(error.message);
    },
  };
}

/**
 * A stored row as /api/v1 and the app have it (contracts: schemas.Notification): text columns that are null are empty, a
 * missing type is 'general', and who it belongs to is not part of it.
 * @param {NotificationRow} row
 */
function toNotification(row) {
  return {
    id: row.id,
    type: row.type || 'general',
    title: String(row.title ?? ''),
    body: row.body || '',
    url: row.url || '',
    read: !!row.read,
    created_at: String(row.created_at ?? ''),
  };
}

module.exports = { LIMIT, NotificationsUnavailable, createNotificationsService, toNotification };
