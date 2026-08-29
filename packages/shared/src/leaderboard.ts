/**
 * Leaderboard ranking and Round 3 qualification (spec sections 25, 48).
 *
 * Ranking is deterministic and stable so that repeated computations over the
 * same data never produce spurious row movement on the projector.
 */

import type { LeaderboardRow, Team } from './types.js';

export interface RankingOptions {
  qualifiers: number;
  /** Previous ranks keyed by team id, used to render the up/down indicator. */
  previousRanks?: Map<string, number> | Record<string, number>;
}

function readPrevious(
  previous: RankingOptions['previousRanks'],
  teamId: string,
): number | null {
  if (!previous) return null;
  if (previous instanceof Map) return previous.get(teamId) ?? null;
  return previous[teamId] ?? null;
}

/**
 * Sort order:
 *   1. capital, descending
 *   2. active teams above withdrawn/eliminated
 *   3. team id, ascending  (stable, human-explicable tie-break)
 *
 * Teams tied on capital share the same displayed rank (competition ranking),
 * which matters for an honest qualification line.
 */
export function computeLeaderboard(
  teams: readonly Team[],
  options: RankingOptions,
): LeaderboardRow[] {
  const sorted = [...teams].sort((a, b) => {
    if (b.capital !== a.capital) return b.capital - a.capital;
    const aActive = a.status === 'active' ? 0 : 1;
    const bActive = b.status === 'active' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.id.localeCompare(b.id);
  });

  const rows: LeaderboardRow[] = [];
  let lastCapital: number | null = null;
  let lastRank = 0;

  sorted.forEach((team, index) => {
    const position = index + 1;
    const rank = lastCapital !== null && team.capital === lastCapital ? lastRank : position;
    lastCapital = team.capital;
    lastRank = rank;

    rows.push({
      rank,
      teamId: team.id,
      name: team.name,
      capital: team.capital,
      startingCapital: team.startingCapital,
      delta: team.capital - team.startingCapital,
      qualified: rank <= options.qualifiers && team.status === 'active',
      previousRank: readPrevious(options.previousRanks, team.id),
      connectionStatus: team.connectionStatus,
      status: team.status,
    });
  });

  return rows;
}

export function rankMap(rows: readonly LeaderboardRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.teamId, row.rank]));
}

/**
 * The index (0-based) after which the qualification divider is drawn, or -1
 * when every team qualifies / nobody does.
 */
export function qualificationBoundaryIndex(
  rows: readonly LeaderboardRow[],
  qualifiers: number,
): number {
  if (rows.length <= qualifiers) return -1;
  const lastQualifying = rows.findLastIndex((row) => row.rank <= qualifiers);
  return lastQualifying;
}

export interface RankChange {
  teamId: string;
  from: number | null;
  to: number;
  direction: 'up' | 'down' | 'same' | 'new';
  amount: number;
}

export function diffRanks(
  previous: Map<string, number>,
  current: readonly LeaderboardRow[],
): RankChange[] {
  return current.map((row) => {
    const from = previous.get(row.teamId) ?? null;
    if (from === null) return { teamId: row.teamId, from, to: row.rank, direction: 'new', amount: 0 };
    if (from === row.rank) {
      return { teamId: row.teamId, from, to: row.rank, direction: 'same', amount: 0 };
    }
    return {
      teamId: row.teamId,
      from,
      to: row.rank,
      direction: from > row.rank ? 'up' : 'down',
      amount: Math.abs(from - row.rank),
    };
  });
}

/** Teams that crossed into (or out of) the qualification zone. */
export function qualificationChanges(
  previous: readonly LeaderboardRow[],
  current: readonly LeaderboardRow[],
): { teamId: string; qualified: boolean }[] {
  const before = new Map(previous.map((row) => [row.teamId, row.qualified]));
  const changes: { teamId: string; qualified: boolean }[] = [];
  for (const row of current) {
    const was = before.get(row.teamId);
    if (was !== undefined && was !== row.qualified) {
      changes.push({ teamId: row.teamId, qualified: row.qualified });
    }
  }
  return changes;
}
