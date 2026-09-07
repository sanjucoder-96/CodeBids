/**
 * Auctions, premium settlement and the reclaim ladder (spec 7, 8, 9).
 * The physical-paddle model is unchanged; only the sequencing around it moved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advanceTo,
  answerFor,
  capital,
  makeHarness,
  seedTeams,
  startRound,
  type Harness,
} from './helpers.js';
import type { Question } from '@code-market/shared';

let h: Harness;
let question: Question;

/** Open the first premium with plenty of bidding headroom. */
function openPremium(teams = 8, headroom = 900): void {
  startRound(h, teams);
  for (let i = 1; i <= Math.min(teams, 6); i++) {
    h.engine.adjustCapital(`T0${i}`, headroom, 'headroom');
  }
  const slot = advanceTo(h, (s) => s.kind === 'premium');
  question = h.repo.getQuestion(slot.questionId) as Question;
}

beforeEach(() => {
  h = makeHarness();
});

afterEach(() => h.close());

describe('auction mechanics (spec 7, 9)', () => {
  it('opens at the ₹200 minimum and accepts higher free-form bids', () => {
    openPremium();
    const view = h.engine.startAuction();
    expect(view.auction.startingBid).toBe(200);
    expect(view.nextBid).toBe(200);

    // A team enters its own amount; it must be at least the minimum.
    expect(h.engine.placeBid('T01', 200).accepted).toBe(true);
    expect(h.engine.currentAuctionView()?.auction.currentBid).toBe(200);
    // The next team must beat the current bid by any amount.
    expect(h.engine.placeBid('T02', 350).accepted).toBe(true);
    expect(h.engine.currentAuctionView()?.auction.currentBid).toBe(350);
  });

  it('rejects an opening bid below the ₹200 minimum', () => {
    openPremium();
    h.engine.startAuction();
    const low = h.engine.placeBid('T01', 199);
    expect(low.accepted).toBe(false);
    expect(low.message).toMatch(/at least 200/);
  });

  it('lets a team bid up to its whole purse, and no further (spec 4)', () => {
    startRound(h, 6);
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.startAuction();
    // Every team starts on ₹1,500 with no protected reserve: the ceiling is
    // the full purse. ₹1,500 is valid, ₹1,501 is not.
    expect(h.engine.placeBid('T01', 1400).accepted).toBe(true);
    expect(h.engine.placeBid('T02', 1500).accepted).toBe(true);
    const over = h.engine.placeBid('T01', 1501);
    expect(over.accepted).toBe(false);
    expect(over.message).toMatch(/1500/);
  });

  it('lets a richer team bid higher', () => {
    openPremium();
    h.engine.adjustCapital('T03', 2000, 'top up');
    h.engine.startAuction();
    h.engine.placeBid('T01', 300);
    expect(h.engine.placeBid('T03', 2000).accepted).toBe(true);
  });

  it('rejects the current leader bidding against itself', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01');
    expect(h.engine.placeBid('T01').accepted).toBe(false);
  });

  it('records rejected bids for the audit trail', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 300);
    h.engine.placeBid('T02', 99_999);
    const auctionId = h.engine.currentAuctionView()?.auction.id as number;
    const all = h.repo.listBids(auctionId, false);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ valid: false, rejectedReason: 'exceeds_max_bid' });
  });

  it('undoes an operator mis-click', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 300);
    h.engine.placeBid('T02', 400);
    h.engine.undoBid();
    const view = h.engine.currentAuctionView();
    expect(view?.auction.currentBid).toBe(300);
    expect(view?.auction.currentLeaderTeamId).toBe('T01');
  });

  it('supports going once / going twice and reopening', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 300);
    h.engine.callAuction('once');
    expect(h.engine.currentAuctionView()?.auction.status).toBe('going_once');
    h.engine.callAuction('twice');
    expect(h.engine.currentAuctionView()?.auction.status).toBe('going_twice');
    h.engine.placeBid('T02', 400);
    expect(h.engine.currentAuctionView()?.auction.status).toBe('open');
  });

  it('authorises exactly one team when the hammer falls', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T05', 300);
    h.engine.placeBid('T06', 400);
    h.clearEvents();
    h.engine.closeAuction();

    expect(h.lastEvent<{ teamId: string; risk: number }>('PREMIUM_UNLOCKED')).toMatchObject({
      teamId: 'T06',
      risk: 400,
    });
    expect(h.engine.teamView('T06')?.premiumUnlocked).toBe(true);
    expect(h.engine.teamView('T05')?.premiumUnlocked).toBe(false);
  });

  it('closes unsold when nobody bids', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.closeAuction();
    expect(h.engine.currentPremium()?.outcome).toBe('unsold');
  });

  it('does not touch capital during bidding', () => {
    openPremium();
    const before = capital(h, 'T01');
    h.engine.startAuction();
    h.engine.placeBid('T01');
    h.engine.placeBid('T02');
    h.engine.closeAuction();
    expect(capital(h, 'T01')).toBe(before);
  });
});

describe('premium settlement (spec 9)', () => {
  it('adds the winning bid on a correct answer', async () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T02', 600);
    h.engine.placeBid('T01', 700);
    h.engine.closeAuction();
    const before = capital(h, 'T01');

    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T01', question.id, answerFor(question, true));
    expect(capital(h, 'T01')).toBe(before + 700);
    expect(h.engine.currentPremium()?.outcome).toBe('won_first');
  });

  it('subtracts the winning bid on a wrong answer', async () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T02', 600);
    h.engine.placeBid('T01', 700);
    h.engine.closeAuction();
    const before = capital(h, 'T01');

    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T01', question.id, answerFor(question, false));
    expect(capital(h, 'T01')).toBe(before - 700);
  });

  it('treats a premium timeout exactly like a wrong answer', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 500);
    h.engine.closeAuction();
    const before = capital(h, 'T01');
    h.engine.startPremiumAttempt();
    expect(h.engine.fireTimer(`premium:${question.id}`)).toBe(true);
    expect(capital(h, 'T01')).toBe(before - 500);
  });

  it('refuses a submission from anyone but the authorised team', async () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 400);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    await expect(
      h.engine.submitAnswer('T02', question.id, answerFor(question, true)),
    ).rejects.toThrow();
  });
});

describe('reclaim (spec 8)', () => {
  /** T18-style ladder: T03 300, T07 400, T12 500, T18 600. */
  async function ladderAuction(): Promise<void> {
    openPremium(8, 900);
    h.engine.startAuction();
    h.engine.placeBid('T03', 300);
    h.engine.placeBid('T04', 400);
    h.engine.placeBid('T05', 500);
    h.engine.placeBid('T06', 600);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T06', question.id, answerFor(question, false));
  }

  it('offers the SAME question to the next original bidder at their OWN bid', async () => {
    await ladderAuction();
    const offer = h.lastEvent<{ teamId: string; risk: number; failedTeamId: string }>(
      'PREMIUM_RECLAIM_OFFERED',
    );
    expect(offer).toMatchObject({ teamId: 'T05', risk: 500, failedTeamId: 'T06' });
    // No second auction was created.
    expect(h.repo.listAuctions()).toHaveLength(1);
  });

  it('walks down the ladder on a decline', async () => {
    await ladderAuction();
    h.clearEvents();
    h.engine.resolveReclaim('T05', false);
    expect(h.lastEvent<{ teamId: string; risk: number }>('PREMIUM_RECLAIM_OFFERED')).toMatchObject({
      teamId: 'T04',
      risk: 400,
    });
  });

  it('settles attempt 2 against the reclaim team own bid', async () => {
    await ladderAuction();
    const before = capital(h, 'T05');
    h.engine.resolveReclaim('T05', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T05', question.id, answerFor(question, true));

    expect(capital(h, 'T05')).toBe(before + 500);
    expect(h.engine.currentPremium()?.outcome).toBe('won_reclaim');
  });

  it('never allows a third attempt', async () => {
    await ladderAuction();
    h.engine.resolveReclaim('T05', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T05', question.id, answerFor(question, false));

    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('lost');
    expect(premium?.attemptNumber).toBe(2);
    expect(() => h.engine.startPremiumAttempt()).toThrow();
    expect(() => h.engine.offerReclaim('T04')).toThrow(/both attempts/);
  });

  it('closes when every candidate declines, and declining is free', async () => {
    await ladderAuction();
    const before = capital(h, 'T05');
    h.engine.resolveReclaim('T05', false);
    h.engine.resolveReclaim('T04', false);
    h.engine.resolveReclaim('T03', false);

    expect(h.engine.currentPremium()?.outcome).toBe('no_takers');
    expect(capital(h, 'T05')).toBe(before);
  });

  it('auto-declines when the decision window lapses', async () => {
    await ladderAuction();
    h.clearEvents();
    expect(h.engine.fireTimer(`reclaim:${question.id}`)).toBe(true);
    expect(h.lastEvent<{ expired: boolean; nextTeamId: string }>('PREMIUM_RECLAIM_DECLINED')).toMatchObject(
      { expired: true, nextTeamId: 'T04' },
    );
  });

  it('rejects a response from the wrong team', async () => {
    await ladderAuction();
    expect(() => h.engine.resolveReclaim('T04', true)).toThrow(/not addressed to your team/);
  });

  it('writes a complete audit trail for dispute resolution', async () => {
    await ladderAuction();
    h.engine.resolveReclaim('T05', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T05', question.id, answerFor(question, true));

    const actions = h.engine.listAudit().map((a) => `${a.teamId ?? '-'}:${a.action}`);
    expect(actions).toContain('T06:AUCTION_WON');
    expect(actions).toContain('T06:PREMIUM_RESULT');
    expect(actions).toContain('T05:PREMIUM_RECLAIM_OFFERED');
    expect(actions).toContain('T05:PREMIUM_RECLAIM_ACCEPTED');
    expect(actions).toContain('T05:PREMIUM_RESULT');
    expect(actions).toContain('T05:CAPITAL_CHANGED');
  });
});

describe('organizer dossier (spec 12)', () => {
  it('records the full history of a team', async () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 300);
    h.engine.placeBid('T02', 400);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T02', question.id, answerFor(question, true));

    const dossier = h.engine.teamDossier('T02');
    expect(dossier?.team.id).toBe('T02');
    expect(dossier?.joinCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(dossier?.rank).toBeGreaterThan(0);
    expect(dossier?.bids.length).toBeGreaterThan(0);
    expect(dossier?.bids[0]).toMatchObject({ amount: 400, won: true });
    expect(dossier?.attempts[0]).toMatchObject({ result: 'correct' });
    expect(dossier?.attempts[0]?.domain).toBeTruthy();
    expect(dossier?.attempts[0]?.difficulty).toBeTruthy();
    expect(dossier?.premiums[0]).toMatchObject({ role: 'winner', outcome: 'won_first' });
    expect(dossier?.transactions.length).toBeGreaterThan(1);
    expect(dossier?.audit.length).toBeGreaterThan(0);
  });

  it('shows a losing bidder as a bidder, not a winner', () => {
    openPremium();
    h.engine.startAuction();
    h.engine.placeBid('T01', 300);
    h.engine.placeBid('T02', 400);
    h.engine.closeAuction();

    const dossier = h.engine.teamDossier('T01');
    expect(dossier?.premiums[0]?.role).toBe('bidder');
    expect(dossier?.bids[0]?.won).toBe(false);
  });

  it('returns null for an unknown team', () => {
    seedTeams(h, 1);
    expect(h.engine.teamDossier('NOPE')).toBeNull();
  });
});
