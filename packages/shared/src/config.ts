/**
 * Central configuration.
 *
 * Every tunable number in the game lives here. Nothing in the UI or the engine
 * is allowed to hard-code an economy value or a timer: the server loads this
 * record from SQLite at boot, the organizer can edit it live, and the result is
 * broadcast to all clients so they render the same numbers the server enforces.
 */

import type { Difficulty } from './types.js';

export type RewardMode = 'fixed' | 'difficulty' | 'percent';

export interface RewardRule {
  /**
   * fixed      -> always `base`
   * difficulty -> `base * difficultyMultipliers[difficulty]`
   * percent    -> `capital * percentOfCapital` (rounded), clamped to [min, max]
   */
  mode: RewardMode;
  base: number;
  difficultyMultipliers: Record<Difficulty, number>;
  percentOfCapital: number;
  min: number;
  max: number;
}

/** Solve time per difficulty, in seconds. Never hard-coded in a component. */
export type DifficultyTimes = Record<Difficulty, number>;

export interface GameConfig {
  /* --- identity ------------------------------------------------------ */
  eventName: string;
  roundName: string;
  roundNumber: number;
  currencySymbol: string;

  /* --- structure ------------------------------------------------------ */
  /**
   * The round is built from repeating blocks:
   *   N normal questions -> 1 premium challenge.
   * Both numbers are configurable; the server generates the concrete sequence
   * once, persists it, and is the only thing that decides what comes next.
   */
  blocks: number;
  questionsPerBlock: number;
  /**
   * A question may not be re-selected until this many other questions have been
   * used. Guards against the same item appearing twice in quick succession.
   */
  noRepeatWindow: number;
  /** Difficulties eligible for the random normal-question draw. */
  normalDifficulties: Difficulty[];

  /* --- capital ------------------------------------------------------- */
  startingCapital: number;
  protectedReserve: number;
  /** Capital can never drop below this (losses are clamped here). */
  capitalFloor: number;

  /* --- normal questions ----------------------------------------------- */
  /** When true, teams must explicitly JOIN a question to attempt it. */
  questionOptIn: boolean;
  /** When true, a question must be unlocked with its printed access key. */
  requireAccessKey: boolean;
  questionReward: RewardRule;
  questionPenalty: RewardRule;
  /** A wrong answer costs nothing when false. */
  penaltyEnabled: boolean;
  /** A timeout is treated as a wrong answer when true. */
  timeoutPenalised: boolean;
  speedBonusEnabled: boolean;
  speedBonusMax: number;

  /* --- timing --------------------------------------------------------- */
  /** Solve time by difficulty (spec section 4). */
  difficultyTimes: DifficultyTimes;
  /** How long the intro card is held before a question opens. */
  questionIntroSeconds: number;
  /**
   * The whole premium process - intro, auction, attempt, reclaim - runs inside
   * one window (spec section 6).
   */
  premiumWindowSeconds: number;
  /** Solve time for a premium attempt, inside the premium window. */
  premiumSolveSeconds: number;
  /** The planning beat after every premium (spec section 10). */
  strategyWindowSeconds: number;
  /** Seconds the reclaim candidate has to accept or decline. */
  reclaimDecisionWindow: number;
  reclaimAutoDecline: boolean;
  /** Grace period (ms) allowed on top of a timer for network latency. */
  submissionGraceMs: number;

  /* --- auctions ------------------------------------------------------- */
  premiumStartingBid: number;
  premiumBidIncrement: number;
  finalPremiumStartingBid: number;
  finalPremiumBidIncrement: number;

  /* --- finale --------------------------------------------------------- */
  /**
   * The global leaderboard is hidden from the projector and from participants
   * for the last N normal questions (spec sections 11, 18). The organizer
   * always keeps it.
   */
  hideLeaderboardLastQuestions: number;
  /** How many places the closing podium celebrates. */
  podiumPlaces: number;

  /* --- operations ----------------------------------------------------- */
  revealExplanations: boolean;
  soundEnabled: boolean;
  /** Enable the local code runner (needs python/g++/javac on the machine). */
  codeExecutionEnabled: boolean;
  codeExecutionTimeoutMs: number;
}

export const DEFAULT_DIFFICULTY_TIMES: DifficultyTimes = {
  easy: 60,
  medium: 90,
  hard: 120,
  very_hard: 150,
};

export const DEFAULT_CONFIG: GameConfig = {
  eventName: 'CSI CLUB',
  roundName: 'CODE MARKET',
  roundNumber: 3,
  currencySymbol: '₹',

  blocks: 4,
  questionsPerBlock: 3,
  noRepeatWindow: 6,
  normalDifficulties: ['easy', 'medium', 'hard', 'very_hard'],

  startingCapital: 1000,
  protectedReserve: 500,
  capitalFloor: 0,

  questionOptIn: true,
  requireAccessKey: false,
  questionReward: {
    mode: 'difficulty',
    base: 200,
    difficultyMultipliers: { easy: 1, medium: 1.5, hard: 2, very_hard: 2.5 },
    percentOfCapital: 0.1,
    min: 50,
    max: 1200,
  },
  questionPenalty: {
    mode: 'difficulty',
    base: 100,
    difficultyMultipliers: { easy: 1, medium: 1.5, hard: 2, very_hard: 2.5 },
    percentOfCapital: 0.05,
    min: 25,
    max: 600,
  },
  penaltyEnabled: true,
  timeoutPenalised: true,
  speedBonusEnabled: false,
  speedBonusMax: 50,

  difficultyTimes: { ...DEFAULT_DIFFICULTY_TIMES },
  questionIntroSeconds: 8,
  premiumWindowSeconds: 420,
  premiumSolveSeconds: 150,
  strategyWindowSeconds: 40,
  reclaimDecisionWindow: 5,
  reclaimAutoDecline: true,
  submissionGraceMs: 1500,

  premiumStartingBid: 300,
  premiumBidIncrement: 100,
  finalPremiumStartingBid: 500,
  finalPremiumBidIncrement: 100,

  hideLeaderboardLastQuestions: 4,
  podiumPlaces: 3,

  revealExplanations: true,
  soundEnabled: true,
  codeExecutionEnabled: false,
  codeExecutionTimeoutMs: 4000,
};

/** Numeric fields that must stay >= 0 when the organizer edits config. */
const NON_NEGATIVE_KEYS: (keyof GameConfig)[] = [
  'startingCapital',
  'protectedReserve',
  'capitalFloor',
  'premiumStartingBid',
  'premiumBidIncrement',
  'finalPremiumStartingBid',
  'finalPremiumBidIncrement',
  'reclaimDecisionWindow',
  'premiumWindowSeconds',
  'premiumSolveSeconds',
  'strategyWindowSeconds',
  'questionIntroSeconds',
  'submissionGraceMs',
  'speedBonusMax',
  'codeExecutionTimeoutMs',
  'hideLeaderboardLastQuestions',
  'noRepeatWindow',
];

export interface ConfigValidation {
  ok: boolean;
  errors: string[];
  config: GameConfig;
}

/**
 * Merge a partial patch onto a base config, coercing and validating.
 * Invalid fields are reported and the previous value is retained, so a typo in
 * the organizer UI can never brick the economy mid-event.
 */
export function applyConfigPatch(
  base: GameConfig,
  patch: Partial<GameConfig>,
): ConfigValidation {
  const errors: string[] = [];
  const next: GameConfig = {
    ...base,
    ...patch,
    questionReward: { ...base.questionReward, ...(patch.questionReward ?? {}) },
    questionPenalty: { ...base.questionPenalty, ...(patch.questionPenalty ?? {}) },
    difficultyTimes: { ...base.difficultyTimes, ...(patch.difficultyTimes ?? {}) },
    normalDifficulties: patch.normalDifficulties ?? base.normalDifficulties,
  };

  for (const key of NON_NEGATIVE_KEYS) {
    const value = next[key] as unknown;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors.push(`${String(key)} must be a number >= 0`);
      (next as unknown as Record<string, unknown>)[key as string] = base[key];
    }
  }

  if (next.protectedReserve > next.startingCapital) {
    errors.push('protectedReserve cannot exceed startingCapital');
    next.protectedReserve = base.protectedReserve;
  }
  if (next.premiumBidIncrement <= 0) {
    errors.push('premiumBidIncrement must be > 0');
    next.premiumBidIncrement = base.premiumBidIncrement;
  }
  if (next.finalPremiumBidIncrement <= 0) {
    errors.push('finalPremiumBidIncrement must be > 0');
    next.finalPremiumBidIncrement = base.finalPremiumBidIncrement;
  }
  if (next.blocks < 1) {
    errors.push('blocks must be >= 1');
    next.blocks = base.blocks;
  }
  if (next.questionsPerBlock < 1) {
    errors.push('questionsPerBlock must be >= 1');
    next.questionsPerBlock = base.questionsPerBlock;
  }
  if (next.podiumPlaces < 1) {
    errors.push('podiumPlaces must be >= 1');
    next.podiumPlaces = base.podiumPlaces;
  }
  if (next.normalDifficulties.length === 0) {
    errors.push('normalDifficulties cannot be empty');
    next.normalDifficulties = base.normalDifficulties;
  }
  for (const [difficulty, seconds] of Object.entries(next.difficultyTimes)) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      errors.push(`difficultyTimes.${difficulty} must be > 0`);
      next.difficultyTimes = { ...base.difficultyTimes };
      break;
    }
  }

  return { ok: errors.length === 0, errors, config: next };
}

/** Solve time for a question, from config - never from a component. */
export function timeLimitFor(config: GameConfig, difficulty: Difficulty): number {
  return config.difficultyTimes[difficulty] ?? DEFAULT_DIFFICULTY_TIMES[difficulty] ?? 90;
}

/** Total normal questions in the generated round. */
export function totalNormalQuestions(config: GameConfig): number {
  return config.blocks * config.questionsPerBlock;
}

export function formatMoney(amount: number, symbol = DEFAULT_CONFIG.currencySymbol): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(Math.round(amount)).toLocaleString('en-IN')}`;
}

export function formatDelta(amount: number, symbol = DEFAULT_CONFIG.currencySymbol): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(Math.round(amount)).toLocaleString('en-IN')}`;
}
