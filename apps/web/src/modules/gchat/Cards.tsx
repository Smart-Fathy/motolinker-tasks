import type { ReactNode } from 'react';
import { Icon } from '../../app/shell/icons';
import { Btn } from '../../ui';
import styles from './gchat.module.css';
import { CHAT_ICONS, SAID } from './model';

/**
 * What stands in the main pane — or in the pane of messages — where there is nothing to show: a picture, a title, a few words and
 * the way out of it, where there is one. Every state the screen can be in without a conversation is one of these.
 */
export function StateCard({
  icon,
  title,
  children,
  button,
}: {
  icon: string;
  title: string;
  children: ReactNode;
  button?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`${styles['empty']} ${styles['card']}`} data-part="stateCard">
      <Icon name={icon} size={40} className={styles['cardIcon']} />
      <div className={styles['cardTitle']} data-part="stateTitle">
        {title}
      </div>
      <div className={styles['cardBody']} data-part="stateBody">
        {children}
      </div>
      {button && (
        <Btn
          kind="primary"
          small
          className={styles['cardBtn']}
          data-part="stateBtn"
          onClick={button.onClick}
        >
          {button.label}
        </Btn>
      )}
    </div>
  );
}

/** What the main pane says until a space is chosen. */
export function Placeholder() {
  return (
    <div className={styles['empty']} data-part="placeholder">
      <Icon name={CHAT_ICONS.placeholder} size={44} className={styles['placeholderIcon']} />
      <div>{SAID.select}</div>
    </div>
  );
}
