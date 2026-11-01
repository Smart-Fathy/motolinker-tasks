import { can } from '@motolinker/contracts/access';
import { useState, type ReactNode } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { ConnectCard, Failure, Loading } from '../../google';
import { AdminMailbox } from './AdminMailbox';
import { useMailLink } from './data';
import styles from './email.module.css';
import { SAID } from './model';
import { TeamMailbox } from './TeamMailbox';

/** The picture above the team's lines of text: the mail icon, as large as the classic page draws it. */
const mailIcon = <Icon name="mail" size={40} className={styles['mailIcon']} />;

/**
 * My Email: the same page in both portals' own looks. It asks whose Gmail is linked, and shows what that answer calls for — a loader,
 * a card that says there is no Google project here, a card with the way to link an account, or the inbox. Every visit reads it all
 * again, as the classic pages do.
 */
export function Email() {
  const { portal, toasts, access } = useSession();
  // (linking an account and letting go of it, and sending, are grants of their own: the classic team page offered all of it to
  // everyone, and a member without a grant met a raw error at the end)
  const mayConnect = can(access.actor, 'email.connect');
  const maySend = can(access.actor, 'email.send');
  const state = useMailLink();
  const [busy, setBusy] = useState(false);

  const letGo = async () => {
    setBusy(true);
    const said = await state.disconnect();
    setBusy(false);
    if (!said.ok) toasts.show(said.message);
  };
  const connect = () => void state.connect();

  let body: ReactNode;
  if (state.loading) {
    body = <Loading text={portal === 'admin' ? SAID.checking : SAID.loadingTeam} />;
  } else if (state.forbidden) {
    // (the member has the screen without the right to see whose mail it is: there is nothing to show of the account)
    body = (
      <ConnectCard
        admin={{ word: '', title: SAID.title, sub: SAID.noAccess }}
        team={{ icon: mailIcon, title: SAID.title, sub: SAID.noAccess }}
      />
    );
  } else if (!state.link) {
    body = <Failure message={state.error ?? SAID.unreadable} />;
  } else if (state.link.state === 'unconfigured') {
    body = (
      <ConnectCard
        admin={{
          word: '',
          title: SAID.adminUnconfiguredTitle,
          sub: SAID.adminUnconfigured,
          extra: (
            <pre className={styles['env']} data-part="env">
              {SAID.adminEnv}
            </pre>
          ),
        }}
        team={{ icon: mailIcon, title: SAID.teamUnconfiguredTitle, sub: SAID.teamUnconfigured }}
      />
    );
  } else if (state.link.state === 'unlinked') {
    body = (
      <ConnectCard
        admin={{ word: '', title: SAID.unlinkedTitle, sub: SAID.adminUnlinked }}
        team={{
          icon: mailIcon,
          title: SAID.unlinkedTitle,
          sub: mayConnect ? SAID.teamUnlinked : SAID.teamUnlinkedLocked,
        }}
        {...(mayConnect
          ? {
              button: {
                label: SAID.connect,
                onClick: connect,
                // (the team's button has the mail icon in it; the administrator's is the words alone)
                ...(portal === 'team' ? { icon: <Icon name="mail" size={15} /> } : {}),
              },
            }
          : {})}
      />
    );
  } else {
    const props = {
      link: state.link,
      busy,
      maySend,
      onDisconnect: mayConnect ? () => void letGo() : undefined,
      onReconnect: mayConnect ? connect : undefined,
    };
    body = portal === 'admin' ? <AdminMailbox {...props} /> : <TeamMailbox {...props} />;
  }

  return portal === 'admin' ? (
    <div className={styles['adminPage']} data-part="emailPage">
      <div className={styles['adminContent']} data-part="emailContent">
        {body}
      </div>
    </div>
  ) : (
    <div className={styles['teamPage']} data-part="emailPage">
      {body}
    </div>
  );
}
