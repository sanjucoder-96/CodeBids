/**
 * HTTP surface. Deliberately small: authentication, exports, backup and health.
 * All gameplay travels over the WebSocket.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GameEngine } from '../core/engine.js';
import type { AuthService } from '../auth.js';
import { backupDatabase, type DB } from '../db/index.js';
import {
  exportAuditText,
  exportCsv,
  exportJson,
  exportSequenceStats,
  premiumSummary,
} from '../export.js';
import { connectionInfo } from './netinfo.js';

export interface RouteDeps {
  engine: GameEngine;
  auth: AuthService;
  db: DB;
  dbFile: string;
  backupDir: string;
  port: number;
  version: string;
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  const query = (request.query as Record<string, unknown> | undefined)?.token;
  return typeof query === 'string' ? query : '';
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { engine, auth } = deps;

  const requireOrganizer = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const identity = auth.verify(bearer(request));
    if (!identity || identity.role !== 'organizer') {
      reply.code(401).send({ error: 'organizer_required' });
      return false;
    }
    return true;
  };

  /* --- health / discovery ------------------------------------------- */

  app.get('/api/health', async () => ({
    ok: true,
    version: deps.version,
    phase: engine.gameState().phase,
    teams: engine.publicTeams().length,
    offline: true,
    serverNow: Date.now(),
  }));

  app.get('/api/connection', async () => connectionInfo(deps.port));

  /* --- authentication ------------------------------------------------ */

  app.post('/api/auth/team', async (request, reply) => {
    const body = request.body as { joinCode?: string } | undefined;
    const session = auth.loginTeam(String(body?.joinCode ?? ''));
    if (!session) {
      return reply.code(401).send({ error: 'invalid_join_code', message: 'That join code is not recognised' });
    }
    const view = engine.teamView(session.teamId);
    const team = engine.getRepo().getTeam(session.teamId);
    engine.audit('TEAM_LOGIN', { teamId: session.teamId });
    return { token: session.token, teamId: session.teamId, teamName: team?.name ?? session.teamId, me: view };
  });

  /**
   * Self-service team registration (no printed roster). A participant opens the
   * IP link and enters their TEAM NAME; the server creates the team if it is new,
   * or re-joins it if a teammate already registered that name.
   */
  app.post('/api/auth/team/register', async (request, reply) => {
    const body = request.body as { name?: string } | undefined;
    let team;
    try {
      team = engine.registerTeam(String(body?.name ?? ''));
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'bad_name';
      const message = error instanceof Error ? error.message : 'Could not register that team';
      return reply.code(400).send({ error: code, message });
    }
    const session = auth.sessionForTeam(team.id);
    const view = engine.teamView(team.id);
    engine.audit('TEAM_REGISTERED', { teamId: team.id, metadata: { name: team.name } });
    return {
      token: session.token,
      teamId: team.id,
      teamName: team.name,
      joinCode: engine.getRepo().getJoinCode(team.id),
      me: view,
    };
  });

  app.post('/api/auth/organizer', async (request, reply) => {
    const body = request.body as { passcode?: string } | undefined;
    const session = auth.loginOrganizer(String(body?.passcode ?? ''));
    if (!session) {
      return reply.code(401).send({ error: 'invalid_passcode', message: 'Incorrect operator passcode' });
    }
    engine.audit('ORGANIZER_LOGIN', {});
    return { token: session.token };
  });

  app.post('/api/auth/projector', async () => auth.loginProjector());

  app.get('/api/auth/whoami', async (request, reply) => {
    const identity = auth.verify(bearer(request));
    if (!identity) return reply.code(401).send({ error: 'unauthorised' });
    return identity;
  });

  /* --- organizer data ------------------------------------------------- */

  app.get('/api/organizer/teams', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    const repo = engine.getRepo();
    const rows = engine.leaderboard();
    return repo.listTeams().map((team) => ({
      ...team,
      joinCode: repo.getJoinCode(team.id),
      stats: engine.teamStats(team.id),
      rank: rows.find((r) => r.teamId === team.id)?.rank ?? 0,
      podium: rows.find((r) => r.teamId === team.id)?.podium ?? null,
    }));
  });

  app.get('/api/organizer/sequence', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    return engine.sequenceEntries();
  });

  app.get('/api/organizer/questions', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    return engine.listQuestions().map((q) => ({
      id: q.id,
      kind: q.kind,
      title: q.title,
      domain: q.domain,
      difficulty: q.difficulty,
      timeLimit: q.timeLimit,
      accessKey: q.accessKey,
    }));
  });

  /** The complete per-team record (spec section 12). */
  app.get('/api/organizer/team/:teamId', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    const { teamId } = request.params as { teamId: string };
    const dossier = engine.teamDossier(teamId);
    if (!dossier) return reply.code(404).send({ error: 'unknown_team' });
    return dossier;
  });

  app.get('/api/organizer/audit', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    const limit = Number((request.query as Record<string, unknown>)?.limit ?? 500);
    return engine.listAudit(Number.isFinite(limit) ? limit : 500);
  });

  app.get('/api/organizer/premium', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    return premiumSummary(engine);
  });

  app.get('/api/organizer/stats', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    return exportSequenceStats(engine);
  });

  /* --- export --------------------------------------------------------- */

  app.get('/api/export/results.csv', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="code-market-results.csv"');
    return exportCsv(engine);
  });

  app.get('/api/export/results.json', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="code-market-results.json"');
    return exportJson(engine);
  });

  app.get('/api/export/audit.txt', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', 'attachment; filename="code-market-audit.txt"');
    return exportAuditText(engine);
  });

  /* --- recovery -------------------------------------------------------- */

  app.post('/api/organizer/backup', async (request, reply) => {
    if (!requireOrganizer(request, reply)) return;
    if (deps.dbFile === ':memory:') {
      return reply.code(400).send({ error: 'in_memory', message: 'This server runs in memory' });
    }
    const file = backupDatabase(deps.db, deps.dbFile, deps.backupDir);
    engine.audit('DATABASE_BACKUP', { metadata: { file } });
    return { ok: true, file };
  });
}
