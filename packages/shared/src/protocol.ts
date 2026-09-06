/**
 * The real-time protocol (spec sections 19, 20).
 *
 * Design rules:
 *  - Every message is a small JSON envelope: { t, d, seq, ts }.
 *  - The server stamps a monotonic `seq` on every broadcast. A client that sees
 *    a gap asks for a resync instead of guessing.
 *  - Broadcasts are DELTAS wherever possible; full snapshots are sent only on
 *    connect / resync.
 *  - The server decides EVERY state transition. A client only reports intent.
 */

import type { GameConfig } from './config.js';
import type {
  Auction,
  AuctionStatus,
  AttemptResult,
  AuditEntry,
  Bid,
  Domain,
  Difficulty,
  GamePhase,
  GameState,
  LadderEntry,
  LeaderboardRow,
  LiveEvent,
  PodiumEntry,
  PremiumState,
  QuestionPublic,
  SequenceEntry,
  SubmissionValue,
  TeamPublic,
  TeamView,
  Transaction,
} from './types.js';

export type ClientRole = 'participant' | 'organizer' | 'projector';

/* ------------------------------------------------------------------ *
 * Envelope
 * ------------------------------------------------------------------ */

export interface Envelope<T extends string = string, D = unknown> {
  t: T;
  d: D;
  /** Monotonic broadcast sequence. Absent on direct request/response frames. */
  seq?: number;
  /** Server wall clock (ms) when the frame was produced. */
  ts: number;
  /** Correlation id echoed back on responses to client commands. */
  rid?: string;
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

export interface AuctionView {
  auction: Auction;
  /** Public facts about the premium - never its body (spec section 5). */
  preview: PremiumPreview;
  /** Distinct active bidders, highest bid first. */
  bidders: { teamId: string; teamName: string; amount: number; isLeader: boolean }[];
  history: Bid[];
  nextBid: number;
  ladder: LadderEntry[];
}

/**
 * What the room may know about a premium BEFORE it is won: domain, difficulty,
 * time and price. Never the question itself.
 */
export interface PremiumPreview {
  questionId: string;
  slotIndex: number;
  blockNumber: number;
  title: string;
  domain: Domain;
  difficulty: Difficulty;
  timeLimit: number;
  startingBid: number;
  increment: number;
  isFinalPremium: boolean;
  premiumNumber: number;
}

export interface Snapshot {
  role: ClientRole;
  config: GameConfig;
  game: GameState;
  teams: TeamPublic[];
  /**
   * Empty for participants and the projector while the leaderboard blackout is
   * in force (spec sections 11, 18). The organizer always receives it.
   */
  leaderboard: LeaderboardRow[];
  leaderboardHidden: boolean;
  auction: AuctionView | null;
  premium: PremiumState | null;
  /** Sanitised question, present only when this client may see it. */
  question: QuestionPublic | null;
  /** Public facts about the premium being introduced/auctioned. */
  premiumPreview: PremiumPreview | null;
  /** Participant-only private view. */
  me: TeamView | null;
  /** Final standings, only once the round completes. */
  podium: PodiumEntry[] | null;
  /** Organizer-only extras. */
  sequence?: SequenceEntry[];
  liveEvents?: LiveEvent[];
  seq: number;
  serverNow: number;
}

export interface ResultBroadcast {
  teamId: string;
  teamName: string;
  questionId: string;
  slotIndex: number;
  result: AttemptResult;
  delta: number;
  newCapital: number;
  isPremium: boolean;
  riskAmount: number | null;
  at: number;
}

export interface CapitalChange {
  teamId: string;
  from: number;
  to: number;
  delta: number;
  reason: string;
  at: number;
}

/* ------------------------------------------------------------------ *
 * Server -> client events
 * ------------------------------------------------------------------ */

export const SERVER_EVENTS = {
  SNAPSHOT: 'SNAPSHOT',
  ERROR: 'ERROR',
  ACK: 'ACK',
  PONG: 'PONG',

  CONFIG_UPDATED: 'CONFIG_UPDATED',

  GAME_STARTED: 'GAME_STARTED',
  GAME_PAUSED: 'GAME_PAUSED',
  GAME_RESUMED: 'GAME_RESUMED',
  GAME_COMPLETE: 'GAME_COMPLETE',
  GAME_RESET: 'GAME_RESET',
  PHASE_CHANGED: 'PHASE_CHANGED',
  SEQUENCE_GENERATED: 'SEQUENCE_GENERATED',
  TIMER_STARTED: 'TIMER_STARTED',
  TIMER_STOPPED: 'TIMER_STOPPED',
  TIMER_EXPIRED: 'TIMER_EXPIRED',

  QUESTION_INTRO: 'QUESTION_INTRO',
  QUESTION_OPENED: 'QUESTION_OPENED',
  QUESTION_CLOSED: 'QUESTION_CLOSED',
  QUESTION_UNLOCKED: 'QUESTION_UNLOCKED',
  QUESTION_SUBMITTED: 'QUESTION_SUBMITTED',
  QUESTION_RESULT: 'QUESTION_RESULT',

  CAPITAL_CHANGED: 'CAPITAL_CHANGED',
  LEADERBOARD_UPDATED: 'LEADERBOARD_UPDATED',
  LEADERBOARD_HIDDEN: 'LEADERBOARD_HIDDEN',
  LEADERBOARD_REVEALED: 'LEADERBOARD_REVEALED',

  PREMIUM_INTRO: 'PREMIUM_INTRO',
  AUCTION_STARTED: 'AUCTION_STARTED',
  AUCTION_BID: 'AUCTION_BID',
  AUCTION_BID_REJECTED: 'AUCTION_BID_REJECTED',
  AUCTION_BID_UNDONE: 'AUCTION_BID_UNDONE',
  AUCTION_CALL: 'AUCTION_CALL',
  AUCTION_CLOSED: 'AUCTION_CLOSED',
  AUCTION_WON: 'AUCTION_WON',
  AUCTION_CANCELLED: 'AUCTION_CANCELLED',

  PREMIUM_UNLOCKED: 'PREMIUM_UNLOCKED',
  PREMIUM_ATTEMPT_STARTED: 'PREMIUM_ATTEMPT_STARTED',
  PREMIUM_ATTEMPT_FAILED: 'PREMIUM_ATTEMPT_FAILED',
  PREMIUM_RECLAIM_OFFERED: 'PREMIUM_RECLAIM_OFFERED',
  PREMIUM_RECLAIM_ACCEPTED: 'PREMIUM_RECLAIM_ACCEPTED',
  PREMIUM_RECLAIM_DECLINED: 'PREMIUM_RECLAIM_DECLINED',
  PREMIUM_CLOSED: 'PREMIUM_CLOSED',

  STRATEGY_STARTED: 'STRATEGY_STARTED',
  STRATEGY_ENDED: 'STRATEGY_ENDED',
  FINAL_STRETCH_STARTED: 'FINAL_STRETCH_STARTED',
  PODIUM_REVEALED: 'PODIUM_REVEALED',

  TEAM_CONNECTED: 'TEAM_CONNECTED',
  TEAM_DISCONNECTED: 'TEAM_DISCONNECTED',
  TEAM_UPDATED: 'TEAM_UPDATED',
  TEAMS_REPLACED: 'TEAMS_REPLACED',

  LIVE_EVENTS: 'LIVE_EVENTS',
  AUDIT_APPENDED: 'AUDIT_APPENDED',
  PROJECTOR_MODE: 'PROJECTOR_MODE',
  ME_UPDATED: 'ME_UPDATED',
} as const;

export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

export interface ServerPayloads {
  SNAPSHOT: Snapshot;
  ERROR: { code: string; message: string; rid?: string };
  ACK: { ok: true; rid?: string; data?: unknown };
  PONG: { clientTime: number };

  CONFIG_UPDATED: { config: GameConfig };

  GAME_STARTED: { game: GameState };
  GAME_PAUSED: { game: GameState };
  GAME_RESUMED: { game: GameState };
  GAME_COMPLETE: { game: GameState; podium: PodiumEntry[]; leaderboard: LeaderboardRow[] };
  GAME_RESET: Record<string, never>;
  PHASE_CHANGED: { game: GameState };
  SEQUENCE_GENERATED: { totalSlots: number; blocks: number; seed: number };
  TIMER_STARTED: { endsAt: number; duration: number; label: string };
  TIMER_STOPPED: Record<string, never>;
  TIMER_EXPIRED: { label: string };

  QUESTION_INTRO: { question: QuestionPublic; game: GameState };
  QUESTION_OPENED: { question: QuestionPublic; game: GameState };
  QUESTION_CLOSED: { questionId: string };
  QUESTION_UNLOCKED: { questionId: string; teamId: string; risk: number };
  QUESTION_SUBMITTED: { teamId: string; questionId: string; at: number };
  QUESTION_RESULT: ResultBroadcast;

  CAPITAL_CHANGED: CapitalChange;
  LEADERBOARD_UPDATED: { rows: LeaderboardRow[]; changed: string[] };
  LEADERBOARD_HIDDEN: { remainingQuestions: number };
  LEADERBOARD_REVEALED: { rows: LeaderboardRow[] };

  PREMIUM_INTRO: { preview: PremiumPreview; game: GameState };
  AUCTION_STARTED: { auction: AuctionView };
  AUCTION_BID: { auction: AuctionView; bid: Bid; outbidTeamId: string | null };
  AUCTION_BID_REJECTED: { teamId: string; amount: number; reason: string; message: string };
  AUCTION_BID_UNDONE: { auction: AuctionView; removedBidId: number };
  AUCTION_CALL: { status: AuctionStatus; amount: number | null };
  AUCTION_CLOSED: { auction: AuctionView };
  AUCTION_WON: { teamId: string; teamName: string; amount: number; questionId: string };
  AUCTION_CANCELLED: { auctionId: number };

  PREMIUM_UNLOCKED: { premium: PremiumState; teamId: string; risk: number };
  PREMIUM_ATTEMPT_STARTED: {
    premium: PremiumState;
    teamId: string;
    attemptNumber: number;
    risk: number;
  };
  PREMIUM_ATTEMPT_FAILED: { premium: PremiumState; teamId: string; result: AttemptResult };
  PREMIUM_RECLAIM_OFFERED: {
    premium: PremiumState;
    teamId: string;
    risk: number;
    deadline: number;
    failedTeamId: string | null;
  };
  PREMIUM_RECLAIM_ACCEPTED: { premium: PremiumState; teamId: string; risk: number };
  PREMIUM_RECLAIM_DECLINED: {
    premium: PremiumState;
    teamId: string;
    expired: boolean;
    nextTeamId: string | null;
  };
  PREMIUM_CLOSED: { premium: PremiumState };

  STRATEGY_STARTED: { endsAt: number; duration: number; nextSlotIndex: number | null };
  STRATEGY_ENDED: Record<string, never>;
  FINAL_STRETCH_STARTED: { remainingQuestions: number };
  PODIUM_REVEALED: { podium: PodiumEntry[]; leaderboard: LeaderboardRow[] };

  TEAM_CONNECTED: { teamId: string };
  TEAM_DISCONNECTED: { teamId: string };
  TEAM_UPDATED: { team: TeamPublic };
  TEAMS_REPLACED: { teams: TeamPublic[] };

  LIVE_EVENTS: { events: LiveEvent[] };
  AUDIT_APPENDED: { entries: AuditEntry[] };
  PROJECTOR_MODE: { mode: ProjectorMode };
  ME_UPDATED: { me: TeamView };
}

export type ProjectorMode =
  | 'auto'
  | 'leaderboard'
  | 'question'
  | 'auction'
  | 'reclaim'
  | 'strategy'
  | 'final_stretch'
  | 'podium';

/* ------------------------------------------------------------------ *
 * Client -> server commands
 * ------------------------------------------------------------------ */

export const CLIENT_COMMANDS = {
  HELLO: 'HELLO',
  PING: 'PING',
  REQUEST_CURRENT_STATE: 'REQUEST_CURRENT_STATE',

  // participant
  UNLOCK_QUESTION: 'UNLOCK_QUESTION',
  JOIN_QUESTION: 'JOIN_QUESTION',
  SKIP_QUESTION: 'SKIP_QUESTION',
  SUBMIT_ANSWER: 'SUBMIT_ANSWER',
  RECLAIM_RESPONSE: 'RECLAIM_RESPONSE',

  // organizer - game flow
  START_GAME: 'START_GAME',
  PAUSE_GAME: 'PAUSE_GAME',
  RESUME_GAME: 'RESUME_GAME',
  RESET_GAME: 'RESET_GAME',
  COMPLETE_GAME: 'COMPLETE_GAME',
  /** Move to the next slot in the generated sequence. */
  ADVANCE: 'ADVANCE',
  OPEN_SLOT: 'OPEN_SLOT',
  OPEN_QUESTION: 'OPEN_QUESTION',
  CLOSE_QUESTION: 'CLOSE_QUESTION',
  START_STRATEGY: 'START_STRATEGY',
  SKIP_STRATEGY: 'SKIP_STRATEGY',
  START_TIMER: 'START_TIMER',
  STOP_TIMER: 'STOP_TIMER',
  REVEAL_PODIUM: 'REVEAL_PODIUM',

  // organizer - auction
  START_AUCTION: 'START_AUCTION',
  PLACE_BID: 'PLACE_BID',
  UNDO_BID: 'UNDO_BID',
  CALL_AUCTION: 'CALL_AUCTION',
  CLOSE_AUCTION: 'CLOSE_AUCTION',
  CANCEL_AUCTION: 'CANCEL_AUCTION',

  // organizer - premium
  START_PREMIUM_ATTEMPT: 'START_PREMIUM_ATTEMPT',
  FORCE_PREMIUM_RESULT: 'FORCE_PREMIUM_RESULT',
  OFFER_RECLAIM: 'OFFER_RECLAIM',
  RESOLVE_RECLAIM: 'RESOLVE_RECLAIM',
  CLOSE_PREMIUM: 'CLOSE_PREMIUM',

  // organizer - teams / config
  UPDATE_CONFIG: 'UPDATE_CONFIG',
  CREATE_TEAMS: 'CREATE_TEAMS',
  UPDATE_TEAM: 'UPDATE_TEAM',
  DELETE_TEAM: 'DELETE_TEAM',
  ADJUST_CAPITAL: 'ADJUST_CAPITAL',
  SET_PROJECTOR_MODE: 'SET_PROJECTOR_MODE',

  // organizer - simulation
  SIM_SEED_TEAMS: 'SIM_SEED_TEAMS',
  SIM_RUN: 'SIM_RUN',
  SIM_STOP: 'SIM_STOP',
} as const;

export type ClientCommandName = (typeof CLIENT_COMMANDS)[keyof typeof CLIENT_COMMANDS];

export interface ClientPayloads {
  HELLO: { token: string; role: ClientRole; clientVersion: string };
  PING: { clientTime: number };
  REQUEST_CURRENT_STATE: Record<string, never>;

  UNLOCK_QUESTION: { questionId: string; accessKey: string };
  JOIN_QUESTION: { questionId: string };
  SKIP_QUESTION: { questionId: string };
  SUBMIT_ANSWER: { questionId: string; submission: SubmissionValue };
  RECLAIM_RESPONSE: { questionId: string; accept: boolean };

  START_GAME: Record<string, never>;
  PAUSE_GAME: Record<string, never>;
  RESUME_GAME: Record<string, never>;
  RESET_GAME: { keepTeams: boolean };
  COMPLETE_GAME: Record<string, never>;
  ADVANCE: Record<string, never>;
  OPEN_SLOT: { slotIndex: number };
  OPEN_QUESTION: Record<string, never>;
  CLOSE_QUESTION: Record<string, never>;
  START_STRATEGY: Record<string, never>;
  SKIP_STRATEGY: Record<string, never>;
  START_TIMER: { seconds: number; label: string };
  STOP_TIMER: Record<string, never>;
  REVEAL_PODIUM: Record<string, never>;

  START_AUCTION: { startingBid?: number; increment?: number };
  PLACE_BID: { teamId: string; amount?: number };
  UNDO_BID: Record<string, never>;
  CALL_AUCTION: { call: 'once' | 'twice' | 'reopen' };
  CLOSE_AUCTION: Record<string, never>;
  CANCEL_AUCTION: Record<string, never>;

  START_PREMIUM_ATTEMPT: Record<string, never>;
  FORCE_PREMIUM_RESULT: { result: 'correct' | 'wrong' | 'timeout' };
  OFFER_RECLAIM: { teamId?: string };
  RESOLVE_RECLAIM: { teamId: string; accept: boolean };
  CLOSE_PREMIUM: Record<string, never>;

  UPDATE_CONFIG: { patch: Partial<GameConfig> };
  CREATE_TEAMS: { teams: { id?: string; name: string; seatLabel?: string; volunteer?: string }[] };
  UPDATE_TEAM: {
    teamId: string;
    name?: string;
    seatLabel?: string;
    volunteer?: string;
    status?: string;
  };
  DELETE_TEAM: { teamId: string };
  ADJUST_CAPITAL: { teamId: string; amount: number; reason: string };
  SET_PROJECTOR_MODE: { mode: ProjectorMode };

  SIM_SEED_TEAMS: { count: number; replace: boolean };
  SIM_RUN: { scenario: string; intensity?: number };
  SIM_STOP: Record<string, never>;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function envelope<K extends keyof ServerPayloads>(
  t: K,
  d: ServerPayloads[K],
  seq?: number,
  rid?: string,
): Envelope<K & string, ServerPayloads[K]> {
  const frame: Envelope<K & string, ServerPayloads[K]> = { t: t as K & string, d, ts: Date.now() };
  if (seq !== undefined) frame.seq = seq;
  if (rid !== undefined) frame.rid = rid;
  return frame;
}

export function command<K extends keyof ClientPayloads>(
  t: K,
  d: ClientPayloads[K],
  rid?: string,
): Envelope<K & string, ClientPayloads[K]> {
  const frame: Envelope<K & string, ClientPayloads[K]> = { t: t as K & string, d, ts: Date.now() };
  if (rid !== undefined) frame.rid = rid;
  return frame;
}

/** Phases in which a participant may legally submit an answer. */
export const SUBMITTABLE_PHASES: GamePhase[] = ['question_active', 'premium_solving'];

/* ------------------------------------------------------------------ *
 * Export payloads
 * ------------------------------------------------------------------ */

export interface OrganizerExportRow {
  rank: number;
  place: string;
  teamId: string;
  team: string;
  startingCapital: number;
  finalCapital: number;
  attempted: number;
  correct: number;
  wrong: number;
  premiumWins: number;
  premiumAttempts: number;
  premiumCorrect: number;
  premiumWrong: number;
  totalProfitLoss: number;
}

export interface FullExport {
  event: { name: string; round: string; roundNumber: number; exportedAt: number };
  config: GameConfig;
  results: OrganizerExportRow[];
  podium: PodiumEntry[];
  sequence: SequenceEntry[];
  teams: unknown[];
  auctions: unknown[];
  bids: unknown[];
  attempts: unknown[];
  transactions: Transaction[];
  audit: AuditEntry[];
}
