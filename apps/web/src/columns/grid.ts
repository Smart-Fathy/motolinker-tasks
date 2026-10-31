// The look of a table of lines, for the screens that draw one beside the engine's own grid (a supplier's purchases): the
// classic sheet's .po-th, .po-td and the row's rule, as each portal has them.
import styles from './columns.module.css';

export const GRID_HEAD = styles['gridHead'] ?? '';
export const GRID_CELL = styles['gridCell'] ?? '';
export const GRID_ROW = styles['gridRow'] ?? '';
