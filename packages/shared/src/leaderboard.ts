/**
 * Leaderboard ranking and the closing podium (spec sections 2, 17, 18).
 *
 * This round is the finale: there is no "qualification for the next round".
 * The top three teams are the winners.
 *
 * Ranking is deterministic and stable so repeated computation over the same
 * data never produces spurious row movement on the projector.
 */

import type { LeaderboardRow, PodiumEntry, Team } from './types.js';

export interface RankingOptions {
  /** How many places the podium celebrates (default 3). */
  podiumPlaces?: number;
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
 * Teams tied on capital share the same displayed rank (competition ranking).
 */
export function computeLeaderboard(
  teams: readonly Team[],
  options: RankingOptions = {},
): LeaderboardRow[] {
  const podiumPlaces = options.podiumPlaces ?? 3;

  const sorted = [...teams].sort((a, b) => {
    if (b.capital !== a.capital) return b.capital - a.capital;
    const aActive = a.status === 'active' ? 0 : 1;
    const bActive = b.status === 'active' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.id.localeCompare(b.id);
  });

  const ranked: { team: Team; rank: number }[] = [];
  let lastCapital: number | null = null;
  let lastRank = 0;

  sorted.forEach((team, index) => {
    const position = index + 1;
    const rank = lastCapital !== null && team.capital === lastCapital ? lastRank : position;
    lastCapital = team.capital;
    lastRank = rank;
    ranked.push({ team, rank });
  });

  const awarded = awardedPlaces(ranked, podiumPlaces);

  return ranked.map(({ team, rank }) => ({
    rank,
    teamId: team.id,
    name: team.name,
    capital: team.capital,
    startingCapital: team.startingCapital,
    delta: team.capital - team.startingCapital,
    podium: awarded.has(rank) && team.status === 'active' ? rank : null,
    previousRank: readPrevious(options.previousRanks, team.id),
    connectionStatus: team.connectionStatus,
    status: team.status,
  }));
}

/**
 * Which ranks actually hold a podium place.
 *
 * Places are handed out group by group, best first, and a tied group is only
 * awarded when the whole group fits inside the podium. Two teams level at the
 * top are both first and third place still exists; four teams level at the top
 * cannot be given three places, so none of them is placed. At the start of the
 * round every team shares rank 1, which is why nobody wears a medal until the
 * field separates - eight gold badges would be worse than none.
 *
 * A group that does not fit also ends the ceremony: with one leader and seven
 * teams tied behind, first place is real but second is not.
 */
function awardedPlaces(
  ranked: readonly { team: Team; rank: number }[],
  places: number,
): Set<number> {
  const awarded = new Set<number>();
  const contenders = ranked.filter((r) => r.team.status === 'active');

  let index = 0;
  while (index < contenders.length) {
    const rank = contenders[index]?.rank as number;
    let size = 0;
    while (index + size < contenders.length && contenders[index + size]?.rank === rank) size += 1;

    // The last place this tied group would occupy.
    if (rank + size - 1 > places) break;
    awarded.add(rank);
    index += size;
  }

  return awarded;
}

export function rankMap(rows: readonly LeaderboardRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.teamId, row.rank]));
}

/**
 * The closing podium (spec section 2).
 *
 * Reads the places already decided by `computeLeaderboard` rather than deciding
 * them again, so the ceremony can never contradict the board the hall watched.
 * `places` remains accepted for callers that celebrate fewer places than the
 * board marks.
 */
export function computePodium(
  rows: readonly LeaderboardRow[],
  places = 3,
): PodiumEntry[] {
  return rows
    .filter((row) => row.podium !== null && row.podium <= places)
    .map((row) => ({
      place: row.podium as number,
      teamId: row.teamId,
      name: row.name,
      capital: row.capital,
      delta: row.delta,
    }));
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
    if (from === null) {
      return { teamId: row.teamId, from, to: row.rank, direction: 'new' as const, amount: 0 };
    }
    if (from === row.rank) {
      return { teamId: row.teamId, from, to: row.rank, direction: 'same' as const, amount: 0 };
    }
    return {
      teamId: row.teamId,
      from,
      to: row.rank,
      direction: from > row.rank ? ('up' as const) : ('down' as const),
      amount: Math.abs(from - row.rank),
    };
  });
}

/** Teams that moved onto or off the podium. */
export function podiumChanges(
  previous: readonly LeaderboardRow[],
  current: readonly LeaderboardRow[],
): { teamId: string; onPodium: boolean }[] {
  const before = new Map(previous.map((row) => [row.teamId, row.podium !== null]));
  const changes: { teamId: string; onPodium: boolean }[] = [];
  for (const row of current) {
    const was = before.get(row.teamId);
    const now = row.podium !== null;
    if (was !== undefined && was !== now) changes.push({ teamId: row.teamId, onPodium: now });
  }
  return changes;
}

/**
 * The view a participant may see while the leaderboard is blacked out
 * (spec section 11): their own numbers only, no global standings.
 */
export function redactForFinalStretch(
  rows: readonly LeaderboardRow[],
  teamId: string | null,
): LeaderboardRow[] {
  if (!teamId) return [];
  const mine = rows.find((row) => row.teamId === teamId);
  if (!mine) return [];
  // Rank and podium are withheld: only capital and own delta survive.
  return [{ ...mine, rank: 0, previousRank: null, podium: null }];
}
