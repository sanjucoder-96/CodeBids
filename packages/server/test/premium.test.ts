import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerFor, capital, makeHarness, seedTeams, type Harness } from './helpers.js';

let h: Harness;

/** Reproduce the spec section 15 auction exactly: T18 600, T12 500, T07 400, T03 300. */
function specAuction(harness: Harness): void {
  harness.engine.openChallenge('C04');
  harness.engine.startAuction('C04');
  harness.engine.placeBid('T03', 300);
  harness.engine.placeBid('T07', 400);
  harness.engine.placeBid('T12', 500);
  harness.engine.placeBid('T18', 600);
  harness.engine.closeAuction();
}

beforeEach(() => {
  h = makeHarness();
  seedTeams(h, 20);
  h.engine.startGame();
  // Everyone needs headroom to bid 600 (reserve 500).
  for (const id of ['T03', 'T07', 'T12', 'T18']) {
    h.engine.adjustCapital(id, 800, 'test headroom'); // 1800 capital, ceiling 1300
  }
});

afterEach(() => h.close());

describe('premium attempt 1 (spec 14)', () => {
  it('reproduces the spec 14 worked example exactly (1800, bid 700)', async () => {
    // Section 14: Team 17 holds 1800, wins at 700 -> 2500 correct / 1100 wrong.
    h.engine.openChallenge('C04');
    h.engine.startAuction('C04');
    h.engine.placeBid('T12', 600);
    h.engine.placeBid('T18', 700);
    h.engine.closeAuction();
    expect(capital(h, 'T18')).toBe(1800);

    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', true));
    expect(capital(h, 'T18')).toBe(2500);
  });

  it('reproduces the spec 14 worked example - wrong answer', async () => {
    h.engine.openChallenge('C04');
    h.engine.startAuction('C04');
    h.engine.placeBid('T12', 600);
    h.engine.placeBid('T18', 700);
    h.engine.closeAuction();

    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    expect(capital(h, 'T18')).toBe(1100);
  });

  it('adds exactly the winning bid on a correct answer', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', true));
    expect(capital(h, 'T18')).toBe(1800 + 600);
    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('won_first');
  });

  it('subtracts exactly the winning bid on a wrong answer', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    expect(capital(h, 'T18')).toBe(1800 - 600);
  });

  it('records the risk amount on the attempt row', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', true));
    const attempt = h.repo.listAttemptsForTeam('T18')[0];
    expect(attempt).toMatchObject({ riskAmount: 600, scoreChange: 600, attemptNumber: 1 });
  });

  it('refuses a submission from anyone but the authorised team', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await expect(
      h.engine.submitAnswer('T12', 'C04', answerFor(h, 'C04', true)),
    ).rejects.toThrow(/not currently attempting|not the authorised/);
    expect(capital(h, 'T12')).toBe(1800);
  });

  it('treats a premium timeout exactly like a wrong answer', () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    expect(h.engine.fireTimer('premium:C04')).toBe(true);
    expect(capital(h, 'T18')).toBe(1200);
    expect(h.repo.listAttemptsForTeam('T18')[0]?.result).toBe('timeout');
  });

  it('lets the operator record a result manually (spec 31)', () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('correct');
    expect(capital(h, 'T18')).toBe(2400);
  });
});

describe('reclaim (spec 15, 16, 17)', () => {
  it('offers the SAME question to the second-highest original bidder at their OWN bid', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    h.clearEvents();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));

    const offer = h.lastEvent<{ teamId: string; risk: number; failedTeamId: string }>(
      'PREMIUM_RECLAIM_OFFERED',
    );
    expect(offer?.teamId).toBe('T12');
    expect(offer?.risk).toBe(500); // T12's own original bid, not a new auction
    expect(offer?.failedTeamId).toBe('T18');

    // No second auction was created.
    expect(h.repo.listAuctions()).toHaveLength(1);
  });

  it('gives the candidate a short decision window', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    const premium = h.engine.currentPremium();
    const window = (premium?.offerDeadline ?? 0) - Date.now();
    expect(window).toBeGreaterThan(3500);
    expect(window).toBeLessThanOrEqual(5000);
    expect(h.engine.teamView('T12')?.reclaimOffer).toMatchObject({ risk: 500 });
  });

  it('walks to the next bidder when the candidate declines', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.clearEvents();
    h.engine.resolveReclaim('T12', false);

    const declined = h.lastEvent<{ nextTeamId: string }>('PREMIUM_RECLAIM_DECLINED');
    expect(declined?.nextTeamId).toBe('T07');
    const offer = h.lastEvent<{ teamId: string; risk: number }>('PREMIUM_RECLAIM_OFFERED');
    expect(offer).toMatchObject({ teamId: 'T07', risk: 400 });
    expect(capital(h, 'T12')).toBe(1800); // declining costs nothing
  });

  it('reproduces the full spec walk: T18 fails, T12 declines, T07 accepts', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.engine.resolveReclaim('T12', false);
    h.engine.resolveReclaim('T07', true);

    const premium = h.engine.currentPremium();
    expect(premium?.activeTeamId).toBe('T07');
    expect(premium?.activeRisk).toBe(400);
    expect(premium?.ladder.map((e) => e.state)).toEqual([
      'failed',
      'declined',
      'accepted',
      'pending',
    ]);
  });

  it('settles attempt 2 against the reclaim bidder own risk', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.engine.resolveReclaim('T12', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T12', 'C04', answerFor(h, 'C04', true));

    expect(capital(h, 'T12')).toBe(1800 + 500);
    expect(capital(h, 'T18')).toBe(1800 - 600);
    expect(h.engine.currentPremium()?.outcome).toBe('won_reclaim');
  });

  it('closes the premium permanently when attempt 2 also fails - no third attempt', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.engine.resolveReclaim('T12', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T12', 'C04', answerFor(h, 'C04', false));

    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('lost');
    expect(premium?.attemptNumber).toBe(2);
    expect(capital(h, 'T12')).toBe(1300);

    // No third offer was made to T07 even though T07 is still on the ladder.
    expect(h.engine.teamView('T07')?.reclaimOffer).toBeNull();
    expect(() => h.engine.startPremiumAttempt()).toThrow(/both attempts|authorised/);
    expect(() => h.engine.offerReclaim('T07')).toThrow(/both attempts/);
  });

  it('closes the premium when every candidate declines', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.engine.resolveReclaim('T12', false);
    h.engine.resolveReclaim('T07', false);
    h.engine.resolveReclaim('T03', false);

    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('no_takers');
    // Only the original winner lost capital.
    expect(capital(h, 'T12')).toBe(1800);
    expect(capital(h, 'T07')).toBe(1800);
    expect(capital(h, 'T03')).toBe(1800);
  });

  it('closes immediately when the winner was the only bidder', async () => {
    h.engine.openChallenge('C04');
    h.engine.startAuction('C04');
    h.engine.placeBid('T18', 300);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));

    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('closed');
    expect(premium?.outcome).toBe('no_takers');
  });

  it('auto-declines when the decision window expires', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.clearEvents();
    expect(h.engine.fireTimer('reclaim:C04')).toBe(true);

    const declined = h.lastEvent<{ teamId: string; expired: boolean; nextTeamId: string }>(
      'PREMIUM_RECLAIM_DECLINED',
    );
    expect(declined).toMatchObject({ teamId: 'T12', expired: true, nextTeamId: 'T07' });
    expect(h.engine.currentPremium()?.offerTeamId).toBe('T07');
  });

  it('rejects a reclaim response from the wrong team', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    expect(() => h.engine.resolveReclaim('T07', true)).toThrow(/not addressed to your team/);
  });

  it('rejects a reclaim response when no offer is open', () => {
    specAuction(h);
    expect(() => h.engine.resolveReclaim('T12', true)).toThrow(/no reclaim offer/i);
  });

  it('does not offer a reclaim when the winner succeeds', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', true));
    expect(h.eventsOf('PREMIUM_RECLAIM_OFFERED')).toHaveLength(0);
    expect(h.engine.currentPremium()?.ladder.every((e) => e.state !== 'offered')).toBe(true);
  });

  it('reveals the question to the reclaim bidder only after they accept and start', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));

    let snapshot = h.engine.snapshot('participant', 'T12', 0);
    expect(snapshot.challenge?.revealed).toBe(false);

    h.engine.resolveReclaim('T12', true);
    h.engine.startPremiumAttempt();
    snapshot = h.engine.snapshot('participant', 'T12', 0);
    expect(snapshot.challenge?.revealed).toBe(true);
    expect(snapshot.challenge?.question.items?.length).toBeGreaterThan(0);

    // A bystander still sees nothing.
    const other = h.engine.snapshot('participant', 'T03', 0);
    expect(other.challenge?.revealed).toBe(false);
  });

  it('a reclaim never creates a second auction or a new question', async () => {
    specAuction(h);
    const challengesBefore = h.engine.listChallenges().length;
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.engine.resolveReclaim('T12', true);
    h.engine.startPremiumAttempt();

    expect(h.repo.listAuctions()).toHaveLength(1);
    expect(h.engine.listChallenges()).toHaveLength(challengesBefore);
    expect(h.engine.gameState().currentChallengeId).toBe('C04');
  });

  it('writes a complete, ordered audit trail for the dispute case (spec 35)', async () => {
    specAuction(h);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C04', answerFor(h, 'C04', false));
    h.engine.resolveReclaim('T12', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T12', 'C04', answerFor(h, 'C04', true));

    const actions = h.engine.listAudit().map((a) => `${a.teamId ?? '-'}:${a.action}`);
    expect(actions).toContain('T18:AUCTION_BID');
    expect(actions).toContain('T18:AUCTION_WON');
    expect(actions).toContain('T18:PREMIUM_RESULT');
    expect(actions).toContain('T12:PREMIUM_RECLAIM_OFFERED');
    expect(actions).toContain('T12:PREMIUM_RECLAIM_ACCEPTED');
    expect(actions).toContain('T12:PREMIUM_RESULT');
    expect(actions).toContain('T12:CAPITAL_CHANGED');

    const capitalChange = h.engine
      .listAudit()
      .filter((a) => a.action === 'CAPITAL_CHANGED' && a.teamId === 'T12')
      .at(-1);
    expect(capitalChange?.metadata).toMatchObject({ from: 1800, to: 2300, delta: 500 });
  });
});

describe('final premium (spec 29)', () => {
  it('runs the same rules with the final opening bid and a longer clock', async () => {
    h.engine.openChallenge('C12');
    expect(h.engine.gameState().phase).toBe('final');
    const view = h.engine.startAuction('C12');
    expect(view.auction.startingBid).toBe(500);

    h.engine.placeBid('T18', 500);
    h.engine.placeBid('T12', 600);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T12', 'C12', answerFor(h, 'C12', true));
    expect(capital(h, 'T12')).toBe(2400);
  });

  it('still allows exactly two attempts in the final', async () => {
    h.engine.openChallenge('C12');
    h.engine.startAuction('C12');
    h.engine.placeBid('T18', 500);
    h.engine.placeBid('T12', 600);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T12', 'C12', answerFor(h, 'C12', false));
    h.engine.resolveReclaim('T18', true);
    h.engine.startPremiumAttempt();
    await h.engine.submitAnswer('T18', 'C12', answerFor(h, 'C12', false));
    expect(h.engine.currentPremium()?.outcome).toBe('lost');
    expect(() => h.engine.startPremiumAttempt()).toThrow();
  });
});
