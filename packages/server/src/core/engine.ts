/**
 * The authoritative game engine (spec sections 3, 19).
 *
 * Every meaningful action follows exactly one path:
 *
 *    CLIENT ACTION -> SERVER VALIDATION -> DATABASE UPDATE
 *                  -> REAL-TIME BROADCAST -> UI UPDATE
 *
 * The round is a generated sequence of slots:
 *
 *    3 random normal questions -> PREMIUM -> ... -> STRATEGY PHASE -> repeat
 *
 * The engine owns the whole state machine:
 *
 *    idle -> question_intro -> question_active -> question_result
 *         -> premium_intro -> auction_active -> premium_authorized
 *         -> premium_solving -> premium_result -> reclaim
 *         -> strategy_phase -> ... -> final_results -> completed
 *
 * Clients never decide capital, bid validity, ranking or phase.
 */

import {
  DEFAULT_CONFIG,
  applyConfigPatch,
  applyLadderTransition,
  buildLadder,
  canStartAnotherAttempt,
  closeLadder,
  computeLeaderboard,
  computePodium,
  emptyPremiumState,
  evaluateAnswer,
  finalStretchSlotIndices,
  finalPremiumIndex,
  generateSequence,
  maxBid,
  mulberry32,
  nextBidAmount,
  nextCandidate,
  normalSlots,
  padTeamNumber,
  premiumSlots,
  questionReward as calcReward,
  rankMap,
  redactForFinalStretch,
  resolveAdjustment,
  timeLimitFor,
  validateBid,
} from '@code-market/shared';
import type {
  Attempt,
  AuctionStatus,
  AuctionView,
  GameConfig,
  GamePhase,
  GameState,
  LadderEntry,
  LeaderboardRow,
  LiveEvent,
  PodiumEntry,
  PremiumPreview,
  PremiumState,
  ProjectorMode,
  Question,
  QuestionPublic,
  SequenceEntry,
  SequenceSlot,
  ServerPayloads,
  Snapshot,
  SubmissionValue,
  Team,
  TeamDossier,
  TeamPublic,
  TeamStats,
  TeamView,
} from '@code-market/shared';
import type { Repo } from '../repo/index.js';
import type { AuthService } from '../auth.js';
import { generateJoinCode, hashAccessKey, verifyAccessKey } from '../auth.js';
import type { CodeRunner } from './codeRunner.js';
import { QUESTION_POOL } from '../content/pool.js';

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
const toTeam = (teamId: string): Audience => ({ kind: 'team', teamId });

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
  /**
   * Seed for team join codes. Omitted, codes are cryptographically random.
   * Supplied, the same seed produces the same codes, so two machines preparing
   * the same event print the same cards.
   */
  teamCodeSeed?: number;
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
  /** Non-null only when the operator asked for reproducible join codes. */
  private readonly teamCodeRand: (() => number) | null;

  private config: GameConfig;
  private previousRanks = new Map<string, number>();
  private leaderboardCache: LeaderboardRow[] = [];
  private disposed = false;

  readonly now: () => number;

  constructor(deps: EngineDeps) {
    this.repo = deps.repo;
    this.auth = deps.auth;
    this.secret = deps.secret;
    this.teamCodeRand = deps.teamCodeSeed === undefined ? null : mulberry32(deps.teamCodeSeed);
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

  getRepo(): Repo {
    return this.repo;
  }

  getAuth(): AuthService {
    return this.auth;
  }

  /* --- bootstrap --------------------------------------------------- */

  /** Load the question pool into SQLite (idempotent). */
  seedQuestions(pool: Question[] = QUESTION_POOL): void {
    for (const question of pool) {
      // Solve time always follows difficulty unless the author overrode it.
      const timed: Question = {
        ...question,
        timeLimit: question.timeLimit || timeLimitFor(this.config, question.difficulty),
      };
      this.repo.upsertQuestion(timed, hashAccessKey(question.accessKey, this.secret));
    }
  }

  /** Recreate timers after a restart so an in-flight round keeps running. */
  restoreTimers(): void {
    const state = this.repo.getGameState();
    if (state.timer.endsAt && state.timer.endsAt > this.now()) {
      if (state.phase === 'question_active' && state.timer.label === 'TAKE OR SIT OUT') {
        // The decision window auto-skips non-deciders; it must not close the
        // question the way the generic global timer does.
        this.setTimer(
          `question_decision:${state.slotIndex}`,
          Math.max(0, state.timer.endsAt - this.now()),
          () => this.closeQuestionDecision(state.slotIndex),
        );
      } else {
        this.scheduleGlobalTimer(state.timer.endsAt, state.timer.label ?? 'TIMER', state.phase);
      }
    }
    for (const premium of this.repo.listPremiumStates()) {
      if (premium.stage === 'reclaim_offer' && premium.offerDeadline) {
        this.scheduleReclaimExpiry(premium.questionId, premium.offerDeadline);
      }
    }
    const slot = this.currentSlot();
    if (slot && slot.kind === 'normal') {
      const question = this.repo.getQuestion(slot.questionId);
      if (question) {
        for (const p of this.repo.listParticipationForSlot(slot.index)) {
          if (p.state === 'in_progress' && p.joinedAt) {
            this.scheduleTeamDeadline(p.teamId, slot.index, question, p.joinedAt);
          }
        }
      }
    }
  }

  /* --- sequence ------------------------------------------------------ */

  /**
   * Draw the round: three random normal questions before every premium
   * (spec sections 1, 22). The seed is persisted, so the sequence survives a
   * restart untouched.
   */
  generateRound(seed?: number): SequenceSlot[] {
    const existing = this.repo.listSequence();
    if (existing.length > 0 && seed === undefined) return existing;

    const chosenSeed = seed ?? Math.floor(Math.random() * 2_147_483_647);
    const pool = this.repo.listQuestions();
    const slots = generateSequence({
      pool: pool.map((q) => ({ id: q.id, kind: q.kind, difficulty: q.difficulty })),
      config: this.config,
      seed: chosenSeed,
    });

    this.repo.saveSequence(slots);
    this.repo.setMeta('sequence_seed', String(chosenSeed));
    this.audit('SEQUENCE_GENERATED', {
      metadata: {
        seed: chosenSeed,
        slots: slots.length,
        blocks: this.config.blocks,
        questionsPerBlock: this.config.questionsPerBlock,
      },
    });
    this.emit(
      'SEQUENCE_GENERATED',
      { totalSlots: slots.length, blocks: this.config.blocks, seed: chosenSeed },
      ORGANIZER,
    );
    return slots;
  }

  sequence(): SequenceSlot[] {
    return this.repo.listSequence();
  }

  /** Sequence enriched with the public facts the organizer needs. */
  sequenceEntries(): SequenceEntry[] {
    const slots = this.repo.listSequence();
    const blackout = finalStretchSlotIndices(slots, this.config.hideLeaderboardLastQuestions);
    const finalPremium = finalPremiumIndex(slots);
    const questions = new Map(this.repo.listQuestions().map((q) => [q.id, q]));

    return slots.map((slot) => {
      const question = questions.get(slot.questionId);
      return {
        ...slot,
        title: question?.title ?? slot.questionId,
        domain: question?.domain ?? 'logic',
        difficulty: question?.difficulty ?? 'medium',
        timeLimit: question?.timeLimit ?? 90,
        isFinalPremium: slot.index === finalPremium,
        inFinalStretch: blackout.has(slot.index),
      };
    });
  }

  currentSlot(): SequenceSlot | null {
    const state = this.repo.getGameState();
    return state.slotIndex > 0 ? this.repo.getSlot(state.slotIndex) : null;
  }

  currentQuestion(): Question | null {
    const slot = this.currentSlot();
    return slot ? this.repo.getQuestion(slot.questionId) : null;
  }

  /** Is the leaderboard blacked out right now (spec sections 11, 18)? */
  isFinalStretch(): boolean {
    const state = this.repo.getGameState();
    if (state.phase === 'final_results' || state.phase === 'completed') return false;
    const slots = this.repo.listSequence();
    const blackout = finalStretchSlotIndices(slots, this.config.hideLeaderboardLastQuestions);
    if (blackout.size === 0) return false;
    const firstBlackout = Math.min(...blackout);
    return state.slotIndex >= firstBlackout;
  }

  /* --- game state ---------------------------------------------------- */

  gameState(): GameState {
    const { projectorMode: _mode, ...rest } = this.repo.getGameState();
    void _mode;
    const slots = this.repo.listSequence();
    const slot = rest.slotIndex > 0 ? slots.find((s) => s.index === rest.slotIndex) : undefined;
    return {
      ...rest,
      blockNumber: slot?.blockNumber ?? 0,
      totalBlocks: this.config.blocks,
      totalSlots: slots.length,
      finalStretch: this.isFinalStretch(),
      serverNow: this.now(),
    };
  }

  private setPhase(phase: GamePhase, extra: Partial<GameState> = {}): GameState {
    this.repo.saveGameState({ phase, ...extra });
    const state = this.gameState();
    this.emit('PHASE_CHANGED', { game: state }, ALL);
    return state;
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
    this.generateRound();
    this.repo.saveGameState({ startedAt: this.now(), completedAt: null, slotIndex: 0 });
    const state = this.setPhase('idle');
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
    const target = current.resumePhase ?? 'idle';
    this.repo.saveGameState({ resumePhase: null });
    const state = this.setPhase(target);
    this.audit('GAME_RESUMED', { metadata: { to: target } });
    this.emit('GAME_RESUMED', { game: state }, ALL);
  }

  /** Close the round and compute the podium (spec section 2). */
  completeGame(): PodiumEntry[] {
    this.stopTimer();
    this.repo.saveGameState({ completedAt: this.now() });
    this.refreshLeaderboard(false);
    const podium = computePodium(this.leaderboardCache, this.config.podiumPlaces);
    this.repo.saveFinalResults(podium);

    const state = this.setPhase('final_results');
    this.audit('GAME_COMPLETE', { metadata: { podium: podium.map((p) => p.teamId) } });
    this.emit(
      'GAME_COMPLETE',
      { game: state, podium, leaderboard: this.leaderboardCache },
      ALL,
    );
    this.emit('LEADERBOARD_UPDATED', { rows: this.leaderboardCache, changed: [] }, ALL);
    return podium;
  }

  /** The dramatic reveal, driven by the operator. */
  revealPodium(): PodiumEntry[] {
    const podium = this.podium();
    this.setProjectorMode('podium');
    this.setPhase('completed');
    this.emit('PODIUM_REVEALED', { podium, leaderboard: this.leaderboardCache }, ALL);
    return podium;
  }

  podium(): PodiumEntry[] {
    const stored = this.repo.listFinalResults();
    if (stored.length > 0) return stored;
    return computePodium(this.leaderboardCache, this.config.podiumPlaces);
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

  /* --- advancing through the sequence ---------------------------------- */

  /**
   * Move to the next slot. This is the single entry point the operator uses to
   * drive the round forward; the engine decides whether that means a question
   * intro or a premium intro.
   */
  advance(): GameState {
    const state = this.repo.getGameState();
    const slots = this.repo.listSequence();
    if (slots.length === 0) throw new EngineError('no_sequence', 'Start the round first');

    const nextIndex = state.slotIndex + 1;
    const slot = slots.find((s) => s.index === nextIndex);
    if (!slot) {
      // Round is over.
      this.completeGame();
      return this.gameState();
    }
    return this.openSlot(nextIndex);
  }

  /** Open a specific slot (also used by the operator to jump). */
  openSlot(slotIndex: number): GameState {
    const slot = this.repo.getSlot(slotIndex);
    if (!slot) throw new EngineError('unknown_slot', `No slot ${slotIndex}`);

    // Anything left running in the previous slot is settled first.
    const previous = this.repo.getGameState().slotIndex;
    if (previous > 0 && previous !== slotIndex) this.closeSlot(previous, true);

    const question = this.repo.getQuestion(slot.questionId);
    if (!question) throw new EngineError('unknown_question', `No question ${slot.questionId}`);

    this.repo.setSlotState(slotIndex, 'active');
    this.repo.saveGameState({
      slotIndex,
      currentQuestionId: slot.questionId,
      currentAuctionId: null,
    });

    const wasFinalStretch = this.repo.getMeta('final_stretch_announced') === '1';
    const nowFinalStretch = this.isFinalStretch();
    if (nowFinalStretch && !wasFinalStretch) {
      this.repo.setMeta('final_stretch_announced', '1');
      const remaining = normalSlots(this.repo.listSequence()).filter(
        (s) => s.index >= slotIndex,
      ).length;
      this.audit('FINAL_STRETCH_STARTED', { metadata: { remaining } });
      this.emit('FINAL_STRETCH_STARTED', { remainingQuestions: remaining }, ALL);
      this.emit('LEADERBOARD_HIDDEN', { remainingQuestions: remaining }, ALL);
    }

    if (slot.kind === 'premium') {
      return this.enterPremiumIntro(slot, question);
    }
    return this.enterQuestionIntro(slot, question);
  }

  /* --- normal question flow ------------------------------------------- */

  /**
   * The intro card: domain, difficulty and time, held briefly so the room can
   * read it (spec section 4). The question body is NOT sent yet.
   */
  private enterQuestionIntro(slot: SequenceSlot, question: Question): GameState {
    const state = this.setPhase('question_intro');
    this.audit('QUESTION_INTRO', {
      questionId: question.id,
      slotIndex: slot.index,
      metadata: { domain: question.domain, difficulty: question.difficulty },
    });
    this.emit(
      'QUESTION_INTRO',
      { question: this.publicQuestion(question, slot, false, this.config.startingCapital), game: state },
      ALL,
    );
    this.setProjectorMode('auto');

    if (this.config.questionIntroSeconds > 0) {
      const endsAt = this.now() + this.config.questionIntroSeconds * 1000;
      this.repo.saveGameState({
        timer: { endsAt, duration: this.config.questionIntroSeconds, label: 'GET READY' },
      });
      this.emit(
        'TIMER_STARTED',
        { endsAt, duration: this.config.questionIntroSeconds, label: 'GET READY' },
        ALL,
      );
      this.setTimer('intro', this.config.questionIntroSeconds * 1000, () => this.openQuestion());
    }
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
    return state;
  }

  /** Open the question for answering. */
  openQuestion(): GameState {
    const slot = this.currentSlot();
    if (!slot || slot.kind !== 'normal') {
      throw new EngineError('not_a_question', 'No normal question is queued');
    }
    const question = this.repo.getQuestion(slot.questionId) as Question;
    this.clearTimer('intro');

    // A synchronised TAKE / SIT-OUT window (spec 6, 7), the same as premiums:
    // every team has the same countdown to decide whether to take the question.
    // A team that never chooses defaults to sitting out when it lapses. Each
    // team's own solve clock still starts when it takes the question.
    const decideSeconds = Math.max(1, this.config.takeDecisionSeconds);
    const decideEndsAt = this.now() + decideSeconds * 1000;
    this.repo.saveGameState({
      timer: { endsAt: decideEndsAt, duration: decideSeconds, label: 'TAKE OR SIT OUT' },
    });

    const state = this.setPhase('question_active');
    this.setTimer(`question_decision:${slot.index}`, decideSeconds * 1000, () =>
      this.closeQuestionDecision(slot.index),
    );
    this.audit('QUESTION_OPENED', { questionId: question.id, slotIndex: slot.index });
    this.emit(
      'QUESTION_OPENED',
      { question: this.publicQuestion(question, slot, false, this.config.startingCapital), game: state },
      ALL,
    );
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
    return state;
  }

  /**
   * The TAKE / SIT-OUT window for a normal question has lapsed. Every active
   * team that did not take it (or explicitly sit out) is defaulted to sitting
   * out (spec 7), which also locks it out of joining late. Teams that took the
   * question keep solving on their own clocks.
   */
  private closeQuestionDecision(slotIndex: number): void {
    const slot = this.repo.getSlot(slotIndex);
    if (!slot || slot.kind !== 'normal') return;
    const state = this.repo.getGameState();
    if (state.phase !== 'question_active' || state.slotIndex !== slotIndex) return;

    // Retire the decision countdown; solving teams have their own clocks.
    if (state.timer.label === 'TAKE OR SIT OUT') {
      this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
    }

    const engagedStates = ['in_progress', 'submitted', 'resolved', 'skipped'];
    for (const team of this.repo.listTeams()) {
      if (team.status !== 'active') continue;
      if (this.repo.hasAttempt(team.id, slotIndex)) continue;
      const participation = this.repo.getParticipation(team.id, slotIndex);
      if (participation && engagedStates.includes(participation.state)) continue;
      this.repo.setParticipation(team.id, slotIndex, slot.questionId, 'skipped');
      this.repo.insertAttempt({
        teamId: team.id,
        questionId: slot.questionId,
        slotIndex,
        attemptNumber: 1,
        result: 'skipped',
        scoreChange: 0,
      });
      this.audit('QUESTION_SIT_OUT_DEFAULT', {
        teamId: team.id,
        questionId: slot.questionId,
        slotIndex,
      });
    }
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  closeQuestion(): GameState {
    const slot = this.currentSlot();
    if (!slot) return this.gameState();
    this.closeSlot(slot.index, false);
    return this.setPhase('question_result');
  }

  /** Settle everyone still mid-attempt and mark the slot complete. */
  private closeSlot(slotIndex: number, silent: boolean): void {
    const slot = this.repo.getSlot(slotIndex);
    if (!slot) return;

    for (const p of this.repo.listParticipationForSlot(slotIndex)) {
      if (p.state === 'in_progress') void this.expireTeamQuestion(p.teamId, slotIndex);
    }

    this.repo.setSlotState(slotIndex, 'complete');
    this.clearTimer('global');
    this.clearTimer('intro');
    this.clearTimer(`question_decision:${slotIndex}`);
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });

    if (!silent) {
      this.audit('QUESTION_CLOSED', { questionId: slot.questionId, slotIndex });
      this.emit('QUESTION_CLOSED', { questionId: slot.questionId }, ALL);
    }
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  /** Participant enters the printed access key. */
  unlockQuestion(teamId: string, questionId: string, accessKey: string): void {
    this.requireTeam(teamId);
    const slot = this.requireCurrentSlot(questionId);
    const question = this.repo.getQuestion(questionId) as Question;

    if (slot.kind === 'premium') {
      const premium = this.repo.getPremiumState(questionId);
      if (premium?.activeTeamId !== teamId) {
        throw new EngineError('not_authorised', 'This premium is locked for your team');
      }
    }

    const hash = this.repo.getAccessKeyHash(questionId);
    if (!hash || !verifyAccessKey(accessKey, hash, this.secret)) {
      this.audit('ACCESS_KEY_REJECTED', { teamId, questionId, slotIndex: slot.index });
      throw new EngineError('bad_key', 'Incorrect question key');
    }
    if (this.repo.hasAttempt(teamId, slot.index)) {
      throw new EngineError('already_attempted', 'Your team already attempted this question');
    }

    this.repo.setParticipation(teamId, slot.index, questionId, 'available', { unlocked: true });
    this.audit('QUESTION_UNLOCKED', { teamId, questionId, slotIndex: slot.index });
    void question;
    this.sendTeamView(teamId);
    this.broadcastLiveEvents();
  }

  /** The risk decision: JOIN starts the clock and reveals the question. */
  joinQuestion(teamId: string, questionId: string): void {
    const team = this.requireTeam(teamId);
    const slot = this.requireCurrentSlot(questionId);
    const question = this.repo.getQuestion(questionId) as Question;
    this.requireNotPaused();

    if (this.repo.hasAttempt(teamId, slot.index)) {
      throw new EngineError('already_attempted', 'Your team already attempted this question');
    }

    const participation = this.repo.getParticipation(teamId, slot.index);
    if (slot.kind === 'premium') {
      const premium = this.repo.getPremiumState(questionId);
      if (premium?.activeTeamId !== teamId) {
        throw new EngineError('not_authorised', 'This premium is locked for your team');
      }
    } else {
      const phase = this.repo.getGameState().phase;
      if (phase !== 'question_active') {
        throw new EngineError('not_open', 'The question is not open yet');
      }
      if (this.config.requireAccessKey && participation?.state !== 'available') {
        throw new EngineError('locked', 'Enter the question key first');
      }
      // Taking the question stakes its difficulty value up front, so a team must
      // hold at least that stake to take it (it is deducted on join, below).
      const stake = calcReward(this.config, question, team.capital);
      if (stake > 0 && team.capital < stake) {
        throw new EngineError(
          'insufficient_capital',
          `You need at least ${stake} to take this question — taking it stakes ${stake}.`,
        );
      }
    }
    if (participation?.state === 'in_progress') return; // idempotent re-join

    const joinedAt = this.now();
    this.repo.setParticipation(teamId, slot.index, questionId, 'in_progress', { joined: true });
    this.scheduleTeamDeadline(teamId, slot.index, question, joinedAt);

    // Deduct the stake the moment the team commits (spec: money comes out of the
    // wallet immediately on take; a correct answer pays it back multiplied).
    if (slot.kind === 'normal') {
      const stake = calcReward(this.config, question, team.capital);
      if (stake > 0) {
        this.applyCapital(team, -stake, 'question_stake', `${questionId} stake`, questionId, slot.index);
      }
    }

    this.audit('QUESTION_JOINED', { teamId, questionId, slotIndex: slot.index });
    this.emit(
      'QUESTION_OPENED',
      { question: this.publicQuestion(question, slot, true, team.capital), game: this.gameState() },
      toTeam(teamId),
    );
    this.sendTeamView(teamId);
    this.broadcastLiveEvents();
  }

  skipQuestion(teamId: string, questionId: string): void {
    this.requireTeam(teamId);
    const slot = this.requireCurrentSlot(questionId);
    if (slot.kind === 'premium') {
      throw new EngineError('invalid', 'Premium questions cannot be skipped');
    }
    if (this.repo.hasAttempt(teamId, slot.index)) return;

    this.repo.setParticipation(teamId, slot.index, questionId, 'skipped');
    this.repo.insertAttempt({
      teamId,
      questionId,
      slotIndex: slot.index,
      attemptNumber: 1,
      result: 'skipped',
      scoreChange: 0,
    });
    this.audit('QUESTION_SKIPPED', { teamId, questionId, slotIndex: slot.index });
    this.sendTeamView(teamId);
    this.broadcastLiveEvents();
  }

  private scheduleTeamDeadline(
    teamId: string,
    slotIndex: number,
    question: Question,
    joinedAt: number,
  ): void {
    const deadline = joinedAt + question.timeLimit * 1000 + this.config.submissionGraceMs;
    this.setTimer(`deadline:${teamId}:${slotIndex}`, Math.max(0, deadline - this.now()), () => {
      void this.expireTeamQuestion(teamId, slotIndex);
    });
  }

  /**
   * A team's own clock ran out. If it had SELECTED an answer (staged it), that
   * answer is auto-submitted and evaluated for real - not thrown away as a blank
   * timeout (spec section 1). With nothing staged, the existing unanswered
   * behaviour applies. The server owns the deadline either way, so a frozen or
   * disconnected laptop is still settled correctly.
   */
  private async expireTeamQuestion(teamId: string, slotIndex: number): Promise<void> {
    const participation = this.repo.getParticipation(teamId, slotIndex);
    if (!participation || participation.state !== 'in_progress') return;
    if (this.repo.hasAttempt(teamId, slotIndex)) return;
    const slot = this.repo.getSlot(slotIndex);
    if (!slot) return;
    const question = this.repo.getQuestion(slot.questionId);
    if (!question) return;

    const staged = participation.stagedSubmission;

    if (slot.kind === 'premium') {
      if (staged) {
        const outcome = await this.evaluate(question, staged);
        if (this.repo.hasAttempt(teamId, slotIndex)) return; // a manual submit won the race
        this.resolvePremiumAttempt(
          slot.questionId,
          outcome.correct ? 'correct' : 'wrong',
          outcome.detail,
          staged,
        );
        return;
      }
      this.resolvePremiumAttempt(slot.questionId, 'timeout', 'Time expired');
      return;
    }

    if (staged) {
      const outcome = await this.evaluate(question, staged);
      if (this.repo.hasAttempt(teamId, slotIndex)) return; // a manual submit won the race
      this.finishQuestionAttempt(
        teamId,
        slot,
        question,
        outcome.correct ? 'correct' : 'wrong',
        outcome,
        { submission: staged },
      );
      return;
    }
    this.finishQuestionAttempt(teamId, slot, question, 'timeout', {
      correct: false,
      detail: 'Time expired',
    });
  }

  /* --- submissions ------------------------------------------------------ */

  /**
   * Record the answer a team has SELECTED but not yet submitted (spec section 1).
   * Held server-side so it survives a reconnect and can be auto-submitted if the
   * team's clock runs out. Purely private intent - nothing is evaluated, scored
   * or broadcast here.
   */
  stageAnswer(teamId: string, questionId: string, submission: SubmissionValue): void {
    this.requireTeam(teamId);
    const slot = this.requireCurrentSlot(questionId);
    if (this.repo.hasAttempt(teamId, slot.index)) return;

    const participation = this.repo.getParticipation(teamId, slot.index);
    if (!participation || participation.state !== 'in_progress') return;
    if (slot.kind === 'premium') {
      const premium = this.repo.getPremiumState(questionId);
      if (premium?.activeTeamId !== teamId) return;
    }
    this.repo.setStagedSubmission(teamId, slot.index, submission ?? null);
  }

  async submitAnswer(
    teamId: string,
    questionId: string,
    submission: SubmissionValue,
  ): Promise<{ result: string; delta: number; detail?: string }> {
    const team = this.requireTeam(teamId);
    const slot = this.requireCurrentSlot(questionId);
    const question = this.repo.getQuestion(questionId) as Question;
    this.requireNotPaused();

    if (this.repo.hasAttempt(teamId, slot.index)) {
      throw new EngineError('duplicate_submission', 'Your team already submitted this question');
    }

    const participation = this.repo.getParticipation(teamId, slot.index);
    if (!participation || participation.state !== 'in_progress') {
      throw new EngineError('not_in_progress', 'You are not currently attempting this question');
    }

    const isPremium = slot.kind === 'premium';
    if (isPremium) {
      const state = this.repo.getPremiumState(questionId);
      if (state?.activeTeamId !== teamId) {
        throw new EngineError('not_authorised', 'Your team is not the authorised attempter');
      }
    }

    const joinedAt = participation.joinedAt ?? this.now();
    const elapsed = this.now() - joinedAt;
    const overtime = elapsed > question.timeLimit * 1000 + this.config.submissionGraceMs;

    this.repo.setParticipation(teamId, slot.index, questionId, 'submitted', { submitted: true });
    this.emit('QUESTION_SUBMITTED', { teamId, questionId, at: this.now() }, STAGE);
    this.broadcastLiveEvents();

    const outcome = overtime
      ? { correct: false, detail: 'Submitted after the deadline' }
      : await this.evaluate(question, submission);

    const resolution = overtime ? 'timeout' : outcome.correct ? 'correct' : 'wrong';

    if (isPremium) {
      const applied = this.resolvePremiumAttempt(questionId, resolution, outcome.detail, submission);
      return { result: resolution, delta: applied, detail: outcome.detail };
    }

    const delta = this.finishQuestionAttempt(teamId, slot, question, resolution, outcome, {
      elapsed,
      submission,
    });
    void team;
    return { result: resolution, delta, detail: outcome.detail };
  }

  private async evaluate(
    question: Question,
    submission: SubmissionValue,
  ): Promise<{ correct: boolean; detail?: string }> {
    if (question.type === 'code') {
      if (!this.config.codeExecutionEnabled || !this.runner) {
        return { correct: false, detail: 'Code execution is disabled on this server' };
      }
      if (submission.kind !== 'code') return { correct: false, detail: 'Malformed code submission' };
      const outcome = await this.runner.run({
        language: submission.language,
        source: submission.source,
        testCases: question.evaluation.testCases ?? [],
        timeoutMs: this.config.codeExecutionTimeoutMs,
      });
      return { correct: outcome.correct, detail: outcome.detail ?? '' };
    }
    const outcome = evaluateAnswer(question.type, question.evaluation, submission);
    return { correct: outcome.correct, detail: outcome.detail ?? '' };
  }

  private finishQuestionAttempt(
    teamId: string,
    slot: SequenceSlot,
    question: Question,
    resolution: 'correct' | 'wrong' | 'timeout',
    outcome: { correct: boolean; detail?: string },
    extra: { elapsed?: number; submission?: SubmissionValue } = {},
  ): number {
    const team = this.requireTeam(teamId);
    this.clearTimer(`deadline:${teamId}:${slot.index}`);

    // The stake was deducted when the team took the question. A correct answer
    // pays it back multiplied; a wrong answer or timeout forfeits it (nothing
    // more is deducted here).
    const stake = calcReward(this.config, question, team.capital);
    const credit = resolution === 'correct' ? Math.round(stake * this.config.questionWinMultiplier) : 0;
    const net = credit - stake; // correct: +stake; wrong/timeout: -stake

    this.repo.insertAttempt({
      teamId,
      questionId: question.id,
      slotIndex: slot.index,
      attemptNumber: 1,
      result: resolution,
      scoreChange: net,
      riskAmount: stake,
      durationMs: extra.elapsed ?? null,
      detail: outcome.detail ?? null,
      submission: extra.submission,
    });
    this.repo.setParticipation(teamId, slot.index, question.id, 'resolved');
    this.repo.setStagedSubmission(teamId, slot.index, null);

    if (credit > 0) {
      this.applyCapital(
        team,
        credit,
        'question_reward',
        `${question.id} ${resolution} (stake ${stake} x${this.config.questionWinMultiplier})`,
        question.id,
        slot.index,
      );
    }

    this.audit('QUESTION_RESULT', {
      teamId,
      questionId: question.id,
      slotIndex: slot.index,
      metadata: {
        result: resolution,
        stake,
        credit,
        net,
        difficulty: question.difficulty,
        domain: question.domain,
        durationMs: extra.elapsed ?? null,
      },
    });

    this.emitResult(team, question, slot, resolution, credit, stake);
    this.broadcastLiveEvents();
    return net;
  }

  private emitResult(
    team: Team,
    question: Question,
    slot: SequenceSlot,
    resolution: 'correct' | 'wrong' | 'timeout',
    /** Capital credited at the result: the win payout, or 0 on a wrong answer. */
    credit: number,
    /** Amount staked up front when the question was taken. */
    stake: number,
  ): void {
    const fresh = this.repo.getTeam(team.id) as Team;
    const payload = {
      teamId: team.id,
      teamName: team.name,
      questionId: question.id,
      slotIndex: slot.index,
      result: resolution,
      delta: credit,
      stake,
      newCapital: fresh.capital,
      isPremium: slot.kind === 'premium',
      riskAmount: slot.kind === 'premium' ? stake : null,
      at: this.now(),
    };
    this.emit('QUESTION_RESULT', payload, STAGE);
    this.emit('QUESTION_RESULT', payload, toTeam(team.id));
    this.sendTeamView(team.id);
  }

  /* --- capital ---------------------------------------------------------- */

  private applyCapital(
    team: Team,
    delta: number,
    type: Parameters<Repo['insertTransaction']>[0]['type'],
    reason: string,
    questionId: string | null,
    slotIndex: number | null,
  ): void {
    if (delta === 0) {
      this.repo.insertTransaction({
        teamId: team.id,
        amount: 0,
        balanceAfter: team.capital,
        type,
        reason,
        questionId,
        slotIndex,
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
      questionId,
      slotIndex,
    });
    this.emit(
      'CAPITAL_CHANGED',
      { teamId: team.id, from, to, delta: to - from, reason, at: this.now() },
      ALL,
    );
    this.audit('CAPITAL_CHANGED', {
      teamId: team.id,
      questionId,
      slotIndex,
      metadata: { from, to, delta: to - from, reason },
    });
    this.broadcastTeams();
    this.refreshLeaderboard();
    this.sendTeamView(team.id);
  }

  adjustCapital(teamId: string, amount: number, reason: string): void {
    const team = this.requireTeam(teamId);
    const result = resolveAdjustment(this.config, team.capital, amount);
    this.applyCapital(team, result.delta, 'manual_adjustment', reason, null, null);
    this.audit('CAPITAL_ADJUSTED', {
      teamId,
      metadata: { amount: result.delta, reason, from: team.capital, to: result.newCapital },
    });
  }

  /* --- premium flow ------------------------------------------------------ */

  /**
   * The premium intro (spec section 5): domain, difficulty, time and starting
   * bid are public. The question itself stays sealed.
   */
  private enterPremiumIntro(slot: SequenceSlot, question: Question): GameState {
    const premium = this.repo.getPremiumState(question.id) ?? emptyPremiumState(question.id, slot.index);
    premium.slotIndex = slot.index;
    premium.stage = 'intro';
    // The whole premium process runs inside one window (spec section 6).
    premium.windowEndsAt = this.now() + this.config.premiumWindowSeconds * 1000;
    this.repo.savePremiumState(premium);

    const preview = this.premiumPreview(slot, question);
    const state = this.setPhase('premium_intro');

    this.setTimer(
      `window:${question.id}`,
      this.config.premiumWindowSeconds * 1000,
      () => this.onPremiumWindowExpired(question.id),
    );
    this.repo.saveGameState({
      timer: {
        endsAt: premium.windowEndsAt,
        duration: this.config.premiumWindowSeconds,
        label: 'PREMIUM WINDOW',
      },
    });
    this.emit(
      'TIMER_STARTED',
      {
        endsAt: premium.windowEndsAt,
        duration: this.config.premiumWindowSeconds,
        label: 'PREMIUM WINDOW',
      },
      ALL,
    );

    this.audit('PREMIUM_INTRO', {
      questionId: question.id,
      slotIndex: slot.index,
      metadata: { domain: question.domain, difficulty: question.difficulty },
    });
    this.emit('PREMIUM_INTRO', { preview, game: state }, ALL);
    this.setProjectorMode('auto');
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
    return state;
  }

  premiumPreview(slot: SequenceSlot, question: Question): PremiumPreview {
    const slots = this.repo.listSequence();
    const isFinal = finalPremiumIndex(slots) === slot.index;
    const premiumNumber = premiumSlots(slots).findIndex((s) => s.index === slot.index) + 1;
    return {
      questionId: question.id,
      slotIndex: slot.index,
      blockNumber: slot.blockNumber,
      title: question.title,
      domain: question.domain,
      difficulty: question.difficulty,
      timeLimit: question.timeLimit,
      startingBid: isFinal ? this.config.finalPremiumStartingBid : this.config.premiumStartingBid,
      increment: isFinal ? this.config.finalPremiumBidIncrement : this.config.premiumBidIncrement,
      isFinalPremium: isFinal,
      premiumNumber,
    };
  }

  currentPremiumPreview(): PremiumPreview | null {
    const slot = this.currentSlot();
    if (!slot || slot.kind !== 'premium') return null;
    const question = this.repo.getQuestion(slot.questionId);
    return question ? this.premiumPreview(slot, question) : null;
  }

  private onPremiumWindowExpired(questionId: string): void {
    const premium = this.repo.getPremiumState(questionId);
    if (!premium || premium.stage === 'closed') return;
    this.audit('PREMIUM_WINDOW_EXPIRED', { questionId, slotIndex: premium.slotIndex });
    if (premium.activeTeamId && (premium.stage === 'attempt_1' || premium.stage === 'attempt_2')) {
      // Honour a staged answer even when the whole premium window runs out.
      void this.expirePremiumAttempt(questionId);
      return;
    }
    this.closePremium(premium.outcome ?? 'no_takers');
  }

  /* --- auctions ---------------------------------------------------------- */

  startAuction(startingBid?: number, increment?: number): AuctionView {
    const slot = this.currentSlot();
    if (!slot || slot.kind !== 'premium') {
      throw new EngineError('not_premium', 'Only premium questions are auctioned');
    }
    const question = this.repo.getQuestion(slot.questionId) as Question;
    const existing = this.repo.getAuctionForSlot(slot.index);
    if (
      existing &&
      (existing.status === 'open' ||
        existing.status === 'going_once' ||
        existing.status === 'going_twice')
    ) {
      return this.auctionView(existing.id) as AuctionView;
    }
    if (existing && existing.status === 'closed') {
      throw new EngineError('auction_done', 'This premium has already been auctioned');
    }

    const preview = this.premiumPreview(slot, question);
    const auction = this.repo.createAuction(
      question.id,
      slot.index,
      startingBid ?? preview.startingBid,
      increment ?? preview.increment,
    );

    const premium = this.repo.getPremiumState(question.id) ?? emptyPremiumState(question.id, slot.index);
    premium.stage = 'auction';
    premium.auctionId = auction.id;
    this.repo.savePremiumState(premium);

    this.repo.saveGameState({ currentAuctionId: auction.id });
    this.setPhase('auction_active');
    this.setProjectorMode('auto');

    this.audit('AUCTION_STARTED', {
      questionId: question.id,
      slotIndex: slot.index,
      metadata: { auctionId: auction.id, startingBid: auction.startingBid },
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

    const open =
      auction.status === 'open' ||
      auction.status === 'going_once' ||
      auction.status === 'going_twice';
    const bidAmount =
      amount ?? nextBidAmount(auction.currentBid, auction.startingBid, auction.increment);

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
      // Every bid must land on the fixed ladder (200, 300, 400, ...) - the server
      // rejects any arbitrary amount, whoever sent it (spec sections 3, 11, 18).
      enforceIncrement: true,
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
        questionId: auction.questionId,
        slotIndex: auction.slotIndex,
        metadata: { amount: bidAmount, reason: validation.reason, maxBid: validation.teamMaxBid },
      });
      const payload = {
        teamId,
        amount: bidAmount,
        reason: validation.reason ?? 'invalid',
        message: validation.message ?? 'Bid rejected',
      };
      this.emit('AUCTION_BID_REJECTED', payload, ORGANIZER);
      this.emit('AUCTION_BID_REJECTED', payload, toTeam(teamId));
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
      status: 'open',
    });

    this.audit('AUCTION_BID', {
      teamId,
      questionId: auction.questionId,
      slotIndex: auction.slotIndex,
      metadata: { amount: bidAmount, sequence },
    });

    const view = this.auctionView(auction.id) as AuctionView;
    this.emit('AUCTION_BID', { auction: view, bid, outbidTeamId: previousLeader }, ALL);
    this.broadcastAllTeamViews();
    return { accepted: true };
  }

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
      questionId: auction.questionId,
      slotIndex: auction.slotIndex,
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
    this.audit('AUCTION_CALL', { questionId: auction.questionId, metadata: { call } });
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

    const premium =
      this.repo.getPremiumState(auction.questionId) ??
      emptyPremiumState(auction.questionId, auction.slotIndex);
    premium.auctionId = auction.id;
    premium.ladder = buildLadder(bids, winner);

    const view = this.auctionView(auction.id) as AuctionView;

    if (!winner || amount === null) {
      premium.stage = 'closed';
      premium.outcome = 'unsold';
      premium.ladder = closeLadder(premium.ladder);
      this.repo.savePremiumState(premium);
      this.audit('AUCTION_CLOSED', { questionId: auction.questionId, metadata: { sold: false } });
      this.emit('AUCTION_CLOSED', { auction: view }, ALL);
      this.emit('PREMIUM_CLOSED', { premium }, ALL);
      this.enterPremiumResult();
      return view;
    }

    premium.stage = 'sold';
    premium.activeTeamId = winner;
    premium.activeRisk = amount;
    this.repo.savePremiumState(premium);

    const winnerTeam = this.requireTeam(winner);
    this.audit('AUCTION_WON', {
      teamId: winner,
      questionId: auction.questionId,
      slotIndex: auction.slotIndex,
      metadata: { amount, bidders: premium.ladder.length },
    });

    this.emit('AUCTION_CLOSED', { auction: view }, ALL);
    this.emit(
      'AUCTION_WON',
      { teamId: winner, teamName: winnerTeam.name, amount, questionId: auction.questionId },
      ALL,
    );
    this.emit('PREMIUM_UNLOCKED', { premium, teamId: winner, risk: amount }, ALL);

    // The highest bidder MUST attempt the premium - they bid for it, so there is
    // no TAKE / SIT-OUT choice for the winner (spec section 8). The question is
    // authorised for them and the operator opens the attempt. Only the SECOND
    // bidder gets a take/sit-out choice, and only if the winner fails (spec 9).
    this.setPhase('premium_authorized');
    this.setProjectorMode('auto');
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
    const premium = this.repo.getPremiumState(auction.questionId);
    if (premium) {
      premium.stage = 'intro';
      premium.auctionId = null;
      premium.ladder = [];
      this.repo.savePremiumState(premium);
    }
    this.audit('AUCTION_CANCELLED', { questionId: auction.questionId });
    this.emit('AUCTION_CANCELLED', { auctionId: auction.id }, ALL);
    this.setPhase('premium_intro');
    this.broadcastAllTeamViews();
  }

  auctionView(auctionId: number): AuctionView | null {
    const auction = this.repo.getAuction(auctionId);
    if (!auction) return null;
    const question = this.repo.getQuestion(auction.questionId);
    const slot = this.repo.getSlot(auction.slotIndex);
    if (!question || !slot) return null;

    const bids = this.repo.listBids(auction.id);
    const premium = this.repo.getPremiumState(auction.questionId);
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
      preview: this.premiumPreview(slot, question),
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

  /* --- premium attempts --------------------------------------------------- */

  currentPremium(): PremiumState | null {
    const slot = this.currentSlot();
    if (!slot || slot.kind !== 'premium') return null;
    return this.repo.getPremiumState(slot.questionId);
  }

  startPremiumAttempt(): void {
    const slot = this.currentSlot();
    if (!slot || slot.kind !== 'premium') throw new EngineError('no_premium', 'No premium is open');
    const question = this.repo.getQuestion(slot.questionId) as Question;
    const premium = this.repo.getPremiumState(slot.questionId);
    if (!premium) throw new EngineError('no_premium', 'No premium state');
    if (!premium.activeTeamId || premium.activeRisk === null) {
      throw new EngineError('no_winner', 'No authorised team for this premium');
    }
    if (!canStartAnotherAttempt(premium)) {
      throw new EngineError('max_attempts', 'This premium has used both attempts');
    }
    // Starting the attempt ends any open decision window.
    this.clearTimer(`decision:${question.id}`);
    premium.decisionDeadline = null;

    const attemptNumber = (premium.attemptNumber + 1) as 1 | 2;
    premium.attemptNumber = attemptNumber;
    premium.stage = attemptNumber === 1 ? 'attempt_1' : 'attempt_2';
    premium.offerTeamId = null;
    premium.offerRisk = null;
    premium.offerDeadline = null;
    this.repo.savePremiumState(premium);

    const teamId = premium.activeTeamId;
    const risk = premium.activeRisk;
    this.repo.setParticipation(teamId, slot.index, question.id, 'in_progress', {
      unlocked: true,
      joined: true,
    });

    // Taking the premium stakes the bid up front (spec: "the amount he bid should
    // cut initially"); a correct answer pays it back multiplied, a wrong answer
    // forfeits it. Only ever charged when the team actually attempts.
    if (risk > 0) {
      this.applyCapital(
        this.requireTeam(teamId),
        -risk,
        'premium_stake',
        `Premium ${slot.questionId} stake (bid ${risk})`,
        slot.questionId,
        slot.index,
      );
    }

    this.setPhase('premium_solving');
    this.setProjectorMode('auto');

    // The solve clock never outlives the premium window.
    const solveSeconds = Math.min(
      this.config.premiumSolveSeconds || question.timeLimit,
      Math.max(
        5,
        Math.floor(((premium.windowEndsAt ?? this.now() + 60_000) - this.now()) / 1000),
      ),
    );
    const endsAt = this.now() + solveSeconds * 1000;
    this.setTimer(
      `premium:${slot.questionId}`,
      solveSeconds * 1000 + this.config.submissionGraceMs,
      () => void this.expirePremiumAttempt(slot.questionId),
    );
    this.repo.saveGameState({
      timer: { endsAt, duration: solveSeconds, label: 'PREMIUM' },
    });

    this.audit('PREMIUM_ATTEMPT_STARTED', {
      teamId,
      questionId: slot.questionId,
      slotIndex: slot.index,
      metadata: { attemptNumber, risk, solveSeconds },
    });
    this.emit('PREMIUM_ATTEMPT_STARTED', { premium, teamId, attemptNumber, risk }, ALL);
    this.emit(
      'QUESTION_OPENED',
      {
        question: this.publicQuestion(question, slot, true, this.requireTeam(teamId).capital, solveSeconds),
        game: this.gameState(),
      },
      toTeam(teamId),
    );
    this.emit('TIMER_STARTED', { endsAt, duration: solveSeconds, label: 'PREMIUM' }, ALL);
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  private async expirePremiumAttempt(questionId: string): Promise<void> {
    const premium = this.repo.getPremiumState(questionId);
    if (!premium || (premium.stage !== 'attempt_1' && premium.stage !== 'attempt_2')) return;
    const teamId = premium.activeTeamId;
    if (!teamId) return;
    if (this.repo.hasAttempt(teamId, premium.slotIndex)) return;

    // Auto-submit the attempter's selected-but-unsent answer (spec section 1).
    const question = this.repo.getQuestion(questionId);
    const participation = this.repo.getParticipation(teamId, premium.slotIndex);
    const staged = participation?.stagedSubmission ?? null;
    if (question && staged) {
      const outcome = await this.evaluate(question, staged);
      if (this.repo.hasAttempt(teamId, premium.slotIndex)) return;
      this.resolvePremiumAttempt(
        questionId,
        outcome.correct ? 'correct' : 'wrong',
        outcome.detail,
        staged,
      );
      return;
    }
    this.resolvePremiumAttempt(questionId, 'timeout', 'Time expired');
  }

  forcePremiumResult(result: 'correct' | 'wrong' | 'timeout'): number {
    const slot = this.currentSlot();
    if (!slot) throw new EngineError('no_question', 'No question is open');
    return this.resolvePremiumAttempt(slot.questionId, result, 'Recorded by operator');
  }

  private resolvePremiumAttempt(
    questionId: string,
    resolution: 'correct' | 'wrong' | 'timeout',
    detail?: string,
    submission?: SubmissionValue,
  ): number {
    const question = this.repo.getQuestion(questionId) as Question;
    const premium = this.repo.getPremiumState(questionId);
    if (!premium || !premium.activeTeamId || premium.activeRisk === null) {
      throw new EngineError('no_active_attempt', 'No premium attempt in progress');
    }
    const slot = this.repo.getSlot(premium.slotIndex) as SequenceSlot;
    const teamId = premium.activeTeamId;
    const risk = premium.activeRisk;
    const team = this.requireTeam(teamId);

    this.clearTimer(`premium:${questionId}`);
    this.clearTimer('global');

    // The bid was staked when the attempt began. A correct answer pays it back
    // multiplied - 2x for the winning bidder (attempt 1), 1.5x for the second
    // bidder's reclaim (attempt 2). A wrong answer or timeout forfeits the bid.
    const multiplier =
      premium.attemptNumber === 1
        ? this.config.premiumWinMultiplier
        : this.config.premiumReclaimMultiplier;
    const credit = resolution === 'correct' ? Math.round(risk * multiplier) : 0;
    const net = credit - risk;

    this.repo.insertAttempt({
      teamId,
      questionId,
      slotIndex: slot.index,
      attemptNumber: premium.attemptNumber || 1,
      result: resolution,
      scoreChange: net,
      riskAmount: risk,
      detail: detail ?? null,
      submission,
    });
    this.repo.setParticipation(teamId, slot.index, questionId, 'resolved');
    this.repo.setStagedSubmission(teamId, slot.index, null);

    if (credit > 0) {
      this.applyCapital(
        team,
        credit,
        'premium_reward',
        `Premium ${questionId} ${resolution} (bid ${risk} x${multiplier})`,
        questionId,
        slot.index,
      );
    }

    this.audit('PREMIUM_RESULT', {
      teamId,
      questionId,
      slotIndex: slot.index,
      metadata: { result: resolution, risk, credit, net, multiplier, attempt: premium.attemptNumber },
    });

    this.emitResult(team, question, slot, resolution, credit, risk);

    if (resolution === 'correct') {
      premium.stage = 'closed';
      premium.outcome = premium.attemptNumber === 1 ? 'won_first' : 'won_reclaim';
      premium.ladder = closeLadder(premium.ladder);
      premium.activeTeamId = null;
      premium.activeRisk = null;
      this.repo.savePremiumState(premium);
      this.emit('PREMIUM_CLOSED', { premium }, ALL);
      this.enterPremiumResult();
      return net;
    }

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
      return net;
    }

    const next = nextCandidate(premium.ladder);
    if (!next) {
      this.closePremium('no_takers');
      return net;
    }

    this.offerReclaim(next.teamId);
    return net;
  }

  offerReclaim(teamId?: string): void {
    const slot = this.currentSlot();
    if (!slot) throw new EngineError('no_question', 'No question is open');
    const premium = this.repo.getPremiumState(slot.questionId);
    if (!premium) throw new EngineError('no_premium', 'No premium state');
    if (!canStartAnotherAttempt(premium)) {
      throw new EngineError('max_attempts', 'This premium has used both attempts');
    }

    // The reclaim can ONLY ever go to the second bidder - rank 2 in the original
    // auction ladder (spec section 7). A third or lower bidder is never offered,
    // so any explicit teamId must be exactly that second bidder.
    const second = premium.ladder.find((e) => e.rank === 2) ?? null;
    if (teamId && (!second || teamId !== second.teamId)) {
      throw new EngineError('not_second_bidder', 'Only the second bidder may be offered the reclaim');
    }
    if (!second || second.state !== 'pending') {
      // No second bidder, or they have already had their chance: nothing to do.
      this.closePremium('no_takers');
      return;
    }
    const candidate = second;

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

    this.setPhase('reclaim');
    this.scheduleReclaimExpiry(slot.questionId, deadline);

    this.audit('PREMIUM_RECLAIM_OFFERED', {
      teamId: candidate.teamId,
      questionId: slot.questionId,
      slotIndex: slot.index,
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

  private scheduleReclaimExpiry(questionId: string, deadline: number): void {
    if (!this.config.reclaimAutoDecline) return;
    this.setTimer(`reclaim:${questionId}`, Math.max(0, deadline - this.now()), () => {
      this.expireReclaim(questionId);
    });
  }

  private expireReclaim(questionId: string): void {
    const premium = this.repo.getPremiumState(questionId);
    if (!premium || premium.stage !== 'reclaim_offer' || !premium.offerTeamId) return;
    this.resolveReclaim(premium.offerTeamId, false, true);
  }

  resolveReclaim(teamId: string, accept: boolean, expired = false): void {
    const slot = this.currentSlot();
    if (!slot) throw new EngineError('no_question', 'No question is open');
    const premium = this.repo.getPremiumState(slot.questionId);
    if (!premium || premium.stage !== 'reclaim_offer') {
      throw new EngineError('no_offer', 'There is no reclaim offer open');
    }
    if (premium.offerTeamId !== teamId) {
      throw new EngineError('not_your_offer', 'This reclaim offer is not addressed to your team');
    }

    this.clearTimer(`reclaim:${slot.questionId}`);
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

      this.audit('PREMIUM_RECLAIM_ACCEPTED', {
        teamId,
        questionId: slot.questionId,
        slotIndex: slot.index,
        metadata: { risk },
      });
      this.setPhase('premium_authorized');
      this.emit('PREMIUM_RECLAIM_ACCEPTED', { premium, teamId, risk }, ALL);
      this.emit('QUESTION_UNLOCKED', { questionId: slot.questionId, teamId, risk }, toTeam(teamId));
      this.broadcastAllTeamViews();
      this.broadcastLiveEvents();
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

    // Only the winner and the second bidder ever get the premium (spec section 7).
    // When the second bidder sits out (declines, or lets the 15s window lapse),
    // the premium closes - it is NEVER passed down to a third bidder.
    this.audit('PREMIUM_RECLAIM_DECLINED', {
      teamId,
      questionId: slot.questionId,
      slotIndex: slot.index,
      metadata: { expired, next: null },
    });
    this.emit(
      'PREMIUM_RECLAIM_DECLINED',
      { premium, teamId, expired, nextTeamId: null },
      ALL,
    );

    this.closePremium('no_takers');
  }

  closePremium(outcome: PremiumState['outcome'] = null): void {
    const slot = this.currentSlot();
    if (!slot) return;
    const premium = this.repo.getPremiumState(slot.questionId);
    if (!premium) return;

    this.clearTimer(`reclaim:${slot.questionId}`);
    this.clearTimer(`premium:${slot.questionId}`);
    this.clearTimer(`window:${slot.questionId}`);
    this.clearTimer(`decision:${slot.questionId}`);

    premium.stage = 'closed';
    premium.ladder = closeLadder(premium.ladder);
    premium.offerTeamId = null;
    premium.offerRisk = null;
    premium.offerDeadline = null;
    premium.activeTeamId = null;
    premium.activeRisk = null;
    if (outcome) premium.outcome = outcome;
    this.repo.savePremiumState(premium);

    this.repo.setSlotState(slot.index, 'complete');
    this.audit('PREMIUM_CLOSED', {
      questionId: slot.questionId,
      slotIndex: slot.index,
      metadata: { outcome: premium.outcome },
    });
    this.emit('PREMIUM_CLOSED', { premium }, ALL);
    this.enterPremiumResult();
  }

  private enterPremiumResult(): void {
    this.clearTimer('global');
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
    this.setPhase('premium_result');
    this.broadcastAllTeamViews();
    this.broadcastLiveEvents();
  }

  /* --- strategy phase (spec section 10) ---------------------------------- */

  /**
   * The 40-second planning beat after every premium. A real game state, not a
   * loading screen: teams review capital and plan before the next block.
   */
  startStrategyPhase(): GameState {
    const seconds = Math.max(1, this.config.strategyWindowSeconds);
    const endsAt = this.now() + seconds * 1000;
    const state = this.repo.getGameState();
    const nextIndex = state.slotIndex + 1;
    const next = this.repo.getSlot(nextIndex);

    this.repo.saveGameState({
      timer: { endsAt, duration: seconds, label: 'STRATEGY' },
    });
    const game = this.setPhase('strategy_phase');
    this.setProjectorMode('auto');

    this.setTimer('strategy', seconds * 1000, () => this.endStrategyPhase());

    this.audit('STRATEGY_STARTED', { metadata: { seconds, nextSlot: next?.index ?? null } });
    this.emit(
      'STRATEGY_STARTED',
      { endsAt, duration: seconds, nextSlotIndex: next?.index ?? null },
      ALL,
    );
    this.emit('TIMER_STARTED', { endsAt, duration: seconds, label: 'STRATEGY' }, ALL);
    this.broadcastAllTeamViews();
    return game;
  }

  /** Ends the strategy phase and moves straight into the next slot. */
  endStrategyPhase(): void {
    this.clearTimer('strategy');
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
    this.audit('STRATEGY_ENDED', {});
    this.emit('STRATEGY_ENDED', {}, ALL);
    this.advance();
  }

  /* --- timers -------------------------------------------------------------- */

  startTimer(seconds: number, label: string): void {
    const endsAt = this.now() + seconds * 1000;
    this.repo.saveGameState({ timer: { endsAt, duration: seconds, label } });
    this.scheduleGlobalTimer(endsAt, label, this.repo.getGameState().phase);
    this.emit('TIMER_STARTED', { endsAt, duration: seconds, label }, ALL);
  }

  stopTimer(): void {
    this.clearTimer('global');
    this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
    this.emit('TIMER_STOPPED', {}, ALL);
  }

  private scheduleGlobalTimer(endsAt: number, label: string, phase: GamePhase): void {
    this.clearTimer('global');
    const delay = Math.max(0, endsAt - this.now());
    this.setTimer('global', delay, () => {
      this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
      this.emit('TIMER_EXPIRED', { label }, ALL);
      if (phase === 'question_active') this.closeQuestion();
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

    if (key === 'global') {
      const state = this.repo.getGameState();
      this.repo.saveGameState({ timer: { endsAt: null, duration: null, label: null } });
      this.emit('TIMER_EXPIRED', { label: state.timer.label ?? 'TIMER' }, ALL);
      if (state.phase === 'question_active') this.closeQuestion();
      return true;
    }
    if (key === 'intro') {
      this.openQuestion();
      return true;
    }
    if (key === 'strategy') {
      this.endStrategyPhase();
      return true;
    }
    if (key.startsWith('deadline:')) {
      const [, teamId, slotIndex] = key.split(':');
      if (teamId && slotIndex) void this.expireTeamQuestion(teamId, Number(slotIndex));
      return true;
    }
    if (key.startsWith('reclaim:')) {
      this.expireReclaim(key.slice('reclaim:'.length));
      return true;
    }
    if (key.startsWith('question_decision:')) {
      this.closeQuestionDecision(Number(key.slice('question_decision:'.length)));
      return true;
    }
    if (key.startsWith('premium:')) {
      void this.expirePremiumAttempt(key.slice('premium:'.length));
      return true;
    }
    if (key.startsWith('window:')) {
      this.onPremiumWindowExpired(key.slice('window:'.length));
      return true;
    }
    return false;
  }

  /* --- public projections ---------------------------------------------------- */

  /** Strip the answer. `revealed` decides whether the body travels at all. */
  publicQuestion(
    question: Question,
    slot: SequenceSlot,
    revealed: boolean,
    capital: number,
    timeLimitOverride?: number,
  ): QuestionPublic {
    const base: QuestionPublic = {
      id: question.id,
      kind: question.kind,
      title: question.title,
      domain: question.domain,
      type: question.type,
      difficulty: question.difficulty,
      timeLimit: timeLimitOverride ?? question.timeLimit,
      slotIndex: slot.index,
      blockNumber: slot.blockNumber,
      positionInBlock: slot.positionInBlock,
      revealed,
      question: revealed ? question.question : { prompt: '' },
    };
    if (question.kind === 'normal') {
      // Stake model: taking the question deducts its difficulty value; a correct
      // answer pays that back multiplied; a wrong answer forfeits it.
      const stake = calcReward(this.config, question, capital);
      base.stake = stake;
      base.reward = Math.round(stake * this.config.questionWinMultiplier);
      base.penalty = stake;
    }
    return base;
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

  /* --- leaderboard ------------------------------------------------------------ */

  leaderboard(): LeaderboardRow[] {
    return this.leaderboardCache;
  }

  private refreshLeaderboard(broadcast = true): void {
    const teams = this.repo.listTeams();
    const rows = computeLeaderboard(teams, {
      podiumPlaces: this.config.podiumPlaces,
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

    if (!broadcast) return;

    // The organizer ALWAYS sees the board. During the blackout the projector
    // and participants receive nothing global (spec sections 11, 18).
    this.emit('LEADERBOARD_UPDATED', { rows, changed }, ORGANIZER);
    if (!this.isFinalStretch()) {
      this.emit('LEADERBOARD_UPDATED', { rows, changed }, { kind: 'projector' });
      this.emit('LEADERBOARD_UPDATED', { rows, changed }, { kind: 'participants' });
    }
  }

  /** The leaderboard a given role may see right now. */
  leaderboardFor(role: 'participant' | 'organizer' | 'projector', teamId: string | null): LeaderboardRow[] {
    if (role === 'organizer') return this.leaderboardCache;
    if (!this.isFinalStretch()) return this.leaderboardCache;
    if (role === 'participant') return redactForFinalStretch(this.leaderboardCache, teamId);
    return [];
  }

  setConnection(teamId: string, status: 'online' | 'offline'): void {
    const team = this.repo.getTeam(teamId);
    if (!team || team.connectionStatus === status) return;
    this.repo.setConnectionStatus(teamId, status);
    this.audit(status === 'online' ? 'TEAM_CONNECTED' : 'TEAM_DISCONNECTED', { teamId });
    this.emit(status === 'online' ? 'TEAM_CONNECTED' : 'TEAM_DISCONNECTED', { teamId }, STAGE);
    this.broadcastTeams();
    this.refreshLeaderboard();
    this.broadcastLiveEvents();
  }

  /* --- teams ------------------------------------------------------------------- */

  createTeams(
    specs: { id?: string; name: string; seatLabel?: string; volunteer?: string }[],
  ): Team[] {
    const existing = this.repo.listTeams();
    let counter = existing.length;
    const created: Team[] = [];

    for (const spec of specs) {
      counter += 1;
      const id = spec.id?.trim() || padTeamNumber(counter);
      if (this.repo.getTeam(id)) throw new EngineError('team_exists', `Team ${id} already exists`);
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
      const code = generateJoinCode(6, this.teamCodeRand ?? undefined);
      if (!this.repo.getTeamByJoinCode(code)) return code;
    }
    throw new EngineError('join_code_exhausted', 'Could not allocate a unique join code');
  }

  /** The lowest T## id not already taken (robust to deleted teams). */
  private nextTeamId(): string {
    const taken = new Set(this.repo.listTeams().map((t) => t.id));
    for (let n = 1; n <= 999; n++) {
      const id = padTeamNumber(n);
      if (!taken.has(id)) return id;
    }
    throw new EngineError('team_limit', 'Too many teams');
  }

  /**
   * Self-service registration: a participant opens the IP link and enters their
   * TEAM NAME. There is no pre-issued roster and no fixed team count - teams are
   * created as they arrive. Entering a name that already exists RE-JOINS that
   * team (a teammate's second laptop, or a reconnect from a new device), rather
   * than creating a duplicate. The internal T## id is never shown; the name is.
   */
  registerTeam(name: string): Team {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) throw new EngineError('bad_name', 'Enter a team name');
    if (trimmed.length > 24) throw new EngineError('bad_name', 'Team name is too long (max 24 characters)');

    const existing = this.repo
      .listTeams()
      .find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const [created] = this.createTeams([{ id: this.nextTeamId(), name: trimmed }]);
    return created as Team;
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

  /* --- config -------------------------------------------------------------------- */

  updateConfig(patch: Partial<GameConfig>): { ok: boolean; errors: string[] } {
    const result = applyConfigPatch(this.config, patch);
    this.config = result.config;
    this.repo.saveConfig(this.config);
    this.audit('CONFIG_UPDATED', { metadata: { keys: Object.keys(patch) } });
    this.emit('CONFIG_UPDATED', { config: this.config }, ALL);
    this.refreshLeaderboard();
    return { ok: result.ok, errors: result.errors };
  }

  /* --- team views ------------------------------------------------------------------ */

  teamStats(teamId: string): TeamStats {
    const attempts = this.repo.listAttemptsForTeam(teamId);
    const slots = new Map(this.repo.listSequence().map((s) => [s.index, s]));
    const stats: TeamStats = {
      attempted: 0,
      correct: 0,
      wrong: 0,
      skipped: 0,
      premiumWins: 0,
      premiumAttempts: 0,
      premiumCorrect: 0,
      premiumWrong: 0,
      totalEarned: 0,
      totalLost: 0,
    };
    for (const attempt of attempts) {
      const slot = slots.get(attempt.slotIndex);
      const premium = slot?.kind === 'premium';
      if (attempt.scoreChange > 0) stats.totalEarned += attempt.scoreChange;
      if (attempt.scoreChange < 0) stats.totalLost += Math.abs(attempt.scoreChange);
      if (premium) {
        stats.premiumAttempts += 1;
        if (attempt.result === 'correct') stats.premiumCorrect += 1;
        else stats.premiumWrong += 1;
      } else {
        if (attempt.result === 'skipped') {
          stats.skipped += 1;
          continue;
        }
        stats.attempted += 1;
        if (attempt.result === 'correct') stats.correct += 1;
        else stats.wrong += 1;
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
    const slot = this.currentSlot();
    const premium = slot?.kind === 'premium' ? this.repo.getPremiumState(slot.questionId) : null;
    const hidden = this.isFinalStretch();

    let questionState: TeamView['questionState'] = 'idle';
    let questionDeadline: number | null = null;
    if (slot) {
      const participation = this.repo.getParticipation(teamId, slot.index);
      // The team's own clock, started when it joined. Sent so a reconnecting
      // team resumes the time it actually has left rather than a fresh one.
      const question = this.repo.getQuestion(slot.questionId);
      if (participation?.state === 'in_progress' && participation.joinedAt && question) {
        // The clock the client shows ends at the true time limit. The server's
        // hard deadline adds submissionGraceMs on top, so the client's own
        // auto-submit at zero (spec section 1) lands comfortably inside the grace
        // window rather than racing the server's expiry.
        questionDeadline = participation.joinedAt + question.timeLimit * 1000;
      }
      if (slot.kind === 'premium') {
        questionState =
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
        const base = participation?.state ?? 'locked';
        // When keys are off, opening a question makes it immediately joinable
        // for every team — there is no unlock step to wait through.
        const phase = this.repo.getGameState().phase;
        questionState =
          base === 'locked' && !this.config.requireAccessKey && phase === 'question_active'
            ? 'available'
            : base;
      }
    }

    const attempts = this.repo.listAttemptsForTeam(teamId);
    const last = attempts[attempts.length - 1];
    const lastQuestion = last ? this.repo.getQuestion(last.questionId) : null;

    const state = this.repo.getGameState();
    const auction = state.currentAuctionId ? this.repo.getAuction(state.currentAuctionId) : null;
    const myBids = auction ? this.repo.listBids(auction.id).filter((b) => b.teamId === teamId) : [];
    const myHighest = myBids.length > 0 ? Math.max(...myBids.map((b) => b.amount)) : null;

    return {
      teamId,
      capital: team.capital,
      maxBid: maxBid(team.capital, team.protectedReserve),
      rank: hidden ? 0 : (row?.rank ?? 0),
      podium: hidden ? null : (row?.podium ?? null),
      totalTeams: rows.length,
      leaderboardHidden: hidden,
      questionState,
      questionDeadline,
      premiumUnlocked: premium?.activeTeamId === teamId,
      premiumRisk: premium?.activeTeamId === teamId ? premium.activeRisk : null,
      canDecidePremium:
        premium?.stage === 'decision' && premium.activeTeamId === teamId,
      premiumDecisionDeadline:
        premium?.stage === 'decision' && premium.activeTeamId === teamId
          ? premium.decisionDeadline
          : null,
      premiumDecision:
        premium && premium.activeTeamId === teamId
          ? (premium.decisions[teamId] ?? null)
          : null,
      lastResult: last
        ? {
            questionId: last.questionId,
            result: last.result,
            // Capital credited at the result (the win payout; 0 on a loss).
            // The attempt stores the NET (scoreChange) and the stake (riskAmount);
            // credit = net + stake on a win, 0 otherwise.
            delta: last.result === 'correct' ? last.scoreChange + (last.riskAmount ?? 0) : 0,
            stake: last.riskAmount ?? 0,
            detail: last.detail ?? undefined,
            explanation:
              this.config.revealExplanations && lastQuestion
                ? lastQuestion.evaluation.explanation
                : undefined,
            at: last.timestamp,
          }
        : null,
      reclaimOffer:
        premium?.offerTeamId === teamId && premium.offerDeadline
          ? {
              questionId: premium.questionId,
              risk: premium.offerRisk ?? 0,
              deadline: premium.offerDeadline,
            }
          : null,
      inAuction: myBids.some((b) => b.valid),
      myHighestBid: myHighest,
      stats: this.teamStats(teamId),
    };
  }

  private sendTeamView(teamId: string): void {
    const view = this.teamView(teamId);
    if (view) this.emit('ME_UPDATED', { me: view }, toTeam(teamId));
  }

  private broadcastAllTeamViews(): void {
    for (const t of this.repo.listTeams()) this.sendTeamView(t.id);
  }

  /* --- organizer dossier (spec section 12) ------------------------------------------ */

  teamDossier(teamId: string): TeamDossier | null {
    const team = this.repo.getTeam(teamId);
    if (!team) return null;

    const slots = new Map(this.repo.listSequence().map((s) => [s.index, s]));
    const questions = new Map(this.repo.listQuestions().map((q) => [q.id, q]));
    const auctions = this.repo.listAuctions();
    const auctionById = new Map(auctions.map((a) => [a.id, a]));

    const attempts = this.repo.listAttemptsForTeam(teamId).map((a) => {
      const q = questions.get(a.questionId);
      const slot = slots.get(a.slotIndex);
      return {
        ...a,
        title: q?.title ?? a.questionId,
        domain: q?.domain ?? ('logic' as const),
        difficulty: q?.difficulty ?? ('medium' as const),
        kind: slot?.kind ?? ('normal' as const),
      };
    });

    const bids = this.repo.listBidsForTeam(teamId).map((b) => {
      const auction = auctionById.get(b.auctionId);
      return {
        ...b,
        questionId: auction?.questionId ?? '',
        slotIndex: auction?.slotIndex ?? 0,
        won: auction?.winnerTeamId === teamId,
      };
    });

    const premiums = auctions
      .filter((a) => this.repo.listBids(a.id).some((b) => b.teamId === teamId))
      .map((a) => {
        const state = this.repo.getPremiumState(a.questionId);
        const attempt = attempts.find((x) => x.slotIndex === a.slotIndex);
        const role: 'winner' | 'reclaim' | 'bidder' =
          a.winnerTeamId === teamId
            ? 'winner'
            : state?.ladder.find((e) => e.teamId === teamId && e.state === 'accepted')
              ? 'reclaim'
              : 'bidder';
        return {
          questionId: a.questionId,
          slotIndex: a.slotIndex,
          winningBid: a.winnerTeamId === teamId ? a.winningAmount : null,
          role,
          outcome: state?.outcome ?? null,
          result: attempt?.result ?? null,
        };
      });

    return {
      team,
      joinCode: this.repo.getJoinCode(teamId),
      stats: this.teamStats(teamId),
      rank: this.leaderboardCache.find((r) => r.teamId === teamId)?.rank ?? 0,
      attempts,
      bids,
      transactions: this.repo.listTransactionsForTeam(teamId),
      premiums,
      audit: this.repo.listAuditForTeam(teamId),
    };
  }

  /* --- live operator queue -------------------------------------------------------- */

  liveEvents(): LiveEvent[] {
    const state = this.repo.getGameState();
    const events: LiveEvent[] = [];
    const teams = new Map(this.repo.listTeams().map((t) => [t.id, t]));
    const slot = this.currentSlot();

    if (slot) {
      const question = this.repo.getQuestion(slot.questionId);
      const label =
        slot.kind === 'premium'
          ? `Block ${slot.blockNumber} · PREMIUM`
          : `Block ${slot.blockNumber} · Q${slot.positionInBlock}`;

      for (const p of this.repo.listParticipationForSlot(slot.index)) {
        const t = teams.get(p.teamId);
        if (!t) continue;
        if (p.state === 'in_progress') {
          events.push({
            id: `${p.teamId}:${slot.index}:attempting`,
            teamId: p.teamId,
            teamName: t.name,
            questionId: slot.questionId,
            label,
            kind: 'attempting',
            since: p.joinedAt ?? this.now(),
            needsAttention: false,
          });
        } else if (p.state === 'submitted') {
          events.push({
            id: `${p.teamId}:${slot.index}:submitted`,
            teamId: p.teamId,
            teamName: t.name,
            questionId: slot.questionId,
            label,
            kind: 'submitted',
            since: this.now(),
            needsAttention: true,
          });
        }
      }
      void question;

      const premium = this.repo.getPremiumState(slot.questionId);
      if (premium?.offerTeamId) {
        const t = teams.get(premium.offerTeamId);
        if (t) {
          events.push({
            id: `${premium.offerTeamId}:${slot.index}:reclaim`,
            teamId: premium.offerTeamId,
            teamName: t.name,
            questionId: slot.questionId,
            label: `${label} RECLAIM`,
            kind: 'reclaim_offer',
            since: this.now(),
            needsAttention: true,
          });
        }
      }
    }

    const live = state.startedAt !== null && state.phase !== 'idle' && state.phase !== 'completed';
    for (const t of teams.values()) {
      if (t.connectionStatus === 'offline' && t.status === 'active') {
        events.push({
          id: `${t.id}:offline`,
          teamId: t.id,
          teamName: t.name,
          questionId: slot?.questionId ?? '',
          label: 'Disconnected',
          kind: 'disconnected',
          since: t.lastSeenAt ?? this.now(),
          needsAttention: live,
        });
      }
    }

    return events.sort(
      (a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.since - b.since,
    );
  }

  private broadcastLiveEvents(): void {
    this.emit('LIVE_EVENTS', { events: this.liveEvents() }, ORGANIZER);
  }

  /* --- snapshots -------------------------------------------------------------------- */

  snapshot(
    role: 'participant' | 'organizer' | 'projector',
    teamId: string | null,
    seq: number,
  ): Snapshot {
    const state = this.gameState();
    const slot = this.currentSlot();
    const question = slot ? this.repo.getQuestion(slot.questionId) : null;
    const premium = slot?.kind === 'premium' ? this.repo.getPremiumState(slot.questionId) : null;
    const hidden = this.isFinalStretch();

    let publicQuestion: QuestionPublic | null = null;
    if (question && slot) {
      let revealed = false;
      let capital = this.config.startingCapital;
      if (role === 'participant' && teamId) {
        const t = this.repo.getTeam(teamId);
        capital = t?.capital ?? capital;
        const participation = this.repo.getParticipation(teamId, slot.index);
        if (slot.kind === 'premium') {
          revealed =
            premium?.activeTeamId === teamId &&
            (premium.stage === 'attempt_1' || premium.stage === 'attempt_2');
        } else {
          revealed = participation?.state === 'in_progress';
        }
      } else if (role === 'organizer') {
        revealed = true;
      }
      publicQuestion = this.publicQuestion(question, slot, revealed, capital);
    }

    const snapshot: Snapshot = {
      role,
      config: this.config,
      game: state,
      teams: this.publicTeams(),
      leaderboard: this.leaderboardFor(role, teamId),
      leaderboardHidden: hidden && role !== 'organizer',
      auction: this.currentAuctionView(),
      premium,
      question: publicQuestion,
      premiumPreview: this.currentPremiumPreview(),
      me: role === 'participant' && teamId ? this.teamView(teamId) : null,
      podium:
        state.phase === 'final_results' || state.phase === 'completed' ? this.podium() : null,
      seq,
      serverNow: this.now(),
    };

    if (role === 'organizer') {
      snapshot.liveEvents = this.liveEvents();
      snapshot.sequence = this.sequenceEntries();
    }
    return snapshot;
  }

  /* --- audit ---------------------------------------------------------------------- */

  audit(
    action: string,
    entry: {
      teamId?: string | null;
      questionId?: string | null;
      slotIndex?: number | null;
      metadata?: Record<string, unknown>;
    },
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

  listQuestions(): Question[] {
    return this.repo.listQuestions();
  }

  /* --- guards ---------------------------------------------------------------------- */

  private requireTeam(teamId: string): Team {
    const team = this.repo.getTeam(teamId);
    if (!team) throw new EngineError('unknown_team', `Unknown team ${teamId}`);
    return team;
  }

  private requireCurrentSlot(questionId: string): SequenceSlot {
    const slot = this.currentSlot();
    if (!slot || slot.questionId !== questionId) {
      throw new EngineError('not_current', 'That question is not currently open');
    }
    return slot;
  }

  private requireNotPaused(): void {
    if (this.repo.getGameState().phase === 'paused') {
      throw new EngineError('paused', 'The round is paused');
    }
  }
}

export { DEFAULT_CONFIG };
