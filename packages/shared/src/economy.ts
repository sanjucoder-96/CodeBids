/**
 * The capital engine (spec sections 7, 8, 14).
 *
 * Pure, deterministic, and fully unit-tested. The server is the only caller in
 * production; clients import the same functions purely to *preview* numbers
 * (e.g. "MAX BID"), never to decide anything.
 */

import type { GameConfig, RewardRule } from './config.js';
import type { Difficulty, Question, Team } from './types.js';

/* ------------------------------------------------------------------ *
 * Protected reserve / bidding power
 * ------------------------------------------------------------------ */

/**
 * Maximum legal bid = current capital - protected reserve.
 *
 * A rich team can bid more than a poor team, which is the whole point of the
 * risk/reward design: the reserve is a floor on what a team can *lose in an
 * auction*, not a flat bid cap.
 */
export function maxBid(capital: number, protectedReserve: number): number {
  return Math.max(0, Math.floor(capital - protectedReserve));
}

export function maxBidForTeam(team: Pick<Team, 'capital' | 'protectedReserve'>): number {
  return maxBid(team.capital, team.protectedReserve);
}

export type BidRejection =
  | 'auction_not_open'
  | 'below_minimum'
  | 'not_on_increment'
  | 'exceeds_max_bid'
  | 'already_leading'
  | 'team_inactive'
  | 'unknown_team';

export interface BidValidationInput {
  amount: number;
  teamCapital: number;
  protectedReserve: number;
  currentBid: number | null;
  startingBid: number;
  increment: number;
  auctionOpen: boolean;
  isCurrentLeader: boolean;
  teamActive: boolean;
  /** When false the amount only has to be >= minimum, not exactly on-increment. */
  enforceIncrement?: boolean;
}

export interface BidValidationResult {
  valid: boolean;
  reason?: BidRejection;
  message?: string;
  /** The lowest amount this bid could legally have been. */
  minimumRequired: number;
  /** This team's ceiling. */
  teamMaxBid: number;
}

/** The next amount the auctioneer will call. */
export function nextBidAmount(
  currentBid: number | null,
  startingBid: number,
  increment: number,
): number {
  return currentBid === null ? startingBid : currentBid + increment;
}

/**
 * Server-authoritative bid validation. Clients never decide whether a bid is
 * valid (spec section 3); this exists so the organizer UI can grey out teams
 * that cannot afford the next call before the operator clicks them.
 */
export function validateBid(input: BidValidationInput): BidValidationResult {
  const minimumRequired = nextBidAmount(input.currentBid, input.startingBid, input.increment);
  const teamMaxBid = maxBid(input.teamCapital, input.protectedReserve);

  const fail = (reason: BidRejection, message: string): BidValidationResult => ({
    valid: false,
    reason,
    message,
    minimumRequired,
    teamMaxBid,
  });

  if (!input.auctionOpen) return fail('auction_not_open', 'Auction is not open');
  if (!input.teamActive) return fail('team_inactive', 'Team is not active');
  if (input.isCurrentLeader) return fail('already_leading', 'Team is already the highest bidder');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return fail('below_minimum', 'Bid must be a positive amount');
  }
  if (input.amount < minimumRequired) {
    return fail('below_minimum', `Bid must be at least ${minimumRequired}`);
  }
  if (input.enforceIncrement !== false) {
    const over = input.amount - minimumRequired;
    if (over % input.increment !== 0) {
      return fail('not_on_increment', `Bid must land on a ${input.increment} increment`);
    }
  }
  if (input.amount > teamMaxBid) {
    return fail(
      'exceeds_max_bid',
      `Exceeds max bid of ${teamMaxBid} (capital ${input.teamCapital} - reserve ${input.protectedReserve})`,
    );
  }

  return { valid: true, minimumRequired, teamMaxBid };
}

/* ------------------------------------------------------------------ *
 * Market rewards / penalties
 * ------------------------------------------------------------------ */

function applyRule(rule: RewardRule, difficulty: Difficulty, capital: number): number {
  let raw: number;
  switch (rule.mode) {
    case 'fixed':
      raw = rule.base;
      break;
    case 'difficulty':
      raw = rule.base * (rule.difficultyMultipliers[difficulty] ?? 1);
      break;
    case 'percent':
      raw = capital * rule.percentOfCapital;
      break;
    default:
      raw = rule.base;
  }
  const clamped = Math.min(rule.max, Math.max(rule.min, raw));
  return Math.round(clamped);
}

export function questionReward(
  config: GameConfig,
  question: Pick<Question, 'difficulty' | 'rewardOverride'>,
  capital: number,
): number {
  if (typeof question.rewardOverride === 'number') return Math.round(question.rewardOverride);
  return applyRule(config.questionReward, question.difficulty, capital);
}

export function questionPenalty(
  config: GameConfig,
  question: Pick<Question, 'difficulty' | 'penaltyOverride'>,
  capital: number,
): number {
  if (!config.penaltyEnabled) return 0;
  if (typeof question.penaltyOverride === 'number') return Math.round(question.penaltyOverride);
  return applyRule(config.questionPenalty, question.difficulty, capital);
}

/**
 * Linear speed bonus: answering with the whole clock left earns the full bonus,
 * answering at the buzzer earns nothing.
 */
export function speedBonus(
  config: GameConfig,
  timeLimitSeconds: number,
  elapsedMs: number,
): number {
  if (!config.speedBonusEnabled || timeLimitSeconds <= 0) return 0;
  const fractionLeft = 1 - elapsedMs / (timeLimitSeconds * 1000);
  if (!Number.isFinite(fractionLeft) || fractionLeft <= 0) return 0;
  return Math.round(config.speedBonusMax * Math.min(1, fractionLeft));
}

export interface CapitalDelta {
  delta: number;
  /** Delta before the capital floor clamp - used for audit transparency. */
  rawDelta: number;
  newCapital: number;
  clamped: boolean;
}

function settle(config: GameConfig, capital: number, rawDelta: number): CapitalDelta {
  const target = capital + rawDelta;
  const newCapital = Math.max(config.capitalFloor, target);
  const delta = newCapital - capital;
  return { delta, rawDelta, newCapital, clamped: newCapital !== target };
}

export type QuestionResolution = 'correct' | 'wrong' | 'timeout' | 'skipped';

export function resolveQuestion(
  config: GameConfig,
  question: Pick<Question, 'difficulty' | 'rewardOverride' | 'penaltyOverride' | 'timeLimit'>,
  capital: number,
  resolution: QuestionResolution,
  elapsedMs = 0,
): CapitalDelta {
  if (resolution === 'skipped') return settle(config, capital, 0);
  if (resolution === 'correct') {
    const reward = questionReward(config, question, capital);
    const bonus = speedBonus(config, question.timeLimit, elapsedMs);
    return settle(config, capital, reward + bonus);
  }
  if (resolution === 'timeout' && !config.timeoutPenalised) {
    return settle(config, capital, 0);
  }
  return settle(config, capital, -questionPenalty(config, question, capital));
}

/* ------------------------------------------------------------------ *
 * Premium settlement (spec section 14)
 * ------------------------------------------------------------------ */

export type PremiumResolution = 'correct' | 'wrong' | 'timeout';

/**
 * The winning bid *is* the risk amount:
 *   correct -> capital + bid
 *   wrong   -> capital - bid
 */
export function resolvePremium(
  config: GameConfig,
  capital: number,
  riskAmount: number,
  resolution: PremiumResolution,
): CapitalDelta {
  const magnitude = Math.max(0, Math.round(riskAmount));
  const rawDelta = resolution === 'correct' ? magnitude : -magnitude;
  return settle(config, capital, rawDelta);
}

/** Manual organizer adjustment, still clamped by the capital floor. */
export function resolveAdjustment(
  config: GameConfig,
  capital: number,
  amount: number,
): CapitalDelta {
  return settle(config, capital, Math.round(amount));
}
