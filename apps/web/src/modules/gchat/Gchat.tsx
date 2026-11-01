import { can } from '@motolinker/contracts/access';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Loading } from '../../google';
import { chatReturn, clearChatReturn } from '../../lib/chat-return';
import { Btn } from '../../ui';
import { Placeholder, StateCard } from './Cards';
import { Conversation } from './Conversation';
import { useChatLink, useRefresh, useSpaces } from './data';
import styles from './gchat.module.css';
import { CHAT_ICONS, SAID } from './model';
import { NoSpaces, SpaceRows } from './Spaces';

/**
 * Google Chat: the same page in both portals' own looks. A list of spaces beside the one that is open; where there is nothing to list,
 * a card in the middle of the page that says why and what to do about it. Every visit reads it all again, as the classic pages do.
 */
export function Gchat() {
  const { access } = useSession();
  const link = useChatLink();
  const refresh = useRefresh();
  const [open, setOpen] = useState<{ name: string; title: string } | null>(null);
  // Sent back from Google's consent screen with the reason it would not link: shown once, in place of everything else
  const [notice, setNotice] = useState<string | null>(chatReturn);
  useEffect(() => {
    clearChatReturn();
  }, []);

  const linked = link.link?.state === 'linked' ? link.link : null;
  const spaces = useSpaces(linked !== null && !notice);
  const mayPost = can(access.actor, 'gchat.send');
  const connect = () => void link.connect();

  let list: ReactNode = null;
  let main: ReactNode;
  // (a card in the main pane is the whole of the page on a phone, which shows one pane at a time)
  let card = true;
  if (notice) {
    main = (
      <StateCard
        icon={CHAT_ICONS.returned}
        title={SAID.returnTitle}
        button={{ label: SAID.tryAgain, onClick: connect }}
      >
        {notice}
      </StateCard>
    );
  } else if (link.loading) {
    list = <Loading text="" part="listLoading" />;
    main = <Placeholder />;
    card = false;
  } else if (link.forbidden) {
    main = (
      <StateCard icon={CHAT_ICONS.noAccess} title={SAID.title}>
        {SAID.noAccess}
      </StateCard>
    );
  } else if (!link.link) {
    main = (
      <StateCard icon={CHAT_ICONS.unavailable} title={SAID.unavailableTitle}>
        {link.error ?? SAID.unreadable}
      </StateCard>
    );
  } else if (link.link.state === 'unconfigured') {
    main = (
      <StateCard icon={CHAT_ICONS.unconfigured} title={SAID.unconfiguredTitle}>
        {SAID.unconfiguredBefore}
        <code>{SAID.unconfiguredEnv}</code>
        {SAID.unconfiguredAfter}
      </StateCard>
    );
  } else if (link.link.state === 'lost') {
    main = (
      <StateCard
        icon={CHAT_ICONS.lost}
        title={SAID.lostTitle}
        button={{ label: SAID.reconnect, onClick: connect }}
      >
        {SAID.lostBody}
      </StateCard>
    );
  } else if (link.link.state === 'unlinked') {
    main = (
      <StateCard
        icon={CHAT_ICONS.unlinked}
        title={SAID.unlinkedTitle}
        button={{ label: SAID.connect, onClick: connect }}
      >
        {SAID.unlinkedBody}
      </StateCard>
    );
  } else {
    const found = spaces.result;
    const conversation =
      open && linked ? (
        <Conversation
          key={open.name}
          name={open.name}
          title={open.title}
          link={linked}
          mayPost={mayPost}
          onReconnect={connect}
          onBack={() => setOpen(null)}
        />
      ) : (
        <Placeholder />
      );
    if (spaces.loading || !found) {
      list = <Loading text="" part="listLoading" />;
      main = conversation;
      card = open !== null;
    } else if (!found.ok) {
      main = (
        <StateCard
          icon={CHAT_ICONS.unavailable}
          title={SAID.unavailableTitle}
          {...(found.reason === 'reconnect'
            ? { button: { label: SAID.reconnect, onClick: connect } }
            : {})}
        >
          {found.reason === 'forbidden'
            ? SAID.forbidden
            : found.reason === 'reconnect'
              ? SAID.expired
              : SAID.unreachable}
        </StateCard>
      );
    } else if (!found.spaces.length) {
      list = <NoSpaces />;
      main = <Placeholder />;
      card = false;
    } else {
      list = (
        <SpaceRows
          spaces={found.spaces}
          open={open?.name ?? null}
          onOpen={space => setOpen({ name: space.name, title: space.title })}
        />
      );
      main = conversation;
      card = open !== null;
    }
  }

  return (
    <div className={styles['page']} data-part="gchatPage" data-flush>
      <div className={styles['layout']} data-part="chatLayout" data-pane={card ? 'main' : 'list'}>
        <div className={styles['rooms']} data-part="chatRooms">
          <div className={styles['roomsHeader']} data-part="chatRoomsHeader">
            <span className={styles['roomsTitle']} data-part="chatRoomsTitle">
              {SAID.title}
            </span>
            <Btn
              small
              className={styles['refresh']}
              data-part="chatRefresh"
              title={SAID.refresh}
              onClick={() => {
                setNotice(null);
                refresh(linked !== null);
              }}
            >
              <Icon name={CHAT_ICONS.refresh} size={13} />
            </Btn>
          </div>
          <div className={styles['roomList']} data-part="chatRoomList">
            {list}
          </div>
        </div>
        <div className={styles['main']} data-part="chatMain">
          {main}
        </div>
      </div>
    </div>
  );
}
