import { useState } from 'react';
import { BrandSelect, Btn, Sheet } from '../../ui';
import { FormGroup, FormLabel } from '../../ui/Form';
import docStyles from '../../docs/docs.module.css';
import { useContainerWrites } from './containers';
import styles from './stock.module.css';
import { carLabel, type FreeCar } from './tracking';

/** Put a car in a box: a list of the cars that are in no box yet (a car is in one box at a time), and what the server says of it. */
export function LinkSheet({
  containerId,
  free,
  onClose,
}: {
  containerId: number;
  free: readonly FreeCar[];
  onClose: () => void;
}) {
  const writes = useContainerWrites();
  const [vin, setVin] = useState(free[0]?.vin ?? '');
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    const said = await writes.link(containerId, vin);
    if (said.ok) onClose();
    else setError(said.message);
  };
  return (
    <Sheet
      title="Add a vehicle to the container"
      onClose={onClose}
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="primary" data-part="add" onClick={() => void add()}>
            Add
          </Btn>
        </>
      }
    >
      <FormGroup>
        <FormLabel>Vehicle</FormLabel>
        <BrandSelect
          part="carPick"
          value={vin}
          options={free.map(u => ({ value: u.vin, label: carLabel(u) }))}
          onChange={setVin}
        />
      </FormGroup>
      <div className={styles['hint']}>
        Vehicles come from the Models tab. A car with no VIN cannot be linked yet.
      </div>
      {error && (
        <div className={docStyles['errorLine']} data-part="formError" role="alert">
          {error}
        </div>
      )}
    </Sheet>
  );
}
