import { describe, expect, it } from 'vitest';
import {
  applyLadderTransition,
  buildLadder,
  canStartAnotherAttempt,
  closeLadder,
  emptyPremiumState,
  nextCandidate,
  remainingCandidates,
} from './reclaim.js';
import type { Bid } from './types.js';

let seq = 0;
const bid = (teamId: string, amount: number, valid = true): Bid => ({
  id: ++seq,
  auctionId: 1,
  teamId,
  amount,
  sequenceNumber: seq,
  timestamp: 1_700_000_000_000 + seq * 1000,
  valid,
});

/** The auction from spec section 15. */
function specAuction(): Bid[] {
  seq = 0;
  return [
    bid('T03', 300),
    bid('T07', 400),
    bid('T12', 500),
    bid('T18', 600),
  ];
}

describe('buildLadder (spec 15/18)', () => {
  it('orders teams by their highest bid, descending', () => {
    const ladder = buildLadder(specAuction(), 'T18');
    expect(ladder.map((e) => e.teamId)).toEqual(['T18', 'T12', 'T07', 'T03']);
    expect(ladder.map((e) => e.amount)).toEqual([600, 500, 400, 300]);
    expect(ladder.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });

  it('marks the auction winner', () => {
    const ladder = buildLadder(specAuction(), 'T18');
    expect(ladder[0]?.state).toBe('winner');
    expect(ladder.slice(1).every((e) => e.state === 'pending')).toBe(true);
  });

  it('represents each team once, by its highest bid', () => {
    seq = 0;
    const bids = [bid('T01', 300), bid('T02', 400), bid('T01', 500), bid('T02', 600), bid('T01', 700)];
    const ladder = buildLadder(bids, 'T01');
    expect(ladder).toHaveLength(2);
    expect(ladder[0]).toMatchObject({ teamId: 'T01', amount: 700 });
    expect(ladder[1]).toMatchObject({ teamId: 'T02', amount: 600 });
  });

  it('ignores rejected bids', () => {
    seq = 0;
    const bids = [bid('T01', 300), bid('T02', 900, false)];
    const ladder = buildLadder(bids, 'T01');
    expect(ladder.map((e) => e.teamId)).toEqual(['T01']);
  });

  it('breaks ties by who got there first', () => {
    seq = 0;
    const early = bid('T05', 500);
    const late = bid('T09', 500);
    const ladder = buildLadder([early, late], null);
    expect(ladder.map((e) => e.teamId)).toEqual(['T05', 'T09']);
    expect(late.sequenceNumber).toBeGreaterThan(early.sequenceNumber);
  });

  it('returns an empty ladder for an auction with no bids', () => {
    expect(buildLadder([], null)).toEqual([]);
  });
});

describe('reclaim walk (spec 15/16/17)', () => {
  it('promotes the second-highest bidder when the winner fails - no second auction', () => {
    let ladder = buildLadder(specAuction(), 'T18');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });

    const candidate = nextCandidate(ladder);
    expect(candidate?.teamId).toBe('T12');
    // The reclaim uses the team's ORIGINAL bid, not a new one.
    expect(candidate?.amount).toBe(500);
  });

  it('walks past a decline to the next original bidder', () => {
    let ladder = buildLadder(specAuction(), 'T18');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });
    ladder = applyLadderTransition(ladder, { kind: 'offer', teamId: 'T12' });
    ladder = applyLadderTransition(ladder, { kind: 'decline', teamId: 'T12' });

    const next = nextCandidate(ladder);
    expect(next?.teamId).toBe('T07');
    expect(next?.amount).toBe(400);
  });

  it('reproduces the spec walk T18 failed -> T12 declined -> T07 offered -> T07 accepted', () => {
    let ladder = buildLadder(specAuction(), 'T18');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });
    ladder = applyLadderTransition(ladder, { kind: 'offer', teamId: 'T12' });
    ladder = applyLadderTransition(ladder, { kind: 'decline', teamId: 'T12' });
    ladder = applyLadderTransition(ladder, { kind: 'offer', teamId: 'T07' });
    ladder = applyLadderTransition(ladder, { kind: 'accept', teamId: 'T07' });

    expect(ladder.map((e) => e.state)).toEqual(['failed', 'declined', 'accepted', 'pending']);
  });

  it('treats an expired offer like a decline for walking purposes', () => {
    let ladder = buildLadder(specAuction(), 'T18');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });
    ladder = applyLadderTransition(ladder, { kind: 'offer', teamId: 'T12' });
    ladder = applyLadderTransition(ladder, { kind: 'expire', teamId: 'T12' });
    expect(nextCandidate(ladder)?.teamId).toBe('T07');
  });

  it('runs out of candidates when everybody declines', () => {
    let ladder = buildLadder(specAuction(), 'T18');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });
    for (const team of ['T12', 'T07', 'T03']) {
      ladder = applyLadderTransition(ladder, { kind: 'offer', teamId: team });
      ladder = applyLadderTransition(ladder, { kind: 'decline', teamId: team });
    }
    expect(nextCandidate(ladder)).toBeNull();
    expect(remainingCandidates(ladder)).toHaveLength(0);
  });

  it('has no candidates when the winner was the only bidder', () => {
    seq = 0;
    let ladder = buildLadder([bid('T09', 300)], 'T09');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });
    expect(nextCandidate(ladder)).toBeNull();
  });

  it('closeLadder settles every unresolved entry', () => {
    let ladder = buildLadder(specAuction(), 'T18');
    ladder = applyLadderTransition(ladder, { kind: 'winner_failed' });
    ladder = applyLadderTransition(ladder, { kind: 'offer', teamId: 'T12' });
    const closed = closeLadder(ladder);
    expect(closed.map((e) => e.state)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
  });

  it('never mutates the input ladder', () => {
    const ladder = buildLadder(specAuction(), 'T18');
    const before = JSON.stringify(ladder);
    applyLadderTransition(ladder, { kind: 'winner_failed' });
    closeLadder(ladder);
    expect(JSON.stringify(ladder)).toBe(before);
  });
});

describe('maximum two attempts (spec 17)', () => {
  it('allows attempt 1 and 2 but never 3', () => {
    const state = emptyPremiumState('P1', 4);
    expect(canStartAnotherAttempt({ ...state, attemptNumber: 0 })).toBe(true);
    expect(canStartAnotherAttempt({ ...state, attemptNumber: 1 })).toBe(true);
    expect(canStartAnotherAttempt({ ...state, attemptNumber: 2 })).toBe(false);
  });

  it('never allows an attempt on a closed premium', () => {
    const state = emptyPremiumState('P1', 4);
    expect(canStartAnotherAttempt({ ...state, attemptNumber: 1, stage: 'closed' })).toBe(false);
  });
});
