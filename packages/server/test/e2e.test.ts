/**
 * End-to-end test over a REAL server: Fastify HTTP + a real WebSocket hub.
 * This is the test that proves the LAN protocol works, not just the engine.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app.js';
import type { Envelope, Snapshot } from '@code-market/shared';

let app: App;
let baseUrl: string;
let wsUrl: string;

class TestClient {
  private readonly socket: WebSocket;
  readonly frames: Envelope[] = [];
  private readonly waiters: { predicate: (f: Envelope) => boolean; resolve: (f: Envelope) => void }[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as Envelope;
      this.frames.push(frame);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i];
        if (waiter && waiter.predicate(frame)) {
          this.waiters.splice(i, 1);
          waiter.resolve(frame);
        }
      }
    });
  }

  static async connect(token: string, role: string): Promise<TestClient> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const client = new TestClient(socket);
    const snapshot = client.waitFor((f) => f.t === 'SNAPSHOT');
    client.send('HELLO', { token, role, clientVersion: 'test' });
    await snapshot;
    return client;
  }

  send(t: string, d: unknown, rid?: string): void {
    this.socket.send(JSON.stringify({ t, d, ts: Date.now(), ...(rid ? { rid } : {}) }));
  }

  waitFor(predicate: (f: Envelope) => boolean, timeoutMs = 5000): Promise<Envelope> {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for frame; saw: ${this.frames.map((f) => f.t).join(', ')}`)),
        timeoutMs,
      );
      this.waiters.push({
        predicate,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  waitForType(type: string, timeoutMs = 5000): Promise<Envelope> {
    return this.waitFor((f) => f.t === type, timeoutMs);
  }

  /** Send a command and wait for its ACK (or throw on ERROR). */
  async call(t: string, d: unknown): Promise<Envelope> {
    const rid = `rid${Math.random().toString(36).slice(2)}`;
    const reply = this.waitFor((f) => f.rid === rid);
    this.send(t, d, rid);
    const frame = await reply;
    if (frame.t === 'ERROR') {
      throw new Error(`${(frame.d as { code: string }).code}: ${(frame.d as { message: string }).message}`);
    }
    return frame;
  }

  types(): string[] {
    return this.frames.map((f) => f.t);
  }

  clear(): void {
    this.frames.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}

beforeAll(async () => {
  app = await createApp({
    dbFile: ':memory:',
    port: 0,
    organizerPasscode: '9999',
    serveClient: false,
    detectToolchain: false,
  });
  const { port } = await app.listen();
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
}, 30_000);

afterAll(async () => {
  await app.close();
});

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function get(path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* csv / plain text endpoints */
  }
  return { status: response.status, body: parsed, text };
}

describe('HTTP surface', () => {
  it('reports health without any internet dependency', async () => {
    const response = await get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, offline: true });
  });

  it('exposes LAN connection information for the podium (spec 40)', async () => {
    const response = await get('/api/connection');
    const info = response.body as { participantUrl: string; organizerUrl: string; projectorUrl: string };
    expect(info.organizerUrl).toMatch(/\/organizer$/);
    expect(info.projectorUrl).toMatch(/\/projector$/);
  });

  it('rejects a bad operator passcode and accepts the right one', async () => {
    expect((await post('/api/auth/organizer', { passcode: '0000' })).status).toBe(401);
    const ok = await post('/api/auth/organizer', { passcode: '9999' });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
  });

  it('refuses organizer endpoints without a token (spec 37)', async () => {
    expect((await get('/api/organizer/teams')).status).toBe(401);
    expect((await get('/api/export/results.csv')).status).toBe(401);
  });
});

describe('full LAN round over WebSocket', () => {
  let organizerToken: string;
  let organizer: TestClient;
  let projector: TestClient;

  it('authenticates the organizer and opens a socket', async () => {
    const login = await post('/api/auth/organizer', { passcode: '9999' });
    organizerToken = login.body.token as string;
    organizer = await TestClient.connect(organizerToken, 'organizer');
    const snapshot = organizer.frames.find((f) => f.t === 'SNAPSHOT')?.d as Snapshot;
    expect(snapshot.role).toBe('organizer');
    expect(snapshot.challengeIndex).toHaveLength(12);
    // The organizer console legitimately needs the printed keys.
    expect(snapshot.challengeIndex?.[0]?.accessKey).toBe('MKT-4417');
  });

  it('creates teams through the organizer socket', async () => {
    await organizer.call('CREATE_TEAMS', {
      teams: [
        { id: 'T01', name: 'CODEFORCE' },
        { id: 'T02', name: 'ALGO KINGS' },
        { id: 'T03', name: 'BYTE SQUAD' },
      ],
    });
    const teams = await get('/api/organizer/teams', organizerToken);
    expect(teams.body).toHaveLength(3);
    expect((teams.body as { joinCode: string }[])[0]?.joinCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('rejects a socket with no HELLO and with a forged token', async () => {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    const errors: string[] = [];
    socket.on('message', (raw) => errors.push(JSON.parse(String(raw)).t));
    socket.send(JSON.stringify({ t: 'START_GAME', d: {}, ts: Date.now() }));
    await new Promise((r) => setTimeout(r, 200));
    expect(errors).toContain('ERROR');
    socket.close();

    const forged = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => forged.once('open', () => resolve()));
    const closed = new Promise<void>((resolve) => forged.once('close', () => resolve()));
    forged.send(JSON.stringify({ t: 'HELLO', d: { token: 'nonsense.token', role: 'organizer' }, ts: Date.now() }));
    await closed;
  });

  it('lets a team log in with its printed join code and NOT another team code', async () => {
    const teams = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const t01 = teams.find((t) => t.id === 'T01') as { joinCode: string };

    const bad = await post('/api/auth/team', { joinCode: 'ZZZZZZ' });
    expect(bad.status).toBe(401);

    const good = await post('/api/auth/team', { joinCode: t01.joinCode });
    expect(good.status).toBe(200);
    expect(good.body.teamId).toBe('T01');

    // A token minted for T01 can never act as T02.
    const whoami = await get('/api/auth/whoami', good.body.token as string);
    expect(whoami.body).toMatchObject({ role: 'participant', teamId: 'T01' });
  });

  it('runs a market challenge end to end and pays out over the LAN', async () => {
    const teams = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const token = (await post('/api/auth/team', { joinCode: teams[0]?.joinCode })).body.token as string;
    const player = await TestClient.connect(token, 'participant');
    projector = await TestClient.connect(
      (await post('/api/auth/projector', {})).body.token as string,
      'projector',
    );

    await organizer.call('START_GAME', {});
    player.clear();
    await organizer.call('OPEN_CHALLENGE', { challengeId: 'C01' });

    const opened = await player.waitForType('CHALLENGE_OPENED');
    const preview = (opened.d as { challenge: { revealed: boolean; reward: number } }).challenge;
    expect(preview.revealed).toBe(false);
    expect(preview.reward).toBe(200);

    await player.call('UNLOCK_CHALLENGE', { challengeId: 'C01', accessKey: 'MKT-4417' });
    player.clear();
    await player.call('JOIN_CHALLENGE', { challengeId: 'C01' });

    const revealed = await player.waitForType('CHALLENGE_OPENED');
    const question = (revealed.d as { challenge: { revealed: boolean; question: { code: string } } })
      .challenge;
    expect(question.revealed).toBe(true);
    expect(question.question.code).toContain('a = [1, 2, 3, 4, 5]');

    const ack = await player.call('SUBMIT_ANSWER', {
      challengeId: 'C01',
      submission: { kind: 'text', value: '2 99 3' },
    });
    expect((ack.d as { data: { result: string; delta: number } }).data).toMatchObject({
      result: 'correct',
      delta: 200,
    });

    const leaderboard = await projector.waitFor(
      (f) => f.t === 'LEADERBOARD_UPDATED' && (f.d as { rows: { capital: number }[] }).rows.some((r) => r.capital === 1200),
    );
    expect(leaderboard).toBeTruthy();
    player.close();
  });

  it('never sends the answer key to a participant socket', async () => {
    const teams = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const token = (await post('/api/auth/team', { joinCode: teams[1]?.joinCode })).body.token as string;
    const player = await TestClient.connect(token, 'participant');
    await new Promise((r) => setTimeout(r, 150));
    const dump = JSON.stringify(player.frames);
    expect(dump).not.toContain('acceptedAnswers');
    expect(dump).not.toContain('MKT-4417');
    expect(dump).not.toContain('correctOptionIds');
    player.close();
  });

  it('refuses organizer commands from a participant socket', async () => {
    const teams = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const token = (await post('/api/auth/team', { joinCode: teams[2]?.joinCode })).body.token as string;
    const player = await TestClient.connect(token, 'participant');
    await expect(player.call('START_AUCTION', { challengeId: 'C04' })).rejects.toThrow(
      /unknown_command|forbidden/,
    );
    player.close();
  });

  it('restores full state on reconnect (spec 36)', async () => {
    const teams = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const t01 = teams.find((t) => t.id === 'T01') as { joinCode: string };
    const token = (await post('/api/auth/team', { joinCode: t01.joinCode })).body.token as string;

    // Reconnect with the SAME token after a "laptop lid closed" moment.
    const rejoined = await TestClient.connect(token, 'participant');
    const snapshot = rejoined.frames.find((f) => f.t === 'SNAPSHOT')?.d as Snapshot;
    expect(snapshot.me?.teamId).toBe('T01');
    expect(snapshot.me?.capital).toBe(1200);
    expect(snapshot.me?.rank).toBe(1);
    expect(snapshot.game.currentChallengeId).toBe('C01');
    expect(snapshot.leaderboard.length).toBe(3);
    // And an explicit resync returns the same authoritative state.
    rejoined.clear();
    await rejoined.call('REQUEST_CURRENT_STATE', {});
    const resync = rejoined.frames.find((f) => f.t === 'SNAPSHOT')?.d as Snapshot;
    expect(resync.me?.capital).toBe(1200);
    rejoined.close();
  });

  it('stamps a monotonic sequence on every broadcast', async () => {
    organizer.clear();
    await organizer.call('CLOSE_CHALLENGE', { challengeId: 'C01' });
    await new Promise((r) => setTimeout(r, 150));
    const seqs = organizer.frames.map((f) => f.seq).filter((s): s is number => typeof s === 'number');
    expect(seqs.length).toBeGreaterThan(0);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i] as number).toBeGreaterThan(seqs[i - 1] as number);
    }
  });

  it('drives a premium auction from the operator socket and authorises the winner', async () => {
    const teamRows = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const winnerRow = teamRows.find((t) => t.id === 'T01') as { joinCode: string };
    const winner = await TestClient.connect(
      (await post('/api/auth/team', { joinCode: winnerRow.joinCode })).body.token as string,
      'participant',
    );

    await organizer.call('OPEN_CHALLENGE', { challengeId: 'C04' });
    await organizer.call('START_AUCTION', { challengeId: 'C04' });
    await organizer.call('PLACE_BID', { teamId: 'T02' });
    await organizer.call('PLACE_BID', { teamId: 'T01' });

    projector.clear();
    winner.clear();
    await organizer.call('CLOSE_AUCTION', {});

    const sold = await projector.waitForType('AUCTION_WON');
    expect(sold.d).toMatchObject({ teamId: 'T01', amount: 400 });

    const unlocked = await winner.waitForType('CHALLENGE_UNLOCKED');
    expect(unlocked.d).toMatchObject({ teamId: 'T01', risk: 400 });

    await organizer.call('START_PREMIUM_ATTEMPT', {});
    const question = await winner.waitFor(
      (f) => f.t === 'CHALLENGE_OPENED' && (f.d as { challenge: { revealed: boolean } }).challenge.revealed,
    );
    expect((question.d as { challenge: { question: { items: unknown[] } } }).challenge.question.items)
      .toHaveLength(5);

    await winner.call('SUBMIT_ANSWER', {
      challengeId: 'C04',
      submission: { kind: 'order', itemIds: ['bsearch', 'linear', 'heapsort', 'quicksort', 'subsets'] },
    });
    await new Promise((r) => setTimeout(r, 200));

    const teams = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      capital: number;
    }[];
    expect(teams.find((t) => t.id === 'T01')?.capital).toBe(1600); // 1200 + 400
    winner.close();
  });

  it('exports results as CSV and JSON (spec 49)', async () => {
    const csv = await get('/api/export/results.csv', organizerToken);
    expect(csv.status).toBe(200);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe(
      'Rank,Team ID,Team,Starting Capital,Final Capital,Normal Attempted,Normal Correct,Premium Wins,Premium Attempts,Premium Correct,Premium Wrong,Total Profit/Loss,Qualification Status',
    );
    expect(lines).toHaveLength(4); // header + 3 teams
    expect(lines[1]).toContain('T01');
    expect(lines[1]).toContain('QUALIFIED');

    const json = await get('/api/export/results.json', organizerToken);
    const payload = json.body as { results: unknown[]; audit: unknown[]; transactions: unknown[] };
    expect(payload.results).toHaveLength(3);
    expect(payload.audit.length).toBeGreaterThan(5);
    expect(payload.transactions.length).toBeGreaterThan(3);

    const audit = await get('/api/export/audit.txt', organizerToken);
    expect(audit.text).toMatch(/AUCTION_WON/);
  });

  it('marks a team offline when its socket drops and online when it returns', async () => {
    const teamRows = (await get('/api/organizer/teams', organizerToken)).body as {
      id: string;
      joinCode: string;
    }[];
    const row = teamRows.find((t) => t.id === 'T03') as { joinCode: string };
    const token = (await post('/api/auth/team', { joinCode: row.joinCode })).body.token as string;

    organizer.clear();
    const player = await TestClient.connect(token, 'participant');
    await organizer.waitFor((f) => f.t === 'TEAM_CONNECTED' && (f.d as { teamId: string }).teamId === 'T03');

    organizer.clear();
    player.close();
    await organizer.waitFor(
      (f) => f.t === 'TEAM_DISCONNECTED' && (f.d as { teamId: string }).teamId === 'T03',
    );
  });
});
