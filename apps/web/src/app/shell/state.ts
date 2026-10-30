import { useEffect, useState } from 'react';
import type { Portal } from '../../lib/env';

// What the rail remembers between visits, under the keys the classic portals use — a person who collapses the rail in one
// is collapsed in the other.
const KEYS = {
  admin: { sidebar: 'ml_admin_sidebar', groups: 'ml_admin_navgroups', page: 'ml_page' },
  team: { sidebar: 'ml_emp_sidebar', groups: 'ml_emp_navgroups', page: 'ml_emp_page' },
} as const;

export const pageKey = (portal: Portal): string => KEYS[portal].page;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const read = (key: string): string | null => {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    store()?.setItem(key, value);
  } catch {
    /* private mode: it holds for this visit */
  }
};

/** The groups the person left open (null: they never chose, and only the section of the page they are on is open). */
function savedGroups(portal: Portal): string[] | null {
  try {
    const saved: unknown = JSON.parse(read(KEYS[portal].groups) ?? 'null');
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export interface ShellState {
  /** the phone's drawer */
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  /** the desktop rail narrowed to its icons */
  collapsed: boolean;
  toggleCollapsed: () => void;
  isGroupOpen: (group: string) => boolean;
  toggleGroup: (group: string) => void;
}

/**
 * The rail's own state. A section opens when you move to a page in it, and stays as you leave it; what you open and close
 * is what comes back next time.
 */
export function useShellState(
  portal: Portal,
  activeGroup: string | null,
  { openAll = false }: { openAll?: boolean } = {},
): ShellState {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => read(KEYS[portal].sidebar) === 'collapsed');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const saved = savedGroups(portal);
    return new Set(saved ?? (activeGroup ? [activeGroup] : []));
  });
  // Moving to a page opens its section (adjusting state while rendering, as React asks for a value that follows a prop).
  const [seen, setSeen] = useState(activeGroup);
  if (activeGroup !== seen) {
    setSeen(activeGroup);
    if (activeGroup && !open.has(activeGroup)) setOpen(new Set([...open, activeGroup]));
  }

  // The page behind the drawer does not scroll while it is open.
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawer]);

  return {
    drawer,
    setDrawer,
    collapsed,
    toggleCollapsed: () => {
      const next = !collapsed;
      setCollapsed(next);
      write(KEYS[portal].sidebar, next ? 'collapsed' : 'expanded');
    },
    isGroupOpen: group => openAll || open.has(group),
    toggleGroup: group => {
      if (openAll) return;
      const next = new Set(open);
      if (!next.delete(group)) next.add(group);
      setOpen(next);
      write(KEYS[portal].groups, JSON.stringify([...next]));
    },
  };
}
