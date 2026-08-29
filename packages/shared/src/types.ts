/**
 * Core domain types for CSI Club — Code Market.
 * These types are shared verbatim by the server (authority) and every client.
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
 * Challenges
 * ------------------------------------------------------------------ */

export type MarketType = 'market' | 'premium' | 'final_premium';

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

export type Difficulty = 'easy' | 'medium' | 'hard';

export type ChallengeCategory =
  | 'dsa'
  | 'algorithms'
  | 'sql'
  | 'os'
  | 'dbms'
  | 'networking'
  | 'oop'
  | 'security'
  | 'logic'
  | 'optimization'
  | 'cs_concepts'
  | 'code_analysis'
  | 'output_prediction';

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
  /** Visible sample test cases for code challenges. */
  samples?: { input: string; output: string }[];
  hint?: string;
}

/** Server-only. Never leaves the server for a participant socket. */
export interface EvaluationData {
  /** mcq: option id. multi: option ids. */
  correctOptionIds?: string[];
  /** true_false */
  correctBoolean?: boolean;
  /** output / short_text: any accepted answer (normalised comparison). */
  acceptedAnswers?: string[];
  caseSensitive?: boolean;
  ignoreWhitespace?: boolean;
  /** numeric */
  correctNumber?: number;
  tolerance?: number;
  /** ordering: correct order of item ids */
  correctOrder?: string[];
  /** matching: leftId to rightId */
  correctPairs?: Record<string, string>;
  /** code: test cases executed by the local runner (hidden ones included). */
  testCases?: { input: string; output: string; hidden?: boolean }[];
  /** Explanation shown after the challenge is resolved. */
  explanation?: string;
}

export interface Challenge {
  id: string; // "C01".."C12"
  index: number; // 1..12 - the fixed sequence position
  title: string;
  category: ChallengeCategory;
  type: ChallengeType;
  difficulty: Difficulty;
  marketType: MarketType;
  timeLimit: number; // seconds
  /** Optional per-challenge economy override for market challenges. */
  rewardOverride?: number;
  penaltyOverride?: number;
  question: QuestionData;
  evaluation: EvaluationData;
  accessKey: string;
}

/** What a participant client receives. */
export interface ChallengePublic {
  id: string;
  index: number;
  title: string;
  category: ChallengeCategory;
  type: ChallengeType;
  difficulty: Difficulty;
  marketType: MarketType;
  timeLimit: number;
  question: QuestionData;
  /**
   * False while the question body is withheld. Participants see a PREVIEW
   * (category, difficulty, reward, penalty) and make the risk decision before
   * the question is revealed to them.
   */
  revealed: boolean;
  /** Potential reward/penalty for market challenges, precomputed by the server. */
  reward?: number;
  penalty?: number;
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
  /** For code challenges. */
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
  challengeId: string;
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
  | 'auction'
  | 'sold'
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
  challengeId: string;
  stage: PremiumStage;
  auctionId: number | null;
  ladder: LadderEntry[];
  /** Team currently authorised to attempt. */
  activeTeamId: string | null;
  activeRisk: number | null;
  attemptNumber: 0 | 1 | 2;
  /** Team currently being offered a reclaim. */
  offerTeamId: string | null;
  offerRisk: number | null;
  offerDeadline: number | null;
  failedTeamId: string | null;
  outcome: PremiumOutcome;
}

/* ------------------------------------------------------------------ *
 * Game state
 * ------------------------------------------------------------------ */

export type GamePhase =
  | 'lobby'
  | 'market'
  | 'auction'
  | 'premium_attempt'
  | 'premium_reclaim'
  | 'result'
  | 'paused'
  | 'final'
  | 'complete';

export interface TimerState {
  /** Wall-clock ms when the timer ends. Null when no timer runs. */
  endsAt: number | null;
  /** Total duration in seconds, for progress rendering. */
  duration: number | null;
  label: string | null;
}

export interface GameState {
  phase: GamePhase;
  /** Phase to return to when un-pausing. */
  resumePhase: GamePhase | null;
  currentChallengeId: string | null;
  currentAuctionId: number | null;
  timer: TimerState;
  /** Server clock at the moment the snapshot was produced (clock-skew correction). */
  serverNow: number;
  startedAt: number | null;
  completedAt: number | null;
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

export interface LeaderboardRow {
  rank: number;
  teamId: string;
  name: string;
  capital: number;
  startingCapital: number;
  delta: number; // capital - startingCapital
  qualified: boolean;
  previousRank: number | null;
  connectionStatus: ConnectionStatus;
  status: TeamStatus;
}

/* ------------------------------------------------------------------ *
 * Per-team live view (private to that team)
 * ------------------------------------------------------------------ */

export type TeamChallengeState =
  | 'idle'
  | 'locked'
  | 'available'
  | 'joined'
  | 'in_progress'
  | 'submitted'
  | 'resolved'
  | 'skipped'
  | 'waiting';

export interface TeamStats {
  marketAttempted: number;
  marketCorrect: number;
  marketWrong: number;
  marketSkipped: number;
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
  rank: number;
  totalTeams: number;
  qualified: boolean;
  challengeState: TeamChallengeState;
  /** Whether this team is authorised to open the current premium challenge. */
  premiumUnlocked: boolean;
  premiumRisk: number | null;
  lastResult: {
    challengeId: string;
    result: AttemptResult;
    delta: number;
    detail?: string;
    explanation?: string;
    at: number;
  } | null;
  /** Reclaim offer addressed to this team. */
  reclaimOffer: { challengeId: string; risk: number; deadline: number } | null;
  inAuction: boolean;
  myHighestBid: number | null;
  stats: TeamStats;
}

/* ------------------------------------------------------------------ *
 * Transactions / audit
 * ------------------------------------------------------------------ */

export type TransactionType =
  | 'initial'
  | 'market_reward'
  | 'market_penalty'
  | 'premium_reward'
  | 'premium_penalty'
  | 'manual_adjustment';

export interface Transaction {
  id: number;
  teamId: string;
  amount: number; // signed
  balanceAfter: number;
  type: TransactionType;
  reason: string;
  challengeId: string | null;
  timestamp: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  teamId: string | null;
  challengeId: string | null;
  timestamp: number;
  metadata: Record<string, unknown>;
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
  challengeId: string;
  label: string;
  kind: LiveEventKind;
  since: number;
  needsAttention: boolean;
}

/* ------------------------------------------------------------------ *
 * Attempts
 * ------------------------------------------------------------------ */

export interface Attempt {
  id: number;
  teamId: string;
  challengeId: string;
  attemptNumber: number;
  result: AttemptResult;
  scoreChange: number;
  riskAmount: number | null;
  timestamp: number;
  durationMs: number | null;
  detail: string | null;
}
