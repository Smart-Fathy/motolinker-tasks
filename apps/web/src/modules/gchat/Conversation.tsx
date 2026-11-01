import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Loading } from '../../google';
import { StateCard } from './Cards';
import { useMessages, useSend } from './data';
import styles from './gchat.module.css';
import {
  CHAT_ICONS,
  isMine,
  lastIdOf,
  placeholderOf,
  reasonWords,
  SAID,
  timeOf,
  type ChatCaps,
} from './model';

/** How near the foot of the messages a reader is to count as being at it, in pixels. */
const AT_FOOT = 80;

/**
 * One space, opened: its name, its messages (asked for again every twenty seconds while the page is in view) and the box a message is
 * written in. What the link reaches decides what is shown — no reading, a card that says so; no sending, a line that says so — and so
 * does the person's own right to send.
 */
export function Conversation({
  name,
  title,
  link,
  mayPost,
  onReconnect,
  onBack,
}: {
  /** the space's address, and what to call it */
  name: string;
  title: string;
  link: { email: string; name: string; caps: ChatCaps };
  /** the person holds the right to send (the administrator's always does; a team member's is a grant of its own) */
  mayPost: boolean;
  onReconnect: () => void;
  /** to the list of spaces (on a phone, which shows one pane at a time) */
  onBack: () => void;
}) {
  const { toasts } = useSession();
  const { caps } = link;
  const messages = useMessages(name, caps.read);
  const send = useSend();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const atFoot = useRef(true);
  const result = messages.result;
  const lastId = result?.ok ? lastIdOf(result.messages) : '';

  // The foot of the conversation stays in view while the reader is at it — when it opens, and when something new comes (a new last
  // message; while the messages are on their way there is none, so a list that comes again is a new one). The classic pages took the
  // reader to the foot every twenty seconds, wherever they had scrolled to.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atFoot.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const submit = async () => {
    const words = text.trim();
    if (!words || sending) return;
    setSending(true);
    const said = await send(name, words);
    setSending(false);
    // (the box is emptied only once Chat has taken the message)
    if (!said.ok) {
      toasts.show(SAID.sendFailed + said.message);
      return;
    }
    setText('');
    atFoot.current = true;
    messages.again();
  };

  let body: ReactNode;
  if (!caps.read) {
    body = (
      <StateCard
        icon={CHAT_ICONS.history}
        title={SAID.historyTitle}
        button={{ label: SAID.grantRead, onClick: onReconnect }}
      >
        {SAID.historyBody}
      </StateCard>
    );
  } else if (messages.loading || !result) {
    body = <Loading text="" part="messagesLoading" />;
  } else if (!result.ok) {
    body = (
      <StateCard
        icon={CHAT_ICONS.failed}
        title={SAID.messagesFailed}
        {...(result.reason === 'reconnect'
          ? { button: { label: SAID.reconnect, onClick: onReconnect } }
          : {})}
      >
        {result.detail || reasonWords(result.reason)}
      </StateCard>
    );
  } else if (!result.messages.length) {
    body = (
      <div className={`${styles['empty']} ${styles['quiet']}`} data-part="noMessages">
        <div>{SAID.noMessages}</div>
      </div>
    );
  } else {
    body = result.messages.map(m => {
      const mine = isMine(m, link);
      return (
        <div
          key={m.id}
          className={`${styles['msg']} ${mine ? styles['mine'] : styles['theirs']}`}
          data-part="msg"
        >
          {!mine && (
            <div className={styles['sender']} data-part="msgSender">
              {m.senderName || SAID.unknown}
            </div>
          )}
          <div className={styles['bubble']} data-part="msgBubble">
            {m.text}
          </div>
          <div className={styles['time']} data-part="msgTime">
            {timeOf(m.createTime)}
          </div>
        </div>
      );
    });
  }

  return (
    <>
      <div className={styles['header']} data-part="chatHeader">
        <button
          type="button"
          className={styles['back']}
          data-part="chatBack"
          aria-label={SAID.back}
          onClick={onBack}
        >
          <Icon name={CHAT_ICONS.back} size={13} />
        </button>
        <div className={styles['name']} data-part="chatName">
          {title}
        </div>
      </div>
      <div
        ref={box}
        className={styles['messages']}
        data-part="chatMessages"
        onScroll={() => {
          const el = box.current;
          if (el) atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_FOOT;
        }}
      >
        {body}
      </div>
      {caps.send && mayPost ? (
        <div className={styles['composer']} data-part="chatComposer">
          <textarea
            className={styles['input']}
            data-part="chatInput"
            rows={1}
            placeholder={placeholderOf(title)}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              // (Enter sends, Shift+Enter breaks the line; an Enter that finishes a word being composed is not a send)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button
            type="button"
            className={styles['send']}
            data-part="sendBtn"
            title={SAID.send}
            aria-label={SAID.send}
            disabled={sending}
            onClick={() => void submit()}
          >
            <Icon name={CHAT_ICONS.send} size={15} />
          </button>
        </div>
      ) : (
        <div className={`${styles['composer']} ${styles['readOnly']}`} data-part="chatComposer">
          {mayPost ? (
            <>
              {SAID.readOnly}{' '}
              <a
                href="#"
                role="button"
                className={styles['reconnect']}
                data-part="readOnlyLink"
                onClick={e => {
                  e.preventDefault();
                  onReconnect();
                }}
              >
                {SAID.reconnect}
              </a>
            </>
          ) : (
            SAID.readOnlyAdmin
          )}
        </div>
      )}
    </>
  );
}
