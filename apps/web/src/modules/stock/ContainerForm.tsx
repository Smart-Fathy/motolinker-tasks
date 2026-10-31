import { useRef, useState } from 'react';
import { CONTAINER_STATUSES, CONTAINER_TYPES } from '@motolinker/contracts/logistics';
import { useSession } from '../../app/context';
import { BrandSelect, Btn, Sheet } from '../../ui';
import { Control, FormGroup, FormLabel, TextControl } from '../../ui/Form';
import docStyles from '../../docs/docs.module.css';
import { useContainerWrites } from './containers';
import styles from './stock.module.css';
import {
  bodyOf,
  formOf,
  inspectContainerNo,
  SAID_BAD_NUMBER,
  type BoxForm,
  type Container,
} from './tracking';

const TYPE_OPTIONS = [
  { value: '', label: '' },
  ...CONTAINER_TYPES.map(t => ({ value: t, label: t })),
];
const STATUS_OPTIONS = CONTAINER_STATUSES.map(s => ({ value: s.key, label: s.label }));

/**
 * A box's form: what the carrier's card shows, and where the ship is (typed in when the agent sends a position; the AIS feed fills
 * it where one is set up). Only the number is required, and its check digit is reported beside it — never enforced: a wrong-but-real
 * number on a bill of lading still has to be trackable. Deleting a box is the administrator's.
 */
export function ContainerForm({
  id,
  start,
  mayDelete,
  onClose,
  onSaved,
  onDeleted,
}: {
  id: number | null;
  /** the box to change, or what the carrier prefilled for a new one */
  start: Partial<Container> | Record<string, unknown> | undefined;
  mayDelete: boolean;
  onClose: () => void;
  onSaved: (said: string) => void;
  onDeleted: () => void;
}) {
  const { toasts } = useSession();
  const writes = useContainerWrites();
  const [f, setF] = useState<BoxForm>(() => formOf(start as Record<string, unknown> | undefined));
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const set = (key: keyof BoxForm) => (v: string) => setF(was => ({ ...was, [key]: v }));
  const text = (key: keyof BoxForm, label: string, over: Record<string, unknown> = {}) => (
    <FormGroup>
      <FormLabel>{label}</FormLabel>
      <Control value={f[key]} onChange={e => set(key)(e.target.value)} {...over} />
    </FormGroup>
  );

  const save = async () => {
    if (sending.current) return;
    const seen = inspectContainerNo(f.container_no);
    if (!seen.valid) {
      setError(SAID_BAD_NUMBER);
      return;
    }
    sending.current = true;
    setError(null);
    const said = await writes.save(id, bodyOf(f));
    sending.current = false;
    if (said.ok) onSaved(id ? 'Container updated.' : `Now tracking ${seen.no}.`);
    else setError(said.message);
  };
  const remove = async () => {
    if (!window.confirm('Stop tracking this container? The vehicles inside it are not deleted.'))
      return;
    if (id == null) return;
    const said = await writes.remove(id);
    if (said.ok) onDeleted();
    else toasts.show(said.message);
  };

  return (
    <Sheet
      title={id ? `Container ${f.container_no || ''}` : 'Track a container'}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          {id != null && mayDelete && (
            <Btn danger data-part="delete" onClick={() => void remove()}>
              Delete
            </Btn>
          )}
          <Btn kind="primary" data-part="save" onClick={() => void save()}>
            {id ? 'Save changes' : 'Start tracking'}
          </Btn>
        </>
      }
    >
      <div className={styles['grid3']} data-part="boxForm">
        {text('container_no', 'Container number *', { id: 'ct-no', placeholder: 'MSDU7337230' })}
        <FormGroup>
          <FormLabel>Type</FormLabel>
          <BrandSelect
            part="ctType"
            value={f.container_type}
            options={TYPE_OPTIONS}
            onChange={set('container_type')}
          />
        </FormGroup>
        <FormGroup>
          <FormLabel>Status</FormLabel>
          <BrandSelect
            part="ctStatus"
            value={f.status}
            options={STATUS_OPTIONS}
            onChange={set('status')}
          />
        </FormGroup>
        {text('carrier', 'Carrier', { placeholder: 'MSC' })}
        {text('bl_number', 'B/L number')}
        {text('latest_move', 'Latest move', { placeholder: 'SINGAPORE, SG' })}
        {text('pod_eta', 'POD ETA', { type: 'date' })}
        {text('vessel_name', 'Vessel', { placeholder: 'MSC ELISABETTA' })}
        {text('vessel_imo', 'IMO', { placeholder: '9954747' })}
        {text('pol_code', 'Load port code', { placeholder: 'SGSIN' })}
        {text('pol_name', 'Load port', { placeholder: 'Singapore' })}
        {text('atd', 'Actual departure', { type: 'datetime-local' })}
        {text('pod_code', 'Discharge port code', { placeholder: 'ITGIT' })}
        {text('pod_name', 'Discharge port', { placeholder: 'Gioia Tauro' })}
        {text('eta', 'Reported arrival', { type: 'datetime-local' })}
      </div>
      <div className={styles['formHeading']}>Vessel position</div>
      <div className={styles['hint']} style={{ marginBottom: 10 }}>
        Filled by the AIS feed when one is configured. Type it in if the agent sends a position —
        decimal degrees, south and west negative.
      </div>
      <div className={styles['grid3']} data-part="positionForm">
        {text('vessel_lat', 'Latitude', { type: 'number', placeholder: '-33.918' })}
        {text('vessel_lon', 'Longitude', { type: 'number', placeholder: '18.423' })}
        {text('vessel_position_at', 'Reported at', { type: 'datetime-local' })}
        {text('vessel_course', 'Course °', { type: 'number' })}
        {text('vessel_speed', 'Speed kn', { type: 'number' })}
        {text('vessel_mmsi', 'MMSI', { placeholder: '636092xxx' })}
      </div>
      <FormGroup>
        <FormLabel>Notes</FormLabel>
        <TextControl rows={2} value={f.notes} onChange={e => set('notes')(e.target.value)} />
      </FormGroup>
      {error && (
        <div className={docStyles['errorLine']} data-part="formError" role="alert">
          {error}
        </div>
      )}
    </Sheet>
  );
}
