/**
 * Simulation / demo mode.
 *
 * Exists to make the ANIMATIONS and the new block structure testable without
 * twenty volunteers: it can seed teams, play a whole block, drive a full
 * premium auction with outbids, force a reclaim chain, run the strategy phase,
 * and fire rapid capital changes that produce genuine rank swaps.
 *
 * Everything drives the real engine through the real code paths, so a simulated
 * round is indistinguishable from a played one (each run is tagged `sim: true`).
 */

import { mulberry32, padTeamNumber, pick, maxBid } from '@code-market/shared';
import type { Question, SubmissionValue } from '@code-market/shared';
import type { GameEngine } from './engine.js';
import { EngineError } from './engine.js';

const TEAM_NAMES = [
  'CODEFORCE', 'ALGO KINGS', 'BYTE SQUAD', 'DEBUGGERS', 'CODE NINJAS',
  'NULL POINTERS', 'STACK OVERFLOW', 'SEGFAULT', 'BIG O', 'RECURSION',
  'HEAP HEROES', 'BINARY BOSS', 'KERNEL PANIC', 'MERGE CONFLICT', 'RUNTIME ERROR',
  'CACHE MISS', 'DEADLOCK', 'QUANTUM BITS', 'LOGIC GATES', 'THE COMPILERS',
  'SYNTAX ERROR', 'INFINITE LOOP', 'RACE CONDITION', 'TAIL CALL', 'HASH MAP',
  'GRAPH THEORY', 'DYNAMIC PROG', 'GREEDY WOLVES', 'BACKTRACK', 'PRIME MOVERS',
  'BITWISE', 'PIVOT POINT', 'RED BLACK', 'TRIE HARDER', 'SUDO MAKE',
  'FORK BOMB', 'MUTEX', 'SEMAPHORE', 'PACKET LOSS', 'BUFFER ZONE',
];

export type Scenario =
  | 'question'
  | 'block'
  | 'premium_auction'
  | 'reclaim_chain'
  | 'strategy'
  | 'rank_swap'
  | 'chaos'
  | 'full_round';

export interface SimulationResult {
  scenario: string;
  actions: number;
  notes: string[];
}

export class Simulator {
  private running = false;
  private cancelled = false;
  private rand = mulberry32(20260828);

  constructor(private readonly engine: GameEngine) {}

  get isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.cancelled = true;
    this.running = false;
  }

  seedTeams(count: number, replace: boolean): { created: number } {
    const n = Math.max(1, Math.min(60, Math.floor(count)));
    if (replace) this.engine.resetGame(false);

    const existing = this.engine.getRepo().listTeams().length;
    const specs = Array.from({ length: n }, (_, i) => ({
      id: padTeamNumber(existing + i + 1),
      name: TEAM_NAMES[(existing + i) % TEAM_NAMES.length] ?? `TEAM ${existing + i + 1}`,
      seatLabel: `Row ${Math.floor((existing + i) / 5) + 1}`,
      volunteer: `Vol ${((existing + i) % 8) + 1}`,
    }));
    this.engine.createTeams(specs);
    this.engine.audit('SIM_SEED_TEAMS', { metadata: { count: n, replace, sim: true } });
    return { created: n };
  }

  async run(scenario: string, intensity = 1): Promise<SimulationResult> {
    if (this.running) throw new EngineError('sim_running', 'A simulation is already running');
    this.running = true;
    this.cancelled = false;
    const notes: string[] = [];
    let actions = 0;

    try {
      switch (scenario as Scenario) {
        case 'question':
          actions = await this.simulateQuestion(notes);
          break;
        case 'block':
          actions = await this.simulateBlock(notes);
          break;
        case 'premium_auction':
          actions = await this.simulatePremium(notes, false);
          break;
        case 'reclaim_chain':
          actions = await this.simulatePremium(notes, true);
          break;
        case 'strategy':
          actions = await this.simulateStrategy(notes);
          break;
        case 'rank_swap':
          actions = await this.simulateRankSwap(notes, intensity);
          break;
        case 'chaos':
          actions = await this.simulateChaos(notes, intensity);
          break;
        case 'full_round':
          actions = await this.simulateFullRound(notes);
          break;
        default:
          throw new EngineError('unknown_scenario', `Unknown scenario ${scenario}`);
      }
    } finally {
      this.running = false;
    }

    this.engine.audit('SIM_RUN', { metadata: { scenario, actions, sim: true } });
    return { scenario, actions, notes };
  }

  /* --- scenarios ----------------------------------------------------- */

  /** Every team answers the currently open normal question. */
  private async simulateQuestion(notes: string[]): Promise<number> {
    const slot = this.engine.currentSlot();
    if (!slot || slot.kind !== 'normal') {
      throw new EngineError('no_question', 'Open a normal question first');
    }
    if (this.engine.gameState().phase === 'question_intro') this.safe(() => this.engine.openQuestion());

    const question = this.engine.getRepo().getQuestion(slot.questionId) as Question;
    const teams = this.engine.getRepo().listTeams();
    let actions = 0;

    for (const team of teams) {
      if (this.cancelled) break;
      if (this.rand() < 0.1) {
        this.safe(() => this.engine.skipQuestion(team.id, question.id));
        actions++;
        continue;
      }
      this.safe(() => {
        this.engine.unlockQuestion(team.id, question.id, question.accessKey);
        this.engine.joinQuestion(team.id, question.id);
      });
      const correct = this.rand() < 0.6;
      await this.safeAsync(() =>
        this.engine.submitAnswer(team.id, question.id, this.answerFor(question, correct)),
      );
      actions++;
      await this.tick(20);
    }
    notes.push(`${actions} responses for ${question.id} (${question.difficulty}, ${question.domain})`);
    return actions;
  }

  /** Play a whole block: three normal questions, then the premium. */
  private async simulateBlock(notes: string[]): Promise<number> {
    let actions = 0;
    for (let i = 0; i < 8 && !this.cancelled; i++) {
      const slot = this.engine.currentSlot();
      if (!slot) {
        this.safe(() => this.engine.advance());
        continue;
      }
      if (slot.kind === 'premium') {
        actions += await this.simulatePremium(notes, this.rand() < 0.4);
        this.safe(() => this.engine.closePremium());
        break;
      }
      actions += await this.simulateQuestion(notes);
      this.safe(() => this.engine.closeQuestion());
      this.safe(() => this.engine.advance());
      await this.tick(150);
    }
    notes.push('Block complete');
    return actions;
  }

  /** A believable ascending auction with several bidders and outbids. */
  private async simulatePremium(notes: string[], forceReclaim: boolean): Promise<number> {
    const slot = this.engine.currentSlot();
    if (!slot || slot.kind !== 'premium') {
      throw new EngineError('no_premium', 'Open a premium first');
    }

    let view = this.engine.currentAuctionView();
    if (!view || view.auction.status === 'closed') view = this.engine.startAuction();
    notes.push(`Auction open on ${slot.questionId} at ${view.auction.startingBid}`);

    const opening = view.auction.startingBid;
    const contenders = this.engine
      .getRepo()
      .listTeams()
      .filter((t) => maxBid(t.capital, t.protectedReserve) >= opening)
      .sort(() => this.rand() - 0.5)
      .slice(0, Math.max(2, Math.min(6, Math.floor(this.rand() * 5) + 2)));

    if (contenders.length < 2) throw new EngineError('too_few', 'Not enough solvent teams to bid');

    let actions = 0;
    let rounds = 0;

    while (rounds < 12 && !this.cancelled) {
      const current = this.engine.currentAuctionView();
      if (!current) break;
      const bidder = pick(
        contenders.filter((t) => t.id !== current.auction.currentLeaderTeamId),
        this.rand,
      );
      if (!bidder) break;
      const fresh = this.engine.getRepo().getTeam(bidder.id);
      if (!fresh) break;
      if (maxBid(fresh.capital, fresh.protectedReserve) < current.nextBid) {
        rounds++;
        continue;
      }
      if (this.engine.placeBid(bidder.id).accepted) actions++;
      rounds++;
      await this.tick(120);
      if (this.rand() < 0.18 + rounds * 0.05) break;
    }

    this.engine.callAuction('once');
    await this.tick(150);
    this.engine.callAuction('twice');
    await this.tick(150);
    const closed = this.engine.closeAuction();
    actions++;
    notes.push(
      closed.auction.winnerTeamId
        ? `SOLD to ${closed.auction.winnerTeamId} at ${closed.auction.winningAmount}`
        : 'Auction closed unsold',
    );
    if (!closed.auction.winnerTeamId) return actions;

    await this.tick(400);
    this.engine.startPremiumAttempt();
    actions++;

    const question = this.engine.getRepo().getQuestion(slot.questionId) as Question;
    const attempter = this.engine.currentPremium()?.activeTeamId;
    if (!attempter) return actions;

    const shouldFail = forceReclaim || this.rand() < 0.45;
    await this.safeAsync(() =>
      this.engine.submitAnswer(attempter, question.id, this.answerFor(question, !shouldFail)),
    );
    actions++;
    notes.push(`${attempter} attempt 1 ${shouldFail ? 'FAILED' : 'CORRECT'}`);
    if (!shouldFail) return actions;

    let guard = 0;
    while (guard++ < 6 && !this.cancelled) {
      const state = this.engine.currentPremium();
      if (!state || state.stage !== 'reclaim_offer' || !state.offerTeamId) break;
      const offered = state.offerTeamId;
      await this.tick(700);
      const accept = guard > 1 || this.rand() < 0.5;
      this.safe(() => this.engine.resolveReclaim(offered, accept));
      actions++;
      notes.push(`${offered} ${accept ? 'ACCEPTED' : 'DECLINED'} the reclaim`);
      if (accept) {
        await this.tick(400);
        this.safe(() => this.engine.startPremiumAttempt());
        const active = this.engine.currentPremium()?.activeTeamId;
        if (active) {
          const ok = this.rand() < 0.55;
          await this.safeAsync(() =>
            this.engine.submitAnswer(active, question.id, this.answerFor(question, ok)),
          );
          notes.push(`${active} attempt 2 ${ok ? 'CORRECT' : 'FAILED'}`);
          actions++;
        }
        break;
      }
    }
    return actions;
  }

  /** Show the 40-second strategy phase on the projector. */
  private async simulateStrategy(notes: string[]): Promise<number> {
    this.engine.startStrategyPhase();
    notes.push(`Strategy phase running for ${this.engine.getConfig().strategyWindowSeconds}s`);
    return 1;
  }

  /**
   * The animation torture test: pushes a low-ranked team all the way up so the
   * projector must physically move rows.
   */
  private async simulateRankSwap(notes: string[], intensity: number): Promise<number> {
    const rows = this.engine.leaderboard();
    if (rows.length < 4) throw new EngineError('too_few', 'Seed at least 4 teams first');

    const target = rows[rows.length - 1];
    const leader = rows[0];
    if (!target || !leader) return 0;

    const steps = Math.max(4, Math.min(12, Math.round(4 * Math.max(1, intensity))));
    const step = Math.ceil((leader.capital - target.capital + 150) / steps);

    let actions = 0;
    for (let i = 0; i < steps && !this.cancelled; i++) {
      this.engine.adjustCapital(target.teamId, step, `Simulated surge ${i + 1}/${steps}`);
      actions++;
      await this.tick(420);
    }
    notes.push(`${target.teamId} climbed from rank ${target.rank} to rank 1 in ${steps} steps`);
    return actions;
  }

  /** Rapid, overlapping capital changes to stress-test layout animation. */
  private async simulateChaos(notes: string[], intensity: number): Promise<number> {
    const teams = this.engine.getRepo().listTeams();
    if (teams.length === 0) throw new EngineError('no_teams', 'Seed teams first');

    const bursts = Math.max(10, Math.min(120, Math.round(24 * Math.max(1, intensity))));
    let actions = 0;

    for (let i = 0; i < bursts && !this.cancelled; i++) {
      const team = pick(teams, this.rand);
      const magnitude = Math.round((this.rand() * 400 + 100) / 50) * 50;
      this.engine.adjustCapital(team.id, magnitude * (this.rand() < 0.58 ? 1 : -1), 'Chaos mode');
      actions++;
      await this.tick(this.rand() < 0.3 ? 40 : 180);
    }
    notes.push(`${actions} rapid capital changes fired`);
    return actions;
  }

  /** End-to-end dry run of the whole generated sequence. */
  private async simulateFullRound(notes: string[]): Promise<number> {
    let actions = 0;
    this.safe(() => this.engine.startGame());

    const total = this.engine.sequence().length;
    let handled = 0;

    for (let i = 0; i < total * 2 && !this.cancelled; i++) {
      // The strategy phase advances by itself, so only advance when the
      // current slot has already been played. Re-entering a settled slot would
      // try to re-auction a premium that is already closed.
      if (this.engine.gameState().slotIndex === handled) {
        this.safe(() => this.engine.advance());
      }
      if (this.engine.gameState().phase === 'final_results') break;

      const slot = this.engine.currentSlot();
      if (!slot || slot.index === handled) break;
      handled = slot.index;
      actions++;

      if (slot.kind === 'premium') {
        actions += await this.simulatePremium(notes, this.rand() < 0.4);
        this.safe(() => this.engine.closePremium());
        // Every premium is followed by the strategy phase (spec section 10),
        // which advances into the next block when it ends.
        this.safe(() => this.engine.startStrategyPhase());
        this.safe(() => this.engine.fireTimer('strategy'));
        const after = this.engine.currentSlot();
        if (after) handled = after.index - 1;
      } else {
        actions += await this.simulateQuestion(notes);
        this.safe(() => this.engine.closeQuestion());
      }
      await this.tick(120);
    }

    this.safe(() => this.engine.completeGame());
    notes.push(`Full round simulated across ${total} slots`);
    return actions;
  }

  /* --- helpers --------------------------------------------------------- */

  /** Build a submission that is deliberately correct or deliberately wrong. */
  private answerFor(question: Question, correct: boolean): SubmissionValue {
    const e = question.evaluation;

    switch (question.type) {
      case 'mcq': {
        const right = e.correctOptionIds?.[0] ?? 'a';
        const options = question.question.options ?? [];
        const wrong = options.find((o) => o.id !== right)?.id ?? 'zz';
        return { kind: 'choice', optionIds: [correct ? right : wrong] };
      }
      case 'multi': {
        const right = e.correctOptionIds ?? [];
        return {
          kind: 'choice',
          optionIds: correct ? right : right.slice(0, Math.max(0, right.length - 1)),
        };
      }
      case 'true_false':
        return { kind: 'boolean', value: correct ? Boolean(e.correctBoolean) : !e.correctBoolean };
      case 'numeric':
        return {
          kind: 'number',
          value: correct ? (e.correctNumber ?? 0) : (e.correctNumber ?? 0) + 7,
        };
      case 'ordering': {
        const order = e.correctOrder ?? [];
        return { kind: 'order', itemIds: correct ? order : [...order].reverse() };
      }
      case 'matching': {
        const pairs = e.correctPairs ?? {};
        if (correct) return { kind: 'pairs', pairs };
        const keys = Object.keys(pairs);
        const values = Object.values(pairs);
        const swapped: Record<string, string> = {};
        keys.forEach((key, index) => {
          swapped[key] = values[(index + 1) % values.length] ?? '';
        });
        return { kind: 'pairs', pairs: swapped };
      }
      case 'code':
        return {
          kind: 'code',
          language: 'python',
          source: correct ? 'print(sum(range(int(input())+1)))' : 'print(0)',
        };
      default:
        return { kind: 'text', value: correct ? (e.acceptedAnswers?.[0] ?? '') : '__wrong__' };
    }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* simulation is best-effort; a rejected action is itself realistic */
    }
  }

  private async safeAsync(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch {
      /* see safe() */
    }
  }

  private tick(ms: number): Promise<void> {
    if (this.cancelled) return Promise.resolve();
    return new Promise((resolve) => {
      const handle = setTimeout(resolve, ms);
      if (typeof handle.unref === 'function') handle.unref();
    });
  }
}
