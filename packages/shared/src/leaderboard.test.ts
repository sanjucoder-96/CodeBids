import { describe, expect, it } from 'vitest';
import {
  computeLeaderboard,
  computePodium,
  diffRanks,
  podiumChanges,
  rankMap,
  redactForFinalStretch,
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
    const rows = computeLeaderboard([team('T01', 1000), team('T02', 2500), team('T03', 1800)]);
    expect(rows.map((r) => r.teamId)).toEqual(['T02', 'T03', 'T01']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('is stable for tied capital - same rank, id ordering', () => {
    const rows = computeLeaderboard([team('T05', 1000), team('T02', 1000), team('T09', 1000)]);
    expect(rows.map((r) => r.teamId)).toEqual(['T02', 'T05', 'T09']);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it('resumes correct positions after a tie block', () => {
    const rows = computeLeaderboard([
      team('T01', 2000),
      team('T02', 1000),
      team('T03', 1000),
      team('T04', 500),
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('sorts inactive teams below active ones at equal capital', () => {
    const rows = computeLeaderboard([team('T01', 1000, { status: 'withdrawn' }), team('T02', 1000)]);
    expect(rows[0]?.teamId).toBe('T02');
  });

  it('computes delta against starting capital', () => {
    expect(computeLeaderboard([team('T01', 2500)])[0]?.delta).toBe(1500);
  });

  it('produces identical output for identical input (no spurious movement)', () => {
    const teams = [team('T01', 1200), team('T02', 1200), team('T03', 900)];
    expect(computeLeaderboard(teams)).toEqual(computeLeaderboard([...teams].reverse()));
  });
});

describe('podium (spec 2, 18)', () => {
  const field = [
    team('T01', 3000),
    team('T02', 2500),
    team('T03', 2000),
    team('T04', 1500),
    team('T05', 1000),
  ];

  it('marks exactly the top three', () => {
    const rows = computeLeaderboard(field);
    expect(rows.map((r) => r.podium)).toEqual([1, 2, 3, null, null]);
  });

  it('has no concept of qualification any more', () => {
    const row = computeLeaderboard(field)[0];
    expect(row).not.toHaveProperty('qualified');
    expect(row).toHaveProperty('podium');
  });

  it('builds the closing podium in order', () => {
    const podium = computePodium(computeLeaderboard(field));
    expect(podium).toHaveLength(3);
    expect(podium.map((p) => [p.place, p.teamId])).toEqual([
      [1, 'T01'],
      [2, 'T02'],
      [3, 'T03'],
    ]);
    expect(podium[0]?.delta).toBe(2000);
  });

  it('honours a different podium size', () => {
    const rows = computeLeaderboard(field, { podiumPlaces: 1 });
    expect(rows.filter((r) => r.podium !== null)).toHaveLength(1);
  });

  it('seats three ordinal plinths even when teams tie, by the id tie-break', () => {
    const tied = [team('T01', 2000), team('T02', 2000), team('T03', 1000)];
    const podium = computePodium(computeLeaderboard(tied));
    // The ceremony fills 1st, 2nd, 3rd from the ranking (spec 16); the board's
    // shared-medal logic is a separate concern tested elsewhere.
    expect(podium.map((p) => [p.place, p.teamId])).toEqual([
      [1, 'T01'],
      [2, 'T02'],
      [3, 'T03'],
    ]);
  });

  it('a withdrawn team never takes a podium place', () => {
    const rows = computeLeaderboard([team('T01', 5000, { status: 'withdrawn' }), team('T02', 1000)]);
    expect(rows[0]?.podium).toBeNull();
    expect(computePodium(rows).map((p) => p.teamId)).toEqual(['T02']);
  });

  it('reports teams moving onto and off the podium', () => {
    const before = computeLeaderboard([team('T01', 2000), team('T02', 1000)], { podiumPlaces: 1 });
    const after = computeLeaderboard([team('T01', 800), team('T02', 1000)], { podiumPlaces: 1 });
    const changes = podiumChanges(before, after);
    expect(changes).toContainEqual({ teamId: 'T01', onPodium: false });
    expect(changes).toContainEqual({ teamId: 'T02', onPodium: true });
  });
});

describe('rank movement (spec 17)', () => {
  it('detects an overtake in both directions', () => {
    const before = computeLeaderboard([team('T07', 2000), team('T12', 1800)]);
    const after = computeLeaderboard([team('T07', 2000), team('T12', 2500)]);
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
    const before = computeLeaderboard(teams);
    const jumped = teams.map((t) => (t.id === 'T12' ? { ...t, capital: 1975 } : t));
    const change = diffRanks(rankMap(before), computeLeaderboard(jumped)).find(
      (c) => c.teamId === 'T12',
    );
    expect(change).toMatchObject({ direction: 'up', from: 12, to: 2, amount: 10 });
  });

  it('marks unchanged rows as same and unknown rows as new', () => {
    const before = computeLeaderboard([team('T01', 1000)]);
    const after = computeLeaderboard([team('T01', 1000), team('T02', 500)]);
    const changes = diffRanks(rankMap(before), after);
    expect(changes.find((c) => c.teamId === 'T01')?.direction).toBe('same');
    expect(changes.find((c) => c.teamId === 'T02')?.direction).toBe('new');
  });
});

describe('final-stretch redaction (spec 11)', () => {
  const rows = computeLeaderboard([team('T01', 3000), team('T02', 2000), team('T03', 1000)]);

  it('leaves a team only its own row', () => {
    const redacted = redactForFinalStretch(rows, 'T02');
    expect(redacted).toHaveLength(1);
    expect(redacted[0]?.teamId).toBe('T02');
    expect(redacted[0]?.capital).toBe(2000);
  });

  it('withholds rank and podium standing', () => {
    const redacted = redactForFinalStretch(rows, 'T02');
    expect(redacted[0]?.rank).toBe(0);
    expect(redacted[0]?.podium).toBeNull();
    expect(redacted[0]?.previousRank).toBeNull();
  });

  it('never leaks another team', () => {
    const dump = JSON.stringify(redactForFinalStretch(rows, 'T02'));
    expect(dump).not.toContain('T01');
    expect(dump).not.toContain('T03');
    expect(dump).not.toContain('3000');
  });

  it('returns nothing for an unknown or absent team', () => {
    expect(redactForFinalStretch(rows, null)).toEqual([]);
    expect(redactForFinalStretch(rows, 'T99')).toEqual([]);
  });
});

describe('podium places only exist once the field separates', () => {
  const level = (ids: string[], capital: number): Team[] =>
    ids.map((id) => ({
      id,
      name: `TEAM ${id}`,
      capital,
      startingCapital: 1000,
      protectedReserve: 500,
      status: 'active' as const,
      connectionStatus: 'online' as const,
      joinCode: id,
      seatLabel: null,
      volunteer: null,
      createdAt: 1,
      lastSeenAt: null,
    }));

  it('awards no board medals at the start of the round, when every team is tied', () => {
    const rows = computeLeaderboard(level(['T01', 'T02', 'T03', 'T04'], 1000));
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1, 1]);
    // The BOARD withholds medals while the field is level...
    expect(rows.map((r) => r.podium)).toEqual([null, null, null, null]);
    // ...but the closing CEREMONY always seats three, ordered by the id
    // tie-break, so 2nd and 3rd are never blank (spec 16).
    expect(computePodium(rows, 3).map((p) => [p.place, p.teamId])).toEqual([
      [1, 'T01'],
      [2, 'T02'],
      [3, 'T03'],
    ]);
  });

  it('awards nothing when more teams tie for the lead than there are places', () => {
    const teams = [...level(['T01', 'T02', 'T03', 'T04'], 2000), ...level(['T05'], 900)];
    const rows = computeLeaderboard(teams);
    expect(rows.map((r) => r.podium)).toEqual([null, null, null, null, null]);
  });

  it('keeps a real first place even when the chase is an unresolvable tie', () => {
    const teams = [
      ...level(['T01'], 2500),
      ...level(['T02', 'T03', 'T04', 'T05'], 1000),
    ];
    const rows = computeLeaderboard(teams);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 2, 2]);
    // The BOARD awards only first: the four-way tie cannot fill 2nd and 3rd.
    expect(rows.map((r) => r.podium)).toEqual([1, null, null, null, null]);
    // The CEREMONY still seats three from the ranking - the leader, then the two
    // lowest-id of the tied chasers by the id tie-break (spec 16). This is the
    // exact bug that used to blank out 2nd and 3rd.
    expect(computePodium(rows, 3).map((p) => [p.place, p.teamId])).toEqual([
      [1, 'T01'],
      [2, 'T02'],
      [3, 'T03'],
    ]);
  });

  it('awards a shared second place when the tie still fits', () => {
    const teams = [
      ...level(['T01'], 2500),
      ...level(['T02', 'T03'], 1800),
      ...level(['T04'], 900),
    ];
    const rows = computeLeaderboard(teams);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(rows.map((r) => r.podium)).toEqual([1, 2, 2, null]);
  });

  it('awards a shared place when the tie still fits', () => {
    const teams = [
      ...level(['T01', 'T02'], 2000),
      ...level(['T03'], 1500),
      ...level(['T04'], 900),
    ];
    const rows = computeLeaderboard(teams);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(rows.map((r) => r.podium)).toEqual([1, 1, 3, null]);
    // The ceremony seats three ordinal plinths regardless of the shared medal.
    expect(computePodium(rows, 3).map((p) => p.place)).toEqual([1, 2, 3]);
  });

  it('awards normally once the field is fully separated', () => {
    const teams = [
      ...level(['T01'], 3000),
      ...level(['T02'], 2000),
      ...level(['T03'], 1500),
      ...level(['T04'], 900),
    ];
    const rows = computeLeaderboard(teams);
    expect(rows.map((r) => r.podium)).toEqual([1, 2, 3, null]);
    // Distinct capitals -> the ceremony matches the board exactly (spec 16).
    expect(computePodium(rows, 3).map((p) => [p.place, p.teamId])).toEqual([
      [1, 'T01'],
      [2, 'T02'],
      [3, 'T03'],
    ]);
  });

  it('always seats three even with a big tie behind the leader (spec 16 fix)', () => {
    // One leader and seven teams level behind: the classic case where 2nd and
    // 3rd used to vanish from the podium.
    const teams = [
      ...level(['T01'], 5000),
      ...level(['T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'], 1500),
    ];
    const rows = computeLeaderboard(teams);
    const podium = computePodium(rows, 3);
    expect(podium).toHaveLength(3);
    expect(podium.map((p) => p.place)).toEqual([1, 2, 3]);
    // The two silver/bronze seats go to the lowest-id chasers (the tie-break).
    expect(podium.map((p) => p.teamId)).toEqual(['T01', 'T02', 'T03']);
  });

  it('seats only as many plinths as there are teams', () => {
    const rows = computeLeaderboard(level(['T01', 'T02'], 1500));
    expect(computePodium(rows, 3)).toHaveLength(2);
  });
});
