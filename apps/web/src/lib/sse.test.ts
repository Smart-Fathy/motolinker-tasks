import { describe, expect, it, vi } from 'vitest';
import { createStream, openStream, SseParser, type StreamStatus, type Timers } from './sse';

describe('SseParser', () => {
  it('reads events, named or not, and joins the lines of one event', () => {
    const p = new SseParser();
    const r = p.push('event: workspace\ndata: {"a":1}\n\ndata: one\ndata: two\n\n');
    expect(r.messages).toEqual([
      { event: 'workspace', data: '{"a":1}', id: undefined },
      { event: 'message', data: 'one\ntwo', id: undefined },
    ]);
  });

  it('puts an event together however the network cut it, even in the middle of a word or of "\\r\\n"', () => {
    const p = new SseParser();
    const parts = ['even', 't: notif', 'ication\r', '\ndata: {"x"', ':1}\r', '\n\r', '\n'];
    const out = parts.flatMap(c => p.push(c).messages);
    expect(out).toEqual([{ event: 'notification', data: '{"x":1}', id: undefined }]);
  });

  it('reads all three line endings (a final "\\r" waits for the next byte to say whether it is half of "\\r\\n")', () => {
    const p = new SseParser();
    expect(p.push('data: a\n\ndata: b\r\n\r\ndata: c\r\r').messages.map(m => m.data)).toEqual([
      'a',
      'b',
    ]);
    expect(p.push('data: d\n\n').messages.map(m => m.data)).toEqual(['c', 'd']);
  });

  it('counts a comment as the connection being alive, and delivers nothing for it', () => {
    const p = new SseParser();
    const r = p.push(':ping\n\n');
    expect(r.alive).toBe(true);
    expect(r.messages).toEqual([]);
    expect(p.push('').alive).toBe(false);
  });

  it('does not deliver an event that has no data, and forgets its name', () => {
    const p = new SseParser();
    expect(p.push('event: ghost\n\n').messages).toEqual([]);
    expect(p.push('data: hi\n\n').messages).toEqual([
      { event: 'message', data: 'hi', id: undefined },
    ]);
  });

  it('keeps the last id and hands it to every later event, and to whoever asks', () => {
    const p = new SseParser();
    const r = p.push('id: 7.1\nevent: huddle-signal\ndata: x\n\ndata: y\n\n');
    expect(r.messages.map(m => m.id)).toEqual(['7.1', '7.1']);
    expect(p.lastEventId).toBe('7.1');
    p.push('id: bad\0id\ndata: z\n\n');
    expect(p.lastEventId).toBe('7.1');
  });

  it('reads the pause the server asks for, and only when it is a number', () => {
    const p = new SseParser();
    expect(p.push('retry: 1000\n:ok\n\n').retry).toBe(1000);
    expect(p.push('retry: soon\n\n').retry).toBeUndefined();
  });

  it('takes one space off a value, no more, and treats a field without a colon as an empty value', () => {
    const p = new SseParser();
    expect(p.push('data:  two spaces\n\ndata\n\n').messages.map(m => m.data)).toEqual([
      ' two spaces',
      '',
    ]);
  });

  it('skips a byte-order mark at the very start', () => {
    const p = new SseParser();
    expect(p.push('﻿data: ok\n\n').messages.map(m => m.data)).toEqual(['ok']);
  });
});

// ── the stream, with a clock and a network the test owns ───────────────────────────────────────
function clock() {
  let now = 0;
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const timers: Timers = {
    setTimeout(fn, ms) {
      const id = ++ids;
      queue.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(h) {
      const i = queue.findIndex(q => q.id === h);
      if (i >= 0) queue.splice(i, 1);
    },
    random: () => 0.5, // jitter factor exactly 1
  };
  return {
    timers,
    pending: () => queue.map(q => q.at - now).sort((a, b) => a - b),
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > end) break;
        queue.shift();
        now = next.at;
        next.fn();
        await settle();
      }
      now = end;
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** a response's body, so that cancelling the request that asked for it ends it, as a real connection does */
const BODIES = new WeakMap<Response, ReadableStreamDefaultController<Uint8Array>>();

/** a response whose body the test writes to */
function body(status = 200) {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const res = new Response(status === 200 ? stream : null, { status });
  BODIES.set(res, ctl);
  return {
    res,
    write: (s: string) => ctl.enqueue(enc.encode(s)),
    end: () => ctl.close(),
  };
}

function harness(
  responses: (() => Response | Promise<Response>)[],
  opts: Partial<Parameters<typeof openStream>[0]> = {},
) {
  const calls: { url: string; headers: Record<string, string>; signal: AbortSignal | undefined }[] =
    [];
  const c = clock();
  let n = 0;
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal ?? undefined,
    });
    const make = responses[Math.min(n++, responses.length - 1)];
    if (!make) throw new TypeError('no response set up');
    const res = await make();
    const ctl = BODIES.get(res);
    init?.signal?.addEventListener('abort', () => {
      try {
        ctl?.error(new DOMException('aborted', 'AbortError'));
      } catch {
        /* already closed */
      }
    });
    return res;
  }) as unknown as typeof fetch;
  const stream = openStream({ url: '/s', token: 'tok', fetchImpl, timers: c.timers, ...opts });
  const statuses: StreamStatus[] = [];
  stream.onStatus(s => statuses.push(s));
  return { stream, calls, statuses, clock: c, fetchImpl };
}

describe('openStream', () => {
  it('asks as the person, hears the events it was told to listen for, and stops listening when told', async () => {
    const b = body();
    const h = harness([() => b.res]);
    const heard: string[] = [];
    const off = h.stream.on('workspace', d => heard.push('w:' + d));
    h.stream.on('notification', d => heard.push('n:' + d));
    await settle();
    expect(h.calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'text/event-stream',
    });
    expect(h.stream.status).toBe('open');
    b.write(
      'retry: 1000\n:ok\n\nevent: workspace\ndata: 1\n\nevent: notification\ndata: 2\n\nevent: other\ndata: 3\n\n',
    );
    await settle();
    off();
    b.write('event: workspace\ndata: 4\n\n');
    await settle();
    expect(heard).toEqual(['w:1', 'n:2']);
    h.stream.close();
  });

  it("does not let one listener's failure keep the next from hearing", async () => {
    const b = body();
    const h = harness([() => b.res]);
    const heard: string[] = [];
    h.stream.on('x', () => {
      throw new Error('boom');
    });
    h.stream.on('x', d => heard.push(d));
    await settle();
    b.write('event: x\ndata: ok\n\n');
    await settle();
    expect(heard).toEqual(['ok']);
    h.stream.close();
  });

  it('is refused for good when the session is refused: 401 and 403 end it, and say so', async () => {
    for (const status of [401, 403]) {
      const h = harness([() => new Response(null, { status })]);
      await settle();
      expect(h.stream.status).toBe('unauthorized');
      await h.clock.advance(120_000);
      expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('waits and tries again when the server is down, longer each time, and never calls it unauthorized', async () => {
    const h = harness([() => new Response(null, { status: 503 })]);
    await settle();
    expect(h.stream.status).toBe('waiting');
    expect(h.clock.pending()).toEqual(expect.arrayContaining([1000]));
    await h.clock.advance(1000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    expect(h.clock.pending()).toEqual(expect.arrayContaining([2000]));
    await h.clock.advance(2000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(3);
    expect(h.clock.pending()).toEqual(expect.arrayContaining([4000]));
    expect(h.statuses).not.toContain('unauthorized');
    h.stream.close();
  });

  it('never waits longer than the longest pause it was given', async () => {
    const h = harness([() => new Response(null, { status: 500 })], { maxDelayMs: 5000 });
    await settle();
    for (let i = 0; i < 8; i++) await h.clock.advance(5000);
    expect(Math.max(...h.clock.pending())).toBeLessThanOrEqual(5000);
    h.stream.close();
  });

  it('treats a network that is not there like a server that is down', async () => {
    const h = harness([() => Promise.reject(new TypeError('Failed to fetch')), () => body().res]);
    await settle();
    expect(h.stream.status).toBe('waiting');
    await h.clock.advance(1000);
    expect(h.stream.status).toBe('open');
    h.stream.close();
  });

  it('comes back when the server closes the stream, and starts the pauses again from the shortest', async () => {
    const first = body();
    const h = harness([() => first.res, () => new Response(null, { status: 500 })]);
    await settle();
    first.write(':ok\n\n');
    await settle();
    first.end();
    await settle();
    expect(h.stream.status).toBe('waiting');
    expect(h.clock.pending()).toEqual(expect.arrayContaining([1000]));
    h.stream.close();
  });

  it('uses the pause the server asked for', async () => {
    const first = body();
    const h = harness([() => first.res, () => new Response(null, { status: 500 })]);
    await settle();
    first.write('retry: 250\n\n');
    await settle();
    first.end();
    await settle();
    expect(h.clock.pending()).toEqual(expect.arrayContaining([250]));
    h.stream.close();
  });

  it('tells the server the last event it saw, so what it missed can be sent again', async () => {
    const first = body();
    const h = harness([() => first.res, () => body().res]);
    await settle();
    first.write('id: 3.9\nevent: huddle-signal\ndata: x\n\n');
    await settle();
    first.end();
    await settle();
    await h.clock.advance(1000);
    expect(h.calls[1]?.headers['Last-Event-ID']).toBe('3.9');
    expect(h.calls[0]?.headers['Last-Event-ID']).toBeUndefined();
    h.stream.close();
  });

  it('replaces a connection that has gone silent for longer than the server ever is', async () => {
    const first = body();
    const second = body();
    const h = harness([() => first.res, () => second.res], { idleMs: 70_000 });
    await settle();
    first.write(':ok\n\n');
    await settle();
    await h.clock.advance(69_000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    first.write(':ping\n\n');
    await settle();
    await h.clock.advance(69_000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1); // a ping keeps it
    await h.clock.advance(2_000);
    expect(h.calls[0]?.signal?.aborted).toBe(true);
    await h.clock.advance(1000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    h.stream.close();
  });

  it('does not wait out a pause when asked not to (the network came back)', async () => {
    const h = harness([() => new Response(null, { status: 500 }), () => body().res]);
    await settle();
    expect(h.stream.status).toBe('waiting');
    h.stream.reconnectNow();
    await settle();
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    expect(h.stream.status).toBe('open');
    h.stream.close();
  });

  it('stops for good when closed: the connection is dropped, and nothing more is asked', async () => {
    const b = body();
    const h = harness([() => b.res]);
    await settle();
    h.stream.close();
    await settle();
    expect(h.calls[0]?.signal?.aborted).toBe(true);
    expect(h.stream.status).toBe('closed');
    await h.clock.advance(120_000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops for good when closed while it is waiting', async () => {
    const h = harness([() => new Response(null, { status: 500 })]);
    await settle();
    h.stream.close();
    await h.clock.advance(120_000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.stream.status).toBe('closed');
  });

  it('does nothing until it is started, and can be started again after it is closed', async () => {
    const c = clock();
    const fetchImpl = vi.fn(async () => body().res) as unknown as typeof fetch;
    const s = createStream({ url: '/s', token: 'tok', fetchImpl, timers: c.timers });
    await settle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.status).toBe('connecting');
    s.start();
    s.start(); // (a second start while running is the first)
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    s.close();
    await settle();
    expect(s.status).toBe('closed');
    s.start();
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(s.status).toBe('open');
    s.close();
  });

  it('stays refused after a refusal: a stream the server said no to is not asked again by itself', async () => {
    const h = harness([() => new Response(null, { status: 401 })]);
    await settle();
    h.stream.close();
    expect(h.stream.status).toBe('unauthorized');
  });

  it('says what state it is in as it goes', async () => {
    const b = body();
    const h = harness([() => b.res]);
    await settle();
    h.stream.close();
    await settle();
    expect(h.statuses).toEqual(['open', 'closed']);
  });
});
