/**
 * Data Service — Orchestrates all scrapers
 * Provides a single interface for the API routes
 * Uses NodeCache (in-memory) as L1 and SQLite as L2
 */
const NodeCache = require('node-cache');
const { scrapeInvitationRounds, scrapeOccupationList, scrapeDhaNews, getDbRounds } = require('./scrapers/homeAffairs');
const { scrapeAllStates, getAllDbStates } = require('./scrapers/stateNomination');
const { searchMigrationDatasets, getMigrationProgramStats } = require('./scrapers/dataGovAu');
const { getDb, dbHelpers } = require('../config/database');
const logger = require('../utils/logger');
const config = require('../config');

// L1: fast in-memory cache (survives for the life of the process)
const memCache = new NodeCache({
  stdTTL:    300,         // 5 min default
  checkperiod: 120,
  useClones: false,       // avoid JSON clone overhead
});

// ── Helpers ───────────────────────────────────────────────────────
async function withCache(key, ttl, fetchFn) {
  // L1 check
  const l1 = memCache.get(key);
  if (l1 !== undefined) {
    logger.debug(`[Cache:L1] Hit: ${key}`);
    return l1;
  }
  // L2 (SQLite) check
  const l2 = dbHelpers.cacheGet(key);
  if (l2) {
    logger.debug(`[Cache:L2] Hit: ${key}`);
    memCache.set(key, l2, Math.min(ttl, 300));
    return l2;
  }
  // Miss — fetch live
  logger.debug(`[Cache:Miss] Fetching live: ${key}`);
  const data = await fetchFn();
  if (data && (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0)) {
    memCache.set(key, data, Math.min(ttl, 300));
    dbHelpers.cacheSet(key, data, ttl);
  }
  return data;
}

// ── Public API ────────────────────────────────────────────────────

async function getInvitationRounds({ visaSubclass, limit = 24, page = 1 } = {}) {
  return withCache(
    `rounds_${visaSubclass || 'all'}_${limit}_${page}`,
    config.cache.ttlInvitations,
    async () => {
      // Try live scrape first
      let rows;
      try {
        await scrapeInvitationRounds();
      } catch { /* fall through to DB */ }

      // Read from DB
      const db = getDb();
      let query = 'SELECT * FROM invitation_rounds';
      const params = [];

      if (visaSubclass) {
        query += ' WHERE visa_subclass = ?';
        params.push(visaSubclass);
      }

      const offset = (page - 1) * limit;
      query += ' ORDER BY round_date DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      rows = db.prepare(query).all(...params);

      // Augment with computed fields
      return rows.map(r => ({
        ...r,
        occupations: r.occupation_ceiling ? safeJsonParse(r.occupation_ceiling, null) : null,
        isRecent:    isRecent(r.round_date, 6),
      }));
    }
  );
}

async function getInvitationTrends() {
  return withCache('invitation_trends', config.cache.ttlInvitations, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT round_date, visa_subclass, lowest_points, invitations
      FROM invitation_rounds
      ORDER BY round_date ASC
    `).all();

    // Pivot by date for chart consumption
    const byDate = {};
    for (const row of rows) {
      if (!byDate[row.round_date]) byDate[row.round_date] = { date: row.round_date };
      byDate[row.round_date][`cutoff_${row.visa_subclass}`]     = row.lowest_points;
      byDate[row.round_date][`invitations_${row.visa_subclass}`] = row.invitations;
    }

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  });
}

async function getStateNominations({ stateCode } = {}) {
  return withCache(
    `states_${stateCode || 'all'}`,
    config.cache.ttlStates,
    async () => {
      // Trigger fresh scrape in background (non-blocking)
      scrapeAllStates().catch(e => logger.error('BG state scrape failed', { e: e.message }));
      const states = getAllDbStates();
      if (!states.length) {
        // First run — wait for scrape
        return scrapeAllStates();
      }
      const result = stateCode
        ? states.filter(s => s.state_code === stateCode.toUpperCase())
        : states;
      return result.map(s => ({
        ...s,
        occupations: safeJsonParse(s.occupations, []),
        isStale: isStale(s.fetched_at, config.cache.ttlStates),
      }));
    }
  );
}

async function getMigrationNews({ state, topic, limit = 20, page = 1 } = {}) {
  return withCache(
    `news_${state || 'all'}_${topic || 'all'}_${limit}_${page}`,
    config.cache.ttlNews,
    async () => {
      // Try live scrape
      try {
        const fresh = await scrapeDhaNews();
        if (fresh.length) await saveNewsToDb(fresh);
      } catch { /* fall through */ }

      const db = getDb();
      let query = 'SELECT * FROM migration_news WHERE 1=1';
      const params = [];

      if (state && state !== 'all') { query += ' AND state = ?'; params.push(state); }
      if (topic && topic !== 'all') { query += ' AND topic = ?'; params.push(topic); }

      const offset = (page - 1) * limit;
      query += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      const total = db.prepare('SELECT COUNT(*) as n FROM migration_news').get().n;
      return { items: rows, total, page, limit };
    }
  );
}

async function getOccupations({ search, demand, category, stream, limit = 50, page = 1 } = {}) {
  return withCache(
    `occ_${search || ''}_${demand || ''}_${category || ''}_${stream || ''}_${limit}_${page}`,
    config.cache.ttlOccupations,
    async () => {
      const db = getDb();
      let query = 'SELECT * FROM occupations WHERE 1=1';
      const params = [];

      if (search) {
        query += ' AND (title LIKE ? OR code LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      if (demand)   { query += ' AND demand_level = ?';  params.push(demand); }
      if (category) { query += ' AND category = ?';       params.push(category); }
      if (stream)   { query += ' AND visa_streams LIKE ?'; params.push(`%${stream}%`); }

      const offset = (page - 1) * limit;
      query += ' ORDER BY demand_level, title LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      const total = db.prepare('SELECT COUNT(*) as n FROM occupations').get().n;

      return {
        items: rows.map(r => ({ ...r, visa_streams: safeJsonParse(r.visa_streams, []) })),
        total, page, limit,
      };
    }
  );
}

async function getOpenDatasets() {
  return withCache('open_datasets', 3600 * 6, () => searchMigrationDatasets());
}

async function getProgramStats() {
  return withCache('program_stats', 3600 * 24, () => getMigrationProgramStats());
}

// ── Cache management ──────────────────────────────────────────────
function flushMemCache(pattern) {
  if (pattern) {
    const keys = memCache.keys().filter(k => k.includes(pattern));
    keys.forEach(k => memCache.del(k));
    logger.info(`[Cache] Flushed ${keys.length} keys matching: ${pattern}`);
  } else {
    memCache.flushAll();
    logger.info('[Cache] Flushed all in-memory cache');
  }
}

function getCacheStats() {
  return {
    l1: memCache.getStats(),
    l2: getDb().prepare('SELECT COUNT(*) as n FROM cache WHERE expires_at > ?').get(Math.floor(Date.now() / 1000)),
  };
}

// ── DB helpers ────────────────────────────────────────────────────
async function saveNewsToDb(articles) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO migration_news (title, summary, source, state, topic, published_at, url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  db.transaction(() => {
    for (const a of articles) {
      stmt.run(a.title, a.summary, a.source, a.state || 'National', a.topic, a.publishedAt, a.url);
    }
  })();
}

// ── Utils ─────────────────────────────────────────────────────────
function safeJsonParse(str, fallback = null) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function isRecent(dateStr, months = 3) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return d > cutoff;
}

function isStale(dateStr, ttlSeconds) {
  if (!dateStr) return true;
  const fetched = new Date(dateStr);
  return (Date.now() - fetched.getTime()) > ttlSeconds * 1000;
}

module.exports = {
  getInvitationRounds,
  getInvitationTrends,
  getStateNominations,
  getMigrationNews,
  getOccupations,
  getOpenDatasets,
  getProgramStats,
  flushMemCache,
  getCacheStats,
};
