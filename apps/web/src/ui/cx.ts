/** Class names from the ones that are set: cx(styles.a, on && styles.b). */
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');
