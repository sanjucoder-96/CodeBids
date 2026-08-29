import { describe, expect, it } from 'vitest';
import {
  computeLeaderboard,
  diffRanks,
  qualificationBoundaryIndex,
  qualificationChanges,
  rankMap,
} from './leaderboard.js';
import type { Team } from './types.js';

const team = (id: string, capital: number, over: Partial<Team> = {}): Team => ({
  id,
  name: `Team ${id}`,
  capital,
  startingCapital: 1000,
  protectedReserve: 500,
  status: 'active',
  connectionStatus: 'online',
  seatLabel: null,
  volunteer: null,
  createdAt: 0,
  lastSeenAt: null,
  ...over,
});

describe('computeLeaderboard', () => {
  it('ranks by capital descending', () => {
    const rows = computeLeaderboard(
      [team('T01', 1000), team('T02', 2500), team('T03', 1800)],
      { qualifiers: 10 },
    );
    expect(rows.map((r) => r.teamId)).toEqual(['T02', 'T03', 'T01']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('is stable for tied capital - same rank, id ordering', () => {
    const rows = computeLeaderboard(
      [team('T05', 1000), team('T02', 1000), team('T09', 1000)],
      { qualifiers: 10 },
    );
    expect(rows.map((r) => r.teamId)).toEqual(['T02', 'T05', 'T09']);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it('resumes correct positions after a tie block', () => {
    const rows = computeLeaderboard(
      [team('T01', 2000), team('T02', 1000), team('T03', 1000), team('T04', 500)],
      { qualifiers: 10 },
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('sorts inactive teams below active ones at equal capital', () => {
    const rows = computeLeaderboard(
      [team('T01', 1000, { status: 'withdrawn' }), team('T02', 1000)],
      { qualifiers: 10 },
    );
    expect(rows[0]?.teamId).toBe('T02');
  });

  it('computes delta against starting capital', () => {
    const rows = computeLeaderboard([team('T01', 2500)], { qualifiers: 10 });
    expect(rows[0]?.delta).toBe(1500);
  });

  it('produces identical output for identical input (no spurious movement)', () => {
    const teams = [team('T01', 1200), team('T02', 1200), team('T03', 900)];
    expect(computeLeaderboard(teams, { qualifiers: 2 })).toEqual(
      computeLeaderboard([...teams].reverse(), { qualifiers: 2 }),
    );
  });
});

describe('qualification (spec 48)', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    team(`T${String(i + 1).padStart(2, '0')}`, 3000 - i * 100),
  );

  it('marks exactly the top N as qualified', () => {
    const rows = computeLeaderboard(many, { qualifiers: 10 });
    expect(rows.filter((r) => r.qualified)).toHaveLength(10);
    expect(rows[9]?.qualified).toBe(true);
    expect(rows[10]?.qualified).toBe(false);
  });

  it('honours a reconfigured qualifier count', () => {
    expect(computeLeaderboard(many, { qualifiers: 5 }).filter((r) => r.qualified)).toHaveLength(5);
  });

  it('a withdrawn team inside the top N does not qualify', () => {
    const rows = computeLeaderboard(
      [team('T01', 5000, { status: 'withdrawn' }), team('T02', 1000)],
      { qualifiers: 1 },
    );
    expect(rows[0]?.qualified).toBe(false);
  });

  it('locates the qualification divider', () => {
    const rows = computeLeaderboard(many, { qualifiers: 10 });
    expect(qualificationBoundaryIndex(rows, 10)).toBe(9);
  });

  it('hides the divider when everyone qualifies', () => {
    const rows = computeLeaderboard(many.slice(0, 5), { qualifiers: 10 });
    expect(qualificationBoundaryIndex(rows, 10)).toBe(-1);
  });

  it('extends the qualified block across a tie on the line', () => {
    const rows = computeLeaderboard(
      [team('T01', 2000), team('T02', 1000), team('T03', 1000)],
      { qualifiers: 2 },
    );
    expect(rows.map((r) => r.qualified)).toEqual([true, true, true]);
  });

  it('reports teams crossing the line in both directions', () => {
    const before = computeLeaderboard([team('T01', 2000), team('T02', 1000)], { qualifiers: 1 });
    const after = computeLeaderboard([team('T01', 800), team('T02', 1000)], { qualifiers: 1 });
    const changes = qualificationChanges(before, after);
    expect(changes).toContainEqual({ teamId: 'T01', qualified: false });
    expect(changes).toContainEqual({ teamId: 'T02', qualified: true });
  });
});

describe('rank movement (spec 26)', () => {
  it('detects an overtake in both directions', () => {
    const before = computeLeaderboard([team('T07', 2000), team('T12', 1800)], { qualifiers: 10 });
    const after = computeLeaderboard([team('T07', 2000), team('T12', 2500)], { qualifiers: 10 });
    const changes = diffRanks(rankMap(before), after);
    expect(changes.find((c) => c.teamId === 'T12')).toMatchObject({
      direction: 'up',
      from: 2,
      to: 1,
      amount: 1,
    });
    expect(changes.find((c) => c.teamId === 'T07')).toMatchObject({ direction: 'down', amount: 1 });
  });

  it('reports a big jump with the right magnitude', () => {
    const teams = Array.from({ length: 12 }, (_, i) => team(`T${i + 1}`, 2000 - i * 50));
    const before = computeLeaderboard(teams, { qualifiers: 10 });
    const jumped = teams.map((t) => (t.id === 'T12' ? { ...t, capital: 1975 } : t));
    const after = computeLeaderboard(jumped, { qualifiers: 10 });
    const change = diffRanks(rankMap(before), after).find((c) => c.teamId === 'T12');
    expect(change?.direction).toBe('up');
    expect(change?.from).toBe(12);
    expect(change?.to).toBe(2);
    expect(change?.amount).toBe(10);
  });

  it('marks unchanged rows as same and unknown rows as new', () => {
    const before = computeLeaderboard([team('T01', 1000)], { qualifiers: 10 });
    const after = computeLeaderboard([team('T01', 1000), team('T02', 500)], { qualifiers: 10 });
    const changes = diffRanks(rankMap(before), after);
    expect(changes.find((c) => c.teamId === 'T01')?.direction).toBe('same');
    expect(changes.find((c) => c.teamId === 'T02')?.direction).toBe('new');
  });
});
