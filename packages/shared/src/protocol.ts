/**
 * The real-time protocol (spec section 20).
 *
 * Design rules:
 *  - Every message is a small JSON envelope: { t, d, seq, ts }.
 *  - The server stamps a monotonic `seq` on every broadcast. A client that sees
 *    a gap asks for a resync instead of guessing (spec section 36).
 *  - Broadcasts are DELTAS wherever possible; full snapshots are sent only on
 *    connect / resync, so 50 laptops do not each receive the world on every bid
 *    (spec section 39).
 */

import type { GameConfig } from './config.js';
import type {
  Auction,
  AuctionStatus,
  AttemptResult,
  Bid,
  ChallengePublic,
  GameState,
  LadderEntry,
  LeaderboardRow,
  LiveEvent,
  PremiumState,
  SubmissionValue,
  TeamPublic,
  TeamView,
  Challenge,
  AuditEntry,
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
 * Server -> client events
 * ------------------------------------------------------------------ */

export interface AuctionView {
  auction: Auction;
  challenge: { id: string; index: number; title: string; category: string; marketType: string };
  /** Distinct active bidders, highest bid first. */
  bidders: { teamId: string; teamName: string; amount: number; isLeader: boolean }[];
  history: Bid[];
  nextBid: number;
  ladder: LadderEntry[];
}

export interface Snapshot {
  role: ClientRole;
  config: GameConfig;
  game: GameState;
  teams: TeamPublic[];
  leaderboard: LeaderboardRow[];
  auction: AuctionView | null;
  premium: PremiumState | null;
  /** Sanitised challenge, present only when this client may see it. */
  challenge: ChallengePublic | null;
  /** Participant-only private view. */
  me: TeamView | null;
  /** Organizer-only extras. */
  liveEvents?: LiveEvent[];
  challengeIndex?: ChallengeSummary[];
  seq: number;
  serverNow: number;
}

export interface ChallengeSummary {
  id: string;
  index: number;
  title: string;
  category: string;
  type: string;
  difficulty: string;
  marketType: string;
  timeLimit: number;
  accessKey: string;
  state: 'pending' | 'active' | 'complete';
  attempts: number;
  correct: number;
}

export interface ResultBroadcast {
  teamId: string;
  teamName: string;
  challengeId: string;
  challengeIndex: number;
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
  TIMER_STARTED: 'TIMER_STARTED',
  TIMER_STOPPED: 'TIMER_STOPPED',
  TIMER_EXPIRED: 'TIMER_EXPIRED',

  CHALLENGE_OPENED: 'CHALLENGE_OPENED',
  CHALLENGE_CLOSED: 'CHALLENGE_CLOSED',
  CHALLENGE_UNLOCKED: 'CHALLENGE_UNLOCKED',
  CHALLENGE_SUBMITTED: 'CHALLENGE_SUBMITTED',
  CHALLENGE_RESULT: 'CHALLENGE_RESULT',

  CAPITAL_CHANGED: 'CAPITAL_CHANGED',
  LEADERBOARD_UPDATED: 'LEADERBOARD_UPDATED',

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

/** Payload map so both sides stay honest about shapes. */
export interface ServerPayloads {
  SNAPSHOT: Snapshot;
  ERROR: { code: string; message: string; rid?: string };
  ACK: { ok: true; rid?: string; data?: unknown };
  PONG: { clientTime: number };

  CONFIG_UPDATED: { config: GameConfig };

  GAME_STARTED: { game: GameState };
  GAME_PAUSED: { game: GameState };
  GAME_RESUMED: { game: GameState };
  GAME_COMPLETE: { game: GameState; leaderboard: LeaderboardRow[] };
  GAME_RESET: Record<string, never>;
  PHASE_CHANGED: { game: GameState };
  TIMER_STARTED: { endsAt: number; duration: number; label: string };
  TIMER_STOPPED: Record<string, never>;
  TIMER_EXPIRED: { label: string };

  CHALLENGE_OPENED: { challenge: ChallengePublic; game: GameState };
  CHALLENGE_CLOSED: { challengeId: string };
  CHALLENGE_UNLOCKED: { challengeId: string; teamId: string; risk: number };
  CHALLENGE_SUBMITTED: { teamId: string; challengeId: string; at: number };
  CHALLENGE_RESULT: ResultBroadcast;

  CAPITAL_CHANGED: CapitalChange;
  LEADERBOARD_UPDATED: { rows: LeaderboardRow[]; changed: string[] };

  AUCTION_STARTED: { auction: AuctionView };
  AUCTION_BID: { auction: AuctionView; bid: Bid; outbidTeamId: string | null };
  AUCTION_BID_REJECTED: { teamId: string; amount: number; reason: string; message: string };
  AUCTION_BID_UNDONE: { auction: AuctionView; removedBidId: number };
  AUCTION_CALL: { status: AuctionStatus; amount: number | null };
  AUCTION_CLOSED: { auction: AuctionView };
  AUCTION_WON: { teamId: string; teamName: string; amount: number; challengeId: string };
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

  TEAM_CONNECTED: { teamId: string };
  TEAM_DISCONNECTED: { teamId: string };
  TEAM_UPDATED: { team: TeamPublic };
  TEAMS_REPLACED: { teams: TeamPublic[] };

  LIVE_EVENTS: { events: LiveEvent[] };
  AUDIT_APPENDED: { entries: AuditEntry[] };
  PROJECTOR_MODE: { mode: ProjectorMode };
  ME_UPDATED: { me: TeamView };
}

export type ProjectorMode = 'auto' | 'leaderboard' | 'auction' | 'reclaim' | 'result' | 'final';

/* ------------------------------------------------------------------ *
 * Client -> server commands
 * ------------------------------------------------------------------ */

export const CLIENT_COMMANDS = {
  HELLO: 'HELLO',
  PING: 'PING',
  REQUEST_CURRENT_STATE: 'REQUEST_CURRENT_STATE',

  // participant
  UNLOCK_CHALLENGE: 'UNLOCK_CHALLENGE',
  JOIN_CHALLENGE: 'JOIN_CHALLENGE',
  SKIP_CHALLENGE: 'SKIP_CHALLENGE',
  SUBMIT_ANSWER: 'SUBMIT_ANSWER',
  RECLAIM_RESPONSE: 'RECLAIM_RESPONSE',

  // organizer - game
  START_GAME: 'START_GAME',
  PAUSE_GAME: 'PAUSE_GAME',
  RESUME_GAME: 'RESUME_GAME',
  RESET_GAME: 'RESET_GAME',
  COMPLETE_GAME: 'COMPLETE_GAME',
  OPEN_CHALLENGE: 'OPEN_CHALLENGE',
  CLOSE_CHALLENGE: 'CLOSE_CHALLENGE',
  START_TIMER: 'START_TIMER',
  STOP_TIMER: 'STOP_TIMER',
  SET_PHASE: 'SET_PHASE',

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

  UNLOCK_CHALLENGE: { challengeId: string; accessKey: string };
  JOIN_CHALLENGE: { challengeId: string };
  SKIP_CHALLENGE: { challengeId: string };
  SUBMIT_ANSWER: { challengeId: string; submission: SubmissionValue };
  RECLAIM_RESPONSE: { challengeId: string; accept: boolean };

  START_GAME: Record<string, never>;
  PAUSE_GAME: Record<string, never>;
  RESUME_GAME: Record<string, never>;
  RESET_GAME: { keepTeams: boolean };
  COMPLETE_GAME: Record<string, never>;
  OPEN_CHALLENGE: { challengeId: string };
  CLOSE_CHALLENGE: { challengeId: string };
  START_TIMER: { seconds: number; label: string };
  STOP_TIMER: Record<string, never>;
  SET_PHASE: { phase: string };

  START_AUCTION: { challengeId: string; startingBid?: number; increment?: number };
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
  UPDATE_TEAM: { teamId: string; name?: string; seatLabel?: string; volunteer?: string; status?: string };
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

/** Organizer-only inspection payloads served over REST, typed here for reuse. */
export interface OrganizerExportRow {
  rank: number;
  teamId: string;
  team: string;
  startingCapital: number;
  finalCapital: number;
  normalAttempted: number;
  normalCorrect: number;
  premiumWins: number;
  premiumAttempts: number;
  premiumCorrect: number;
  premiumWrong: number;
  totalProfitLoss: number;
  qualification: 'QUALIFIED' | 'NOT QUALIFIED';
}

export interface FullExport {
  event: { name: string; round: string; exportedAt: number };
  config: GameConfig;
  results: OrganizerExportRow[];
  teams: unknown[];
  challenges: Pick<Challenge, 'id' | 'index' | 'title' | 'marketType' | 'category'>[];
  auctions: unknown[];
  bids: unknown[];
  attempts: unknown[];
  transactions: Transaction[];
  audit: AuditEntry[];
}
