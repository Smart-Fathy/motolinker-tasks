import type { CSSProperties } from 'react';
import { Icon } from '../../app/shell/icons';
import { Btn } from '../../ui';
import { TrackMap } from './TrackMap';
import styles from './stock.module.css';
import {
  callOf,
  carTitle,
  checkWarning,
  dm,
  fmtDate,
  fmtDateTime,
  hueVar,
  positionAge,
  statusOf,
  TRACK_ICONS,
  voyageProgress,
  type Container,
} from './tracking';

/** One line of the card: an icon, what it is, and what it says (a dash where it says nothing). */
function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className={styles['ctRow']} data-part="ctRow">
      <span className={styles['ctIc']}>
        <Icon name={icon} size={22} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className={styles['ctK']}>{label}</div>
        <div className={styles['ctV']} data-part="ctValue">
          {value || '—'}
        </div>
      </div>
    </div>
  );
}

/** The voyage strip: the ship, the leg, and where on it (by time — the departure and the ETA are the only two facts there are). */
function Voyage({ c }: { c: Container }) {
  if (!c.vessel_name && !c.pol_code && !c.pod_code) {
    return (
      <div className={styles['voy']} data-part="voyage">
        <div className={styles['voyNone']} data-part="voyNone">
          No voyage recorded yet — edit the container to add the vessel and its ports.
        </div>
      </div>
    );
  }
  const p = voyageProgress(c.atd, c.eta);
  const along = p == null ? 0 : Math.round(p * 100) / 100;
  return (
    <div className={styles['voy']} data-part="voyage">
      <div className={styles['voyShip']} data-part="voyShip">
        <span className={styles['accent']}>
          <Icon name={TRACK_ICONS.ship} size={17} />
        </span>
        <span className={styles['voyName']} data-part="voyName">
          {c.vessel_name || 'Vessel not set'}
        </span>
        {c.vessel_imo ? (
          <span className={styles['voyImo']} data-part="voyImo">
            IMO {c.vessel_imo}
          </span>
        ) : null}
      </div>
      <div className={styles['voyEnds']} data-part="voyEnds">
        <span>{c.pol_name ? 'Departure from ' + c.pol_name : 'Load port'}</span>
        <span>{c.pod_name ? 'Arrival at ' + c.pod_name : 'Discharge port'}</span>
      </div>
      <div className={styles['voyCodes']} data-part="voyCodes">
        <span>{c.pol_code || '—'}</span>
        <span>{c.pod_code || '—'}</span>
      </div>
      <div className={styles['voyTrack']} data-part="voyTrack">
        <div className={styles['voyLine']} data-part="voyLine" />
        {p == null ? null : (
          <div
            className={styles['voyDone']}
            style={{ width: `calc((100% - 12px) * ${along})` }}
            data-part="voyDone"
          />
        )}
        <div className={styles['voyDot']} data-part="voyDot" />
        {p == null ? null : (
          <div
            className={styles['voyShipIc']}
            style={{ left: `calc(6px + (100% - 12px) * ${along})` }}
            data-part="voyShipIc"
          >
            <Icon name={TRACK_ICONS.here} size={19} />
          </div>
        )}
        <div className={styles['voyEnd']} data-part="voyEnd">
          <Icon name={TRACK_ICONS.end} size={15} />
        </div>
      </div>
      <div className={styles['voyTimes']} data-part="voyTimes">
        <span className={styles['muted']}>
          Actual departure<b className={styles['strong']}>{fmtDateTime(c.atd)}</b>
        </span>
        <span className={styles['muted']} style={{ textAlign: 'right' }}>
          Reported ETA<b className={styles['strong']}>{fmtDateTime(c.eta)}</b>
        </span>
      </div>
    </div>
  );
}

/**
 * The port-call log, collapsed (a long-haul box carries dozens of rows and the card is a summary, not a report). An unconfirmed
 * event is marked: the carrier sends future legs alongside past ones, and presenting a plan as a fact is the one thing a tracking
 * screen must not do.
 */
function Moves({ c }: { c: Container }) {
  const moves = Array.isArray(c.moves) ? c.moves : [];
  if (!moves.length) return null;
  return (
    <details className={styles['moves']} data-part="moves">
      <summary>
        <Icon name={TRACK_ICONS.moves} size={14} /> Port calls <span>{moves.length}</span>
      </summary>
      <ul>
        {moves.map((m, i) => {
          const call = callOf(m);
          return (
            <li
              key={i}
              className={call.expected ? `${styles['move']} ${styles['moveEst']}` : styles['move']}
              data-part="move"
            >
              <span className={styles['moveAt']}>{fmtDate(m.at)}</span>
              <span className={styles['moveWhat']}>
                {call.label}
                {call.expected ? (
                  <>
                    {' '}
                    <em>expected</em>
                  </>
                ) : null}
              </span>
              <span className={styles['moveWhere']}>{call.where}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Where the ship is, and how old that is: a fix has an age, and the age decides how much to trust it. */
function Position({ c }: { c: Container }) {
  if (c.vessel_lat == null || c.vessel_lon == null) return null;
  const age = positionAge(c.vessel_position_at);
  const speed =
    c.vessel_speed != null && c.vessel_speed !== ''
      ? `${Number(c.vessel_speed).toFixed(1)} kn`
      : '';
  const course = c.vessel_course == null || c.vessel_course === '' ? null : Number(c.vessel_course);
  return (
    <div className={styles['pos']} data-part="position">
      <div className={styles['posHead']} data-part="posHead">
        <span className={styles['accent']}>
          <Icon name={TRACK_ICONS.position} size={14} />
        </span>
        <span className={styles['posCo']} data-part="posCo">
          {`${dm(c.vessel_lat, 'lat')}, ${dm(c.vessel_lon, 'lon')}`}
        </span>
        {speed ? <span className={styles['muted']}>{`· ${speed}`}</span> : null}
        <span
          className={`${styles['posAge']} ${styles[age.cls]}`}
          title="AIS reports are delayed, especially by satellite mid-ocean"
          data-part="posAge"
        >
          {age.label}
        </span>
      </div>
      <TrackMap
        lat={Number(c.vessel_lat)}
        lon={Number(c.vessel_lon)}
        course={course != null && Number.isFinite(course) ? course : null}
        name={c.vessel_name || 'Vessel'}
      />
    </div>
  );
}

/**
 * A container, as the carrier's own card shows it — container, type, latest move, POD ETA; then the ship, the leg, the departure
 * and the reported arrival — so moving from screenshots to this is recognition rather than retraining.
 */
export function ContainerCard({
  c,
  may,
  refresh,
  edit,
  link,
  unlink,
}: {
  c: Container;
  may: boolean;
  refresh: (id: number) => void;
  edit: (id: number) => void;
  link: (id: number) => void;
  unlink: (id: number, vin: string) => void;
}) {
  const status = statusOf(c.status);
  const warn = checkWarning(c.container_no);
  const units = c.units;
  const small: CSSProperties = { padding: '3px 10px', fontSize: 11 };
  return (
    <div className={styles['ct']} data-part="container" data-container={c.id}>
      <div className={styles['ctBody']} data-part="ctBody">
        <div
          data-part="ctHead"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span
            className={styles['ctPill']}
            style={{ background: `${status.fg}22`, color: hueVar(status.fg) }}
            data-part="ctStatus"
          >
            {status.label}
          </span>
          <span className={styles['carrier']} data-part="carrier">
            {c.carrier || ''}
          </span>
        </div>
        <Row icon={TRACK_ICONS.container} label="Container" value={c.container_no} />
        <Row icon={TRACK_ICONS.type} label="Type" value={c.container_type ?? ''} />
        <Row icon={TRACK_ICONS.move} label="Latest move" value={c.latest_move ?? ''} />
        {warn ? (
          <div className={styles['warn']} data-part="checkWarn">
            <Icon name={TRACK_ICONS.warn} size={13} /> {warn}
          </div>
        ) : null}
      </div>
      <Voyage c={c} />
      <Moves c={c} />
      <Position c={c} />
      <div className={styles['ctFoot']} data-part="ctFoot">
        <Row icon={TRACK_ICONS.eta} label="POD ETA" value={fmtDate(c.pod_eta)} />
        <div className={styles['ctActions']} data-part="ctActions">
          {may && (
            <button
              type="button"
              className={styles['ctBtn']}
              title="Refresh from the carrier"
              data-part="refresh"
              onClick={() => refresh(c.id)}
            >
              <Icon name={TRACK_ICONS.refresh} size={15} />
            </button>
          )}
          {may && (
            <button
              type="button"
              className={styles['ctBtn']}
              title="Edit"
              data-part="edit"
              onClick={() => edit(c.id)}
            >
              <Icon name={TRACK_ICONS.edit} size={15} />
            </button>
          )}
        </div>
      </div>
      <div className={styles['cars']} data-part="cars">
        <span className={styles['carsLabel']} data-part="carsLabel">
          {units.length ? 'Vehicles inside' : 'No vehicles linked yet'}
        </span>
        {units.map(u => (
          <span key={u.vin} className={styles['chipCar']} title={carTitle(u)} data-part="car">
            <Icon name={TRACK_ICONS.car} size={12} /> {u.vin}
            {may && (
              <button
                type="button"
                title="Remove"
                data-part="unlink"
                onClick={() => unlink(c.id, u.vin)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {may && (
          <Btn style={small} data-part="link" onClick={() => link(c.id)}>
            <Icon name="plus" size={12} /> Add vehicle
          </Btn>
        )}
      </div>
    </div>
  );
}
