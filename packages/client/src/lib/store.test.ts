/**
 * The store is a pure projection of server broadcasts. These tests drive the
 * reducer with real protocol frames and assert the resulting client state -
 * no socket, no DOM, no timing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONFIG,
  type Envelope,
  type GameState,
  type LeaderboardRow,
  type Snapshot,
  type TeamView,
} from '@code-market/shared';
import { applyFrame, useStore } from './store.js';

vi.mock('./sound.js', () => ({
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

const set = ((partial: unknown) => useStore.setState(partial as never)) as never;
const get = (() => useStore.getState()) as never;

function feed(t: string, d: unknown, extra: Partial<Envelope> = {}): void {
  applyFrame({ t, d, ts: Date.now(), ...extra } as Envelope, set, get);
}

const game = (over: Partial<GameState> = {}): GameState => ({
  phase: 'idle',
  resumePhase: null,
  slotIndex: 0,
  currentQuestionId: null,
  currentAuctionId: null,
  blockNumber: 0,
  totalBlocks: 4,
  totalSlots: 16,
  finalStretch: false,
  timer: { endsAt: null, duration: null, label: null },
  serverNow: Date.now(),
  startedAt: null,
  completedAt: null,
  ...over,
});

const me = (over: Partial<TeamView> = {}): TeamView => ({
  teamId: 'T01',
  capital: 1000,
  maxBid: 500,
  rank: 3,
  podium: 3,
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

const row = (id: string, capital: number, rank: number): LeaderboardRow => ({
  rank,
  teamId: id,
  name: `Team ${id}`,
  capital,
  startingCapital: 1000,
  delta: capital - 1000,
  podium: rank <= 3 ? rank : null,
  previousRank: null,
  connectionStatus: 'online',
  status: 'active',
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  role: 'participant',
  config: DEFAULT_CONFIG,
  game: game(),
  teams: [],
  leaderboard: [],
  leaderboardHidden: false,
  auction: null,
  premium: null,
  premiumPreview: null,
  question: null,
  podium: null,
  me: null,
  seq: 1,
  serverNow: Date.now(),
  ...over,
});

beforeEach(() => {
  useStore.setState({
    config: DEFAULT_CONFIG,
    game: null,
    teams: [],
    leaderboard: [],
    leaderboardHidden: false,
    auction: null,
    premium: null,
    premiumPreview: null,
    question: null,
    podium: null,
    me: null,
    liveEvents: [],
    sequence: [],
    audit: [],
    toasts: [],
    flash: null,
    ready: false,
    changedTeams: [],
    role: 'participant',
    projectorMode: 'auto',
  });
});

describe('SNAPSHOT', () => {
  it('replaces the whole world and marks the client ready', () => {
    feed('SNAPSHOT', snapshot({
      game: game({ phase: 'question_active', currentQuestionId: 'N01', slotIndex: 1 }),
      leaderboard: [row('T01', 1200, 1)],
      me: me({ capital: 1200 }),
    }));

    const state = useStore.getState();
    expect(state.ready).toBe(true);
    expect(state.game?.phase).toBe('question_active');
    expect(state.leaderboard).toHaveLength(1);
    expect(state.me?.capital).toBe(1200);
  });

  it('a resync snapshot overwrites drifted state (spec 36)', () => {
    feed('SNAPSHOT', snapshot({ me: me({ capital: 1000 }) }));
    feed('SNAPSHOT', snapshot({ me: me({ capital: 2500, rank: 1 }) }));
    expect(useStore.getState().me).toMatchObject({ capital: 2500, rank: 1 });
  });
});

describe('game lifecycle frames', () => {
  it('tracks phase changes', () => {
    feed('PHASE_CHANGED', { game: game({ phase: 'auction_active' }) });
    expect(useStore.getState().game?.phase).toBe('auction_active');
    feed('GAME_PAUSED', { game: game({ phase: 'paused' }) });
    expect(useStore.getState().game?.phase).toBe('paused');
  });

  it('stores the final leaderboard on completion', () => {
    feed('GAME_COMPLETE', {
      game: game({ phase: 'completed' }),
      podium: [{ place: 1, teamId: 'T02', name: 'Team T02', capital: 3000, delta: 2000 }],
      leaderboard: [row('T02', 3000, 1), row('T01', 900, 2)],
    });
    expect(useStore.getState().game?.phase).toBe('completed');
    expect(useStore.getState().leaderboard[0]?.teamId).toBe('T02');
  });

  it('clears the world on reset', () => {
    feed('SNAPSHOT', snapshot({ me: me(), leaderboard: [row('T01', 1000, 1)] }));
    feed('GAME_RESET', {});
    const state = useStore.getState();
    expect(state.game).toBeNull();
    expect(state.me).toBeNull();
    expect(state.leaderboard).toEqual([]);
  });

  it('applies and clears the timer', () => {
    feed('PHASE_CHANGED', { game: game({ phase: 'question_active' }) });
    feed('TIMER_STARTED', { endsAt: 12345, duration: 90, label: 'MARKET' });
    expect(useStore.getState().game?.timer).toMatchObject({ endsAt: 12345, duration: 90 });
    feed('TIMER_EXPIRED', { label: 'MARKET' });
    expect(useStore.getState().game?.timer.endsAt).toBeNull();
  });
});

describe('leaderboard frames', () => {
  it('records which teams changed so rows can be highlighted', () => {
    feed('LEADERBOARD_UPDATED', {
      rows: [row('T02', 2500, 1), row('T01', 1000, 2)],
      changed: ['T02'],
    });
    const state = useStore.getState();
    expect(state.leaderboard[0]?.teamId).toBe('T02');
    expect(state.changedTeams).toEqual(['T02']);
  });

  it('rapid consecutive updates always leave one row per team (spec 43)', () => {
    for (let i = 0; i < 25; i++) {
      feed('LEADERBOARD_UPDATED', {
        rows: [row('T01', 1000 + i * 10, 1), row('T02', 900, 2), row('T03', 800, 3)],
        changed: ['T01'],
      });
    }
    const rows = useStore.getState().leaderboard;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(3);
    expect(rows[0]?.capital).toBe(1240);
  });

  it('applies a capital delta to the team list without a full replace', () => {
    feed('TEAMS_REPLACED', {
      teams: [
        { id: 'T01', name: 'A', capital: 1000, startingCapital: 1000, status: 'active', connectionStatus: 'online', maxBid: 500 },
        { id: 'T02', name: 'B', capital: 1000, startingCapital: 1000, status: 'active', connectionStatus: 'online', maxBid: 500 },
      ],
    });
    feed('CAPITAL_CHANGED', { teamId: 'T02', from: 1000, to: 1700, delta: 700, reason: 'premium', at: Date.now() });
    const teams = useStore.getState().teams;
    expect(teams.find((t) => t.id === 'T02')?.capital).toBe(1700);
    expect(teams.find((t) => t.id === 'T01')?.capital).toBe(1000);
  });

  it('tracks per-team connection changes', () => {
    feed('TEAMS_REPLACED', {
      teams: [
        { id: 'T01', name: 'A', capital: 1000, startingCapital: 1000, status: 'active', connectionStatus: 'online', maxBid: 500 },
      ],
    });
    feed('TEAM_DISCONNECTED', { teamId: 'T01' });
    expect(useStore.getState().teams[0]?.connectionStatus).toBe('offline');
    feed('TEAM_CONNECTED', { teamId: 'T01' });
    expect(useStore.getState().teams[0]?.connectionStatus).toBe('online');
  });
});

describe('auction frames', () => {
  const auctionView = (currentBid: number | null, leader: string | null) => ({
    auction: {
      id: 1,
      questionId: 'P1',
      status: 'open',
      startingBid: 300,
      increment: 100,
      currentBid,
      currentLeaderTeamId: leader,
      winnerTeamId: null,
      winningAmount: null,
      startedAt: 1,
      endedAt: null,
    },
    preview: {
      questionId: 'P1',
      slotIndex: 4,
      blockNumber: 1,
      title: 'Vault',
      domain: 'algorithms',
      difficulty: 'hard',
      timeLimit: 120,
      startingBid: 300,
      increment: 100,
      isFinalPremium: false,
      premiumNumber: 1,
    },
    bidders: leader ? [{ teamId: leader, teamName: leader, amount: currentBid ?? 0, isLeader: true }] : [],
    history: [],
    nextBid: (currentBid ?? 200) + 100,
    ladder: [],
  });

  it('stores the auction view on every bid', () => {
    feed('AUCTION_STARTED', { auction: auctionView(null, null) });
    expect(useStore.getState().auction?.auction.currentBid).toBeNull();

    feed('AUCTION_BID', { auction: auctionView(400, 'T02'), bid: {}, outbidTeamId: 'T01' });
    expect(useStore.getState().auction?.auction.currentBid).toBe(400);
    expect(useStore.getState().auction?.auction.currentLeaderTeamId).toBe('T02');
  });

  it('flashes an outbid warning to the team that lost the lead', () => {
    useStore.setState({ me: me({ teamId: 'T01' }) });
    feed('AUCTION_BID', { auction: auctionView(400, 'T02'), bid: {}, outbidTeamId: 'T01' });
    expect(useStore.getState().flash).toMatchObject({ kind: 'outbid' });
  });

  it('does not flash an outbid to an uninvolved team', () => {
    useStore.setState({ me: me({ teamId: 'T09' }) });
    feed('AUCTION_BID', { auction: auctionView(400, 'T02'), bid: {}, outbidTeamId: 'T01' });
    expect(useStore.getState().flash).toBeNull();
  });

  it('flashes YOU WON only to the winner', () => {
    useStore.setState({ me: me({ teamId: 'T02' }) });
    feed('AUCTION_WON', { teamId: 'T02', teamName: 'B', amount: 700, questionId: 'P1' });
    expect(useStore.getState().flash).toMatchObject({ kind: 'auction_won', amount: 700 });

    useStore.setState({ flash: null, me: me({ teamId: 'T05' }) });
    feed('AUCTION_WON', { teamId: 'T02', teamName: 'B', amount: 700, questionId: 'P1' });
    expect(useStore.getState().flash).toBeNull();
  });

  it('undo restores the previous auction view', () => {
    feed('AUCTION_BID', { auction: auctionView(500, 'T03'), bid: {}, outbidTeamId: null });
    feed('AUCTION_BID_UNDONE', { auction: auctionView(400, 'T02'), removedBidId: 9 });
    expect(useStore.getState().auction?.auction.currentBid).toBe(400);
  });
});

describe('premium frames', () => {
  const premium = (over: Record<string, unknown> = {}) => ({
    questionId: 'P1',
    stage: 'sold',
    auctionId: 1,
    ladder: [],
    activeTeamId: 'T02',
    activeRisk: 700,
    attemptNumber: 0,
    offerTeamId: null,
    offerRisk: null,
    offerDeadline: null,
    failedTeamId: null,
    outcome: null,
    ...over,
  });

  it('flashes PREMIUM UNLOCKED only to the authorised team', () => {
    useStore.setState({ me: me({ teamId: 'T02' }), role: 'participant' });
    feed('QUESTION_UNLOCKED', { questionId: 'P1', teamId: 'T02', risk: 700 });
    expect(useStore.getState().flash).toMatchObject({ kind: 'premium_unlocked', amount: 700 });
  });

  it('flashes the reclaim offer only to the offered team', () => {
    useStore.setState({ me: me({ teamId: 'T12' }), role: 'participant' });
    feed('PREMIUM_RECLAIM_OFFERED', {
      premium: premium({ stage: 'reclaim_offer', offerTeamId: 'T12', offerRisk: 500 }),
      teamId: 'T12',
      risk: 500,
      deadline: Date.now() + 5000,
      failedTeamId: 'T18',
    });
    expect(useStore.getState().flash).toMatchObject({ kind: 'reclaim', amount: 500 });
    expect(useStore.getState().premium?.offerTeamId).toBe('T12');
  });

  it('tracks the premium through to close', () => {
    feed('PREMIUM_ATTEMPT_STARTED', { premium: premium({ stage: 'attempt_1', attemptNumber: 1 }), teamId: 'T02', attemptNumber: 1, risk: 700 });
    expect(useStore.getState().premium?.stage).toBe('attempt_1');
    feed('PREMIUM_CLOSED', { premium: premium({ stage: 'closed', outcome: 'won_first' }) });
    expect(useStore.getState().premium).toMatchObject({ stage: 'closed', outcome: 'won_first' });
  });
});

describe('result frames', () => {
  it('flashes CORRECT with the payout to the team that answered', () => {
    useStore.setState({ me: me({ teamId: 'T01' }), role: 'participant' });
    // Stake model: staked 100, correct pays 200 back (delta = payout credit).
    feed('QUESTION_RESULT', {
      teamId: 'T01',
      teamName: 'A',
      questionId: 'N01',
      slotIndex: 1,
      result: 'correct',
      delta: 200,
      stake: 100,
      newCapital: 1300,
      isPremium: false,
      riskAmount: null,
      at: Date.now(),
    });
    expect(useStore.getState().flash).toMatchObject({ kind: 'correct', amount: 200 });
  });

  it('flashes INCORRECT with the forfeited stake', () => {
    useStore.setState({ me: me({ teamId: 'T01' }), role: 'participant' });
    // Wrong: no result-time credit; the staked 100 (deducted on take) is lost.
    feed('QUESTION_RESULT', {
      teamId: 'T01',
      teamName: 'A',
      questionId: 'N01',
      slotIndex: 1,
      result: 'wrong',
      delta: 0,
      stake: 100,
      newCapital: 900,
      isPremium: false,
      riskAmount: null,
      at: Date.now(),
    });
    expect(useStore.getState().flash).toMatchObject({ kind: 'wrong', amount: -100 });
  });

  it('frames a premium result as WON / LOST THE BID', () => {
    useStore.setState({ me: me({ teamId: 'T01' }), role: 'participant' });
    // Winner staked 700; correct pays 2x = 1400 back (delta = payout credit).
    feed('QUESTION_RESULT', {
      teamId: 'T01',
      teamName: 'A',
      questionId: 'P01',
      slotIndex: 4,
      result: 'correct',
      delta: 1400,
      stake: 700,
      newCapital: 2200,
      isPremium: true,
      riskAmount: 700,
      at: Date.now(),
    });
    expect(useStore.getState().flash).toMatchObject({ kind: 'correct', title: 'WON THE BID', amount: 1400 });

    // Wrong: the staked 700 bid is forfeited, nothing credited.
    feed('QUESTION_RESULT', {
      teamId: 'T01',
      teamName: 'A',
      questionId: 'P01',
      slotIndex: 4,
      result: 'wrong',
      delta: 0,
      stake: 700,
      newCapital: 800,
      isPremium: true,
      riskAmount: 700,
      at: Date.now(),
    });
    expect(useStore.getState().flash).toMatchObject({ kind: 'wrong', title: 'LOST THE BID', amount: -700 });
  });

  it('gives the organizer a toast rather than a full-screen flash', () => {
    useStore.setState({ me: null, role: 'organizer' });
    feed('QUESTION_RESULT', {
      teamId: 'T05',
      teamName: 'CODE NINJAS',
      questionId: 'N01',
      slotIndex: 1,
      result: 'correct',
      delta: 200,
      newCapital: 1200,
      isPremium: false,
      riskAmount: null,
      at: Date.now(),
    });
    expect(useStore.getState().flash).toBeNull();
    expect(useStore.getState().toasts[0]?.title).toContain('CODE NINJAS');
  });

  it('mirrors the leaderboard blackout from the private view', () => {
    useStore.setState({ me: me({ leaderboardHidden: false }), leaderboardHidden: false });
    feed('ME_UPDATED', { me: me({ leaderboardHidden: true, rank: 0 }) });
    expect(useStore.getState().leaderboardHidden).toBe(true);
  });
});

describe('organizer frames', () => {
  it('accumulates audit entries with a cap', () => {
    for (let i = 1; i <= 900; i++) {
      feed('AUDIT_APPENDED', {
        entries: [{ id: i, action: 'X', teamId: null, questionId: null, timestamp: i, metadata: {} }],
      });
    }
    const audit = useStore.getState().audit;
    expect(audit.length).toBeLessThanOrEqual(800);
    expect(audit.at(-1)?.id).toBe(900);
  });

  it('tracks the live events queue', () => {
    feed('LIVE_EVENTS', {
      events: [
        { id: 'a', teamId: 'T01', teamName: 'A', questionId: 'N01', label: 'Market #01', kind: 'submitted', since: 1, needsAttention: true },
      ],
    });
    expect(useStore.getState().liveEvents).toHaveLength(1);
  });

  it('follows a pinned projector mode', () => {
    feed('PROJECTOR_MODE', { mode: 'auction' });
    expect(useStore.getState().projectorMode).toBe('auction');
  });
});

describe('errors', () => {
  it('surfaces an unsolicited error as a toast', () => {
    feed('ERROR', { code: 'paused', message: 'The round is paused' });
    expect(useStore.getState().toasts[0]?.title).toBe('The round is paused');
  });

  it('stays silent for an error that answers a specific request', () => {
    feed('ERROR', { code: 'bad_key', message: 'Incorrect challenge key' }, { rid: 'c1' });
    expect(useStore.getState().toasts).toHaveLength(0);
  });
});
