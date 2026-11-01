import styles from './assistant.module.css';
import { Brain } from './Brain';
import { SAID } from './model';
import { preloadPanel } from './Layer';
import { useAssistant } from './state';

const mac = () => /Mac|iPhone|iPad/.test(navigator.platform || '');

/** "Ask AI" in the top bar, for those who may ask: it opens and closes the panel, as Ctrl/⌘+K does. */
export function AssistantPill() {
  const assistant = useAssistant();
  if (!assistant?.available) return null;
  const apple = mac();
  return (
    <button
      type="button"
      className={styles['pill']}
      data-part="aiPill"
      aria-label={SAID.askLabel}
      aria-expanded={assistant.open}
      title={`${apple ? '⌘K' : 'Ctrl+K'} · Ask the assistant · المساعد`}
      onPointerEnter={preloadPanel}
      onFocus={preloadPanel}
      onClick={assistant.toggle}
    >
      <Brain />
      <span className={styles['pillLabel']} data-part="aiPillLabel">
        {SAID.ask}
      </span>
      <kbd className={styles['kbd']} data-part="aiPillKbd">
        {apple ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
