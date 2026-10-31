import { useId, useState } from 'react';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import { Modal } from '../../ui/Modal';
import {
  passwordDone,
  passwordProblem,
  STATUS_EMOJI_MAX,
  STATUS_PRESETS,
  STATUS_TEXT_MAX,
  useAccount,
} from './account';
import { useSession } from '../../app/context';
import styles from './account.module.css';

/** "Set status": an emoji and a few words, or one of the four the portal offers — saved, or cleared. */
function StatusDialog({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const account = useAccount();
  const [emoji, setEmoji] = useState(me.profile?.statusEmoji ?? '');
  const [text, setText] = useState(me.profile?.statusText ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (cleared: boolean) => {
    setBusy(true);
    const ok = await account.saveStatus(cleared ? '' : emoji, cleared ? '' : text, cleared);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title="Set status" onClose={onClose} width={420} loose>
      <div className={styles['statusRow']}>
        <input
          className={cx(styles['input'], styles['emoji'])}
          data-part="emoji"
          aria-label="Status emoji"
          maxLength={STATUS_EMOJI_MAX}
          placeholder="🙂"
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
        />
        <input
          className={cx(styles['input'], styles['words'])}
          data-part="text"
          aria-label="Status"
          maxLength={STATUS_TEXT_MAX}
          placeholder="What's on your mind?"
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </div>
      <div className={styles['presetsLabel']}>For MotoLinkers</div>
      <div className={styles['presets']} data-part="presets">
        {STATUS_PRESETS.map(([icon, words, note]) => (
          <button
            key={words}
            type="button"
            className={styles['preset']}
            data-part="preset"
            onClick={() => {
              setEmoji(icon);
              setText(words);
            }}
          >
            {icon} <strong>{words}</strong>
            {note && <span className={styles['note']}>{note}</span>}
          </button>
        ))}
      </div>
      <div className={styles['foot']}>
        <Btn data-part="clear" disabled={busy} onClick={() => void save(true)}>
          Clear status
        </Btn>
        <Btn kind="primary" data-part="save" disabled={busy} onClick={() => void save(false)}>
          Save
        </Btn>
      </div>
    </Modal>
  );
}

/** "Change Username": 3–32 letters, numbers, dots, dashes and underscores; what the server refuses is said in the dialog. */
function UsernameDialog({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const account = useAccount();
  const [name, setName] = useState(me.profile?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await account.saveUsername(name);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.message || 'Failed');
  };
  return (
    <Modal
      title="Change Username"
      hint="3–32 characters: letters, numbers, dots, dashes, underscores."
      head="plain"
      width={380}
      hintGap={16}
      loose
      onClose={onClose}
    >
      {error && (
        <div className={cx(styles['err'], styles['close'])} data-part="error" role="alert">
          {error}
        </div>
      )}
      <input
        className={cx(styles['input'], styles['gap'])}
        data-part="username"
        aria-label="New username"
        placeholder="new.username"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') void save();
        }}
      />
      <div className={styles['foot']}>
        <Btn data-part="cancel" onClick={onClose}>
          Cancel
        </Btn>
        <Btn kind="primary" data-part="save" disabled={busy} onClick={() => void save()}>
          Save
        </Btn>
      </div>
    </Modal>
  );
}

/** "Change Password": the current one and the new one twice; every other device is signed out, and this says how many. */
function PasswordDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const ids = { current: useId(), next: useId(), again: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    setDone(null);
    const problem = passwordProblem(current, next, again);
    if (problem) return setError(problem);
    setBusy(true);
    const r = await account.changePassword(current, next);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setDone(passwordDone(r.value.revoked));
    // A failure to sign the others out is not a success: the old password's logins may still be alive.
    if (r.value.warning) setError(r.value.warning);
    setCurrent('');
    setNext('');
    setAgain('');
  };
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint: string,
    part: string,
  ) => (
    <div className={styles['group']} data-part="group">
      <label className={styles['label']} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles['control']}
        data-part={part}
        type="password"
        placeholder={hint}
        value={value}
        onChange={e => set(e.target.value)}
      />
    </div>
  );
  return (
    <Modal
      title="Change Password"
      hint="Update your portal password. Every other device you are signed in on will be signed out."
      head="plain"
      width={380}
      loose
      onClose={onClose}
    >
      {error && (
        <div className={cx(styles['err'], styles['wide'])} data-part="error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div className={cx(styles['ok'], styles['wide'])} data-part="done" role="status">
          {done}
        </div>
      )}
      {field(
        ids.current,
        'Current Password',
        current,
        setCurrent,
        'Your current password',
        'current',
      )}
      {field(ids.next, 'New Password', next, setNext, 'At least 8 characters', 'new')}
      {field(ids.again, 'Confirm New Password', again, setAgain, 'Repeat new password', 'confirm')}
      <div className={styles['footFill']}>
        <Btn className={styles['fill']} data-part="cancel" onClick={onClose}>
          Cancel
        </Btn>
        <Btn
          kind="primary"
          className={styles['fill']}
          data-part="update"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Updating…' : 'Update Password'}
        </Btn>
      </div>
    </Modal>
  );
}

/** The account menu's dialogs: the one that was asked for. */
export function AccountDialogs({
  which,
  onClose,
}: {
  which: 'status' | 'username' | 'password';
  onClose: () => void;
}) {
  if (which === 'status') return <StatusDialog onClose={onClose} />;
  if (which === 'username') return <UsernameDialog onClose={onClose} />;
  return <PasswordDialog onClose={onClose} />;
}
