import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, applyConfigPatch, formatMoney, formatDelta } from './config.js';
import {
  maxBid,
  nextBidAmount,
  resolveAdjustment,
  resolveQuestion,
  resolvePremium,
  questionReward,
  questionPenalty,
  speedBonus,
  validateBid,
} from './economy.js';
import type { Question } from './types.js';

const cfg = DEFAULT_CONFIG;

const challenge = (over: Partial<Question> = {}): Question => ({
  id: 'Q01',
  kind: 'normal',
  title: 'Test',
  domain: 'logic',
  type: 'mcq',
  difficulty: 'easy',
  timeLimit: 120,
  question: { prompt: 'q' },
  evaluation: {},
  accessKey: 'KEY',
  ...over,
});

describe('protected reserve / max bid (spec 8)', () => {
  it('matches the three worked examples in the spec', () => {
    expect(maxBid(2500, 500)).toBe(2000);
    expect(maxBid(1400, 500)).toBe(900);
    expect(maxBid(900, 500)).toBe(400);
  });

  it('never returns a negative ceiling', () => {
    expect(maxBid(300, 500)).toBe(0);
    expect(maxBid(0, 500)).toBe(0);
  });

  it('is not a flat cap - richer teams can bid more', () => {
    expect(maxBid(5000, 500)).toBeGreaterThan(maxBid(1000, 500));
  });

  it('floors fractional capital', () => {
    expect(maxBid(1000.9, 500)).toBe(500);
  });
});

describe('nextBidAmount', () => {
  it('opens at the starting bid then climbs by the increment', () => {
    expect(nextBidAmount(null, 300, 100)).toBe(300);
    expect(nextBidAmount(300, 300, 100)).toBe(400);
    expect(nextBidAmount(700, 300, 100)).toBe(800);
  });
});

describe('validateBid (server-authoritative, spec 8/13)', () => {
  const base = {
    amount: 400,
    teamCapital: 2000,
    protectedReserve: 500,
    currentBid: 300,
    startingBid: 300,
    increment: 100,
    auctionOpen: true,
    isCurrentLeader: false,
    teamActive: true,
  };

  it('accepts a legal on-increment bid', () => {
    const r = validateBid(base);
    expect(r.valid).toBe(true);
    expect(r.minimumRequired).toBe(400);
    expect(r.teamMaxBid).toBe(1500);
  });

  it('rejects a bid below the next call', () => {
    const r = validateBid({ ...base, amount: 350 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('below_minimum');
  });

  it('rejects an off-increment bid', () => {
    const r = validateBid({ ...base, amount: 450 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('not_on_increment');
  });

  it('allows off-increment jumps when the operator disables enforcement', () => {
    expect(validateBid({ ...base, amount: 450, enforceIncrement: false }).valid).toBe(true);
  });

  it('rejects a bid above the protected-reserve ceiling', () => {
    const r = validateBid({ ...base, amount: 1600, teamCapital: 2000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('exceeds_max_bid');
    expect(r.message).toContain('1500');
  });

  it('accepts a bid exactly at the ceiling', () => {
    expect(validateBid({ ...base, amount: 1500, teamCapital: 2000 }).valid).toBe(true);
  });

  it('rejects when the auction is closed', () => {
    expect(validateBid({ ...base, auctionOpen: false }).reason).toBe('auction_not_open');
  });

  it('rejects the team that is already leading', () => {
    expect(validateBid({ ...base, isCurrentLeader: true }).reason).toBe('already_leading');
  });

  it('rejects inactive teams', () => {
    expect(validateBid({ ...base, teamActive: false }).reason).toBe('team_inactive');
  });

  it('rejects non-positive and non-finite amounts', () => {
    expect(validateBid({ ...base, amount: 0 }).valid).toBe(false);
    expect(validateBid({ ...base, amount: Number.NaN }).valid).toBe(false);
  });

  it('opens at the starting bid when no bid exists yet', () => {
    const r = validateBid({ ...base, currentBid: null, amount: 300 });
    expect(r.valid).toBe(true);
    expect(r.minimumRequired).toBe(300);
  });

  it('a poor team cannot reach the opening bid', () => {
    const r = validateBid({ ...base, currentBid: null, amount: 300, teamCapital: 700 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('exceeds_max_bid');
  });
});

describe('question economy', () => {
  it('scales reward by difficulty', () => {
    expect(questionReward(cfg, challenge({ difficulty: 'easy' }), 1000)).toBe(200);
    expect(questionReward(cfg, challenge({ difficulty: 'medium' }), 1000)).toBe(300);
    expect(questionReward(cfg, challenge({ difficulty: 'hard' }), 1000)).toBe(400);
  });

  it('honours a per-question override', () => {
    expect(questionReward(cfg, challenge({ rewardOverride: 777 }), 1000)).toBe(777);
    expect(questionPenalty(cfg, challenge({ penaltyOverride: 42 }), 1000)).toBe(42);
  });

  it('supports a percent-of-capital mode with clamping', () => {
    const pct = {
      ...cfg,
      questionReward: { ...cfg.questionReward, mode: 'percent' as const, min: 50, max: 400 },
    };
    expect(questionReward(pct, challenge(), 2000)).toBe(200);
    expect(questionReward(pct, challenge(), 100)).toBe(50); // clamped to min
    expect(questionReward(pct, challenge(), 100000)).toBe(400); // clamped to max
  });

  it('supports a fixed mode', () => {
    const fixed = { ...cfg, questionReward: { ...cfg.questionReward, mode: 'fixed' as const } };
    expect(questionReward(fixed, challenge({ difficulty: 'hard' }), 1000)).toBe(200);
  });

  it('adds capital on a correct answer', () => {
    const r = resolveQuestion(cfg, challenge({ difficulty: 'medium' }), 1000, 'correct');
    expect(r.delta).toBe(300);
    expect(r.newCapital).toBe(1300);
  });

  it('subtracts capital on a wrong answer', () => {
    const r = resolveQuestion(cfg, challenge({ difficulty: 'medium' }), 1000, 'wrong');
    expect(r.delta).toBe(-150);
    expect(r.newCapital).toBe(850);
  });

  it('treats timeout as wrong by default and as free when configured', () => {
    expect(resolveQuestion(cfg, challenge(), 1000, 'timeout').delta).toBe(-100);
    const lenient = { ...cfg, timeoutPenalised: false };
    expect(resolveQuestion(lenient, challenge(), 1000, 'timeout').delta).toBe(0);
  });

  it('charges nothing for a skip', () => {
    expect(resolveQuestion(cfg, challenge(), 1000, 'skipped').delta).toBe(0);
  });

  it('honours the penalty kill switch', () => {
    const free = { ...cfg, penaltyEnabled: false };
    expect(resolveQuestion(free, challenge(), 1000, 'wrong').delta).toBe(0);
  });

  it('clamps losses at the capital floor', () => {
    const r = resolveQuestion(cfg, challenge({ difficulty: 'hard' }), 50, 'wrong');
    expect(r.newCapital).toBe(0);
    expect(r.delta).toBe(-50);
    expect(r.rawDelta).toBe(-200);
    expect(r.clamped).toBe(true);
  });

  it('question losses may go below the protected reserve (reserve only caps bids)', () => {
    const r = resolveQuestion(cfg, challenge(), 600, 'wrong');
    expect(r.newCapital).toBe(500);
    const again = resolveQuestion(cfg, challenge(), 500, 'wrong');
    expect(again.newCapital).toBe(400);
  });

  it('awards a linear speed bonus when enabled', () => {
    const fast = { ...cfg, speedBonusEnabled: true, speedBonusMax: 50 };
    expect(speedBonus(fast, 100, 0)).toBe(50);
    expect(speedBonus(fast, 100, 50_000)).toBe(25);
    expect(speedBonus(fast, 100, 100_000)).toBe(0);
    expect(speedBonus(fast, 100, 200_000)).toBe(0);
    expect(speedBonus(cfg, 100, 0)).toBe(0);
  });
});

describe('premium settlement (spec 14)', () => {
  it('reproduces the worked example - correct', () => {
    const r = resolvePremium(cfg, 1800, 700, 'correct');
    expect(r.newCapital).toBe(2500);
    expect(r.delta).toBe(700);
  });

  it('reproduces the worked example - wrong', () => {
    const r = resolvePremium(cfg, 1800, 700, 'wrong');
    expect(r.newCapital).toBe(1100);
    expect(r.delta).toBe(-700);
  });

  it('treats timeout exactly like wrong', () => {
    expect(resolvePremium(cfg, 1800, 700, 'timeout').newCapital).toBe(1100);
  });

  it('cannot push a team below the floor', () => {
    const r = resolvePremium(cfg, 400, 700, 'wrong');
    expect(r.newCapital).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it('a legal bid can never bankrupt a team below the reserve', () => {
    const capital = 1400;
    const legalBid = maxBid(capital, cfg.protectedReserve);
    const r = resolvePremium(cfg, capital, legalBid, 'wrong');
    expect(r.newCapital).toBe(cfg.protectedReserve);
  });
});

describe('manual adjustment', () => {
  it('applies signed amounts and clamps', () => {
    expect(resolveAdjustment(cfg, 1000, 250).newCapital).toBe(1250);
    expect(resolveAdjustment(cfg, 1000, -250).newCapital).toBe(750);
    expect(resolveAdjustment(cfg, 100, -500).newCapital).toBe(0);
  });
});

describe('config validation (spec 47)', () => {
  it('accepts a valid patch', () => {
    const r = applyConfigPatch(cfg, { startingCapital: 1500, blocks: 6 });
    expect(r.ok).toBe(true);
    expect(r.config.startingCapital).toBe(1500);
    expect(r.config.blocks).toBe(6);
  });

  it('rejects negative values and keeps the previous number', () => {
    const r = applyConfigPatch(cfg, { startingCapital: -5 });
    expect(r.ok).toBe(false);
    expect(r.config.startingCapital).toBe(cfg.startingCapital);
  });

  it('rejects a reserve larger than starting capital', () => {
    const r = applyConfigPatch(cfg, { protectedReserve: 5000 });
    expect(r.ok).toBe(false);
    expect(r.config.protectedReserve).toBe(cfg.protectedReserve);
  });

  it('rejects a zero increment', () => {
    const r = applyConfigPatch(cfg, { premiumBidIncrement: 0 });
    expect(r.ok).toBe(false);
    expect(r.config.premiumBidIncrement).toBe(cfg.premiumBidIncrement);
  });

  it('deep-merges nested reward rules', () => {
    const r = applyConfigPatch(cfg, { questionReward: { base: 500 } as never });
    expect(r.config.questionReward.base).toBe(500);
    expect(r.config.questionReward.mode).toBe(cfg.questionReward.mode);
  });

  it('rejects a block count below one', () => {
    expect(applyConfigPatch(cfg, { blocks: 0 }).ok).toBe(false);
  });

  it('rejects a non-positive solve time', () => {
    const r = applyConfigPatch(cfg, { difficultyTimes: { ...cfg.difficultyTimes, hard: 0 } });
    expect(r.ok).toBe(false);
    expect(r.config.difficultyTimes.hard).toBe(120);
  });
});

describe('money formatting', () => {
  it('formats with the Indian grouping and the configured symbol', () => {
    expect(formatMoney(2500)).toBe('₹2,500');
    expect(formatMoney(-700)).toBe('-₹700');
    expect(formatDelta(700)).toBe('+₹700');
    expect(formatDelta(-700)).toBe('-₹700');
    expect(formatDelta(0)).toBe('₹0');
  });
});
