import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerFor, capital, makeHarness, playMarket, seedTeams, type Harness } from './helpers.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
  seedTeams(h, 6);
  h.engine.startGame();
});

afterEach(() => h.close());

describe('market challenge flow (spec 9, 10)', () => {
  it('starts every team on equal capital and records the opening transaction', () => {
    expect(capital(h, 'T01')).toBe(1000);
    expect(capital(h, 'T06')).toBe(1000);
    const txs = h.repo.listTransactions().filter((t) => t.type === 'initial');
    expect(txs).toHaveLength(6);
  });

  it('rejects a wrong access key and accepts the right one', () => {
    h.engine.openChallenge('C01');
    expect(() => h.engine.unlockChallenge('T01', 'C01', 'WRONG-KEY')).toThrow(/Incorrect/);
    expect(() => h.engine.unlockChallenge('T01', 'C01', 'MKT-4417')).not.toThrow();
  });

  it('accepts the access key case-insensitively and with stray spaces', () => {
    h.engine.openChallenge('C01');
    expect(() => h.engine.unlockChallenge('T01', 'C01', '  mkt-4417 ')).not.toThrow();
  });

  it('will not let a team join before unlocking', () => {
    h.engine.openChallenge('C01');
    expect(() => h.engine.joinChallenge('T01', 'C01')).toThrow(/key/);
  });

  it('withholds the question until the team joins', () => {
    h.engine.openChallenge('C01');
    const opened = h.eventsOf<{ challenge: { revealed: boolean; question: { prompt: string } } }>(
      'CHALLENGE_OPENED',
    );
    expect(opened[0]?.challenge.revealed).toBe(false);
    expect(opened[0]?.challenge.question.prompt).toBe('');

    h.engine.unlockChallenge('T01', 'C01', 'MKT-4417');
    h.clearEvents();
    h.engine.joinChallenge('T01', 'C01');
    const revealed = h.eventsOf<{ challenge: { revealed: boolean; question: { prompt: string } } }>(
      'CHALLENGE_OPENED',
    );
    expect(revealed[0]?.challenge.revealed).toBe(true);
    expect(revealed[0]?.challenge.question.prompt.length).toBeGreaterThan(10);
  });

  it('never sends the evaluation data to a participant', () => {
    h.engine.openChallenge('C01');
    h.engine.unlockChallenge('T01', 'C01', 'MKT-4417');
    h.engine.joinChallenge('T01', 'C01');
    const payloads = h.eventsOf<Record<string, unknown>>('CHALLENGE_OPENED');
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain('acceptedAnswers');
      expect(JSON.stringify(payload)).not.toContain('2 99 3');
    }
  });

  it('rewards a correct answer and updates capital', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T01', 'C01', true);
    expect(capital(h, 'T01')).toBe(1200); // easy: base 200 x 1.0
  });

  it('penalises a wrong answer', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T02', 'C01', false);
    expect(capital(h, 'T02')).toBe(900);
  });

  it('scales the reward by difficulty', async () => {
    h.engine.openChallenge('C03'); // medium
    await playMarket(h, 'T01', 'C03', true);
    expect(capital(h, 'T01')).toBe(1300);
  });

  it('charges nothing for a skip and records it as an attempt', async () => {
    h.engine.openChallenge('C01');
    h.engine.skipChallenge('T03', 'C01');
    expect(capital(h, 'T03')).toBe(1000);
    const attempts = h.repo.listAttemptsForTeam('T03');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('skipped');
  });

  it('rejects a duplicate submission (spec 50)', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T01', 'C01', true);
    await expect(
      h.engine.submitAnswer('T01', 'C01', answerFor(h, 'C01', true)),
    ).rejects.toThrow(/already submitted/);
    expect(capital(h, 'T01')).toBe(1200);
  });

  it('rejects a second unlock after the challenge was attempted', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T01', 'C01', true);
    expect(() => h.engine.unlockChallenge('T01', 'C01', 'MKT-4417')).toThrow(/already attempted/);
  });

  it('rejects a submission for a challenge that is not open', async () => {
    h.engine.openChallenge('C01');
    await expect(
      h.engine.submitAnswer('T01', 'C02', answerFor(h, 'C02', true)),
    ).rejects.toThrow(/not currently open/);
  });

  it('rejects a submission from a team that never joined', async () => {
    h.engine.openChallenge('C01');
    await expect(
      h.engine.submitAnswer('T05', 'C01', answerFor(h, 'C01', true)),
    ).rejects.toThrow(/not currently attempting/);
  });

  it('rejects actions while the round is paused', async () => {
    h.engine.openChallenge('C01');
    h.engine.unlockChallenge('T01', 'C01', 'MKT-4417');
    h.engine.pauseGame();
    expect(() => h.engine.joinChallenge('T01', 'C01')).toThrow(/paused/);
    h.engine.resumeGame();
    expect(() => h.engine.joinChallenge('T01', 'C01')).not.toThrow();
  });

  it('resolves everyone still mid-attempt as a timeout when the challenge closes', async () => {
    h.engine.openChallenge('C01');
    h.engine.unlockChallenge('T04', 'C01', 'MKT-4417');
    h.engine.joinChallenge('T04', 'C01');
    h.engine.closeChallenge('C01');

    const attempts = h.repo.listAttemptsForTeam('T04');
    expect(attempts[0]?.result).toBe('timeout');
    expect(capital(h, 'T04')).toBe(900);
  });

  it('fires a per-team deadline timeout', async () => {
    h.engine.openChallenge('C01');
    h.engine.unlockChallenge('T04', 'C01', 'MKT-4417');
    h.engine.joinChallenge('T04', 'C01');
    expect(h.engine.fireTimer('deadline:T04:C01')).toBe(true);
    expect(h.repo.listAttemptsForTeam('T04')[0]?.result).toBe('timeout');
  });

  it('rejects a submission that arrives after the deadline', async () => {
    const late = makeHarness();
    try {
      seedTeams(late, 2);
      late.engine.startGame();
      late.engine.openChallenge('C01');
      late.engine.unlockChallenge('T01', 'C01', 'MKT-4417');
      late.engine.joinChallenge('T01', 'C01');
      // C01 has a 90s limit; simulate a submission 5 minutes later.
      const original = late.repo.getParticipation('T01', 'C01');
      expect(original?.state).toBe('in_progress');
      // Rewind joined_at by 5 minutes through a direct repo write.
      (late.repo as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
        .prepare('UPDATE participation SET joined_at = ? WHERE team_id = ? AND challenge_id = ?')
        .run(Date.now() - 300_000, 'T01', 'C01');

      const result = await late.engine.submitAnswer('T01', 'C01', answerFor(late, 'C01', true));
      expect(result.result).toBe('timeout');
      expect(late.repo.getTeam('T01')?.capital).toBe(900);
    } finally {
      late.close();
    }
  });

  it('leaves the leaderboard correctly ordered after a mixed round', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T01', 'C01', true);
    await playMarket(h, 'T02', 'C01', false);
    await playMarket(h, 'T03', 'C01', true);
    const rows = h.engine.leaderboard();
    expect(rows[0]?.capital).toBe(1200);
    expect(rows.at(-1)?.teamId).toBe('T02');
    expect(rows.at(-1)?.capital).toBe(900);
  });

  it('logs every capital change to the transaction ledger', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T01', 'C01', true);
    const txs = h.repo.listTransactions().filter((t) => t.teamId === 'T01');
    expect(txs.map((t) => t.type)).toEqual(['initial', 'market_reward']);
    expect(txs.at(-1)).toMatchObject({ amount: 200, balanceAfter: 1200, challengeId: 'C01' });
  });

  it('writes an audit trail for the whole attempt', async () => {
    h.engine.openChallenge('C01');
    await playMarket(h, 'T01', 'C01', true);
    const actions = h.engine.listAudit().map((a) => a.action);
    expect(actions).toContain('CHALLENGE_OPENED');
    expect(actions).toContain('CHALLENGE_UNLOCKED');
    expect(actions).toContain('CHALLENGE_JOINED');
    expect(actions).toContain('CHALLENGE_RESULT');
    expect(actions).toContain('CAPITAL_CHANGED');
  });

  it('supports every question type in the pool', async () => {
    const types = new Set(h.engine.listChallenges().map((c) => c.type));
    expect(types.size).toBeGreaterThanOrEqual(6);

    for (const challenge of h.engine.listChallenges()) {
      if (challenge.marketType !== 'market') continue;
      const fresh = makeHarness();
      try {
        seedTeams(fresh, 1);
        fresh.engine.startGame();
        fresh.engine.openChallenge(challenge.id);
        await playMarket(fresh, 'T01', challenge.id, true);
        expect(
          fresh.repo.listAttemptsForTeam('T01')[0]?.result,
          `${challenge.id} (${challenge.type}) should accept its own correct answer`,
        ).toBe('correct');
      } finally {
        fresh.close();
      }
    }
  });

  it('marks a deliberately wrong answer wrong for every market type', async () => {
    for (const challenge of h.engine.listChallenges()) {
      if (challenge.marketType !== 'market') continue;
      const fresh = makeHarness();
      try {
        seedTeams(fresh, 1);
        fresh.engine.startGame();
        fresh.engine.openChallenge(challenge.id);
        await playMarket(fresh, 'T01', challenge.id, false);
        expect(
          fresh.repo.listAttemptsForTeam('T01')[0]?.result,
          `${challenge.id} should reject a wrong answer`,
        ).toBe('wrong');
      } finally {
        fresh.close();
      }
    }
  });
});

describe('challenge pool integrity (spec 5)', () => {
  it('has exactly 12 challenges in the fixed sequence', () => {
    const challenges = h.engine.listChallenges();
    expect(challenges).toHaveLength(12);
    expect(challenges.map((c) => c.marketType)).toEqual([
      'market',
      'market',
      'market',
      'premium',
      'market',
      'market',
      'premium',
      'market',
      'market',
      'premium',
      'market',
      'final_premium',
    ]);
  });

  it('has 8 market, 3 premium and 1 final premium', () => {
    const challenges = h.engine.listChallenges();
    expect(challenges.filter((c) => c.marketType === 'market')).toHaveLength(8);
    expect(challenges.filter((c) => c.marketType === 'premium')).toHaveLength(3);
    expect(challenges.filter((c) => c.marketType === 'final_premium')).toHaveLength(1);
  });

  it('gives every challenge a unique access key and index', () => {
    const challenges = h.engine.listChallenges();
    expect(new Set(challenges.map((c) => c.accessKey)).size).toBe(12);
    expect(new Set(challenges.map((c) => c.index)).size).toBe(12);
    expect(challenges.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('gives every challenge usable evaluation data for its type', () => {
    for (const c of h.engine.listChallenges()) {
      const e = c.evaluation;
      switch (c.type) {
        case 'mcq':
          expect(e.correctOptionIds?.length, c.id).toBe(1);
          expect(c.question.options?.some((o) => o.id === e.correctOptionIds?.[0]), c.id).toBe(true);
          break;
        case 'multi':
          expect(e.correctOptionIds?.length, c.id).toBeGreaterThan(1);
          break;
        case 'true_false':
          expect(typeof e.correctBoolean, c.id).toBe('boolean');
          break;
        case 'numeric':
          expect(typeof e.correctNumber, c.id).toBe('number');
          break;
        case 'ordering':
          expect(e.correctOrder?.length, c.id).toBe(c.question.items?.length);
          break;
        case 'matching':
          expect(Object.keys(e.correctPairs ?? {}).length, c.id).toBe(c.question.left?.length);
          break;
        default:
          expect((e.acceptedAnswers?.length ?? 0) > 0, c.id).toBe(true);
      }
      expect(e.explanation, `${c.id} needs an explanation`).toBeTruthy();
    }
  });

  it('gives every premium a longer clock than a market challenge', () => {
    const challenges = h.engine.listChallenges();
    const marketMax = Math.max(...challenges.filter((c) => c.marketType === 'market').map((c) => c.timeLimit));
    const premiumMin = Math.min(
      ...challenges.filter((c) => c.marketType !== 'market').map((c) => c.timeLimit),
    );
    expect(premiumMin).toBeGreaterThanOrEqual(marketMax);
  });
});
