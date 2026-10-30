'use strict';
// Website submissions: what the public form on the marketing site sent us, read by the people who may read them and cleared
// by the people who may clear them. (The form's own endpoint, POST /api/submissions, is not here: it has no session at
// all, and it makes the lead and the notification as well as the row. See src/routes/submissions.js.)
//
// One piece of code for both portals and for /api/v1. Nobody here writes a submission — the website does — so there is no
// create and no edit; and every submission is everyone's who may see the section, so nothing here is narrowed by who asks:
// whether they may is the route's question (`submissions.view`, `submissions.delete`).

/** How many are listed: the newest. */
const LIMIT = 200;

/** What the id of a stored submission looks like: digits, no more than a bigint holds. */
const STORED_ID = /^\d{1,18}$/;

/** The database could not be asked, or refused. */
class SubmissionsUnavailable extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'submissions are unavailable');
    this.name = 'SubmissionsUnavailable';
  }
}

/**
 * A stored row, with the name of the lead it was matched to joined in. Its text columns have defaults but can be null.
 * @typedef {{
 *   id: number,
 *   name: string | null,
 *   email: string | null,
 *   phone: string | null,
 *   message: string | null,
 *   car_interest: string | null,
 *   source: string | null,
 *   customer_id: number | null,
 *   created_at: string,
 *   customers?: { name?: string | null } | null,
 * }} SubmissionRow
 */

/**
 * @param {{ supabase: any }} deps
 */
function createSubmissionsService({ supabase }) {
  return {
    /**
     * The newest submissions, newest first, each with the name of its lead joined in.
     * @returns {Promise<SubmissionRow[]>}
     */
    async list() {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*, customers(name)')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw new SubmissionsUnavailable(error.message);
      return data || [];
    },

    /**
     * Delete one. A submission that is already gone is not an error: the person wanted it gone, and it is.
     * @param {number | string} id
     * @returns {Promise<void>}
     */
    async remove(id) {
      const { error } = await supabase.from('form_submissions').delete().eq('id', id);
      if (error) throw new SubmissionsUnavailable(error.message);
    },
  };
}

/**
 * A stored row as /api/v1 and the app have it (contracts: schemas.Submission): text columns that are null are empty, the
 * lead's name is flattened out of the join, and a submission that matched no lead has none.
 * @param {SubmissionRow} row
 */
function toSubmission(row) {
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    message: row.message || '',
    car_interest: row.car_interest || '',
    source: row.source || '',
    customer_id: row.customer_id ?? null,
    lead_name: (row.customers && row.customers.name) || '',
    created_at: String(row.created_at ?? ''),
  };
}

module.exports = {
  LIMIT,
  STORED_ID,
  SubmissionsUnavailable,
  createSubmissionsService,
  toSubmission,
};
