/**
 * The new premium economy (spec sections 1-7).
 *
 * ₹1,500 purse, ₹200 minimum bid, full-purse eligibility, first-received tie
 * break, and the 15-second TAKE / SIT-OUT window with a server-authoritative
 * synchronised start.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceTo, capital, makeHarness, startRound, type Harness } from './helpers.js';
import { DEFAULT_CONFIG } from '@code-market/shared';

let h: Harness;

/** Reach the first premium and open its auction. */
function openAuction(): void {
  startRound(h, 6);
  advanceTo(h, (s) => s.kind === 'premium');
  h.engine.startAuction();
}

beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.close());

describe('starting purse and minimum bid (spec 1, 2)', () => {
  it('starts every team on ₹1,500', () => {
    expect(DEFAULT_CONFIG.startingCapital).toBe(1500);
    startRound(h, 4);
    expect(capital(h, 'T01')).toBe(1500);
  });

  it('sets the premium minimum bid to ₹200', () => {
    expect(DEFAULT_CONFIG.premiumStartingBid).toBe(200);
    expect(DEFAULT_CONFIG.finalPremiumStartingBid).toBe(200);
    openAuction();
    expect(h.engine.currentAuctionView()?.auction.startingBid).toBe(200);
  });

  it('rejects an opening bid below ₹200', () => {
    openAuction();
    expect(h.engine.placeBid('T01', 199).accepted).toBe(false);
    expect(h.engine.placeBid('T01', 200).accepted).toBe(true);
  });
});

describe('purse eligibility (spec 4)', () => {
  it('accepts a bid equal to the purse and rejects one above it', () => {
    openAuction();
    // Every team is on ₹1,500 with no reserve.
    expect(h.engine.placeBid('T01', 1400).accepted).toBe(true);
    expect(h.engine.placeBid('T02', 1500).accepted).toBe(true);
    const over = h.engine.placeBid('T03', 1501);
    expect(over.accepted).toBe(false);
    expect(over.message).toMatch(/1500/);
  });
});

describe('tie break: first valid server-received bid wins (spec 5)', () => {
  it('keeps the earlier of two equal bids as the leader', () => {
    openAuction();
    // A opens at 500; B then submits the same 500. A got there first.
    expect(h.engine.placeBid('T01', 500).accepted).toBe(true);
    const second = h.engine.placeBid('T02', 500);
    expect(second.accepted).toBe(false);
    expect(h.engine.currentAuctionView()?.auction.currentLeaderTeamId).toBe('T01');
    // B must exceed to take the lead.
    expect(h.engine.placeBid('T02', 501).accepted).toBe(true);
    expect(h.engine.currentAuctionView()?.auction.currentLeaderTeamId).toBe('T02');
  });

  it('rejects a bid once the auction has closed', () => {
    openAuction();
    h.engine.placeBid('T01', 300);
    h.engine.closeAuction();
    expect(h.engine.placeBid('T02', 900).accepted).toBe(false);
  });
});

describe('15-second take / sit-out window (spec 6, 7)', () => {
  function win(): string {
    openAuction();
    h.engine.placeBid('T01', 400);
    h.engine.closeAuction();
    return 'T01';
  }

  it('opens the decision window for the winner after the auction', () => {
    const winner = win();
    expect(h.engine.gameState().phase).toBe('premium_decision');
    const view = h.engine.teamView(winner);
    expect(view?.canDecidePremium).toBe(true);
    expect(view?.premiumDecisionDeadline).toBeGreaterThan(Date.now());
    // A non-winner cannot decide.
    expect(h.engine.teamView('T02')?.canDecidePremium).toBe(false);
  });

  it('starts the attempt synchronously when the winner TAKES it', () => {
    const winner = win();
    h.engine.submitPremiumDecision(winner, true);
    expect(h.engine.gameState().phase).toBe('premium_solving');
    expect(h.engine.currentPremium()?.activeTeamId).toBe(winner);
  });

  it('closes the premium with no risk when the winner SITS OUT', () => {
    const winner = win();
    const before = capital(h, winner);
    h.engine.submitPremiumDecision(winner, false);
    expect(h.engine.gameState().phase).toBe('premium_result');
    expect(capital(h, winner)).toBe(before);
    expect(h.engine.currentPremium()?.outcome).toBe('no_takers');
  });

  it('defaults to SIT OUT when the winner never chooses', () => {
    const winner = win();
    const before = capital(h, winner);
    // The window lapses: the server timer fires and closes it.
    expect(h.engine.fireTimer(`decision:${h.engine.currentSlot()?.questionId}`)).toBe(true);
    expect(h.engine.gameState().phase).toBe('premium_result');
    expect(capital(h, winner)).toBe(before);
  });

  it('refuses a decision from a team that did not win', () => {
    win();
    expect(() => h.engine.submitPremiumDecision('T02', true)).toThrow(/cannot take/i);
  });

  it('refuses a decision once the window is closed', () => {
    const winner = win();
    h.engine.submitPremiumDecision(winner, true); // window resolved -> solving
    expect(() => h.engine.submitPremiumDecision(winner, true)).toThrow();
  });
});
