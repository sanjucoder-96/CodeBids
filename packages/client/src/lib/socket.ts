/**
 * The client half of the real-time protocol (spec sections 20, 36).
 *
 * Guarantees:
 *  - automatic reconnection with capped backoff (a laptop lid closing must not
 *    end a team's round),
 *  - HELLO -> SNAPSHOT on every (re)connect, so state is always authoritative,
 *  - sequence-gap detection: a missed broadcast triggers a resync rather than a
 *    silently divergent UI,
 *  - request/response correlation so a command can await its ACK or ERROR.
 */

import type { ClientRole, Envelope } from '@code-market/shared';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketOptions {
  token: string;
  role: ClientRole;
  onFrame: (frame: Envelope) => void;
  onState: (state: ConnectionState) => void;
  /** Called when a sequence gap is detected; the client should resync. */
  onGap?: (expected: number, got: number) => void;
  /**
   * The server rejected our token (typically after the organizer reset the
   * database, which mints a new signing secret). Retrying can never succeed, so
   * the socket stops reconnecting and the surface must return to its login
   * screen instead of spinning on "connecting" forever.
   */
  onUnauthorized?: (message: string) => void;
  url?: string;
}

interface Pending {
  resolve: (frame: Envelope) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const BACKOFF_STEPS = [400, 800, 1500, 2500, 4000, 6000];
const CLIENT_VERSION = '1.0.0';

export function defaultSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export class GameSocket {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private closedByUs = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ridCounter = 0;
  private readonly pending = new Map<string, Pending>();
  private lastSeq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /** Estimated server-minus-client clock offset in ms (spec 36 timer sync). */
  clockOffset = 0;

  constructor(private readonly options: SocketOptions) {}

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
    this.options.onState(this.attempts === 0 ? 'connecting' : 'reconnecting');

    const socket = new WebSocket(this.options.url ?? defaultSocketUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.send('HELLO', {
        token: this.options.token,
        role: this.options.role,
        clientVersion: CLIENT_VERSION,
      });
      this.startPing();
    };

    socket.onmessage = (event) => {
      let frame: Envelope;
      try {
        frame = JSON.parse(String(event.data)) as Envelope;
      } catch {
        return;
      }
      this.handle(frame);
    };

    socket.onerror = () => {
      /* onclose always follows; the retry logic lives there. */
    };

    socket.onclose = () => {
      this.stopPing();
      this.socket = null;
      this.failAllPending(new Error('Connection lost'));
      if (this.closedByUs) {
        this.options.onState('closed');
        return;
      }
      this.options.onState('reconnecting');
      this.scheduleReconnect();
    };
  }

  private handle(frame: Envelope): void {
    if (frame.t === 'SNAPSHOT') {
      const data = frame.d as { seq?: number; serverNow?: number };
      this.lastSeq = data.seq ?? frame.seq ?? 0;
      if (typeof data.serverNow === 'number') {
        this.clockOffset = data.serverNow - Date.now();
      }
      this.options.onState('open');
    } else if (typeof frame.seq === 'number') {
      const expected = this.lastSeq + 1;
      if (this.lastSeq > 0 && frame.seq > expected) {
        this.options.onGap?.(expected, frame.seq);
        this.lastSeq = frame.seq;
        this.resync();
      } else if (frame.seq > this.lastSeq) {
        this.lastSeq = frame.seq;
      }
    }

    if (frame.t === 'ERROR' && (frame.d as { code?: string })?.code === 'unauthorised') {
      // Stop retrying: a rejected token will be rejected every time.
      this.closedByUs = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.options.onUnauthorized?.(
        (frame.d as { message?: string }).message ?? 'Your session is no longer valid',
      );
      return;
    }

    if (frame.t === 'PONG') {
      const sent = (frame.d as { clientTime: number }).clientTime;
      const rtt = Date.now() - sent;
      // One-way delay is approximately half the round trip.
      this.clockOffset = frame.ts - (sent + rtt / 2);
    }

    if (frame.rid) {
      const pending = this.pending.get(frame.rid);
      if (pending) {
        this.pending.delete(frame.rid);
        clearTimeout(pending.timer);
        if (frame.t === 'ERROR') {
          const error = frame.d as { code: string; message: string };
          const err = new Error(error.message) as Error & { code?: string };
          err.code = error.code;
          pending.reject(err);
        } else {
          pending.resolve(frame);
        }
      }
    }

    this.options.onFrame(frame);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = BACKOFF_STEPS[Math.min(this.attempts, BACKOFF_STEPS.length - 1)] ?? 6000;
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send('PING', { clientTime: Date.now() });
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private failAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Fire and forget. */
  send(type: string, data: unknown, rid?: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ t: type, d: data, ts: Date.now(), ...(rid ? { rid } : {}) }));
  }

  /** Send and await the server's ACK; rejects with the server's error. */
  call(type: string, data: unknown, timeoutMs = 10_000): Promise<Envelope> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }
      const rid = `c${++this.ridCounter}_${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error('The server did not respond'));
      }, timeoutMs);
      this.pending.set(rid, { resolve, reject, timer });
      this.send(type, data, rid);
    });
  }

  resync(): void {
    this.send('REQUEST_CURRENT_STATE', {});
  }

  /** Server time, corrected for clock skew between laptops. */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.failAllPending(new Error('Closed'));
    this.socket?.close();
    this.socket = null;
  }
}
