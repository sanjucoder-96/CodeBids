/**
 * The authoritative game engine (spec sections 3, 33).
 *
 * Every meaningful action follows exactly one path:
 *
 *    CLIENT ACTION -> SERVER VALIDATION -> DATABASE UPDATE
 *                  -> REAL-TIME BROADCAST -> UI UPDATE
 *
 * Clients never decide capital, bid validity or ranking. The engine emits typed
 * events with an AUDIENCE; the WebSocket hub is the only thing that knows about
 * sockets, which keeps the whole state machine unit-testable without a network.
 */

import {
  DEFAULT_CONFIG,
  applyConfigPatch,
  buildLadder,
  applyLadderTransition,
  canStartAnotherAttempt,
  closeLadder,
  computeLeaderboard,
  emptyPremiumState,
  evaluateAnswer,
  isPremiumType,
  maxBid,
  nextBidAmount,
  nextCandidate,
  rankMap,
  resolveAdjustment,
  resolveMarket,
  resolvePremium,
  marketReward as calcReward,
  marketPenalty as calcPenalty,
  validateBid,
  padTeamNumber,
} from '@code-market/shared';
import type {
  Attempt,
  AuctionStatus,
  Challenge,
  ChallengePublic,
  ChallengeSummary,
  GameConfig,
  GamePhase,
  GameState,
  LadderEntry,
  LeaderboardRow,
  LiveEvent,
  PremiumState,
  ProjectorMode,
  ServerPayloads,
  Snapshot,
  SubmissionValue,
  Team,
  TeamPublic,
  TeamStats,
  TeamView,
  AuctionView,
} from '@code-market/shared';
import type { Repo } from '../repo/index.js';
import type { AuthService } from '../auth.js';
import { generateJoinCode, hashAccessKey, verifyAccessKey } from '../auth.js';
import type { CodeRunner } from './codeRunner.js';
import { CHALLENGE_POOL } from '../content/challenges.js';

/* ------------------------------------------------------------------ *
 * Event plumbing
 * ------------------------------------------------------------------ */

export type Audience =
  | { kind: 'all' }
  | { kind: 'organizer' }
  | { kind: 'projector' }
  | { kind: 'participants' }
  | { kind: 'team'; teamId: string }
  | { kind: 'stage' }; // organizer + projector

export interface EngineEvent<K extends keyof ServerPayloads = keyof ServerPayloads> {
  name: K;
  payload: ServerPayloads[K];
  audience: Audience;
}

export type EngineListener = (event: EngineEvent) => void;

export const ALL: Audience = { kind: 'all' };
export const ORGANIZER: Audience = { kind: 'organizer' };
export const STAGE: Audience = { kind: 'stage' };
const team = (teamId: string): Audience => ({ kind: 'team', teamId });

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface EngineDeps {
  repo: Repo;
  auth: AuthService;
  secret: string;
  runner: CodeRunner | null;
  /** Injectable clock so tests can run without real time passing. */
  now?: () => number;
}

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export class GameEngine {
  private readonly repo: Repo;
  private readonly auth: AuthService;
  private readonly secret: string;
  private readonly runner: CodeRunner | null;
  private readonly listeners = new Set<EngineListener>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  private config: GameConfig;
  private previousRanks = new Map<string, number>();
  private leaderboardCache: LeaderboardRow[] = [];
  private disposed = false;

  readonly now: () => number;

  constructor(deps: EngineDeps) {
    this.repo = deps.repo;
    this.auth = deps.auth;
    this.secret = deps.secret;
    this.runner = deps.runner;
    this.now = deps.now ?? (() => Date.now());
    this.config = this.repo.loadConfig();
    this.refreshLeaderboard(false);
  }

  /* --- lifecycle --------------------------------------------------- */

  on(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit<K extends keyof ServerPayloads>(
    name: K,
    payload: ServerPayloads[K],
    audience: Audience,
  ): void {
    if (this.disposed) return;
    const event: EngineEvent = { name, payload, audience } as EngineEvent;
    for (const listener of this.listeners) listener(event);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  getConfig(): GameConfig {
    return this.config;
  }

  /* --- bootstrap --------------------------------------------------- */

  /** Load the fixed question pool into SQLite (idempotent). */
  seedChallenges(pool: Challenge[] = CHALLENGE_POOL): void {
    for (const challenge of pool) {
      this.repo.upsertChallenge(challenge, hashAccessKey(challenge.accessKey, this.secret));
    }
  }

  /** Recreate timers after a restart so an in-flight round keeps running. */
  restoreTimers(): void {
    const state = this.repo.getGameState();
    if (state.timer.endsAt && state.timer.endsAt > this.now()) {
      this.scheduleGlobalTimer(state.timer.endsAt, state.timer.label ?? 'TIMER');
    }
    for (const premium of this.repo.listPremiumStates()) {
      if (premium.stage === 'reclaim_offer' && premium.offerDeadline) {
        this.scheduleReclaimExpiry(premium.challengeId, premium.offerDeadline);
      }
    }
    const challengeId = state.currentChallengeId;
    if (challengeId) {
      const challenge = this.repo.getChallenge(challengeId);
      if (challenge && !isPremiumType(challenge.marketType)) {
        for (const p of this.repo.listParticipationForChallenge(challengeId)) {
          if (p.state === 'in_progress' && p.joinedAt) {
            this.scheduleTeamDeadline(p.teamId, challenge, p.joinedAt);
          }
        }
      }
    }
  }

  /* --- teams ------------------------------------------------------- */

  createTeams(
    specs: { id?: string; name: string; seatLabel?: string; volunteer?: string }[],
  ): Team[] {
    const existing = this.repo.listTeams();
    let counter = existing.length;
    const created: Team[] = [];

    for (const spec of specs) {
      counter += 1;
      const id = spec.id?.trim() || padTeamNumber(counter);
      if (this.repo.getTeam(id)) {
        throw new EngineError('team_exists', `Team ${id} already exists`);
      }
      const team = this.repo.insertTeam({
        id,
        name: spec.name.trim() || id,
        capital: this.config.startingCapital,
        startingCapital: this.config.startingCapital,
        protectedReserve: this.config.protectedReserve,
        joinCode: this.uniqueJoinCode(),
        seatLabel: spec.seatLabel ?? null,
        volunteer: spec.volunteer ?? null,
      });
      this.repo.insertTransaction({
        teamId: id,
        amount: this.config.startingCapital,
        balanceAfter: this.config.startingCapital,
        type: 'initial',
        reason: 'Starting capital',
      });
      this.audit('TEAM_CREATED', { teamId: id, metadata: { name: team.name } });
      created.push(team);
    }

    this.broadcastTeams();
    this.refreshLeaderboard();
    return created;
  }

  private uniqueJoinCode(): string {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      if (!this.repo.getTeamByJoinCode(code)) return code;
    }
    throw new EngineError('join_code_exhausted', 'Could not allocate a unique join code');
  }

  updateTeam(teamId: string, patch: Parameters<Repo['updateTeam']>[1]): void {
    const existing = this.requireTeam(teamId);
    this.repo.updateTeam(teamId, patch);
    this.audit('TEAM_UPDATED', { teamId, metadata: { ...patch, previousName: existing.name } });
    this.broadcastTeams();
    this.refreshLeaderboard();
  }

  deleteTeam(teamId: string): void {
    this.requireTeam(teamId);
    this.repo.deleteSessionsForTeam(teamId);
    this.repo.deleteTeam(teamId);
    this.audit('TEAM_DELETED', { teamId });
    this.broadcastTeams();
    this.refreshLeaderboard();
  }

  setConnection(teamId: string, status: 'online' | 'offline'): void {
    const team = this.repo.getTeam(teamId);
    if (!team) return;
    if (team.connectionStatus === status) return;
    this.repo.setConnectionStatus(teamId, status);
    this.audit(status === 'online' ? 'TEAM_CONNECTED' : 'TEAM_DISCONNECTED', { teamId });
    this.emit(
      status === 'online' ? 'TEAM_CONNECTED' : 'TEAM_DISCONNECTED',
      { teamId },
      STAGE,
    );
    this.broadcastTeams();
    this.refreshLeaderboard();
    this.broadcastLiveEvents();
  }

  adjustCapital(teamId: string, amount: number, reason: string): void {
    const team = this.requireTeam(teamId);
    const result = resolveAdjustment(this.config, team.capital, amount);
    this.applyCapital(team, result.delta, 'manual_adjustment', reason, null);
    this.audit('CAPITAL_ADJUSTED', {
      teamId,
      metadata: { amount: result.delta, reason, from: team.capital, to: result.newCapital },
    });
  }

  /* --- config ------------------------------------------------------ */

  updateConfig(patch: Partial<GameConfig>): { ok: boolean; errors: string[] } {
    const result = applyConfigPatch(this.config, patch);
    this.config = result.config;
    this.repo.saveConfig(this.config);
    this.audit('CONFIG_UPDATED', { metadata: { keys: Object.keys(patch) } });
    this.emit('CONFIG_UPDATED', { config: this.config }, ALL);
    this.refreshLeaderboard();
    return { ok: result.ok, errors: result.errors };
  }

  /* --- game flow --------------------------------------------------- */

  private setPhase(phase: GamePhase, extra: Partial<GameState> = {}): GameState {
    this.repo.saveGameState({ phase, ...extra });
    const state = this.gameState();
    this.emit('PHASE_CHANGED', { game: state }, ALL);
    return state;
  }

  gameState(): GameState {
    const { projectorMode: _mode, ...rest } = this.repo.getGameState();
    void _mode;
    return { ...rest, serverNow: this.now() };
  }

  projectorMode(): ProjectorMode {
    return this.repo.getGameState().projectorMode;
  }

  setProjectorMode(mode: ProjectorMode): void {
    this.repo.saveGameState({ projectorMode: mode });
    this.emit('PROJECTOR_MODE', { mode }, ALL);
  }

  startGame(): void {
    const teams = this.repo.listTeams();
    if (teams.length === 0) {
      throw new EngineError('no_teams', 'Create teams before starting the round');
    }
    this.repo.saveGameState({ startedAt: this.now(), completedAt: null });
    const state = this.setPhase('lobby');
    this.audit('GAME_STARTED', { metadata: { teams: teams.length } });
    this.emit('GAME_STARTED', { game: state }, ALL);
  }

  pauseGame(): void {
    const current = this.repo.getGameState();
    if (current.phase === 'paused') return;
    this.repo.saveGameState({ resumePhase: current.phase });
    const state = this.setPhase('paused');
    this.audit('GAME_PAUSED', { metadata: { from: current.phase } });
    this.emit('GAME_PAUSED', { game: state }, ALL);
  }

  resumeGame(): void {
    const current = this.repo.getGameState();
    if (current.phase !== 'paused') return;
    const target = current.resumePhase ?? 'lobby';
    this.repo.saveGameState({ resumePhase: null });
    const state = this.setPhase(target);
    this.audit('GAME_RESUMED', { metadata: { to: target } });
    this.emit('GAME_RESUMED', { game: state }, ALL);
  }

  completeGame(): void {
    this.stopTimer();
    this.repo.saveGameState({ completedAt: this.now() });
    const state = this.setPhase('complete');
    this.audit('GAME_COMPLETE', {});
    this.emit('GAME_COMPLETE', { game: state, leaderboard: this.leaderboard() }, ALL);
  }

  resetGame(keepTeams: boolean): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.repo.resetGameData();
    if (keepTeams) {
      this.repo.resetTeamCapital(this.config.startingCapital, this.config.protectedReserve);
      for (const team of this.repo.listTeams()) {
        this.repo.insertTransaction({
          teamId: team.id,
          amount: this.config.startingCapital,
          balanceAfter: this.config.startingCapital,
          type: 'initial',
          reason: 'Starting capital (reset)',
        });
      }
    } else {
      this.repo.deleteAllTeams();
    }
    this.previousRanks.clear();
    this.audit('GAME_RESET', { metadata: { keepTeams } });
    this.emit('GAME_RESET', {}, ALL);
    this.broadcastTeams();
    this.refreshLeaderboard();
    this.broadcastLiveEvents();
  }

  /* --- timers ------------------------------------------------------ */

  startTimer(seconds: number, label: string): void {
    const endsAt = this.now() + seconds * 1000;
    this.repo.saveGameState({ timer: { endsAt, duration: seconds, label } });
    this.scheduleGlobalTimer(endsAt, label);
    this.emit('TIMER_STARTED', { endsAt, duration: seconds, label }, ALL);
  }

  stopTimer(): void {
    this.clearTimer('global');
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
    this.emit('TIMER_STOPPED', {}, ALL);
  }

  private scheduleGlobalTimer(endsAt: number, label: string): void {
    this.clearTimer('global');
    const delay = Math.max(0, endsAt - this.now());
    this.setTimer('global', delay, () => {
      this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
      this.emit('TIMER_EXPIRED', { label }, ALL);
      const state = this.repo.getGameState();
      if (state.currentChallengeId) {
        const challenge = this.repo.getChallenge(state.currentChallengeId);
        if (challenge && !isPremiumType(challenge.marketType)) this.closeChallenge(challenge.id);
      }
    });
  }

  private setTimer(key: string, delayMs: number, fn: () => void): void {
    this.clearTimer(key);
    const handle = setTimeout(() => {
      this.timers.delete(key);
      try {
        fn();
      } catch (error) {
        this.audit('TIMER_ERROR', { metadata: { key, error: String(error) } });
      }
    }, delayMs);
    if (typeof handle.unref === 'function') handle.unref();
    this.timers.set(key, handle);
  }

  private clearTimer(key: string): void {
    const handle = this.timers.get(key);
    if (handle) {
      clearTimeout(handle);
      this.timers.delete(key);
    }
  }

  /** Test/simulation hook: fire a pending timer immediately. */
  fireTimer(key: string): boolean {
    const handle = this.timers.get(key);
    if (!handle) return false;
    clearTimeout(handle);
    this.timers.delete(key);
    // Re-invoke by resolving what the key means.
    if (key === 'global') {
      const state = this.repo.getGameState();
      this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
      this.emit('TIMER_EXPIRED', { label: state.timer.label ?? 'TIMER' }, ALL);
      if (state.currentChallengeId) {
        const challenge = this.repo.getChallenge(state.currentChallengeId);
        if (challenge && !isPremiumType(challenge.marketType)) this.closeChallenge(challenge.id);
      }
      return true;
    }
    if (key.startsWith('deadline:')) {
      const [, teamId, challengeId] = key.split(':');
      if (teamId && challengeId) this.expireTeamChallenge(teamId, challengeId);
      return true;
    }
    if (key.startsWith('reclaim:')) {
      const challengeId = key.slice('reclaim:'.length);
      this.expireReclaim(challengeId);
      return true;
    }
    if (key.startsWith('premium:')) {
      const challengeId = key.slice('premium:'.length);
      this.expirePremiumAttempt(challengeId);
      return true;
    }
    return false;
  }

  /* --- challenges -------------------------------------------------- */

  listChallenges(): Challenge[] {
    return this.repo.listChallenges();
  }

  challengeSummaries(): ChallengeSummary[] {
    return this.repo.listChallenges().map((challenge) => {
      const counts = this.repo.countAttemptsForChallenge(challenge.id);
      return {
        id: challenge.id,
        index: challenge.index,
        title: challenge.title,
        category: challenge.category,
        type: challenge.type,
        difficulty: challenge.difficulty,
        marketType: challenge.marketType,
        timeLimit: challenge.timeLimit,
        accessKey: challenge.accessKey,
        state: (this.repo.getChallengeState(challenge.id) ?? 'pending') as ChallengeSummary['state'],
        attempts: counts.attempts,
        correct: counts.correct,
      };
    });
  }

  /** Strip the answer. `revealed` decides whether the body travels at all. */
  publicChallenge(challenge: Challenge, revealed: boolean, capital: number): ChallengePublic {
    const base: ChallengePublic = {
      id: challenge.id,
      index: challenge.index,
      title: challenge.title,
      category: challenge.category,
      type: challenge.type,
      difficulty: challenge.difficulty,
      marketType: challenge.marketType,
      timeLimit: challenge.timeLimit,
      revealed,
      question: revealed ? challenge.question : { prompt: '' },
    };
    if (!isPremiumType(challenge.marketType)) {
      base.reward = calcReward(this.config, challenge, capital);
      base.penalty = calcPenalty(this.config, challenge, capital);
    }
    return base;
  }

  openChallenge(challengeId: string): void {
    const challenge = this.requireChallenge(challengeId);
    const previous = this.repo.getGameState().currentChallengeId;
    if (previous && previous !== challengeId) this.closeChallenge(previous, true);

    this.repo.setChallengeState(challengeId, 'active');
    this.repo.saveGameState({ currentChallengeId: challengeId, currentAuctionId: null });

    if (isPremiumType(challenge.marketType)) {
      const state = this.repo.getPremiumState(challengeId) ?? emptyPremiumState(challengeId);
      this.repo.savePremiumState(state);
      this.setPhase(challenge.marketType === 'final_premium' ? 'final' : 'auction');
    } else {
      this.setPhase('market');
    }

    this.audit('CHALLENGE_OPENED', {
      challengeId,
      metadata: { index: challenge.index, marketType: challenge.marketType },
    });

    // Preview only - the question body is revealed after the risk decision.
    this.emit(
      'CHALLENGE_OPENED',
      { challenge: this.publicChallenge(challenge, false, this.config.startingCapital), game: this.gameState() },
      ALL,
    );
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  closeChallenge(challengeId: string, silent = false): void {
    const challenge = this.repo.getChallenge(challengeId);
    if (!challenge) return;

    // Anyone still mid-attempt is resolved as a timeout so no capital is left
    // in limbo (spec section 22 / 33).
    for (const p of this.repo.listParticipationForChallenge(challengeId)) {
      if (p.state === 'in_progress') this.expireTeamChallenge(p.teamId, challengeId);
    }

    this.repo.setChallengeState(challengeId, 'complete');
    this.clearTimer('global');
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });

    if (!silent) {
      this.audit('CHALLENGE_CLOSED', { challengeId });
      this.emit('CHALLENGE_CLOSED', { challengeId }, ALL);
      this.setPhase('result');
    }
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  /** Participant enters the printed access key (spec section 10). */
  unlockChallenge(teamId: string, challengeId: string, accessKey: string): void {
    const team = this.requireTeam(teamId);
    const challenge = this.requireChallenge(challengeId);
    this.requireCurrent(challengeId);

    if (isPremiumType(challenge.marketType)) {
      const premium = this.repo.getPremiumState(challengeId);
      const authorised = premium?.activeTeamId === teamId;
      if (!authorised) throw new EngineError('not_authorised', 'This premium is locked for your team');
    }

    const hash = this.repo.getAccessKeyHash(challengeId);
    if (!hash || !verifyAccessKey(accessKey, hash, this.secret)) {
      this.audit('ACCESS_KEY_REJECTED', { teamId, challengeId });
      throw new EngineError('bad_key', 'Incorrect challenge key');
    }

    if (this.repo.hasAttempt(teamId, challengeId)) {
      throw new EngineError('already_attempted', 'Your team already attempted this challenge');
    }

    this.repo.setParticipation(teamId, challengeId, 'available', { unlocked: true });
    this.audit('CHALLENGE_UNLOCKED', { teamId, challengeId });
    this.sendTeamView(team.id);
  }

  /** The risk decision: JOIN starts the clock and reveals the question. */
  joinChallenge(teamId: string, challengeId: string): void {
    const team = this.requireTeam(teamId);
    const challenge = this.requireChallenge(challengeId);
    this.requireCurrent(challengeId);
    this.requireNotPaused();

    if (this.repo.hasAttempt(teamId, challengeId)) {
      throw new EngineError('already_attempted', 'Your team already attempted this challenge');
    }

    const participation = this.repo.getParticipation(teamId, challengeId);
    if (isPremiumType(challenge.marketType)) {
      const premium = this.repo.getPremiumState(challengeId);
      if (premium?.activeTeamId !== teamId) {
        throw new EngineError('not_authorised', 'This premium is locked for your team');
      }
    } else {
      if (this.config.requireAccessKeyForMarket && participation?.state !== 'available') {
        throw new EngineError('locked', 'Enter the challenge key first');
      }
    }
    if (participation?.state === 'in_progress') return; // idempotent re-join

    const joinedAt = this.now();
    this.repo.setParticipation(teamId, challengeId, 'in_progress', { joined: true });
    this.scheduleTeamDeadline(teamId, challenge, joinedAt);

    this.audit('CHALLENGE_JOINED', { teamId, challengeId });
    this.emit(
      'CHALLENGE_OPENED',
      { challenge: this.publicChallenge(challenge, true, team.capital), game: this.gameState() },
      { kind: 'team', teamId },
    );
    this.sendTeamView(teamId);
    this.broadcastLiveEvents();
  }

  skipChallenge(teamId: string, challengeId: string): void {
    this.requireTeam(teamId);
    const challenge = this.requireChallenge(challengeId);
    this.requireCurrent(challengeId);
    if (isPremiumType(challenge.marketType)) {
      throw new EngineError('invalid', 'Premium challenges cannot be skipped');
    }
    if (this.repo.hasAttempt(teamId, challengeId)) return;

    this.repo.setParticipation(teamId, challengeId, 'skipped');
    this.repo.insertAttempt({
      teamId,
      challengeId,
      attemptNumber: 1,
      result: 'skipped',
      scoreChange: 0,
    });
    this.audit('CHALLENGE_SKIPPED', { teamId, challengeId });
    this.sendTeamView(teamId);
    this.broadcastLiveEvents();
  }

  private scheduleTeamDeadline(teamId: string, challenge: Challenge, joinedAt: number): void {
    const deadline = joinedAt + challenge.timeLimit * 1000 + this.config.submissionGraceMs;
    this.setTimer(`deadline:${teamId}:${challenge.id}`, Math.max(0, deadline - this.now()), () => {
      this.expireTeamChallenge(teamId, challenge.id);
    });
  }

  private expireTeamChallenge(teamId: string, challengeId: string): void {
    const participation = this.repo.getParticipation(teamId, challengeId);
    if (!participation || participation.state !== 'in_progress') return;
    if (this.repo.hasAttempt(teamId, challengeId)) return;
    const challenge = this.repo.getChallenge(challengeId);
    if (!challenge) return;

    if (isPremiumType(challenge.marketType)) {
      this.resolvePremiumAttempt(challengeId, 'timeout', 'Time expired');
      return;
    }
    this.finishMarketAttempt(teamId, challenge, 'timeout', { correct: false, detail: 'Time expired' });
  }

  /* --- submissions -------------------------------------------------- */

  async submitAnswer(
    teamId: string,
    challengeId: string,
    submission: SubmissionValue,
  ): Promise<{ result: string; delta: number; detail?: string }> {
    const team = this.requireTeam(teamId);
    const challenge = this.requireChallenge(challengeId);
    this.requireCurrent(challengeId);
    this.requireNotPaused();

    if (this.repo.hasAttempt(teamId, challengeId)) {
      throw new EngineError('duplicate_submission', 'Your team already submitted this challenge');
    }

    const participation = this.repo.getParticipation(teamId, challengeId);
    if (!participation || participation.state !== 'in_progress') {
      throw new EngineError('not_in_progress', 'You are not currently attempting this challenge');
    }

    const premium = isPremiumType(challenge.marketType);
    if (premium) {
      const state = this.repo.getPremiumState(challengeId);
      if (state?.activeTeamId !== teamId) {
        throw new EngineError('not_authorised', 'Your team is not the authorised attempter');
      }
    }

    const joinedAt = participation.joinedAt ?? this.now();
    const elapsed = this.now() - joinedAt;
    const overtime = elapsed > challenge.timeLimit * 1000 + this.config.submissionGraceMs;

    this.repo.setParticipation(teamId, challengeId, 'submitted', { submitted: true });
    this.emit('CHALLENGE_SUBMITTED', { teamId, challengeId, at: this.now() }, STAGE);
    this.broadcastLiveEvents();

    const outcome = overtime
      ? { correct: false, detail: 'Submitted after the deadline' }
      : await this.evaluate(challenge, submission);

    const resolution = overtime ? 'timeout' : outcome.correct ? 'correct' : 'wrong';

    if (premium) {
      const applied = this.resolvePremiumAttempt(challengeId, resolution, outcome.detail, submission);
      return { result: resolution, delta: applied, detail: outcome.detail };
    }

    const delta = this.finishMarketAttempt(teamId, challenge, resolution, outcome, {
      elapsed,
      submission,
    });
    void team;
    return { result: resolution, delta, detail: outcome.detail };
  }

  private async evaluate(
    challenge: Challenge,
    submission: SubmissionValue,
  ): Promise<{ correct: boolean; detail?: string }> {
    if (challenge.type === 'code') {
      if (!this.config.codeExecutionEnabled || !this.runner) {
        return { correct: false, detail: 'Code execution is disabled on this server' };
      }
      if (submission.kind !== 'code') return { correct: false, detail: 'Malformed code submission' };
      const outcome = await this.runner.run({
        language: submission.language,
        source: submission.source,
        testCases: challenge.evaluation.testCases ?? [],
        timeoutMs: this.config.codeExecutionTimeoutMs,
      });
      return { correct: outcome.correct, detail: outcome.detail ?? '' };
    }
    const outcome = evaluateAnswer(challenge.type, challenge.evaluation, submission);
    return { correct: outcome.correct, detail: outcome.detail ?? '' };
  }

  private finishMarketAttempt(
    teamId: string,
    challenge: Challenge,
    resolution: 'correct' | 'wrong' | 'timeout',
    outcome: { correct: boolean; detail?: string },
    extra: { elapsed?: number; submission?: SubmissionValue } = {},
  ): number {
    const team = this.requireTeam(teamId);
    this.clearTimer(`deadline:${teamId}:${challenge.id}`);

    const settlement = resolveMarket(
      this.config,
      challenge,
      team.capital,
      resolution,
      extra.elapsed ?? 0,
    );

    this.repo.insertAttempt({
      teamId,
      challengeId: challenge.id,
      attemptNumber: 1,
      result: resolution,
      scoreChange: settlement.delta,
      durationMs: extra.elapsed ?? null,
      detail: outcome.detail ?? null,
      submission: extra.submission,
    });
    this.repo.setParticipation(teamId, challenge.id, 'resolved');

    this.applyCapital(
      team,
      settlement.delta,
      resolution === 'correct' ? 'market_reward' : 'market_penalty',
      `Market ${challenge.id} ${resolution}`,
      challenge.id,
    );

    this.audit('CHALLENGE_RESULT', {
      teamId,
      challengeId: challenge.id,
      metadata: { result: resolution, delta: settlement.delta, detail: outcome.detail },
    });

    this.emitResult(team, challenge, resolution, settlement.delta, null, outcome.detail);
    this.broadcastLiveEvents();
    return settlement.delta;
  }

  private emitResult(
    team: Team,
    challenge: Challenge,
    resolution: 'correct' | 'wrong' | 'timeout',
    delta: number,
    riskAmount: number | null,
    detail?: string,
  ): void {
    const fresh = this.repo.getTeam(team.id) as Team;
    const payload = {
      teamId: team.id,
      teamName: team.name,
      challengeId: challenge.id,
      challengeIndex: challenge.index,
      result: resolution,
      delta,
      newCapital: fresh.capital,
      isPremium: isPremiumType(challenge.marketType),
      riskAmount,
      at: this.now(),
    };
    this.emit('CHALLENGE_RESULT', payload, STAGE);
    this.emit('CHALLENGE_RESULT', payload, team_(team.id));
    void detail;
    this.sendTeamView(team.id);
  }

  /* --- capital ------------------------------------------------------ */

  private applyCapital(
    team: Team,
    delta: number,
    type: Parameters<Repo['insertTransaction']>[0]['type'],
    reason: string,
    challengeId: string | null,
  ): void {
    if (delta === 0) {
      this.repo.insertTransaction({
        teamId: team.id,
        amount: 0,
        balanceAfter: team.capital,
        type,
        reason,
        challengeId,
      });
      return;
    }
    const from = team.capital;
    const to = Math.max(this.config.capitalFloor, from + delta);
    this.repo.setTeamCapital(team.id, to);
    this.repo.insertTransaction({
      teamId: team.id,
      amount: to - from,
      balanceAfter: to,
      type,
      reason,
      challengeId,
    });
    this.emit(
      'CAPITAL_CHANGED',
      { teamId: team.id, from, to, delta: to - from, reason, at: this.now() },
      ALL,
    );
    this.audit('CAPITAL_CHANGED', {
      teamId: team.id,
      challengeId,
      metadata: { from, to, delta: to - from, reason },
    });
    this.broadcastTeams();
    this.refreshLeaderboard();
    this.sendTeamView(team.id);
  }

  /* --- auctions ------------------------------------------------------ */

  startAuction(challengeId: string, startingBid?: number, increment?: number): AuctionView {
    const challenge = this.requireChallenge(challengeId);
    if (!isPremiumType(challenge.marketType)) {
      throw new EngineError('not_premium', 'Only premium challenges are auctioned');
    }
    const existing = this.repo.getAuctionForChallenge(challengeId);
    if (existing && (existing.status === 'open' || existing.status === 'going_once' || existing.status === 'going_twice')) {
      return this.auctionView(existing.id) as AuctionView;
    }
    if (existing && existing.status === 'closed') {
      throw new EngineError('auction_done', 'This premium has already been auctioned');
    }

    const isFinal = challenge.marketType === 'final_premium';
    const auction = this.repo.createAuction(
      challengeId,
      startingBid ?? (isFinal ? this.config.finalPremiumStartingBid : this.config.premiumStartingBid),
      increment ?? (isFinal ? this.config.finalPremiumBidIncrement : this.config.premiumBidIncrement),
    );

    const premium = emptyPremiumState(challengeId);
    premium.stage = 'auction';
    premium.auctionId = auction.id;
    this.repo.savePremiumState(premium);

    this.repo.saveGameState({ currentChallengeId: challengeId, currentAuctionId: auction.id });
    this.setPhase(isFinal ? 'final' : 'auction');
    this.setProjectorMode('auto');

    this.audit('AUCTION_STARTED', {
      challengeId,
      metadata: { auctionId: auction.id, startingBid: auction.startingBid, increment: auction.increment },
    });

    const view = this.auctionView(auction.id) as AuctionView;
    this.emit('AUCTION_STARTED', { auction: view }, ALL);
    this.broadcastAllTeamViews();
    return view;
  }

  placeBid(teamId: string, amount?: number): { accepted: boolean; message?: string } {
    const state = this.repo.getGameState();
    if (!state.currentAuctionId) throw new EngineError('no_auction', 'No auction is running');
    const auction = this.repo.getAuction(state.currentAuctionId);
    if (!auction) throw new EngineError('no_auction', 'No auction is running');
    const team = this.requireTeam(teamId);

    const open = auction.status === 'open' || auction.status === 'going_once' || auction.status === 'going_twice';
    const bidAmount = amount ?? nextBidAmount(auction.currentBid, auction.startingBid, auction.increment);

    const validation = validateBid({
      amount: bidAmount,
      teamCapital: team.capital,
      protectedReserve: team.protectedReserve,
      currentBid: auction.currentBid,
      startingBid: auction.startingBid,
      increment: auction.increment,
      auctionOpen: open,
      isCurrentLeader: auction.currentLeaderTeamId === teamId,
      teamActive: team.status === 'active',
      enforceIncrement: amount === undefined,
    });

    const sequence = this.repo.nextBidSequence(auction.id);

    if (!validation.valid) {
      this.repo.insertBid({
        auctionId: auction.id,
        teamId,
        amount: bidAmount,
        sequenceNumber: sequence,
        valid: false,
        rejectedReason: validation.reason ?? 'invalid',
      });
      this.audit('AUCTION_BID_REJECTED', {
        teamId,
        challengeId: auction.challengeId,
        metadata: { amount: bidAmount, reason: validation.reason, maxBid: validation.teamMaxBid },
      });
      const payload = {
        teamId,
        amount: bidAmount,
        reason: validation.reason ?? 'invalid',
        message: validation.message ?? 'Bid rejected',
      };
      this.emit('AUCTION_BID_REJECTED', payload, ORGANIZER);
      this.emit('AUCTION_BID_REJECTED', payload, team_(teamId));
      return { accepted: false, message: validation.message ?? 'Bid rejected' };
    }

    const previousLeader = auction.currentLeaderTeamId;
    const bid = this.repo.insertBid({
      auctionId: auction.id,
      teamId,
      amount: bidAmount,
      sequenceNumber: sequence,
      valid: true,
    });
    this.repo.updateAuction(auction.id, {
      currentBid: bidAmount,
      currentLeaderTeamId: teamId,
      status: 'open', // any new bid re-opens a "going once/twice" call
    });

    this.audit('AUCTION_BID', {
      teamId,
      challengeId: auction.challengeId,
      metadata: { amount: bidAmount, sequence },
    });

    const view = this.auctionView(auction.id) as AuctionView;
    this.emit('AUCTION_BID', { auction: view, bid, outbidTeamId: previousLeader }, ALL);
    this.broadcastAllTeamViews();
    return { accepted: true };
  }

  /** Operator mis-click safety: remove the most recent accepted bid. */
  undoBid(): void {
    const state = this.repo.getGameState();
    if (!state.currentAuctionId) throw new EngineError('no_auction', 'No auction is running');
    const auction = this.repo.getAuction(state.currentAuctionId);
    if (!auction) throw new EngineError('no_auction', 'No auction is running');
    if (auction.status === 'closed') throw new EngineError('auction_closed', 'Auction already closed');

    const last = this.repo.lastValidBid(auction.id);
    if (!last) throw new EngineError('no_bids', 'There is nothing to undo');

    this.repo.deleteBid(last.id);
    const previous = this.repo.lastValidBid(auction.id);
    this.repo.updateAuction(auction.id, {
      currentBid: previous?.amount ?? null,
      currentLeaderTeamId: previous?.teamId ?? null,
      status: 'open',
    });
    this.audit('AUCTION_BID_UNDONE', {
      teamId: last.teamId,
      challengeId: auction.challengeId,
      metadata: { amount: last.amount },
    });
    const view = this.auctionView(auction.id) as AuctionView;
    this.emit('AUCTION_BID_UNDONE', { auction: view, removedBidId: last.id }, ALL);
    this.broadcastAllTeamViews();
  }

  callAuction(call: 'once' | 'twice' | 'reopen'): void {
    const state = this.repo.getGameState();
    if (!state.currentAuctionId) throw new EngineError('no_auction', 'No auction is running');
    const auction = this.repo.getAuction(state.currentAuctionId);
    if (!auction || auction.status === 'closed') {
      throw new EngineError('auction_closed', 'Auction is not open');
    }
    const status: AuctionStatus =
      call === 'once' ? 'going_once' : call === 'twice' ? 'going_twice' : 'open';
    this.repo.updateAuction(auction.id, { status });
    this.audit('AUCTION_CALL', { challengeId: auction.challengeId, metadata: { call } });
    this.emit('AUCTION_CALL', { status, amount: auction.currentBid }, ALL);
  }

  closeAuction(): AuctionView {
    const state = this.repo.getGameState();
    if (!state.currentAuctionId) throw new EngineError('no_auction', 'No auction is running');
    const auction = this.repo.getAuction(state.currentAuctionId);
    if (!auction) throw new EngineError('no_auction', 'No auction is running');
    if (auction.status === 'closed') return this.auctionView(auction.id) as AuctionView;

    const bids = this.repo.listBids(auction.id);
    const winner = auction.currentLeaderTeamId;
    const amount = auction.currentBid;

    this.repo.updateAuction(auction.id, {
      status: 'closed',
      winnerTeamId: winner,
      winningAmount: amount,
      endedAt: this.now(),
    });

    const premium = this.repo.getPremiumState(auction.challengeId) ?? emptyPremiumState(auction.challengeId);
    premium.auctionId = auction.id;
    premium.ladder = buildLadder(bids, winner);

    const view = this.auctionView(auction.id) as AuctionView;

    if (!winner || amount === null) {
      premium.stage = 'closed';
      premium.outcome = 'unsold';
      premium.ladder = closeLadder(premium.ladder);
      this.repo.savePremiumState(premium);
      this.audit('AUCTION_CLOSED', { challengeId: auction.challengeId, metadata: { sold: false } });
      this.emit('AUCTION_CLOSED', { auction: view }, ALL);
      this.emit('PREMIUM_CLOSED', { premium }, ALL);
      this.setPhase('result');
      this.broadcastAllTeamViews();
      return view;
    }

    premium.stage = 'sold';
    premium.activeTeamId = winner;
    premium.activeRisk = amount;
    this.repo.savePremiumState(premium);

    const winnerTeam = this.requireTeam(winner);
    this.audit('AUCTION_WON', {
      teamId: winner,
      challengeId: auction.challengeId,
      metadata: { amount, bidders: premium.ladder.length },
    });

    this.emit('AUCTION_CLOSED', { auction: view }, ALL);
    this.emit(
      'AUCTION_WON',
      { teamId: winner, teamName: winnerTeam.name, amount, challengeId: auction.challengeId },
      ALL,
    );
    this.emit('PREMIUM_UNLOCKED', { premium, teamId: winner, risk: amount }, ALL);
    this.emit(
      'CHALLENGE_UNLOCKED',
      { challengeId: auction.challengeId, teamId: winner, risk: amount },
      team_(winner),
    );
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
    return view;
  }

  cancelAuction(): void {
    const state = this.repo.getGameState();
    if (!state.currentAuctionId) throw new EngineError('no_auction', 'No auction is running');
    const auction = this.repo.getAuction(state.currentAuctionId);
    if (!auction) return;
    this.repo.updateAuction(auction.id, { status: 'cancelled', endedAt: this.now() });
    this.repo.saveGameState({ currentAuctionId: null });
    const premium = this.repo.getPremiumState(auction.challengeId);
    if (premium) {
      premium.stage = 'idle';
      premium.auctionId = null;
      premium.ladder = [];
      this.repo.savePremiumState(premium);
    }
    this.audit('AUCTION_CANCELLED', { challengeId: auction.challengeId });
    this.emit('AUCTION_CANCELLED', { auctionId: auction.id }, ALL);
    this.broadcastAllTeamViews();
  }

  auctionView(auctionId: number): AuctionView | null {
    const auction = this.repo.getAuction(auctionId);
    if (!auction) return null;
    const challenge = this.repo.getChallenge(auction.challengeId);
    if (!challenge) return null;
    const bids = this.repo.listBids(auction.id);
    const premium = this.repo.getPremiumState(auction.challengeId);
    const ladder: LadderEntry[] =
      premium && premium.ladder.length > 0
        ? premium.ladder
        : buildLadder(bids, auction.currentLeaderTeamId);

    const teams = new Map(this.repo.listTeams().map((t) => [t.id, t]));
    const bidders = ladder.map((entry) => ({
      teamId: entry.teamId,
      teamName: teams.get(entry.teamId)?.name ?? entry.teamId,
      amount: entry.amount,
      isLeader: entry.teamId === auction.currentLeaderTeamId,
    }));

    return {
      auction,
      challenge: {
        id: challenge.id,
        index: challenge.index,
        title: challenge.title,
        category: challenge.category,
        marketType: challenge.marketType,
      },
      bidders,
      history: bids,
      nextBid: nextBidAmount(auction.currentBid, auction.startingBid, auction.increment),
      ladder,
    };
  }

  currentAuctionView(): AuctionView | null {
    const state = this.repo.getGameState();
    return state.currentAuctionId ? this.auctionView(state.currentAuctionId) : null;
  }

  /* --- premium lifecycle -------------------------------------------- */

  currentPremium(): PremiumState | null {
    const state = this.repo.getGameState();
    if (!state.currentChallengeId) return null;
    const challenge = this.repo.getChallenge(state.currentChallengeId);
    if (!challenge || !isPremiumType(challenge.marketType)) return null;
    return this.repo.getPremiumState(state.currentChallengeId);
  }

  startPremiumAttempt(): void {
    const state = this.repo.getGameState();
    const challengeId = state.currentChallengeId;
    if (!challengeId) throw new EngineError('no_challenge', 'No challenge is open');
    const challenge = this.requireChallenge(challengeId);
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium) throw new EngineError('no_premium', 'No premium state');
    if (!premium.activeTeamId || premium.activeRisk === null) {
      throw new EngineError('no_winner', 'No authorised team for this premium');
    }
    if (!canStartAnotherAttempt(premium)) {
      throw new EngineError('max_attempts', 'This premium has used both attempts');
    }

    const attemptNumber = (premium.attemptNumber + 1) as 1 | 2;
    premium.attemptNumber = attemptNumber;
    premium.stage = attemptNumber === 1 ? 'attempt_1' : 'attempt_2';
    premium.offerTeamId = null;
    premium.offerRisk = null;
    premium.offerDeadline = null;
    this.repo.savePremiumState(premium);

    const teamId = premium.activeTeamId;
    const risk = premium.activeRisk;
    this.repo.setParticipation(teamId, challengeId, 'in_progress', { unlocked: true, joined: true });
    this.setPhase('premium_attempt');
    this.setProjectorMode('auto');

    const deadline = this.now() + challenge.timeLimit * 1000 + this.config.submissionGraceMs;
    this.setTimer(`premium:${challengeId}`, Math.max(0, deadline - this.now()), () => {
      this.expirePremiumAttempt(challengeId);
    });
    this.repo.saveGameState({
      timer: {
        endsAt: this.now() + challenge.timeLimit * 1000,
        duration: challenge.timeLimit,
        label: `PREMIUM #${String(challenge.index).padStart(2, '0')}`,
      },
    });

    this.audit('PREMIUM_ATTEMPT_STARTED', {
      teamId,
      challengeId,
      metadata: { attemptNumber, risk },
    });
    this.emit('PREMIUM_ATTEMPT_STARTED', { premium, teamId, attemptNumber, risk }, ALL);
    this.emit(
      'CHALLENGE_OPENED',
      {
        challenge: this.publicChallenge(challenge, true, this.requireTeam(teamId).capital),
        game: this.gameState(),
      },
      team_(teamId),
    );
    this.emit(
      'TIMER_STARTED',
      {
        endsAt: this.now() + challenge.timeLimit * 1000,
        duration: challenge.timeLimit,
        label: `PREMIUM #${String(challenge.index).padStart(2, '0')}`,
      },
      ALL,
    );
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  private expirePremiumAttempt(challengeId: string): void {
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium || (premium.stage !== 'attempt_1' && premium.stage !== 'attempt_2')) return;
    if (!premium.activeTeamId) return;
    if (this.repo.hasAttempt(premium.activeTeamId, challengeId)) return;
    this.resolvePremiumAttempt(challengeId, 'timeout', 'Time expired');
  }

  /** Operator override for a premium result (spec section 31). */
  forcePremiumResult(result: 'correct' | 'wrong' | 'timeout'): number {
    const state = this.repo.getGameState();
    if (!state.currentChallengeId) throw new EngineError('no_challenge', 'No challenge is open');
    return this.resolvePremiumAttempt(state.currentChallengeId, result, 'Recorded by operator');
  }

  private resolvePremiumAttempt(
    challengeId: string,
    resolution: 'correct' | 'wrong' | 'timeout',
    detail?: string,
    submission?: SubmissionValue,
  ): number {
    const challenge = this.requireChallenge(challengeId);
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium || !premium.activeTeamId || premium.activeRisk === null) {
      throw new EngineError('no_active_attempt', 'No premium attempt in progress');
    }
    const teamId = premium.activeTeamId;
    const risk = premium.activeRisk;
    const team = this.requireTeam(teamId);

    this.clearTimer(`premium:${challengeId}`);
    this.clearTimer('global');
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });

    const settlement = resolvePremium(this.config, team.capital, risk, resolution);

    this.repo.insertAttempt({
      teamId,
      challengeId,
      attemptNumber: premium.attemptNumber || 1,
      result: resolution,
      scoreChange: settlement.delta,
      riskAmount: risk,
      detail: detail ?? null,
      submission,
    });
    this.repo.setParticipation(teamId, challengeId, 'resolved');

    this.applyCapital(
      team,
      settlement.delta,
      resolution === 'correct' ? 'premium_reward' : 'premium_penalty',
      `Premium ${challengeId} ${resolution} (risk ${risk})`,
      challengeId,
    );

    this.audit('PREMIUM_RESULT', {
      teamId,
      challengeId,
      metadata: { result: resolution, risk, delta: settlement.delta, attempt: premium.attemptNumber },
    });

    this.emitResult(team, challenge, resolution, settlement.delta, risk, detail);

    if (resolution === 'correct') {
      premium.stage = 'closed';
      premium.outcome = premium.attemptNumber === 1 ? 'won_first' : 'won_reclaim';
      premium.ladder = closeLadder(premium.ladder);
      premium.activeTeamId = null;
      premium.activeRisk = null;
      this.repo.savePremiumState(premium);
      this.emit('PREMIUM_CLOSED', { premium }, ALL);
      this.setPhase('result');
      this.broadcastAllTeamViews();
      this.broadcastLiveEvents();
      return settlement.delta;
    }

    // Failed attempt.
    premium.ladder =
      premium.attemptNumber === 1
        ? applyLadderTransition(premium.ladder, { kind: 'winner_failed' })
        : applyLadderTransition(premium.ladder, { kind: 'attempt_failed', teamId });
    premium.failedTeamId = teamId;
    premium.activeTeamId = null;
    premium.activeRisk = null;
    this.repo.savePremiumState(premium);

    this.emit('PREMIUM_ATTEMPT_FAILED', { premium, teamId, result: resolution }, ALL);

    if (!canStartAnotherAttempt(premium)) {
      this.closePremium('lost');
      return settlement.delta;
    }

    const next = nextCandidate(premium.ladder);
    if (!next) {
      this.closePremium('no_takers');
      return settlement.delta;
    }

    this.offerReclaim(next.teamId);
    return settlement.delta;
  }

  /** Offer the same question to the next original bidder at their own bid. */
  offerReclaim(teamId?: string): void {
    const state = this.repo.getGameState();
    const challengeId = state.currentChallengeId;
    if (!challengeId) throw new EngineError('no_challenge', 'No challenge is open');
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium) throw new EngineError('no_premium', 'No premium state');
    if (!canStartAnotherAttempt(premium)) {
      throw new EngineError('max_attempts', 'This premium has used both attempts');
    }

    const candidate = teamId
      ? premium.ladder.find((e) => e.teamId === teamId && e.state === 'pending')
      : nextCandidate(premium.ladder);
    if (!candidate) {
      this.closePremium('no_takers');
      return;
    }

    const deadline = this.now() + this.config.reclaimDecisionWindow * 1000;
    premium.stage = 'reclaim_offer';
    premium.ladder = applyLadderTransition(premium.ladder, {
      kind: 'offer',
      teamId: candidate.teamId,
    });
    premium.offerTeamId = candidate.teamId;
    premium.offerRisk = candidate.amount;
    premium.offerDeadline = deadline;
    this.repo.savePremiumState(premium);

    this.setPhase('premium_reclaim');
    this.scheduleReclaimExpiry(challengeId, deadline);

    this.audit('PREMIUM_RECLAIM_OFFERED', {
      teamId: candidate.teamId,
      challengeId,
      metadata: { risk: candidate.amount, deadline },
    });
    this.emit(
      'PREMIUM_RECLAIM_OFFERED',
      {
        premium,
        teamId: candidate.teamId,
        risk: candidate.amount,
        deadline,
        failedTeamId: premium.failedTeamId,
      },
      ALL,
    );
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  private scheduleReclaimExpiry(challengeId: string, deadline: number): void {
    if (!this.config.reclaimAutoDecline) return;
    this.setTimer(`reclaim:${challengeId}`, Math.max(0, deadline - this.now()), () => {
      this.expireReclaim(challengeId);
    });
  }

  private expireReclaim(challengeId: string): void {
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium || premium.stage !== 'reclaim_offer' || !premium.offerTeamId) return;
    this.resolveReclaim(premium.offerTeamId, false, true);
  }

  resolveReclaim(teamId: string, accept: boolean, expired = false): void {
    const state = this.repo.getGameState();
    const challengeId = state.currentChallengeId;
    if (!challengeId) throw new EngineError('no_challenge', 'No challenge is open');
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium || premium.stage !== 'reclaim_offer') {
      throw new EngineError('no_offer', 'There is no reclaim offer open');
    }
    if (premium.offerTeamId !== teamId) {
      throw new EngineError('not_your_offer', 'This reclaim offer is not addressed to your team');
    }

    this.clearTimer(`reclaim:${challengeId}`);
    const risk = premium.offerRisk ?? 0;

    if (accept) {
      premium.ladder = applyLadderTransition(premium.ladder, { kind: 'accept', teamId });
      premium.activeTeamId = teamId;
      premium.activeRisk = risk;
      premium.offerTeamId = null;
      premium.offerRisk = null;
      premium.offerDeadline = null;
      premium.stage = 'sold';
      this.repo.savePremiumState(premium);

      this.audit('PREMIUM_RECLAIM_ACCEPTED', { teamId, challengeId, metadata: { risk } });
      this.emit('PREMIUM_RECLAIM_ACCEPTED', { premium, teamId, risk }, ALL);
      this.emit('CHALLENGE_UNLOCKED', { challengeId, teamId, risk }, team_(teamId));
      this.broadcastAllTeamViews();
      this.broadcastLiveEvents();
      // The operator starts the attempt so the projector can hold the moment.
      return;
    }

    premium.ladder = applyLadderTransition(premium.ladder, {
      kind: expired ? 'expire' : 'decline',
      teamId,
    });
    premium.offerTeamId = null;
    premium.offerRisk = null;
    premium.offerDeadline = null;
    this.repo.savePremiumState(premium);

    const next = nextCandidate(premium.ladder);
    this.audit('PREMIUM_RECLAIM_DECLINED', {
      teamId,
      challengeId,
      metadata: { expired, next: next?.teamId ?? null },
    });
    this.emit(
      'PREMIUM_RECLAIM_DECLINED',
      { premium, teamId, expired, nextTeamId: next?.teamId ?? null },
      ALL,
    );

    if (next) {
      this.offerReclaim(next.teamId);
    } else {
      this.closePremium('no_takers');
    }
  }

  closePremium(outcome: PremiumState['outcome'] = null): void {
    const state = this.repo.getGameState();
    const challengeId = state.currentChallengeId;
    if (!challengeId) return;
    const premium = this.repo.getPremiumState(challengeId);
    if (!premium) return;

    this.clearTimer(`reclaim:${challengeId}`);
    this.clearTimer(`premium:${challengeId}`);

    premium.stage = 'closed';
    premium.ladder = closeLadder(premium.ladder);
    premium.offerTeamId = null;
    premium.offerRisk = null;
    premium.offerDeadline = null;
    premium.activeTeamId = null;
    premium.activeRisk = null;
    if (outcome) premium.outcome = outcome;
    this.repo.savePremiumState(premium);

    this.repo.setChallengeState(challengeId, 'complete');
    this.audit('PREMIUM_CLOSED', { challengeId, metadata: { outcome: premium.outcome } });
    this.emit('PREMIUM_CLOSED', { premium }, ALL);
    this.setPhase('result');
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  /* --- leaderboard --------------------------------------------------- */

  leaderboard(): LeaderboardRow[] {
    return this.leaderboardCache;
  }

  private refreshLeaderboard(broadcast = true): void {
    const teams = this.repo.listTeams();
    const rows = computeLeaderboard(teams, {
      qualifiers: this.config.qualifiers,
      previousRanks: this.previousRanks,
    });
    const changed = rows
      .filter((row) => {
        const before = this.leaderboardCache.find((r) => r.teamId === row.teamId);
        return !before || before.capital !== row.capital || before.rank !== row.rank;
      })
      .map((row) => row.teamId);

    this.previousRanks = rankMap(this.leaderboardCache);
    this.leaderboardCache = rows;

    if (broadcast) this.emit('LEADERBOARD_UPDATED', { rows, changed }, ALL);
  }

  /* --- team views ---------------------------------------------------- */

  teamStats(teamId: string): TeamStats {
    const attempts = this.repo.listAttemptsForTeam(teamId);
    const challenges = new Map(this.repo.listChallenges().map((c) => [c.id, c]));
    const stats: TeamStats = {
      marketAttempted: 0,
      marketCorrect: 0,
      marketWrong: 0,
      marketSkipped: 0,
      premiumWins: 0,
      premiumAttempts: 0,
      premiumCorrect: 0,
      premiumWrong: 0,
      totalEarned: 0,
      totalLost: 0,
    };
    for (const attempt of attempts) {
      const challenge = challenges.get(attempt.challengeId);
      const premium = challenge ? isPremiumType(challenge.marketType) : false;
      if (attempt.scoreChange > 0) stats.totalEarned += attempt.scoreChange;
      if (attempt.scoreChange < 0) stats.totalLost += Math.abs(attempt.scoreChange);
      if (premium) {
        stats.premiumAttempts += 1;
        if (attempt.result === 'correct') stats.premiumCorrect += 1;
        else stats.premiumWrong += 1;
      } else {
        if (attempt.result === 'skipped') {
          stats.marketSkipped += 1;
          continue;
        }
        stats.marketAttempted += 1;
        if (attempt.result === 'correct') stats.marketCorrect += 1;
        else stats.marketWrong += 1;
      }
    }
    for (const auction of this.repo.listAuctions()) {
      if (auction.winnerTeamId === teamId) stats.premiumWins += 1;
    }
    return stats;
  }

  teamView(teamId: string): TeamView | null {
    const team = this.repo.getTeam(teamId);
    if (!team) return null;
    const rows = this.leaderboardCache;
    const row = rows.find((r) => r.teamId === teamId);
    const state = this.repo.getGameState();
    const challengeId = state.currentChallengeId;
    const challenge = challengeId ? this.repo.getChallenge(challengeId) : null;
    const premium = challenge && isPremiumType(challenge.marketType)
      ? this.repo.getPremiumState(challenge.id)
      : null;

    let challengeState: TeamView['challengeState'] = 'idle';
    if (challenge) {
      const participation = challengeId ? this.repo.getParticipation(teamId, challengeId) : null;
      if (isPremiumType(challenge.marketType)) {
        challengeState =
          premium?.activeTeamId === teamId
            ? participation?.state === 'submitted'
              ? 'submitted'
              : premium.stage === 'attempt_1' || premium.stage === 'attempt_2'
                ? 'in_progress'
                : 'available'
            : participation?.state === 'resolved'
              ? 'resolved'
              : 'locked';
      } else {
        challengeState = participation?.state ?? 'locked';
      }
    }

    const attempts = this.repo.listAttemptsForTeam(teamId);
    const last = attempts[attempts.length - 1];
    const lastChallenge = last ? this.repo.getChallenge(last.challengeId) : null;

    const auction = state.currentAuctionId ? this.repo.getAuction(state.currentAuctionId) : null;
    const myBids = auction ? this.repo.listBids(auction.id).filter((b) => b.teamId === teamId) : [];
    const myHighest = myBids.length > 0 ? Math.max(...myBids.map((b) => b.amount)) : null;

    const view: TeamView = {
      teamId,
      capital: team.capital,
      maxBid: maxBid(team.capital, team.protectedReserve),
      rank: row?.rank ?? 0,
      totalTeams: rows.length,
      qualified: row?.qualified ?? false,
      challengeState,
      premiumUnlocked: premium?.activeTeamId === teamId,
      premiumRisk: premium?.activeTeamId === teamId ? premium.activeRisk : null,
      lastResult: last
        ? {
            challengeId: last.challengeId,
            result: last.result,
            delta: last.scoreChange,
            detail: last.detail ?? undefined,
            explanation:
              this.config.revealExplanations && lastChallenge
                ? lastChallenge.evaluation.explanation
                : undefined,
            at: last.timestamp,
          }
        : null,
      reclaimOffer:
        premium?.offerTeamId === teamId && premium.offerDeadline
          ? {
              challengeId: premium.challengeId,
              risk: premium.offerRisk ?? 0,
              deadline: premium.offerDeadline,
            }
          : null,
      inAuction: myBids.some((b) => b.valid),
      myHighestBid: myHighest,
      stats: this.teamStats(teamId),
    };
    return view;
  }

  private sendTeamView(teamId: string): void {
    const view = this.teamView(teamId);
    if (view) this.emit('ME_UPDATED', { me: view }, team_(teamId));
  }

  private broadcastAllTeamViews(): void {
    for (const t of this.repo.listTeams()) this.sendTeamView(t.id);
  }

  publicTeams(): TeamPublic[] {
    return this.repo.listTeams().map((t) => ({
      id: t.id,
      name: t.name,
      capital: t.capital,
      startingCapital: t.startingCapital,
      status: t.status,
      connectionStatus: t.connectionStatus,
      maxBid: maxBid(t.capital, t.protectedReserve),
    }));
  }

  private broadcastTeams(): void {
    this.emit('TEAMS_REPLACED', { teams: this.publicTeams() }, ALL);
  }

  /* --- live operator queue -------------------------------------------- */

  liveEvents(): LiveEvent[] {
    const state = this.repo.getGameState();
    const events: LiveEvent[] = [];
    const teams = new Map(this.repo.listTeams().map((t) => [t.id, t]));
    const challengeId = state.currentChallengeId;

    if (challengeId) {
      const challenge = this.repo.getChallenge(challengeId);
      const label = challenge
        ? `${isPremiumType(challenge.marketType) ? 'Premium' : 'Market'} #${String(challenge.index).padStart(2, '0')}`
        : challengeId;

      for (const p of this.repo.listParticipationForChallenge(challengeId)) {
        const t = teams.get(p.teamId);
        if (!t) continue;
        if (p.state === 'in_progress') {
          events.push({
            id: `${p.teamId}:${challengeId}:attempting`,
            teamId: p.teamId,
            teamName: t.name,
            challengeId,
            label,
            kind: 'attempting',
            since: p.joinedAt ?? this.now(),
            needsAttention: false,
          });
        } else if (p.state === 'submitted') {
          events.push({
            id: `${p.teamId}:${challengeId}:submitted`,
            teamId: p.teamId,
            teamName: t.name,
            challengeId,
            label,
            kind: 'submitted',
            since: this.now(),
            needsAttention: true,
          });
        }
      }

      const premium = this.repo.getPremiumState(challengeId);
      if (premium?.offerTeamId) {
        const t = teams.get(premium.offerTeamId);
        if (t) {
          events.push({
            id: `${premium.offerTeamId}:${challengeId}:reclaim`,
            teamId: premium.offerTeamId,
            teamName: t.name,
            challengeId,
            label: `${label} RECLAIM`,
            kind: 'reclaim_offer',
            since: this.now(),
            needsAttention: true,
          });
        }
      }
    }

    // Before the round starts every team is legitimately offline, so a
    // disconnect only demands attention once play is under way - otherwise the
    // operator's queue is full of noise during setup.
    const live = state.startedAt !== null && state.phase !== 'lobby' && state.phase !== 'complete';
    for (const t of teams.values()) {
      if (t.connectionStatus === 'offline' && t.status === 'active') {
        events.push({
          id: `${t.id}:offline`,
          teamId: t.id,
          teamName: t.name,
          challengeId: challengeId ?? '',
          label: 'Disconnected',
          kind: 'disconnected',
          since: t.lastSeenAt ?? this.now(),
          needsAttention: live,
        });
      }
    }

    return events.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.since - b.since);
  }

  private broadcastLiveEvents(): void {
    this.emit('LIVE_EVENTS', { events: this.liveEvents() }, ORGANIZER);
  }

  /* --- snapshots ------------------------------------------------------ */

  snapshot(role: 'participant' | 'organizer' | 'projector', teamId: string | null, seq: number): Snapshot {
    const state = this.gameState();
    const challenge = state.currentChallengeId ? this.repo.getChallenge(state.currentChallengeId) : null;
    const premium = challenge && isPremiumType(challenge.marketType)
      ? this.repo.getPremiumState(challenge.id)
      : null;

    let publicChallenge: ChallengePublic | null = null;
    if (challenge) {
      let revealed = false;
      let capital = this.config.startingCapital;
      if (role === 'participant' && teamId) {
        const t = this.repo.getTeam(teamId);
        capital = t?.capital ?? capital;
        const participation = this.repo.getParticipation(teamId, challenge.id);
        if (isPremiumType(challenge.marketType)) {
          revealed =
            premium?.activeTeamId === teamId &&
            (premium.stage === 'attempt_1' || premium.stage === 'attempt_2');
        } else {
          revealed = participation?.state === 'in_progress';
        }
      } else if (role === 'organizer') {
        revealed = true;
      }
      publicChallenge = this.publicChallenge(challenge, revealed, capital);
    }

    const snapshot: Snapshot = {
      role,
      config: this.config,
      game: state,
      teams: this.publicTeams(),
      leaderboard: this.leaderboardCache,
      auction: this.currentAuctionView(),
      premium,
      challenge: publicChallenge,
      me: role === 'participant' && teamId ? this.teamView(teamId) : null,
      seq,
      serverNow: this.now(),
    };

    if (role === 'organizer') {
      snapshot.liveEvents = this.liveEvents();
      snapshot.challengeIndex = this.challengeSummaries();
    }
    return snapshot;
  }

  /* --- audit ----------------------------------------------------------- */

  audit(
    action: string,
    entry: { teamId?: string | null; challengeId?: string | null; metadata?: Record<string, unknown> },
  ): void {
    const written = this.repo.appendAudit({ action, ...entry });
    this.emit('AUDIT_APPENDED', { entries: [written] }, ORGANIZER);
  }

  listAudit(limit?: number) {
    return this.repo.listAudit(limit);
  }

  listAttempts(): Attempt[] {
    return this.repo.listAttempts();
  }

  getRepo(): Repo {
    return this.repo;
  }

  getAuth(): AuthService {
    return this.auth;
  }

  /* --- guards ----------------------------------------------------------- */

  private requireTeam(teamId: string): Team {
    const team = this.repo.getTeam(teamId);
    if (!team) throw new EngineError('unknown_team', `Unknown team ${teamId}`);
    return team;
  }

  private requireChallenge(challengeId: string): Challenge {
    const challenge = this.repo.getChallenge(challengeId);
    if (!challenge) throw new EngineError('unknown_challenge', `Unknown challenge ${challengeId}`);
    return challenge;
  }

  private requireCurrent(challengeId: string): void {
    const state = this.repo.getGameState();
    if (state.currentChallengeId !== challengeId) {
      throw new EngineError('not_current', 'That challenge is not currently open');
    }
  }

  private requireNotPaused(): void {
    if (this.repo.getGameState().phase === 'paused') {
      throw new EngineError('paused', 'The round is paused');
    }
  }
}

/** Local alias to avoid shadowing the `team` variable name inside methods. */
function team_(teamId: string): Audience {
  return team(teamId);
}

export { DEFAULT_CONFIG };
