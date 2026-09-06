/**
 * Repository layer: every SQL statement in the application lives here.
 * The engine above it deals only in domain objects.
 */

import type {
  Attempt,
  AuditEntry,
  Auction,
  AuctionStatus,
  Bid,
  Domain,
  Difficulty,
  GamePhase,
  GameState,
  LadderEntry,
  PodiumEntry,
  PremiumState,
  ProjectorMode,
  Question,
  QuestionKind,
  SequenceSlot,
  Team,
  TeamQuestionState,
  Transaction,
  TransactionType,
} from '@code-market/shared';
import { DEFAULT_CONFIG, applyConfigPatch, type GameConfig } from '@code-market/shared';
import type { DB } from '../db/index.js';

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

interface TeamRow {
  id: string;
  name: string;
  capital: number;
  starting_capital: number;
  protected_reserve: number;
  status: string;
  connection_status: string;
  join_code: string;
  seat_label: string | null;
  volunteer: string | null;
  created_at: number;
  last_seen_at: number | null;
}

interface QuestionRow {
  id: string;
  kind: string;
  title: string;
  domain: string;
  type: string;
  difficulty: string;
  time_limit: number;
  reward_override: number | null;
  penalty_override: number | null;
  question_data: string;
  evaluation_data: string;
  access_key: string;
  access_key_hash: string;
}

interface AuctionRow {
  id: number;
  question_id: string;
  slot_index: number;
  status: string;
  starting_bid: number;
  increment: number;
  current_bid: number | null;
  current_leader_team_id: string | null;
  winner_team_id: string | null;
  winning_amount: number | null;
  started_at: number | null;
  ended_at: number | null;
}

interface BidRow {
  id: number;
  auction_id: number;
  team_id: string;
  amount: number;
  sequence_number: number;
  timestamp: number;
  valid: number;
  rejected_reason: string | null;
}

interface GameStateRow {
  phase: string;
  resume_phase: string | null;
  slot_index: number;
  current_question_id: string | null;
  current_auction_id: number | null;
  timer_ends_at: number | null;
  timer_duration: number | null;
  timer_label: string | null;
  projector_mode: string;
  started_at: number | null;
  completed_at: number | null;
}

interface PremiumRow {
  question_id: string;
  slot_index: number;
  stage: string;
  auction_id: number | null;
  ladder: string;
  active_team_id: string | null;
  active_risk: number | null;
  attempt_number: number;
  offer_team_id: string | null;
  offer_risk: number | null;
  offer_deadline: number | null;
  failed_team_id: string | null;
  outcome: string | null;
  window_ends_at: number | null;
}

/* ------------------------------------------------------------------ *
 * Mappers
 * ------------------------------------------------------------------ */

const toTeam = (r: TeamRow): Team => ({
  id: r.id,
  name: r.name,
  capital: r.capital,
  startingCapital: r.starting_capital,
  protectedReserve: r.protected_reserve,
  status: r.status as Team['status'],
  connectionStatus: r.connection_status as Team['connectionStatus'],
  seatLabel: r.seat_label,
  volunteer: r.volunteer,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
});

const toQuestion = (r: QuestionRow): Question => {
  const base: Question = {
    id: r.id,
    kind: r.kind as QuestionKind,
    title: r.title,
    domain: r.domain as Domain,
    type: r.type as Question['type'],
    difficulty: r.difficulty as Difficulty,
    timeLimit: r.time_limit,
    question: JSON.parse(r.question_data),
    evaluation: JSON.parse(r.evaluation_data),
    accessKey: r.access_key,
  };
  if (r.reward_override !== null) base.rewardOverride = r.reward_override;
  if (r.penalty_override !== null) base.penaltyOverride = r.penalty_override;
  return base;
};

const toAuction = (r: AuctionRow): Auction => ({
  id: r.id,
  questionId: r.question_id,
  slotIndex: r.slot_index,
  status: r.status as AuctionStatus,
  startingBid: r.starting_bid,
  increment: r.increment,
  currentBid: r.current_bid,
  currentLeaderTeamId: r.current_leader_team_id,
  winnerTeamId: r.winner_team_id,
  winningAmount: r.winning_amount,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

const toBid = (r: BidRow): Bid => {
  const bid: Bid = {
    id: r.id,
    auctionId: r.auction_id,
    teamId: r.team_id,
    amount: r.amount,
    sequenceNumber: r.sequence_number,
    timestamp: r.timestamp,
    valid: r.valid === 1,
  };
  if (r.rejected_reason) bid.rejectedReason = r.rejected_reason;
  return bid;
};

/* ------------------------------------------------------------------ *
 * Repository
 * ------------------------------------------------------------------ */

export class Repo {
  constructor(private readonly db: DB) {}

  /* --- config ------------------------------------------------------ */

  loadConfig(): GameConfig {
    const rows = this.db.prepare('SELECT key, value FROM config').all() as {
      key: string;
      value: string;
    }[];
    if (rows.length === 0) return { ...DEFAULT_CONFIG };
    const patch: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        patch[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore a corrupted single key rather than losing the whole config */
      }
    }
    return applyConfigPatch(DEFAULT_CONFIG, patch as Partial<GameConfig>).config;
  }

  saveConfig(config: GameConfig): void {
    const stmt = this.db.prepare(
      'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const write = this.db.transaction((cfg: GameConfig) => {
      for (const [key, value] of Object.entries(cfg)) stmt.run(key, JSON.stringify(value));
    });
    write(config);
  }

  /* --- meta -------------------------------------------------------- */

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  /* --- teams ------------------------------------------------------- */

  listTeams(): Team[] {
    return (this.db.prepare('SELECT * FROM teams ORDER BY id').all() as TeamRow[]).map(toTeam);
  }

  getTeam(id: string): Team | null {
    const row = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as TeamRow | undefined;
    return row ? toTeam(row) : null;
  }

  getTeamByJoinCode(code: string): Team | null {
    const row = this.db
      .prepare('SELECT * FROM teams WHERE join_code = ? COLLATE NOCASE')
      .get(code) as TeamRow | undefined;
    return row ? toTeam(row) : null;
  }

  getJoinCode(teamId: string): string | null {
    const row = this.db.prepare('SELECT join_code FROM teams WHERE id = ?').get(teamId) as
      | { join_code: string }
      | undefined;
    return row?.join_code ?? null;
  }

  insertTeam(team: {
    id: string;
    name: string;
    capital: number;
    startingCapital: number;
    protectedReserve: number;
    joinCode: string;
    seatLabel?: string | null;
    volunteer?: string | null;
  }): Team {
    this.db
      .prepare(
        `INSERT INTO teams
         (id, name, capital, starting_capital, protected_reserve, status, connection_status,
          join_code, seat_label, volunteer, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', 'offline', ?, ?, ?, ?)`,
      )
      .run(
        team.id,
        team.name,
        team.capital,
        team.startingCapital,
        team.protectedReserve,
        team.joinCode,
        team.seatLabel ?? null,
        team.volunteer ?? null,
        Date.now(),
      );
    return this.getTeam(team.id) as Team;
  }

  updateTeam(
    id: string,
    patch: Partial<Pick<Team, 'name' | 'seatLabel' | 'volunteer' | 'status'>>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.seatLabel !== undefined) {
      sets.push('seat_label = ?');
      values.push(patch.seatLabel);
    }
    if (patch.volunteer !== undefined) {
      sets.push('volunteer = ?');
      values.push(patch.volunteer);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      values.push(patch.status);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteTeam(id: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }

  deleteAllTeams(): void {
    this.db.prepare('DELETE FROM teams').run();
  }

  setTeamCapital(id: string, capital: number): void {
    this.db.prepare('UPDATE teams SET capital = ? WHERE id = ?').run(Math.round(capital), id);
  }

  setConnectionStatus(id: string, status: 'online' | 'offline'): void {
    this.db
      .prepare('UPDATE teams SET connection_status = ?, last_seen_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
  }

  markAllOffline(): void {
    this.db.prepare("UPDATE teams SET connection_status = 'offline'").run();
  }

  resetTeamCapital(startingCapital: number, protectedReserve: number): void {
    this.db
      .prepare('UPDATE teams SET capital = ?, starting_capital = ?, protected_reserve = ?')
      .run(startingCapital, startingCapital, protectedReserve);
  }

  /* --- sessions ---------------------------------------------------- */

  createSession(token: string, teamId: string, role: string): void {
    this.db
      .prepare(
        'INSERT INTO team_sessions (token, team_id, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(token, teamId, role, Date.now(), Date.now());
  }

  getSession(token: string): { teamId: string; role: string } | null {
    const row = this.db
      .prepare('SELECT team_id, role FROM team_sessions WHERE token = ?')
      .get(token) as { team_id: string; role: string } | undefined;
    return row ? { teamId: row.team_id, role: row.role } : null;
  }

  deleteSessionsForTeam(teamId: string): void {
    this.db.prepare('DELETE FROM team_sessions WHERE team_id = ?').run(teamId);
  }

  /* --- question pool ------------------------------------------------ */

  listQuestions(): Question[] {
    return (this.db.prepare('SELECT * FROM questions ORDER BY id').all() as QuestionRow[]).map(
      toQuestion,
    );
  }

  getQuestion(id: string): Question | null {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as
      | QuestionRow
      | undefined;
    return row ? toQuestion(row) : null;
  }

  upsertQuestion(question: Question, accessKeyHash: string): void {
    this.db
      .prepare(
        `INSERT INTO questions
          (id, kind, title, domain, type, difficulty, time_limit,
           reward_override, penalty_override, question_data, evaluation_data,
           access_key, access_key_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind, title = excluded.title, domain = excluded.domain,
           type = excluded.type, difficulty = excluded.difficulty,
           time_limit = excluded.time_limit,
           reward_override = excluded.reward_override,
           penalty_override = excluded.penalty_override,
           question_data = excluded.question_data,
           evaluation_data = excluded.evaluation_data,
           access_key = excluded.access_key,
           access_key_hash = excluded.access_key_hash`,
      )
      .run(
        question.id,
        question.kind,
        question.title,
        question.domain,
        question.type,
        question.difficulty,
        question.timeLimit,
        question.rewardOverride ?? null,
        question.penaltyOverride ?? null,
        JSON.stringify(question.question),
        JSON.stringify(question.evaluation),
        question.accessKey,
        accessKeyHash,
      );
  }

  getAccessKeyHash(questionId: string): string | null {
    const row = this.db
      .prepare('SELECT access_key_hash FROM questions WHERE id = ?')
      .get(questionId) as { access_key_hash: string } | undefined;
    return row?.access_key_hash ?? null;
  }

  /* --- generated sequence -------------------------------------------- */

  saveSequence(slots: readonly SequenceSlot[]): void {
    const write = this.db.transaction((rows: readonly SequenceSlot[]) => {
      this.db.prepare('DELETE FROM game_sequence').run();
      const stmt = this.db.prepare(
        `INSERT INTO game_sequence (idx, block_number, position_in_block, kind, question_id, state)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const slot of rows) {
        stmt.run(
          slot.index,
          slot.blockNumber,
          slot.positionInBlock,
          slot.kind,
          slot.questionId,
          slot.state,
        );
      }
    });
    write(slots);
  }

  listSequence(): SequenceSlot[] {
    const rows = this.db.prepare('SELECT * FROM game_sequence ORDER BY idx').all() as {
      idx: number;
      block_number: number;
      position_in_block: number;
      kind: string;
      question_id: string;
      state: string;
    }[];
    return rows.map((r) => ({
      index: r.idx,
      blockNumber: r.block_number,
      positionInBlock: r.position_in_block,
      kind: r.kind as QuestionKind,
      questionId: r.question_id,
      state: r.state as SequenceSlot['state'],
    }));
  }

  getSlot(index: number): SequenceSlot | null {
    return this.listSequence().find((s) => s.index === index) ?? null;
  }

  setSlotState(index: number, state: SequenceSlot['state']): void {
    this.db.prepare('UPDATE game_sequence SET state = ? WHERE idx = ?').run(state, index);
  }

  clearSequence(): void {
    this.db.prepare('DELETE FROM game_sequence').run();
  }

  /* --- auctions ---------------------------------------------------- */

  createAuction(
    questionId: string,
    slotIndex: number,
    startingBid: number,
    increment: number,
  ): Auction {
    const info = this.db
      .prepare(
        `INSERT INTO auctions (question_id, slot_index, status, starting_bid, increment, started_at)
         VALUES (?, ?, 'open', ?, ?, ?)`,
      )
      .run(questionId, slotIndex, startingBid, increment, Date.now());
    return this.getAuction(Number(info.lastInsertRowid)) as Auction;
  }

  getAuction(id: number): Auction | null {
    const row = this.db.prepare('SELECT * FROM auctions WHERE id = ?').get(id) as
      | AuctionRow
      | undefined;
    return row ? toAuction(row) : null;
  }

  getAuctionForSlot(slotIndex: number): Auction | null {
    const row = this.db
      .prepare('SELECT * FROM auctions WHERE slot_index = ? ORDER BY id DESC LIMIT 1')
      .get(slotIndex) as AuctionRow | undefined;
    return row ? toAuction(row) : null;
  }

  listAuctions(): Auction[] {
    return (this.db.prepare('SELECT * FROM auctions ORDER BY id').all() as AuctionRow[]).map(
      toAuction,
    );
  }

  updateAuction(id: number, patch: Partial<Auction>): void {
    const map: Record<string, string> = {
      status: 'status',
      currentBid: 'current_bid',
      currentLeaderTeamId: 'current_leader_team_id',
      winnerTeamId: 'winner_team_id',
      winningAmount: 'winning_amount',
      endedAt: 'ended_at',
      startedAt: 'started_at',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(map)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        values.push((patch as Record<string, unknown>)[key] ?? null);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE auctions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /* --- bids -------------------------------------------------------- */

  nextBidSequence(auctionId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence_number), 0) AS n FROM bids WHERE auction_id = ?')
      .get(auctionId) as { n: number };
    return row.n + 1;
  }

  insertBid(bid: {
    auctionId: number;
    teamId: string;
    amount: number;
    sequenceNumber: number;
    valid: boolean;
    rejectedReason?: string | null;
  }): Bid {
    const info = this.db
      .prepare(
        `INSERT INTO bids (auction_id, team_id, amount, sequence_number, timestamp, valid, rejected_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bid.auctionId,
        bid.teamId,
        bid.amount,
        bid.sequenceNumber,
        Date.now(),
        bid.valid ? 1 : 0,
        bid.rejectedReason ?? null,
      );
    const row = this.db
      .prepare('SELECT * FROM bids WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as BidRow;
    return toBid(row);
  }

  listBids(auctionId: number, onlyValid = true): Bid[] {
    const sql = onlyValid
      ? 'SELECT * FROM bids WHERE auction_id = ? AND valid = 1 ORDER BY sequence_number'
      : 'SELECT * FROM bids WHERE auction_id = ? ORDER BY sequence_number';
    return (this.db.prepare(sql).all(auctionId) as BidRow[]).map(toBid);
  }

  listAllBids(): Bid[] {
    return (this.db.prepare('SELECT * FROM bids ORDER BY id').all() as BidRow[]).map(toBid);
  }

  listBidsForTeam(teamId: string): Bid[] {
    return (
      this.db.prepare('SELECT * FROM bids WHERE team_id = ? ORDER BY id').all(teamId) as BidRow[]
    ).map(toBid);
  }

  lastValidBid(auctionId: number): Bid | null {
    const row = this.db
      .prepare(
        'SELECT * FROM bids WHERE auction_id = ? AND valid = 1 ORDER BY sequence_number DESC LIMIT 1',
      )
      .get(auctionId) as BidRow | undefined;
    return row ? toBid(row) : null;
  }

  deleteBid(id: number): void {
    this.db.prepare('DELETE FROM bids WHERE id = ?').run(id);
  }

  /* --- premium state ------------------------------------------------ */

  getPremiumState(questionId: string): PremiumState | null {
    const row = this.db
      .prepare('SELECT * FROM premium_states WHERE question_id = ?')
      .get(questionId) as PremiumRow | undefined;
    if (!row) return null;
    return {
      questionId: row.question_id,
      slotIndex: row.slot_index,
      stage: row.stage as PremiumState['stage'],
      auctionId: row.auction_id,
      ladder: JSON.parse(row.ladder) as LadderEntry[],
      activeTeamId: row.active_team_id,
      activeRisk: row.active_risk,
      attemptNumber: row.attempt_number as 0 | 1 | 2,
      offerTeamId: row.offer_team_id,
      offerRisk: row.offer_risk,
      offerDeadline: row.offer_deadline,
      failedTeamId: row.failed_team_id,
      outcome: row.outcome as PremiumState['outcome'],
      windowEndsAt: row.window_ends_at,
    };
  }

  savePremiumState(state: PremiumState): void {
    this.db
      .prepare(
        `INSERT INTO premium_states
          (question_id, slot_index, stage, auction_id, ladder, active_team_id, active_risk,
           attempt_number, offer_team_id, offer_risk, offer_deadline, failed_team_id, outcome,
           window_ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(question_id) DO UPDATE SET
           slot_index = excluded.slot_index, stage = excluded.stage,
           auction_id = excluded.auction_id, ladder = excluded.ladder,
           active_team_id = excluded.active_team_id, active_risk = excluded.active_risk,
           attempt_number = excluded.attempt_number, offer_team_id = excluded.offer_team_id,
           offer_risk = excluded.offer_risk, offer_deadline = excluded.offer_deadline,
           failed_team_id = excluded.failed_team_id, outcome = excluded.outcome,
           window_ends_at = excluded.window_ends_at`,
      )
      .run(
        state.questionId,
        state.slotIndex,
        state.stage,
        state.auctionId,
        JSON.stringify(state.ladder),
        state.activeTeamId,
        state.activeRisk,
        state.attemptNumber,
        state.offerTeamId,
        state.offerRisk,
        state.offerDeadline,
        state.failedTeamId,
        state.outcome,
        state.windowEndsAt,
      );
  }

  listPremiumStates(): PremiumState[] {
    const rows = this.db.prepare('SELECT question_id FROM premium_states').all() as {
      question_id: string;
    }[];
    return rows
      .map((r) => this.getPremiumState(r.question_id))
      .filter((s): s is PremiumState => s !== null);
  }

  /* --- attempts ---------------------------------------------------- */

  insertAttempt(attempt: {
    teamId: string;
    questionId: string;
    slotIndex: number;
    attemptNumber: number;
    result: string;
    scoreChange: number;
    riskAmount?: number | null;
    durationMs?: number | null;
    detail?: string | null;
    submission?: unknown;
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO attempts
          (team_id, question_id, slot_index, attempt_number, result, score_change, risk_amount,
           timestamp, duration_ms, detail, submission)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.teamId,
        attempt.questionId,
        attempt.slotIndex,
        attempt.attemptNumber,
        attempt.result,
        Math.round(attempt.scoreChange),
        attempt.riskAmount ?? null,
        Date.now(),
        attempt.durationMs ?? null,
        attempt.detail ?? null,
        attempt.submission === undefined ? null : JSON.stringify(attempt.submission),
      );
    return Number(info.lastInsertRowid);
  }

  hasAttempt(teamId: string, slotIndex: number): boolean {
    const row = this.db
      .prepare('SELECT 1 AS x FROM attempts WHERE team_id = ? AND slot_index = ? LIMIT 1')
      .get(teamId, slotIndex);
    return row !== undefined;
  }

  listAttempts(): Attempt[] {
    const rows = this.db.prepare('SELECT * FROM attempts ORDER BY id').all() as {
      id: number;
      team_id: string;
      question_id: string;
      slot_index: number;
      attempt_number: number;
      result: string;
      score_change: number;
      risk_amount: number | null;
      timestamp: number;
      duration_ms: number | null;
      detail: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      questionId: r.question_id,
      slotIndex: r.slot_index,
      attemptNumber: r.attempt_number,
      result: r.result as Attempt['result'],
      scoreChange: r.score_change,
      riskAmount: r.risk_amount,
      timestamp: r.timestamp,
      durationMs: r.duration_ms,
      detail: r.detail,
    }));
  }

  listAttemptsForTeam(teamId: string): Attempt[] {
    return this.listAttempts().filter((a) => a.teamId === teamId);
  }

  countAttemptsForSlot(slotIndex: number): { attempts: number; correct: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS attempts,
                SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) AS correct
         FROM attempts WHERE slot_index = ? AND result != 'skipped'`,
      )
      .get(slotIndex) as { attempts: number; correct: number | null };
    return { attempts: row.attempts, correct: row.correct ?? 0 };
  }

  /* --- transactions ------------------------------------------------ */

  insertTransaction(tx: {
    teamId: string;
    amount: number;
    balanceAfter: number;
    type: TransactionType;
    reason: string;
    questionId?: string | null;
    slotIndex?: number | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO transactions
          (team_id, amount, balance_after, type, reason, question_id, slot_index, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tx.teamId,
        Math.round(tx.amount),
        Math.round(tx.balanceAfter),
        tx.type,
        tx.reason,
        tx.questionId ?? null,
        tx.slotIndex ?? null,
        Date.now(),
      );
  }

  listTransactions(): Transaction[] {
    const rows = this.db.prepare('SELECT * FROM transactions ORDER BY id').all() as {
      id: number;
      team_id: string;
      amount: number;
      balance_after: number;
      type: string;
      reason: string;
      question_id: string | null;
      timestamp: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      amount: r.amount,
      balanceAfter: r.balance_after,
      type: r.type as TransactionType,
      reason: r.reason,
      questionId: r.question_id,
      timestamp: r.timestamp,
    }));
  }

  listTransactionsForTeam(teamId: string): Transaction[] {
    return this.listTransactions().filter((t) => t.teamId === teamId);
  }

  /* --- participation ----------------------------------------------- */

  setParticipation(
    teamId: string,
    slotIndex: number,
    questionId: string,
    state: TeamQuestionState,
    stamps: { unlocked?: boolean; joined?: boolean; submitted?: boolean } = {},
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO participation (team_id, slot_index, question_id, state, unlocked_at, joined_at, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(team_id, slot_index) DO UPDATE SET
           state = excluded.state,
           question_id = excluded.question_id,
           unlocked_at = COALESCE(participation.unlocked_at, excluded.unlocked_at),
           joined_at = COALESCE(participation.joined_at, excluded.joined_at),
           submitted_at = COALESCE(excluded.submitted_at, participation.submitted_at)`,
      )
      .run(
        teamId,
        slotIndex,
        questionId,
        state,
        stamps.unlocked ? now : null,
        stamps.joined ? now : null,
        stamps.submitted ? now : null,
      );
  }

  getParticipation(
    teamId: string,
    slotIndex: number,
  ): { state: TeamQuestionState; joinedAt: number | null; submittedAt: number | null } | null {
    const row = this.db
      .prepare(
        'SELECT state, joined_at, submitted_at FROM participation WHERE team_id = ? AND slot_index = ?',
      )
      .get(teamId, slotIndex) as
      | { state: string; joined_at: number | null; submitted_at: number | null }
      | undefined;
    if (!row) return null;
    return {
      state: row.state as TeamQuestionState,
      joinedAt: row.joined_at,
      submittedAt: row.submitted_at,
    };
  }

  listParticipationForSlot(
    slotIndex: number,
  ): { teamId: string; state: TeamQuestionState; joinedAt: number | null }[] {
    const rows = this.db
      .prepare('SELECT team_id, state, joined_at FROM participation WHERE slot_index = ?')
      .all(slotIndex) as { team_id: string; state: string; joined_at: number | null }[];
    return rows.map((r) => ({
      teamId: r.team_id,
      state: r.state as TeamQuestionState,
      joinedAt: r.joined_at,
    }));
  }

  setJoinedAt(teamId: string, slotIndex: number, joinedAt: number): void {
    this.db
      .prepare('UPDATE participation SET joined_at = ? WHERE team_id = ? AND slot_index = ?')
      .run(joinedAt, teamId, slotIndex);
  }

  /* --- game state -------------------------------------------------- */

  getGameState(): GameState & { projectorMode: ProjectorMode } {
    const row = this.db.prepare('SELECT * FROM game_state WHERE id = 1').get() as GameStateRow;
    return {
      phase: row.phase as GamePhase,
      resumePhase: (row.resume_phase as GamePhase | null) ?? null,
      slotIndex: row.slot_index,
      currentQuestionId: row.current_question_id,
      currentAuctionId: row.current_auction_id,
      blockNumber: 0,
      totalBlocks: 0,
      totalSlots: 0,
      finalStretch: false,
      timer: {
        endsAt: row.timer_ends_at,
        duration: row.timer_duration,
        label: row.timer_label,
      },
      serverNow: Date.now(),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      projectorMode: row.projector_mode as ProjectorMode,
    };
  }

  saveGameState(patch: Partial<GameState & { projectorMode: ProjectorMode }>): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      values.push(value ?? null);
    };
    if (patch.phase !== undefined) push('phase', patch.phase);
    if (patch.resumePhase !== undefined) push('resume_phase', patch.resumePhase);
    if (patch.slotIndex !== undefined) push('slot_index', patch.slotIndex);
    if (patch.currentQuestionId !== undefined) push('current_question_id', patch.currentQuestionId);
    if (patch.currentAuctionId !== undefined) push('current_auction_id', patch.currentAuctionId);
    if (patch.timer !== undefined) {
      push('timer_ends_at', patch.timer.endsAt);
      push('timer_duration', patch.timer.duration);
      push('timer_label', patch.timer.label);
    }
    if (patch.projectorMode !== undefined) push('projector_mode', patch.projectorMode);
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt);
    if (patch.completedAt !== undefined) push('completed_at', patch.completedAt);
    if (sets.length === 0) return;
    push('updated_at', Date.now());
    this.db.prepare(`UPDATE game_state SET ${sets.join(', ')} WHERE id = 1`).run(...values);
  }

  /* --- final results ------------------------------------------------ */

  saveFinalResults(entries: readonly PodiumEntry[]): void {
    const write = this.db.transaction((rows: readonly PodiumEntry[]) => {
      this.db.prepare('DELETE FROM final_results').run();
      const stmt = this.db.prepare(
        'INSERT INTO final_results (team_id, place, capital, delta, recorded_at) VALUES (?, ?, ?, ?, ?)',
      );
      for (const row of rows) stmt.run(row.teamId, row.place, row.capital, row.delta, Date.now());
    });
    write(entries);
  }

  listFinalResults(): PodiumEntry[] {
    const rows = this.db
      .prepare(
        `SELECT f.team_id, f.place, f.capital, f.delta, t.name
         FROM final_results f LEFT JOIN teams t ON t.id = f.team_id
         ORDER BY f.place`,
      )
      .all() as { team_id: string; place: number; capital: number; delta: number; name: string | null }[];
    return rows.map((r) => ({
      place: r.place,
      teamId: r.team_id,
      name: r.name ?? r.team_id,
      capital: r.capital,
      delta: r.delta,
    }));
  }

  /* --- audit ------------------------------------------------------- */

  appendAudit(entry: {
    action: string;
    teamId?: string | null;
    questionId?: string | null;
    slotIndex?: number | null;
    metadata?: Record<string, unknown>;
  }): AuditEntry {
    const now = Date.now();
    const info = this.db
      .prepare(
        'INSERT INTO audit_log (action, team_id, question_id, slot_index, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        entry.action,
        entry.teamId ?? null,
        entry.questionId ?? null,
        entry.slotIndex ?? null,
        now,
        JSON.stringify(entry.metadata ?? {}),
      );
    return {
      id: Number(info.lastInsertRowid),
      action: entry.action,
      teamId: entry.teamId ?? null,
      questionId: entry.questionId ?? null,
      timestamp: now,
      metadata: entry.metadata ?? {},
    };
  }

  listAudit(limit = 500): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as {
      id: number;
      action: string;
      team_id: string | null;
      question_id: string | null;
      timestamp: number;
      metadata: string;
    }[];
    return rows
      .map((r) => ({
        id: r.id,
        action: r.action,
        teamId: r.team_id,
        questionId: r.question_id,
        timestamp: r.timestamp,
        metadata: safeParse(r.metadata),
      }))
      .reverse();
  }

  listAuditForTeam(teamId: string, limit = 300): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE team_id = ? ORDER BY id DESC LIMIT ?')
      .all(teamId, limit) as {
      id: number;
      action: string;
      team_id: string | null;
      question_id: string | null;
      timestamp: number;
      metadata: string;
    }[];
    return rows
      .map((r) => ({
        id: r.id,
        action: r.action,
        teamId: r.team_id,
        questionId: r.question_id,
        timestamp: r.timestamp,
        metadata: safeParse(r.metadata),
      }))
      .reverse();
  }

  /* --- reset ------------------------------------------------------- */

  resetGameData(): void {
    const wipe = this.db.transaction(() => {
      this.db.prepare('DELETE FROM bids').run();
      this.db.prepare('DELETE FROM auctions').run();
      this.db.prepare('DELETE FROM premium_states').run();
      this.db.prepare('DELETE FROM attempts').run();
      this.db.prepare('DELETE FROM transactions').run();
      this.db.prepare('DELETE FROM participation').run();
      this.db.prepare('DELETE FROM audit_log').run();
      this.db.prepare('DELETE FROM game_sequence').run();
      this.db.prepare('DELETE FROM final_results').run();
      this.db
        .prepare(
          `UPDATE game_state SET phase='idle', resume_phase=NULL, slot_index=0,
             current_question_id=NULL, current_auction_id=NULL, timer_ends_at=NULL,
             timer_duration=NULL, timer_label=NULL, projector_mode='auto',
             started_at=NULL, completed_at=NULL, updated_at=? WHERE id=1`,
        )
        .run(Date.now());
    });
    wipe();
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
