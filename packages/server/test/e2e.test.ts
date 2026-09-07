/**
 * End-to-end over a REAL server: Fastify HTTP + a real WebSocket hub, with
 * multiple simultaneous participant clients. This is the test that proves the
 * LAN protocol works, not just the engine.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app.js';
import type { Envelope, Question, Snapshot, SubmissionValue } from '@code-market/shared';

let app: App;
let baseUrl: string;
let wsUrl: string;

class Client {
  readonly frames: Envelope[] = [];
  snapshot: Snapshot | null = null;
  private readonly waiters: {
    match: (f: Envelope) => boolean;
    resolve: (f: Envelope) => void;
    timer: NodeJS.Timeout;
  }[] = [];

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

  clear(): void {
    this.frames.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}

const TEAM_COUNT = 8;
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

function answerFor(question: Question, correct: boolean): SubmissionValue {
  const e = question.evaluation;
  switch (question.type) {
    case 'mcq': {
      const right = e.correctOptionIds?.[0] ?? 'a';
      const wrong = (question.question.options ?? []).find((o) => o.id !== right)?.id ?? 'zz';
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

/** The engine is in-process, so the test can read the authoritative question. */
function currentQuestion(): Question {
  const slot = app.engine.currentSlot();
  return app.repo.getQuestion(slot?.questionId as string) as Question;
}

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

  organizerToken = (await post('/api/auth/organizer', { passcode: 'round3' })).body.token as string;
  organizer = await Client.open(organizerToken, 'organizer', 'ORG');
  projector = await Client.open(
    (await post('/api/auth/projector', {})).body.token as string,
    'projector',
    'PROJ',
  );

  await organizer.call('CREATE_TEAMS', {
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: `T${String(i + 1).padStart(2, '0')}`,
      name: `TEAM ${i + 1}`,
    })),
  });

  const rows = (await get('/api/organizer/teams', organizerToken)).body as {
    id: string;
    joinCode: string;
  }[];
  for (const row of rows) {
    const token = (await post('/api/auth/team', { joinCode: row.joinCode })).body.token as string;
    players.set(row.id, await Client.open(token, 'participant', row.id));
  }
}, 60_000);

afterAll(async () => {
  for (const player of players.values()) player.close();
  organizer.close();
  projector.close();
  await app.close();
});

describe('HTTP surface', () => {
  it('reports health without any internet dependency', async () => {
    expect((await get('/api/health')).body).toMatchObject({ ok: true, offline: true });
  });

  it('refuses organizer endpoints without a token', async () => {
    expect((await get('/api/organizer/teams')).status).toBe(401);
    expect((await get('/api/organizer/sequence')).status).toBe(401);
    expect((await get('/api/export/results.csv')).status).toBe(401);
  });

  it('rejects a bad passcode', async () => {
    expect((await post('/api/auth/organizer', { passcode: 'nope' })).status).toBe(401);
  });
});

describe('a full block over the LAN', () => {
  it('starts the round and generates the sequence', async () => {
    await organizer.call('START_GAME', {});
    const sequence = (await get('/api/organizer/sequence', organizerToken)).body as {
      kind: string;
      blockNumber: number;
    }[];
    expect(sequence).toHaveLength(16);
    expect(sequence.slice(0, 4).map((s) => s.kind)).toEqual([
      'normal',
      'normal',
      'normal',
      'premium',
    ]);
  });

  it('sends every team an intro with domain, difficulty and time - but no body', async () => {
    for (const p of players.values()) p.clear();
    await organizer.call('ADVANCE', {});

    const intro = await players.get('T01')!.wait((f) => f.t === 'QUESTION_INTRO');
    const q = (intro.d as { question: Record<string, unknown> }).question;
    expect(q.revealed).toBe(false);
    expect(q.domain).toBeTruthy();
    expect(q.difficulty).toBeTruthy();
    expect(q.timeLimit).toBeGreaterThan(0);
    expect(JSON.stringify(intro)).not.toContain('acceptedAnswers');
  });

  it('runs the question: unlock, join, submit, settle', async () => {
    await organizer.call('OPEN_QUESTION', {});
    const question = currentQuestion();

    const correct = ['T01', 'T02', 'T03', 'T04'];
    const wrong = ['T05', 'T06'];

    for (const id of [...correct, ...wrong]) {
      const p = players.get(id)!;
      await p.call('UNLOCK_QUESTION', { questionId: question.id, accessKey: question.accessKey });
      await p.call('JOIN_QUESTION', { questionId: question.id });
    }
    await players.get('T07')!.call('SKIP_QUESTION', { questionId: question.id });

    for (const id of correct) {
      await players
        .get(id)!
        .call('SUBMIT_ANSWER', { questionId: question.id, submission: answerFor(question, true) });
    }
    for (const id of wrong) {
      await players
        .get(id)!
        .call('SUBMIT_ANSWER', { questionId: question.id, submission: answerFor(question, false) });
    }

    const reward = { easy: 100, medium: 150, hard: 200, very_hard: 300 }[question.difficulty];
    const penalty = { easy: 100, medium: 150, hard: 200, very_hard: 250 }[question.difficulty];
    expect(app.repo.getTeam('T01')?.capital).toBe(1500 + reward);
    expect(app.repo.getTeam('T05')?.capital).toBe(1500 - penalty);
    expect(app.repo.getTeam('T07')?.capital).toBe(1500);

    await organizer.call('CLOSE_QUESTION', {});
  }, 30_000);

  it('never leaks another team private view or any answer key', async () => {
    const client = players.get('T04')!;
    const views = client.frames.filter((f) => f.t === 'ME_UPDATED');
    expect(views.length).toBeGreaterThan(0);
    for (const frame of views) {
      expect((frame.d as { me: { teamId: string } }).me.teamId).toBe('T04');
    }
    const dump = JSON.stringify(client.frames);
    expect(dump).not.toContain('acceptedAnswers');
    expect(dump).not.toContain('correctOptionIds');
    for (const q of app.engine.listQuestions()) {
      expect(dump, `key ${q.accessKey} leaked`).not.toContain(q.accessKey);
    }
  });

  it('refuses organizer commands from a participant socket', async () => {
    await expect(players.get('T02')!.call('ADVANCE', {})).rejects.toThrow(
      /unknown_command|forbidden/,
    );
  });
});

describe('premium over the LAN', () => {
  it('advances to the premium and publishes a preview without the question', async () => {
    // Two more normal questions to reach the premium.
    for (let i = 0; i < 2; i++) {
      await organizer.call('ADVANCE', {});
      await organizer.call('OPEN_QUESTION', {});
      await organizer.call('CLOSE_QUESTION', {});
    }

    projector.clear();
    await organizer.call('ADVANCE', {});

    const intro = await projector.wait((f) => f.t === 'PREMIUM_INTRO');
    const preview = (intro.d as { preview: Record<string, unknown> }).preview;
    expect(preview.startingBid).toBe(200);
    expect(preview.domain).toBeTruthy();
    expect(preview.difficulty).toBeTruthy();
    expect(JSON.stringify(intro)).not.toContain('prompt');
  }, 30_000);

  it('runs the auction and authorises exactly one team', async () => {
    // Drain T08 so its purse cannot reach the bidding (full-purse eligibility).
    await organizer.call('ADJUST_CAPITAL', { teamId: 'T08', amount: -1400, reason: 'drain' });
    await organizer.call('START_AUCTION', {});
    // Teams enter their own amounts; highest wins.
    await organizer.call('PLACE_BID', { teamId: 'T03', amount: 300 });
    await organizer.call('PLACE_BID', { teamId: 'T02', amount: 400 });
    await organizer.call('PLACE_BID', { teamId: 'T01', amount: 500 });

    const poor = (await organizer.call('PLACE_BID', { teamId: 'T08', amount: 600 })) as {
      accepted: boolean;
    };
    expect(poor.accepted).toBe(false);

    projector.clear();
    const winner = players.get('T01')!;
    winner.clear();
    await organizer.call('CLOSE_AUCTION', {});

    expect((await projector.wait((f) => f.t === 'AUCTION_WON')).d).toMatchObject({
      teamId: 'T01',
      amount: 500,
    });
    expect((await winner.wait((f) => f.t === 'PREMIUM_UNLOCKED')).d).toMatchObject({
      teamId: 'T01',
      risk: 500,
    });
    // And the winner is invited to TAKE or SIT OUT (spec 6, 7).
    expect((await winner.wait((f) => f.t === 'PREMIUM_DECISION_WINDOW')).d).toMatchObject({
      eligibleTeamIds: ['T01'],
    });
  }, 30_000);

  it('reveals the premium body only to the winner, then settles the reclaim', async () => {
    const question = currentQuestion();
    const winner = players.get('T01')!;
    winner.clear();
    // The winner TAKES the premium; taking starts the attempt (spec 6, 7).
    await winner.call('PREMIUM_DECISION', { take: true });

    const revealed = await winner.wait(
      (f) => f.t === 'QUESTION_OPENED' && (f.d as { question: { revealed: boolean } }).question.revealed,
    );
    expect(revealed).toBeTruthy();

    // A bystander still sees nothing.
    const bystander = players.get('T05')!;
    const bystanderDump = JSON.stringify(bystander.frames);
    expect(bystanderDump).not.toContain(question.evaluation.explanation ?? '@@none@@');

    const before = app.repo.getTeam('T01')?.capital as number;
    await winner.call('SUBMIT_ANSWER', {
      questionId: question.id,
      submission: answerFor(question, false),
    });
    expect(app.repo.getTeam('T01')?.capital).toBe(before - 500);

    // Reclaim goes to the next original bidder at their own bid.
    const reclaimClient = players.get('T02')!;
    const offer = await reclaimClient.wait((f) => f.t === 'PREMIUM_RECLAIM_OFFERED');
    expect(offer.d).toMatchObject({ teamId: 'T02', risk: 400, failedTeamId: 'T01' });

    const t02Before = app.repo.getTeam('T02')?.capital as number;
    await reclaimClient.call('RECLAIM_RESPONSE', { questionId: question.id, accept: true });
    await organizer.call('START_PREMIUM_ATTEMPT', {});
    await reclaimClient.call('SUBMIT_ANSWER', {
      questionId: question.id,
      submission: answerFor(question, true),
    });

    expect(app.repo.getTeam('T02')?.capital).toBe(t02Before + 400);
    expect(app.repo.getPremiumState(question.id)?.outcome).toBe('won_reclaim');
    expect(app.repo.listAuctions()).toHaveLength(1);
  }, 40_000);

  it('runs the 40-second strategy phase after the premium', async () => {
    for (const p of players.values()) p.clear();
    projector.clear();
    await organizer.call('START_STRATEGY', {});

    const started = await projector.wait((f) => f.t === 'STRATEGY_STARTED');
    expect((started.d as { duration: number }).duration).toBe(40);
    expect(app.engine.gameState().phase).toBe('strategy_phase');

    // Every participant sees it too.
    const forTeam = await players.get('T06')!.wait((f) => f.t === 'STRATEGY_STARTED');
    expect(forTeam).toBeTruthy();

    await organizer.call('SKIP_STRATEGY', {});
    expect(app.engine.gameState().slotIndex).toBe(5);
  }, 30_000);
});

describe('reconnect (spec 20)', () => {
  it('restores full state from a fresh socket', async () => {
    const rows = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const row = rows.find((r) => r.id === 'T02')!;
    const expected = app.repo.getTeam('T02')?.capital;

    const token = (await post('/api/auth/team', { joinCode: row.joinCode })).body.token as string;
    const rejoined = await Client.open(token, 'participant', 'T02-again');
    expect(rejoined.snapshot?.me?.teamId).toBe('T02');
    expect(rejoined.snapshot?.me?.capital).toBe(expected);
    expect(rejoined.snapshot?.game.slotIndex).toBe(app.engine.gameState().slotIndex);
    rejoined.close();
  });

  it('stamps a monotonic sequence on every broadcast', async () => {
    organizer.clear();
    await organizer.call('ADJUST_CAPITAL', { teamId: 'T05', amount: 50, reason: 'seq test' });
    await new Promise((r) => setTimeout(r, 200));
    const seqs = organizer.frames.map((f) => f.seq).filter((s): s is number => typeof s === 'number');
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i] as number).toBeGreaterThan(seqs[i - 1] as number);
    }
  });
});

describe('finale (spec 2, 11, 18)', () => {
  it('hides the leaderboard from projector and participants in the final stretch', async () => {
    // Walk to slot 11, where the last four normal questions begin.
    while (app.engine.gameState().slotIndex < 11) {
      await organizer.call('ADVANCE', {});
      const slot = app.engine.currentSlot();
      if (!slot || slot.index >= 11) break;
      if (slot.kind === 'normal') await organizer.call('CLOSE_QUESTION', {});
      else await organizer.call('CLOSE_PREMIUM', {});
    }
    expect(app.engine.isFinalStretch()).toBe(true);

    const projectorState = app.engine.snapshot('projector', null, 0);
    expect(projectorState.leaderboard).toEqual([]);
    expect(projectorState.leaderboardHidden).toBe(true);

    const organizerState = app.engine.snapshot('organizer', null, 0);
    expect(organizerState.leaderboard.length).toBe(TEAM_COUNT);
    expect(organizerState.leaderboardHidden).toBe(false);

    const participant = app.engine.snapshot('participant', 'T03', 0);
    expect(participant.leaderboard).toHaveLength(1);
    expect(participant.leaderboard[0]?.teamId).toBe('T03');
  }, 60_000);

  it('still withholds live board updates from the hall during the blackout', async () => {
    // The hub coalesces leaderboard traffic per audience. That must not become
    // a way for the sealed board to reach the projector: the engine simply
    // never emits it there while the blackout is in force.
    expect(app.engine.isFinalStretch()).toBe(true);
    organizer.clear();
    projector.clear();

    await organizer.call('ADJUST_CAPITAL', { teamId: 'T05', amount: 40, reason: 'blackout probe' });

    const isBoard = (f: Envelope) => f.t === 'LEADERBOARD_UPDATED';
    await organizer.wait(isBoard);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(organizer.frames.filter(isBoard).length).toBeGreaterThan(0);
    expect(projector.frames.filter(isBoard)).toHaveLength(0);
  }, 30_000);

  it('completes the round and produces a top three', async () => {
    // Separate the top three cleanly, whatever earlier play left behind.
    await organizer.call('ADJUST_CAPITAL', { teamId: 'T02', amount: 9000, reason: 'podium 1' });
    await organizer.call('ADJUST_CAPITAL', { teamId: 'T03', amount: 6000, reason: 'podium 2' });
    await organizer.call('ADJUST_CAPITAL', { teamId: 'T04', amount: 3000, reason: 'podium 3' });

    const podium = (await organizer.call('COMPLETE_GAME', {})) as {
      place: number;
      teamId: string;
    }[];
    expect(podium).toHaveLength(3);
    expect(podium.map((p) => p.place)).toEqual([1, 2, 3]);

    projector.clear();
    await organizer.call('REVEAL_PODIUM', {});
    const revealed = await projector.wait((f) => f.t === 'PODIUM_REVEALED');
    expect((revealed.d as { podium: unknown[] }).podium).toHaveLength(3);
    expect(app.engine.gameState().phase).toBe('completed');
  }, 30_000);

  it('exports results with places and no qualification column', async () => {
    const csv = await get('/api/export/results.csv', organizerToken);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toContain('Place');
    expect(lines[0]).not.toContain('Qualification');
    expect(lines).toHaveLength(TEAM_COUNT + 1);
    expect(lines[1]).toContain('1st');

    const json = (await get('/api/export/results.json', organizerToken)).body as {
      podium: unknown[];
      sequence: unknown[];
      event: { roundNumber: number };
    };
    expect(json.podium).toHaveLength(3);
    expect(json.sequence).toHaveLength(16);
    expect(json.event.roundNumber).toBe(3);
  });

  it('serves a complete dossier for any team', async () => {
    const dossier = (await get('/api/organizer/team/T01', organizerToken)).body as {
      team: { id: string };
      attempts: unknown[];
      bids: unknown[];
      transactions: unknown[];
      audit: unknown[];
    };
    expect(dossier.team.id).toBe('T01');
    expect(dossier.attempts.length).toBeGreaterThan(0);
    expect(dossier.bids.length).toBeGreaterThan(0);
    expect(dossier.transactions.length).toBeGreaterThan(1);
    expect(dossier.audit.length).toBeGreaterThan(0);
    expect((await get('/api/organizer/team/NOPE', organizerToken)).status).toBe(404);
  });
});

describe('leaderboard broadcasts reach every audience', () => {
  /**
   * One refresh emits the board three times, once per audience, because the
   * blackout gives the organizer, the projector and the participants different
   * views of it. The hub coalesces rapid leaderboard traffic into one frame,
   * and a single pending slot used to let the last emit overwrite the other
   * two. The result was that only participants ever saw a live update: the
   * projector and the organizer showed stale standings until something else
   * made them re-read a snapshot.
   */
  it('sends one update to the organizer, the projector and the teams', async () => {
    const team = players.get('T06') as Client;
    // Earlier tests in this file have already moved capital around, so the
    // baseline is whatever the engine holds now.
    const before = app.repo.getTeam('T06')?.capital as number;
    organizer.clear();
    projector.clear();
    team.clear();

    await organizer.call('ADJUST_CAPITAL', {
      teamId: 'T06',
      amount: 25,
      reason: 'broadcast probe',
    });

    // Every audience must receive a board that reflects the change - not just
    // any board frame, since rapid updates are coalesced.
    const showsT06 = (value: number) => (f: Envelope) =>
      f.t === 'LEADERBOARD_UPDATED' &&
      (f.d as { rows: { teamId: string; capital: number }[] }).rows.find(
        (r) => r.teamId === 'T06',
      )?.capital === value;

    await Promise.all([
      organizer.wait(showsT06(before + 25)),
      projector.wait(showsT06(before + 25)),
      team.wait(showsT06(before + 25)),
    ]);
  });

  it('coalesces a burst without dropping any audience', async () => {
    const before = app.repo.getTeam('T07')?.capital as number;
    organizer.clear();
    projector.clear();

    for (let i = 0; i < 6; i++) {
      await organizer.call('ADJUST_CAPITAL', { teamId: 'T07', amount: 10, reason: 'burst' });
    }

    const isBoard = (f: Envelope) => f.t === 'LEADERBOARD_UPDATED';
    await Promise.all([organizer.wait(isBoard), projector.wait(isBoard)]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Coalescing means far fewer frames than changes, but never zero.
    for (const [label, client] of [
      ['organizer', organizer],
      ['projector', projector],
    ] as [string, Client][]) {
      const count = client.frames.filter(isBoard).length;
      expect(count, `${label} received nothing`).toBeGreaterThan(0);
      expect(count, `${label} was not coalesced`).toBeLessThan(6);
    }

    // And the last frame each surface holds is the settled truth.
    const finalRows = (
      projector.frames.filter(isBoard).at(-1)?.d as {
        rows: { teamId: string; capital: number }[];
      }
    ).rows;
    expect(finalRows.find((r) => r.teamId === 'T07')?.capital).toBe(before + 60);
  });
});
