/**
 * Screen derivation for the Round 3 state machine.
 *
 * A reconnecting team must land on the correct screen purely from server state,
 * for every phase - including the new intro, strategy and podium beats.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import {
  DEFAULT_CONFIG,
  type GamePhase,
  type GameState,
  type PremiumState,
  type QuestionPublic,
  type TeamView,
} from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { useScreen } from './ParticipantApp.js';
import { surfaceFromPath } from '../App.js';

vi.mock('../lib/sound.js', () => ({
  sound: {
    play: vi.fn(),
    setEnabled: vi.fn(),
    setMuted: vi.fn(),
    isMuted: () => false,
    loadPreference: vi.fn(),
    unlock: vi.fn(),
    setVolume: vi.fn(),
  },
}));

afterEach(cleanup);

const game = (over: Partial<GameState> = {}): GameState => ({
  phase: 'idle',
  resumePhase: null,
  slotIndex: 1,
  currentQuestionId: 'N01',
  currentAuctionId: null,
  blockNumber: 1,
  totalBlocks: 4,
  totalSlots: 16,
  finalStretch: false,
  timer: { endsAt: null, duration: null, label: null },
  serverNow: Date.now(),
  startedAt: 1,
  completedAt: null,
  ...over,
});

const me = (over: Partial<TeamView> = {}): TeamView => ({
  teamId: 'T01',
  capital: 1000,
  maxBid: 500,
  rank: 1,
  podium: 1,
  totalTeams: 12,
  leaderboardHidden: false,
  questionState: 'locked',
  questionDeadline: null,
  premiumUnlocked: false,
  premiumRisk: null,
  canDecidePremium: false,
  premiumDecisionDeadline: null,
  premiumDecision: null,
  lastResult: null,
  reclaimOffer: null,
  inAuction: false,
  myHighestBid: null,
  stats: {
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
  },
  ...over,
});

const premium = (over: Partial<PremiumState> = {}): PremiumState => ({
  questionId: 'P1',
  slotIndex: 4,
  stage: 'auction',
  auctionId: 1,
  ladder: [],
  activeTeamId: null,
  activeRisk: null,
  attemptNumber: 0,
  offerTeamId: null,
  offerRisk: null,
  offerDeadline: null,
  failedTeamId: null,
  outcome: null,
  windowEndsAt: null,
  decisionDeadline: null,
  decisions: {},
  ...over,
});

const question: QuestionPublic = {
  id: 'N01',
  kind: 'normal',
  title: 'Slice of Life',
  domain: 'output_prediction',
  type: 'output',
  difficulty: 'easy',
  timeLimit: 60,
  slotIndex: 1,
  blockNumber: 1,
  positionInBlock: 1,
  revealed: false,
  question: { prompt: '' },
  reward: 200,
  penalty: 100,
};

type PartialState = Record<string, unknown>;

function screenFor(state: PartialState): string {
  act(() => {
    useStore.setState(state as never);
  });
  return renderHook(() => useScreen()).result.current;
}

beforeEach(() => {
  useStore.setState({
    config: DEFAULT_CONFIG,
    game: null,
    question: null,
    premium: null,
    premiumPreview: null,
    me: null,
    auction: null,
    leaderboardHidden: false,
  });
});

describe('useScreen', () => {
  it('waits before the round starts', () => {
    expect(screenFor({ game: null, me: null })).toBe('waiting');
    expect(screenFor({ game: game({ phase: 'idle' }), me: me() })).toBe('waiting');
  });

  it('shows the intro card during question_intro', () => {
    expect(
      screenFor({ game: game({ phase: 'question_intro' }), question, me: me() }),
    ).toBe('question_intro');
  });

  it('shows the decision screen once the question opens', () => {
    expect(
      screenFor({
        game: game({ phase: 'question_active' }),
        question,
        me: me({ questionState: 'locked' }),
      }),
    ).toBe('question');
  });

  it('shows the solving screen once the team has joined', () => {
    expect(
      screenFor({
        game: game({ phase: 'question_active' }),
        question,
        me: me({ questionState: 'in_progress' }),
      }),
    ).toBe('solving');
  });

  it('shows the result after submitting or skipping', () => {
    const base = { game: game({ phase: 'question_active' }), question };
    expect(screenFor({ ...base, me: me({ questionState: 'submitted' }) })).toBe('result');
    expect(screenFor({ ...base, me: me({ questionState: 'skipped' }) })).toBe('result');
    expect(
      screenFor({ game: game({ phase: 'question_result' }), question, me: me() }),
    ).toBe('result');
  });

  it('shows the premium preview during premium_intro', () => {
    expect(
      screenFor({ game: game({ phase: 'premium_intro' }), premium: premium(), me: me() }),
    ).toBe('premium_intro');
  });

  it('shows the auction while bidding is open', () => {
    expect(
      screenFor({
        game: game({ phase: 'auction_active', currentAuctionId: 1 }),
        premium: premium({ stage: 'auction' }),
        me: me(),
      }),
    ).toBe('auction');
  });

  it('moves the winner to the premium screen the moment the hammer falls', () => {
    expect(
      screenFor({
        game: game({ phase: 'premium_authorized' }),
        premium: premium({ stage: 'sold', activeTeamId: 'T01', activeRisk: 700 }),
        me: me({ teamId: 'T01', premiumUnlocked: true, premiumRisk: 700 }),
      }),
    ).toBe('premium');
  });

  it('leaves losing bidders on the auction screen', () => {
    expect(
      screenFor({
        game: game({ phase: 'premium_authorized' }),
        premium: premium({ stage: 'sold', activeTeamId: 'T09' }),
        me: me({ teamId: 'T01' }),
      }),
    ).toBe('auction');
  });

  it('shows the question to the authorised premium attempter only', () => {
    const state = {
      game: game({ phase: 'premium_solving' }),
      question: { ...question, id: 'P1', kind: 'premium' as const, revealed: true },
      premium: premium({ stage: 'attempt_1', activeTeamId: 'T01', attemptNumber: 1 }),
    };
    expect(screenFor({ ...state, me: me({ teamId: 'T01', questionState: 'in_progress' }) })).toBe(
      'solving',
    );
    expect(screenFor({ ...state, me: me({ teamId: 'T05' }) })).toBe('waiting');
  });

  it('a reclaim offer always wins over any other screen', () => {
    expect(
      screenFor({
        game: game({ phase: 'question_active' }),
        question,
        premium: premium({ stage: 'reclaim_offer', offerTeamId: 'T01', offerRisk: 500 }),
        me: me({
          teamId: 'T01',
          reclaimOffer: { questionId: 'P1', risk: 500, deadline: Date.now() + 5000 },
        }),
      }),
    ).toBe('reclaim');
  });

  it('other teams watch and wait during a reclaim', () => {
    expect(
      screenFor({
        game: game({ phase: 'reclaim' }),
        premium: premium({ stage: 'reclaim_offer', offerTeamId: 'T09' }),
        me: me({ teamId: 'T01' }),
      }),
    ).toBe('waiting');
  });

  it('shows the take/sit-out screen to the winner during premium_decision', () => {
    expect(
      screenFor({
        game: game({ phase: 'premium_decision' }),
        premium: premium({ stage: 'decision', activeTeamId: 'T01' }),
        me: me({ teamId: 'T01', canDecidePremium: true }),
      }),
    ).toBe('premium_decision');
  });

  it('makes non-winners wait during premium_decision', () => {
    expect(
      screenFor({
        game: game({ phase: 'premium_decision' }),
        premium: premium({ stage: 'decision', activeTeamId: 'T01' }),
        me: me({ teamId: 'T05', canDecidePremium: false }),
      }),
    ).toBe('waiting');
  });

  it('shows the strategy phase between blocks', () => {
    expect(screenFor({ game: game({ phase: 'strategy_phase' }), me: me() })).toBe('strategy');
  });

  it('shows the final screen once the round completes', () => {
    expect(screenFor({ game: game({ phase: 'final_results' }), me: me() })).toBe('final');
    expect(screenFor({ game: game({ phase: 'completed' }), me: me() })).toBe('final');
  });

  it('a paused round parks the team on a waiting screen', () => {
    expect(screenFor({ game: game({ phase: 'paused' }), question, me: me() })).toBe('waiting');
  });

  it('covers every phase without falling through to an unhandled state', () => {
    const phases: GamePhase[] = [
      'idle',
      'question_intro',
      'question_active',
      'question_result',
      'premium_intro',
      'auction_active',
      'premium_authorized',
      'premium_solving',
      'premium_result',
      'reclaim',
      'strategy_phase',
      'final_results',
      'completed',
      'paused',
    ];
    for (const phase of phases) {
      const screen = screenFor({ game: game({ phase }), question, premium: premium(), me: me() });
      expect(screen, `phase ${phase}`).toBeTruthy();
    }
  });
});

describe('surface routing', () => {
  it('maps paths to the three surfaces', () => {
    expect(surfaceFromPath('/')).toBe('participant');
    expect(surfaceFromPath('')).toBe('participant');
    expect(surfaceFromPath('/organizer')).toBe('organizer');
    expect(surfaceFromPath('/organizer/')).toBe('organizer');
    expect(surfaceFromPath('/ORGANIZER')).toBe('organizer');
    expect(surfaceFromPath('/projector')).toBe('projector');
    expect(surfaceFromPath('/projector/anything')).toBe('projector');
    expect(surfaceFromPath('/something-else')).toBe('participant');
  });
});
