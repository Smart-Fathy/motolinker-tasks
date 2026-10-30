// The server's live stream (notifications, the workspace's look, huddle signalling), read with fetch rather than
// EventSource: a header carries the session (the classic portals put it in the address, where logs and history keep it),
// and what happens when the stream is refused or drops is decided here instead of by the browser.
//
// What it promises:
//  - a refusal about the session itself (401/403) ends the stream and says so; nothing else does. A server that is down,
//    restarting or unreachable is waited for, with a growing pause, and never signs anyone out.
//  - a stream that goes quiet is replaced: the server speaks every 25 seconds (a comment, if nothing else), so a long
//    silence is a connection some proxy dropped without saying.
//  - the last event id seen travels with the next attempt (Last-Event-ID), as the server's huddle replay expects.

export interface StreamMessage {
  event: string;
  data: string;
  id: string | undefined;
}

export interface ParsedChunk {
  messages: StreamMessage[];
  /** something arrived, even if it was only a comment: the connection is alive */
  alive: boolean;
  /** the server asked for this pause (ms) before the next attempt */
  retry: number | undefined;
}

/** Reads the text/event-stream format a chunk at a time, however the network cut it. */
export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private lastId: string | undefined;
  private started = false;

  push(chunk: string): ParsedChunk {
    const out: ParsedChunk = { messages: [], alive: chunk.length > 0, retry: undefined };
    let text = this.buffer + chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        this.line(text.slice(start, i), out);
        start = i + 1;
      } else if (c === '\r') {
        // a "\r" that ends the chunk may be the first half of "\r\n": wait for the next chunk to say
        if (i === text.length - 1) break;
        this.line(text.slice(start, i), out);
        if (text[i + 1] === '\n') i++;
        start = i + 1;
      }
    }
    this.buffer = text.slice(start);
    return out;
  }

  private line(line: string, out: ParsedChunk): void {
    if (line === '') {
      if (this.data.length) {
        out.messages.push({
          event: this.event || 'message',
          data: this.data.join('\n'),
          id: this.lastId,
        });
      }
      this.data = [];
      this.event = '';
      return;
    }
    if (line.startsWith(':')) return;
    const at = line.indexOf(':');
    const field = at === -1 ? line : line.slice(0, at);
    let value = at === -1 ? '' : line.slice(at + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id') {
      if (!value.includes('\0')) this.lastId = value;
    } else if (field === 'retry' && /^\d+$/.test(value)) out.retry = Number(value);
  }

  /** the id of the last event the server numbered, to ask for what came after it */
  get lastEventId(): string | undefined {
    return this.lastId;
  }
}

export type StreamStatus = 'connecting' | 'open' | 'waiting' | 'unauthorized' | 'closed';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

export interface StreamOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timers?: Timers;
  /** the first pause after a failure (the server's own `retry:` replaces it); doubles up to maxDelayMs */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** longer than this without a byte, and the connection is replaced */
  idleMs?: number;
}

export interface Stream {
  readonly status: StreamStatus;
  /** open the connection (and again after close); a stream made with createStream does nothing until this */
  start(): void;
  /** hear every event of this name; returns the way to stop */
  on(event: string, fn: (data: string, message: StreamMessage) => void): () => void;
  /** hear when the status changes */
  onStatus(fn: (status: StreamStatus) => void): () => void;
  /** do not wait out a pause (the network came back, the tab came forward) */
  reconnectNow(): void;
  close(): void;
}

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: () => Math.random(),
};

export function createStream({
  url,
  token,
  fetchImpl,
  timers = REAL_TIMERS,
  baseDelayMs = 1000,
  maxDelayMs = 30_000,
  idleMs = 70_000,
}: StreamOptions): Stream {
  const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const listeners = new Map<string, Set<(data: string, message: StreamMessage) => void>>();
  const statusListeners = new Set<(s: StreamStatus) => void>();
  const parser = new SseParser();
  let status: StreamStatus = 'connecting';
  let closed = true; // until start()
  let refused = false;
  let running = false;
  let generation = 0;
  let attempt = 0;
  let serverRetry: number | undefined;
  let current: AbortController | null = null;
  let wake: (() => void) | null = null;

  const setStatus = (s: StreamStatus) => {
    if (status === s) return;
    status = s;
    for (const fn of [...statusListeners]) fn(s);
  };

  const pause = (ms: number) =>
    new Promise<void>(resolve => {
      const handle = timers.setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        timers.clearTimeout(handle);
        wake = null;
        resolve();
      };
    });

  const delay = () => {
    const base = serverRetry ?? baseDelayMs;
    const grown = Math.min(maxDelayMs, base * 2 ** Math.min(attempt, 10));
    return Math.round(grown * (0.8 + timers.random() * 0.4));
  };

  const deliver = (m: StreamMessage) => {
    for (const fn of [...(listeners.get(m.event) ?? [])]) {
      try {
        fn(m.data, m);
      } catch {
        /* one listener's trouble is not another's */
      }
    }
  };

  async function once(gen: number): Promise<'again' | 'stop'> {
    const over = () => closed || gen !== generation;
    const ctl = new AbortController();
    current = ctl;
    let idle: unknown = null;
    const arm = () => {
      if (idle !== null) timers.clearTimeout(idle);
      idle = timers.setTimeout(() => ctl.abort(), idleMs);
    };
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      };
      if (parser.lastEventId !== undefined) headers['Last-Event-ID'] = parser.lastEventId;
      arm();
      const res = await doFetch(url, { headers, signal: ctl.signal, cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        refused = true;
        setStatus('unauthorized');
        return 'stop';
      }
      if (!res.ok || !res.body) return 'again';
      setStatus('open');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return 'again';
        arm();
        attempt = 0;
        const parsed = parser.push(decoder.decode(value, { stream: true }));
        if (parsed.retry !== undefined) serverRetry = parsed.retry;
        for (const m of parsed.messages) deliver(m);
      }
    } catch {
      return over() ? 'stop' : 'again';
    } finally {
      if (idle !== null) timers.clearTimeout(idle);
      current = null;
    }
  }

  async function loop(gen: number): Promise<void> {
    while (!closed && gen === generation) {
      setStatus('connecting');
      const next = await once(gen);
      if (closed || gen !== generation || next === 'stop') break;
      setStatus('waiting');
      const ms = delay();
      attempt++;
      await pause(ms);
    }
  }

  return {
    get status() {
      return status;
    },
    start() {
      if (running) return;
      running = true;
      closed = false;
      refused = false;
      attempt = 0;
      const gen = ++generation;
      void loop(gen).finally(() => {
        if (gen === generation) running = false;
      });
    },
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => {
        statusListeners.delete(fn);
      };
    },
    reconnectNow() {
      attempt = 0;
      wake?.();
    },
    close() {
      closed = true;
      running = false;
      generation++;
      current?.abort();
      wake?.();
      if (!refused) setStatus('closed');
    },
  };
}

/** A stream that is already running. */
export function openStream(options: StreamOptions): Stream {
  const stream = createStream(options);
  stream.start();
  return stream;
}
