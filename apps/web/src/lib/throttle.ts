/** A function that does its work at most once in `ms`: calls that come sooner than that are dropped, not queued. */
export function throttle(fn: () => void, ms: number, now: () => number = Date.now): () => void {
  let last: number | null = null;
  return () => {
    const t = now();
    if (last !== null && t - last < ms) return;
    last = t;
    fn();
  };
}
