/**
 * Simulation / rehearsal mode against the new block structure.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceTo, makeHarness, startRound, type Harness } from './helpers.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(() => h.close());

describe('simulation', () => {
  it('seeds teams with distinct join codes', () => {
    h.simulator.seedTeams(20, false);
    const codes = h.repo.listTeams().map((t) => h.repo.getJoinCode(t.id));
    expect(codes).toHaveLength(20);
    expect(new Set(codes).size).toBe(20);
  });

  it('plays the open question through the real engine paths', async () => {
    startRound(h, 10);
    h.engine.advance();
    const result = await h.simulator.run('question');
    expect(result.actions).toBeGreaterThan(5);
    expect(h.repo.listAttempts().length).toBeGreaterThan(5);
  }, 30_000);

  it('drives a complete premium auction with a winner', async () => {
    startRound(h, 10);
    for (let i = 1; i <= 6; i++) h.engine.adjustCapital(`T0${i}`, 900, 'headroom');
    const slot = advanceTo(h, (s) => s.kind === 'premium');
    await h.simulator.run('premium_auction');

    const auction = h.repo.getAuctionForSlot(slot.index);
    expect(auction?.status).toBe('closed');
    expect(auction?.winnerTeamId).toBeTruthy();
  }, 40_000);

  it('forces a reclaim chain', async () => {
    startRound(h, 10);
    for (let i = 1; i <= 6; i++) h.engine.adjustCapital(`T0${i}`, 900, 'headroom');
    advanceTo(h, (s) => s.kind === 'premium');
    const result = await h.simulator.run('reclaim_chain');
    expect(result.notes.some((n) => n.includes('attempt 1 FAILED'))).toBe(true);
    expect(h.eventsOf('PREMIUM_ATTEMPT_FAILED').length).toBeGreaterThanOrEqual(1);
  }, 40_000);

  it('produces a genuine multi-place rank climb', async () => {
    h.simulator.seedTeams(12, false);
    h.repo.listTeams().forEach((team, index) => h.engine.adjustCapital(team.id, index * 100, 'spread'));
    const climber = h.engine.leaderboard().at(-1)?.teamId as string;
    expect(h.engine.leaderboard().find((r) => r.teamId === climber)?.rank).toBe(12);

    await h.simulator.run('rank_swap', 2);
    expect(h.engine.leaderboard().find((r) => r.teamId === climber)?.rank).toBe(1);
    expect(h.eventsOf('LEADERBOARD_UPDATED').length).toBeGreaterThan(4);
  }, 40_000);

  it('chaos mode never corrupts the board', async () => {
    h.simulator.seedTeams(16, false);
    await h.simulator.run('chaos', 1.5);
    const rows = h.engine.leaderboard();
    expect(rows).toHaveLength(16);
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(16);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.capital).toBeLessThanOrEqual(rows[i - 1]!.capital);
    }
    expect(rows.every((r) => r.capital >= 0)).toBe(true);
  }, 60_000);

  it('runs a full round end to end', async () => {
    h.simulator.seedTeams(8, false);
    const result = await h.simulator.run('full_round');
    expect(result.actions).toBeGreaterThan(20);
    expect(h.engine.gameState().phase).toBe('final_results');
    expect(h.engine.podium().length).toBeGreaterThan(0);
    // Every premium respected the two-attempt cap.
    for (const state of h.repo.listPremiumStates()) {
      expect(state.attemptNumber).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  it('refuses two simultaneous runs and unknown scenarios', async () => {
    h.simulator.seedTeams(6, false);
    const first = h.simulator.run('chaos', 1);
    await expect(h.simulator.run('chaos', 1)).rejects.toThrow(/already running/);
    h.simulator.stop();
    await first;
    await expect(h.simulator.run('nope')).rejects.toThrow(/Unknown scenario/);
  }, 60_000);
});

describe('config validation', () => {
  it('rejects invalid values and keeps the previous ones', () => {
    const h2 = makeHarness();
    try {
      const result = h2.engine.updateConfig({ blocks: 0, strategyWindowSeconds: -5 });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBe(2);
      expect(h2.engine.getConfig().blocks).toBe(4);
      expect(h2.engine.getConfig().strategyWindowSeconds).toBe(40);
    } finally {
      h2.close();
    }
  });

  it('persists a valid change', () => {
    const h2 = makeHarness();
    try {
      h2.engine.updateConfig({ blocks: 5, hideLeaderboardLastQuestions: 6 });
      const reloaded = h2.repo.loadConfig();
      expect(reloaded.blocks).toBe(5);
      expect(reloaded.hideLeaderboardLastQuestions).toBe(6);
    } finally {
      h2.close();
    }
  });
});
