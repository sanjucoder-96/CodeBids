import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, seedTeams, type Harness } from './helpers.js';
import { exportCsv, exportJson, buildResultRows } from '../src/export.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(() => h.close());

describe('simulation mode (spec 42)', () => {
  it('seeds any requested number of teams with distinct join codes', () => {
    h.simulator.seedTeams(30, false);
    const teams = h.repo.listTeams();
    expect(teams).toHaveLength(30);
    const codes = teams.map((t) => h.repo.getJoinCode(t.id));
    expect(new Set(codes).size).toBe(30);
    expect(teams.every((t) => t.capital === 1000)).toBe(true);
  });

  it('replaces the field when asked', () => {
    h.simulator.seedTeams(10, false);
    h.simulator.seedTeams(20, true);
    expect(h.repo.listTeams()).toHaveLength(20);
  });

  it('caps the seed count so a typo cannot create 10000 teams', () => {
    h.simulator.seedTeams(9999, false);
    expect(h.repo.listTeams().length).toBeLessThanOrEqual(60);
  });

  it('drives a market round through the real engine paths', async () => {
    h.simulator.seedTeams(12, false);
    h.engine.startGame();
    h.engine.openChallenge('C01');
    const result = await h.simulator.run('market_round');

    expect(result.actions).toBeGreaterThan(8);
    const attempts = h.repo.listAttempts();
    expect(attempts.length).toBeGreaterThan(8);
    // Real capital movement happened.
    const capitals = new Set(h.repo.listTeams().map((t) => t.capital));
    expect(capitals.size).toBeGreaterThan(1);
    // And it is auditable as a simulation.
    expect(h.engine.listAudit().some((a) => a.action === 'SIM_RUN')).toBe(true);
  }, 20_000);

  it('drives a complete premium auction with bids, a winner and an attempt', async () => {
    h.simulator.seedTeams(12, false);
    h.engine.startGame();
    h.engine.openChallenge('C04');
    await h.simulator.run('premium_auction');

    const auction = h.repo.getAuctionForChallenge('C04');
    expect(auction?.status).toBe('closed');
    expect(auction?.winnerTeamId).toBeTruthy();
    expect(h.repo.listBids(auction?.id as number).length).toBeGreaterThanOrEqual(1);
    const premium = h.engine.currentPremium();
    expect(premium?.attemptNumber).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('forces a reclaim chain so the reclaim UI can be exercised', async () => {
    h.simulator.seedTeams(12, false);
    h.engine.startGame();
    h.engine.openChallenge('C07');
    const result = await h.simulator.run('reclaim_chain');

    expect(result.notes.some((n) => n.includes('attempt 1 FAILED'))).toBe(true);
    const premium = h.engine.currentPremium();
    // Either somebody took the reclaim, or everyone declined and it closed.
    expect(['closed', 'attempt_2', 'sold', 'reclaim_offer']).toContain(premium?.stage);
    expect(h.eventsOf('PREMIUM_ATTEMPT_FAILED').length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('produces a genuine multi-place rank climb for the leaderboard animation', async () => {
    h.simulator.seedTeams(12, false);
    // Spread the field so ranks are unambiguous.
    h.repo.listTeams().forEach((team, index) => {
      h.engine.adjustCapital(team.id, index * 100, 'spread');
    });
    const before = h.engine.leaderboard();
    const climber = before[before.length - 1]?.teamId as string;
    expect(before.find((r) => r.teamId === climber)?.rank).toBe(12);

    await h.simulator.run('rank_swap', 2);

    const after = h.engine.leaderboard();
    expect(after.find((r) => r.teamId === climber)?.rank).toBe(1);
    // Every intermediate step was broadcast, so the client can animate it.
    expect(h.eventsOf('LEADERBOARD_UPDATED').length).toBeGreaterThan(4);
  }, 30_000);

  it('chaos mode fires many rapid capital changes without corrupting state', async () => {
    h.simulator.seedTeams(20, false);
    await h.simulator.run('chaos', 1.5);

    const rows = h.engine.leaderboard();
    expect(rows).toHaveLength(20);
    // Ranks remain a valid, ordered sequence with no duplicate team rows.
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(20);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.capital).toBeLessThanOrEqual(rows[i - 1]!.capital);
    }
    expect(rows.every((r) => r.capital >= 0)).toBe(true);
  }, 40_000);

  it('refuses to run two simulations at once', async () => {
    h.simulator.seedTeams(6, false);
    const first = h.simulator.run('chaos', 1);
    await expect(h.simulator.run('chaos', 1)).rejects.toThrow(/already running/);
    h.simulator.stop();
    await first;
  }, 30_000);

  it('rejects an unknown scenario', async () => {
    h.simulator.seedTeams(4, false);
    await expect(h.simulator.run('does_not_exist')).rejects.toThrow(/Unknown scenario/);
  });
});

describe('qualification and export (spec 48, 49)', () => {
  beforeEach(() => {
    h.simulator.seedTeams(15, false);
    h.repo.listTeams().forEach((team, index) => {
      h.engine.adjustCapital(team.id, (15 - index) * 100, 'spread');
    });
  });

  it('marks the configured number of qualifiers', () => {
    const rows = h.engine.leaderboard();
    expect(rows.filter((r) => r.qualified)).toHaveLength(10);
    expect(rows[9]?.qualified).toBe(true);
    expect(rows[10]?.qualified).toBe(false);
  });

  it('re-evaluates qualification live when the organizer changes the count', () => {
    h.engine.updateConfig({ qualifiers: 5 });
    expect(h.engine.leaderboard().filter((r) => r.qualified)).toHaveLength(5);
  });

  it('rejects an invalid config change and keeps the old value', () => {
    const result = h.engine.updateConfig({ qualifiers: 0, startingCapital: -1 });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(2);
    expect(h.engine.getConfig().qualifiers).toBe(10);
    expect(h.engine.getConfig().startingCapital).toBe(1000);
  });

  it('persists a config change', () => {
    h.engine.updateConfig({ premiumStartingBid: 400, reclaimDecisionWindow: 8 });
    const reloaded = h.repo.loadConfig();
    expect(reloaded.premiumStartingBid).toBe(400);
    expect(reloaded.reclaimDecisionWindow).toBe(8);
  });

  it('exports a CSV with the exact specified columns', () => {
    const csv = exportCsv(h.engine);
    const [header, ...rows] = csv.trim().split('\n');
    expect(header?.split(',')).toEqual([
      'Rank',
      'Team ID',
      'Team',
      'Starting Capital',
      'Final Capital',
      'Normal Attempted',
      'Normal Correct',
      'Premium Wins',
      'Premium Attempts',
      'Premium Correct',
      'Premium Wrong',
      'Total Profit/Loss',
      'Qualification Status',
    ]);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toContain('QUALIFIED');
    expect(rows[14]).toContain('NOT QUALIFIED');
  });

  it('quotes a team name containing a comma', () => {
    h.engine.updateTeam('T01', { name: 'THE, COMMAS' });
    expect(exportCsv(h.engine)).toContain('"THE, COMMAS"');
  });

  it('computes profit and loss against starting capital', () => {
    const rows = buildResultRows(h.engine);
    for (const row of rows) {
      expect(row.totalProfitLoss).toBe(row.finalCapital - row.startingCapital);
    }
  });

  it('exports a complete JSON bundle for the archive', () => {
    const payload = exportJson(h.engine);
    expect(payload.results).toHaveLength(15);
    expect(payload.challenges).toHaveLength(12);
    expect(payload.config.qualifiers).toBe(10);
    expect(payload.event.round).toBe('CODE MARKET');
  });
});

describe('live operator queue (spec 32)', () => {
  it('surfaces attempting, submitted and disconnected teams', async () => {
    seedTeams(h, 4);
    h.engine.startGame();
    h.engine.setConnection('T01', 'online');
    h.engine.setConnection('T02', 'online');
    h.engine.setConnection('T03', 'online');
    h.engine.setConnection('T04', 'online');

    h.engine.openChallenge('C01');
    h.engine.unlockChallenge('T01', 'C01', 'MKT-4417');
    h.engine.joinChallenge('T01', 'C01');
    h.engine.setConnection('T04', 'offline');

    const events = h.engine.liveEvents();
    expect(events.find((e) => e.teamId === 'T01')?.kind).toBe('attempting');
    expect(events.find((e) => e.teamId === 'T04')?.kind).toBe('disconnected');
    // Items needing attention sort first.
    expect(events[0]?.needsAttention).toBe(true);
  });

  it('flags an open reclaim offer for the operator', async () => {
    seedTeams(h, 4);
    for (const id of ['T01', 'T02']) h.engine.adjustCapital(id, 800, 'headroom');
    h.engine.startGame();
    h.engine.openChallenge('C04');
    h.engine.startAuction('C04');
    h.engine.placeBid('T02', 300);
    h.engine.placeBid('T01', 400);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('wrong');

    const events = h.engine.liveEvents();
    const reclaim = events.find((e) => e.kind === 'reclaim_offer');
    expect(reclaim?.teamId).toBe('T02');
    expect(reclaim?.needsAttention).toBe(true);
  });
});
