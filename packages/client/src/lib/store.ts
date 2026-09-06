/**
 * Client state. One store shared by all three surfaces; each surface only
 * subscribes to the slices it renders.
 *
 * The store is a pure projection of server broadcasts. Nothing here computes
 * capital, ranking or bid validity - it only mirrors what the server said.
 */

import { create } from 'zustand';
import {
  DEFAULT_CONFIG,
  type AuctionView,
  type ClientRole,
  type Envelope,
  type GameConfig,
  type GameState,
  type LeaderboardRow,
  type LiveEvent,
  type PremiumState,
  type PodiumEntry,
  type PremiumPreview,
  type ProjectorMode,
  type QuestionPublic,
  type SequenceEntry,
  type Snapshot,
  type TeamPublic,
  type TeamView,
  type AuditEntry,
} from '@code-market/shared';
import type { ConnectionState } from './socket.js';
import { GameSocket } from './socket.js';
import { sound } from './sound.js';

export interface Toast {
  id: string;
  kind: 'info' | 'gain' | 'loss' | 'premium' | 'warn';
  title: string;
  detail?: string;
  at: number;
}

/** A short-lived banner for a headline moment (outbid, unlock, result). */
export interface Flash {
  id: string;
  kind:
    | 'auction_won'
    | 'outbid'
    | 'premium_unlocked'
    | 'reclaim'
    | 'correct'
    | 'wrong'
    | 'timeout'
    | 'rank_up'
    | 'strategy'
    | 'final_stretch'
    | 'podium';
  title: string;
  subtitle?: string;
  amount?: number;
  at: number;
}

interface StoreState {
  /* connection */
  role: ClientRole;
  token: string | null;
  connection: ConnectionState;
  socket: GameSocket | null;
  serverOffset: number;

  /* world */
  config: GameConfig;
  game: GameState | null;
  teams: TeamPublic[];
  leaderboard: LeaderboardRow[];
  leaderboardHidden: boolean;
  auction: AuctionView | null;
  premium: PremiumState | null;
  premiumPreview: PremiumPreview | null;
  question: QuestionPublic | null;
  podium: PodiumEntry[] | null;
  me: TeamView | null;
  liveEvents: LiveEvent[];
  sequence: SequenceEntry[];
  audit: AuditEntry[];
  projectorMode: ProjectorMode;

  /* ephemeral UI */
  toasts: Toast[];
  flash: Flash | null;
  lastResultAt: number;
  changedTeams: string[];
  ready: boolean;
  error: string | null;
  /** The server rejected our token - the surface must return to its login. */
  authFailed: boolean;

  /* actions */
  connect: (token: string, role: ClientRole, url?: string) => void;
  disconnect: () => void;
  call: (type: string, data: unknown) => Promise<unknown>;
  send: (type: string, data: unknown) => void;
  pushToast: (toast: Omit<Toast, 'id' | 'at'>) => void;
  dismissToast: (id: string) => void;
  showFlash: (flash: Omit<Flash, 'id' | 'at'>) => void;
  clearFlash: () => void;
  setError: (error: string | null) => void;
  serverNow: () => number;
}

let toastCounter = 0;

export const useStore = create<StoreState>((set, get) => ({
  role: 'participant',
  token: null,
  connection: 'idle',
  socket: null,
  serverOffset: 0,

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
  projectorMode: 'auto',

  toasts: [],
  flash: null,
  lastResultAt: 0,
  changedTeams: [],
  ready: false,
  error: null,
  authFailed: false,

  connect(token, role, url) {
    get().socket?.close();
    const socket = new GameSocket({
      token,
      role,
      ...(url ? { url } : {}),
      onState: (connection) => set({ connection }),
      onGap: () => {
        get().pushToast({ kind: 'warn', title: 'Resyncing with the server' });
      },
      onUnauthorized: (message) => {
        set({ authFailed: true, connection: 'closed', ready: false, error: message });
      },
      onFrame: (frame) => applyFrame(frame, set, get),
    });
    set({ socket, token, role, ready: false, authFailed: false, error: null });
    socket.connect();
  },

  disconnect() {
    get().socket?.close();
    set({ socket: null, connection: 'closed', ready: false });
  },

  async call(type, data) {
    const socket = get().socket;
    if (!socket) throw new Error('Not connected');
    const frame = await socket.call(type, data);
    return (frame.d as { data?: unknown })?.data;
  },

  send(type, data) {
    get().socket?.send(type, data);
  },

  pushToast(toast) {
    const id = `t${++toastCounter}`;
    set((state) => ({ toasts: [...state.toasts.slice(-4), { ...toast, id, at: Date.now() }] }));
    setTimeout(() => get().dismissToast(id), 5200);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  showFlash(flash) {
    const id = `f${++toastCounter}`;
    set({ flash: { ...flash, id, at: Date.now() } });
  },

  clearFlash() {
    set({ flash: null });
  },

  setError(error) {
    set({ error });
  },

  serverNow() {
    return get().socket?.serverNow() ?? Date.now();
  },
}));

export type Setter = (partial: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) => void;
export type Getter = () => StoreState;

/* ------------------------------------------------------------------ *
 * Frame reducer
 * ------------------------------------------------------------------ *
 *
 * Exported so the test suite can drive it with real protocol frames without
 * standing up a socket - this is the single place where server truth becomes
 * client state, so it is worth testing directly.
 */

export function applyFrame(frame: Envelope, set: Setter, get: Getter): void {
  const d = frame.d as Record<string, unknown>;
  const state = get();

  switch (frame.t) {
    case 'SNAPSHOT': {
      const snapshot = frame.d as Snapshot;
      set({
        config: snapshot.config,
        game: snapshot.game,
        teams: snapshot.teams,
        leaderboard: snapshot.leaderboard,
        leaderboardHidden: snapshot.leaderboardHidden,
        auction: snapshot.auction,
        premium: snapshot.premium,
        premiumPreview: snapshot.premiumPreview,
        question: snapshot.question,
        podium: snapshot.podium,
        me: snapshot.me,
        liveEvents: snapshot.liveEvents ?? [],
        sequence: snapshot.sequence ?? [],
        ready: true,
        error: null,
      });
      sound.setEnabled(snapshot.config.soundEnabled);
      break;
    }

    case 'ERROR': {
      const error = d as unknown as { code: string; message: string };
      // An unsolicited error is worth surfacing; one that answers a specific
      // request is delivered to that caller instead. An auth failure is handled
      // by the socket's onUnauthorized hook, which returns the user to login.
      if (!frame.rid && error.code !== 'unauthorised') {
        get().pushToast({ kind: 'warn', title: error.message });
      }
      break;
    }

    case 'CONFIG_UPDATED':
      set({ config: d.config as GameConfig });
      break;

    case 'PHASE_CHANGED':
    case 'GAME_STARTED':
    case 'GAME_PAUSED':
    case 'GAME_RESUMED':
    case 'GAME_COMPLETE':
      set({ game: d.game as GameState });
      if (frame.t === 'GAME_COMPLETE') {
        set({
          leaderboard: (d.leaderboard as LeaderboardRow[]) ?? state.leaderboard,
          podium: (d.podium as PodiumEntry[]) ?? null,
          leaderboardHidden: false,
        });
      }
      break;

    case 'GAME_RESET':
      set({
        game: null,
        auction: null,
        premium: null,
        me: null,
        leaderboard: [],
        liveEvents: [],
        sequence: [],
        podium: null,
        question: null,
        premiumPreview: null,
        leaderboardHidden: false,
      });
      get().socket?.resync();
      break;

    case 'TIMER_STARTED':
      set((s) => ({
        game: s.game
          ? {
              ...s.game,
              timer: {
                endsAt: d.endsAt as number,
                duration: d.duration as number,
                label: d.label as string,
              },
            }
          : s.game,
      }));
      break;

    case 'TIMER_STOPPED':
    case 'TIMER_EXPIRED':
      set((s) => ({
        game: s.game ? { ...s.game, timer: { endsAt: null, duration: null, label: null } } : s.game,
      }));
      break;

    case 'TEAMS_REPLACED':
      set({ teams: d.teams as TeamPublic[] });
      break;

    case 'TEAM_UPDATED': {
      const team = d.team as TeamPublic;
      set((s) => ({ teams: s.teams.map((t) => (t.id === team.id ? team : t)) }));
      break;
    }

    case 'LEADERBOARD_UPDATED':
      set({
        leaderboard: d.rows as LeaderboardRow[],
        changedTeams: (d.changed as string[]) ?? [],
      });
      break;

    case 'ME_UPDATED': {
      const me = d.me as TeamView;
      const before = state.me;
      set({ me });
      if (before && me.rank < before.rank && before.rank > 0) {
        sound.play('rank_up');
      }
      if (me.leaderboardHidden !== state.leaderboardHidden) {
        set({ leaderboardHidden: me.leaderboardHidden });
      }
      break;
    }

    case 'QUESTION_INTRO':
    case 'QUESTION_OPENED':
      set({ question: d.question as QuestionPublic, game: d.game as GameState });
      if (frame.t === 'QUESTION_INTRO') sound.play('intro');
      break;

    case 'QUESTION_CLOSED':
      set({ question: null });
      break;

    case 'PREMIUM_INTRO':
      set({ premiumPreview: d.preview as PremiumPreview, game: d.game as GameState });
      sound.play('premium_intro');
      break;

    case 'STRATEGY_STARTED':
      set((s) => ({
        game: s.game
          ? {
              ...s.game,
              timer: {
                endsAt: d.endsAt as number,
                duration: d.duration as number,
                label: 'STRATEGY',
              },
            }
          : s.game,
      }));
      sound.play('strategy');
      get().showFlash({ kind: 'strategy', title: 'STRATEGY PHASE', subtitle: 'PLAN YOUR NEXT MOVE' });
      break;

    case 'STRATEGY_ENDED':
      set((s) => ({
        game: s.game ? { ...s.game, timer: { endsAt: null, duration: null, label: null } } : s.game,
      }));
      break;

    case 'FINAL_STRETCH_STARTED':
      set({ leaderboardHidden: true, leaderboard: [] });
      sound.play('final');
      get().showFlash({
        kind: 'final_stretch',
        title: 'FINAL STRETCH',
        subtitle: 'LEADERBOARD HIDDEN',
      });
      break;

    case 'LEADERBOARD_HIDDEN':
      set({ leaderboardHidden: true });
      break;

    case 'PODIUM_REVEALED':
      set({
        podium: d.podium as PodiumEntry[],
        leaderboard: (d.leaderboard as LeaderboardRow[]) ?? state.leaderboard,
        leaderboardHidden: false,
      });
      sound.play('podium');
      break;

    case 'SEQUENCE_GENERATED':
      get().socket?.resync();
      break;

    case 'QUESTION_UNLOCKED': {
      const payload = d as unknown as { teamId: string; risk: number; questionId: string };
      if (state.role === 'participant' && state.me?.teamId === payload.teamId) {
        sound.play('premium_unlock');
        get().showFlash({
          kind: 'premium_unlocked',
          title: 'PREMIUM UNLOCKED',
          subtitle: 'YOUR RISK',
          amount: payload.risk,
        });
      }
      break;
    }

    case 'QUESTION_RESULT': {
      const result = d as unknown as {
        teamId: string;
        teamName: string;
        result: string;
        delta: number;
        isPremium: boolean;
      };
      set({ lastResultAt: Date.now() });
      if (state.role === 'participant' && state.me?.teamId === result.teamId) {
        if (result.result === 'correct') {
          sound.play('correct');
          get().showFlash({ kind: 'correct', title: 'CORRECT', amount: result.delta });
        } else if (result.result === 'timeout') {
          sound.play('timeout');
          get().showFlash({ kind: 'timeout', title: "TIME'S UP", amount: result.delta });
        } else {
          sound.play('wrong');
          get().showFlash({ kind: 'wrong', title: 'INCORRECT', amount: result.delta });
        }
      } else if (state.role === 'organizer') {
        get().pushToast({
          kind: result.result === 'correct' ? 'gain' : 'loss',
          title: `${result.teamName} - ${result.result.toUpperCase()}`,
          detail: `${result.delta >= 0 ? '+' : ''}${result.delta}`,
        });
      }
      break;
    }

    case 'AUCTION_STARTED':
      set({ auction: d.auction as AuctionView });
      sound.play('auction_start');
      break;

    case 'AUCTION_BID': {
      const payload = d as unknown as { auction: AuctionView; outbidTeamId: string | null };
      set({ auction: payload.auction });
      const myId = state.me?.teamId;
      if (myId && payload.outbidTeamId === myId) {
        sound.play('outbid');
        const leader = payload.auction.auction.currentLeaderTeamId ?? '';
        get().showFlash({
          kind: 'outbid',
          title: `${leader} OUTBID YOU`,
          amount: payload.auction.auction.currentBid ?? 0,
        });
      } else {
        sound.play('bid');
      }
      break;
    }

    case 'AUCTION_BID_UNDONE':
      set({ auction: d.auction as AuctionView });
      break;

    case 'AUCTION_BID_REJECTED': {
      const payload = d as unknown as { teamId: string; message: string };
      if (state.role === 'organizer' || state.me?.teamId === payload.teamId) {
        get().pushToast({ kind: 'warn', title: 'Bid rejected', detail: payload.message });
      }
      break;
    }

    case 'AUCTION_CALL':
      set((s) => ({
        auction: s.auction
          ? { ...s.auction, auction: { ...s.auction.auction, status: d.status as never } }
          : s.auction,
      }));
      break;

    case 'AUCTION_CLOSED':
      set({ auction: d.auction as AuctionView });
      break;

    case 'AUCTION_WON': {
      const payload = d as unknown as { teamId: string; teamName: string; amount: number };
      sound.play('hammer');
      if (state.role === 'participant' && state.me?.teamId === payload.teamId) {
        get().showFlash({ kind: 'auction_won', title: 'YOU WON', amount: payload.amount });
      }
      break;
    }

    case 'AUCTION_CANCELLED':
      set({ auction: null });
      break;

    case 'PREMIUM_UNLOCKED':
    case 'PREMIUM_ATTEMPT_STARTED':
    case 'PREMIUM_ATTEMPT_FAILED':
    case 'PREMIUM_RECLAIM_ACCEPTED':
    case 'PREMIUM_CLOSED':
      set({ premium: d.premium as PremiumState });
      if (frame.t === 'PREMIUM_ATTEMPT_FAILED') sound.play('fail');
      break;

    case 'PREMIUM_RECLAIM_OFFERED': {
      const payload = d as unknown as { premium: PremiumState; teamId: string; risk: number };
      set({ premium: payload.premium });
      sound.play('reclaim');
      if (state.role === 'participant' && state.me?.teamId === payload.teamId) {
        get().showFlash({
          kind: 'reclaim',
          title: 'RECLAIM OFFER',
          subtitle: 'ACCEPT OR DECLINE',
          amount: payload.risk,
        });
      }
      break;
    }

    case 'PREMIUM_RECLAIM_DECLINED':
      set({ premium: d.premium as PremiumState });
      break;

    case 'CAPITAL_CHANGED': {
      const change = d as unknown as { teamId: string; to: number };
      set((s) => ({
        teams: s.teams.map((t) => (t.id === change.teamId ? { ...t, capital: change.to } : t)),
      }));
      break;
    }

    case 'LIVE_EVENTS':
      set({ liveEvents: d.events as LiveEvent[] });
      break;

    case 'LEADERBOARD_REVEALED':
      set({ leaderboard: d.rows as LeaderboardRow[], leaderboardHidden: false });
      break;

    case 'AUDIT_APPENDED':
      set((s) => ({ audit: [...s.audit, ...(d.entries as AuditEntry[])].slice(-800) }));
      break;

    case 'PROJECTOR_MODE':
      set({ projectorMode: d.mode as ProjectorMode });
      break;

    case 'TEAM_CONNECTED':
    case 'TEAM_DISCONNECTED': {
      const teamId = d.teamId as string;
      const online = frame.t === 'TEAM_CONNECTED';
      set((s) => ({
        teams: s.teams.map((t) =>
          t.id === teamId ? { ...t, connectionStatus: online ? 'online' : 'offline' } : t,
        ),
      }));
      break;
    }

    default:
      break;
  }
}
