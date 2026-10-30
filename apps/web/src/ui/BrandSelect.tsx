import { Check } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './BrandSelect.module.css';
import { cx } from './cx';

export interface SelectOption {
  value: string;
  label: string;
  /** shown, but cannot be chosen */
  disabled?: boolean;
}

interface Props {
  /** the id a label points at */
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  'aria-label'?: string;
  /** named for a test or a style that needs to find it */
  part?: string;
}

/** A list longer than this gets a search box (the classic dropdown's own rule: the leads list is long). */
const SEARCH_ABOVE = 8;

/**
 * The classic portals' dropdown: a button that shows the choice, and a floating panel of options in the page's own colours
 * where a native select would pop its operating system's menu. It replaces <select> in every form of both portals (they swap
 * each one at runtime), so it is one piece here. It is placed under its button, or above it when there is no room, kept inside
 * the part of the screen that can be seen, and closed by Escape (which closes only it, not the dialog it may be in), by a click
 * elsewhere, by choosing, and by the page getting narrower or wider.
 */
export function BrandSelect({ id, value, options, onChange, part, ...rest }: Props) {
  const own = useId();
  const triggerId = id ?? own;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const byKeyboard = useRef(false);
  const showSearch = options.length > SEARCH_ABOVE;
  const chosen = options.find(o => o.value === value);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }, []);

  // Anchored under the trigger, clamped into the part of the screen you can actually see — visualViewport, when the browser
  // reports one, is the area left over above a phone's keyboard.
  const place = useCallback(() => {
    const t = trigger.current;
    const m = menu.current;
    if (!t || !m) return;
    const vv = window.visualViewport;
    const vTop = vv ? vv.offsetTop : 0;
    const vH = vv ? vv.height : window.innerHeight;
    const vW = vv ? vv.width : window.innerWidth;
    const r = t.getBoundingClientRect();
    m.style.minWidth = Math.max(r.width, 150) + 'px';
    const mh = Math.min(m.scrollHeight, 280);
    const below = vTop + vH - r.bottom;
    const above = r.top - vTop;
    m.style.left = Math.max(8, Math.min(r.left, vW - m.offsetWidth - 8)) + 'px';
    const top = below > mh + 12 || below > above ? r.bottom + 6 : r.top - mh - 6;
    m.style.top = Math.max(vTop + 8, Math.min(top, vTop + vH - mh - 8)) + 'px';
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const chosenOption = menu.current?.querySelector<HTMLElement>('[aria-selected=true]');
    chosenOption?.scrollIntoView?.({ block: 'nearest' });
    if (byKeyboard.current) {
      byKeyboard.current = false;
      (
        chosenOption ??
        menu.current?.querySelector<HTMLElement>('[role=option]:not([aria-disabled=true])')
      )?.focus();
    }
  }, [open, place, query]);

  useEffect(() => {
    if (!open) return;
    let lastWidth = window.innerWidth;
    const onClick = (e: MouseEvent) => {
      const at = e.target as Node;
      if (!menu.current?.contains(at) && !trigger.current?.contains(at)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // (this is the menu's: a dialog around it stays open)
        e.stopPropagation();
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab' && menu.current?.contains(e.target as Node)) {
        e.preventDefault();
        close(true);
      }
    };
    // A resize closes the menu when the WIDTH changed (a rotation, a real resize) and only moves it when the height did (a phone's
    // keyboard is a resize, and closing the menu closed the keyboard with it).
    const onViewport = () => {
      if (window.innerWidth !== lastWidth) {
        lastWidth = window.innerWidth;
        close();
      } else place();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('scroll', onViewport);
    // Only where there is a pointer. On a touch device, stealing focus raises the keyboard over the very list the search is
    // meant to narrow — the box is there to tap when someone wants it.
    const focusSearch =
      showSearch && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
        ? window.setTimeout(
            () => menu.current?.querySelector<HTMLInputElement>('input')?.focus(),
            20,
          )
        : 0;
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('scroll', onViewport);
      window.clearTimeout(focusSearch);
    };
  }, [open, close, place, showSearch]);

  const choose = (o: SelectOption) => {
    if (o.disabled) return;
    close(true);
    if (o.value !== value) onChange(o.value);
  };
  const shown = options.filter(
    o => !query.trim() || o.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        byKeyboard.current = true;
        setOpen(true);
      }
    }
  };
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role=option]:not([aria-disabled=true])') ??
        []),
    ];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : at < 0
            ? 0
            : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[to]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className={cx(styles['trigger'], open && styles['open'])}
        data-part={part}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={rest['aria-label']}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKey}
      >
        <span className={styles['label']}>{chosen ? chosen.label : ' '}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className={styles['menu']}
            role="listbox"
            aria-labelledby={triggerId}
            data-part="selectMenu"
            onKeyDown={onMenuKey}
          >
            {showSearch && (
              <div className={styles['searchWrap']}>
                <input
                  className={styles['search']}
                  type="text"
                  placeholder="Search…"
                  aria-label="Search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const first = shown.find(o => !o.disabled);
                      if (first) choose(first);
                    }
                  }}
                />
              </div>
            )}
            <div>
              {options.map(o => {
                const selected = o.value === value;
                const hidden = !shown.includes(o);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={o.disabled || undefined}
                    className={cx(styles['opt'], selected && styles['selected'])}
                    style={hidden ? { display: 'none' } : undefined}
                    onClick={() => choose(o)}
                  >
                    <span className={styles['check']}>
                      {selected ? <Check size={12} aria-hidden="true" /> : null}
                    </span>
                    <span className={styles['optText']}>{o.label || '—'}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles['empty']} style={{ display: shown.length ? 'none' : 'block' }}>
              No matches
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
