/**
 * Scheduler — Cron jobs for automatic data refresh
 * Uses node-cron. All jobs log execution and catch errors gracefully.
 */
const cron = require('node-cron');
const { scrapeInvitationRounds, scrapeOccupationList, scrapeDhaNews } = require('../services/scrapers/homeAffairs');
const { scrapeAllStates } = require('../services/scrapers/stateNomination');
const { flushMemCache, getCacheStats } = require('../services/dataService');
const { dbHelpers } = require('../config/database');
const logger = require('../utils/logger');

const jobs = [];

function startScheduler() {
  logger.info('[Scheduler] Starting job scheduler…');

  // ── Invitation rounds — every 6 hours ─────────────────────────
  // DHA publishes new rounds monthly but we check frequently
  jobs.push(cron.schedule('0 */6 * * *', async () => {
    logger.info('[Job] Refreshing invitation rounds…');
    try {
      await scrapeInvitationRounds();
      flushMemCache('rounds');
      logger.info('[Job] Invitation rounds refreshed ✓');
    } catch (err) {
      logger.error('[Job] Invitation rounds failed', { error: err.message });
    }
  }, { name: 'invitation-rounds' }));

  // ── State nominations — every 2 hours ─────────────────────────
  // States can open/close programs quickly
  jobs.push(cron.schedule('0 */2 * * *', async () => {
    logger.info('[Job] Refreshing state nominations…');
    try {
      await scrapeAllStates();
      flushMemCache('states');
      logger.info('[Job] State nominations refreshed ✓');
    } catch (err) {
      logger.error('[Job] State nominations failed', { error: err.message });
    }
  }, { name: 'state-nominations' }));

  // ── Migration news — every hour ───────────────────────────────
  jobs.push(cron.schedule('0 * * * *', async () => {
    logger.info('[Job] Refreshing migration news…');
    try {
      await scrapeDhaNews();
      flushMemCache('news');
      logger.info('[Job] Migration news refreshed ✓');
    } catch (err) {
      logger.error('[Job] News refresh failed', { error: err.message });
    }
  }, { name: 'migration-news' }));

  // ── Occupation lists — once per day at 3am AEDT ───────────────
  jobs.push(cron.schedule('0 3 * * *', async () => {
    logger.info('[Job] Refreshing occupation lists…');
    try {
      await scrapeOccupationList();
      flushMemCache('occ');
      logger.info('[Job] Occupation lists refreshed ✓');
    } catch (err) {
      logger.error('[Job] Occupation lists failed', { error: err.message });
    }
  }, { name: 'occupation-lists' }));

  // ── Cache prune — every 30 minutes ───────────────────────────
  jobs.push(cron.schedule('*/30 * * * *', () => {
    const pruned = dbHelpers.cachePrune();
    if (pruned > 0) logger.debug(`[Job] Cache pruned ${pruned} expired entries`);
  }, { name: 'cache-prune' }));

  // ── Health log — every hour ───────────────────────────────────
  jobs.push(cron.schedule('30 * * * *', () => {
    const stats = getCacheStats();
    logger.info('[Job] Health check', {
      cacheKeys: stats.l1.keys,
      cacheHits: stats.l1.hits,
      cacheMisses: stats.l1.misses,
    });
  }, { name: 'health-log' }));

  logger.info(`[Scheduler] ${jobs.length} jobs scheduled.`);
  return jobs;
}

function stopScheduler() {
  jobs.forEach(job => {
    try { job.stop(); } catch { /* ignore */ }
  });
  logger.info('[Scheduler] All jobs stopped.');
}

function getJobStatus() {
  return jobs.map(job => ({
    name: job.options?.name || 'unnamed',
    running: job.getStatus ? job.getStatus() : 'unknown',
  }));
}

module.exports = { startScheduler, stopScheduler, getJobStatus };
