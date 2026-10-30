'use strict';
// What is happening in a window of time, for one person: the tasks due in it, the meetings they are in, the lead follow-ups
// they promised. One piece of code for both portals' classic routes and for /api/v1.
//
// The admin is the company's diary — every task, every meeting, every pending follow-up. An employee sees their own: the
// tasks assigned to them (by either way a task is assigned), the meetings they are in or booked, the follow-ups assigned to
// them. Each source is gated by what it is — `tasks.view`, `meet.view`, `leads.view` — not by the Calendar page: somebody
// without one of them gets no rows of that kind, never a refusal for the whole page.
//
// A source that cannot be read is an empty source, which a person cannot tell from a quiet month. The classic pages have
// always lived with that; /api/v1 asks for `strict` and is told which sources were unreadable (`unreadable`), and says so.

const { can } = require('@motolinker/contracts');

/** How many rows of each kind a window can hold. */
const LIMITS = Object.freeze({ tasks: 500, meetings: 300, followups: 300 });

const DAY_MS = 864e5;

/** The window is not two dates. */
class CalendarInvalid extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'CalendarInvalid';
  }
}

/**
 * A day either side of the requested window: a month grid shows the tail of the previous month and the head of the next, and a
 * meeting on those days is still a meeting the person has to be at. Without a window it is now, for a month.
 * @param {{ from?: unknown, to?: unknown }} q
 * @returns {{ from: Date, to: Date }}
 */
function windowOf(q) {
  const from = new Date(/** @type {any} */ (q.from) || Date.now());
  const to = new Date(/** @type {any} */ (q.to) || Date.now() + 31 * DAY_MS);
  if (isNaN(from.getTime()) || isNaN(to.getTime()))
    throw new CalendarInvalid('from and to must be dates');
  return { from: new Date(from.getTime() - DAY_MS), to: new Date(to.getTime() + DAY_MS) };
}

const day = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);

/**
 * @typedef {import('@motolinker/contracts').Actor} Actor
 * @typedef {{
 *   id: number, title: string, description: string, due_date: string, status: string, priority: string,
 *   milestone: string, assignee_ids: string[], channel_name: string,
 * }} CalendarTask
 * @typedef {{ id: number, due_at: string, note: string, customer_id: number, customer_name: string }} CalendarFollowup
 * @typedef {import('../meetings/service').MeetingRow} MeetingRow
 * @typedef {{
 *   from: string, to: string, tasks: CalendarTask[], meetings: MeetingRow[], followups: CalendarFollowup[],
 * }} CalendarFeed
 */

/**
 * @param {{
 *   supabase: any,
 *   fetchEmployeeTasks: (employeeId: number, opts?: { strict?: boolean }) => Promise<any[]>,
 * }} deps
 */
function createCalendarService({ supabase, fetchEmployeeTasks }) {
  return {
    /**
     * Everything the actor is expected at, in the window around `query` (see windowOf).
     * @param {Actor} actor
     * @param {{ from?: unknown, to?: unknown }} query
     * @param {{ strict?: boolean }} [opts]  strict: ask every source for its errors, and say which could not be read
     * @returns {Promise<{ feed: CalendarFeed, unreadable: ('tasks' | 'meetings' | 'followups')[] }>}
     */
    async feed(actor, query, { strict = false } = {}) {
      const w = windowOf(query || {});
      const mine = actor.kind === 'employee';
      const may = (/** @type {string} */ cap) => can(actor, cap);
      /** @type {('tasks' | 'meetings' | 'followups')[]} */
      const unreadable = [];
      /** A source that failed: remembered, and then empty. @param {'tasks' | 'meetings' | 'followups'} source @param {unknown} e */
      const lost = (source, e) => {
        if (strict) unreadable.push(source);
        console.warn('[calendar]', source, e instanceof Error ? e.message : e);
        return [];
      };

      // ── Tasks, by due date ────────────────────────────────────────────────────
      const tasks = async () => {
        if (!may('tasks.view')) return [];
        try {
          /** @type {any[]} */
          let rows;
          if (mine) {
            const all = await fetchEmployeeTasks(/** @type {number} */ (actor.id), { strict });
            rows = (all || []).filter(
              t => t.due_date && t.due_date >= day(w.from) && t.due_date <= day(w.to),
            );
          } else {
            const { data, error } = await supabase
              .from('tasks')
              .select('*')
              .gte('due_date', day(w.from))
              .lte('due_date', day(w.to))
              .limit(LIMITS.tasks);
            if (error && strict) throw new Error(error.message);
            rows = data || [];
          }
          return rows.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description || '',
            due_date: t.due_date,
            status: t.status,
            priority: t.priority,
            milestone: t.milestone || '',
            assignee_ids: t.assignee_ids || [],
            channel_name: t.channel_name || '',
          }));
        } catch (e) {
          return lost('tasks', e);
        }
      };

      // ── Meetings ──────────────────────────────────────────────────────────────
      const meetings = async () => {
        if (!may('meet.view')) return [];
        try {
          const { data, error } = await supabase
            .from('meetings')
            .select('*')
            .gte('starts_at', w.from.toISOString())
            .lte('starts_at', w.to.toISOString())
            .order('starts_at', { ascending: true })
            .limit(LIMITS.meetings);
          if (error && strict) throw new Error(error.message);
          // An employee sees the meetings they are in or booked, not the company's diary.
          return (data || []).filter(
            (/** @type {MeetingRow} */ m) =>
              !mine ||
              (m.attendee_ids || []).map(String).includes(String(actor.id)) ||
              m.created_by === actor.key,
          );
        } catch (e) {
          return lost('meetings', e);
        }
      };

      // ── Lead follow-ups ───────────────────────────────────────────────────────
      const followups = async () => {
        if (!may('leads.view')) return [];
        try {
          let q = supabase
            .from('lead_followups')
            .select('*')
            .eq('status', 'pending')
            .gte('due_at', w.from.toISOString())
            .lte('due_at', w.to.toISOString())
            .order('due_at', { ascending: true })
            .limit(LIMITS.followups);
          if (mine) q = q.eq('assigned_to', actor.id);
          const { data, error } = await q;
          if (error && strict) throw new Error(error.message);
          const rows = data || [];
          // One lookup for the names, rather than one per follow-up.
          const ids = [
            ...new Set(rows.map((/** @type {any} */ f) => f.customer_id).filter(Boolean)),
          ];
          /** @type {Record<string, string>} */
          const names = {};
          if (ids.length) {
            const { data: cs, error: namesError } = await supabase
              .from('customers')
              .select('id,name')
              .in('id', ids);
            if (namesError && strict) throw new Error(namesError.message);
            (cs || []).forEach((/** @type {any} */ c) => {
              names[c.id] = c.name;
            });
          }
          return rows.map((/** @type {any} */ f) => ({
            id: f.id,
            due_at: f.due_at,
            note: f.note || '',
            customer_id: f.customer_id,
            customer_name: names[f.customer_id] || '',
          }));
        } catch (e) {
          return lost('followups', e);
        }
      };

      const [t, m, f] = await Promise.all([tasks(), meetings(), followups()]);
      return {
        feed: { from: day(w.from), to: day(w.to), tasks: t, meetings: m, followups: f },
        unreadable,
      };
    },
  };
}

module.exports = { LIMITS, CalendarInvalid, windowOf, createCalendarService };
