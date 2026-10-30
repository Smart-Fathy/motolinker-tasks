import { can } from '@motolinker/contracts/access';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAppTo, useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Btn, BtnLink, Sheet } from '../../ui';
import { cx } from '../../ui/cx';
import {
  classicRoomUrl,
  huddleRoomOf,
  linkUrl,
  MEET_ICONS,
  useScheduling,
  type Meeting,
} from '../meet';
import styles from './calendar.module.css';
import { useCalendarSync, useFeed } from './data';
import {
  CAL_ICONS,
  countsOver,
  dayKey,
  daysOf,
  hhmm,
  isOverdue,
  itemsOn,
  meetingIcon,
  plural,
  rangeOf,
  SAID,
  sameDay,
  startOfMeeting,
  stepped,
  titleOf,
  titleOfDay,
  type CalendarFeed,
  type Item,
  type View,
} from './model';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const EMPTY: Pick<CalendarFeed, 'tasks' | 'meetings' | 'followups'> = {
  tasks: [],
  meetings: [],
  followups: [],
};
const GOOGLE_CALENDAR = 'https://calendar.google.com/calendar/r/week';

/** One thing on a day, as a chip: a meeting (with its time), a follow-up (with the lead), a task (with its state). */
function Chip({ item, onOpen }: { item: Item; onOpen: (item: Item) => void }) {
  if (item.kind === 'meeting') {
    return (
      <button
        type="button"
        className={styles['chip']}
        data-kind="meeting"
        data-part="chip"
        title={item.m.title}
        onClick={() => onOpen(item)}
      >
        <Icon name={meetingIcon(item.m)} size={11} />
        <span className={styles['chipTime']}>{hhmm(item.at)}</span> {item.m.title}
      </button>
    );
  }
  if (item.kind === 'followup') {
    return (
      <button
        type="button"
        className={styles['chip']}
        data-kind="followup"
        data-part="chip"
        title={item.f.note || 'Follow up'}
        onClick={() => onOpen(item)}
      >
        <Icon name={CAL_ICONS.followup} size={11} />
        <span className={styles['chipTime']}>{hhmm(item.at)}</span>{' '}
        {item.f.customer_name || 'Follow-up'}
      </button>
    );
  }
  const done = item.t.status === 'done';
  return (
    <button
      type="button"
      className={cx(styles['chip'], isOverdue(item.t) && styles['overdue'], done && styles['done'])}
      data-kind="task"
      data-part="chip"
      title={item.t.title}
      onClick={() => onOpen(item)}
    >
      <Icon name={done ? CAL_ICONS.taskDone : CAL_ICONS.taskOpen} size={11} />
      {item.t.title}
    </button>
  );
}

/** Everything on a day — what "+2 more" opens, and what a person wants when a day is busy. */
function DaySheet({
  day,
  feed,
  maySchedule,
  onOpen,
  onNew,
  onClose,
}: {
  day: string;
  feed: Pick<CalendarFeed, 'tasks' | 'meetings' | 'followups'>;
  maySchedule: boolean;
  onOpen: (item: Item) => void;
  onNew: (day: string) => void;
  onClose: () => void;
}) {
  const items = itemsOn(feed, new Date(day + 'T12:00:00'));
  return (
    <Sheet
      title={titleOfDay(day)}
      onClose={onClose}
      footer={
        <>
          {maySchedule && (
            <Btn kind="primary" data-part="schedule" onClick={() => onNew(day)}>
              Schedule something
            </Btn>
          )}
          <Btn data-part="close" onClick={onClose}>
            Close
          </Btn>
        </>
      }
    >
      {items.length ? (
        <div className={styles['daylist']} data-part="daylist">
          {items.map((it, i) => (
            <div key={i} className={styles['dayrow']} data-part="dayrow">
              <Chip item={it} onOpen={onOpen} />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles['nothing']} data-part="nothing">
          Nothing scheduled.
        </div>
      )}
    </Sheet>
  );
}

/** A meeting: when, how long, how many, the notes, and a way to join it. */
function MeetingSheet({
  meeting,
  maySchedule,
  onEdit,
  onClose,
}: {
  meeting: Meeting;
  maySchedule: boolean;
  onEdit: (m: Meeting) => void;
  onClose: () => void;
}) {
  const { portal } = useSession();
  const room = huddleRoomOf(meeting.meet_link);
  const href = linkUrl(meeting.meet_link);
  return (
    <Sheet
      title={meeting.title}
      onClose={onClose}
      footer={
        <>
          {room ? (
            <Btn
              kind="primary"
              data-part="join"
              onClick={() => {
                onClose();
                window.open(classicRoomUrl(portal, room), '_blank', 'noopener');
              }}
            >
              <Icon name={MEET_ICONS.huddle} size={14} /> Join huddle
            </Btn>
          ) : href ? (
            <BtnLink kind="primary" data-part="join" href={href} target="_blank" rel="noopener">
              Join
            </BtnLink>
          ) : null}
          {maySchedule && (
            <Btn data-part="edit" onClick={() => onEdit(meeting)}>
              Edit
            </Btn>
          )}
          <Btn data-part="close" onClick={onClose}>
            Close
          </Btn>
        </>
      }
    >
      <div className={styles['detail']} data-part="detail">
        <div data-part="when">
          <strong>{startOfMeeting(meeting)}</strong> · {meeting.duration_min} min ·{' '}
          {meeting.attendee_ids.length} attendee(s)
        </div>
        {meeting.description && (
          <div className={styles['notes']} data-part="notes">
            {meeting.description}
          </div>
        )}
        {room && (
          <div className={styles['huddleNote']} data-part="huddleNote">
            Joins the in-app huddle — audio in MotoLinker, no Google account needed.
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** The admin's link to a Google Calendar that new tasks are added to: its state, and the button that changes it. */
function Sync() {
  const { toasts } = useSession();
  const { loading, status, disconnect, connect } = useCalendarSync(true);
  if (loading) return null;
  const toggle = () => {
    if (!status.connected) {
      connect();
      return;
    }
    if (!window.confirm(SAID.confirmDisconnect)) return;
    void disconnect().then(out => {
      if (!out.ok) toasts.show(out.message);
    });
  };
  return (
    <>
      <span className={styles['syncStatus']} data-part="syncStatus">
        {!status.configured
          ? SAID.notConfigured
          : status.connected
            ? SAID.syncOn(status.email)
            : SAID.syncOff}
      </span>
      {status.configured && (
        <Btn small data-part="syncToggle" onClick={toggle}>
          {status.connected ? SAID.disconnect : SAID.connect}
        </Btn>
      )}
    </>
  );
}

type Dialog = { kind: 'day'; day: string } | { kind: 'meeting'; id: number } | null;

/**
 * The company's calendar, a month or a week at a time: the meetings a person is in, the tasks due, and the leads they promised
 * to call, drawn as a grid. A busy day says "+N more" and opens the whole day; a meeting opens with a way to join it; a task or
 * a follow-up goes to where it is kept. Whoever may schedule can add an event (the button, or a double-click on a day) and edit
 * a meeting. The admin's page also says whether new tasks are being added to a Google Calendar.
 */
export function Calendar() {
  const { portal, access } = useSession();
  const to = useAppTo();
  const navigate = useNavigate();
  const maySchedule = can(access.actor, 'meet.schedule');
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [dialog, setDialog] = useState<Dialog>(null);
  const { from, to: end } = useMemo(() => rangeOf(view, cursor), [view, cursor]);
  const { feed, fetching, error } = useFeed(dayKey(from), dayKey(end));
  const scheduling = useScheduling();

  const data = feed ?? EMPTY;
  const days = useMemo(() => daysOf(from, end), [from, end]);
  const counts = countsOver(data, days);
  const today = new Date();

  const open = (item: Item) => {
    setDialog(null);
    if (item.kind === 'task') void navigate(to('/tasks'));
    else if (item.kind === 'followup') void navigate(to('/leads'));
    else setDialog({ kind: 'meeting', id: item.m.id });
  };
  const newEvent = (day?: string) => {
    if (!maySchedule) return;
    setDialog(null);
    void scheduling.open(null, day ? { date: day } : undefined);
  };
  const meeting =
    dialog?.kind === 'meeting' ? data.meetings.find(m => m.id === dialog.id) : undefined;

  const googleLink = (
    <BtnLink
      small
      className={styles['google']}
      data-part="google"
      href={GOOGLE_CALENDAR}
      target="_blank"
      rel="noopener"
    >
      <Icon name={CAL_ICONS.external} size={13} /> Google Calendar
    </BtnLink>
  );
  const head: ReactNode =
    portal === 'admin' ? (
      <>
        <div>
          <div className={styles['heading']} data-part="heading">
            Calendar
          </div>
          <div className={styles['sub']} data-part="sub">
            Meetings, task due dates and lead follow-ups from MotoLinker. Scheduled meetings also
            land on everyone&apos;s Google Calendar.
          </div>
        </div>
        <div className={styles['tools']} data-part="tools">
          <Sync />
          {googleLink}
        </div>
      </>
    ) : (
      <>
        <div>
          <div className={styles['heading']} data-part="heading">
            Calendar
          </div>
          <div className={styles['sub']} data-part="sub">
            Your meetings, the tasks you owe and the leads you promised to call.
          </div>
        </div>
        {googleLink}
      </>
    );

  return (
    <div className={styles['page']} data-part="calendarPage" data-flush>
      <div className={styles['head']} data-part="head">
        {head}
      </div>
      <div className={styles['scroll']} data-part="scroll">
        <div data-part="calendar">
          <div className={styles['bar']} data-part="bar">
            <button
              type="button"
              className={styles['nav']}
              data-part="today"
              onClick={() => setCursor(new Date())}
            >
              Today
            </button>
            <button
              type="button"
              className={cx(styles['nav'], styles['arrow'])}
              data-part="prev"
              aria-label="Previous"
              onClick={() => setCursor(stepped(view, cursor, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              className={cx(styles['nav'], styles['arrow'])}
              data-part="next"
              aria-label="Next"
              onClick={() => setCursor(stepped(view, cursor, 1))}
            >
              ›
            </button>
            <div className={styles['title']} data-part="barTitle">
              {titleOf(view, cursor)}
            </div>
            <div className={styles['legend']} data-part="legend">
              <span className={styles['key']} data-kind="meeting" data-part="key">
                {plural(counts.meeting, 'meeting')}
              </span>
              <span className={styles['key']} data-kind="task" data-part="key">
                {plural(counts.task, 'task')}
              </span>
              <span className={styles['key']} data-kind="followup" data-part="key">
                {plural(counts.followup, 'follow-up')}
              </span>
            </div>
            <div className={styles['views']} data-part="views">
              {(['month', 'week'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  className={cx(styles['view'], view === v && styles['on'])}
                  data-part="view"
                  data-view={v}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === 'month' ? 'Month' : 'Week'}
                </button>
              ))}
            </div>
            {maySchedule && (
              <Btn kind="primary" small data-part="newEvent" onClick={() => newEvent()}>
                <Icon name={CAL_ICONS.add} size={14} /> New event
              </Btn>
            )}
          </div>
          {error && (
            <div className={styles['error']} data-part="error">
              {error}
            </div>
          )}
          <div
            className={cx(styles['grid'], view === 'week' && styles['week'])}
            data-part="grid"
            data-view={view}
          >
            {DOW.map(d => (
              <div key={d} className={styles['dow']} data-part="dow">
                {d}
              </div>
            ))}
            {days.map(d => {
              const items = itemsOn(data, d);
              const other = view === 'month' && d.getMonth() !== cursor.getMonth();
              const show = view === 'week' ? items : items.slice(0, 3);
              const key = dayKey(d);
              return (
                <div
                  key={key}
                  className={cx(
                    styles['day'],
                    other && styles['other'],
                    sameDay(d, today) && styles['today'],
                  )}
                  data-part="day"
                  data-day={key}
                  title="Double-click to schedule"
                  onDoubleClick={() => newEvent(key)}
                >
                  <div className={styles['daynum']} data-part="daynum">
                    {d.getDate()}
                  </div>
                  <div className={styles['items']} data-part="items">
                    {show.map((it, i) => (
                      <Chip key={i} item={it} onOpen={open} />
                    ))}
                    {items.length > show.length && (
                      <button
                        type="button"
                        className={styles['more']}
                        data-part="more"
                        onClick={() => setDialog({ kind: 'day', day: key })}
                      >
                        +{items.length - show.length} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {fetching && (
            <div className={styles['loading']} data-part="loading">
              <span className={styles['spinner']} /> Loading…
            </div>
          )}
        </div>
      </div>
      {dialog?.kind === 'day' && (
        <DaySheet
          day={dialog.day}
          feed={data}
          maySchedule={maySchedule}
          onOpen={open}
          onNew={newEvent}
          onClose={() => setDialog(null)}
        />
      )}
      {meeting && (
        <MeetingSheet
          meeting={meeting}
          maySchedule={maySchedule}
          onEdit={m => {
            setDialog(null);
            void scheduling.open(m);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {scheduling.sheet}
    </div>
  );
}
