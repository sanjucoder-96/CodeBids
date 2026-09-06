/**
 * A database written by an earlier build must not be opened in place.
 *
 * The schema is applied with CREATE TABLE IF NOT EXISTS, so a Round 2 file
 * would otherwise keep its old columns and fail at the first real query.
 * Opening must archive it and start clean instead of crashing on event day.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-schema-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // Windows keeps a handle on the WAL sidecars for a moment after close;
    // a failed cleanup of a temp directory must not fail the assertions.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

describe('schema versioning', () => {
  it('archives an incompatible older database and starts fresh', () => {
    const dir = scratch();
    const file = join(dir, 'event.db');

    // A Round 2 shaped file: same table name, missing the Round 3 columns.
    const old = new Database(file);
    old.exec(`CREATE TABLE attempts (
      id INTEGER PRIMARY KEY, team_id TEXT NOT NULL, challenge_id TEXT NOT NULL
    )`);
    old.exec(`INSERT INTO attempts (team_id, challenge_id) VALUES ('T01', 'C1')`);
    old.close();

    const db = openDatabase({ file });

    // The new schema is in force: the Round 3 column exists.
    const columns = (db.pragma('table_info(attempts)') as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toContain('slot_index');
    expect(db.prepare('SELECT count(*) AS n FROM attempts').get()).toEqual({ n: 0 });

    // The operator's old data was moved aside, never deleted.
    const backups = readdirSync(dir).filter((f) => f.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    db.close();
  });

  it('reopens a current database in place, keeping its rows', () => {
    const dir = scratch();
    const file = join(dir, 'event.db');

    const first = openDatabase({ file });
    first
      .prepare(
        `INSERT INTO teams
           (id, name, capital, starting_capital, protected_reserve, join_code, created_at)
         VALUES ('T01', 'ALPHA', 1000, 1000, 500, 'ALPHA-1', 1)`,
      )
      .run();
    first.close();

    const second = openDatabase({ file });
    expect(second.prepare('SELECT count(*) AS n FROM teams').get()).toEqual({ n: 1 });
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(0);
    second.close();
  });

  it('stamps the schema version on a brand new file', () => {
    const dir = scratch();
    const file = join(dir, 'event.db');
    const db = openDatabase({ file });
    expect(Number(db.pragma('user_version', { simple: true }))).toBeGreaterThan(0);
    expect(existsSync(file)).toBe(true);
    db.close();
  });
});
