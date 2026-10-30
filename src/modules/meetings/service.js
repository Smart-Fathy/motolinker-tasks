'use strict';
// Scheduled meetings: the Meet page's list, scheduling, editing and cancelling — and what scheduling does behind the answer:
// the meeting is written to the company's Google Calendar (which also makes the Meet link when there is none) and to the
// calendars attendees connected themselves, and every attendee but the scheduler is told.
//
// One piece of code for both portals' classic routes and for /api/v1. Who asks is an actor (`actor.key` is 'admin' or
// 'employee_<id>', the value rows are filed under, and `actor.name` is how the others hear of them); whether they may is the
// route's question (`meet.view`, `meet.schedule`). Google and the notification store are passed in, never reached for.
//
// Everything that happens after the answer is returned as a function (`behind`) for the route to start once it has answered, so
// that scheduling never waits for Google — and so that a test can wait for it.

/** How many are listed. */
const LIMIT = 100;

/** The recent past stays in the list, so a meeting that has just ended can still be seen. */
const RECENT_PAST_MS = 24 * 3600e3;

/** What the id of a stored meeting looks like: digits, no more than a bigint holds. */
const STORED_ID = /^\d{1,18}$/;

/** What was sent is not a meeting: it has no title, or no start time that is a time. */
class MeetingInvalid extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'MeetingInvalid';
  }
}

/** There is no such meeting. The message is the database's own. */
class MeetingNotFound extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'meeting not found');
    this.name = 'MeetingNotFound';
  }
}

/** The database could not be asked, or refused. */
class MeetingsUnavailable extends Error {
  /** @param {string} [why] */
  constructor(why) {
    super(why || 'meetings are unavailable');
    this.name = 'MeetingsUnavailable';
  }
}

/**
 * A stored meeting. `attendee_ids` are employee ids as text; `calendar_events` are the Google event ids kept per target
 * ('company', or an employee id), so that a reschedule patches an event rather than making another.
 * @typedef {{
 *   id: number,
 *   title: string,
 *   description: string | null,
 *   starts_at: string,
 *   duration_min: number | null,
 *   attendee_ids: string[] | null,
 *   meet_link: string | null,
 *   calendar_events: Record<string, string> | null,
 *   created_by: string | null,
 *   created_at: string,
 * }} MeetingRow
 * @typedef {import('@motolinker/contracts').Actor} Actor
 */

/**
 * What a meeting row is made of, from whatever was sent. A title and a start time that is a time are required; the length is
 * a whole number of minutes from 5 to 480 (30 when it is not a number); attendees are ids as text, the empty ones dropped.
 * @param {any} b
 * @returns {{ title: string, description: string, starts_at: string, duration_min: number, attendee_ids: string[], meet_link: string }}
 */
function buildRow(b) {
  const title = String((b && b.title) || '').trim();
  if (!title) throw new MeetingInvalid('Title is required');
  const starts = new Date((b && b.starts_at) || '');
  if (isNaN(starts.getTime())) throw new MeetingInvalid('A valid start time is required');
  return {
    title,
    description: String(b.description || '').trim(),
    starts_at: starts.toISOString(),
    duration_min: Math.min(480, Math.max(5, parseInt(b.duration_min) || 30)),
    attendee_ids: (Array.isArray(b.attendee_ids) ? b.attendee_ids : []).map(String).filter(Boolean),
    meet_link: String(b.meet_link || '').trim(),
  };
}

/**
 * The Google Calendar event for a meeting.
 * @param {{ id: number, title: string, description?: string | null, starts_at: string, duration_min?: number | null, meet_link?: string | null }} m
 * @param {{ email: string }[] | null} attendees  who Google invites (the company's event only)
 * @param {boolean} withMeetLink  ask Google to make a Meet link
 */
function meetingEventBody(m, attendees, withMeetLink) {
  const start = new Date(m.starts_at);
  const end = new Date(start.getTime() + (m.duration_min || 30) * 60000);
  /** @type {Record<string, any>} */
  const body = {
    summary: m.title,
    description: [m.description || '', m.meet_link ? `Meet: ${m.meet_link}` : '']
      .filter(Boolean)
      .join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
  if (attendees && attendees.length) body.attendees = attendees;
  if (withMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: 'ml-meet-' + m.id,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }
  return body;
}

/**
 * @param {{
 *   supabase: any,
 *   notify: (memberKey: string, telling: { type: string, title: string, body?: string, url?: string }, pushMode?: 'always' | 'offline') => Promise<unknown>,
 *   getCalendarToken: () => Promise<string | null>,
 *   getEmployeeCalendarToken: (employeeId: number) => Promise<string | null>,
 *   upsertCalendarEvent: (token: string, body: object, existingId: string | undefined, invite: boolean) => Promise<{ id?: string, gone?: boolean } | null>,
 *   fetch: typeof fetch,
 * }} deps
 */
function createMeetingsService({
  supabase,
  notify,
  getCalendarToken,
  getEmployeeCalendarToken,
  upsertCalendarEvent,
  fetch,
}) {
  // Same shape as syncing a task to the calendar: personal events for connected attendees, one company invite for the rest,
  // ids tracked per target so a reschedule patches instead of duplicating.
  /** @param {MeetingRow} meeting */
  async function syncMeetingToCalendar(meeting) {
    try {
      const ids = (meeting.attendee_ids || []).map(Number).filter(n => !isNaN(n));
      const { data: emps } = ids.length
        ? await supabase.from('employees').select('id,name,email').in('id', ids)
        : { data: [] };
      const prior =
        meeting.calendar_events && typeof meeting.calendar_events === 'object'
          ? { ...meeting.calendar_events }
          : {};
      /** @type {Record<string, string>} */
      const next = { ...prior };
      let changed = false;
      let meetLink = meeting.meet_link || '';

      // The company event goes FIRST when Google has to make the Meet link, so the personal events can carry it in their notes.
      const inviteesAll = (emps || [])
        .filter((/** @type {any} */ e) => e.email)
        .map((/** @type {any} */ e) => ({ email: e.email }));
      const companyToken = await getCalendarToken();
      if (companyToken) {
        const wantLink = !meetLink;
        const url = next['company']
          ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(next['company'])}?sendUpdates=all&conferenceDataVersion=1`
          : 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1';
        const r = await fetch(url, {
          method: next['company'] ? 'PATCH' : 'POST',
          headers: { Authorization: `Bearer ${companyToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(
            meetingEventBody({ ...meeting, meet_link: meetLink }, inviteesAll, wantLink),
          ),
        });
        const ev =
          /** @type {{ id?: string, hangoutLink?: string, error?: { message?: string } }} */ (
            await r.json()
          );
        if (r.ok) {
          if (next['company'] !== ev.id) {
            next['company'] = /** @type {string} */ (ev.id);
            changed = true;
          }
          if (!meetLink && ev.hangoutLink) {
            meetLink = ev.hangoutLink;
            changed = true;
          }
        } else if (next['company'] && (r.status === 404 || r.status === 410)) {
          delete next['company'];
          changed = true;
        } else if (!r.ok) {
          console.warn('[meetings] company event failed:', ev.error && ev.error.message);
        }
      }

      // Personal calendars for attendees who connected their own.
      for (const emp of emps || []) {
        try {
          const token = await getEmployeeCalendarToken(emp.id);
          if (!token) continue;
          const key = String(emp.id);
          const r = await upsertCalendarEvent(
            token,
            meetingEventBody({ ...meeting, meet_link: meetLink }, null, false),
            next[key],
            false,
          );
          if (r && r.gone) {
            delete next[key];
            changed = true;
            continue;
          }
          if (r && next[key] !== r.id) {
            next[key] = /** @type {string} */ (r.id);
            changed = true;
          }
        } catch (e) {
          console.warn(
            '[meetings] employee',
            emp.id,
            'sync failed:',
            e instanceof Error ? e.message : e,
          );
        }
      }

      if (changed || meetLink !== (meeting.meet_link || '')) {
        await supabase
          .from('meetings')
          .update({ calendar_events: next, meet_link: meetLink })
          .eq('id', meeting.id);
      }
    } catch (e) {
      console.warn('[meetings] sync error:', e instanceof Error ? e.message : e);
    }
  }

  /** @param {MeetingRow} meeting */
  async function deleteMeetingEvents(meeting) {
    const evs =
      meeting.calendar_events && typeof meeting.calendar_events === 'object'
        ? meeting.calendar_events
        : {};
    for (const [key, evId] of Object.entries(evs)) {
      try {
        const token =
          key === 'company'
            ? await getCalendarToken()
            : await getEmployeeCalendarToken(Number(key));
        if (token) {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(evId)}${key === 'company' ? '?sendUpdates=all' : ''}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
          ).catch(() => {});
        }
      } catch (_) {
        /* best effort */
      }
    }
  }

  /**
   * @param {MeetingRow} meeting
   * @param {Actor} actor
   */
  async function notifyAttendees(meeting, actor) {
    await Promise.all(
      (meeting.attendee_ids || []).map(async id => {
        if (`employee_${id}` === actor.key) return; // not yourself
        try {
          await notify(
            `employee_${id}`,
            {
              type: 'task',
              title: `${actor.name} scheduled a meeting`,
              body: `${meeting.title} — ${new Date(meeting.starts_at).toLocaleString()}`,
              url: '/employee#meet',
            },
            'always',
          );
        } catch (e) {
          console.warn('[meetings] notify failed:', e instanceof Error ? e.message : e);
        }
      }),
    );
  }

  return {
    /**
     * The upcoming meetings and the recent past, soonest first (the caller has checked that the actor may see them).
     * @returns {Promise<MeetingRow[]>}
     */
    async list() {
      const since = new Date(Date.now() - RECENT_PAST_MS).toISOString();
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .gte('starts_at', since)
        .order('starts_at', { ascending: true })
        .limit(LIMIT);
      if (error) throw new MeetingsUnavailable(error.message);
      return data || [];
    },

    /**
     * Schedule a meeting. The meeting is returned at once; `behind()` writes it to the calendars and tells the attendees, and
     * resolves when it is done (it never rejects).
     * @param {Actor} actor
     * @param {unknown} input
     * @returns {Promise<{ meeting: MeetingRow, behind: () => Promise<void> }>}
     */
    async create(actor, input) {
      const row = { ...buildRow(input), created_by: actor.key };
      const { data, error } = await supabase.from('meetings').insert(row).select().single();
      if (error) throw new MeetingsUnavailable(error.message);
      return {
        meeting: data,
        behind: async () => {
          await Promise.all([syncMeetingToCalendar(data), notifyAttendees(data, actor)]);
        },
      };
    },

    /**
     * Change a meeting, and write the change to the calendars. Nobody is told again.
     * @param {number | string} id
     * @param {unknown} input
     * @returns {Promise<{ meeting: MeetingRow, behind: () => Promise<void> }>}
     */
    async update(id, input) {
      const row = buildRow(input);
      const { data, error } = await supabase
        .from('meetings')
        .update(row)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        // PGRST116: the answer had no row in it — there is no such meeting
        if (error.code === 'PGRST116') throw new MeetingNotFound(error.message);
        throw new MeetingsUnavailable(error.message);
      }
      return { meeting: data, behind: () => syncMeetingToCalendar(data) };
    },

    /**
     * Cancel a meeting. Cancelling what is already gone is nothing. `behind()` removes its events from every calendar.
     * @param {number | string} id
     * @returns {Promise<{ behind: () => Promise<void> }>}
     */
    async remove(id) {
      const { data: meeting } = await supabase.from('meetings').select('*').eq('id', id).single();
      const { error } = await supabase.from('meetings').delete().eq('id', id);
      if (error) throw new MeetingsUnavailable(error.message);
      return {
        behind: async () => {
          if (meeting) await deleteMeetingEvents(meeting);
        },
      };
    },
  };
}

/**
 * A stored meeting as /api/v1 hands it out: what the Meet page and the calendar read. The Google event ids are the server's.
 * @param {MeetingRow} row
 */
function toMeeting(row) {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    starts_at: row.starts_at,
    duration_min: row.duration_min || 30,
    attendee_ids: (row.attendee_ids || []).map(String),
    meet_link: row.meet_link || '',
    created_by: row.created_by || '',
    created_at: row.created_at,
  };
}

module.exports = {
  LIMIT,
  STORED_ID,
  MeetingInvalid,
  MeetingNotFound,
  MeetingsUnavailable,
  buildRow,
  meetingEventBody,
  toMeeting,
  createMeetingsService,
};
