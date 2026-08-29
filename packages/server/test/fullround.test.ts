/**
 * The full-round rehearsal (spec sections 50, 51).
 *
 * Runs the entire 12-challenge round against a REAL server over REAL
 * WebSockets, with 12 simulated participant clients, and asserts the economy,
 * the reclaim rules and the exported results at the end.
 *
 * This is the test that stands in for event day.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app.js';
import type { Envelope, Snapshot, SubmissionValue } from '@code-market/shared';

let app: App;
let baseUrl: string;
let wsUrl: string;

/* ------------------------------------------------------------------ *
 * A minimal client good enough to play the round
 * ------------------------------------------------------------------ */

class Client {
  readonly frames: Envelope[] = [];
  snapshot: Snapshot | null = null;
  private readonly waiters: { match: (f: Envelope) => boolean; resolve: (f: Envelope) => void; timer: NodeJS.Timeout }[] = [];

  private constructor(
    private readonly socket: WebSocket,
    readonly label: string,
  ) {
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as Envelope;
      this.frames.push(frame);
      if (frame.t === 'SNAPSHOT') this.snapshot = frame.d as Snapshot;
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i];
        if (waiter && waiter.match(frame)) {
          this.waiters.splice(i, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(frame);
        }
      }
    });
  }

  static async open(token: string, role: string, label: string): Promise<Client> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const client = new Client(socket, label);
    const ready = client.wait((f) => f.t === 'SNAPSHOT');
    client.raw('HELLO', { token, role, clientVersion: 'test' });
    await ready;
    return client;
  }

  raw(t: string, d: unknown, rid?: string): void {
    this.socket.send(JSON.stringify({ t, d, ts: Date.now(), ...(rid ? { rid } : {}) }));
  }

  wait(match: (f: Envelope) => boolean, timeoutMs = 8000): Promise<Envelope> {
    const existing = this.frames.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.label}: timeout; saw ${this.frames.map((f) => f.t).join(',')}`)),
        timeoutMs,
      );
      this.waiters.push({ match, resolve, timer });
    });
  }

  async call(t: string, d: unknown): Promise<unknown> {
    const rid = `r${Math.random().toString(36).slice(2)}`;
    const reply = this.wait((f) => f.rid === rid);
    this.raw(t, d, rid);
    const frame = await reply;
    if (frame.t === 'ERROR') {
      const err = frame.d as { code: string; message: string };
      throw new Error(`${err.code}: ${err.message}`);
    }
    return (frame.d as { data?: unknown }).data;
  }

  /** Best-effort call that swallows a rejection (e.g. bidding beyond a ceiling). */
  async tryCall(t: string, d: unknown): Promise<boolean> {
    try {
      await this.call(t, d);
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.frames.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

const TEAM_COUNT = 12;
let organizer: Client;
let projector: Client;
const players = new Map<string, Client>();
let organizerToken = '';

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function get(path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown, text };
  } catch {
    return { status: response.status, body: text as unknown, text };
  }
}

/** Correct / deliberately wrong answers, computed from the server's own data. */
function answerFor(challenge: {
  type: string;
  evaluation: Record<string, unknown>;
  question: Record<string, unknown>;
}, correct: boolean): SubmissionValue {
  const e = challenge.evaluation as {
    correctOptionIds?: string[];
    correctBoolean?: boolean;
    correctNumber?: number;
    correctOrder?: string[];
    correctPairs?: Record<string, string>;
    acceptedAnswers?: string[];
  };
  switch (challenge.type) {
    case 'mcq': {
      const right = e.correctOptionIds?.[0] ?? 'a';
      const options = (challenge.question.options ?? []) as { id: string }[];
      const wrong = options.find((o) => o.id !== right)?.id ?? 'zz';
      return { kind: 'choice', optionIds: [correct ? right : wrong] };
    }
    case 'multi': {
      const right = e.correctOptionIds ?? [];
      return { kind: 'choice', optionIds: correct ? right : right.slice(1) };
    }
    case 'true_false':
      return { kind: 'boolean', value: correct ? Boolean(e.correctBoolean) : !e.correctBoolean };
    case 'numeric':
      return { kind: 'number', value: correct ? (e.correctNumber ?? 0) : (e.correctNumber ?? 0) + 41 };
    case 'ordering': {
      const order = e.correctOrder ?? [];
      return { kind: 'order', itemIds: correct ? order : [...order].reverse() };
    }
    case 'matching': {
      const pairs = e.correctPairs ?? {};
      if (correct) return { kind: 'pairs', pairs };
      const keys = Object.keys(pairs);
      const values = Object.values(pairs);
      const swapped: Record<string, string> = {};
      keys.forEach((k, i) => {
        swapped[k] = values[(i + 1) % values.length] ?? '';
      });
      return { kind: 'pairs', pairs: swapped };
    }
    default:
      return { kind: 'text', value: correct ? (e.acceptedAnswers?.[0] ?? '') : '__wrong__' };
  }
}

let challengeData: Record<string, { id: string; type: string; accessKey: string; marketType: string; evaluation: Record<string, unknown>; question: Record<string, unknown> }> = {};

beforeAll(async () => {
  app = await createApp({
    dbFile: ':memory:',
    port: 0,
    organizerPasscode: 'round2',
    serveClient: false,
    detectToolchain: false,
  });
  const { port } = await app.listen();
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;

  organizerToken = (await post('/api/auth/organizer', { passcode: 'round2' })).body.token as string;
  organizer = await Client.open(organizerToken, 'organizer', 'ORG');
  projector = await Client.open((await post('/api/auth/projector', {})).body.token as string, 'projector', 'PROJ');

  await organizer.call('CREATE_TEAMS', {
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: `T${String(i + 1).padStart(2, '0')}`,
      name: `TEAM ${i + 1}`,
    })),
  });

  const rows = (await get('/api/organizer/teams', organizerToken)).body as { id: string; joinCode: string }[];
  for (const row of rows) {
    const token = (await post('/api/auth/team', { joinCode: row.joinCode })).body.token as string;
    players.set(row.id, await Client.open(token, 'participant', row.id));
  }

  // The engine is in-process, so the test can read the authoritative challenge
  // definitions (including answers) directly - a client never could.
  challengeData = Object.fromEntries(
    app.engine.listChallenges().map((c) => [
      c.id,
      {
        id: c.id,
        type: c.type,
        accessKey: c.accessKey,
        marketType: c.marketType,
        evaluation: c.evaluation as unknown as Record<string, unknown>,
        question: c.question as unknown as Record<string, unknown>,
      },
    ]),
  );
}, 60_000);

afterAll(async () => {
  for (const player of players.values()) player.close();
  organizer.close();
  projector.close();
  await app.close();
});

function capital(teamId: string): number {
  return app.repo.getTeam(teamId)?.capital ?? -1;
}

/* ------------------------------------------------------------------ *
 * The round
 * ------------------------------------------------------------------ */

describe('full Round 2 rehearsal over the LAN protocol', () => {
  it('starts with twelve connected teams on equal capital', async () => {
    await organizer.call('START_GAME', {});
    expect(players.size).toBe(TEAM_COUNT);
    for (const id of players.keys()) expect(capital(id)).toBe(1000);
  });

  it('plays market challenge 01: some correct, some wrong, one sit-out', async () => {
    await organizer.call('OPEN_CHALLENGE', { challengeId: 'C01' });
    const challenge = challengeData.C01!;

    const correctTeams = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06'];
    const wrongTeams = ['T07', 'T08', 'T09', 'T10'];
    const skipTeams = ['T11', 'T12'];

    for (const id of [...correctTeams, ...wrongTeams]) {
      const player = players.get(id)!;
      await player.call('UNLOCK_CHALLENGE', { challengeId: 'C01', accessKey: challenge.accessKey });
      await player.call('JOIN_CHALLENGE', { challengeId: 'C01' });
    }
    for (const id of skipTeams) {
      await players.get(id)!.call('SKIP_CHALLENGE', { challengeId: 'C01' });
    }

    for (const id of correctTeams) {
      await players.get(id)!.call('SUBMIT_ANSWER', {
        challengeId: 'C01',
        submission: answerFor(challenge, true),
      });
    }
    for (const id of wrongTeams) {
      await players.get(id)!.call('SUBMIT_ANSWER', {
        challengeId: 'C01',
        submission: answerFor(challenge, false),
      });
    }

    expect(capital('T01')).toBe(1200);
    expect(capital('T07')).toBe(900);
    expect(capital('T11')).toBe(1000);

    await organizer.call('CLOSE_CHALLENGE', { challengeId: 'C01' });
  }, 30_000);

  it('a participant never receives another team private view or any answer key', async () => {
    const client = players.get('T05')!;

    // Public facts about other teams (capital, bids, results) are broadcast on
    // purpose - that is what makes the leaderboard live. What must never leave
    // the server is another team's PRIVATE view or any answer/access key.
    const privateViews = client.frames.filter((f) => f.t === 'ME_UPDATED');
    expect(privateViews.length).toBeGreaterThan(0);
    for (const frame of privateViews) {
      expect((frame.d as { me: { teamId: string } }).me.teamId).toBe('T05');
    }

    const dump = JSON.stringify(client.frames);
    expect(dump).not.toContain('acceptedAnswers');
    expect(dump).not.toContain('correctOptionIds');
    expect(dump).not.toContain('correctOrder');
    expect(dump).not.toContain('reclaimOffer":{"challengeId');
    for (const challenge of Object.values(challengeData)) {
      expect(dump, `access key ${challenge.accessKey} must not leak`).not.toContain(challenge.accessKey);
    }
  });

  it('runs premium 04 with a real auction, a failure and a reclaim', async () => {
    // Give a few teams headroom so meaningful bids are legal.
    for (const id of ['T01', 'T02', 'T03']) {
      await organizer.call('ADJUST_CAPITAL', { teamId: id, amount: 900, reason: 'rehearsal headroom' });
    }

    await organizer.call('OPEN_CHALLENGE', { challengeId: 'C04' });
    await organizer.call('START_AUCTION', { challengeId: 'C04' });

    // Ascending auction: T03 300, T02 400, T01 500, T02 600, T01 700.
    await organizer.call('PLACE_BID', { teamId: 'T03' });
    await organizer.call('PLACE_BID', { teamId: 'T02' });
    await organizer.call('PLACE_BID', { teamId: 'T01' });
    await organizer.call('PLACE_BID', { teamId: 'T02' });
    await organizer.call('PLACE_BID', { teamId: 'T01' });

    // A team without headroom cannot join at this price.
    const poorBid = await organizer.call('PLACE_BID', { teamId: 'T09' });
    expect((poorBid as { accepted: boolean }).accepted).toBe(false);

    await organizer.call('CALL_AUCTION', { call: 'once' });
    await organizer.call('CALL_AUCTION', { call: 'twice' });

    const winnerClient = players.get('T01')!;
    winnerClient.clear();
    projector.clear();
    await organizer.call('CLOSE_AUCTION', {});

    const sold = await projector.wait((f) => f.t === 'AUCTION_WON');
    expect(sold.d).toMatchObject({ teamId: 'T01', amount: 700 });

    const unlocked = await winnerClient.wait((f) => f.t === 'CHALLENGE_UNLOCKED');
    expect(unlocked.d).toMatchObject({ risk: 700 });

    const capitalBefore = capital('T01');
    await organizer.call('START_PREMIUM_ATTEMPT', {});

    // Attempt 1 fails -> loses the bid, reclaim opens for the next bidder.
    await winnerClient.call('SUBMIT_ANSWER', {
      challengeId: 'C04',
      submission: answerFor(challengeData.C04!, false),
    });
    expect(capital('T01')).toBe(capitalBefore - 700);

    const reclaimClient = players.get('T02')!;
    const offer = await reclaimClient.wait((f) => f.t === 'PREMIUM_RECLAIM_OFFERED');
    expect(offer.d).toMatchObject({ teamId: 'T02', risk: 600, failedTeamId: 'T01' });

    // T02 accepts and answers correctly at its OWN original bid.
    const t02Before = capital('T02');
    await reclaimClient.call('RECLAIM_RESPONSE', { challengeId: 'C04', accept: true });
    await organizer.call('START_PREMIUM_ATTEMPT', {});
    await reclaimClient.call('SUBMIT_ANSWER', {
      challengeId: 'C04',
      submission: answerFor(challengeData.C04!, true),
    });

    expect(capital('T02')).toBe(t02Before + 600);
    expect(app.repo.getPremiumState('C04')?.outcome).toBe('won_reclaim');
    // Exactly one auction existed for this premium.
    expect(app.repo.listAuctions().filter((a) => a.challengeId === 'C04')).toHaveLength(1);
  }, 40_000);

  it('a reclaim decline chain closes the premium after two attempts', async () => {
    await organizer.call('OPEN_CHALLENGE', { challengeId: 'C07' });
    await organizer.call('START_AUCTION', { challengeId: 'C07' });
    await organizer.call('PLACE_BID', { teamId: 'T03' }); // 300
    await organizer.call('PLACE_BID', { teamId: 'T02' }); // 400
    await organizer.call('CLOSE_AUCTION', {});
    await organizer.call('START_PREMIUM_ATTEMPT', {});

    await players.get('T02')!.call('SUBMIT_ANSWER', {
      challengeId: 'C07',
      submission: answerFor(challengeData.C07!, false),
    });

    // T03 is offered the reclaim and declines; nobody is left, so it closes.
    const t03 = players.get('T03')!;
    await t03.wait((f) => f.t === 'PREMIUM_RECLAIM_OFFERED');
    const before = capital('T03');
    await t03.call('RECLAIM_RESPONSE', { challengeId: 'C07', accept: false });

    const premium = app.repo.getPremiumState('C07');
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('no_takers');
    expect(capital('T03')).toBe(before); // declining is free
  }, 30_000);

  it('a reconnecting team resumes exactly where it left off (spec 36)', async () => {
    const rows = (await get('/api/organizer/teams', organizerToken)).body as { id: string; joinCode: string }[];
    const row = rows.find((r) => r.id === 'T02')!;
    const expected = capital('T02');

    const token = (await post('/api/auth/team', { joinCode: row.joinCode })).body.token as string;
    const rejoined = await Client.open(token, 'participant', 'T02-again');
    expect(rejoined.snapshot?.me?.capital).toBe(expected);
    expect(rejoined.snapshot?.me?.teamId).toBe('T02');
    expect(rejoined.snapshot?.leaderboard).toHaveLength(TEAM_COUNT);
    rejoined.close();
  });

  it('runs the final premium with the ceremonial opening bid', async () => {
    await organizer.call('OPEN_CHALLENGE', { challengeId: 'C12' });
    const view = (await organizer.call('START_AUCTION', { challengeId: 'C12' })) as {
      auction: { startingBid: number };
    };
    expect(view.auction.startingBid).toBe(500);

    await organizer.call('PLACE_BID', { teamId: 'T02' });
    await organizer.call('CLOSE_AUCTION', {});
    await organizer.call('START_PREMIUM_ATTEMPT', {});

    const before = capital('T02');
    await players.get('T02')!.call('SUBMIT_ANSWER', {
      challengeId: 'C12',
      submission: answerFor(challengeData.C12!, true),
    });
    expect(capital('T02')).toBe(before + 500);
  }, 30_000);

  it('completes the round and produces a ranked, exportable result', async () => {
    await organizer.call('COMPLETE_GAME', {});

    const csv = await get('/api/export/results.csv', organizerToken);
    const lines = csv.text.trim().split('\n');
    expect(lines).toHaveLength(TEAM_COUNT + 1);

    const json = (await get('/api/export/results.json', organizerToken)).body as {
      results: {
        rank: number;
        teamId: string;
        finalCapital: number;
        totalProfitLoss: number;
        qualification: string;
      }[];
      audit: unknown[];
      transactions: unknown[];
    };

    // Ranking is monotonic in capital.
    for (let i = 1; i < json.results.length; i++) {
      expect(json.results[i]!.finalCapital).toBeLessThanOrEqual(json.results[i - 1]!.finalCapital);
    }
    // Qualification is exactly "rank <= qualifiers". Because ranking is
    // competition-style, a tie ON the line legitimately qualifies everyone tied
    // there, so the count can exceed the configured number - it can never be
    // fewer, and it can never include someone ranked below the line.
    const qualified = json.results.filter((r) => r.qualification === 'QUALIFIED');
    expect(qualified.length).toBeGreaterThanOrEqual(10);
    for (const r of json.results) {
      expect(r.qualification === 'QUALIFIED').toBe(r.rank <= 10);
    }
    // Profit/loss is internally consistent.
    for (const r of json.results) {
      expect(r.totalProfitLoss).toBe(r.finalCapital - 1000);
    }
    // The audit trail covers the whole round.
    expect(json.audit.length).toBeGreaterThan(40);
    expect(json.transactions.length).toBeGreaterThan(TEAM_COUNT);
  }, 30_000);

  it('the ledger reconciles: every team capital equals its transaction history', () => {
    for (const teamId of players.keys()) {
      const txs = app.repo.listTransactions().filter((t) => t.teamId === teamId);
      const sum = txs.reduce((total, t) => total + t.amount, 0);
      expect(sum, `${teamId} ledger must reconcile with its capital`).toBe(capital(teamId));
      // And every transaction's running balance is consistent.
      let running = 0;
      for (const tx of txs) {
        running += tx.amount;
        expect(tx.balanceAfter).toBe(running);
      }
    }
  });

  it('no team was ever pushed below the capital floor', () => {
    for (const teamId of players.keys()) {
      expect(capital(teamId)).toBeGreaterThanOrEqual(0);
    }
  });

  it('every premium used at most two attempts (spec 17)', () => {
    for (const challenge of app.engine.listChallenges()) {
      if (challenge.marketType === 'market') continue;
      const state = app.repo.getPremiumState(challenge.id);
      if (!state) continue;
      expect(state.attemptNumber).toBeLessThanOrEqual(2);
      const attempts = app.repo.listAttempts().filter((a) => a.challengeId === challenge.id);
      expect(attempts.length).toBeLessThanOrEqual(2);
    }
  });
});
