import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from '../app/shell/icons';
import { cx } from '../ui/cx';
import styles from './assistant.module.css';
import { Brain } from './Brain';
import { useStatus } from './data';
import {
  AI_ICONS,
  isAr,
  lookingAt,
  modelName,
  placeholderFor,
  SAID,
  uiLang,
  WIDTH,
  type AiStatus,
  type AiToolCall,
  type Lang,
  type ProposalState,
  type Turn,
} from './model';
import { useAssistant, type AssistantValue } from './state';

const MUTED = 'var(--muted,#9a958a)';
const WARN = 'var(--h-e6a850,#e6a850)';

/** The line under the panel's title: how the model is doing, and what it is reading. */
function statusLine(
  status: AiStatus | null,
  pending: boolean,
  label: string,
): { text: string; color?: string } {
  if (!status) return { text: pending ? SAID.statusPending : '' };
  if (!status.ai) return { text: SAID.notConfigured, color: WARN };
  if (status.ok === true)
    return { text: SAID.connected(modelName(status.model), label), color: '#6dd8a4' };
  if (status.status === 429) return { text: SAID.busy, color: WARN };
  if (status.ok === false)
    return { text: SAID.failing(status.error || SAID.unknownError), color: WARN };
  return { text: SAID.ready(label), color: MUTED };
}

/** What a lookup the model made looked like: what it asked, and what it got. (A sum is shown as a sum.) */
function work(call: AiToolCall): string {
  const r = (call.result ?? {}) as Record<string, unknown>;
  if (call.name === 'calculate') {
    const result = r['error']
      ? 'error: ' + String(r['error'])
      : '= ' +
        (typeof r['result'] === 'number'
          ? r['result'].toLocaleString('en-US', { maximumFractionDigits: 4 })
          : String(r['result']));
    return `calculate(${String(call.args['expression'])})\n${result}`;
  }
  return `${call.name}(${JSON.stringify(call.args || {})})\n${JSON.stringify(call.result ?? {}).slice(0, 400)}`;
}

function Message({ turn }: { turn: Turn }) {
  const calls =
    turn.role === 'bot'
      ? (turn.meta?.tool_calls ?? []).filter(c => c.name !== 'propose_action')
      : [];
  return (
    <div
      className={cx(
        styles['msg'],
        turn.role === 'user' ? styles['msgUser'] : styles['msgBot'],
        isAr(turn.content) && styles['msgAr'],
      )}
      data-part={turn.role === 'user' ? 'msgUser' : 'msgBot'}
    >
      {turn.content}
      {turn.role === 'bot' && turn.meta && (
        <>
          {calls.length > 0 && (
            <details className={styles['work']} data-part="work">
              <summary>{SAID.lookups(calls.length)}</summary>
              {calls.map((c, i) => (
                <code key={i}>{work(c)}</code>
              ))}
            </details>
          )}
          <div className={styles['tag']} data-part="tag">
            {SAID.tag(turn.meta.model)}
          </div>
        </>
      )}
    </div>
  );
}

function Proposal({
  p,
  busy,
  confirm,
  dismiss,
}: {
  p: ProposalState;
  busy: boolean;
  confirm: () => void;
  dismiss: () => void;
}) {
  if (p.state === 'dismissed') return null;
  if (p.state === 'done') {
    return (
      <div className={cx(styles['action'], styles['actionDone'])} data-part="actionDone">
        <div className={styles['actionT']}>{SAID.done}</div>
        <div className={styles['actionD']}>{p.message || p.description}</div>
      </div>
    );
  }
  return (
    <div
      className={cx(styles['action'], p.state === 'failed' && styles['actionFailed'])}
      data-part={p.state === 'failed' ? 'actionFailed' : 'action'}
    >
      <div className={styles['actionT']}>{SAID.proposed(p.label || p.action.type || 'action')}</div>
      <div className={styles['actionD']}>{p.description}</div>
      {p.state === 'failed' ? (
        <div className={styles['actionWhy']}>{p.error}</div>
      ) : (
        <div className={styles['actionR']}>
          <button
            type="button"
            className={cx(styles['btn'], styles['btnPri'])}
            data-part="confirm"
            disabled={busy}
            onClick={confirm}
          >
            {SAID.confirm}
          </button>
          <button
            type="button"
            className={styles['btn']}
            data-part="dismiss"
            disabled={busy}
            onClick={dismiss}
          >
            {SAID.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}

/** The first thing in a section's conversation: what the assistant reads, what it can do, and (until a question is asked) a few things to ask. */
function Welcome({ assistant, chipsToo }: { assistant: AssistantValue; chipsToo: boolean }) {
  const { section, label, act } = assistant;
  const lang = uiLang(assistant.lang, navigator.language);
  const chips = section.chips[lang].length ? section.chips[lang] : section.chips.en;
  const said = SAID.welcome(label, act && section.actions.length > 0);
  return (
    <>
      <div className={cx(styles['msg'], styles['msgBot'])} data-part="welcome">
        {said.before}
        <b>{said.label}</b>
        {said.after}
        {said.act}
      </div>
      {chipsToo && (
        <div>
          {chips.map(c => (
            <button
              key={c}
              type="button"
              className={styles['chip']}
              data-part="chip"
              onClick={() => void assistant.send(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** The panel: the conversation about the section the person is on, beside the page (on a desktop), over it, or as a sheet (on a phone). */
export function Panel() {
  const assistant = useAssistant();
  const [entered, setEntered] = useState(false);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = !!assistant?.open;
  const focusTick = assistant?.focusTick ?? 0;
  const { status, pending } = useStatus(open, assistant?.page ?? 'home');

  // Mounted closed, and opened a moment later, so that the first opening slides in like every other.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The box takes the keyboard when the panel is opened on purpose — not on a phone, whose keyboard would cover the answer.
  useEffect(() => {
    if (!open || focusTick === 0) return;
    if (window.matchMedia?.('(max-width: 768px)').matches) return;
    const id = window.setTimeout(() => box.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [open, focusTick]);

  // The newest thing said is the one in view.
  const turnCount = assistant?.turns.length ?? 0;
  const answering = assistant?.answering ?? null;
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnCount, answering, open]);

  if (!assistant) return null;
  const { section, label, record, turns } = assistant;
  const line = statusLine(status, pending, label);
  const typing = answering === section.key;

  const submit = () => {
    const t = text.trim();
    if (!t || answering) return;
    setText('');
    void assistant.send(t);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  // Drag the left edge to resize; the width is remembered.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.current?.getBoundingClientRect().width ?? assistant.width;
    setDragging(true);
    document.body.style.userSelect = 'none';
    const move = (m: MouseEvent) =>
      assistant.setWidth(
        Math.max(WIDTH.min, Math.min(WIDTH.max, Math.round(startW + (startX - m.clientX)))),
      );
    const stop = () => {
      setDragging(false);
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };

  const shown = open && entered;
  return (
    <div className={cx(assistant.docked && styles['docked'])} data-part="aiRoot">
      <div
        className={cx(styles['overlay'], shown && styles['overlayOpen'])}
        data-part="aiOverlay"
        onClick={assistant.closePanel}
      >
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          data-close
          onClick={assistant.closePanel}
        />
      </div>
      <div
        ref={panel}
        className={cx(styles['panel'], shown && styles['panelOpen'])}
        data-part="aiPanel"
        role="dialog"
        aria-label="AI assistant"
      >
        <div
          className={cx(styles['grip'], dragging && styles['gripOn'])}
          data-part="aiGrip"
          title={SAID.grip}
          onMouseDown={startDrag}
        />
        <div className={styles['head']} data-part="aiHead">
          <div className={styles['headWho']}>
            <div className={styles['title']} data-part="aiTitle">
              <Brain />
              <span>{SAID.title}</span>{' '}
              <small>
                · <span data-part="aiSection">{label}</span>
              </small>
            </div>
            <div
              className={styles['status']}
              data-part="aiStatus"
              {...(line.color ? { style: { color: line.color } } : {})}
            >
              {line.text}
            </div>
          </div>
          <div className={styles['tools']}>
            <select
              className={styles['sel']}
              data-part="aiLang"
              title={SAID.language}
              value={assistant.lang}
              onChange={e => assistant.setLang(e.target.value as Lang)}
            >
              <option value="auto">Auto</option>
              <option value="en">EN</option>
              <option value="ar">AR</option>
            </select>
            <button
              type="button"
              className={styles['ib']}
              data-part="aiNew"
              title={SAID.newChat}
              aria-label={SAID.newChat}
              onClick={assistant.newChat}
            >
              <Icon name={AI_ICONS.newChat} />
            </button>
            <button
              type="button"
              className={styles['ib']}
              data-part="aiClose"
              title={SAID.close}
              aria-label="Close"
              onClick={assistant.closePanel}
            >
              ×
            </button>
          </div>
        </div>
        <div className={cx(styles['screen'], record && styles['screenOn'])} data-part="aiScreen">
          {record && (
            <>
              <span className={styles['screenKind']}>{SAID.lookingAt}</span>
              <span className={styles['screenTitle']}>{lookingAt(record)}</span>
              <button
                type="button"
                className={styles['screenX']}
                data-part="aiIgnore"
                title={SAID.ignore}
                onClick={assistant.ignoreRecord}
              >
                ×
              </button>
            </>
          )}
        </div>
        <div className={styles['body']} data-part="aiBody" ref={body}>
          {turns.length === 0 ? (
            <Welcome assistant={assistant} chipsToo />
          ) : (
            [
              assistant.welcomeKept && (
                <Welcome key="welcome" assistant={assistant} chipsToo={false} />
              ),
              ...turns.map((turn, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <Message turn={turn} />
                  {turn.role === 'bot' &&
                    turn.meta?.proposals.map((p, j) => (
                      <Proposal
                        key={j}
                        p={p}
                        busy={assistant.confirming.has(`${section.key}:${i}:${j}`)}
                        confirm={() => void assistant.confirm(i, j)}
                        dismiss={() => assistant.dismiss(i, j)}
                      />
                    ))}
                </div>
              )),
            ]
          )}
          {typing && (
            <div className={cx(styles['msg'], styles['msgBot'])} data-part="typing">
              {SAID.typing}
            </div>
          )}
        </div>
        <div className={styles['composer']} data-part="aiComposer">
          <textarea
            ref={box}
            rows={1}
            data-part="aiInput"
            placeholder={placeholderFor(record)}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button
            type="button"
            className={styles['send']}
            data-part="aiSend"
            aria-label={SAID.send}
            disabled={!!answering}
            onClick={submit}
          >
            <Icon name={AI_ICONS.send} size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
