import { openDatabase } from '../src/db/index.js';
import { Repo } from '../src/repo/index.js';
import { AuthService } from '../src/auth.js';
import { GameEngine, type EngineEvent } from '../src/core/engine.js';
import { CodeRunner } from '../src/core/codeRunner.js';
import { Simulator } from '../src/core/simulation.js';
import type { Question, SequenceSlot, SubmissionValue } from '@code-market/shared';

export interface Harness {
  repo: Repo;
  engine: GameEngine;
  auth: AuthService;
  simulator: Simulator;
  events: EngineEvent[];
  eventNames(): string[];
  eventsOf<T = unknown>(name: string): T[];
  lastEvent<T = unknown>(name: string): T | undefined;
  clearEvents(): void;
  close(): void;
}

const SECRET = 'test-secret-0123456789abcdef';

export function makeHarness(options: { passcode?: string } = {}): Harness {
  const db = openDatabase({ file: ':memory:' });
  const repo = new Repo(db);
  repo.setMeta('secret', SECRET);
  const auth = new AuthService(repo, SECRET, options.passcode ?? '1234');
  const runner = new CodeRunner({ python: null, cpp: null, java: null });
  const engine = new GameEngine({ repo, auth, secret: SECRET, runner });
  engine.seedQuestions();

  const events: EngineEvent[] = [];
  engine.on((event) => events.push(event));

  return {
    repo,
    engine,
    auth,
    simulator: new Simulator(engine),
    events,
    eventNames: () => events.map((e) => e.name),
    eventsOf<T>(name: string) {
      return events.filter((e) => e.name === name).map((e) => e.payload as T);
    },
    lastEvent<T>(name: string) {
      const matching = events.filter((e) => e.name === name);
      return matching[matching.length - 1]?.payload as T | undefined;
    },
    clearEvents: () => {
      events.length = 0;
    },
    close: () => {
      engine.dispose();
      db.close();
    },
  };
}

/** Seed N teams with deterministic ids T01..TNN. */
export function seedTeams(h: Harness, count: number): string[] {
  const specs = Array.from({ length: count }, (_, i) => ({
    id: `T${String(i + 1).padStart(2, '0')}`,
    name: `TEAM ${i + 1}`,
  }));
  h.engine.createTeams(specs);
  return specs.map((s) => s.id);
}

export function capital(h: Harness, teamId: string): number {
  return h.repo.getTeam(teamId)?.capital ?? -1;
}

/** Start a round with a fixed seed so the sequence is reproducible. */
export function startRound(h: Harness, teams = 6, seed = 20260901): string[] {
  const ids = seedTeams(h, teams);
  h.engine.generateRound(seed);
  h.engine.startGame();
  return ids;
}

export function sequence(h: Harness): SequenceSlot[] {
  return h.engine.sequence();
}

/** Advance until the current slot matches the predicate. */
export function advanceTo(h: Harness, predicate: (slot: SequenceSlot) => boolean): SequenceSlot {
  for (let i = 0; i < 60; i++) {
    h.engine.advance();
    const slot = h.engine.currentSlot();
    if (slot && predicate(slot)) return slot;
    if (!slot) break;
    // Settle whatever we skipped past so the engine stays consistent.
    if (slot.kind === 'normal') h.engine.closeQuestion();
    else h.engine.closePremium();
  }
  throw new Error('No matching slot found');
}

/** Advance to the first normal question and open it for answering. */
export function openFirstQuestion(h: Harness): { slot: SequenceSlot; question: Question } {
  const slot = advanceTo(h, (s) => s.kind === 'normal');
  h.engine.openQuestion();
  return { slot, question: h.repo.getQuestion(slot.questionId) as Question };
}

/** Advance to the first premium slot. */
export function openFirstPremium(h: Harness): { slot: SequenceSlot; question: Question } {
  const slot = advanceTo(h, (s) => s.kind === 'premium');
  return { slot, question: h.repo.getQuestion(slot.questionId) as Question };
}

/** Correct / deliberately-wrong submission for any question in the pool. */
export function answerFor(question: Question, correct: boolean): SubmissionValue {
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
      return { kind: 'number', value: correct ? (e.correctNumber ?? 0) : (e.correctNumber ?? 0) + 99 };
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

/** Unlock + join + submit the currently open question in one step. */
export async function play(
  h: Harness,
  teamId: string,
  question: Question,
  correct: boolean,
): Promise<void> {
  h.engine.unlockQuestion(teamId, question.id, question.accessKey);
  h.engine.joinQuestion(teamId, question.id);
  await h.engine.submitAnswer(teamId, question.id, answerFor(question, correct));
}

/** Run a premium auction to a decided winner. */
export function runAuction(h: Harness, bids: [string, number?][]): void {
  h.engine.startAuction();
  for (const [teamId, amount] of bids) h.engine.placeBid(teamId, amount);
  h.engine.closeAuction();
}
