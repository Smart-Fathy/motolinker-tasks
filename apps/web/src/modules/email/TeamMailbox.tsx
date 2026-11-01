import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Account, Failure, Loading, ReconnectNotice } from '../../google';
import googleStyles from '../../google/google.module.css';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import { TextControl } from '../../ui/Form';
import { useInbox, useMessage, useSend } from './data';
import styles from './email.module.css';
import { Frame } from './Frame';
import type { MailboxProps } from './Mailbox';
import {
  listDateOf,
  replySubjectOf,
  sendBodyOf,
  senderOf,
  SAID,
  type MailMessage,
  type MailSummary,
} from './model';

/**
 * The team's inbox: a line with whose Gmail it is and Disconnect, a card with the inbox, and — under it, once a message is chosen —
 * the message with a way back and a box to answer it in.
 */
export function TeamMailbox({ link, busy, maySend, onDisconnect, onReconnect }: MailboxProps) {
  const inbox = useInbox(true);
  const [openId, setOpenId] = useState<string | null>(null);

  let list: ReactNode;
  if (inbox.loading) {
    list = <Loading part="inboxLoading" text={SAID.loadingMessages} pad={28} />;
  } else if (inbox.error) {
    list = <Failure message={inbox.error} />;
  } else if (!inbox.messages.length) {
    list = (
      <div className={styles['teamNone']} data-part="inboxNone">
        {SAID.teamNone}
      </div>
    );
  } else {
    list = inbox.messages.map(m => (
      <Row key={m.id} m={m} active={m.id === openId} onOpen={() => setOpenId(m.id)} />
    ));
  }

  return (
    <>
      <Account link={link} busy={busy} {...(onDisconnect ? { onDisconnect } : {})} />
      {!link.canSend && maySend && (
        <ReconnectNotice
          before={SAID.reconnectBeforeTeam}
          after={SAID.reconnectAfter}
          locked={SAID.reconnectLocked}
          onReconnect={onReconnect}
        />
      )}
      <div className={googleStyles['teamCard']} data-part="inboxCard">
        <div className={styles['teamInboxHead']} data-part="inboxHeader">
          {SAID.inbox}
        </div>
        <div data-part="inboxList">{list}</div>
      </div>
      {openId !== null && (
        <Message key={openId} id={openId} maySend={maySend} onBack={() => setOpenId(null)} />
      )}
    </>
  );
}

/** A line of the inbox: the sender and the day, the subject, a snippet; bold and with a dot where unread, tinted where it is the open one. */
function Row({ m, active, onOpen }: { m: MailSummary; active: boolean; onOpen: () => void }) {
  return (
    <div
      className={cx(
        styles['teamRow'],
        active && styles['active'],
        m.unread && styles['teamUnread'],
      )}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      data-part="inboxRow"
    >
      <div className={styles['teamRowBody']}>
        {m.unread ? (
          <div className={styles['teamDot']} data-part="unreadDot" />
        ) : (
          <div className={styles['teamDotSpace']} />
        )}
        <div className={styles['rowBody']}>
          <div className={styles['teamTop']}>
            <div className={styles['teamFrom']} data-part="rowFrom">
              {senderOf(m.from)}
            </div>
            <div className={styles['teamDate']} data-part="rowDate">
              {listDateOf(m.date, 'team')}
            </div>
          </div>
          <div className={styles['teamSubject']} data-part="rowSubject">
            {m.subject || SAID.noSubject}
          </div>
          <div className={styles['snippet']} data-part="rowSnippet">
            {m.snippet}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The message that is open, under the inbox. Each message has its own box to answer in: what was typed for one is not sent to another's sender. */
function Message({ id, maySend, onBack }: { id: string; maySend: boolean; onBack: () => void }) {
  const { loading, message, error } = useMessage(id);
  let body: ReactNode;
  if (loading) {
    body = <Loading part="detailLoading" text={SAID.loadingOne} />;
  } else if (!message) {
    body = (
      <div className={styles['teamBodyError']} role="alert" data-part="detailError">
        {error ?? SAID.unreadable}
      </div>
    );
  } else if (message.isHtml) {
    body = <Frame html={message.body} className={styles['teamFrame']} />;
  } else {
    body = (
      <pre className={styles['teamText']} data-part="bodyText">
        {message.body}
      </pre>
    );
  }
  return (
    <div className={styles['teamDetail']} data-part="message">
      <div className={styles['teamPanel']} data-part="messageCard">
        <div className={styles['teamBar']} data-part="messageHead">
          <Btn small data-part="back" onClick={onBack}>
            <Icon name="arrow-left" size={14} />
            {SAID.teamBack}
          </Btn>
          <div className={styles['teamSubjectBig']} data-part="messageSubject">
            {message?.subject ?? ''}
          </div>
        </div>
        <div className={styles['teamMeta']} data-part="messageMeta">
          {message && (
            <>
              <div data-part="messageFrom">
                <strong>{SAID.from}</strong> {message.from}
              </div>
              <div data-part="messageTo">
                <strong>{SAID.to}</strong> {message.to}
              </div>
              <div data-part="messageDate">
                <strong>{SAID.date}</strong> {message.date}
              </div>
            </>
          )}
        </div>
        <div className={styles['teamBody']} data-part="messageBody">
          {body}
        </div>
        {message && maySend && <Reply message={message} />}
      </div>
    </div>
  );
}

/** The box under a message to answer it in. What is sent is a reply: to whoever wrote it, in its conversation, under its subject. */
function Reply({ message }: { message: MailMessage }) {
  const { toasts } = useSession();
  const send = useSend();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    const said = await send(
      sendBodyOf(
        { to: message.from, subject: replySubjectOf(message.subject), body },
        { threadId: message.threadId, messageId: message.messageId },
      ),
    );
    setSending(false);
    if (!said.ok) {
      toasts.show(SAID.failedTeam + said.message);
      return;
    }
    setText('');
    setSent(true);
    // (the button says it went for a moment, and is then the button it was)
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSent(false), 3000);
  };

  return (
    <div className={styles['teamReply']} data-part="reply">
      <div className={styles['teamReplyLabel']} data-part="replyLabel">
        {SAID.reply}
      </div>
      <TextControl
        part="replyBox"
        className={styles['teamReplyBox']}
        rows={4}
        value={text}
        placeholder={SAID.placeholderReply}
        aria-label={SAID.reply}
        onChange={e => setText(e.target.value)}
      />
      <Btn kind="primary" small data-part="send" disabled={sending} onClick={() => void submit()}>
        {sending ? (
          <>
            <span className={cx(googleStyles['spinner'])} data-part="spinner" /> {SAID.sending}
          </>
        ) : sent ? (
          <>
            <Icon name="check" size={14} /> {SAID.sent}
          </>
        ) : (
          <>
            <Icon name="send" size={14} /> {SAID.sendReply}
          </>
        )}
      </Btn>
    </div>
  );
}
