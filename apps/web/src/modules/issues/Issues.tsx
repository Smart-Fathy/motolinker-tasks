import { can } from '@motolinker/contracts/access';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { InsightCard, useAssistantRecord } from '../../assistant';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { cx } from '../../ui/cx';
import { useComments, useIssues } from './data';
import styles from './issues.module.css';
import {
  countsOf,
  FOR_TICKETS,
  fileHref,
  initialsOf,
  isOpen,
  ISSUE_ICONS,
  SAID,
  shows,
  subtitleOf,
  whenOf,
  type Issue,
  type IssueComment,
  type IssueFilter,
} from './model';

function Pill({ open }: { open: boolean }) {
  return (
    <span
      className={cx(styles['pill'], open ? styles['pillOpen'] : styles['pillDone'])}
      data-part="pill"
    >
      <i />
      {open ? 'Open' : 'Resolved'}
    </span>
  );
}

function Loading({ words = true }: { words?: boolean }) {
  return (
    <div className={styles['loading']} data-part="loading">
      <span className={styles['spinner']} />
      {words ? ' Loading…' : null}
    </div>
  );
}

function Message({ c }: { c: IssueComment }) {
  const href = fileHref(c.file_url);
  return (
    <div className={styles['msg']} data-part="msg">
      <div className={styles['msgHead']} data-part="msgHead">
        <strong>{c.author_name || '—'}</strong>
        <span>{whenOf(c.created_at)}</span>
      </div>
      {c.body ? (
        <div className={styles['msgBody']} data-part="msgBody">
          {c.body}
        </div>
      ) : null}
      {href ? (
        <a
          className={styles['link']}
          data-part="link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name={ISSUE_ICONS.attachment} />
          {c.file_name || 'attachment'}
        </a>
      ) : null}
    </div>
  );
}

interface TicketProps {
  issue: Issue;
  mayResolve: boolean;
  onToggle: (issue: Issue) => void;
}

/** One ticket, read and answered: who reported it and when, what they said, and the conversation under it. */
function Ticket({ issue, mayResolve, onToggle }: TicketProps) {
  const { toasts } = useSession();
  const comments = useComments(issue.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const open = isOpen(issue);
  const attachment = fileHref(issue.file_url);

  const send = async () => {
    const body = text.trim();
    if (!body) {
      input.current?.focus();
      return;
    }
    setSending(true);
    const out = await comments.post(body);
    if (out.ok) setText('');
    else toasts.show(out.message);
    flushSync(() => setSending(false));
    input.current?.focus();
  };

  return (
    <>
      <div className={styles['dHead']} data-part="dHead">
        <div className={styles['dTitle']} data-part="dTitle">
          {issue.title || 'System issue'}
        </div>
        <Pill open={open} />
      </div>
      <div className={styles['dBy']} data-part="dBy">
        <span className={styles['av']} data-part="av">
          {initialsOf(issue.reporter_name)}
        </span>
        <span>
          <strong>{issue.reporter_name || '—'}</strong>
          <span className={styles['dWhen']}>{whenOf(issue.created_at)}</span>
        </span>
      </div>
      {issue.description ? (
        <div className={styles['dBody']} data-part="dBody">
          {issue.description}
        </div>
      ) : (
        <div className={cx(styles['dBody'], styles['dBodyMuted'])} data-part="dBody">
          No description was given.
        </div>
      )}
      {attachment ? (
        <a
          className={styles['link']}
          data-part="link"
          href={attachment}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name={ISSUE_ICONS.attachment} />
          View attachment
        </a>
      ) : null}
      {!open && issue.resolved_by ? (
        <div className={styles['dSolved']} data-part="dSolved">
          <Icon name={ISSUE_ICONS.solved} />
          Solved by {issue.resolved_by}
          {issue.resolved_at ? ` · ${whenOf(issue.resolved_at)}` : ''}
        </div>
      ) : null}
      <div className={styles['dSep']} data-part="dSep" />
      <div className={styles['dLabel']} data-part="dLabel">
        Conversation
      </div>
      <div className={styles['thread']} data-part="thread">
        {comments.loading ? (
          <Loading words={false} />
        ) : comments.error ? (
          <div className={styles['none']} data-part="none">
            {comments.error}
          </div>
        ) : comments.items.length ? (
          comments.items.map(c => <Message key={c.id} c={c} />)
        ) : (
          <div className={styles['none']} data-part="none">
            No replies yet.
          </div>
        )}
      </div>
      <div className={styles['reply']} data-part="reply">
        <textarea
          ref={input}
          rows={2}
          value={text}
          disabled={sending}
          placeholder={`Reply to ${issue.reporter_name || 'the reporter'}…`}
          aria-label="Your reply"
          onChange={e => setText(e.target.value)}
        />
        <div className={styles['replyRow']} data-part="replyRow">
          <button
            type="button"
            className={cx(styles['btn'], styles['btnPrimary'])}
            data-part="send"
            onClick={() => void send()}
          >
            Send
          </button>
          {mayResolve ? (
            <button
              type="button"
              className={cx(styles['btn'], styles['btnOutline'])}
              data-part="toggle"
              onClick={() => onToggle(issue)}
            >
              {open ? 'Mark solved' : 'Reopen'}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

const CHIPS: readonly { value: IssueFilter; label: string; dot?: 'open' | 'done' }[] = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open', dot: 'open' },
  { value: 'resolved', label: 'Resolved', dot: 'done' },
];

/**
 * The Issues centre: what the team reported, as a queue on one side and the ticket and its conversation on the other. For
 * whoever may read the centre; whoever may manage it can also close a ticket and reopen it. The classic team portal's page,
 * which the admin portal now has too.
 */
export function Issues() {
  const { access, toasts } = useSession();
  const { items, loading, error, setStatus } = useIssues();
  const [filter, setFilter] = useState<IssueFilter>('');
  const [openId, setOpenId] = useState<number | null>(null);
  const filterNow = useRef<IssueFilter>('');
  const pane = useRef<HTMLDivElement>(null);
  const mayResolve = can(access.actor, 'issues.resolve');
  const counts = countsOf(items);
  const rows = items.filter(i => shows(filter, i));
  const selected = rows.find(i => i.id === openId) ?? null;
  // (what the assistant is told is open: "this ticket" means the one in the reading pane)
  useAssistantRecord(
    selected ? { kind: 'issue', id: String(selected.id), title: selected.title, sub: '' } : null,
  );

  // The reading pane stays on a ticket the filter still shows, and lets go of one it does not.
  const chooseFilter = (next: IssueFilter) => {
    filterNow.current = next;
    setFilter(next);
    if (openId !== null && !items.some(i => i.id === openId && shows(next, i))) setOpenId(null);
  };
  const pick = (id: number) => {
    setOpenId(id);
    if (window.matchMedia?.('(max-width:900px)').matches) {
      pane.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  };
  const toggle = async (issue: Issue) => {
    const status = isOpen(issue) ? 'resolved' : 'open';
    const out = await setStatus(issue.id, status);
    if (!out.ok) {
      toasts.show(out.message);
      return;
    }
    if (!shows(filterNow.current, out.value)) setOpenId(cur => (cur === issue.id ? null : cur));
    toasts.show(status === 'resolved' ? SAID.solved : SAID.reopened);
  };

  const list = loading ? (
    <Loading />
  ) : error ? (
    <div className={styles['empty']} data-part="empty">
      {error}
    </div>
  ) : rows.length === 0 ? (
    <div className={styles['empty']} data-part="empty">
      No issues here — all clear! 🎉
    </div>
  ) : (
    rows.map(i => {
      const open = isOpen(i);
      const on = i.id === selected?.id;
      return (
        <button
          key={i.id}
          type="button"
          className={cx(styles['card'], !open && styles['cardDone'], on && styles['cardSel'])}
          data-part="card"
          aria-pressed={on}
          onClick={() => pick(i.id)}
        >
          <span
            className={cx(styles['stripe'], open ? styles['stripeOpen'] : styles['stripeDone'])}
            data-part="stripe"
          />
          <span className={styles['cardMain']} data-part="cardMain">
            <span className={styles['cardTitle']} data-part="cardTitle">
              {i.title || 'System issue'}
            </span>
            <span className={styles['cardMeta']} data-part="cardMeta">
              {i.reporter_name || '—'} · {whenOf(i.created_at)}
            </span>
          </span>
          <Pill open={open} />
        </button>
      );
    })
  );

  return (
    <div className={styles['page']} data-part="issuesPage">
      <InsightCard screen="issues" />
      <div className={styles['head']} data-part="head">
        <h2 className={styles['title']} data-part="heading">
          Reported issues
        </h2>
        <p className={styles['sub']} data-part="sub">
          {loading || error ? FOR_TICKETS : subtitleOf(counts.open)}
        </p>
      </div>
      <div className={styles['chips']} data-part="chips" role="group" aria-label="Show">
        {CHIPS.map(chip => {
          const on = filter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              className={cx(styles['chip'], on && styles['chipOn'])}
              data-part="chip"
              data-value={chip.value}
              aria-pressed={on}
              onClick={() => chooseFilter(chip.value)}
            >
              {chip.dot ? (
                <span
                  className={cx(
                    styles['dot'],
                    chip.dot === 'open' ? styles['dotOpen'] : styles['dotDone'],
                  )}
                  data-part="dot"
                />
              ) : null}
              {chip.label}{' '}
              <span className={styles['count']} data-part="count">
                {chip.value === '' ? counts.all : counts[chip.value]}
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles['split']} data-part="split">
        <div className={styles['list']} data-part="list">
          {list}
        </div>
        <div className={styles['detail']} data-part="detail" ref={pane}>
          {selected ? (
            <Ticket
              key={selected.id}
              issue={selected}
              mayResolve={mayResolve}
              onToggle={i => void toggle(i)}
            />
          ) : (
            <div className={styles['paneEmpty']} data-part="paneEmpty">
              <Icon name={ISSUE_ICONS.empty} />
              <span>Pick a ticket to read it and reply.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
