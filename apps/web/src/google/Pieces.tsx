// The pieces My Drive and My Sheets are drawn from, each portal's own: the classic pages are two different markups of one idea (a
// card that says there is nothing to browse yet, a line that says whose account it is, a table of files), so they are two here
// too, chosen by the portal, and held to the classic pages' computed style by tests/gdparity.js.
import { screenOf } from '@motolinker/contracts/modules';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../app/context';
import { Icon } from '../app/shell/icons';
import { Btn, BtnLink } from '../ui';
import { cx } from '../ui/cx';
import { useDialog } from '../ui/useDialog';
import { FileGlyph } from './FileGlyph';
import styles from './google.module.css';
import {
  countOf,
  embedUrl,
  iconOf,
  initialOf,
  modifiedOf,
  SAID,
  TITLES,
  viewLinkOf,
  type DriveFile,
  type Kind,
  type Link,
} from './model';

/** The picture of a screen in the team's page (the catalogue's own icon for it); the admin's page writes the word instead. */
const iconName = (kind: Kind): string => screenOf(kind)?.icon ?? 'hard-drive';
const ADMIN_WORD: Readonly<Record<Kind, string>> = { drive: 'Drive', sheets: 'Sheets' };

/** "Loading…": a block with the spinner above the words in the admin's page, a line in the team's. */
export function Loading() {
  const { portal } = useSession();
  return (
    <div className={styles['loading']} data-part="loading">
      {portal === 'team' ? (
        <span className={styles['spinner']} data-part="spinner" />
      ) : (
        <div className={styles['spinner']} data-part="spinner" />
      )}{' '}
      {SAID.loading}
    </div>
  );
}

/**
 * What stands where there is nothing to browse yet: no Google project here, no account linked, or no right to see which. The
 * admin's is a card in the middle of the page with the word "Drive" or "Sheets" for a picture; the team's is a line of text with
 * the screen's own icon above it.
 */
export function Card({
  kind,
  admin,
  team,
  button,
}: {
  kind: Kind;
  /** the title and the line under it, in the admin's page (the title is the screen's, where none is given) */
  admin: { title?: string; sub: string };
  team: { sub: string };
  /** the way out of it, where there is one */
  button?: { label: string; onClick: () => void };
}) {
  const { portal } = useSession();
  const act = button && (
    <Btn
      kind="primary"
      className={styles['connectBtn']}
      data-part="connectBtn"
      onClick={button.onClick}
    >
      {button.label}
    </Btn>
  );
  if (portal === 'admin') {
    return (
      <div className={styles['connectCard']} data-part="connectCard">
        <div className={styles['connectIcon']} data-part="connectIcon">
          {ADMIN_WORD[kind]}
        </div>
        <div className={styles['connectTitle']} data-part="connectTitle">
          {admin.title ?? TITLES[kind]}
        </div>
        <div className={styles['connectSub']} data-part="connectSub">
          {admin.sub}
        </div>
        {act}
      </div>
    );
  }
  return (
    <div className={styles['centre']} data-part="connectCard">
      <div className={styles['centreIcon']} data-part="connectIcon">
        <Icon name={iconName(kind)} size={20} />
      </div>
      <div className={styles['centreTitle']} data-part="connectTitle">
        {TITLES[kind]}
      </div>
      <div
        className={cx(styles['centreSub'], button && styles['centreSubGap'])}
        data-part="connectSub"
      >
        {team.sub}
      </div>
      {act}
    </div>
  );
}

/** Whose account it is, and the way to let go of it. */
export function Account({
  link,
  busy,
  onDisconnect,
}: {
  link: Extract<Link, { state: 'linked' }>;
  busy: boolean;
  /** the way to let go of it, for those who may */
  onDisconnect?: () => void;
}) {
  return (
    <div className={styles['account']} data-part="account">
      <div className={styles['who']} data-part="who">
        <div className={styles['avatar']} data-part="accountAvatar">
          {initialOf(link.name)}
        </div>
        <div>
          <div className={styles['name']} data-part="accountName">
            {link.name}
          </div>
          <div className={styles['email']} data-part="accountEmail">
            {link.email}
          </div>
        </div>
      </div>
      {onDisconnect && (
        <Btn
          className={styles['disconnect']}
          data-part="disconnect"
          disabled={busy}
          onClick={onDisconnect}
        >
          {SAID.disconnect}
        </Btn>
      )}
    </div>
  );
}

/** The admin's page tells a link made before uploads were asked for that it needs making again (the team's never did). */
export function ReconnectNotice({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className={styles['notice']} data-part="reconnectNotice">
      {SAID.reconnectBefore}
      <a
        href="#"
        role="button"
        className={styles['noticeLink']}
        data-part="reconnect"
        onClick={e => {
          e.preventDefault();
          onReconnect();
        }}
      >
        {SAID.reconnect}
      </a>
      {SAID.reconnectAfter}
    </div>
  );
}

/** Why the files could not be had, in the words the server gave (Google's own where it said some). */
export function Failure({ message }: { message: string }) {
  const { portal } = useSession();
  return (
    <div
      className={portal === 'team' ? styles['teamError'] : styles['errorMsg']}
      role="alert"
      data-part="error"
    >
      {message}
    </div>
  );
}

/** The files: a table with a card round it, the admin's and the team's each their own. */
export function Listing({
  kind,
  files,
  onView,
}: {
  kind: Kind;
  files: DriveFile[];
  onView: (f: DriveFile) => void;
}) {
  const { portal } = useSession();
  const team = portal === 'team';
  // (the phone's labels on the cells are the team's: mobile.js writes them from the head of a table in a scroller)
  const label = (text: string) => (team ? { 'data-label': text } : {});
  const rows = files.map(f => {
    const open = viewLinkOf(f);
    return (
      <tr key={f.id} className={styles['row']} data-part="fileRow">
        <td className={styles['cellName']} data-part="cellName" {...label('Name')}>
          <FileGlyph icon={iconOf(f.mimeType, portal)} /> {f.name}
        </td>
        <td className={styles['cellDate']} data-part="cellDate" {...label('Modified')}>
          {modifiedOf(f)}
        </td>
        <td className={styles['cellActions']} data-part="cellActions" {...label('')}>
          <Btn
            kind="primary"
            {...(team ? {} : { small: true })}
            className={styles['view']}
            data-part="view"
            onClick={() => onView(f)}
          >
            {SAID.view}
          </Btn>{' '}
          {open && (
            <BtnLink
              {...(team ? {} : { small: true })}
              className={styles['open']}
              data-part="open"
              href={open}
              target="_blank"
              rel="noopener"
            >
              {SAID.open}
            </BtnLink>
          )}
        </td>
      </tr>
    );
  });
  const table = (
    <table className={styles['table']} data-part="table">
      <thead>
        <tr>
          <th className={styles['th']}>Name</th>
          <th className={styles['th']}>Modified</th>
          <th className={cx(styles['th'], styles['thBlank'])} />
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
  const count = (
    <span className={styles['count']} data-part="fileCount">
      {countOf(files.length)}
    </span>
  );
  if (!team) {
    return (
      <div className={styles['tableCard']} data-part="tableCard">
        <div className={styles['tableHeader']} data-part="tableHeader">
          <span className={styles['tableTitle']} data-part="tableTitle">
            {ADMIN_WORD[kind]} {TITLES[kind]}
          </span>
          {count}
        </div>
        {table}
      </div>
    );
  }
  return (
    <div className={styles['teamCard']} data-part="tableCard">
      <div className={styles['teamHead']} data-part="tableHeader">
        <span className={styles['teamTitle']} data-part="tableTitle">
          <Icon name={iconName(kind)} size={20} /> {TITLES[kind]}
        </span>
        {count}
      </div>
      {files.length ? (
        <div className={styles['tableScroll']} data-part="tableScroll">
          {table}
        </div>
      ) : (
        <div className={styles['none']} data-part="empty">
          {SAID.noFiles}
        </div>
      )}
    </div>
  );
}

/** A file, in Google's own preview of it, over the whole page; Escape or the × puts it away. */
export function Viewer({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const box = useDialog(onClose);
  const out = viewLinkOf(file);
  return createPortal(
    <div
      ref={box}
      className={styles['viewer']}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      tabIndex={-1}
      data-part="viewer"
    >
      <div className={styles['viewerBar']} data-part="viewerBar">
        <span className={styles['viewerTitle']} data-part="viewerTitle">
          {file.name}
        </span>
        <BtnLink
          small
          className={styles['viewerOpen']}
          data-part="viewerOpen"
          href={out || '#'}
          target="_blank"
          rel="noopener"
        >
          {SAID.openInGoogle}
        </BtnLink>
        <button
          type="button"
          className={styles['viewerClose']}
          data-part="viewerClose"
          aria-label="Close"
          onClick={onClose}
        >
          {SAID.close}
        </button>
      </div>
      <iframe
        className={styles['viewerFrame']}
        src={embedUrl(file)}
        title={file.name}
        allowFullScreen
        data-part="viewerFrame"
      />
    </div>,
    document.body,
  );
}

/** The page of one of the two screens, round whatever it is showing. */
export function PageBody({ children }: { children: ReactNode }) {
  const { portal } = useSession();
  return (
    <div className={portal === 'team' ? styles['teamPage'] : undefined} data-part="googlePage">
      {children}
    </div>
  );
}
