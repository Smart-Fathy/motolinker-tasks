import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFrame, useSession } from '../../app/context';
import { cx } from '../../ui/cx';
import { useDialog } from '../../ui/useDialog';
import { securityCalls } from './data';
import { codesText, othersSignedOut, SAID, sixDigits, type Overview, type Setup } from './model';
import styles from './security.module.css';
import { Codes, Disable, Main, NewCodes, SetupPassword, SetupScan } from './views';

type View = 'main' | 'setup-password' | 'setup-scan' | 'codes' | 'disable' | 'newcodes';
/** The setup in progress and the codes just issued: what the panel keeps only while it is on its way somewhere. */
interface Draft {
  setup?: Setup;
  codes?: readonly string[];
  signedOut?: number;
}
interface Message {
  kind: 'err' | 'ok';
  text: string;
}

/**
 * "Account security", over whatever page the person is on: two-factor authentication, the devices the account is signed in on,
 * and its recent sign-ins, for both portals (the team's adds a Password card). It is the classic panel's (public/assets/
 * security.js) in everything it says and asks: the password again before anything that could lock the owner out or strip
 * their protection, the codes it shows once, and what it does about the other devices. Escape, the × and a press on the
 * curtain close it.
 */
export function SecurityPanel({ onClose }: { onClose: () => void }) {
  const { api, resubscribePush } = useSession();
  const frame = useFrame();
  const calls = useMemo(() => securityCalls(api), [api]);
  const box = useDialog(onClose);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [view, setView] = useState<View>('main');
  const [draft, setDraft] = useState<Draft>({});
  const [message, setMessage] = useState<Message | null>(null);
  /** what the main button of a form says while its question is out (null: nothing is out) */
  const [busy, setBusy] = useState<string | null>(null);
  const working = useRef(false);

  const say = useCallback((kind: Message['kind'], text: string) => setMessage({ kind, text }), []);
  /** Another page of the panel: what was said on the last is not said on this. */
  const show = useCallback((next: View) => {
    setView(next);
    setMessage(null);
    if (next === 'main') setDraft({});
  }, []);

  // The overview is asked for when the panel opens and again after anything that changes it. A refusal about the session
  // (401) is the app's to act on, not the panel's to word.
  const settle = useCallback(
    (r: Awaited<ReturnType<typeof calls.overview>>) => {
      setMessage(null);
      if (r.ok) setOverview(r.value);
      else if (r.status !== 401) say('err', r.message || SAID.loadFailed);
    },
    [calls, say],
  );
  const reload = useCallback(async () => settle(await calls.overview()), [calls, settle]);
  useEffect(() => {
    let open = true;
    void calls.overview().then(r => {
      if (open) settle(r);
    });
    return () => {
      open = false;
    };
  }, [calls, settle]);

  // Whatever page it is on, the first thing to type in is ready to be typed in.
  useEffect(() => {
    box.current?.querySelector('input')?.focus();
  }, [box, view, overview]);

  /** One question at a time: a slow answer is not asked twice, and the button says what it is doing. */
  const run = useCallback(async <T,>(label: string, work: () => Promise<T>) => {
    if (working.current) return undefined;
    working.current = true;
    setBusy(label);
    try {
      return await work();
    } finally {
      working.current = false;
      setBusy(null);
    }
  }, []);

  const startSetup = async (password: string) => {
    if (working.current) return;
    if (!password) return say('err', SAID.password);
    const r = await run('Checking…', () => calls.startSetup(password));
    if (!r) return;
    if (!r.ok) return say('err', r.message);
    setDraft({ setup: r.value });
    show('setup-scan');
  };

  const finishSetup = async (typed: string) => {
    if (working.current) return;
    const code = sixDigits(typed);
    if (!code) return say('err', SAID.six);
    const r = await run('Checking…', () => calls.enable(code));
    if (!r) return;
    if (!r.ok) return say('err', r.message);
    setDraft({ codes: r.value.recoveryCodes, signedOut: r.value.sessionsRevoked });
    resubscribePush();
    show('codes');
  };

  const turnOff = async (password: string, code: string) => {
    if (working.current) return;
    if (!password || !code) return say('err', SAID.passwordAndCode);
    const r = await run('Turning off…', () => calls.disable(password, code));
    if (!r) return;
    if (!r.ok) return say('err', r.message);
    resubscribePush();
    setDraft({});
    setView('main');
    await reload();
    say('ok', SAID.off);
  };

  const newCodes = async (password: string, typed: string) => {
    if (working.current) return;
    const code = sixDigits(typed);
    if (!password || !code) return say('err', SAID.passwordAndSix);
    const r = await run('Working…', () => calls.newCodes(password, code));
    if (!r) return;
    if (!r.ok) return say('err', r.message);
    setDraft({ codes: r.value.recoveryCodes });
    show('codes');
  };

  const signOut = async (sid: string) => {
    const r = await calls.signOut(sid);
    await reload();
    if (r.ok) say('ok', SAID.gone);
    else say('err', r.message);
  };

  const signOutOthers = async () => {
    if (!window.confirm('Sign out every other device? They will need to sign in again.')) return;
    const r = await calls.signOutOthers();
    // (the server clears this account's push subscriptions with the sessions it ends; this device's is made again)
    resubscribePush();
    await reload();
    if (!r.ok) say('err', r.message);
    else if (!r.value.ok) say('err', r.value.warning || SAID.unsure);
    else say('ok', othersSignedOut(r.value.sessionsRevoked));
  };

  const text = () => codesText(draft.codes ?? [], overview?.account.name ?? '');
  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(text());
      say('ok', SAID.copied);
    } catch {
      const area = document.createElement('textarea');
      area.value = text();
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        say('ok', SAID.copied);
      } catch {
        say('err', SAID.copyFailed);
      }
      area.remove();
    }
  };
  const downloadCodes = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
    a.download = 'motolinker-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const done = async () => {
    setDraft({});
    setView('main');
    await reload();
  };
  const cancel = () => show('main');

  let body;
  if (view === 'setup-password') {
    body = <SetupPassword busy={busy} onCancel={cancel} onContinue={p => void startSetup(p)} />;
  } else if (view === 'setup-scan' && draft.setup) {
    body = (
      <SetupScan
        setup={draft.setup}
        busy={busy}
        onCancel={cancel}
        onTurnOn={c => void finishSetup(c)}
      />
    );
  } else if (view === 'codes') {
    body = (
      <Codes
        codes={draft.codes ?? []}
        signedOut={draft.signedOut ?? 0}
        onCopy={() => void copyCodes()}
        onDownload={downloadCodes}
        onDone={() => void done()}
      />
    );
  } else if (view === 'disable') {
    body = <Disable busy={busy} onCancel={cancel} onTurnOff={(p, c) => void turnOff(p, c)} />;
  } else if (view === 'newcodes') {
    body = <NewCodes busy={busy} onCancel={cancel} onMake={(p, c) => void newCodes(p, c)} />;
  } else if (!overview) {
    body = (
      <div className={styles['sub']} data-part="loading">
        Loading…
      </div>
    );
  } else {
    body = (
      <Main
        overview={overview}
        go={show}
        onSignOut={sid => void signOut(sid)}
        onSignOutOthers={() => void signOutOthers()}
        onChangePassword={() => {
          onClose();
          frame.open('password');
        }}
      />
    );
  }

  return createPortal(
    <div
      className={styles['overlay']}
      role="dialog"
      aria-modal="true"
      aria-label="Account security"
      data-part="curtain"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={box} className={styles['box']} tabIndex={-1} data-part="dialog">
        <div className={styles['head']} data-part="head">
          <div className={styles['title']} data-part="title">
            Account security
          </div>
          <button
            type="button"
            className={styles['x']}
            data-part="close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className={styles['lead']} data-part="lead">
          {overview?.account.name ? overview.account.name + ' · ' : ''}Protect your account and see
          where it is signed in.
        </p>
        {message && (
          <div
            className={cx(styles['msg'], styles[message.kind])}
            data-part="message"
            data-kind={message.kind}
            role={message.kind === 'err' ? 'alert' : 'status'}
          >
            {message.text}
          </div>
        )}
        {body}
      </div>
    </div>,
    document.body,
  );
}
