const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

let db;

function getDb() {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

function initDb() {
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');   // better concurrent reads
  db.pragma('foreign_keys = ON');

  createTables();
  logger.info('Database initialised', { path: config.dbPath });
  return db;
}

function createTables() {
  db.exec(`
    -- ── Scraped invitation rounds ─────────────────────────────
    CREATE TABLE IF NOT EXISTS invitation_rounds (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      round_date      TEXT NOT NULL,
      visa_subclass   TEXT NOT NULL,         -- '189' | '190' | '491'
      lowest_points   INTEGER,
      invitations     INTEGER,
      occupation_ceiling TEXT,               -- JSON or 'N/A'
      source_url      TEXT,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(round_date, visa_subclass)
    );

    -- ── State nomination snapshots ────────────────────────────
    CREATE TABLE IF NOT EXISTS state_nominations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      state_code      TEXT NOT NULL,         -- 'NSW' | 'VIC' ...
      program_name    TEXT,
      status          TEXT,                  -- 'Open' | 'Closed' | 'Invite Only'
      quota           INTEGER,
      quota_remaining INTEGER,
      occupations     TEXT,                  -- JSON array
      notes           TEXT,
      source_url      TEXT,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(state_code)                     -- one current row per state
    );

    -- ── Migration news articles ───────────────────────────────
    CREATE TABLE IF NOT EXISTS migration_news (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL,
      summary         TEXT,
      source          TEXT,
      state           TEXT DEFAULT 'National',
      topic           TEXT,
      published_at    TEXT,
      url             TEXT UNIQUE,
      pdf_url         TEXT,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Occupations (ANZSCO) ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS occupations (
      code            TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      assessing_body  TEXT,
      visa_streams    TEXT,                  -- JSON array ['189','190','491']
      demand_level    TEXT,
      on_mltssl       INTEGER DEFAULT 0,
      on_stsol        INTEGER DEFAULT 0,
      on_rol          INTEGER DEFAULT 0,
      avg_salary      TEXT,
      category        TEXT,
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- ── User profiles ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_profiles (
      id              TEXT PRIMARY KEY,      -- UUID
      alias           TEXT,
      age_band        TEXT,
      english_level   TEXT,
      education       TEXT,
      work_exp        TEXT,
      aus_work_exp    TEXT,
      partner_skills  TEXT,
      aus_study       TEXT,
      specialist_edu  TEXT,
      nomination      TEXT,
      total_points    INTEGER,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- ── EOI tracker entries ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS eoi_entries (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT REFERENCES user_profiles(id),
      visa_subclass   TEXT,
      occupation      TEXT,
      anzsco_code     TEXT,
      points_claimed  INTEGER,
      status          TEXT DEFAULT 'EOI Submitted',
      eoi_date        TEXT,
      invitation_date TEXT,
      lodged_date     TEXT,
      nomination_state TEXT,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- ── Document expiry records ───────────────────────────────
    CREATE TABLE IF NOT EXISTS document_records (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT REFERENCES user_profiles(id),
      doc_type        TEXT,
      issue_date      TEXT,
      expiry_date     TEXT,
      reminder_set    INTEGER DEFAULT 0,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    -- ── Cache table (key-value) ───────────────────────────────
    CREATE TABLE IF NOT EXISTS cache (
      cache_key       TEXT PRIMARY KEY,
      cache_value     TEXT,
      expires_at      INTEGER             -- unix timestamp
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_inv_date    ON invitation_rounds(round_date DESC);
    CREATE INDEX IF NOT EXISTS idx_inv_visa    ON invitation_rounds(visa_subclass);
    CREATE INDEX IF NOT EXISTS idx_news_state  ON migration_news(state);
    CREATE INDEX IF NOT EXISTS idx_news_date   ON migration_news(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eoi_profile ON eoi_entries(profile_id);
  `);
}

// ── Helpers ──────────────────────────────────────────────────────
const dbHelpers = {
  // DB-backed cache get
  cacheGet(key) {
    const row = getDb().prepare(
      'SELECT cache_value FROM cache WHERE cache_key = ? AND expires_at > ?'
    ).get(key, Math.floor(Date.now() / 1000));
    if (!row) return null;
    try { return JSON.parse(row.cache_value); } catch { return row.cache_value; }
  },

  // DB-backed cache set
  cacheSet(key, value, ttlSeconds = 3600) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    getDb().prepare(
      'INSERT OR REPLACE INTO cache (cache_key, cache_value, expires_at) VALUES (?, ?, ?)'
    ).run(key, JSON.stringify(value), expiresAt);
  },

  // Clear expired cache entries
  cachePrune() {
    const result = getDb().prepare(
      'DELETE FROM cache WHERE expires_at < ?'
    ).run(Math.floor(Date.now() / 1000));
    return result.changes;
  },
};

module.exports = { initDb, getDb, dbHelpers };
