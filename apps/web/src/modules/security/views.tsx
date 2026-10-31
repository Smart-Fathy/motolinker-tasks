// The six things the Security panel shows, as public/assets/security.js draws them: the overview (two-factor, the devices, the
// sign-in record, the password), asking for the password to start turning two-factor on, the key to scan, the recovery codes,
// turning it off, and making new codes. They hold what is typed in them; what is done with it is the panel's.
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../ui/cx';
import {
  ago,
  groups4,
  methodLabel,
  signedOutLine,
  stamp,
  type Overview,
  type SecurityLogin,
  type SecuritySession,
  type Setup,
} from './model';
import styles from './security.module.css';

const enter = (then: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter') then();
};

/** A button of the panel; `primary` and `danger` are the two weights it has beside the plain one. */
function Btn({
  children,
  kind,
  small,
  part,
  ...rest
}: {
  children: ReactNode;
  kind?: 'primary' | 'danger';
  small?: boolean;
  part: string;
  disabled?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles['btn'], kind && styles[kind], small && styles['sm'])}
      data-part={part}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── The overview ────────────────────────────────────────────────────────────────────────────────────────────────────────

function TwoFactor({
  overview,
  go,
}: {
  overview: Overview;
  go: (view: 'setup-password' | 'newcodes' | 'disable') => void;
}) {
  const t = overview.twofa;
  const title = (pill: string, tone: 'on' | 'off') => (
    <div className={styles['h']}>
      Two-factor authentication{' '}
      <span className={cx(styles['pill'], styles[tone])} data-part="pill">
        {pill}
      </span>
    </div>
  );
  let body: ReactNode;
  if (!t.available) {
    body = (
      <>
        {title('Unavailable', 'off')}
        <div className={styles['sub']} data-part="note">
          {t.reason === 'error' ? (
            'Could not load this right now. Close the panel and try again in a moment.'
          ) : (
            <>
              This needs a database update that has not been applied yet. Ask whoever runs the
              system to apply migration <code>023_account_security.sql</code>, then reopen this
              panel.
            </>
          )}
        </div>
      </>
    );
  } else if (t.enabled) {
    body = (
      <div className={styles['row']}>
        <div>
          {title('On', 'on')}
          <div className={styles['sub']} data-part="note">
            Signing in needs a 6-digit code from your authenticator app
            {t.enabledAt ? ` · turned on ${stamp(t.enabledAt)}` : ''}.
            <br />
            {t.recoveryLeft} recovery code{t.recoveryLeft === 1 ? '' : 's'} left
            {t.recoveryLeft <= 2 && (
              <>
                {' — '}
                <b>make new ones soon</b>
              </>
            )}
            .
          </div>
        </div>
        <div className={styles['actions']}>
          <Btn small part="newCodes" onClick={() => go('newcodes')}>
            New recovery codes
          </Btn>
          <Btn small kind="danger" part="turnOff" onClick={() => go('disable')}>
            Turn off
          </Btn>
        </div>
      </div>
    );
  } else {
    body = (
      <div className={styles['row']}>
        <div>
          {title('Off', 'off')}
          <div className={styles['sub']} data-part="note">
            Add a second step to signing in: a 6-digit code from an authenticator app on your phone.
            Even if your password leaks, nobody gets in without your phone.
          </div>
        </div>
        <div className={styles['actions']}>
          <Btn kind="primary" part="turnOn" onClick={() => go('setup-password')}>
            Turn on
          </Btn>
        </div>
      </div>
    );
  }
  return (
    <div className={styles['card']} data-part="twofa">
      {body}
      {t.available && overview.account.kind === 'admin' && !t.encrypted && (
        <div className={cx(styles['sub'], styles['gapSm'])} data-part="unencrypted">
          Two-factor secrets are stored unencrypted until <code>MFA_ENCRYPTION_KEY</code> is set on
          the server.
        </div>
      )}
    </div>
  );
}

function Device({ s, onSignOut }: { s: SecuritySession; onSignOut: (sid: string) => void }) {
  return (
    <div className={styles['item']} data-part="session">
      <div>
        <b>{s.device}</b>{' '}
        {s.current && (
          <span className={cx(styles['pill'], styles['here'])} data-part="here">
            This device
          </span>
        )}
        <div className={styles['meta']}>
          {s.ip || 'unknown address'} · signed in {ago(s.createdAt)} · last active{' '}
          {ago(s.lastSeenAt)}
          {s.method ? ' · ' + methodLabel(s.method) : ''}
        </div>
      </div>
      {!s.current && (
        <Btn small kind="danger" part="signOutDevice" onClick={() => onSignOut(s.sid)}>
          Sign out
        </Btn>
      )}
    </div>
  );
}

function SignIn({ l }: { l: SecurityLogin }) {
  return (
    <div className={styles['item']} data-part="login">
      <div>
        <b>{l.device || 'Unknown device'}</b>{' '}
        {l.new_device && (
          <span className={cx(styles['pill'], styles['new'])} data-part="newDevice">
            New device
          </span>
        )}
        <div className={styles['meta']}>
          {l.ip || 'unknown address'} · {methodLabel(l.method)}
        </div>
      </div>
      <div className={cx(styles['meta'], styles['stamp'])}>{stamp(l.at)}</div>
    </div>
  );
}

export function Main({
  overview,
  go,
  onSignOut,
  onSignOutOthers,
  onChangePassword,
}: {
  overview: Overview;
  go: (view: 'setup-password' | 'newcodes' | 'disable') => void;
  onSignOut: (sid: string) => void;
  onSignOutOthers: () => void;
  onChangePassword: () => void;
}) {
  const others = overview.sessions.filter(s => !s.current).length;
  return (
    <>
      <TwoFactor overview={overview} go={go} />
      <div className={styles['card']} data-part="devices">
        <div className={styles['row']}>
          <div>
            <div className={styles['h']}>Where you&apos;re signed in</div>
            <div className={styles['sub']}>
              If you don&apos;t recognise one, sign it out and change your password.
            </div>
          </div>
          {others > 0 && (
            <div className={styles['actions']}>
              <Btn small kind="danger" part="signOutOthers" onClick={onSignOutOthers}>
                Sign out all other devices
              </Btn>
            </div>
          )}
        </div>
        <div className={cx(styles['list'], styles['gapSm'])}>
          {overview.sessions.length ? (
            overview.sessions.map(s => <Device key={s.sid} s={s} onSignOut={onSignOut} />)
          ) : (
            <div className={styles['sub']}>No sessions.</div>
          )}
        </div>
      </div>
      <div className={styles['card']} data-part="history">
        <div className={styles['h']}>Recent sign-ins</div>
        <div className={cx(styles['sub'], styles['under'])}>
          {overview.alerts === 'off'
            ? 'Alerts are off.'
            : "You are alerted when someone signs in from a device you haven't used before."}
        </div>
        <div className={styles['list']}>
          {!overview.history ? (
            <div className={styles['sub']}>
              The sign-in history needs the same database update (migration 023).
            </div>
          ) : overview.logins.length ? (
            overview.logins.map((l, i) => <SignIn key={i} l={l} />)
          ) : (
            <div className={styles['sub']}>Nothing recorded yet.</div>
          )}
        </div>
      </div>
      {overview.account.canChangePassword && (
        <div className={styles['card']} data-part="passwordCard">
          <div className={styles['row']}>
            <div>
              <div className={styles['h']}>Password</div>
              <div className={styles['sub']}>Changing it signs out every other device.</div>
            </div>
            <div className={styles['actions']}>
              <Btn small part="changePassword" onClick={onChangePassword}>
                Change password
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── The forms it steps through ──────────────────────────────────────────────────────────────────────────────────────────

/** The password, asked for again before anything that could lock the owner out or strip their protection. */
function PasswordField({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  const id = useId();
  return (
    <>
      <label className={styles['label']} htmlFor={id}>
        Your password
      </label>
      <input
        id={id}
        className={styles['input']}
        data-part="password"
        type="password"
        autoComplete="current-password"
        placeholder="Confirm it's you"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={enter(onEnter)}
      />
    </>
  );
}

function CodeField({
  label,
  value,
  onChange,
  onEnter,
  numeric,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  numeric: boolean;
  maxLength: number;
}) {
  const id = useId();
  return (
    <>
      <label className={styles['label']} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles['input']}
        data-part="code"
        {...(numeric ? { inputMode: 'numeric' as const } : {})}
        autoComplete="one-time-code"
        maxLength={maxLength}
        placeholder="123456"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={enter(onEnter)}
      />
    </>
  );
}

function Foot({
  busy,
  label,
  kind,
  onCancel,
  onGo,
}: {
  busy: string | null;
  label: string;
  kind: 'primary' | 'danger';
  onCancel: () => void;
  onGo: () => void;
}) {
  return (
    <div className={styles['foot']}>
      <Btn part="cancel" onClick={onCancel}>
        Cancel
      </Btn>
      <Btn kind={kind} part="go" disabled={!!busy} onClick={onGo}>
        {busy ?? label}
      </Btn>
    </div>
  );
}

export function SetupPassword({
  busy,
  onCancel,
  onContinue,
}: {
  busy: string | null;
  onCancel: () => void;
  onContinue: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const go = () => onContinue(password);
  return (
    <div className={styles['card']} data-part="setupPassword">
      <div className={styles['h']}>Turn on two-factor authentication</div>
      <div className={styles['sub']}>
        You&apos;ll need an authenticator app (Google Authenticator, Microsoft Authenticator, Authy,
        1Password…). First, confirm your password.
      </div>
      <PasswordField value={password} onChange={setPassword} onEnter={go} />
      <Foot busy={busy} label="Continue" kind="primary" onCancel={onCancel} onGo={go} />
    </div>
  );
}

export function SetupScan({
  setup,
  busy,
  onCancel,
  onTurnOn,
}: {
  setup: Setup;
  busy: string | null;
  onCancel: () => void;
  onTurnOn: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const go = () => onTurnOn(code);
  return (
    <div className={styles['card']} data-part="setupScan">
      <div className={styles['h']}>Scan this with your authenticator app</div>
      <ol className={styles['steps']}>
        <li>Open the app and add an account (＋), then scan the code below.</li>
        <li>Type the 6-digit code it shows to finish.</li>
      </ol>
      <div className={styles['qr']} data-part="qr">
        <img alt="QR code to scan with your authenticator app" src={setup.qr} />
        <div className={styles['grow']}>
          <div className={styles['sub']}>
            On your phone?{' '}
            <a className={styles['link']} href={setup.otpauth}>
              Open in your authenticator app
            </a>
            .
          </div>
          <div className={cx(styles['sub'], styles['gap'])}>Or enter this key by hand:</div>
          <div className={styles['key']} data-part="key">
            {groups4(setup.secret)}
          </div>
        </div>
      </div>
      <CodeField
        label="6-digit code"
        value={code}
        onChange={setCode}
        onEnter={go}
        numeric
        maxLength={8}
      />
      <Foot busy={busy} label="Turn on" kind="primary" onCancel={onCancel} onGo={go} />
    </div>
  );
}

export function Codes({
  codes,
  signedOut,
  onCopy,
  onDownload,
  onDone,
}: {
  codes: readonly string[];
  signedOut: number;
  onCopy: () => void;
  onDownload: () => void;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className={styles['card']} data-part="codesCard">
      <div className={styles['h']}>Save your recovery codes</div>
      <div className={styles['sub']}>
        If you lose your phone, each of these signs you in <b>once</b>. They are shown only now —
        store them somewhere safe (a password manager, or printed).
      </div>
      <div className={styles['codes']} data-part="codes">
        {codes.map(c => (
          <code key={c}>{c}</code>
        ))}
      </div>
      <div className={cx(styles['actions'], styles['start'])}>
        <Btn small part="copy" onClick={onCopy}>
          Copy
        </Btn>
        <Btn small part="download" onClick={onDownload}>
          Download
        </Btn>
      </div>
      {signedOut > 0 && (
        <div className={cx(styles['sub'], styles['gapLg'])} data-part="signedOut">
          {signedOutLine(signedOut)}
        </div>
      )}
      <label className={styles['check']}>
        <input
          type="checkbox"
          data-part="saved"
          checked={saved}
          onChange={e => setSaved(e.target.checked)}
        />{' '}
        I have saved these codes
      </label>
      <div className={styles['foot']}>
        <Btn kind="primary" part="go" disabled={!saved} onClick={onDone}>
          Done
        </Btn>
      </div>
    </div>
  );
}

export function Disable({
  busy,
  onCancel,
  onTurnOff,
}: {
  busy: string | null;
  onCancel: () => void;
  onTurnOff: (password: string, code: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const go = () => onTurnOff(password, code);
  const codeId = 'code';
  return (
    <div className={styles['card']} data-part="disable">
      <div className={styles['h']}>Turn off two-factor authentication</div>
      <div className={styles['sub']}>
        Your account will be protected by your password alone, and your other devices will be signed
        out.
      </div>
      <PasswordField
        value={password}
        onChange={setPassword}
        onEnter={() => document.querySelector<HTMLInputElement>(`[data-part=${codeId}]`)?.focus()}
      />
      <CodeField
        label="Code from your app (or a recovery code)"
        value={code}
        onChange={setCode}
        onEnter={go}
        numeric={false}
        maxLength={14}
      />
      <Foot busy={busy} label="Turn off" kind="danger" onCancel={onCancel} onGo={go} />
    </div>
  );
}

export function NewCodes({
  busy,
  onCancel,
  onMake,
}: {
  busy: string | null;
  onCancel: () => void;
  onMake: (password: string, code: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const go = () => onMake(password, code);
  return (
    <div className={styles['card']} data-part="newCodesCard">
      <div className={styles['h']}>Make new recovery codes</div>
      <div className={styles['sub']}>The old codes stop working.</div>
      <PasswordField
        value={password}
        onChange={setPassword}
        onEnter={() => document.querySelector<HTMLInputElement>('[data-part=code]')?.focus()}
      />
      <CodeField
        label="Code from your app"
        value={code}
        onChange={setCode}
        onEnter={go}
        numeric
        maxLength={8}
      />
      <Foot busy={busy} label="Make new codes" kind="primary" onCancel={onCancel} onGo={go} />
    </div>
  );
}
