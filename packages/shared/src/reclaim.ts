/**
 * The reclaim engine (spec sections 15, 16, 17).
 *
 * There is never a second auction. When the auction winner fails, the ladder
 * derived from the ORIGINAL bidding order decides who gets offered the same
 * question at their OWN original bid. Declines cost nothing and do not consume
 * an attempt; only an accepted offer becomes attempt #2, and there is never an
 * attempt #3.
 */

import type { Bid, LadderEntry, PremiumState } from './types.js';

/**
 * Build the reclaim ladder from the raw bid log.
 *
 * Ordering rule: each team is represented once, by its HIGHEST valid bid,
 * descending. Ties are broken by who reached that amount first (lower sequence
 * number wins) - matching how a live auctioneer would remember the room.
 */
export function buildLadder(bids: readonly Bid[], winnerTeamId: string | null): LadderEntry[] {
  const best = new Map<string, { amount: number; sequenceNumber: number }>();

  for (const bid of bids) {
    if (!bid.valid) continue;
    const existing = best.get(bid.teamId);
    if (
      !existing ||
      bid.amount > existing.amount ||
      (bid.amount === existing.amount && bid.sequenceNumber < existing.sequenceNumber)
    ) {
      best.set(bid.teamId, { amount: bid.amount, sequenceNumber: bid.sequenceNumber });
    }
  }

  const sorted = [...best.entries()].sort((a, b) => {
    if (b[1].amount !== a[1].amount) return b[1].amount - a[1].amount;
    return a[1].sequenceNumber - b[1].sequenceNumber;
  });

  return sorted.map(([teamId, info], index) => ({
    rank: index + 1,
    teamId,
    amount: info.amount,
    sequenceNumber: info.sequenceNumber,
    state: teamId === winnerTeamId ? ('winner' as const) : ('pending' as const),
  }));
}

/** Teams still eligible to be offered a reclaim, in ladder order. */
export function remainingCandidates(ladder: readonly LadderEntry[]): LadderEntry[] {
  return ladder.filter((entry) => entry.state === 'pending');
}

/** The next team that should receive a reclaim offer, or null when exhausted. */
export function nextCandidate(ladder: readonly LadderEntry[]): LadderEntry | null {
  return remainingCandidates(ladder)[0] ?? null;
}

export type LadderTransition =
  | { kind: 'winner_failed' }
  | { kind: 'offer'; teamId: string }
  | { kind: 'accept'; teamId: string }
  | { kind: 'decline'; teamId: string }
  | { kind: 'expire'; teamId: string }
  | { kind: 'attempt_failed'; teamId: string };

/** Apply a transition to the ladder, returning a new array (never mutates). */
export function applyLadderTransition(
  ladder: readonly LadderEntry[],
  transition: LadderTransition,
): LadderEntry[] {
  return ladder.map((entry) => {
    switch (transition.kind) {
      case 'winner_failed':
        return entry.state === 'winner' ? { ...entry, state: 'failed' as const } : entry;
      case 'offer':
        return entry.teamId === transition.teamId
          ? { ...entry, state: 'offered' as const }
          : entry;
      case 'accept':
        return entry.teamId === transition.teamId
          ? { ...entry, state: 'accepted' as const }
          : entry;
      case 'decline':
        return entry.teamId === transition.teamId
          ? { ...entry, state: 'declined' as const }
          : entry;
      case 'expire':
        return entry.teamId === transition.teamId
          ? { ...entry, state: 'expired' as const }
          : entry;
      case 'attempt_failed':
        return entry.teamId === transition.teamId
          ? { ...entry, state: 'failed' as const }
          : entry;
      default:
        return entry;
    }
  });
}

/**
 * Once the reclaim attempt is spent (or nobody accepted), every remaining
 * candidate is marked `skipped` so the projector shows a settled ladder.
 */
export function closeLadder(ladder: readonly LadderEntry[]): LadderEntry[] {
  return ladder.map((entry) =>
    entry.state === 'pending' || entry.state === 'offered'
      ? { ...entry, state: 'skipped' as const }
      : entry,
  );
}

export function emptyPremiumState(challengeId: string): PremiumState {
  return {
    challengeId,
    stage: 'idle',
    auctionId: null,
    ladder: [],
    activeTeamId: null,
    activeRisk: null,
    attemptNumber: 0,
    offerTeamId: null,
    offerRisk: null,
    offerDeadline: null,
    failedTeamId: null,
    outcome: null,
  };
}

/** Hard guard for spec section 17: never more than two attempts. */
export function canStartAnotherAttempt(state: PremiumState): boolean {
  return state.attemptNumber < 2 && state.stage !== 'closed';
}
