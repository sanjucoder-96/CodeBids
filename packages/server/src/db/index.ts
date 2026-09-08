import Database from 'better-sqlite3';
import { mkdirSync, existsSync, copyFileSync, readFileSync, renameSync } from 'node:fs';
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

/**
 * Bumped whenever the on-disk shape changes incompatibly. The schema uses
 * `CREATE TABLE IF NOT EXISTS`, so a file written by an older build would
 * otherwise survive with the wrong columns and fail at the first query
 * ("no such column: slot_index"). Round 2 -> Round 3 was exactly that break.
 */
const SCHEMA_VERSION = 5;

/** True when the file already holds tables from a different schema version. */
function isStaleSchema(db: DB): boolean {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version === SCHEMA_VERSION) return false;
  const existing = db
    .prepare(
      `SELECT count(*) AS n FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .get() as { n: number };
  return existing.n > 0;
}

/**
 * Move an incompatible database aside rather than deleting it. Event data is
 * never silently destroyed: the operator keeps a copy they can inspect.
 */
function archive(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = `${file}.v2-${stamp}.bak`;
  renameSync(file, target);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(file + suffix)) renameSync(file + suffix, target + suffix);
  }
  return target;
}

function connect(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function openDatabase(options: OpenOptions): DB {
  if (options.file !== ':memory:') {
    mkdirSync(dirname(resolve(options.file)), { recursive: true });
  }

  let db = connect(options.file);

  if (options.file !== ':memory:' && isStaleSchema(db)) {
    db.close();
    const moved = archive(resolve(options.file));
    console.warn(
      `Database was written by an incompatible earlier version.
` +
        `  Archived to: ${moved}
` +
        `  Starting a fresh Round 3 database.`,
    );
    db = connect(options.file);
  }

  db.exec(loadSchema());
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
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
