/**
 * The premium economy and flow (spec sections 3, 4, 7, 8, 9, 10, 18, 20, 21, 22).
 *
 * ₹1,500 purse with a ₹500 protected reserve, ₹200 opening bid and fixed ₹100
 * increments, the winning bidder MUST attempt, and only the SECOND bidder can
 * reclaim - never a third. The server is the sole authority for every rule here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceTo, capital, makeHarness, startRound, type Harness } from './helpers.js';
import { DEFAULT_CONFIG } from '@code-market/shared';

let h: Harness;

/** Reach the first premium and open its auction. */
function openAuction(teams = 6): void {
  startRound(h, teams, 6);
  advanceTo(h, (s) => s.kind === 'premium');
  h.engine.startAuction();
}

/** The amount the auction would record next. */
function currentBid(): number | null {
  return h.engine.currentAuctionView()?.auction.currentBid ?? null;
}

beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.close());

describe('starting purse, reserve and minimum bid (spec 4, 21)', () => {
  it('starts every team on ₹1,500 with a ₹500 reserve', () => {
    expect(DEFAULT_CONFIG.startingCapital).toBe(1500);
    expect(DEFAULT_CONFIG.protectedReserve).toBe(500);
    startRound(h, 4);
    expect(capital(h, 'T01')).toBe(1500);
    // Effective max bid = 1500 - 500.
    expect(h.engine.teamView('T01')?.maxBid).toBe(1000);
  });

  it('opens the premium at ₹200', () => {
    expect(DEFAULT_CONFIG.premiumStartingBid).toBe(200);
    expect(DEFAULT_CONFIG.finalPremiumStartingBid).toBe(200);
    openAuction();
    expect(h.engine.currentAuctionView()?.auction.startingBid).toBe(200);
  });

  it('caps the maximum bid at purse minus the ₹500 reserve', () => {
    openAuction();
    // A fresh team can reach 1000 but not 1100.
    expect(h.engine.placeBid('T01', 1100).accepted).toBe(false);
    const ok = h.engine.placeBid('T01', 1000);
    expect(ok.accepted).toBe(true);
    expect(currentBid()).toBe(1000);
  });

  it('rejects an opening bid below ₹200', () => {
    openAuction();
    expect(h.engine.placeBid('T01', 199).accepted).toBe(false);
    expect(h.engine.placeBid('T01', 200).accepted).toBe(true);
  });
});

describe('fixed ₹100 increments (spec 3, 11, 18)', () => {
  it('advances the bid by exactly ₹100 on each click (200, 300, 400)', () => {
    openAuction();
    h.engine.placeBid('T01'); // no amount -> the server calculates it
    expect(currentBid()).toBe(200);
    h.engine.placeBid('T02');
    expect(currentBid()).toBe(300);
    h.engine.placeBid('T03');
    expect(currentBid()).toBe(400);
  });

  it('rejects an arbitrary off-ladder amount whoever sends it', () => {
    openAuction();
    h.engine.placeBid('T01'); // 200
    expect(h.engine.placeBid('T02', 250).accepted).toBe(false); // below the 300 minimum
    expect(h.engine.placeBid('T02', 350).accepted).toBe(false); // not on the 100 increment
    expect(h.engine.placeBid('T02', 300).accepted).toBe(true);
  });
});

describe('first valid received bid wins (spec 5)', () => {
  it('keeps the earlier of two equal bids and forces the other higher', () => {
    openAuction();
    expect(h.engine.placeBid('T01', 200).accepted).toBe(true);
    // B arrives at the same price a moment later: rejected, A still leads.
    expect(h.engine.placeBid('T02', 200).accepted).toBe(false);
    expect(h.engine.currentAuctionView()?.auction.currentLeaderTeamId).toBe('T01');
    expect(h.engine.placeBid('T02', 300).accepted).toBe(true);
    expect(h.engine.currentAuctionView()?.auction.currentLeaderTeamId).toBe('T02');
  });
});

describe('every team can bid; none is auto-removed (spec 5, 22)', () => {
  it('exposes all teams with their own ceiling', () => {
    openAuction(15);
    const teams = h.engine.publicTeams();
    expect(teams).toHaveLength(15);
    expect(teams.every((t) => t.maxBid === 1000)).toBe(true);
    // Any team may open the bidding.
    expect(h.engine.placeBid('T13', 200).accepted).toBe(true);
    expect(h.engine.currentAuctionView()?.auction.currentLeaderTeamId).toBe('T13');
  });
});

describe('the winning bidder MUST attempt (spec 8)', () => {
  it('authorises the winner with no take/sit-out choice', () => {
    openAuction();
    h.engine.placeBid('T01'); // 200
    h.engine.closeAuction();
    expect(h.engine.gameState().phase).toBe('premium_authorized');
    const prem = h.engine.currentPremium();
    expect(prem?.stage).toBe('sold');
    expect(prem?.activeTeamId).toBe('T01');
    // No decision window for the winner.
    expect(h.engine.teamView('T01')?.canDecidePremium).toBe(false);
    // The operator opens the attempt.
    h.engine.startPremiumAttempt();
    expect(h.engine.gameState().phase).toBe('premium_solving');
    expect(h.engine.currentPremium()?.activeTeamId).toBe('T01');
  });
});

describe('full premium flow: winner correct (spec 10, 20)', () => {
  /** A->200, B->300, C->400, A->500, B->600. B wins at 600; A is second at 500. */
  function auctionABC(): void {
    openAuction();
    h.engine.placeBid('T01');
    h.engine.placeBid('T02');
    h.engine.placeBid('T03');
    h.engine.placeBid('T01');
    h.engine.placeBid('T02');
    h.engine.closeAuction();
  }

  it('moves only the winner when the winner is correct; second and third untouched', () => {
    auctionABC();
    expect(h.engine.currentPremium()?.activeTeamId).toBe('T02');
    // The reclaim ladder explicitly records first and second (spec 12).
    const ladder = h.engine.currentPremium()?.ladder ?? [];
    expect(ladder[0]?.teamId).toBe('T02');
    expect(ladder[0]?.amount).toBe(600);
    expect(ladder[1]?.teamId).toBe('T01');
    expect(ladder[1]?.amount).toBe(500);

    const beforeA = capital(h, 'T01');
    const beforeC = capital(h, 'T03');
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('correct');

    expect(capital(h, 'T02')).toBe(1500 + 600); // winner rewarded
    expect(capital(h, 'T01')).toBe(beforeA); // second bidder's bid NOT deducted
    expect(capital(h, 'T03')).toBe(beforeC); // third bidder never touched
  });
});

describe('reclaim: only the second bidder, and only if the winner fails (spec 7, 9, 10)', () => {
  /** Reach a failed winner (B) with A second and C third. */
  function winnerFails(): void {
    openAuction();
    h.engine.placeBid('T01'); // 200
    h.engine.placeBid('T02'); // 300
    h.engine.placeBid('T03'); // 400
    h.engine.placeBid('T01'); // 500  (A)
    h.engine.placeBid('T02'); // 600  (B wins)
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('wrong'); // B fails
  }

  it('offers the reclaim to the second bidder only, leaving the third untouched', () => {
    winnerFails();
    const prem = h.engine.currentPremium();
    expect(prem?.stage).toBe('reclaim_offer');
    expect(prem?.offerTeamId).toBe('T01'); // the second bidder
    expect(prem?.offerRisk).toBe(500); // their own original bid
    expect(capital(h, 'T03')).toBe(1500); // third bidder untouched
  });

  it('gives the second bidder a full 15-second window', () => {
    expect(DEFAULT_CONFIG.reclaimDecisionWindow).toBe(15);
    winnerFails();
    const prem = h.engine.currentPremium();
    const remaining = ((prem?.offerDeadline ?? 0) - Date.now()) / 1000;
    expect(remaining).toBeGreaterThan(13);
    expect(remaining).toBeLessThanOrEqual(15);
  });

  it('closes the premium when the second bidder sits out - never a third bidder', () => {
    winnerFails();
    const cBefore = capital(h, 'T03');
    h.engine.resolveReclaim('T01', false); // second bidder sits out
    const prem = h.engine.currentPremium();
    expect(prem?.stage).toBe('closed');
    expect(prem?.offerTeamId).toBeNull();
    // No third-bidder offer, no money moved for anyone else.
    expect(capital(h, 'T03')).toBe(cBefore);
    expect(capital(h, 'T01')).toBe(1500); // sat out -> unchanged
  });

  it('commits the second bidder\'s bid only when they take AND attempt', () => {
    winnerFails();
    const before = capital(h, 'T01');
    h.engine.resolveReclaim('T01', true); // TAKE
    expect(capital(h, 'T01')).toBe(before); // not deducted merely by accepting
    expect(h.engine.gameState().phase).toBe('premium_authorized');
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('wrong');
    expect(capital(h, 'T01')).toBe(before - 500); // committed now, and lost
  });

  it('rewards the second bidder if they take it and are correct', () => {
    winnerFails();
    const before = capital(h, 'T01');
    h.engine.resolveReclaim('T01', true);
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('correct');
    expect(capital(h, 'T01')).toBe(before + 500);
  });

  it('never offers a reclaim to a third bidder even via the operator', () => {
    winnerFails();
    // The only valid reclaim target is the second bidder (T01).
    expect(() => h.engine.offerReclaim('T03')).toThrow(/second bidder/i);
  });
});
