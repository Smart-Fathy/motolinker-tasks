import { useNavigate } from 'react-router';
import { cx } from '../../ui/cx';
import { useAppTo } from '../context';
import type { RailItem } from '../nav';
import { preloadScreen } from '../registry';
import { Icon, Menu } from './icons';
import styles from './shell.module.css';
import type { ShellState } from './state';

/** On a phone: the few places most people go, and "More" for the rest (the rail, as a drawer). */
export function BottomNav({
  items,
  active,
  state,
}: {
  items: RailItem[];
  active: string | null;
  state: ShellState;
}) {
  const to = useAppTo();
  const navigate = useNavigate();
  return (
    <nav className={styles['bottomNav']} data-part="bottomNav" aria-label="Quick links">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className={cx(styles['bottomItem'], active === item.id && styles['bottomActive'])}
          data-part={active === item.id ? 'bottomActive' : 'bottomItem'}
          aria-current={active === item.id ? 'page' : undefined}
          onPointerDown={() => preloadScreen(item.id)}
          onFocus={() => preloadScreen(item.id)}
          onClick={() => void navigate(to('/' + item.id))}
        >
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
          <div className={styles['bottomDot']} />
        </button>
      ))}
      <button
        type="button"
        className={styles['bottomItem']}
        data-part="bottomMore"
        aria-expanded={state.drawer}
        onClick={() => state.setDrawer(!state.drawer)}
      >
        <Menu size={20} aria-hidden="true" />
        <span>More</span>
        <div className={styles['bottomDot']} />
      </button>
    </nav>
  );
}
