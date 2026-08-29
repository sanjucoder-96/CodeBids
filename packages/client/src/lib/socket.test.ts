/**
 * Socket resilience (spec section 36): reconnect, sequence-gap detection,
 * request/response correlation and clock-skew correction.
 *
 * Uses a fake WebSocket so the behaviour is deterministic and offline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSocket } from './socket.js';
import type { Envelope } from '@code-market/shared';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;

  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Test helper: simulate the server pushing a frame. */
  receive(frame: Envelope): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  parsed(): Envelope[] {
    return this.sent.map((s) => JSON.parse(s) as Envelope);
  }
}

function makeSocket() {
  const frames: Envelope[] = [];
  const states: string[] = [];
  const gaps: [number, number][] = [];
  const authErrors: string[] = [];

  const socket = new GameSocket({
    token: 'tok',
    role: 'participant',
    url: 'ws://test/ws',
    onFrame: (f) => frames.push(f),
    onState: (s) => states.push(s),
    onGap: (expected, got) => gaps.push([expected, got]),
    onUnauthorized: (message) => authErrors.push(message),
  });

  return { socket, frames, states, gaps, authErrors };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const snapshotFrame = (seq: number): Envelope => ({
  t: 'SNAPSHOT',
  d: { seq, serverNow: Date.now() },
  seq,
  ts: Date.now(),
});

describe('handshake', () => {
  it('sends HELLO with the token as the first frame', () => {
    const { socket } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    const first = raw.parsed()[0];
    expect(first?.t).toBe('HELLO');
    expect((first?.d as { token: string }).token).toBe('tok');
    expect((first?.d as { role: string }).role).toBe('participant');
  });

  it('reports open only once the snapshot lands', () => {
    const { socket, states } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();
    expect(states).not.toContain('open');

    raw.receive(snapshotFrame(1));
    expect(states).toContain('open');
  });
});

describe('sequence gap detection (spec 36)', () => {
  it('accepts consecutive sequence numbers silently', () => {
    const { socket, gaps } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();
    raw.receive(snapshotFrame(10));
    raw.receive({ t: 'AUCTION_BID', d: {}, seq: 11, ts: Date.now() });
    raw.receive({ t: 'AUCTION_BID', d: {}, seq: 12, ts: Date.now() });
    expect(gaps).toHaveLength(0);
  });

  it('detects a gap and asks the server to resync rather than guessing', () => {
    const { socket, gaps } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();
    raw.receive(snapshotFrame(10));
    raw.sent.length = 0;

    raw.receive({ t: 'AUCTION_BID', d: {}, seq: 15, ts: Date.now() });

    expect(gaps).toEqual([[11, 15]]);
    expect(raw.parsed().some((f) => f.t === 'REQUEST_CURRENT_STATE')).toBe(true);
  });

  it('ignores an out-of-order duplicate without spamming resyncs', () => {
    const { socket, gaps } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();
    raw.receive(snapshotFrame(10));
    raw.receive({ t: 'X', d: {}, seq: 11, ts: Date.now() });
    raw.receive({ t: 'X', d: {}, seq: 11, ts: Date.now() });
    expect(gaps).toHaveLength(0);
  });
});

describe('reconnection', () => {
  it('reconnects automatically after an unexpected close', () => {
    const { socket, states } = makeSocket();
    socket.connect();
    const first = FakeSocket.instances[0] as FakeSocket;
    first.onopen?.();
    first.receive(snapshotFrame(1));

    first.onclose?.();
    expect(states).toContain('reconnecting');

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it('backs off progressively rather than hammering the server', () => {
    const { socket } = makeSocket();
    socket.connect();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const raw = FakeSocket.instances.at(-1) as FakeSocket;
      raw.onclose?.();
      vi.advanceTimersByTime(60_000);
    }
    // Each close produced exactly one new connection attempt.
    expect(FakeSocket.instances.length).toBe(4);
  });

  it('does not reconnect after an intentional close', () => {
    const { socket, states } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    socket.close();
    vi.advanceTimersByTime(30_000);

    expect(FakeSocket.instances.length).toBe(1);
    expect(states.at(-1)).toBe('closed');
  });

  it('re-sends HELLO on every reconnect so the server re-authenticates', () => {
    const { socket } = makeSocket();
    socket.connect();
    (FakeSocket.instances[0] as FakeSocket).onclose?.();
    vi.advanceTimersByTime(500);

    const second = FakeSocket.instances[1] as FakeSocket;
    second.onopen?.();
    expect(second.parsed()[0]?.t).toBe('HELLO');
  });
});

describe('request / response correlation', () => {
  it('resolves a call when the matching ACK arrives', async () => {
    const { socket } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    const promise = socket.call('SUBMIT_ANSWER', { challengeId: 'C01' });
    const sent = raw.parsed().find((f) => f.t === 'SUBMIT_ANSWER');
    expect(sent?.rid).toBeTruthy();

    raw.receive({ t: 'ACK', d: { ok: true, data: { result: 'correct' } }, rid: sent?.rid, ts: Date.now() });
    const frame = await promise;
    expect((frame.d as { data: { result: string } }).data.result).toBe('correct');
  });

  it('rejects with the server message when an ERROR answers the call', async () => {
    const { socket } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    const promise = socket.call('UNLOCK_CHALLENGE', {});
    const rid = raw.parsed().find((f) => f.t === 'UNLOCK_CHALLENGE')?.rid;
    raw.receive({ t: 'ERROR', d: { code: 'bad_key', message: 'Incorrect challenge key' }, rid, ts: Date.now() });

    await expect(promise).rejects.toThrow('Incorrect challenge key');
  });

  it('rejects pending calls when the connection drops', async () => {
    const { socket } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    const promise = socket.call('JOIN_CHALLENGE', {});
    const assertion = expect(promise).rejects.toThrow(/Connection lost/);
    raw.onclose?.();
    await assertion;
    vi.advanceTimersByTime(1000);
  });

  it('times out a call the server never answers', async () => {
    const { socket } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    const promise = socket.call('JOIN_CHALLENGE', {}, 1000);
    const assertion = expect(promise).rejects.toThrow(/did not respond/);
    vi.advanceTimersByTime(1500);
    await assertion;
  });

  it('rejects immediately when not connected', async () => {
    const { socket } = makeSocket();
    await expect(socket.call('X', {})).rejects.toThrow('Not connected');
  });
});

describe('rejected session (spec 52: after a database reset)', () => {
  it('stops reconnecting and reports the failure instead of looping forever', () => {
    const { socket, authErrors } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    // The server rejects the stale token and closes the socket.
    raw.receive({ t: 'ERROR', d: { code: 'unauthorised', message: 'Invalid or expired session token' }, ts: Date.now() });
    raw.onclose?.();

    expect(authErrors).toEqual(['Invalid or expired session token']);

    // No retry storm: the client does not reconnect with a token that can
    // never work.
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances.length).toBe(1);
  });

  it('still reconnects after an ordinary error', () => {
    const { socket, authErrors } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();
    raw.receive({ t: 'ERROR', d: { code: 'paused', message: 'The round is paused' }, ts: Date.now() });
    raw.onclose?.();

    expect(authErrors).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances.length).toBe(2);
  });
});

describe('clock skew', () => {
  it('adopts the server clock from the snapshot', () => {
    const { socket } = makeSocket();
    socket.connect();
    const raw = FakeSocket.instances[0] as FakeSocket;
    raw.onopen?.();

    const serverNow = Date.now() + 45_000;
    raw.receive({ t: 'SNAPSHOT', d: { seq: 1, serverNow }, seq: 1, ts: serverNow });

    // A timer deadline expressed in server time now resolves correctly.
    expect(socket.serverNow()).toBeGreaterThan(Date.now() + 40_000);
  });
});
