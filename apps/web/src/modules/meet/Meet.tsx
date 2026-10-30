import { can } from '@motolinker/contracts/access';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Btn, BtnLink } from '../../ui';
import { useMeetings } from './data';
import {
  classicRoomUrl,
  huddleRoomOf,
  linkUrl,
  MEET_ICONS,
  meetCodeUrl,
  SAID,
  summaryOf,
  whenOf,
  type Meeting,
} from './model';
import styles from './meet.module.css';
import { useScheduling } from './Schedule';

/** "Join" for a meeting: the huddle's room, or the link it was given — and nothing for a meeting with neither. */
function JoinButton({ meeting }: { meeting: Meeting }) {
  const { portal } = useSession();
  const room = huddleRoomOf(meeting.meet_link);
  if (room) {
    return (
      <BtnLink
        kind="primary"
        small
        data-part="join"
        href={classicRoomUrl(portal, room)}
        target="_blank"
        rel="noopener"
      >
        <Icon name={MEET_ICONS.huddle} size={13} /> Join huddle
      </BtnLink>
    );
  }
  const href = linkUrl(meeting.meet_link);
  return href ? (
    <BtnLink kind="primary" small data-part="join" href={href} target="_blank" rel="noopener">
      Join
    </BtnLink>
  ) : null;
}

function Row({
  meeting,
  mine,
  onEdit,
  onCancel,
}: {
  meeting: Meeting;
  mine: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const when = whenOf(meeting.starts_at);
  return (
    <div className={styles['row']} data-part="meeting">
      <div className={styles['day']} data-part="day">
        <div className={styles['weekday']} data-part="weekday">
          {when.weekday}
        </div>
        <div className={styles['date']} data-part="date">
          {when.day}
        </div>
      </div>
      <div className={styles['what']} data-part="what">
        <div className={styles['name']} data-part="name">
          {meeting.title}
        </div>
        <div className={styles['meta']} data-part="meta">
          {summaryOf(meeting)}
        </div>
      </div>
      <JoinButton meeting={meeting} />
      {mine && (
        <>
          <Btn small data-part="edit" onClick={onEdit}>
            Edit
          </Btn>
          <Btn small danger data-part="cancel" onClick={onCancel}>
            Cancel
          </Btn>
        </>
      )}
    </div>
  );
}

/** The upcoming meetings, and the button that schedules one. */
function Meetings() {
  const { access, toasts } = useSession();
  const maySchedule = can(access.actor, 'meet.schedule');
  const { items, loading, error, cancel } = useMeetings();
  const scheduling = useScheduling();
  const onCancel = (id: number) => {
    if (!window.confirm(SAID.confirmCancel)) return;
    void cancel(id).then(out => {
      if (!out.ok) toasts.show(out.message);
    });
  };
  if (!can(access.actor, 'meet.view')) return null;
  if (loading) {
    return (
      <div className={styles['loading']} data-part="loading">
        <span className={styles['spinner']} /> Loading meetings…
      </div>
    );
  }
  return (
    <>
      <div className={styles['listHead']} data-part="listHead">
        <div className={styles['listTitle']} data-part="listTitle">
          Upcoming meetings
        </div>
        {maySchedule && (
          <Btn kind="primary" small data-part="schedule" onClick={() => void scheduling.open(null)}>
            <Icon name={MEET_ICONS.schedule} size={14} /> Schedule a meeting
          </Btn>
        )}
      </div>
      {error ? (
        <div className={styles['error']} data-part="error">
          {error}
        </div>
      ) : !items.length ? (
        <div className={styles['empty']} data-part="empty">
          Nothing scheduled. A scheduled meeting lands on every attendee&apos;s Google Calendar
          automatically.
        </div>
      ) : (
        <div className={styles['list']} data-part="list">
          {items.map(m => (
            <Row
              key={m.id}
              meeting={m}
              mine={maySchedule}
              onEdit={() => void scheduling.open(m)}
              onCancel={() => onCancel(m.id)}
            />
          ))}
        </div>
      )}
      {scheduling.sheet}
    </>
  );
}

/**
 * Start or join a video meeting, and the meetings scheduled with the team. "Start Meeting" opens a new Google Meet; a code
 * joins an existing one. Whoever may see the meetings sees them below, and whoever may schedule them can schedule, change and
 * cancel. The two portals head it alike and pad it differently (the admin's page pads itself, the team's page is padded by the
 * shell around it and by the block inside it).
 */
export function Meet() {
  const [code, setCode] = useState('');
  const join = () => {
    const url = meetCodeUrl(code);
    if (url) window.open(url, '_blank', 'noopener');
  };
  return (
    <div data-part="meetPage">
      <div className={styles['body']} data-part="body">
        <div className={styles['title']} data-part="heading">
          Google Meet
        </div>
        <div className={styles['sub']} data-part="sub">
          Start or join a video meeting instantly.
        </div>
        <div className={styles['cards']} data-part="cards">
          <div className={styles['card']} data-part="card">
            <div className={styles['badge']} data-part="badge" data-tone="success">
              <Icon name={MEET_ICONS.newMeeting} size={24} />
            </div>
            <div>
              <div className={styles['cardTitle']} data-part="cardTitle">
                New Meeting
              </div>
              <div className={styles['cardHint']} data-part="cardHint">
                Start an instant meeting and share the link with others.
              </div>
            </div>
            <BtnLink
              kind="primary"
              className={styles['wide']}
              data-part="start"
              href="https://meet.google.com/new"
              target="_blank"
              rel="noopener"
            >
              <Icon name={MEET_ICONS.newMeeting} size={14} /> Start Meeting
            </BtnLink>
          </div>
          <div className={styles['card']} data-part="card">
            <div className={styles['badge']} data-part="badge" data-tone="alt">
              <Icon name={MEET_ICONS.join} size={24} />
            </div>
            <div>
              <div className={styles['cardTitle']} data-part="cardTitle">
                Join a Meeting
              </div>
              <div className={styles['cardHint']} data-part="cardHint">
                Enter a meeting code to join an existing meeting.
              </div>
            </div>
            <div className={styles['joinRow']} data-part="joinRow">
              <input
                className={styles['code']}
                data-part="code"
                aria-label="Meeting code"
                placeholder="abc-defg-hij"
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') join();
                }}
              />
              <Btn data-part="join" onClick={join}>
                Join
              </Btn>
            </div>
          </div>
        </div>
      </div>
      <div className={styles['meetings']} data-part="meetings">
        <Meetings />
      </div>
    </div>
  );
}
