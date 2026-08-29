import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, backupDatabase } from '../src/db/index.js';
import { Repo } from '../src/repo/index.js';
import { AuthService } from '../src/auth.js';
import { GameEngine } from '../src/core/engine.js';
import { CodeRunner } from '../src/core/codeRunner.js';
import { answerFor, makeHarness, seedTeams, type Harness } from './helpers.js';

const SECRET = 'persist-secret';
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-persist-'));
  dirs.push(dir);
  return dir;
}

function bootEngine(file: string): { engine: GameEngine; repo: Repo; close: () => void } {
  const db = openDatabase({ file });
  const repo = new Repo(db);
  repo.setMeta('secret', SECRET);
  const auth = new AuthService(repo, SECRET, '1234');
  const engine = new GameEngine({
    repo,
    auth,
    secret: SECRET,
    runner: new CodeRunner({ python: null, cpp: null, java: null }),
  });
  engine.seedChallenges();
  engine.restoreTimers();
  return {
    engine,
    repo,
    close: () => {
      engine.dispose();
      db.close();
    },
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('database persistence (spec 36, 52)', () => {
  it('survives a full server restart mid-round', async () => {
    const file = join(tempDir(), 'event.db');

    // --- first boot: play part of the round -------------------------------
    let boot = bootEngine(file);
    boot.engine.createTeams([
      { id: 'T01', name: 'ALPHA' },
      { id: 'T02', name: 'BETA' },
      { id: 'T03', name: 'GAMMA' },
    ]);
    boot.engine.startGame();
    boot.engine.openChallenge('C01');
    const challenge = boot.repo.getChallenge('C01');
    boot.engine.unlockChallenge('T01', 'C01', challenge?.accessKey ?? '');
    boot.engine.joinChallenge('T01', 'C01');
    await boot.engine.submitAnswer('T01', 'C01', {
      kind: 'text',
      value: challenge?.evaluation.acceptedAnswers?.[0] ?? '',
    });
    expect(boot.repo.getTeam('T01')?.capital).toBe(1200);
    boot.close();

    // --- second boot: everything is exactly where it was ------------------
    boot = bootEngine(file);
    expect(boot.repo.getTeam('T01')?.capital).toBe(1200);
    expect(boot.repo.getTeam('T02')?.capital).toBe(1000);
    expect(boot.engine.gameState().currentChallengeId).toBe('C01');
    expect(boot.repo.listAttemptsForTeam('T01')).toHaveLength(1);
    expect(boot.engine.leaderboard()[0]?.teamId).toBe('T01');
    // Connection flags are reset so nobody shows as a ghost.
    expect(boot.repo.getTeam('T01')?.connectionStatus).toBe('offline');
    boot.close();
  });

  it('restores an in-flight premium reclaim across a restart', async () => {
    const file = join(tempDir(), 'premium.db');

    let boot = bootEngine(file);
    boot.engine.createTeams([
      { id: 'T01', name: 'A' },
      { id: 'T02', name: 'B' },
      { id: 'T03', name: 'C' },
    ]);
    for (const id of ['T01', 'T02', 'T03']) boot.engine.adjustCapital(id, 800, 'headroom');
    boot.engine.startGame();
    boot.engine.openChallenge('C04');
    boot.engine.startAuction('C04');
    boot.engine.placeBid('T03', 300);
    boot.engine.placeBid('T02', 400);
    boot.engine.placeBid('T01', 500);
    boot.engine.closeAuction();
    boot.engine.startPremiumAttempt();
    const c04 = boot.repo.getChallenge('C04');
    await boot.engine.submitAnswer('T01', 'C04', {
      kind: 'order',
      itemIds: [...(c04?.evaluation.correctOrder ?? [])].reverse(),
    });

    const before = boot.engine.currentPremium();
    expect(before?.stage).toBe('reclaim_offer');
    expect(before?.offerTeamId).toBe('T02');
    boot.close();

    boot = bootEngine(file);
    const after = boot.engine.currentPremium();
    expect(after?.stage).toBe('reclaim_offer');
    expect(after?.offerTeamId).toBe('T02');
    expect(after?.offerRisk).toBe(400);
    expect(after?.ladder.map((e) => e.teamId)).toEqual(['T01', 'T02', 'T03']);
    expect(after?.attemptNumber).toBe(1);
    // The offer can still be resolved after the restart.
    boot.engine.resolveReclaim('T02', true);
    expect(boot.engine.currentPremium()?.activeTeamId).toBe('T02');
    boot.close();
  });

  it('keeps the whole transaction ledger and audit log', async () => {
    const file = join(tempDir(), 'ledger.db');
    let boot = bootEngine(file);
    boot.engine.createTeams([{ id: 'T01', name: 'A' }]);
    boot.engine.adjustCapital('T01', 250, 'bonus');
    boot.engine.adjustCapital('T01', -100, 'correction');
    const txCount = boot.repo.listTransactions().length;
    const auditCount = boot.engine.listAudit().length;
    boot.close();

    boot = bootEngine(file);
    expect(boot.repo.listTransactions()).toHaveLength(txCount);
    expect(boot.engine.listAudit().length).toBeGreaterThanOrEqual(auditCount);
    expect(boot.repo.getTeam('T01')?.capital).toBe(1150);
    boot.close();
  });

  it('creates a restorable backup file', () => {
    const dir = tempDir();
    const file = join(dir, 'backup-source.db');
    const boot = bootEngine(file);
    boot.engine.createTeams([{ id: 'T01', name: 'A' }]);
    boot.engine.adjustCapital('T01', 500, 'test');

    const db = openDatabase({ file });
    const target = backupDatabase(db, file, join(dir, 'backups'));
    db.close();
    boot.close();

    expect(existsSync(target)).toBe(true);

    const restored = bootEngine(target);
    expect(restored.repo.getTeam('T01')?.capital).toBe(1500);
    restored.close();
  });

  it('keeps session tokens valid across a restart', () => {
    const file = join(tempDir(), 'sessions.db');
    let boot = bootEngine(file);
    boot.engine.createTeams([{ id: 'T01', name: 'A' }]);
    const code = boot.repo.getJoinCode('T01') as string;
    const auth1 = new AuthService(boot.repo, SECRET, '1234');
    const session = auth1.loginTeam(code);
    expect(session).not.toBeNull();
    boot.close();

    boot = bootEngine(file);
    const auth2 = new AuthService(boot.repo, SECRET, '1234');
    const identity = auth2.verify(session?.token as string);
    expect(identity).toMatchObject({ role: 'participant', teamId: 'T01' });
    boot.close();
  });
});

describe('reset (spec 52)', () => {
  let h: Harness;
  afterEach(() => h?.close());

  it('clears game data but keeps teams and restores starting capital', async () => {
    h = makeHarness();
    seedTeams(h, 3);
    h.engine.startGame();
    h.engine.openChallenge('C01');
    h.engine.unlockChallenge('T01', 'C01', 'MKT-4417');
    h.engine.joinChallenge('T01', 'C01');
    await h.engine.submitAnswer('T01', 'C01', answerFor(h, 'C01', true));
    expect(h.repo.getTeam('T01')?.capital).toBe(1200);

    h.engine.resetGame(true);

    expect(h.repo.listTeams()).toHaveLength(3);
    expect(h.repo.getTeam('T01')?.capital).toBe(1000);
    expect(h.repo.listAttempts()).toHaveLength(0);
    expect(h.engine.gameState().phase).toBe('lobby');
    expect(h.engine.gameState().currentChallengeId).toBeNull();
  });

  it('can wipe teams entirely', () => {
    h = makeHarness();
    seedTeams(h, 3);
    h.engine.resetGame(false);
    expect(h.repo.listTeams()).toHaveLength(0);
    expect(h.engine.leaderboard()).toHaveLength(0);
  });
});
