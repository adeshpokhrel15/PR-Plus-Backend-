/**
 * State & Territory Nomination Scrapers
 * Targets: Each state/territory migration website
 *
 * Each scraper returns:
 * { stateCode, programName, status, occupations, notes, sourceUrl, fetchedAt }
 */
const cheerio = require('cheerio');
const { fetchHtml, sleep } = require('../../utils/httpClient');
const { getDb } = require('../../config/database');
const logger = require('../../utils/logger');
const config = require('../../config');

// ── Status keyword detection ──────────────────────────────────────
function detectStatus(text) {
  const t = text.toLowerCase();
  if (t.includes('closed') || t.includes('not accepting') || t.includes('quota reached')) return 'Closed';
  if (t.includes('invite only') || t.includes('expression of interest') || t.includes('roi')) return 'Invite Only';
  if (t.includes('open') || t.includes('now accepting') || t.includes('applications open')) return 'Open';
  if (t.includes('paused') || t.includes('suspended')) return 'Paused';
  return 'Check Website';
}

// ── Generic scrape helper ─────────────────────────────────────────
async function genericScrape(stateCode, url, programName) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const fullText = $('main, #main-content, .content, article, body').text();
    const status = detectStatus(fullText);

    // Try to find occupation mentions
    const occupations = [];
    $('li, td').each((_, el) => {
      const text = $(el).text().trim();
      if (/\d{6}/.test(text) || (text.length > 10 && text.length < 80 && !text.includes('\n'))) {
        // looks like an occupation entry
        occupations.push(text.slice(0, 80));
      }
    });

    // Find last update date
    const dateMatch = fullText.match(/(\d{1,2}\s+\w+\s+202[0-9]|202[0-9]-\d{2}-\d{2})/);
    const lastUpdated = dateMatch ? dateMatch[0] : null;

    // Extract any quota info
    const quotaMatch = fullText.match(/(\d[\d,]+)\s*(places?|quota|allocations?)/i);
    const quota = quotaMatch ? parseInt(quotaMatch[1].replace(',', '')) : null;

    const result = {
      stateCode,
      programName,
      status,
      quota,
      occupations: occupations.slice(0, 20),
      notes: extractNotes($, fullText),
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      lastUpdated,
    };

    await saveStateToDb(result);
    logger.info(`[STATE:${stateCode}] Status: ${status}`);
    return result;
  } catch (err) {
    logger.error(`[STATE:${stateCode}] Failed`, { error: err.message });
    return getDbState(stateCode) || fallbackState(stateCode, programName, url);
  }
}

function extractNotes($, fullText) {
  const notes = [];
  // Look for alert/notice boxes
  $('[class*="alert"], [class*="notice"], [class*="warning"], [class*="info"]').each((_, el) => {
    const t = $(el).text().trim().slice(0, 200);
    if (t.length > 20) notes.push(t);
  });
  // Look for key phrases in the full text
  const patterns = [
    /currently accepting[^.]+\./i,
    /applications? (are|is) [^.]+\./i,
    /program (is|has been)[^.]+\./i,
    /next round[^.]+\./i,
  ];
  for (const p of patterns) {
    const m = fullText.match(p);
    if (m) notes.push(m[0].trim().slice(0, 200));
  }
  return [...new Set(notes)].slice(0, 3).join(' | ') || null;
}

// ── Individual state scrapers ─────────────────────────────────────

async function scrapeNSW() {
  return genericScrape(
    'NSW',
    'https://www.nsw.gov.au/topics/skilled-worker-visa',
    'NSW Skilled Nominated Migration Program'
  );
}

async function scrapeVIC() {
  // VIC uses VISS (Victorian Invitation to Apply System)
  try {
    const html = await fetchHtml('https://business.vic.gov.au/visas-and-migrants/skilled-and-business-visas/skilled-migration-to-victoria');
    const $ = cheerio.load(html);
    const text = $('main').text();
    return {
      stateCode:   'VIC',
      programName: 'Skilled and Business Visas Victoria',
      status:      detectStatus(text),
      occupations: [],
      notes:       extractNotes($, text),
      sourceUrl:   'https://business.vic.gov.au/visas-and-migrants',
      fetchedAt:   new Date().toISOString(),
    };
  } catch (err) {
    logger.warn('[STATE:VIC] Using fallback', { error: err.message });
    return genericScrape('VIC', 'https://business.vic.gov.au', 'VIC Skilled Migration');
  }
}

async function scrapeQLD() {
  return genericScrape(
    'QLD',
    'https://migration.qld.gov.au/visa-options/skilled-worker/',
    'QLD Skilled Nominated Migration Program'
  );
}

async function scrapeWA() {
  return genericScrape(
    'WA',
    'https://migration.wa.gov.au/services/skilled-migration-western-australia',
    'Skilled Migration Western Australia'
  );
}

async function scrapeSA() {
  return genericScrape(
    'SA',
    'https://www.migration.sa.gov.au/skilled-migrants',
    'South Australia Skilled & Business Migration'
  );
}

async function scrapeTAS() {
  return genericScrape(
    'TAS',
    'https://www.skillsandworkforce.tas.gov.au/migrants/visas',
    'Tasmanian Skilled Nominated Migration'
  );
}

async function scrapeACT() {
  return genericScrape(
    'ACT',
    'https://www.act.gov.au/migration/skilled',
    'ACT Skilled Nominated Migration'
  );
}

async function scrapeNT() {
  return genericScrape(
    'NT',
    'https://migration.nt.gov.au/skilled-migration',
    'Northern Territory Skilled Nominated Migration'
  );
}

// ── Scrape all states ─────────────────────────────────────────────
async function scrapeAllStates() {
  logger.info('[STATES] Starting all state scrapes…');
  const scrapers = [scrapeNSW, scrapeVIC, scrapeQLD, scrapeWA, scrapeSA, scrapeTAS, scrapeACT, scrapeNT];
  const results = [];

  for (const scraper of scrapers) {
    try {
      const result = await scraper();
      results.push(result);
    } catch (err) {
      logger.error('[STATES] Scraper failed', { error: err.message });
    }
    await sleep(config.scraper.delay); // polite delay between state requests
  }

  logger.info(`[STATES] Completed. ${results.length} states updated.`);
  return results;
}

// ── DB helpers ────────────────────────────────────────────────────
async function saveStateToDb(state) {
  getDb().prepare(`
    INSERT OR REPLACE INTO state_nominations
      (state_code, program_name, status, quota, occupations, notes, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    state.stateCode, state.programName, state.status, state.quota || null,
    JSON.stringify(state.occupations), state.notes, state.sourceUrl,
    new Date().toISOString()
  );
}

function getDbState(stateCode) {
  return getDb().prepare('SELECT * FROM state_nominations WHERE state_code = ?').get(stateCode);
}

function getAllDbStates() {
  return getDb().prepare('SELECT * FROM state_nominations ORDER BY state_code').all();
}

function fallbackState(stateCode, programName, sourceUrl) {
  return {
    stateCode, programName, status: 'Check Website',
    occupations: [], notes: 'Unable to fetch live data — please visit the state website directly.',
    sourceUrl, fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  scrapeAllStates, scrapeNSW, scrapeVIC, scrapeQLD, scrapeWA,
  scrapeSA, scrapeTAS, scrapeACT, scrapeNT,
  getAllDbStates, getDbState,
};
