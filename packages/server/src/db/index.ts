import Database from 'better-sqlite3';
import { mkdirSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The schema lives next to the source in dev and next to the bundle in prod;
 * try both so `tsx src/index.ts` and `node dist/index.js` behave identically.
 */
function loadSchema(): string {
  const candidates = [
    join(here, 'schema.sql'),
    join(here, '..', '..', 'src', 'db', 'schema.sql'),
    resolve(process.cwd(), 'packages/server/src/db/schema.sql'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(`schema.sql not found. Looked in:\n${candidates.join('\n')}`);
}

export type DB = Database.Database;

export interface OpenOptions {
  /** ':memory:' for tests. */
  file: string;
  verbose?: boolean;
}

export function openDatabase(options: OpenOptions): DB {
  if (options.file !== ':memory:') {
    mkdirSync(dirname(resolve(options.file)), { recursive: true });
  }
  const db = new Database(options.file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(loadSchema());
  ensureGameStateRow(db);
  return db;
}

function ensureGameStateRow(db: DB): void {
  const row = db.prepare('SELECT id FROM game_state WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO game_state (id, phase, projector_mode, updated_at)
       VALUES (1, 'lobby', 'auto', ?)`,
    ).run(Date.now());
  }
}

/**
 * Hot backup of the live database (spec section 52). better-sqlite3's
 * `backup()` is async; for an event-day panic button a synchronous file copy of
 * a checkpointed WAL database is simpler and just as safe.
 */
export function backupDatabase(db: DB, sourceFile: string, targetDir: string): string {
  mkdirSync(targetDir, { recursive: true });
  db.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const target = join(targetDir, `code-market-${stamp}.db`);
  copyFileSync(sourceFile, target);
  return target;
}

/** Wrap a unit of work in an immediate transaction. */
export function transact<T>(db: DB, fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}
