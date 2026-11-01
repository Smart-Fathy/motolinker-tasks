import { legacyIdOf, screenOf } from '@motolinker/contracts/modules';
import { useState } from 'react';
import { useSession } from '../app/context';
import { cx } from '../ui/cx';
import styles from './assistant.module.css';
import { Brain } from './Brain';
import { useInsights } from './data';
import {
  cardAllowed,
  isAr,
  KEYS,
  labelOf,
  modelName,
  SAID,
  sectionFor,
  type AiCallListEntry,
} from './model';
import { useAssistant, type AssistantValue } from './state';

function readCollapsed(page: string): boolean {
  try {
    return window.localStorage.getItem(KEYS.card(page)) === 'closed';
  } catch {
    return false;
  }
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <h4>{title}</h4>
      {items.length ? (
        <ul className={cx(items.some(isAr) && styles['rtl'])}>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <div className={styles['empty']} data-part="aiEmpty">
          {SAID.nothing}
        </div>
      )}
    </div>
  );
}

function CallList({ calls }: { calls: readonly AiCallListEntry[] }) {
  return (
    <div className={styles['calls']} data-part="aiCalls">
      <h4 className={styles['callsHead']}>{SAID.callFirst}</h4>
      {calls.map((c, i) => (
        <div key={i} className={styles['call']} data-part="aiCall">
          <b>
            {i + 1}. {c.name || '#' + c.customer_id}
          </b>
          <span>{c.why}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The card at the top of a section's page: what the assistant sees in it — highlights, risks, suggestions, and who to call first where
 * the section has a call list. Put away, it asks for nothing; the choice is remembered (under the classic portals' own key, which
 * is the classic portal's name for the page: Leads is "customers" in the administrator's). `screen` is the screen the card is on.
 */
export function InsightCard({ screen }: { screen: string }) {
  const { portal } = useSession();
  const found = screenOf(screen);
  const page = found ? legacyIdOf(found, portal) : screen;
  const assistant = useAssistant();
  // (the card asks the server for nothing unless it is going to be shown)
  if (!assistant?.available || page === 'accounting' || !cardAllowed(assistant.known, page))
    return null;
  return <Card page={page} assistant={assistant} />;
}

function Card({ page, assistant }: { page: string; assistant: AssistantValue }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(page));
  const lang = assistant.lang !== 'auto' ? assistant.lang : undefined;
  const insights = useInsights(page, lang, !collapsed);
  const section = sectionFor(assistant.known, page);
  const label = labelOf(assistant.known, section);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(KEYS.card(page), next ? 'closed' : 'open');
    } catch {
      /* private mode */
    }
  };

  const d = insights.result;
  let status = '';
  let body: React.ReactNode;
  // (Refresh puts the words back to "Reading this section…" until the new card comes, as the classic card does)
  if (insights.loading) {
    body = (
      <div className={styles['empty']} data-part="aiEmpty">
        {SAID.cardReading}
      </div>
    );
  } else if (insights.failed) {
    body = (
      <div className={styles['empty']} data-part="aiEmpty">
        {insights.failed}
      </div>
    );
  } else if (d && !d.ai) {
    status = SAID.cardOffStatus;
    body = (
      <div className={styles['empty']} data-part="aiEmpty">
        {SAID.cardOff}
      </div>
    );
  } else if (d && !d.ok) {
    status = 'status' in d && d.status === 429 ? SAID.cardBusyStatus : '';
    const words =
      ('busy' in d && d.busy) ||
      ('error' in d && d.error) ||
      ('note' in d && d.note) ||
      SAID.cardBusy;
    body = (
      <div className={styles['empty']} data-part="aiEmpty">
        {words}
      </div>
    );
  } else if (d) {
    status =
      (d.cached ? 'cached · ' : '') +
      modelName(d.model) +
      ' · ' +
      String(d.generated_at || '').slice(11, 16);
    const calls = d.extra.call_list ?? [];
    body = (
      <>
        <div className={styles['cols']} data-part="aiCols">
          <List title={SAID.highlights} items={d.insights.highlights} />
          <List title={SAID.risks} items={d.insights.risks} />
          <List title={SAID.suggestions} items={d.insights.suggestions} />
        </div>
        {calls.length > 0 && <CallList calls={calls} />}
      </>
    );
  }

  return (
    <div
      className={cx(styles['card'], collapsed && styles['collapsed'])}
      data-part="aiCard"
      data-section={section}
    >
      <div className={styles['cardHead']} data-part="aiCardHead">
        <Brain />
        <b>{SAID.cardTitle(label)}</b>
        <span className={styles['cardStatus']} data-part="aiCardStatus">
          {status}
        </span>
        <button
          type="button"
          className={styles['mini']}
          data-part="aiCardRefresh"
          onClick={insights.refresh}
        >
          {SAID.refresh}
        </button>
        <button
          type="button"
          className={cx(styles['mini'], styles['miniAsk'])}
          data-part="aiCardAsk"
          onClick={assistant.openPanel}
        >
          <Brain /> {SAID.cardAsk}
        </button>
        <button type="button" className={styles['mini']} data-part="aiCardToggle" onClick={toggle}>
          {collapsed ? SAID.show : SAID.hide}
        </button>
      </div>
      <div className={styles['cardBody']} data-part="aiCardBody">
        {body}
      </div>
    </div>
  );
}
