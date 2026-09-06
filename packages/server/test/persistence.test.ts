/**
 * Persistence and recovery (spec 20, 21): a restart must never re-roll the
 * sequence or lose an in-flight premium.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, backupDatabase } from '../src/db/index.js';
import { Repo } from '../src/repo/index.js';
import { AuthService } from '../src/auth.js';
import { GameEngine } from '../src/core/engine.js';
import { CodeRunner } from '../src/core/codeRunner.js';
import { answerFor, makeHarness, seedTeams, startRound, type Harness } from './helpers.js';
import type { Question } from '@code-market/shared';

const SECRET = 'persist-secret';
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-persist-'));
  dirs.push(dir);
  return dir;
}

function boot(file: string) {
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
  engine.seedQuestions();
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

describe('restart recovery', () => {
  it('keeps the SAME generated sequence across a restart', () => {
    const file = join(tempDir(), 'seq.db');

    let app = boot(file);
    app.engine.createTeams([{ id: 'T01', name: 'A' }, { id: 'T02', name: 'B' }]);
    app.engine.generateRound(987654);
    app.engine.startGame();
    const before = app.engine.sequence().map((s) => s.questionId);
    const seed = app.repo.getMeta('sequence_seed');
    app.close();

    app = boot(file);
    expect(app.repo.getMeta('sequence_seed')).toBe(seed);
    expect(app.engine.sequence().map((s) => s.questionId)).toEqual(before);
    // Re-running generation must not re-roll it.
    app.engine.generateRound();
    expect(app.engine.sequence().map((s) => s.questionId)).toEqual(before);
    app.close();
  });

  it('resumes mid-round with capital, slot and phase intact', async () => {
    const file = join(tempDir(), 'mid.db');

    let app = boot(file);
    app.engine.createTeams([
      { id: 'T01', name: 'A' },
      { id: 'T02', name: 'B' },
      { id: 'T03', name: 'C' },
    ]);
    app.engine.generateRound(31337);
    app.engine.startGame();
    app.engine.advance();
    app.engine.openQuestion();

    const slot = app.engine.currentSlot();
    const question = app.repo.getQuestion(slot?.questionId as string) as Question;
    app.engine.unlockQuestion('T01', question.id, question.accessKey);
    app.engine.joinQuestion('T01', question.id);
    await app.engine.submitAnswer('T01', question.id, answerFor(question, true));

    const capital = app.repo.getTeam('T01')?.capital as number;
    expect(capital).toBeGreaterThan(1000);
    app.close();

    app = boot(file);
    expect(app.repo.getTeam('T01')?.capital).toBe(capital);
    expect(app.engine.gameState().slotIndex).toBe(slot?.index);
    expect(app.engine.gameState().phase).toBe('question_active');
    expect(app.repo.listAttemptsForTeam('T01')).toHaveLength(1);
    expect(app.repo.getTeam('T01')?.connectionStatus).toBe('offline');
    app.close();
  });

  it('restores an in-flight reclaim offer', async () => {
    const file = join(tempDir(), 'reclaim.db');

    let app = boot(file);
    app.engine.createTeams([
      { id: 'T01', name: 'A' },
      { id: 'T02', name: 'B' },
      { id: 'T03', name: 'C' },
    ]);
    for (const id of ['T01', 'T02', 'T03']) app.engine.adjustCapital(id, 900, 'headroom');
    app.engine.generateRound(4242);
    app.engine.startGame();

    // Walk to the first premium.
    let slot = null;
    for (let i = 0; i < 8; i++) {
      app.engine.advance();
      slot = app.engine.currentSlot();
      if (slot?.kind === 'premium') break;
      app.engine.closeQuestion();
    }
    expect(slot?.kind).toBe('premium');

    app.engine.startAuction();
    app.engine.placeBid('T03', 300);
    app.engine.placeBid('T02', 400);
    app.engine.placeBid('T01', 500);
    app.engine.closeAuction();
    app.engine.startPremiumAttempt();
    app.engine.forcePremiumResult('wrong');

    const before = app.engine.currentPremium();
    expect(before?.stage).toBe('reclaim_offer');
    expect(before?.offerTeamId).toBe('T02');
    app.close();

    app = boot(file);
    const after = app.engine.currentPremium();
    expect(after?.stage).toBe('reclaim_offer');
    expect(after?.offerTeamId).toBe('T02');
    expect(after?.offerRisk).toBe(400);
    expect(after?.attemptNumber).toBe(1);
    // Still resolvable after the restart.
    app.engine.resolveReclaim('T02', true);
    expect(app.engine.currentPremium()?.activeTeamId).toBe('T02');
    app.close();
  });

  it('keeps the premium window across a restart', () => {
    const file = join(tempDir(), 'window.db');
    let app = boot(file);
    app.engine.createTeams([{ id: 'T01', name: 'A' }, { id: 'T02', name: 'B' }]);
    app.engine.generateRound(777);
    app.engine.startGame();
    for (let i = 0; i < 8; i++) {
      app.engine.advance();
      if (app.engine.currentSlot()?.kind === 'premium') break;
      app.engine.closeQuestion();
    }
    const windowEnd = app.engine.currentPremium()?.windowEndsAt;
    expect(windowEnd).toBeGreaterThan(Date.now());
    app.close();

    app = boot(file);
    expect(app.engine.currentPremium()?.windowEndsAt).toBe(windowEnd);
    app.close();
  });

  it('keeps the final results after a restart', () => {
    const file = join(tempDir(), 'podium.db');
    let app = boot(file);
    app.engine.createTeams([
      { id: 'T01', name: 'A' },
      { id: 'T02', name: 'B' },
      { id: 'T03', name: 'C' },
    ]);
    app.engine.generateRound(1);
    app.engine.startGame();
    app.engine.adjustCapital('T02', 800, 'spread');
    const podium = app.engine.completeGame();
    app.close();

    app = boot(file);
    expect(app.repo.listFinalResults()).toEqual(podium);
    expect(app.engine.podium()[0]?.teamId).toBe('T02');
    app.close();
  });

  it('keeps session tokens valid across a restart', () => {
    const file = join(tempDir(), 'sessions.db');
    let app = boot(file);
    app.engine.createTeams([{ id: 'T01', name: 'A' }]);
    const code = app.repo.getJoinCode('T01') as string;
    const session = new AuthService(app.repo, SECRET, '1234').loginTeam(code);
    expect(session).not.toBeNull();
    app.close();

    app = boot(file);
    const identity = new AuthService(app.repo, SECRET, '1234').verify(session?.token as string);
    expect(identity).toMatchObject({ role: 'participant', teamId: 'T01' });
    app.close();
  });

  it('creates a restorable backup', () => {
    const dir = tempDir();
    const file = join(dir, 'src.db');
    const app = boot(file);
    app.engine.createTeams([{ id: 'T01', name: 'A' }]);
    app.engine.adjustCapital('T01', 500, 'test');

    const db = openDatabase({ file });
    const target = backupDatabase(db, file, join(dir, 'backups'));
    db.close();
    app.close();

    expect(existsSync(target)).toBe(true);
    const restored = boot(target);
    expect(restored.repo.getTeam('T01')?.capital).toBe(1500);
    restored.close();
  });
});

describe('reset', () => {
  let h: Harness;
  afterEach(() => h?.close());

  it('clears the sequence and game data but keeps teams', async () => {
    h = makeHarness();
    startRound(h, 3);
    h.engine.advance();
    h.engine.openQuestion();
    const question = h.repo.getQuestion(
      h.engine.currentSlot()?.questionId as string,
    ) as Question;
    h.engine.unlockQuestion('T01', question.id, question.accessKey);
    h.engine.joinQuestion('T01', question.id);
    await h.engine.submitAnswer('T01', question.id, answerFor(question, true));

    h.engine.resetGame(true);

    expect(h.repo.listTeams()).toHaveLength(3);
    expect(h.repo.getTeam('T01')?.capital).toBe(1000);
    expect(h.repo.listAttempts()).toHaveLength(0);
    expect(h.repo.listSequence()).toHaveLength(0);
    expect(h.engine.gameState().phase).toBe('idle');
    expect(h.engine.gameState().slotIndex).toBe(0);
  });

  it('can wipe teams entirely', () => {
    h = makeHarness();
    seedTeams(h, 3);
    h.engine.resetGame(false);
    expect(h.repo.listTeams()).toHaveLength(0);
  });
});

describe('ledger integrity', () => {
  let h: Harness;
  afterEach(() => h?.close());

  it('every team capital equals the sum of its transactions', async () => {
    h = makeHarness();
    startRound(h, 5);
    for (let block = 0; block < 2; block++) {
      h.engine.advance();
      const slot = h.engine.currentSlot();
      if (!slot) break;
      if (slot.kind === 'normal') {
        h.engine.openQuestion();
        const question = h.repo.getQuestion(slot.questionId) as Question;
        for (const id of ['T01', 'T02', 'T03']) {
          h.engine.unlockQuestion(id, question.id, question.accessKey);
          h.engine.joinQuestion(id, question.id);
          await h.engine.submitAnswer(id, question.id, answerFor(question, id !== 'T02'));
        }
        h.engine.closeQuestion();
      }
    }

    for (const team of h.repo.listTeams()) {
      const txs = h.repo.listTransactionsForTeam(team.id);
      const sum = txs.reduce((total, t) => total + t.amount, 0);
      expect(sum, `${team.id} ledger`).toBe(team.capital);
      let running = 0;
      for (const tx of txs) {
        running += tx.amount;
        expect(tx.balanceAfter).toBe(running);
      }
    }
  });

  it('never lets capital fall below the floor', async () => {
    h = makeHarness();
    startRound(h, 3);
    for (let i = 0; i < 10; i++) h.engine.adjustCapital('T01', -500, 'drain');
    expect(h.repo.getTeam('T01')?.capital).toBe(0);
  });
});
