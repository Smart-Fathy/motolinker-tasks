import { can } from '@motolinker/contracts/access';
import { useState, type ReactNode } from 'react';
import { useAssistantRecord } from '../../assistant';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import docStyles from '../../docs/docs.module.css';
import { Input } from '../../docs/Fields';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import { ContainerCard } from './ContainerCard';
import { ContainerForm } from './ContainerForm';
import { Diagnosis } from './Diagnosis';
import { LinkSheet } from './LinkSheet';
import { useContainers, useContainerWrites } from './containers';
import styles from './stock.module.css';
import {
  carrierName,
  checkWarning,
  diagnosisOf,
  inspectContainerNo,
  providerSaid,
  refreshSaid,
  registeredSaid,
  SAID_BAD_NUMBER,
  TRACK_ICONS,
  whyNotTracked,
  type Container,
  type FreeCar,
  type ProviderStatus,
} from './tracking';

/** What the line under the buttons holds: the card of a box looked up, what a lookup found nothing of, or what a test of the key found. */
type Result =
  | null
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'found'; container: Container }
  | {
      kind: 'missing';
      no: string;
      why: string;
      detail: string | null;
      name: string;
      canRegister: boolean;
      prefill: Record<string, unknown> | null;
    }
  | { kind: 'diagnosis'; status: ProviderStatus };

/** The loader line: a spinner and what is being waited for (a block in the admin's page, a line in the team's). */
function Wait({ team, text }: { team: boolean; text: string }) {
  return (
    <div className={docStyles['loading']} data-part="loading">
      {team ? <span className={docStyles['spinner']} /> : <div className={docStyles['spinner']} />}{' '}
      {text}
    </div>
  );
}

/**
 * The Tracking tab: the boxes on the water, a card for each — container, type, latest move, the ship and the leg it is on, the
 * port calls, where the ship is now, the arrival, and the cars inside. A box is found by its number, from the carrier when one is
 * set up and by hand otherwise; a carrier's own errors are never put in front of somebody trying to find a container. Who may
 * follow the containers is `stock.tracking`; deleting a box is the administrator's.
 */
export function Tracking() {
  const { portal, access, toasts } = useSession();
  const team = portal === 'team';
  const board = useContainers();
  const writes = useContainerWrites();
  const may = can(access.actor, 'stock.tracking');
  const [no, setNo] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [form, setForm] = useState<{
    id: number | null;
    start: Record<string, unknown> | undefined;
  } | null>(null);
  const [link, setLink] = useState<{ id: number; free: FreeCar[] } | null>(null);
  // (what the assistant is told is open: the container whose form is in front of the person; a new one is not a record yet)
  const boxOpen = form?.id != null ? board.items.find(x => x.id === form.id) : undefined;
  useAssistantRecord(
    form?.id != null
      ? { kind: 'container', id: String(form.id), title: boxOpen?.container_no ?? '', sub: '' }
      : null,
  );

  const look = async () => {
    const seen = inspectContainerNo(no);
    if (!seen.valid) {
      setResult({ kind: 'error', message: SAID_BAD_NUMBER });
      return;
    }
    setNo(seen.no);
    setResult({ kind: 'busy' });
    const got = await writes.lookup(seen.no);
    if (!got.ok) {
      setResult({ kind: 'error', message: got.message });
      return;
    }
    const d = got.value;
    if (d.found) {
      setResult({ kind: 'found', container: d.container });
      return;
    }
    const name = carrierName(d.provider_name);
    setResult({
      kind: 'missing',
      no: seen.no,
      why: whyNotTracked(d.code, name),
      detail: d.detail,
      name,
      canRegister: d.can_register,
      prefill: d.prefill,
    });
  };

  const check = async () => {
    toasts.show('Testing the carrier connection…');
    const got = await writes.providerCheck();
    if (!got.ok) {
      toasts.show(got.message);
      return;
    }
    toasts.show(providerSaid(got.value));
    // A refused key: say which header shape the vendor DOES accept, and the exact variable to set.
    if (diagnosisOf(got.value)) setResult({ kind: 'diagnosis', status: got.value });
  };

  const register = async (number: string) => {
    toasts.show('Registering with the carrier…');
    const got = await writes.register(number);
    if (!got.ok) {
      toasts.show(got.message);
      return;
    }
    toasts.show(registeredSaid(got.value));
    if (got.value.ok) setForm({ id: null, start: { container_no: number } });
  };

  const refresh = async (id: number) => {
    toasts.show('Checking the carrier…');
    const got = await writes.refresh(id);
    if (!got.ok) {
      toasts.show(got.message);
      return;
    }
    const said = refreshSaid(got.value);
    toasts.show(said.text);
    if (said.reload) writes.reload();
  };

  const openLink = async (id: number) => {
    const cars = await writes.cars();
    if (!cars.length) {
      toasts.show('No vehicles with a VIN in the Models tab yet — add one there first.');
      return;
    }
    // A car is in one box at a time, so anything already linked anywhere is not offered again. Re-adding is harmless server-side,
    // but offering it is not an honest list.
    const taken = new Set(board.items.flatMap(c => c.units.map(u => u.vin)));
    const free = cars.filter(u => !taken.has(u.vin));
    if (!free.length) {
      toasts.show('Every vehicle with a VIN is already in a container.');
      return;
    }
    setLink({ id, free });
  };

  const unlink = async (id: number, vin: string) => {
    const said = await writes.unlink(id, vin);
    if (!said.ok) toasts.show(said.message);
  };

  const card = (c: Container) => (
    <ContainerCard
      key={c.id}
      c={c}
      may={may}
      refresh={id => void refresh(id)}
      edit={id => setForm({ id, start: board.items.find(x => x.id === id) ?? {} })}
      link={id => void openLink(id)}
      unlink={(id, vin) => void unlink(id, vin)}
    />
  );

  let shown: ReactNode = null;
  if (result?.kind === 'busy') shown = <Wait team={team} text="Looking it up…" />;
  else if (result?.kind === 'error')
    shown = (
      <div className={styles['errorBox']} data-part="resultError">
        {result.message}
      </div>
    );
  else if (result?.kind === 'found')
    shown = <div className={styles['ctGrid']}>{card(result.container)}</div>;
  else if (result?.kind === 'missing') {
    const warn = checkWarning(result.no);
    shown = (
      <div className={styles['empty']} data-part="notTracked">
        <div className={styles['emptyHead']} data-part="notTrackedHead">
          {result.no} is not tracked yet
        </div>
        <div className={styles['emptyWhy']} title={result.detail ?? undefined} data-part="why">
          {result.why}
        </div>
        {may && (
          <div className={styles['emptyActions']} data-part="notTrackedActions">
            {result.canRegister && (
              <Btn small data-part="register" onClick={() => void register(result.no)}>
                Ask {result.name} to track it
              </Btn>
            )}
            <Btn
              small
              kind="primary"
              data-part="start"
              onClick={() =>
                setForm({ id: null, start: { container_no: result.no, ...(result.prefill ?? {}) } })
              }
            >
              Start tracking it
            </Btn>
          </div>
        )}
        {warn ? (
          <div
            className={styles['warn']}
            style={{ justifyContent: 'center' }}
            data-part="checkWarn"
          >
            {warn}
          </div>
        ) : null}
      </div>
    );
  } else if (result?.kind === 'diagnosis') {
    const auth = diagnosisOf(result.status);
    shown = auth ? <Diagnosis status={result.status} auth={auth} /> : null;
  }

  let list: ReactNode;
  if (board.loading) list = <Wait team={team} text="Loading containers…" />;
  else if (board.error)
    list = (
      <div className={styles['errorBox']} data-part="error">
        {board.error}
      </div>
    );
  else if (!board.items.length)
    list = (
      <div className={styles['empty']} data-part="nothing">
        Nothing is being tracked yet. Enter a container number above to start.
      </div>
    );
  else
    list = (
      <div className={styles['ctGrid']} data-part="board">
        {board.items.map(card)}
      </div>
    );

  return (
    <div className={cx(team ? undefined : styles['trackAdmin'])} data-part="trackingPane">
      <div className={styles['bar']} data-part="bar">
        <Input
          id="logi-ct-search"
          className={cx(styles['trackInput'], team && styles['trackInputTeam'])}
          placeholder="Container number, e.g. MSDU7337230"
          value={no}
          onChange={e => setNo(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void look();
          }}
        />
        <Btn kind="primary" data-part="track" onClick={() => void look()}>
          <Icon name={TRACK_ICONS.search} size={15} /> Track
        </Btn>
        {may && (
          <Btn data-part="addBox" onClick={() => setForm({ id: null, start: undefined })}>
            <Icon name={TRACK_ICONS.add} size={15} /> Add manually
          </Btn>
        )}
        <Btn
          data-part="check"
          title="Check the carrier key and what it covers"
          onClick={() => void check()}
        >
          <Icon name={TRACK_ICONS.plug} size={15} /> Test connection
        </Btn>
      </div>
      <div className={styles['result']} data-part="result">
        {shown}
      </div>
      <div data-part="containers">{list}</div>
      {form && (
        <ContainerForm
          key={form.id ?? 'new'}
          id={form.id}
          start={form.start}
          mayDelete={!team}
          onClose={() => setForm(null)}
          onSaved={said => {
            setForm(null);
            toasts.show(said);
            setResult(null);
          }}
          onDeleted={() => setForm(null)}
        />
      )}
      {link && <LinkSheet containerId={link.id} free={link.free} onClose={() => setLink(null)} />}
    </div>
  );
}
