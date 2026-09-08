/**
 * Participant self-service bidding.
 *
 * Teams bid from their own laptops. The session's team is authoritative: a
 * client that puts someone else's teamId in the payload still bids as itself,
 * so one team can never spend another team's capital. Every accepted bid
 * reaches the organizer and the projector in real time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app.js';

let app: App;
let baseUrl = '';
let wsUrl = '';

interface Frame {
  t: string;
  d?: unknown;
  rid?: string;
}

class Sock {
  private readonly frames: Frame[] = [];
  private n = 0;
  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => this.frames.push(JSON.parse(String(raw)) as Frame));
  }

  static async open(token: string): Promise<Sock> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    const sock = new Sock(ws);
    await sock.call('HELLO', { token });
    return sock;
  }

  call(t: string, d: unknown): Promise<Frame> {
    const rid = `r${++this.n}`;
    this.ws.send(JSON.stringify({ t, d, rid, ts: Date.now() }));
    return this.wait((f) => f.rid === rid);
  }

  wait(match: (f: Frame) => boolean, timeoutMs = 4000): Promise<Frame> {
    const existing = this.frames.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const hit = this.frames.find(match);
        if (hit) {
          clearInterval(timer);
          resolve(hit);
        }
      }, 20);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error('timeout'));
      }, timeoutMs);
    });
  }

  seen(t: string): Frame[] {
    return this.frames.filter((f) => f.t === t);
  }

  clear(): void {
    this.frames.length = 0;
  }

  close(): void {
    this.ws.close();
  }
}

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return (await r.json()) as Record<string, unknown>;
}

let organizerToken = '';
let organizer: Sock;
let projector: Sock;
const codes = new Map<string, string>();

beforeAll(async () => {
  app = await createApp({
    dbFile: ':memory:',
    port: 0,
    organizerPasscode: 'round3',
    serveClient: false,
    detectToolchain: false,
  });
  const { port } = await app.listen();
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;

  organizerToken = (await post('/api/auth/organizer', { passcode: 'round3' })).token as string;
  organizer = await Sock.open(organizerToken);
  projector = await Sock.open((await post('/api/auth/projector', {})).token as string);

  await organizer.call('CREATE_TEAMS', {
    teams: Array.from({ length: 4 }, (_, i) => ({ name: `TEAM ${i + 1}` })),
  });
  const rows = (await (await fetch(`${baseUrl}/api/organizer/teams`, {
    headers: { authorization: `Bearer ${organizerToken}` },
  })).json()) as { id: string; joinCode: string }[];
  for (const row of rows) codes.set(row.id, row.joinCode);

  // Reach the first premium and open the auction.
  await organizer.call('START_GAME', {});
  for (let i = 0; i < 10; i++) {
    const state = (await organizer.call('REQUEST_CURRENT_STATE', {})).d as {
      game: { phase: string };
    };
    if (state.game.phase === 'premium_intro') break;
    await organizer.call('ADVANCE', {});
    const after = (await organizer.call('REQUEST_CURRENT_STATE', {})).d as {
      game: { phase: string };
    };
    if (after.game.phase === 'question_intro') {
      await organizer.call('OPEN_QUESTION', {});
      await organizer.call('CLOSE_QUESTION', {});
    }
    if (after.game.phase === 'premium_intro') break;
  }
  await organizer.call('START_AUCTION', {});
}, 60_000);

afterAll(async () => {
  organizer?.close();
  projector?.close();
  await app?.close();
});

async function team(id: string): Promise<Sock> {
  return Sock.open((await post('/api/auth/team', { joinCode: codes.get(id) }).then((r) => r)).token as string);
}

describe('participant bidding', () => {
  it('lets a team place its own bid, and it reaches organizer and projector', async () => {
    const t1 = await team('T01');
    organizer.clear();
    projector.clear();

    const ack = await t1.call('PLACE_BID', {});
    expect((ack.d as { data: { accepted: boolean } }).data.accepted).toBe(true);

    // The board of bidders reaches the hall and the operator in real time.
    const onProjector = await projector.wait((f) => f.t === 'AUCTION_BID');
    const onOrganizer = await organizer.wait((f) => f.t === 'AUCTION_BID');
    for (const frame of [onProjector, onOrganizer]) {
      const view = (frame.d as { auction: { auction: { currentLeaderTeamId: string } } }).auction;
      expect(view.auction.currentLeaderTeamId).toBe('T01');
    }
    t1.close();
  });

  it('ignores a forged teamId: a team can only bid as itself', async () => {
    const t2 = await team('T02');

    // T02 tries to bid "as" T03. The session is authoritative, so the bid is
    // recorded for T02 and T03's capital is never touched.
    await t2.call('PLACE_BID', { teamId: 'T03' });

    const view = (await organizer.call('REQUEST_CURRENT_STATE', {})).d as {
      auction: { auction: { currentLeaderTeamId: string } };
    };
    expect(view.auction.auction.currentLeaderTeamId).toBe('T02');
    t2.close();
  });

  it('rejects a bid beyond the team ceiling with a reason, not a crash', async () => {
    // Drain T04's purse to ₹100. Below the ₹500 protected reserve its bid
    // ceiling is ₹0, so it cannot reach any bid on the ladder.
    await organizer.call('ADJUST_CAPITAL', { teamId: 'T04', amount: -1400, reason: 'test ceiling' });
    const t4 = await team('T04');
    const ack = await t4.call('PLACE_BID', {});
    const result = (ack.d as { data: { accepted: boolean; message?: string } }).data;
    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/max bid/i);

    // The server is still alive and the auction still has a leader.
    const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
    t4.close();
  });
});
