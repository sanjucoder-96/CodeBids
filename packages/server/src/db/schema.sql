-- CSI Club - Code Market : authoritative event database (Round 3).
-- Every table is written only by the server. SQLite in WAL mode gives us
-- crash-safe, single-file persistence that survives a mid-event restart.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  capital            INTEGER NOT NULL,
  starting_capital   INTEGER NOT NULL,
  protected_reserve  INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  connection_status  TEXT NOT NULL DEFAULT 'offline',
  join_code          TEXT NOT NULL UNIQUE,
  seat_label         TEXT,
  volunteer          TEXT,
  created_at         INTEGER NOT NULL,
  last_seen_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_teams_capital ON teams(capital DESC);

CREATE TABLE IF NOT EXISTS team_sessions (
  token        TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_team ON team_sessions(team_id);

-- The POOL of available questions. This is not the running order.
CREATE TABLE IF NOT EXISTS questions (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,             -- 'normal' | 'premium'
  title            TEXT NOT NULL,
  domain           TEXT NOT NULL,
  type             TEXT NOT NULL,
  difficulty       TEXT NOT NULL,             -- easy|medium|hard|very_hard
  time_limit       INTEGER NOT NULL,
  reward_override  INTEGER,
  penalty_override INTEGER,
  question_data    TEXT NOT NULL,
  evaluation_data  TEXT NOT NULL,
  access_key       TEXT NOT NULL,
  access_key_hash  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_kind ON questions(kind, difficulty);

-- The GENERATED running order: three random normal questions, then a premium,
-- repeated per block. Persisted so a restart or reconnect never re-rolls it.
CREATE TABLE IF NOT EXISTS game_sequence (
  idx               INTEGER PRIMARY KEY,      -- 1-based slot index
  block_number      INTEGER NOT NULL,
  position_in_block INTEGER NOT NULL,
  kind              TEXT NOT NULL,
  question_id       TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  state             TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_sequence_block ON game_sequence(block_number, position_in_block);

CREATE TABLE IF NOT EXISTS auctions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id            TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  slot_index             INTEGER NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  starting_bid           INTEGER NOT NULL,
  increment              INTEGER NOT NULL,
  current_bid            INTEGER,
  current_leader_team_id TEXT,
  winner_team_id         TEXT,
  winning_amount         INTEGER,
  started_at             INTEGER,
  ended_at               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auctions_slot ON auctions(slot_index);

CREATE TABLE IF NOT EXISTS bids (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id      INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id         TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  sequence_number INTEGER NOT NULL,
  timestamp       INTEGER NOT NULL,
  valid           INTEGER NOT NULL DEFAULT 1,
  rejected_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_bids_team ON bids(team_id);

-- Persisted premium lifecycle so a restart mid-reclaim recovers exactly.
CREATE TABLE IF NOT EXISTS premium_states (
  question_id     TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  slot_index      INTEGER NOT NULL,
  stage           TEXT NOT NULL,
  auction_id      INTEGER,
  ladder          TEXT NOT NULL,
  active_team_id  TEXT,
  active_risk     INTEGER,
  attempt_number  INTEGER NOT NULL DEFAULT 0,
  offer_team_id   TEXT,
  offer_risk      INTEGER,
  offer_deadline  INTEGER,
  failed_team_id  TEXT,
  outcome         TEXT,
  window_ends_at  INTEGER,
  decision_deadline INTEGER,
  decisions       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id        TEXT NOT NULL,
  question_id    TEXT NOT NULL,
  slot_index     INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  result         TEXT NOT NULL,
  score_change   INTEGER NOT NULL DEFAULT 0,
  risk_amount    INTEGER,
  timestamp      INTEGER NOT NULL,
  duration_ms    INTEGER,
  detail         TEXT,
  submission     TEXT
);

-- A team answers a SLOT once; the same question could legitimately recur in a
-- later slot, so uniqueness is per slot, not per question.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_unique
  ON attempts(team_id, slot_index, attempt_number);
CREATE INDEX IF NOT EXISTS idx_attempts_team ON attempts(team_id);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  question_id   TEXT,
  slot_index    INTEGER,
  timestamp     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_team ON transactions(team_id, id);

CREATE TABLE IF NOT EXISTS game_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  phase               TEXT NOT NULL DEFAULT 'idle',
  resume_phase        TEXT,
  slot_index          INTEGER NOT NULL DEFAULT 0,
  current_question_id TEXT,
  current_auction_id  INTEGER,
  timer_ends_at       INTEGER,
  timer_duration      INTEGER,
  timer_label         TEXT,
  projector_mode      TEXT NOT NULL DEFAULT 'auto',
  started_at          INTEGER,
  completed_at        INTEGER,
  updated_at          INTEGER NOT NULL
);

-- Per-team, per-slot participation record.
CREATE TABLE IF NOT EXISTS participation (
  team_id      TEXT NOT NULL,
  slot_index   INTEGER NOT NULL,
  question_id  TEXT NOT NULL,
  state        TEXT NOT NULL,
  unlocked_at  INTEGER,
  joined_at    INTEGER,
  submitted_at INTEGER,
  PRIMARY KEY (team_id, slot_index)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  team_id     TEXT,
  question_id TEXT,
  slot_index  INTEGER,
  timestamp   INTEGER NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_team ON audit_log(team_id, id DESC);

-- Final standings, written once the round completes.
CREATE TABLE IF NOT EXISTS final_results (
  team_id       TEXT PRIMARY KEY,
  place         INTEGER NOT NULL,
  capital       INTEGER NOT NULL,
  delta         INTEGER NOT NULL,
  recorded_at   INTEGER NOT NULL
);
