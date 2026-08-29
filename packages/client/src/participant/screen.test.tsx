/**
 * Screen derivation (spec section 21 / 36).
 *
 * A reconnecting team must land on the correct screen purely from server state.
 * These tests drive the store and assert which screen `useScreen` selects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { DEFAULT_CONFIG, type GameState, type PremiumState, type TeamView } from '@code-market/shared';
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
  phase: 'lobby',
  resumePhase: null,
  currentChallengeId: null,
  currentAuctionId: null,
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
  totalTeams: 12,
  qualified: true,
  challengeState: 'locked',
  premiumUnlocked: false,
  premiumRisk: null,
  lastResult: null,
  reclaimOffer: null,
  inAuction: false,
  myHighestBid: null,
  stats: {
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
  },
  ...over,
});

const premium = (over: Partial<PremiumState> = {}): PremiumState => ({
  challengeId: 'C04',
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
  ...over,
});

const marketChallenge = {
  id: 'C01',
  index: 1,
  title: 'Opening Bell',
  category: 'logic' as const,
  type: 'output' as const,
  difficulty: 'easy' as const,
  marketType: 'market' as const,
  timeLimit: 90,
  revealed: false,
  question: { prompt: '' },
  reward: 200,
  penalty: 100,
};

const premiumChallenge = { ...marketChallenge, id: 'C04', index: 4, marketType: 'premium' as const };

/** Partial store state; `useScreen` only reads game / me / challenge / premium. */
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
    challenge: null,
    premium: null,
    me: null,
    auction: null,
  });
});

describe('useScreen', () => {
  it('waits before the round starts', () => {
    expect(screenFor({ game: null, me: null })).toBe('waiting');
    expect(screenFor({ game: game({ phase: 'lobby' }), me: me() })).toBe('waiting');
  });

  it('shows the market screen when a market challenge is open', () => {
    expect(
      screenFor({
        game: game({ phase: 'market', currentChallengeId: 'C01' }),
        challenge: marketChallenge,
        me: me({ challengeState: 'locked' }),
      }),
    ).toBe('market');
  });

  it('shows the challenge screen once the team has joined', () => {
    expect(
      screenFor({
        game: game({ phase: 'market', currentChallengeId: 'C01' }),
        challenge: marketChallenge,
        me: me({ challengeState: 'in_progress' }),
      }),
    ).toBe('challenge');
  });

  it('shows the result screen after submitting', () => {
    expect(
      screenFor({
        game: game({ phase: 'market', currentChallengeId: 'C01' }),
        challenge: marketChallenge,
        me: me({ challengeState: 'submitted' }),
      }),
    ).toBe('result');
  });

  it('shows the auction screen during a premium auction', () => {
    expect(
      screenFor({
        game: game({ phase: 'auction', currentChallengeId: 'C04', currentAuctionId: 1 }),
        challenge: premiumChallenge,
        premium: premium({ stage: 'auction' }),
        me: me(),
      }),
    ).toBe('auction');
  });

  it('moves the winner to the premium screen the moment the hammer falls', () => {
    expect(
      screenFor({
        game: game({ phase: 'auction', currentChallengeId: 'C04', currentAuctionId: 1 }),
        challenge: premiumChallenge,
        premium: premium({ stage: 'sold', activeTeamId: 'T01', activeRisk: 700 }),
        me: me({ teamId: 'T01', premiumUnlocked: true, premiumRisk: 700 }),
      }),
    ).toBe('premium');
  });

  it('leaves losing bidders on the auction screen', () => {
    expect(
      screenFor({
        game: game({ phase: 'auction', currentChallengeId: 'C04', currentAuctionId: 1 }),
        challenge: premiumChallenge,
        premium: premium({ stage: 'sold', activeTeamId: 'T09', activeRisk: 700 }),
        me: me({ teamId: 'T01' }),
      }),
    ).toBe('auction');
  });

  it('shows the question to the authorised premium attempter only', () => {
    const state = {
      game: game({ phase: 'premium_attempt', currentChallengeId: 'C04' }),
      challenge: { ...premiumChallenge, revealed: true },
      premium: premium({ stage: 'attempt_1', activeTeamId: 'T01', activeRisk: 700, attemptNumber: 1 }),
    };
    expect(screenFor({ ...state, me: me({ teamId: 'T01', challengeState: 'in_progress' }) })).toBe('challenge');
    expect(screenFor({ ...state, me: me({ teamId: 'T05' }) })).toBe('waiting');
  });

  it('a reclaim offer always wins over any other screen', () => {
    expect(
      screenFor({
        game: game({ phase: 'premium_reclaim', currentChallengeId: 'C04' }),
        challenge: premiumChallenge,
        premium: premium({ stage: 'reclaim_offer', offerTeamId: 'T01', offerRisk: 500 }),
        me: me({
          teamId: 'T01',
          reclaimOffer: { challengeId: 'C04', risk: 500, deadline: Date.now() + 5000 },
        }),
      }),
    ).toBe('reclaim');
  });

  it('other teams watch and wait during a reclaim', () => {
    expect(
      screenFor({
        game: game({ phase: 'premium_reclaim', currentChallengeId: 'C04' }),
        challenge: premiumChallenge,
        premium: premium({ stage: 'reclaim_offer', offerTeamId: 'T09', offerRisk: 500 }),
        me: me({ teamId: 'T01' }),
      }),
    ).toBe('waiting');
  });

  it('holds a ceremonial screen before the final auction opens', () => {
    expect(
      screenFor({
        game: game({ phase: 'final', currentChallengeId: 'C12', currentAuctionId: null }),
        challenge: { ...premiumChallenge, id: 'C12', index: 12, marketType: 'final_premium' },
        me: me(),
      }),
    ).toBe('waiting');
  });

  it('shows the final standings when the round completes', () => {
    expect(screenFor({ game: game({ phase: 'complete' }), me: me() })).toBe('final');
  });

  it('shows the result screen while results settle', () => {
    expect(screenFor({ game: game({ phase: 'result' }), me: me() })).toBe('result');
  });

  it('a paused round parks the team on a waiting screen', () => {
    expect(
      screenFor({
        game: game({ phase: 'paused', currentChallengeId: 'C01' }),
        challenge: marketChallenge,
        me: me(),
      }),
    ).toBe('waiting');
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
