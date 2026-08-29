/**
 * Central configuration (spec section 47).
 *
 * Every tunable number in the game lives here. Nothing in the UI or the engine
 * is allowed to hard-code an economy value: the server loads this record from
 * SQLite at boot, the organizer can edit it live, and the resulting object is
 * broadcast to all clients so they render the same numbers the server enforces.
 */

export type RewardMode = 'fixed' | 'difficulty' | 'percent';

export interface RewardRule {
  /**
   * fixed      -> always `base`
   * difficulty -> `base * difficultyMultipliers[difficulty]`
   * percent    -> `capital * percentOfCapital` (rounded), clamped to [min, max]
   */
  mode: RewardMode;
  base: number;
  difficultyMultipliers: { easy: number; medium: number; hard: number };
  percentOfCapital: number;
  min: number;
  max: number;
}

export interface GameConfig {
  /* --- identity ------------------------------------------------------ */
  eventName: string;
  roundName: string;
  currencySymbol: string;

  /* --- capital ------------------------------------------------------- */
  startingCapital: number;
  protectedReserve: number;
  /** Capital can never drop below this (market losses are clamped here). */
  capitalFloor: number;

  /* --- market challenges --------------------------------------------- */
  /** When true, teams must explicitly JOIN a market challenge to attempt it. */
  marketOptIn: boolean;
  /** When true, a market challenge must be unlocked with its printed access key. */
  requireAccessKeyForMarket: boolean;
  marketReward: RewardRule;
  marketPenalty: RewardRule;
  /** A wrong market answer costs nothing when false. */
  marketPenaltyEnabled: boolean;
  /** A market timeout is treated as a wrong answer when true. */
  marketTimeoutPenalised: boolean;
  /** Extra reward for answering fast, scaled linearly with time left. */
  speedBonusEnabled: boolean;
  speedBonusMax: number;

  /* --- premium auctions ---------------------------------------------- */
  premiumStartingBid: number;
  premiumBidIncrement: number;
  finalPremiumStartingBid: number;
  finalPremiumBidIncrement: number;
  /** Seconds the reclaim candidate has to accept or decline. */
  reclaimDecisionWindow: number;
  /** Reclaim offer auto-declines when the window expires. */
  reclaimAutoDecline: boolean;

  /* --- timing --------------------------------------------------------- */
  defaultMarketTimeLimit: number;
  defaultPremiumTimeLimit: number;
  finalPremiumTimeLimit: number;
  /** Grace period (ms) allowed on top of the timer for network latency. */
  submissionGraceMs: number;

  /* --- qualification -------------------------------------------------- */
  qualifiers: number;

  /* --- operations ----------------------------------------------------- */
  /** Premium results need an explicit operator confirmation before applying. */
  requirePremiumConfirmation: boolean;
  /** Show the explanation to participants once a challenge is resolved. */
  revealExplanations: boolean;
  soundEnabled: boolean;
  /** Enable the local code runner (needs python/g++/javac on the machine). */
  codeExecutionEnabled: boolean;
  codeExecutionTimeoutMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  eventName: 'CSI CLUB',
  roundName: 'CODE MARKET',
  currencySymbol: '₹',

  startingCapital: 1000,
  protectedReserve: 500,
  capitalFloor: 0,

  marketOptIn: true,
  requireAccessKeyForMarket: true,
  marketReward: {
    mode: 'difficulty',
    base: 200,
    difficultyMultipliers: { easy: 1, medium: 1.5, hard: 2 },
    percentOfCapital: 0.1,
    min: 50,
    max: 1000,
  },
  marketPenalty: {
    mode: 'difficulty',
    base: 100,
    difficultyMultipliers: { easy: 1, medium: 1.5, hard: 2 },
    percentOfCapital: 0.05,
    min: 25,
    max: 500,
  },
  marketPenaltyEnabled: true,
  marketTimeoutPenalised: true,
  speedBonusEnabled: false,
  speedBonusMax: 50,

  premiumStartingBid: 300,
  premiumBidIncrement: 100,
  finalPremiumStartingBid: 500,
  finalPremiumBidIncrement: 100,
  reclaimDecisionWindow: 5,
  reclaimAutoDecline: true,

  defaultMarketTimeLimit: 120,
  defaultPremiumTimeLimit: 180,
  finalPremiumTimeLimit: 240,
  submissionGraceMs: 1500,

  qualifiers: 10,

  requirePremiumConfirmation: false,
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
  'defaultMarketTimeLimit',
  'defaultPremiumTimeLimit',
  'finalPremiumTimeLimit',
  'submissionGraceMs',
  'qualifiers',
  'speedBonusMax',
  'codeExecutionTimeoutMs',
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
    marketReward: { ...base.marketReward, ...(patch.marketReward ?? {}) },
    marketPenalty: { ...base.marketPenalty, ...(patch.marketPenalty ?? {}) },
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
  if (next.qualifiers < 1) {
    errors.push('qualifiers must be >= 1');
    next.qualifiers = base.qualifiers;
  }

  return { ok: errors.length === 0, errors, config: next };
}

export function formatMoney(amount: number, symbol = DEFAULT_CONFIG.currencySymbol): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(Math.round(amount)).toLocaleString('en-IN')}`;
}

export function formatDelta(amount: number, symbol = DEFAULT_CONFIG.currencySymbol): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(Math.round(amount)).toLocaleString('en-IN')}`;
}
