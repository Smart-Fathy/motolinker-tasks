// What is on the screen, read from the page the way a person would describe it: the tab that is selected, the search box with
// something in it, the filters that are not at "everything", the rows that are ticked. (The record that is open is not read from here:
// the screen that shows it says so, see state.tsx.) The classic panel reads the same from its own pages by their class names; the
// screens that have moved say what they are in words a screen reader hears too, so that is what is read.
import type { ScreenSnapshot } from './model';

const squash = (s: string | null | undefined, max: number): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Is it on the screen, as far as the page can tell? (A browser says; where one cannot, a hidden ancestor does.) */
function shown(el: Element): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return !el.closest('[hidden], [aria-hidden="true"]');
}

/** Document order, whichever order the page's engine lists a union of selectors in. */
const inOrder = (a: Element, b: Element): number =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

const SEARCH = 'input[type="search"], input[id*="search" i], input[placeholder*="search" i]';
const NOTHING = /^(all|any|none|)$/i;

export function readScreen(
  root: ParentNode | null,
  section: string,
): Pick<ScreenSnapshot, 'tab' | 'search' | 'filters' | 'selected'> {
  const out: Pick<ScreenSnapshot, 'tab' | 'search' | 'filters' | 'selected'> = {};
  if (!root) return out;

  // The tab that is selected, whatever the screen calls its tabs.
  const tab = [...root.querySelectorAll('[role="tab"][aria-selected="true"]')]
    .sort(inOrder)
    .find(shown);
  if (tab) out.tab = squash(tab.textContent, 40);

  // The first search box with words in it.
  const search = [...root.querySelectorAll<HTMLInputElement>(SEARCH)]
    .sort(inOrder)
    .find(el => shown(el) && el.value.trim() !== '');
  if (search) out.search = squash(search.value, 80);

  // Selects and dates that are not at their "everything" default (a select in a dialog is not a filter of the page).
  const filters: Record<string, string> = {};
  for (const sel of root.querySelectorAll<HTMLSelectElement>('select')) {
    if (!shown(sel) || sel.closest('[role="dialog"]')) continue;
    const value = (sel.value || '').trim();
    if (NOTHING.test(value)) continue;
    const key = (sel.id || sel.name || sel.getAttribute('aria-label') || 'filter').replace(
      /^(f-|lr-|rep-|emp-rep-)/,
      '',
    );
    const option = sel.options[sel.selectedIndex];
    filters[key] = squash(option ? option.textContent : value, 40);
    if (Object.keys(filters).length >= 8) break;
  }
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="date"]')) {
    if (shown(input) && input.value) {
      filters[(input.id || 'date').replace(/^(lead-|emp-lead-|rep-|emp-rep-)/, '')] = input.value;
    }
  }
  if (Object.keys(filters).length) out.filters = filters;

  // The rows that are ticked.
  const kind =
    section === 'leads'
      ? 'lead'
      : section === 'deals'
        ? 'deal'
        : section === 'tasks'
          ? 'task'
          : 'row';
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('tr')]
    .filter(tr => tr.getAttribute('data-id') && tr.querySelector('input[type="checkbox"]:checked'))
    .slice(0, 10);
  if (rows.length) {
    out.selected = rows.map(tr => ({
      kind,
      id: tr.getAttribute('data-id') ?? '',
      title: squash((tr.querySelector('td') ?? tr).textContent, 60),
    }));
  }
  return out;
}
