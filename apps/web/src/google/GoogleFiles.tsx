import { can } from '@motolinker/contracts/access';
import { useState, type ReactNode } from 'react';
import { useSession } from '../app/context';
import { useDriveFiles, useDriveLink } from './data';
import {
  Account,
  Card,
  Failure,
  Listing,
  Loading,
  PageBody,
  ReconnectNotice,
  Viewer,
} from './Pieces';
import styles from './google.module.css';
import { SAID, type DriveFile, type Kind } from './model';

/**
 * What My Drive and My Sheets are: the same page twice, over a different list. It asks whose Google account is linked, and shows
 * what that answer calls for — a loader, a card that says there is no Google project here, a card with the way to link an
 * account, or the account and its files with a way to look inside one. Every visit reads it all again, as the classic pages do.
 */
export function GoogleFiles({ kind }: { kind: Kind }) {
  const { portal, toasts, access } = useSession();
  // (linking an account and letting go of it are a grant of their own: the classic team page offered both to everyone, and a member
  // without it was sent to Google and back to an error)
  const mayConnect = can(access.actor, 'drive.connect');
  const state = useDriveLink();
  const linked = state.link?.state === 'linked' ? state.link : null;
  const list = useDriveFiles(kind, linked !== null);
  const [viewing, setViewing] = useState<DriveFile | null>(null);
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
    body = <Loading />;
  } else if (state.forbidden) {
    // (the team's status needs the Drive grant, and Sheets can be granted without it: there is nothing to show of the account)
    body = <Card kind={kind} admin={{ sub: SAID.noAccess }} team={{ sub: SAID.noAccess }} />;
  } else if (!state.link) {
    body = <Failure message={state.error ?? SAID.unreadable} />;
  } else if (state.link.state === 'unconfigured') {
    body = (
      <Card
        kind={kind}
        admin={{ title: SAID.adminUnconfiguredTitle, sub: SAID.adminUnconfigured }}
        team={{ sub: SAID.teamUnconfigured }}
      />
    );
  } else if (state.link.state === 'unlinked') {
    body = (
      <Card
        kind={kind}
        admin={{ sub: SAID.adminUnlinked }}
        team={{ sub: mayConnect ? SAID.teamUnlinked : SAID.teamUnlinkedLocked }}
        {...(mayConnect ? { button: { label: SAID.connect, onClick: connect } } : {})}
      />
    );
  } else if (list.loading) {
    body = <Loading />;
  } else {
    const link = state.link;
    const inside = (
      <>
        <Account
          link={link}
          busy={busy}
          {...(mayConnect ? { onDisconnect: () => void letGo() } : {})}
        />
        {/* (only the admin's page ever told a link made before uploads were asked for that it needed making again) */}
        {portal === 'admin' && !link.canUpload && (
          <ReconnectNotice
            before={SAID.reconnectBefore}
            after={SAID.reconnectAfter}
            onReconnect={connect}
          />
        )}
        {list.error ? (
          <Failure message={list.error} />
        ) : (
          <Listing kind={kind} files={list.files} onView={setViewing} />
        )}
      </>
    );
    body =
      portal === 'admin' ? (
        <div className={styles['adminBody']} data-part="pageBody">
          {inside}
        </div>
      ) : (
        inside
      );
  }

  return (
    <PageBody>
      {body}
      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} />}
    </PageBody>
  );
}
