import { useRef, useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import docStyles from '../../docs/docs.module.css';
import { readToken } from '../../lib/session';
import { Btn, BtnLink, Sheet } from '../../ui';
import { useStockWrites } from './data';
import { STOCK_ICONS, type BulkResult } from './model';
import styles from './stock.module.css';

/** What the sheet says when no file was chosen. */
export const SAID_CHOOSE_A_FILE = 'Please choose a CSV file.';

/**
 * The administrator's bulk upload: a CSV of vehicles (a model with several trims is a row for each; its cars are one cell, written
 * "VIN:Colour:Status | VIN:Colour:Status"), with a sample to start from. It says how many went in and why a row did not.
 */
export function CsvSheet({ onClose }: { onClose: () => void }) {
  const { portal } = useSession();
  const writes = useStockWrites();
  const file = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'error'; message: string }
    | { kind: 'done'; result: BulkResult }
  >({ kind: 'idle' });
  const token = readToken(portal);

  const upload = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) {
      setState({ kind: 'error', message: SAID_CHOOSE_A_FILE });
      return;
    }
    setState({ kind: 'busy' });
    const said = await writes.importCsv(chosen);
    setState(
      said.ok
        ? { kind: 'done', result: said.result }
        : { kind: 'error', message: said.message || 'Upload failed' },
    );
  };

  return (
    <Sheet
      title="Bulk upload vehicles"
      onClose={onClose}
      footer={
        <>
          <Btn data-part="close" onClick={onClose}>
            Close
          </Btn>
          <Btn kind="primary" data-part="upload" onClick={() => void upload()}>
            Upload
          </Btn>
        </>
      }
    >
      <div className={styles['csvForm']} data-part="csvForm">
        <p>
          Upload a CSV with columns:{' '}
          <strong>
            make, model, trim, price, range_km, motor_ps, power_train, drive_train, transmission,
            battery, top_speed, fast_charge, seats, body, year, units, notes
          </strong>
          .
        </p>
        <p>
          Make and Model are required; a model with several trims = one row per trim. Units are the
          cars themselves — <code>VIN:Colour:Status | VIN:Colour:Status</code> — and how many of
          them there are is the quantity.
        </p>
        <BtnLink
          href={
            '/api/dashboard/stock/template.csv' + (token ? '?_t=' + encodeURIComponent(token) : '')
          }
          download
          data-part="template"
          style={{ justifySelf: 'start' }}
        >
          <Icon name={STOCK_ICONS.download} size={14} /> Download sample template
        </BtnLink>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          className={docStyles['input']}
          data-part="csvFile"
        />
        <div data-part="csvResult">
          {state.kind === 'busy' && <div className={styles['csvBusy']}>Uploading…</div>}
          {state.kind === 'error' && (
            <div className={docStyles['errorLine']} role="alert">
              {state.message}
            </div>
          )}
          {state.kind === 'done' && (
            <div className={styles['csvDone']}>
              Imported <strong>{state.result.inserted}</strong> vehicle(s)
              {state.result.errors.length > 0 && (
                <>
                  <br />
                  <span className={styles['csvWarn']}>
                    {state.result.errors.map((e, i) => (
                      <span key={i}>
                        {i > 0 && <br />}
                        {e}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
