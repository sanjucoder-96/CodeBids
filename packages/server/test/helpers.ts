import { openDatabase } from '../src/db/index.js';
import { Repo } from '../src/repo/index.js';
import { AuthService } from '../src/auth.js';
import { GameEngine, type EngineEvent } from '../src/core/engine.js';
import { CodeRunner } from '../src/core/codeRunner.js';
import { Simulator } from '../src/core/simulation.js';
import type { SubmissionValue } from '@code-market/shared';

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
  engine.seedChallenges();

  const events: EngineEvent[] = [];
  engine.on((event) => events.push(event));

  const simulator = new Simulator(engine);

  return {
    repo,
    engine,
    auth,
    simulator,
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

export function setCapital(h: Harness, teamId: string, value: number): void {
  const team = h.repo.getTeam(teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  h.repo.setTeamCapital(teamId, value);
  // Recompute the leaderboard through the public path.
  h.engine.updateTeam(teamId, {});
}

/** Correct / deliberately-wrong submission for any challenge in the pool. */
export function answerFor(
  h: Harness,
  challengeId: string,
  correct: boolean,
): SubmissionValue {
  const challenge = h.repo.getChallenge(challengeId);
  if (!challenge) throw new Error(`no challenge ${challengeId}`);
  const e = challenge.evaluation;
  switch (challenge.type) {
    case 'mcq': {
      const right = e.correctOptionIds?.[0] ?? 'a';
      const wrong = (challenge.question.options ?? []).find((o) => o.id !== right)?.id ?? 'zz';
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

/** Unlock + join + submit a market challenge in one step. */
export async function playMarket(
  h: Harness,
  teamId: string,
  challengeId: string,
  correct: boolean,
): Promise<void> {
  const challenge = h.repo.getChallenge(challengeId);
  if (!challenge) throw new Error(`no challenge ${challengeId}`);
  h.engine.unlockChallenge(teamId, challengeId, challenge.accessKey);
  h.engine.joinChallenge(teamId, challengeId);
  await h.engine.submitAnswer(teamId, challengeId, answerFor(h, challengeId, correct));
}

/** Run a premium auction to a decided winner. */
export function runAuction(
  h: Harness,
  challengeId: string,
  bids: [string, number?][],
): void {
  h.engine.openChallenge(challengeId);
  h.engine.startAuction(challengeId);
  for (const [teamId, amount] of bids) {
    h.engine.placeBid(teamId, amount);
  }
  h.engine.closeAuction();
}
