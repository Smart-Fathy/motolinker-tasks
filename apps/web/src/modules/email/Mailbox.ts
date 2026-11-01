import type { MailLink } from './model';

/** What each portal's inbox is given by the page that decided there is one to show. */
export interface MailboxProps {
  link: Extract<MailLink, { state: 'linked' }>;
  /** letting go of the account is being asked of the server */
  busy: boolean;
  /** the person may send (Compose, Reply and Forward are theirs to use) */
  maySend: boolean;
  /** the way to let go of the account, for those who may link one */
  onDisconnect?: (() => void) | undefined;
  /** the way to make the link again, for those who may link one (a link that cannot send tells its owner to) */
  onReconnect?: (() => void) | undefined;
}
