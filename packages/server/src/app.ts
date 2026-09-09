/**
 * Application factory. Everything is wired here so tests can build a full,
 * real server (in-memory database, ephemeral port) in one call.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type DB } from './db/index.js';
import { Repo } from './repo/index.js';
import { AuthService, generateSecret } from './auth.js';
import { GameEngine } from './core/engine.js';
import { Simulator } from './core/simulation.js';
import { CodeRunner, detectToolchain, type RunnerToolchain } from './core/codeRunner.js';
import { Hub } from './net/hub.js';
import { registerRoutes } from './net/routes.js';

export const VERSION = '1.0.0';

const here = dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  dbFile: string;
  port: number;
  host?: string;
  backupDir?: string;
  organizerPasscode?: string;
  /**
   * Seed for team join codes. Omitted, codes are cryptographically random.
   * Supplied, two machines preparing the same event print the same cards.
   */
  teamCodeSeed?: number;
  /** Skip static file serving (tests). */
  serveClient?: boolean;
  /** Skip toolchain probing (tests) - it spawns processes. */
  detectToolchain?: boolean;
  logger?: boolean;
  now?: () => number;
}

export interface App {
  app: FastifyInstance;
  db: DB;
  repo: Repo;
  engine: GameEngine;
  auth: AuthService;
  simulator: Simulator;
  hub: Hub | null;
  toolchain: RunnerToolchain;
  organizerPasscode: string;
  listen(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
}

/** Locate the built client, whether running from src (dev) or dist (prod). */
function findClientDist(): string | null {
  const candidates = [
    join(here, '..', '..', 'client', 'dist'),
    join(here, '..', '..', '..', 'client', 'dist'),
    resolve(process.cwd(), 'packages/client/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

/**
 * The default operator passcode.
 *
 * Fixed on purpose: the console is used from the organizer's own laptop on a
 * physically controlled offline LAN, and a passcode that changed on every fresh
 * database (it used to be random) meant the operator hunted for a new code each
 * time. Override it for a private event with `--passcode <code>`.
 */
const DEFAULT_ORGANIZER_PASSCODE = '1234';

export async function createApp(options: AppOptions): Promise<App> {
  const db = openDatabase({ file: options.dbFile });
  const repo = new Repo(db);

  // The HMAC secret is generated once and persisted, so tokens issued before a
  // restart keep working (spec section 36).
  let secret = repo.getMeta('secret');
  if (!secret) {
    secret = generateSecret();
    repo.setMeta('secret', secret);
  }

  // A fixed passcode that never changes across restarts or a fresh database:
  // the `--passcode` flag wins, otherwise the fixed default. (No longer random,
  // and no longer inherited from a stale value persisted by an earlier run.)
  const passcode = options.organizerPasscode ?? DEFAULT_ORGANIZER_PASSCODE;
  repo.setMeta('organizer_passcode', passcode);

  const auth = new AuthService(repo, secret, passcode);

  const toolchain: RunnerToolchain =
    options.detectToolchain === false
      ? { python: null, cpp: null, java: null }
      : await detectToolchain();
  const runner = new CodeRunner(toolchain);

  const engine = new GameEngine({
    repo,
    auth,
    secret,
    runner,
    ...(options.now ? { now: options.now } : {}),
    ...(options.teamCodeSeed === undefined ? {} : { teamCodeSeed: options.teamCodeSeed }),
  });
  engine.seedQuestions();
  // A restart must never leave stale "online" flags behind.
  repo.markAllOffline();
  engine.restoreTimers();

  const simulator = new Simulator(engine);

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
  });

  registerRoutes(app, {
    engine,
    auth,
    db,
    dbFile: options.dbFile,
    backupDir: options.backupDir ?? resolve(process.cwd(), 'data/backups'),
    port: options.port,
    version: VERSION,
  });

  if (options.serveClient !== false) {
    const clientDist = findClientDist();
    if (clientDist) {
      await app.register(fastifyStatic, {
        root: clientDist,
        wildcard: false,
        // Take over cache policy entirely: @fastify/static would otherwise
        // stamp its own Cache-Control after setHeaders runs.
        cacheControl: false,
        /*
         * index.html must NEVER be cached: it names the hashed bundle. A
         * browser holding a stale copy would request a bundle that no longer
         * exists and render a blank page - the worst possible failure on event
         * day. The hashed assets themselves are immutable and cache forever.
         */
        setHeaders(reply, path) {
          if (path.endsWith('index.html')) {
            reply.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
          } else if (path.includes('assets')) {
            reply.setHeader('cache-control', 'public, max-age=31536000, immutable');
          }
        },
      });
      // SPA fallback: every unknown non-API *page* path serves index.html so
      // the organizer and projector deep links work offline without a router.
      //
      // Asset requests are deliberately excluded from that fallback. Serving
      // index.html for a missing .js file produces a baffling "MIME type
      // text/html" error in the browser. A clean 404 makes the real problem
      // obvious and lets the browser fall back to a reload.
      app.setNotFoundHandler((request, reply) => {
        const path = request.url.split('?')[0] ?? '';
        const isApi = path.startsWith('/api') || path.startsWith('/ws');
        const isAsset = /\.[a-z0-9]{2,6}$/i.test(path);

        if (isApi) {
          reply.code(404).send({ error: 'not_found', path });
          return;
        }

        if (isAsset) {
          // `wildcard: false` lets unmatched paths reach this handler, which is
          // what makes the SPA fallback possible - but it also means the static
          // plugin only knows the files that existed when it was registered.
          // Rebuilding the client against a running server would otherwise
          // serve an index.html naming bundles the server refuses to hand out,
          // and the page renders blank. Resolve late-arriving files from disk.
          const onDisk = resolveInside(clientDist, path);
          if (onDisk) {
            reply.header('cache-control', 'public, max-age=31536000, immutable');
            reply.sendFile(path.replace(/^\//, ''));
            return;
          }
          reply.code(404).send({ error: 'not_found', path });
          return;
        }

        reply.header('cache-control', 'no-cache, no-store, must-revalidate');
        reply.sendFile('index.html');
      });
    } else {
      app.get('/', async () => ({
        message:
          'Client bundle not built yet. Run `npm run build` (or `npm run dev` for the Vite dev server).',
      }));
    }
  }

  let hub: Hub | null = null;

  return {
    app,
    db,
    repo,
    engine,
    auth,
    simulator,
    get hub() {
      return hub;
    },
    toolchain,
    organizerPasscode: passcode,
    async listen() {
      await app.listen({ port: options.port, host: options.host ?? '0.0.0.0' });
      hub = new Hub(app.server, engine, auth, simulator);
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      return { port, url: `http://localhost:${port}` };
    },
    async close() {
      hub?.close();
      engine.dispose();
      await app.close();
      db.close();
    },
  };
}

/**
 * Resolve a URL path inside `root`, or null if it escapes the directory or is
 * not a real file. Guards the late-asset fallback against path traversal.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const target = resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return existsSync(target) ? target : null;
}
