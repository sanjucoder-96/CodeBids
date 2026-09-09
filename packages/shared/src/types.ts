/**
 * Core domain types for CSI Club — Code Market (Round 3).
 * Shared verbatim by the server (the authority) and every client.
 */

/* ------------------------------------------------------------------ *
 * Teams
 * ------------------------------------------------------------------ */

export type TeamStatus = 'active' | 'eliminated' | 'withdrawn';
export type ConnectionStatus = 'online' | 'offline';

export interface Team {
  id: string; // stable id, e.g. "T01"
  name: string;
  capital: number;
  startingCapital: number;
  protectedReserve: number;
  status: TeamStatus;
  connectionStatus: ConnectionStatus;
  seatLabel: string | null;
  volunteer: string | null;
  createdAt: number;
  lastSeenAt: number | null;
}

/** Public projection of a team, safe to broadcast to every client. */
export interface TeamPublic {
  id: string;
  name: string;
  capital: number;
  startingCapital: number;
  status: TeamStatus;
  connectionStatus: ConnectionStatus;
  maxBid: number;
}

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

/** A question is either an ordinary one or an auctioned premium. */
export type QuestionKind = 'normal' | 'premium';

export type ChallengeType =
  | 'mcq'
  | 'multi'
  | 'true_false'
  | 'output'
  | 'numeric'
  | 'short_text'
  | 'ordering'
  | 'matching'
  | 'code';

/** Four difficulty tiers; each carries its own solve time from config. */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'very_hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'very_hard'];

/** Subject area, shown to participants before they commit. */
export type Domain =
  | 'dsa'
  | 'algorithms'
  | 'sql'
  | 'databases'
  | 'os'
  | 'networking'
  | 'oop'
  | 'security'
  | 'logic'
  | 'optimization'
  | 'cs_concepts'
  | 'code_analysis'
  | 'output_prediction'
  | 'web';

export type CodeLanguage = 'python' | 'cpp' | 'java';

/** Data the participant is allowed to see. Never contains the answer. */
export interface QuestionData {
  prompt: string;
  /** Optional code block rendered in a monospace panel. */
  code?: string;
  codeLanguage?: string;
  /** For mcq / multi. */
  options?: { id: string; text: string }[];
  /** For ordering: items to be arranged. */
  items?: { id: string; text: string }[];
  /** For matching: left column and right column. */
  left?: { id: string; text: string }[];
  right?: { id: string; text: string }[];
  /** For output / short_text / numeric. */
  placeholder?: string;
  unit?: string;
  /** For code challenges. */
  starterCode?: string;
  languages?: CodeLanguage[];
  samples?: { input: string; output: string }[];
  hint?: string;
}

/** Server-only. Never leaves the server for a participant socket. */
export interface EvaluationData {
  correctOptionIds?: string[];
  correctBoolean?: boolean;
  acceptedAnswers?: string[];
  caseSensitive?: boolean;
  ignoreWhitespace?: boolean;
  correctNumber?: number;
  tolerance?: number;
  correctOrder?: string[];
  correctPairs?: Record<string, string>;
  testCases?: { input: string; output: string; hidden?: boolean }[];
  explanation?: string;
}

/**
 * A question in the POOL. The pool is not the running order: the server draws a
 * concrete sequence from it at game start (see SequenceSlot).
 */
export interface Question {
  id: string;
  kind: QuestionKind;
  title: string;
  domain: Domain;
  type: ChallengeType;
  difficulty: Difficulty;
  /** Solve time in seconds. Derived from difficulty unless overridden. */
  timeLimit: number;
  rewardOverride?: number;
  penaltyOverride?: number;
  question: QuestionData;
  evaluation: EvaluationData;
  accessKey: string;
}

/**
 * What a client receives. The body is withheld until the team is entitled to
 * see it, which is what `revealed` reports.
 */
export interface QuestionPublic {
  id: string;
  kind: QuestionKind;
  title: string;
  domain: Domain;
  type: ChallengeType;
  difficulty: Difficulty;
  timeLimit: number;
  /** Position in the generated round, 1-based. */
  slotIndex: number;
  blockNumber: number;
  positionInBlock: number;
  /** False while the question body is withheld. */
  revealed: boolean;
  question: QuestionData;
  /** Amount deducted up front when the team takes this question (the stake). */
  stake?: number;
  /** Amount credited on a correct answer (the stake times the win multiplier). */
  reward?: number;
  /** Amount forfeited on a wrong answer or timeout — equal to the stake. */
  penalty?: number;
}

/* ------------------------------------------------------------------ *
 * The generated sequence
 * ------------------------------------------------------------------ */

/**
 * One position in the round. The server generates the whole list once from a
 * persisted seed, so a restart or a reconnect always yields the same order.
 */
export interface SequenceSlot {
  /** 1-based position across the whole round. */
  index: number;
  /** 1-based block number. */
  blockNumber: number;
  /** 1-based position inside the block; premium is always last. */
  positionInBlock: number;
  kind: QuestionKind;
  questionId: string;
  state: 'pending' | 'active' | 'complete';
}

/** Sequence slot enriched with the public facts a client may see. */
export interface SequenceEntry extends SequenceSlot {
  title: string;
  domain: Domain;
  difficulty: Difficulty;
  timeLimit: number;
  /** True for the final premium of the round. */
  isFinalPremium: boolean;
  /** True when this normal question falls inside the leaderboard blackout. */
  inFinalStretch: boolean;
}

/* ------------------------------------------------------------------ *
 * Submissions
 * ------------------------------------------------------------------ */

export type SubmissionValue =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'order'; itemIds: string[] }
  | { kind: 'pairs'; pairs: Record<string, string> }
  | { kind: 'code'; language: CodeLanguage; source: string };

export type AttemptResult = 'correct' | 'wrong' | 'timeout' | 'skipped' | 'declined';

export interface EvaluationOutcome {
  correct: boolean;
  detail?: string;
  testsPassed?: number;
  testsTotal?: number;
}

/* ------------------------------------------------------------------ *
 * Auctions
 * ------------------------------------------------------------------ */

export type AuctionStatus =
  | 'pending'
  | 'open'
  | 'going_once'
  | 'going_twice'
  | 'closed'
  | 'cancelled';

export interface Bid {
  id: number;
  auctionId: number;
  teamId: string;
  amount: number;
  sequenceNumber: number;
  timestamp: number;
  valid: boolean;
  rejectedReason?: string;
}

export interface Auction {
  id: number;
  questionId: string;
  slotIndex: number;
  status: AuctionStatus;
  startingBid: number;
  increment: number;
  currentBid: number | null;
  currentLeaderTeamId: string | null;
  winnerTeamId: string | null;
  winningAmount: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

/** One entry of the reclaim ladder - derived from the original auction. */
export interface LadderEntry {
  rank: number; // 1 = auction winner
  teamId: string;
  amount: number; // that team's highest original bid
  sequenceNumber: number;
  state:
    | 'winner'
    | 'pending'
    | 'offered'
    | 'accepted'
    | 'declined'
    | 'failed'
    | 'expired'
    | 'skipped';
}

/* ------------------------------------------------------------------ *
 * Premium lifecycle
 * ------------------------------------------------------------------ */

export type PremiumStage =
  | 'idle'
  | 'intro'
  | 'auction'
  | 'sold'
  | 'decision'
  | 'attempt_1'
  | 'reclaim_offer'
  | 'attempt_2'
  | 'closed';

export type PremiumOutcome =
  | 'won_first'
  | 'won_reclaim'
  | 'lost'
  | 'no_takers'
  | 'unsold'
  | null;

export interface PremiumState {
  questionId: string;
  slotIndex: number;
  stage: PremiumStage;
  auctionId: number | null;
  ladder: LadderEntry[];
  activeTeamId: string | null;
  activeRisk: number | null;
  attemptNumber: 0 | 1 | 2;
  offerTeamId: string | null;
  offerRisk: number | null;
  offerDeadline: number | null;
  failedTeamId: string | null;
  outcome: PremiumOutcome;
  /** Wall-clock end of the whole 7-minute premium window. */
  windowEndsAt: number | null;
  /**
   * The 15-second TAKE / SIT-OUT window after a premium is won (spec 6, 7).
   * `decisionDeadline` is the authoritative deadline every client counts down
   * to; `decisions` records each eligible team's choice. A team that never
   * chooses defaults to sitting out when the deadline passes.
   */
  decisionDeadline: number | null;
  decisions: Record<string, PremiumDecision>;
}

export type PremiumDecision = 'take' | 'sit_out';

/* ------------------------------------------------------------------ *
 * Game state machine
 * ------------------------------------------------------------------ */

export type GamePhase =
  | 'idle'
  | 'question_intro'
  | 'question_active'
  | 'question_result'
  | 'premium_intro'
  | 'auction_active'
  | 'premium_authorized'
  | 'premium_decision'
  | 'premium_solving'
  | 'premium_result'
  | 'reclaim'
  | 'strategy_phase'
  | 'final_results'
  | 'completed'
  | 'paused';

export const PHASE_LABELS: Record<GamePhase, string> = {
  idle: 'Lobby',
  question_intro: 'Next challenge',
  question_active: 'Question live',
  question_result: 'Results',
  premium_intro: 'Premium incoming',
  auction_active: 'Auction',
  premium_authorized: 'Winner authorised',
  premium_decision: 'Take or sit out',
  premium_solving: 'Premium attempt',
  premium_result: 'Premium result',
  reclaim: 'Reclaim',
  strategy_phase: 'Strategy phase',
  final_results: 'Final results',
  completed: 'Complete',
  paused: 'Paused',
};

export interface TimerState {
  /** Wall-clock ms when the timer ends. Null when no timer runs. */
  endsAt: number | null;
  duration: number | null;
  label: string | null;
}

export interface GameState {
  phase: GamePhase;
  /** Phase to return to when un-pausing. */
  resumePhase: GamePhase | null;
  /** 1-based position in the generated sequence; 0 before the round starts. */
  slotIndex: number;
  currentQuestionId: string | null;
  currentAuctionId: number | null;
  blockNumber: number;
  totalBlocks: number;
  totalSlots: number;
  /** True while the leaderboard blackout is in force. */
  finalStretch: boolean;
  timer: TimerState;
  /** Server clock when the snapshot was produced (clock-skew correction). */
  serverNow: number;
  startedAt: number | null;
  completedAt: number | null;
}

/* ------------------------------------------------------------------ *
 * Leaderboard / podium
 * ------------------------------------------------------------------ */

export interface LeaderboardRow {
  rank: number;
  teamId: string;
  name: string;
  capital: number;
  startingCapital: number;
  delta: number;
  /** 1, 2 or 3 for a podium place; null otherwise. */
  podium: number | null;
  previousRank: number | null;
  connectionStatus: ConnectionStatus;
  status: TeamStatus;
}

export interface PodiumEntry {
  place: number;
  teamId: string;
  name: string;
  capital: number;
  delta: number;
}

/* ------------------------------------------------------------------ *
 * Per-team live view (private to that team)
 * ------------------------------------------------------------------ */

export type TeamQuestionState =
  | 'idle'
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'submitted'
  | 'resolved'
  | 'skipped';

export interface TeamStats {
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  premiumWins: number;
  premiumAttempts: number;
  premiumCorrect: number;
  premiumWrong: number;
  totalEarned: number;
  totalLost: number;
}

export interface TeamView {
  teamId: string;
  capital: number;
  maxBid: number;
  /** Suppressed (0) for participants while the leaderboard is blacked out. */
  rank: number;
  /**
   * The podium place this team actually holds, or null. Not derivable from
   * `rank`: with the field level every team shares rank 1 and nobody holds a
   * place. Sent so the badge never contradicts the board.
   */
  podium: number | null;
  totalTeams: number;
  /** True when the client must not show global standings. */
  leaderboardHidden: boolean;
  questionState: TeamQuestionState;
  /**
   * Server-authoritative deadline for this team's own attempt, or null when it
   * has not joined. Each team's clock starts when it joins, so this cannot be
   * derived from the round's global timer - and guessing it client-side gave a
   * reconnecting team a fresh full clock.
   */
  questionDeadline: number | null;
  premiumUnlocked: boolean;
  premiumRisk: number | null;
  /**
   * The 15-second TAKE / SIT-OUT decision (spec 6, 7), for the team that won
   * the premium. `canDecidePremium` gates the buttons; `premiumDecisionDeadline`
   * is the authoritative countdown target; `premiumDecision` is this team's own
   * recorded choice, or null until it chooses.
   */
  canDecidePremium: boolean;
  premiumDecisionDeadline: number | null;
  premiumDecision: PremiumDecision | null;
  lastResult: {
    questionId: string;
    result: AttemptResult;
    /** Capital credited at the result (the win payout; 0 on a wrong answer). */
    delta: number;
    /** Amount that was staked up front when the question was taken. */
    stake: number;
    detail?: string;
    explanation?: string;
    at: number;
  } | null;
  reclaimOffer: { questionId: string; risk: number; deadline: number } | null;
  inAuction: boolean;
  myHighestBid: number | null;
  stats: TeamStats;
}

/* ------------------------------------------------------------------ *
 * Transactions / audit / history
 * ------------------------------------------------------------------ */

export type TransactionType =
  | 'initial'
  | 'question_stake'
  | 'question_reward'
  | 'question_penalty'
  | 'premium_stake'
  | 'premium_reward'
  | 'premium_penalty'
  | 'manual_adjustment';

export interface Transaction {
  id: number;
  teamId: string;
  amount: number;
  balanceAfter: number;
  type: TransactionType;
  reason: string;
  questionId: string | null;
  timestamp: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  teamId: string | null;
  questionId: string | null;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface Attempt {
  id: number;
  teamId: string;
  questionId: string;
  slotIndex: number;
  attemptNumber: number;
  result: AttemptResult;
  scoreChange: number;
  riskAmount: number | null;
  timestamp: number;
  durationMs: number | null;
  detail: string | null;
}

/** The complete per-team record the organizer can drill into (spec 12). */
export interface TeamDossier {
  team: Team;
  joinCode: string | null;
  stats: TeamStats;
  rank: number;
  attempts: (Attempt & {
    title: string;
    domain: Domain;
    difficulty: Difficulty;
    kind: QuestionKind;
  })[];
  bids: (Bid & { questionId: string; slotIndex: number; won: boolean })[];
  transactions: Transaction[];
  premiums: {
    questionId: string;
    slotIndex: number;
    winningBid: number | null;
    role: 'winner' | 'reclaim' | 'bidder';
    outcome: PremiumOutcome;
    result: AttemptResult | null;
  }[];
  audit: AuditEntry[];
}

/* ------------------------------------------------------------------ *
 * Live operator queue
 * ------------------------------------------------------------------ */

export type LiveEventKind =
  | 'attempting'
  | 'submitted'
  | 'reclaim_offer'
  | 'awaiting_confirm'
  | 'disconnected';

export interface LiveEvent {
  id: string;
  teamId: string;
  teamName: string;
  questionId: string;
  label: string;
  kind: LiveEventKind;
  since: number;
  needsAttention: boolean;
}
