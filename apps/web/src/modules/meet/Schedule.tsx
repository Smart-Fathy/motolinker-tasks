import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { useAssistantRecord } from '../../assistant';
import { useSession } from '../../app/context';
import { BrandSelect, Btn, Sheet } from '../../ui';
import { fetchChoices, useMeetingActions } from './data';
import {
  bodyOf,
  DURATIONS,
  draftOf,
  SAID,
  type Draft,
  type Meeting,
  type Person,
  type Room,
  type Where,
} from './model';
import styles from './schedule.module.css';

interface SheetProps {
  /** the meeting being changed, or none for a new one */
  meeting: Meeting | null;
  /** a day picked on the calendar seeds the date */
  seed?: { date?: string } | undefined;
  people: readonly Person[];
  rooms: readonly Room[];
  onClose: () => void;
}

/**
 * "Schedule a meeting" / "Edit meeting": a title, when, how long, who is invited, where it is held, and notes. It says what is
 * wrong with a meeting before it sends it, and what went wrong after; it stays open when the server would not take it. A
 * meeting lands on every attendee's Google Calendar, and anyone without a connected calendar is invited by email.
 */
export function ScheduleSheet({ meeting, seed, people, rooms, onClose }: SheetProps) {
  const { toasts } = useSession();
  const { save } = useMeetingActions();
  const ids = {
    title: useId(),
    date: useId(),
    time: useId(),
    duration: useId(),
    where: useId(),
    room: useId(),
    link: useId(),
    notes: useId(),
  };
  const [draft, setDraft] = useState<Draft>(() => draftOf(meeting, seed, rooms));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(d => ({ ...d, [key]: value }));
  const toggle = (id: string, on: boolean) =>
    setDraft(d => ({
      ...d,
      attendees: on ? [...d.attendees, id] : d.attendees.filter(a => a !== id),
    }));

  const submit = async () => {
    const out = bodyOf(draft);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    setBusy(true);
    setError('');
    const saved = await save(meeting ? meeting.id : null, out.body);
    setBusy(false);
    if (saved.ok) {
      onClose();
      toasts.show(meeting ? SAID.updated : SAID.scheduled);
    } else {
      setError(saved.message);
    }
  };

  // A meeting whose length is not one the sheet offers keeps it (rather than quietly becoming fifteen minutes).
  const lengths: number[] = DURATIONS.includes(draft.duration as (typeof DURATIONS)[number])
    ? [...DURATIONS]
    : [...DURATIONS, draft.duration].sort((a, b) => a - b);

  return (
    <Sheet
      title={meeting ? 'Edit meeting' : 'Schedule a meeting'}
      onClose={onClose}
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="primary" data-part="submit" disabled={busy} onClick={() => void submit()}>
            {meeting ? 'Save & re-sync calendars' : 'Schedule'}
          </Btn>
        </>
      }
    >
      <Group label="Title" htmlFor={ids.title}>
        <input
          id={ids.title}
          className={styles['control']}
          data-part="titleInput"
          maxLength={200}
          placeholder="e.g. Weekly sales sync"
          value={draft.title}
          onChange={e => set('title', e.target.value)}
        />
      </Group>
      <div className={styles['trio']} data-part="trio">
        <Group label="Date" htmlFor={ids.date}>
          <input
            id={ids.date}
            className={styles['control']}
            data-part="dateInput"
            type="date"
            value={draft.date}
            onChange={e => set('date', e.target.value)}
          />
        </Group>
        <Group label="Time" htmlFor={ids.time}>
          <input
            id={ids.time}
            className={styles['control']}
            data-part="timeInput"
            type="time"
            value={draft.time}
            onChange={e => set('time', e.target.value)}
          />
        </Group>
        <Group label="Duration" htmlFor={ids.duration}>
          <BrandSelect
            id={ids.duration}
            part="durationSelect"
            value={String(draft.duration)}
            options={lengths.map(d => ({ value: String(d), label: `${d} min` }))}
            onChange={v => set('duration', Number(v))}
          />
        </Group>
      </div>
      <Group label="Attendees" labelled="group">
        <div
          className={styles['attendees']}
          data-part="attendees"
          role="group"
          aria-label="Attendees"
        >
          {people.length ? (
            people.map(p => (
              <label key={p.id} className={styles['attendee']} data-part="attendee">
                <input
                  type="checkbox"
                  className={styles['tick']}
                  value={p.id}
                  checked={draft.attendees.includes(p.id)}
                  onChange={e => toggle(p.id, e.target.checked)}
                />{' '}
                {p.name}
              </label>
            ))
          ) : (
            <span className={styles['nobody']}>No team members found</span>
          )}
        </div>
        <div className={styles['help']} data-part="attendeesHelp">
          Lands on each attendee&apos;s Google Calendar; anyone without a connected calendar is
          invited by email. Leave the link empty and a Google Meet link is created automatically.
        </div>
      </Group>
      <Group label="Where" htmlFor={ids.where}>
        <BrandSelect
          id={ids.where}
          part="whereSelect"
          value={draft.where}
          options={[
            { value: 'meet', label: 'Google Meet — a link is created automatically' },
            {
              value: 'huddle',
              label: `In-app huddle${rooms.length ? '' : ' (no chat rooms yet)'}`,
              disabled: !rooms.length,
            },
            { value: 'link', label: 'A link I already have' },
          ]}
          onChange={v => set('where', v as Where)}
        />
      </Group>
      {draft.where === 'huddle' && (
        <Group label="Huddle in" htmlFor={ids.room}>
          <BrandSelect
            id={ids.room}
            part="roomSelect"
            value={draft.room}
            options={rooms.map(r => ({ value: r.id, label: r.name }))}
            onChange={v => set('room', v)}
          />
          <div className={styles['help']}>
            At the time, everyone gets a Join button that opens the huddle here — no Google account
            needed.
          </div>
        </Group>
      )}
      {draft.where === 'link' && (
        <Group label="Link" htmlFor={ids.link}>
          <input
            id={ids.link}
            className={styles['control']}
            data-part="linkInput"
            placeholder="https://meet.google.com/…"
            value={draft.link}
            onChange={e => set('link', e.target.value)}
          />
        </Group>
      )}
      <Group label="Notes" htmlFor={ids.notes}>
        <textarea
          id={ids.notes}
          className={styles['control']}
          data-part="notesInput"
          rows={2}
          maxLength={2000}
          value={draft.notes}
          onChange={e => set('notes', e.target.value)}
        />
      </Group>
      {error && (
        <div className={styles['error']} data-part="error" role="alert">
          {error}
        </div>
      )}
    </Sheet>
  );
}

function Group({
  label,
  htmlFor,
  labelled,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** a group of controls is named by its own label rather than pointing at one control */
  labelled?: 'group';
  children: ReactNode;
}) {
  return (
    <div className={styles['group']} data-part="group">
      {labelled ? (
        <span className={styles['label']} data-part="label">
          {label}
        </span>
      ) : (
        <label className={styles['label']} htmlFor={htmlFor} data-part="label">
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

/**
 * Opening the scheduling sheet: `open(null)` for a new meeting (a day seeds its date), `open(meeting)` to change one. The
 * people to invite and the rooms to hold a huddle in are asked for as it opens, as the classic sheet does; what cannot be had
 * is nobody, and no rooms.
 */
export function useScheduling(): {
  open: (meeting: Meeting | null, seed?: { date?: string }) => Promise<void>;
  sheet: ReactNode;
} {
  const { api, portal, me } = useSession();
  const qc = useQueryClient();
  const [state, setState] = useState<{
    meeting: Meeting | null;
    seed: { date?: string } | undefined;
    people: Person[];
    rooms: Room[];
  } | null>(null);
  const actorKey = me.actor.key;
  // (what the assistant is told is open: the meeting whose sheet is in front of the person; a new one is not a record yet)
  useAssistantRecord(
    state?.meeting
      ? { kind: 'meeting', id: String(state.meeting.id), title: state.meeting.title, sub: '' }
      : null,
  );
  const open = useCallback(
    async (meeting: Meeting | null, seed?: { date?: string }) => {
      const choices = await fetchChoices(qc, api, portal, actorKey);
      setState({ meeting, seed, ...choices });
    },
    [qc, api, portal, actorKey],
  );
  const sheet = state ? (
    <ScheduleSheet
      key={state.meeting ? state.meeting.id : 'new'}
      meeting={state.meeting}
      seed={state.seed}
      people={state.people}
      rooms={state.rooms}
      onClose={() => setState(null)}
    />
  ) : null;
  return { open, sheet };
}
