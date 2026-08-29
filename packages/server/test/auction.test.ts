import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capital, makeHarness, seedTeams, type Harness } from './helpers.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
  seedTeams(h, 8);
  h.engine.startGame();
  h.engine.openChallenge('C04'); // premium
});

afterEach(() => h.close());

describe('auction lifecycle (spec 11, 13)', () => {
  it('opens at the configured starting bid and increment', () => {
    const view = h.engine.startAuction('C04');
    expect(view.auction.startingBid).toBe(300);
    expect(view.auction.increment).toBe(100);
    expect(view.auction.currentBid).toBeNull();
    expect(view.nextBid).toBe(300);
  });

  it('uses the FINAL premium opening bid for challenge 12', () => {
    h.engine.openChallenge('C12');
    const view = h.engine.startAuction('C12');
    expect(view.auction.startingBid).toBe(500);
  });

  it('a click on a team places the next call automatically (no typing)', () => {
    h.engine.startAuction('C04');
    expect(h.engine.placeBid('T01').accepted).toBe(true);
    let view = h.engine.currentAuctionView();
    expect(view?.auction.currentBid).toBe(300);
    expect(view?.nextBid).toBe(400);

    expect(h.engine.placeBid('T02').accepted).toBe(true);
    view = h.engine.currentAuctionView();
    expect(view?.auction.currentBid).toBe(400);
    expect(view?.auction.currentLeaderTeamId).toBe('T02');
  });

  it('rejects the team that is already leading', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    const result = h.engine.placeBid('T01');
    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/highest bidder/);
  });

  it('rejects a bid above the protected-reserve ceiling', () => {
    h.engine.startAuction('C04');
    // T01 has 1000 capital, 500 reserve -> ceiling 500.
    expect(h.engine.placeBid('T01', 300).accepted).toBe(true);
    expect(h.engine.placeBid('T02', 400).accepted).toBe(true);
    expect(h.engine.placeBid('T01', 500).accepted).toBe(true);
    const over = h.engine.placeBid('T02', 600);
    expect(over.accepted).toBe(false);
    expect(over.message).toMatch(/max bid of 500/);
  });

  it('lets a rich team outbid a poor one (the reserve is not a flat cap)', () => {
    h.engine.adjustCapital('T03', 2000, 'test top-up'); // capital 3000 -> ceiling 2500
    h.engine.startAuction('C04');
    h.engine.placeBid('T01', 300);
    expect(h.engine.placeBid('T03', 1500).accepted).toBe(true);
    expect(h.engine.currentAuctionView()?.auction.currentBid).toBe(1500);
    // T01 cannot follow.
    expect(h.engine.placeBid('T01', 1600).accepted).toBe(false);
  });

  it('records rejected bids in the log for the audit trail', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01', 300);
    h.engine.placeBid('T02', 9999);
    const auctionId = h.engine.currentAuctionView()?.auction.id as number;
    const all = h.repo.listBids(auctionId, false);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ valid: false, rejectedReason: 'exceeds_max_bid' });
    expect(h.repo.listBids(auctionId, true)).toHaveLength(1);
  });

  it('reports who was outbid so the client can animate it', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.clearEvents();
    h.engine.placeBid('T02');
    const event = h.lastEvent<{ outbidTeamId: string | null }>('AUCTION_BID');
    expect(event?.outbidTeamId).toBe('T01');
  });

  it('supports going once / going twice and reopening on a fresh bid', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.engine.callAuction('once');
    expect(h.engine.currentAuctionView()?.auction.status).toBe('going_once');
    h.engine.callAuction('twice');
    expect(h.engine.currentAuctionView()?.auction.status).toBe('going_twice');
    h.engine.placeBid('T02');
    expect(h.engine.currentAuctionView()?.auction.status).toBe('open');
  });

  it('undoes an operator mis-click and restores the previous leader', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01'); // 300
    h.engine.placeBid('T02'); // 400
    h.engine.undoBid();
    const view = h.engine.currentAuctionView();
    expect(view?.auction.currentBid).toBe(300);
    expect(view?.auction.currentLeaderTeamId).toBe('T01');
    expect(view?.nextBid).toBe(400);
  });

  it('undo on an empty auction is an explicit error, not a silent no-op', () => {
    h.engine.startAuction('C04');
    expect(() => h.engine.undoBid()).toThrow(/nothing to undo/);
  });

  it('closes to the highest bidder', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.engine.placeBid('T02');
    h.engine.placeBid('T03');
    const view = h.engine.closeAuction();
    expect(view.auction.status).toBe('closed');
    expect(view.auction.winnerTeamId).toBe('T03');
    expect(view.auction.winningAmount).toBe(500);
  });

  it('rejects bids once the auction is closed', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.engine.closeAuction();
    const result = h.engine.placeBid('T02');
    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/not open/);
  });

  it('closes unsold when nobody bids, and closes the premium immediately', () => {
    h.engine.startAuction('C04');
    const view = h.engine.closeAuction();
    expect(view.auction.winnerTeamId).toBeNull();
    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('unsold');
  });

  it('authorises exactly one team after the hammer falls (spec 10)', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T05');
    h.engine.placeBid('T06');
    h.clearEvents();
    h.engine.closeAuction();

    const unlocked = h.lastEvent<{ teamId: string; risk: number }>('PREMIUM_UNLOCKED');
    expect(unlocked?.teamId).toBe('T06');
    expect(unlocked?.risk).toBe(400);

    expect(h.engine.teamView('T06')?.premiumUnlocked).toBe(true);
    expect(h.engine.teamView('T05')?.premiumUnlocked).toBe(false);
    expect(h.engine.teamView('T05')?.challengeState).toBe('locked');
  });

  it('refuses to let a non-winner unlock or join the premium', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T05');
    h.engine.closeAuction();
    expect(() => h.engine.unlockChallenge('T02', 'C04', 'PRM-6640')).toThrow(/locked/);
    expect(() => h.engine.joinChallenge('T02', 'C04')).toThrow(/locked/);
  });

  it('lets the winner open the premium with the printed key as a fallback', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T05');
    h.engine.closeAuction();
    expect(() => h.engine.unlockChallenge('T05', 'C04', 'PRM-6640')).not.toThrow();
  });

  it('builds the reclaim ladder from the original bidding order', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T03', 300);
    h.engine.placeBid('T07', 400);
    h.engine.placeBid('T05', 500);
    h.engine.closeAuction();

    const ladder = h.engine.currentPremium()?.ladder ?? [];
    expect(ladder.map((e) => e.teamId)).toEqual(['T05', 'T07', 'T03']);
    expect(ladder.map((e) => e.amount)).toEqual([500, 400, 300]);
    expect(ladder[0]?.state).toBe('winner');
  });

  it('cancels an auction cleanly and lets it be restarted', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.engine.cancelAuction();
    expect(h.engine.currentPremium()?.stage).toBe('idle');
    const restarted = h.engine.startAuction('C04');
    expect(restarted.auction.currentBid).toBeNull();
  });

  it('refuses to auction a market challenge', () => {
    h.engine.openChallenge('C01');
    expect(() => h.engine.startAuction('C01')).toThrow(/premium/);
  });

  it('refuses to re-auction a settled premium', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.engine.closeAuction();
    expect(() => h.engine.startAuction('C04')).toThrow(/already been auctioned/);
  });

  it('does not touch capital during bidding - only on the result', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01');
    h.engine.placeBid('T02');
    h.engine.closeAuction();
    expect(capital(h, 'T01')).toBe(1000);
    expect(capital(h, 'T02')).toBe(1000);
  });

  it('reports each team live auction position in its private view', () => {
    h.engine.startAuction('C04');
    h.engine.placeBid('T01', 300);
    h.engine.placeBid('T02', 400);
    const t01 = h.engine.teamView('T01');
    expect(t01?.inAuction).toBe(true);
    expect(t01?.myHighestBid).toBe(300);
    expect(t01?.maxBid).toBe(500);
    expect(h.engine.teamView('T08')?.inAuction).toBe(false);
  });
});
