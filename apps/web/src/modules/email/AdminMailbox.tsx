import { useId, useState, type ReactNode } from 'react';
import { useSession } from '../../app/context';
import { Account, Failure, Loading, ReconnectNotice } from '../../google';
import googleStyles from '../../google/google.module.css';
import { Btn, Sheet } from '../../ui';
import { cx } from '../../ui/cx';
import { Control, FormGroup, FormLabel, TextControl } from '../../ui/Form';
import { useInbox, useMessage, useRefresh, useSend } from './data';
import styles from './email.module.css';
import { Frame } from './Frame';
import type { MailboxProps } from './Mailbox';
import {
  addressOf,
  detailDateOf,
  listDateOf,
  replySubjectOf,
  sendBodyOf,
  senderOf,
  SAID,
  type MailMessage,
  type MailSummary,
} from './model';

/** What the sheet for a new email starts with: a reply knows who it answers, the conversation and the message; a new email, nothing. */
interface Draft {
  to: string;
  subject: string;
  threadId: string;
  inReplyTo: string;
}

const BLANK: Draft = { to: '', subject: '', threadId: '', inReplyTo: '' };

/**
 * The administrator's inbox: a line with whose Gmail it is, Compose and Disconnect; then the inbox and, beside it, the message that is
 * open. On a phone one of the two is shown at a time. New emails and replies are written in a sheet over the page.
 */
export function AdminMailbox({ link, busy, maySend, onDisconnect, onReconnect }: MailboxProps) {
  const refresh = useRefresh();
  const inbox = useInbox(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  let list: ReactNode;
  if (inbox.loading) {
    list = <Loading part="inboxLoading" text="" />;
  } else if (inbox.error) {
    list = <Failure message={inbox.error} />;
  } else if (!inbox.messages.length) {
    list = (
      <div className={styles['none']} data-part="inboxNone">
        {SAID.adminNone}
      </div>
    );
  } else {
    list = inbox.messages.map(m => <Row key={m.id} m={m} onOpen={() => setOpenId(m.id)} />);
  }

  return (
    <>
      <Account
        link={link}
        busy={busy}
        {...(onDisconnect ? { onDisconnect } : {})}
        actions={
          maySend ? (
            <Btn
              kind="primary"
              className={styles['compose']}
              data-part="compose"
              onClick={() => setDraft(BLANK)}
            >
              {SAID.compose}
            </Btn>
          ) : null
        }
      />
      {!link.canSend && (
        <ReconnectNotice
          before={SAID.reconnectBeforeAdmin}
          after={SAID.reconnectAfter}
          locked={SAID.reconnectLocked}
          onReconnect={onReconnect}
        />
      )}
      <div
        className={cx(styles['split'], openId !== null && styles['showDetail'])}
        data-part="split"
      >
        <div className={styles['inboxPane']} data-part="inboxPane">
          <div className={googleStyles['tableCard']} data-part="inboxCard">
            <div className={googleStyles['tableHeader']} data-part="inboxHeader">
              <span className={googleStyles['tableTitle']} data-part="inboxTitle">
                {SAID.inbox}
              </span>
              <Btn className={styles['refresh']} data-part="refresh" onClick={refresh}>
                {SAID.refresh}
              </Btn>
            </div>
            <div data-part="inboxList">{list}</div>
          </div>
        </div>
        <div className={styles['detailPane']} data-part="detailPane">
          {openId === null ? (
            <div className={styles['placeholder']} data-part="placeholder">
              <div className={styles['placeholderIcon']} data-part="placeholderIcon" />
              <div className={styles['placeholderText']} data-part="placeholderText">
                {SAID.select}
              </div>
            </div>
          ) : (
            <Message
              key={openId}
              id={openId}
              maySend={maySend}
              onBack={() => setOpenId(null)}
              onReply={m =>
                setDraft({
                  to: addressOf(m.from),
                  subject: replySubjectOf(m.subject),
                  threadId: m.threadId ?? '',
                  inReplyTo: m.messageId,
                })
              }
              // (Forward is a new email to whoever sent this one: the classic page does no more)
              onForward={m => setDraft({ ...BLANK, to: addressOf(m.from) })}
            />
          )}
        </div>
      </div>
      {draft && <Compose draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}

/** A line of the inbox: the sender and the day, the subject, a snippet; bold and with a dot where the message is unread. */
function Row({ m, onOpen }: { m: MailSummary; onOpen: () => void }) {
  return (
    <div
      className={cx(styles['row'], m.unread && styles['unread'])}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      data-part="inboxRow"
    >
      {m.unread ? (
        <div className={styles['dot']} data-part="unreadDot" />
      ) : (
        <div className={styles['dotSpace']} />
      )}
      <div className={styles['rowBody']}>
        <div className={styles['rowTop']}>
          <span className={styles['from']} data-part="rowFrom">
            {senderOf(m.from)}
          </span>
          <span className={styles['date']} data-part="rowDate">
            {listDateOf(m.date, 'admin')}
          </span>
        </div>
        <div className={styles['subject']} data-part="rowSubject">
          {m.subject || SAID.noSubject}
        </div>
        <div className={styles['snippet']} data-part="rowSnippet">
          {m.snippet}
        </div>
      </div>
    </div>
  );
}

/** The message that is open: who wrote it, to whom and when, what it says, and the two things to do about it. */
function Message({
  id,
  maySend,
  onBack,
  onReply,
  onForward,
}: {
  id: string;
  maySend: boolean;
  onBack: () => void;
  onReply: (m: MailMessage) => void;
  onForward: (m: MailMessage) => void;
}) {
  const { loading, message, error } = useMessage(id);
  if (loading) return <Loading part="detailLoading" text="" pad={40} />;
  if (!message) {
    return (
      <div className={styles['paneError']} role="alert" data-part="detailError">
        {error ?? SAID.unreadable}
      </div>
    );
  }
  return (
    <div className={styles['message']} data-part="message">
      <div className={styles['messageHead']} data-part="messageHead">
        <Btn className={styles['back']} data-part="back" onClick={onBack}>
          {SAID.back}
        </Btn>
        <div className={styles['messageSubject']} data-part="messageSubject">
          {message.subject || SAID.noSubject}
        </div>
        <div className={styles['messageMeta']} data-part="messageMeta">
          <div className={styles['who']} data-part="messageWho">
            <div className={cx(styles['line'], styles['lineGap'])} data-part="messageFrom">
              {SAID.from} <span>{message.from}</span>
            </div>
            {message.to ? (
              <div className={styles['line']} data-part="messageTo">
                {SAID.to} <span>{message.to}</span>
              </div>
            ) : null}
            <div className={styles['when']} data-part="messageDate">
              {detailDateOf(message.date, 'admin')}
            </div>
          </div>
          {maySend && (
            <div className={styles['answers']} data-part="answers">
              <Btn
                kind="primary"
                className={styles['answer']}
                data-part="reply"
                onClick={() => onReply(message)}
              >
                {SAID.reply}
              </Btn>
              <Btn
                className={styles['answer']}
                data-part="forward"
                onClick={() => onForward(message)}
              >
                {SAID.forward}
              </Btn>
            </div>
          )}
        </div>
      </div>
      <div
        className={cx(styles['messageBody'], message.isHtml && styles['messageBodyHtml'])}
        data-part="messageBody"
      >
        {message.isHtml ? (
          <Frame html={message.body} className={styles['adminFrame']} fit />
        ) : (
          <pre className={styles['adminText']} data-part="bodyText">
            {message.body || SAID.empty}
          </pre>
        )}
      </div>
    </div>
  );
}

/** The sheet for a new email or a reply. It stays until the email has gone; a refusal is told in a message and the words are kept. */
function Compose({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { toasts } = useSession();
  const send = useSend();
  const id = useId();
  const [to, setTo] = useState(draft.to);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const fields = { to: to.trim(), subject: subject.trim(), body: body.trim() };
    if (!fields.to || !fields.subject || !fields.body) {
      toasts.show(SAID.required);
      return;
    }
    setSending(true);
    const said = await send(
      sendBodyOf(fields, { threadId: draft.threadId, messageId: draft.inReplyTo }),
    );
    if (!said.ok) {
      setSending(false);
      toasts.show(SAID.failedAdmin + said.message);
      return;
    }
    onClose();
    toasts.show(SAID.sentAdmin);
  };

  return (
    <Sheet
      title={draft.threadId ? SAID.replyTitle : SAID.newEmail}
      onClose={onClose}
      footer={
        <>
          <Btn data-part="cancel" onClick={onClose}>
            {SAID.cancel}
          </Btn>
          <Btn kind="primary" data-part="send" disabled={sending} onClick={() => void submit()}>
            {sending ? SAID.sending : SAID.send}
          </Btn>
        </>
      }
    >
      <FormGroup part="toGroup">
        <FormLabel htmlFor={id + 'to'}>{SAID.labelTo}</FormLabel>
        <Control
          id={id + 'to'}
          part="to"
          value={to}
          placeholder={SAID.placeholderTo}
          onChange={e => setTo(e.target.value)}
        />
      </FormGroup>
      <FormGroup part="subjectGroup">
        <FormLabel htmlFor={id + 'subject'}>{SAID.labelSubject}</FormLabel>
        <Control
          id={id + 'subject'}
          part="subject"
          value={subject}
          placeholder={SAID.placeholderSubject}
          onChange={e => setSubject(e.target.value)}
        />
      </FormGroup>
      <FormGroup part="bodyGroup">
        <FormLabel htmlFor={id + 'body'}>{SAID.labelMessage}</FormLabel>
        <TextControl
          id={id + 'body'}
          part="composeBody"
          rows={8}
          value={body}
          placeholder={SAID.placeholderMessage}
          onChange={e => setBody(e.target.value)}
        />
      </FormGroup>
    </Sheet>
  );
}
