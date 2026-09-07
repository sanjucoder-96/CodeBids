/**
 * WebSocket hub (spec sections 20, 36, 39).
 *
 * Responsibilities:
 *  - authenticate the socket via HELLO before anything else,
 *  - route engine events to the right AUDIENCE (never send a participant the
 *    organizer's view, never leak an answer),
 *  - stamp a monotonic sequence number so a client can detect a gap and ask for
 *    a resync instead of silently drifting,
 *  - coalesce leaderboard bursts so 50 laptops are not flooded during a chaos
 *    run, while still guaranteeing the final state is delivered.
 */

import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import {
  CLIENT_COMMANDS,
  type ClientRole,
  type Envelope,
  type ServerPayloads,
} from '@code-market/shared';
import type { AuthService } from '../auth.js';
import { EngineError, type Audience, type EngineEvent, type GameEngine } from '../core/engine.js';
import type { Simulator } from '../core/simulation.js';

interface Client {
  socket: WebSocket;
  role: ClientRole;
  teamId: string | null;
  alive: boolean;
  id: number;
}

const LEADERBOARD_COALESCE_MS = 80;

export class Hub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, Client>();
  private seq = 0;
  private clientCounter = 0;
  /** Set by close(): stops late socket events from touching a closed engine. */
  private closing = false;
  private pendingLeaderboard = new Map<string, EngineEvent>();
  private leaderboardTimer: NodeJS.Timeout | null = null;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    server: Server,
    private readonly engine: GameEngine,
    private readonly auth: AuthService,
    private readonly simulator: Simulator,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (socket) => this.onConnection(socket));
    engine.on((event) => this.onEngineEvent(event));

    this.heartbeat = setInterval(() => {
      for (const client of this.clients.values()) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        try {
          client.socket.ping();
        } catch {
          /* socket already gone */
        }
      }
    }, 15_000);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  close(): void {
    this.closing = true;
    clearInterval(this.heartbeat);
    if (this.leaderboardTimer) clearTimeout(this.leaderboardTimer);
    for (const client of this.clients.values()) {
      try {
        client.socket.close();
      } catch {
        /* ignore */
      }
    }
    this.wss.close();
  }

  /* --- connection lifecycle ------------------------------------------ */

  private onConnection(socket: WebSocket): void {
    const client: Client = {
      socket,
      role: 'projector',
      teamId: null,
      alive: true,
      id: ++this.clientCounter,
    };
    // Not registered until HELLO succeeds - an unauthenticated socket receives
    // nothing at all.
    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw) => {
      let frame: Envelope;
      try {
        frame = JSON.parse(String(raw)) as Envelope;
      } catch {
        this.sendError(socket, 'bad_frame', 'Malformed frame');
        return;
      }
      void this.handle(socket, client, frame);
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      // During shutdown the database may already be closed; a disconnect at
      // that point is meaningless and must not crash the process.
      if (this.closing) return;
      if (client.teamId && !this.hasTeamSocket(client.teamId)) {
        this.engine.setConnection(client.teamId, 'offline');
      }
    });

    socket.on('error', () => {
      this.clients.delete(socket);
    });
  }

  private hasTeamSocket(teamId: string): boolean {
    for (const client of this.clients.values()) {
      if (client.teamId === teamId) return true;
    }
    return false;
  }

  /* --- inbound commands ------------------------------------------------ */

  private async handle(socket: WebSocket, client: Client, frame: Envelope): Promise<void> {
    const data = (frame.d ?? {}) as Record<string, unknown>;

    if (frame.t === CLIENT_COMMANDS.HELLO) {
      const identity = this.auth.verify(String(data.token ?? ''));
      if (!identity) {
        this.sendError(socket, 'unauthorised', 'Invalid or expired session token', frame.rid);
        socket.close();
        return;
      }
      client.role = identity.role;
      client.teamId = identity.teamId;
      this.clients.set(socket, client);
      if (identity.role === 'participant' && identity.teamId) {
        this.engine.setConnection(identity.teamId, 'online');
      }
      this.sendSnapshot(client, frame.rid);
      return;
    }

    if (!this.clients.has(socket)) {
      this.sendError(socket, 'unauthorised', 'Send HELLO first', frame.rid);
      return;
    }

    if (frame.t === CLIENT_COMMANDS.PING) {
      this.send(socket, {
        t: 'PONG',
        d: { clientTime: Number(data.clientTime ?? 0) },
        ts: Date.now(),
        ...(frame.rid ? { rid: frame.rid } : {}),
      });
      return;
    }

    if (frame.t === CLIENT_COMMANDS.REQUEST_CURRENT_STATE) {
      this.sendSnapshot(client, frame.rid);
      return;
    }

    try {
      const result = client.role === 'organizer'
        ? await this.handleOrganizer(frame.t, data)
        : await this.handleParticipant(client, frame.t, data);
      this.send(socket, {
        t: 'ACK',
        d: { ok: true, ...(frame.rid ? { rid: frame.rid } : {}), ...(result !== undefined ? { data: result } : {}) },
        ts: Date.now(),
        ...(frame.rid ? { rid: frame.rid } : {}),
      });
    } catch (error) {
      const code = error instanceof EngineError ? error.code : 'error';
      const message = error instanceof Error ? error.message : 'Unexpected error';
      this.sendError(socket, code, message, frame.rid);
    }
  }

  private async handleParticipant(
    client: Client,
    type: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    if (client.role !== 'participant' || !client.teamId) {
      throw new EngineError('forbidden', 'This action requires a team session');
    }
    const teamId = client.teamId;

    switch (type) {
      case CLIENT_COMMANDS.UNLOCK_QUESTION:
        this.engine.unlockQuestion(teamId, String(data.questionId), String(data.accessKey ?? ''));
        return undefined;
      case CLIENT_COMMANDS.JOIN_QUESTION:
        this.engine.joinQuestion(teamId, String(data.questionId));
        return undefined;
      case CLIENT_COMMANDS.SKIP_QUESTION:
        this.engine.skipQuestion(teamId, String(data.questionId));
        return undefined;
      case CLIENT_COMMANDS.SUBMIT_ANSWER:
        return await this.engine.submitAnswer(
          teamId,
          String(data.questionId),
          data.submission as never,
        );
      case CLIENT_COMMANDS.RECLAIM_RESPONSE:
        this.engine.resolveReclaim(teamId, Boolean(data.accept));
        return undefined;
      case CLIENT_COMMANDS.PREMIUM_DECISION:
        // TAKE / SIT-OUT for the premium winner (spec sections 6, 7). The
        // session's team is authoritative; a forged teamId is ignored.
        this.engine.submitPremiumDecision(teamId, Boolean(data.take));
        return undefined;
      case CLIENT_COMMANDS.PLACE_BID:
        // A team bids as ITSELF: the session's teamId is authoritative and a
        // client-supplied teamId is ignored, so one team can never bid for
        // another. The organizer keeps its own PLACE_BID as a fallback for a
        // team whose laptop has died.
        return this.engine.placeBid(
          teamId,
          data.amount === undefined ? undefined : Number(data.amount),
        );
      default:
        throw new EngineError('unknown_command', `Unknown command ${type}`);
    }
  }

  private async handleOrganizer(type: string, data: Record<string, unknown>): Promise<unknown> {
    const engine = this.engine;
    switch (type) {
      /* game */
      case CLIENT_COMMANDS.START_GAME:
        engine.startGame();
        return undefined;
      case CLIENT_COMMANDS.PAUSE_GAME:
        engine.pauseGame();
        return undefined;
      case CLIENT_COMMANDS.RESUME_GAME:
        engine.resumeGame();
        return undefined;
      case CLIENT_COMMANDS.COMPLETE_GAME:
        return engine.completeGame();
      case CLIENT_COMMANDS.ADVANCE:
        return engine.advance();
      case CLIENT_COMMANDS.OPEN_SLOT:
        return engine.openSlot(Number(data.slotIndex));
      case CLIENT_COMMANDS.OPEN_QUESTION:
        return engine.openQuestion();
      case CLIENT_COMMANDS.CLOSE_QUESTION:
        return engine.closeQuestion();
      case CLIENT_COMMANDS.START_STRATEGY:
        return engine.startStrategyPhase();
      case CLIENT_COMMANDS.SKIP_STRATEGY:
        engine.endStrategyPhase();
        return undefined;
      case CLIENT_COMMANDS.REVEAL_PODIUM:
        return engine.revealPodium();
      case CLIENT_COMMANDS.RESET_GAME:
        this.simulator.stop();
        engine.resetGame(Boolean(data.keepTeams));
        return undefined;
      case CLIENT_COMMANDS.START_TIMER:
        engine.startTimer(Number(data.seconds), String(data.label ?? 'TIMER'));
        return undefined;
      case CLIENT_COMMANDS.STOP_TIMER:
        engine.stopTimer();
        return undefined;

      /* auction */
      case CLIENT_COMMANDS.START_AUCTION:
        return engine.startAuction(
          data.startingBid === undefined ? undefined : Number(data.startingBid),
          data.increment === undefined ? undefined : Number(data.increment),
        );
      case CLIENT_COMMANDS.PLACE_BID:
        return engine.placeBid(
          String(data.teamId),
          data.amount === undefined ? undefined : Number(data.amount),
        );
      case CLIENT_COMMANDS.UNDO_BID:
        engine.undoBid();
        return undefined;
      case CLIENT_COMMANDS.CALL_AUCTION:
        engine.callAuction(data.call as 'once' | 'twice' | 'reopen');
        return undefined;
      case CLIENT_COMMANDS.CLOSE_AUCTION:
        return engine.closeAuction();
      case CLIENT_COMMANDS.CANCEL_AUCTION:
        engine.cancelAuction();
        return undefined;

      /* premium */
      case CLIENT_COMMANDS.START_PREMIUM_ATTEMPT:
        engine.startPremiumAttempt();
        return undefined;
      case CLIENT_COMMANDS.FORCE_PREMIUM_RESULT:
        return engine.forcePremiumResult(data.result as 'correct' | 'wrong' | 'timeout');
      case CLIENT_COMMANDS.OFFER_RECLAIM:
        engine.offerReclaim(data.teamId ? String(data.teamId) : undefined);
        return undefined;
      case CLIENT_COMMANDS.RESOLVE_RECLAIM:
        engine.resolveReclaim(String(data.teamId), Boolean(data.accept));
        return undefined;
      case CLIENT_COMMANDS.CLOSE_PREMIUM:
        engine.closePremium();
        return undefined;

      /* teams / config */
      case CLIENT_COMMANDS.UPDATE_CONFIG:
        return engine.updateConfig(data.patch as never);
      case CLIENT_COMMANDS.CREATE_TEAMS:
        return engine.createTeams(data.teams as never);
      case CLIENT_COMMANDS.UPDATE_TEAM:
        engine.updateTeam(String(data.teamId), data as never);
        return undefined;
      case CLIENT_COMMANDS.DELETE_TEAM:
        engine.deleteTeam(String(data.teamId));
        return undefined;
      case CLIENT_COMMANDS.ADJUST_CAPITAL:
        engine.adjustCapital(String(data.teamId), Number(data.amount), String(data.reason ?? 'Manual'));
        return undefined;
      case CLIENT_COMMANDS.SET_PROJECTOR_MODE:
        engine.setProjectorMode(data.mode as never);
        return undefined;

      /* simulation */
      case CLIENT_COMMANDS.SIM_SEED_TEAMS:
        return this.simulator.seedTeams(Number(data.count), Boolean(data.replace));
      case CLIENT_COMMANDS.SIM_RUN:
        return await this.simulator.run(String(data.scenario), Number(data.intensity ?? 1));
      case CLIENT_COMMANDS.SIM_STOP:
        this.simulator.stop();
        return undefined;

      default:
        throw new EngineError('unknown_command', `Unknown command ${type}`);
    }
  }

  /* --- outbound -------------------------------------------------------- */

  private onEngineEvent(event: EngineEvent): void {
    // Leaderboard updates are the highest-frequency broadcast: coalesce them so
    // a rapid capital burst still results in one clean animation frame.
    if (event.name === 'LEADERBOARD_UPDATED') {
      /*
       * One pending update PER AUDIENCE.
       *
       * A single refresh emits the board three times, once each for the
       * organizer, the projector and the participants, because the blackout
       * gives them different views of it. A single pending slot let the last
       * emit overwrite the other two, so only participants ever received a
       * live update: the projector and the organizer sat on stale standings
       * until something else made them re-read a snapshot.
       */
      this.pendingLeaderboard.set(audienceKey(event.audience), event);
      if (!this.leaderboardTimer) {
        this.leaderboardTimer = setTimeout(() => {
          this.leaderboardTimer = null;
          const pending = [...this.pendingLeaderboard.values()];
          this.pendingLeaderboard.clear();
          for (const update of pending) this.dispatch(update);
        }, LEADERBOARD_COALESCE_MS);
        if (typeof this.leaderboardTimer.unref === 'function') this.leaderboardTimer.unref();
      }
      return;
    }
    this.dispatch(event);
  }

  private dispatch(event: EngineEvent): void {
    const seq = ++this.seq;
    const frame = JSON.stringify({ t: event.name, d: event.payload, seq, ts: Date.now() });
    for (const client of this.clients.values()) {
      if (!matches(event.audience, client)) continue;
      this.raw(client.socket, frame);
    }
  }

  private sendSnapshot(client: Client, rid?: string): void {
    const snapshot = this.engine.snapshot(client.role, client.teamId, this.seq);
    this.send(client.socket, {
      t: 'SNAPSHOT',
      d: snapshot,
      seq: this.seq,
      ts: Date.now(),
      ...(rid ? { rid } : {}),
    });
  }

  private send<K extends keyof ServerPayloads>(
    socket: WebSocket,
    frame: Envelope<string, ServerPayloads[K] | unknown>,
  ): void {
    this.raw(socket, JSON.stringify(frame));
  }

  private raw(socket: WebSocket, data: string): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(data);
    } catch {
      /* a closing socket is not an error worth surfacing mid-event */
    }
  }

  private sendError(socket: WebSocket, code: string, message: string, rid?: string): void {
    this.raw(
      socket,
      JSON.stringify({ t: 'ERROR', d: { code, message, ...(rid ? { rid } : {}) }, ts: Date.now(), ...(rid ? { rid } : {}) }),
    );
  }
}

/** Identity of an audience, so one pending update can be held per audience. */
function audienceKey(audience: Audience): string {
  return audience.kind === 'team' ? `team:${audience.teamId}` : audience.kind;
}

function matches(audience: Audience, client: Client): boolean {
  switch (audience.kind) {
    case 'all':
      return true;
    case 'organizer':
      return client.role === 'organizer';
    case 'projector':
      return client.role === 'projector';
    case 'participants':
      return client.role === 'participant';
    case 'stage':
      return client.role === 'organizer' || client.role === 'projector';
    case 'team':
      return client.role === 'participant' && client.teamId === audience.teamId;
    default:
      return false;
  }
}
