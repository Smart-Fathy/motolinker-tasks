import { Icon } from '../../app/shell/icons';
import styles from './stock.module.css';
import { TRACK_ICONS, type Diagnosis as Found, type ProviderStatus } from './tracking';

const Tried = ({ list }: { list: Found['attempts'] }) => (
  <>
    {(list ?? []).map((a, i) => (
      <li key={i}>
        <code>{a.shape || a.base}</code> → {a.code}
        {a.status ? ' (' + a.status + ')' : ''}
      </li>
    ))}
  </>
);

/**
 * What the server found when it tried the carrier's key every way it knows: which header is read, which base path is not refused.
 * Three outcomes that need three different answers — a key recognised but not permitted (the account is the limit, not the key),
 * a key that works (and a header that is already right, or one to set), and a key every shape of which was refused.
 */
export function Diagnosis({ status, auth }: { status: ProviderStatus; auth: Found }) {
  const note = { fontSize: 11.5 } as const;
  // Recognised but refused: the key is FINE. Saying "rejected" here is what sends somebody rotating a key that was never the problem.
  if (auth.ok === false && auth.stage === 'permission') {
    return (
      <div className={styles['empty']} style={{ textAlign: 'left' }} data-part="diagnosis">
        <div className={styles['diagHead']} style={{ color: 'var(--warning,#c9a35e)' }}>
          <Icon name={TRACK_ICONS.key} size={14} /> The key is valid — the account is not permitted
        </div>
        <div style={{ marginBottom: 10 }}>{auth.reason}</div>
        <div style={{ marginBottom: 6 }}>
          Worth checking, in this order: that the trial includes API access; whether this is a
          sandbox key being sent to production; and whether the API product needs enabling on the
          account.
        </div>
        <div className={styles['diagNote']} style={{ ...note, marginTop: 10 }}>
          Headers tried:
        </div>
        <ul className={styles['diagList']}>
          <Tried list={auth.attempts} />
        </ul>
        {auth.baseAttempts ? (
          <>
            <div className={styles['diagNote']} style={{ ...note, marginTop: 8 }}>
              Base paths tried with <code>{auth.shape}</code>:
            </div>
            <ul className={styles['diagList']}>
              <Tried list={auth.baseAttempts} />
            </ul>
          </>
        ) : null}
      </div>
    );
  }
  if (auth.ok) {
    // Two very different results share this branch. Either the app is sending the wrong header and there is a variable to set, or it
    // is ALREADY sending the right one and there is nothing to do. Telling somebody to set a variable to the value it already has
    // looks like a fix, changes nothing, and is one stray character away from breaking auth that worked.
    return auth.already ? (
      <div className={styles['empty']} style={{ textAlign: 'left' }} data-part="diagnosis">
        <div className={styles['diagHead']} style={{ color: 'var(--success,#8a9a86)' }}>
          <Icon name={TRACK_ICONS.ok} size={14} /> The key works and the header is already right
        </div>
        <div style={{ marginBottom: 10 }}>
          {status.provider} accepted <code>{auth.shape}</code>, which is what this app already
          sends. Nothing to change here.
        </div>
        {auth.base ? (
          <div className={styles['diagNote']}>
            Working base: <code>{auth.base}</code>
          </div>
        ) : null}
        <div className={styles['diagNote']} style={{ marginTop: 8 }}>
          If lookups are still failing, the cause is not the header — check the log line for what
          the carrier said.
        </div>
      </div>
    ) : (
      <div className={styles['empty']} style={{ textAlign: 'left' }} data-part="diagnosis">
        <div className={styles['diagHead']} style={{ color: 'var(--success,#8a9a86)' }}>
          <Icon name={TRACK_ICONS.ok} size={14} /> The key works — it just needs a different header
        </div>
        <div style={{ marginBottom: 10 }}>
          {status.provider} accepted <code>{auth.shape}</code>.
        </div>
        <div>Set this and redeploy:</div>
        <pre className={styles['diagPre']}>{auth.env}</pre>
        {auth.base ? (
          <div className={styles['diagNote']} style={{ marginTop: 8 }}>
            Working base: <code>{auth.base}</code>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles['empty']} style={{ textAlign: 'left' }} data-part="diagnosis">
      <div className={styles['diagHead']} style={{ color: 'var(--danger,#c97d6e)' }}>
        <Icon name={TRACK_ICONS.warn} size={14} /> Every header shape was refused
      </div>
      <div style={{ marginBottom: 10 }}>
        {auth.reason || 'The key itself looks wrong, or is not active yet.'}
      </div>
      <div className={styles['diagNote']}>Tried:</div>
      <ul className={styles['diagList']}>
        <Tried list={auth.attempts} />
      </ul>
    </div>
  );
}
