'use strict';
// The Issues centre: tickets the team reports to the Chief Technical Officer, who reads and closes them, and the
// conversation on each one that both ends can read — the person who reported it, and whoever may manage the centre.
//
// One piece of code for the team portal's routes and for /api/v1 (which the admin can use as well): the person is an actor,
// and nothing here knows about requests. It takes what it needs as arguments — the database, a way to tell someone
// (`notify`), and what makes a stored file's address safe to keep — never the context, and it says what went wrong: the
// classic routes answer in their own words, /api/v1 in its own.

const { can } = require('@motolinker/contracts');

/** How many tickets are listed, and replies on one: the newest, and the oldest. */
const LIMIT = 200;

/** What the id of a stored ticket looks like: digits, no more than a bigint holds. */
const STORED_ID = /^\d{1,18}$/;

/** The job title that receives the tickets: matched anywhere in the title and in any case, so a deputy counts. */
const CTO_TITLE = '%chief technical officer%';

/** What a refused attachment is told. */
const ATTACH_REFUSED = 'Attachments must be uploaded through the app.';

/** The database could not be asked, or refused. */
class IssuesUnavailable extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'the issues centre is unavailable');
    this.name = 'IssuesUnavailable';
  }
}
/** There is no such ticket (or the database has no row for it). */
class IssueNotFound extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'Issue not found');
    this.name = 'IssueNotFound';
  }
}
/** This actor may not do that to this ticket. */
class IssueForbidden extends Error {
  constructor() {
    super('Not permitted');
    this.name = 'IssueForbidden';
  }
}
/** What was sent cannot be a ticket or a reply: `why` is a word for a program, the message words for a person. */
class IssueInvalid extends Error {
  /** @param {string} message @param {'empty' | 'attachment'} why */
  constructor(message, why) {
    super(message);
    this.name = 'IssueInvalid';
    this.why = why;
  }
}
/** The attachment could not be stored. */
class AttachmentFailed extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'the attachment could not be stored');
    this.name = 'AttachmentFailed';
  }
}

/**
 * @typedef {{
 *   id: number,
 *   title: string | null,
 *   description: string | null,
 *   file_url: string | null,
 *   reporter_id: number | null,
 *   reporter_name: string | null,
 *   status: string | null,
 *   created_at: string,
 *   resolved_at?: string | null,
 *   resolved_by?: string | null,
 * }} IssueRow
 * @typedef {{
 *   id: number,
 *   issue_id: number,
 *   author_key: string,
 *   author_name: string | null,
 *   body: string | null,
 *   file_url: string | null,
 *   file_name: string | null,
 *   file_size: number | null,
 *   file_type: string | null,
 *   created_at: string,
 * }} CommentRow
 * @typedef {import('@motolinker/contracts').Actor} Actor
 * @typedef {{ originalname?: string, buffer: Buffer | Uint8Array, mimetype?: string }} Upload
 * @typedef {{ type: string, title: string, body?: string, url?: string }} Telling
 */

/**
 * @param {{
 *   supabase: any,
 *   notify: (memberKey: string, telling: Telling, pushMode?: 'always' | 'offline') => Promise<unknown>,
 *   safeFileUrl: (v: unknown) => string,
 * }} deps
 */
function createIssuesService({ supabase, notify, safeFileUrl }) {
  /** Tell someone, and never let the telling be what fails the thing that was done. */
  /** @param {string} what @param {() => Promise<unknown>} tell */
  const tellSafely = async (what, tell) => {
    try {
      await tell();
    } catch (e) {
      console.warn(`[issues] ${what} notify failed:`, e instanceof Error ? e.message : e);
    }
  };

  /**
   * The ticket, if this actor may see it: the admin and anyone who may read the centre may see any; the person who reported
   * one may see their own — otherwise the CTO's reply would land where nobody can read it.
   * @param {Actor} actor
   * @param {number | string} rawId
   * @returns {Promise<IssueRow>}
   */
  async function issueFor(actor, rawId) {
    const id = parseInt(String(rawId), 10);
    const { data } = id
      ? await supabase.from('issues').select('*').eq('id', id).single()
      : { data: null };
    if (!data) throw new IssueNotFound('Issue not found');
    if (actor.kind === 'admin') return data;
    if (can(actor, 'issues.view')) return data;
    if (String(data.reporter_id || '') === String(actor.id)) return data;
    throw new IssueForbidden();
  }

  return {
    /**
     * Every ticket, newest first (the caller has checked that the actor may read the centre).
     * @returns {Promise<IssueRow[]>}
     */
    async list() {
      const { data, error } = await supabase
        .from('issues')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw new IssuesUnavailable(error.message);
      return data || [];
    },

    /**
     * Close a ticket, or reopen it. Closing records who did it and when (so the reporter's notice can name them) and tells
     * the reporter — once: closing what is already closed tells nobody again. The caller has checked that the actor may.
     * @param {Actor} actor
     * @param {number | string} id
     * @param {'open' | 'resolved'} status
     * @returns {Promise<IssueRow>}
     */
    async setStatus(actor, id, status) {
      const closer = actor.kind === 'admin' ? 'Admin' : actor.name;
      const { data: before } = await supabase.from('issues').select('*').eq('id', id).single();
      // resolved_at / resolved_by arrive with migration 017; on a database that has not taken it yet the write is retried
      // without them so closing still works.
      const stamped =
        status === 'resolved'
          ? { status, resolved_at: new Date().toISOString(), resolved_by: closer }
          : { status, resolved_at: null, resolved_by: '' };
      let { data, error } = await supabase
        .from('issues')
        .update(stamped)
        .eq('id', id)
        .select()
        .single();
      if (error)
        ({ data, error } = await supabase
          .from('issues')
          .update({ status })
          .eq('id', id)
          .select()
          .single());
      if (error) {
        // PGRST116: the answer had no row in it — there is no such ticket
        if (error.code === 'PGRST116') throw new IssueNotFound(error.message);
        throw new IssuesUnavailable(error.message);
      }
      // Tell whoever reported it that it is closed — they never hear back otherwise.
      const wasOpen = String(before?.status || 'open') !== 'resolved';
      if (status === 'resolved' && wasOpen && before?.reporter_id) {
        await tellSafely('resolve', () =>
          notify(
            `employee_${before.reporter_id}`,
            {
              type: 'issue',
              title: `Solved: ${before.title || 'System issue'}`,
              body: `${closer} marked the issue you reported as solved.`,
              url: '/employee#issues',
            },
            'always',
          ),
        );
      }
      return data;
    },

    /**
     * The replies on a ticket, oldest first.
     * @param {Actor} actor
     * @param {number | string} id
     * @returns {Promise<CommentRow[]>}
     */
    async comments(actor, id) {
      const issue = await issueFor(actor, id);
      const { data, error } = await supabase
        .from('issue_comments')
        .select('*')
        .eq('issue_id', issue.id)
        .order('created_at', { ascending: true })
        .limit(LIMIT);
      if (error) throw new IssuesUnavailable(error.message);
      return data || [];
    },

    /**
     * Reply on a ticket: words, a file this app stored, or both. Both ends hear about a reply — the person who reported the
     * ticket, and every Chief Technical Officer — except whoever wrote it.
     * @param {Actor} actor
     * @param {number | string} id
     * @param {{ body?: unknown, file_url?: unknown, file_name?: unknown, file_size?: unknown, file_type?: unknown }} input
     * @returns {Promise<CommentRow>}
     */
    async addComment(actor, id, input) {
      const issue = await issueFor(actor, id);
      const text = String(input.body || '')
        .trim()
        .slice(0, 2000);
      const fileUrl = safeFileUrl(input.file_url);
      if (input.file_url && !fileUrl) throw new IssueInvalid(ATTACH_REFUSED, 'attachment');
      if (!text && !fileUrl) throw new IssueInvalid('Comment is empty', 'empty');
      const authorKey = actor.key;
      const authorName = actor.kind === 'admin' ? 'Admin' : actor.name;
      const { data, error } = await supabase
        .from('issue_comments')
        .insert({
          issue_id: issue.id,
          author_key: authorKey,
          author_name: authorName,
          body: text,
          file_url: fileUrl,
          file_name: String(input.file_name || ''),
          file_size: input.file_size || null,
          file_type: String(input.file_type || ''),
        })
        .select()
        .single();
      if (error) throw new IssuesUnavailable(error.message);
      await tellSafely('comment', async () => {
        const recipients = new Set();
        if (issue.reporter_id) recipients.add(`employee_${issue.reporter_id}`);
        const { data: ctos } = await supabase
          .from('employees')
          .select('id')
          .ilike('job_title', CTO_TITLE);
        (ctos || []).forEach(
          /** @param {{ id: number }} c */ c => recipients.add(`employee_${c.id}`),
        );
        recipients.delete(authorKey);
        for (const key of recipients) {
          await notify(key, {
            type: 'issue',
            title: `${authorName} commented on: ${issue.title || 'System issue'}`,
            body: text || `\u{1F4CE} ${input.file_name || 'attachment'}`,
            url: '/employee#issues',
          });
        }
      });
      return data;
    },

    /**
     * Report a ticket. It is kept so the CTO can manage it in the centre, and every Chief Technical Officer is told (the admin
     * is, if the team has none). A title or details are needed, either; what is longer than a ticket should be is cut.
     *
     * A ticket that cannot be stored is still announced — the notice carries all its words, and it is what reaches a person —
     * unless the caller asks to be told instead (`strict`), in which case nothing is announced.
     * @param {Actor} actor
     * @param {{ title?: unknown, description?: unknown, file?: Upload | null }} input
     * @param {{ strict?: boolean }} [options]
     * @returns {Promise<{ file: string }>} the address of the attachment, or empty
     */
    async report(actor, input, { strict = false } = {}) {
      const title = String(input.title || '')
        .trim()
        .slice(0, 150);
      const description = String(input.description || '')
        .trim()
        .slice(0, 2000);
      if (!title && !description) throw new IssueInvalid('Please describe the issue', 'empty');
      let fileUrl = '';
      if (input.file) {
        const safe = (input.file.originalname || 'attachment')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(-80);
        const path = `issues/${Date.now()}_${safe}`;
        const { data, error } = await supabase.storage
          .from('chat-files')
          .upload(path, input.file.buffer, { contentType: input.file.mimetype, upsert: false });
        if (error) throw new AttachmentFailed(error.message);
        const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(data.path);
        fileUrl = urlData?.publicUrl || '';
      }
      const bodyText = [description || title, fileUrl ? `Attachment: ${fileUrl}` : '']
        .filter(Boolean)
        .join('\n');
      const { error: storeError } = await supabase.from('issues').insert({
        title: title || 'System issue',
        description,
        file_url: fileUrl,
        reporter_id: actor.id,
        reporter_name: actor.name,
        status: 'open',
      });
      if (storeError) {
        console.warn('[issues] persist failed:', storeError.message);
        if (strict) throw new IssuesUnavailable(storeError.message);
      }
      // Route to every employee whose job title is Chief Technical Officer (fallback: admin)
      const { data: ctos } = await supabase
        .from('employees')
        .select('id,name')
        .ilike('job_title', CTO_TITLE);
      const heading = `Issue reported by ${actor.name}: ${title || 'System issue'}`;
      if (ctos?.length) {
        for (const cto of ctos) {
          await notify(
            `employee_${cto.id}`,
            { type: 'issue', title: heading, body: bodyText, url: '/employee#issues' },
            'always',
          );
        }
      } else {
        await notify(
          'admin',
          { type: 'issue', title: heading, body: bodyText, url: '/dashboard#notif' },
          'always',
        );
      }
      return { file: fileUrl };
    },
  };
}

/**
 * A stored ticket as /api/v1 and the app have it (contracts: schemas.Issue): text columns that are null are empty, and any
 * status that is not "resolved" is "open".
 * @param {IssueRow} row
 */
function toIssue(row) {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    file_url: row.file_url || '',
    reporter_id: row.reporter_id ?? null,
    reporter_name: row.reporter_name || '',
    status: String(row.status || 'open') === 'resolved' ? 'resolved' : 'open',
    created_at: String(row.created_at ?? ''),
    resolved_at: row.resolved_at ?? null,
    resolved_by: row.resolved_by || '',
  };
}

/**
 * A stored reply as /api/v1 and the app have it (contracts: schemas.IssueComment).
 * @param {CommentRow} row
 */
function toIssueComment(row) {
  return {
    id: row.id,
    issue_id: row.issue_id,
    author_key: row.author_key,
    author_name: row.author_name || '',
    body: row.body || '',
    file_url: row.file_url || '',
    file_name: row.file_name || '',
    file_size: row.file_size ?? null,
    file_type: row.file_type || '',
    created_at: String(row.created_at ?? ''),
  };
}

module.exports = {
  LIMIT,
  STORED_ID,
  ATTACH_REFUSED,
  IssuesUnavailable,
  IssueNotFound,
  IssueForbidden,
  IssueInvalid,
  AttachmentFailed,
  createIssuesService,
  toIssue,
  toIssueComment,
};
