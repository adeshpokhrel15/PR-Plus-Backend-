/**
 * Department of Home Affairs Scraper
 * Target: https://immi.homeaffairs.gov.au
 *
 * Scrapes:
 *  - SkillSelect invitation round results (points cutoffs + invitation counts)
 *  - Occupation list changes
 *  - News/announcements
 */
const cheerio = require('cheerio');
const { fetchHtml, fetchJson, fetchBuffer, sleep } = require('../../utils/httpClient');
const { getDb } = require('../../config/database');
const logger = require('../../utils/logger');
const config = require('../../config');

// ── Invitation Rounds ─────────────────────────────────────────────
async function scrapeInvitationRounds() {
  logger.info('[DHA] Scraping invitation rounds…');
  const results = [];

  try {
    const html = await fetchHtml(config.urls.dha.invitationRounds);
    const $ = cheerio.load(html);

    // DHA publishes invitation rounds in a table on this page.
    // The table has columns: Round date | Visa | Lowest points | Invitations
    $('table').each((_, table) => {
      const headers = [];
      $(table).find('th').each((_, th) => headers.push($(th).text().trim().toLowerCase()));

      // Look for tables that contain 'points' or 'invitation'
      if (!headers.some(h => h.includes('point') || h.includes('invitation'))) return;

      $(table).find('tbody tr').each((_, row) => {
        const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
        if (cells.length < 3) return;

        // Parse common DHA table formats
        const round = parseRoundRow(cells, headers);
        if (round) results.push(round);
      });
    });

    if (results.length === 0) {
      logger.warn('[DHA] No round data found in HTML — site structure may have changed. Using fallback parse.');
      return parseAlternativeFormat($);
    }

    logger.info(`[DHA] Found ${results.length} invitation round entries`);
    await saveRoundsToDb(results);
    return results;
  } catch (err) {
    logger.error('[DHA] Failed to scrape invitation rounds', { error: err.message });
    return getDbRounds(); // fall back to cached DB data
  }
}

function parseRoundRow(cells, headers) {
  // Try to map cells to known fields flexibly
  try {
    // Common pattern: Date | Visa | Points | Invitations
    const dateStr = cells[0] || cells[1];
    const visa = extractVisa(cells.join(' '));
    const points = extractNumber(cells.find(c => /\d{2,3}/.test(c) && parseInt(c) > 50 && parseInt(c) <= 120));
    const invitations = extractNumber(cells.find(c => /\d{2,5}/.test(c) && parseInt(c) > 100));

    if (!dateStr || !visa || !points) return null;

    return {
      roundDate:    normaliseDate(dateStr),
      visaSubclass: visa,
      lowestPoints: points,
      invitations:  invitations || null,
      sourceUrl:    config.urls.dha.invitationRounds,
    };
  } catch {
    return null;
  }
}

function parseAlternativeFormat($) {
  // Try looking for data in script tags or other patterns
  const scriptData = [];
  $('script').each((_, el) => {
    const content = $(el).html() || '';
    if (content.includes('points') && content.includes('189')) {
      // DHA sometimes embeds JSON in script tags
      const match = content.match(/\[{.*?}\]/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          scriptData.push(...parsed);
        } catch { /* ignore */ }
      }
    }
  });
  return scriptData;
}

function extractVisa(text) {
  if (/189/.test(text)) return '189';
  if (/190/.test(text)) return '190';
  if (/491/.test(text)) return '491';
  if (/494/.test(text)) return '494';
  return null;
}

function extractNumber(str) {
  if (!str) return null;
  const n = parseInt(str.replace(/[^0-9]/g, ''));
  return isNaN(n) ? null : n;
}

function normaliseDate(str) {
  if (!str) return null;
  // Handle formats: "June 2024", "Jun 2024", "01/06/2024", "2024-06-01"
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch { /* try other formats */ }
  return str.trim();
}

async function saveRoundsToDb(rounds) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO invitation_rounds
      (round_date, visa_subclass, lowest_points, invitations, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) stmt.run(r.roundDate, r.visaSubclass, r.lowestPoints, r.invitations, r.sourceUrl);
  });
  insertMany(rounds);
}

function getDbRounds() {
  return getDb().prepare(
    'SELECT * FROM invitation_rounds ORDER BY round_date DESC LIMIT 72'
  ).all();
}

// ── Occupation List ────────────────────────────────────────────────
async function scrapeOccupationList() {
  logger.info('[DHA] Scraping occupation lists…');
  try {
    const html = await fetchHtml(config.urls.dha.occupationList);
    const $ = cheerio.load(html);
    const occupations = [];

    // The SOL page has accordion/tab sections for MLTSSL, STSOL, ROL
    const lists = {
      mltssl: false,
      stsol:  false,
      rol:    false,
    };

    let currentList = null;
    $('h2, h3, h4, table').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().toLowerCase();

      if (tag.match(/h[234]/)) {
        if (text.includes('mltssl') || text.includes('medium and long')) currentList = 'mltssl';
        else if (text.includes('stsol') || text.includes('short-term'))  currentList = 'stsol';
        else if (text.includes('rol') || text.includes('regional'))       currentList = 'rol';
        return;
      }

      if (tag === 'table' && currentList) {
        $(el).find('tbody tr').each((_, row) => {
          const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
          if (cells.length >= 2 && /\d{6}/.test(cells[0])) {
            occupations.push({
              code:    cells[0].trim(),
              title:   cells[1].trim(),
              list:    currentList,
              assessing: cells[2]?.trim() || null,
            });
          }
        });
      }
    });

    logger.info(`[DHA] Found ${occupations.length} occupations`);
    return occupations;
  } catch (err) {
    logger.error('[DHA] Failed to scrape occupation list', { error: err.message });
    return [];
  }
}

// ── News / Announcements ───────────────────────────────────────────
async function scrapeDhaNews() {
  logger.info('[DHA] Scraping news and announcements…');
  const news = [];
  try {
    const html = await fetchHtml(`${config.urls.dha.base}/what-we-do/skilled-migration/general-skilled-migration`);
    const $ = cheerio.load(html);

    $('article, .news-item, .update-item, [class*="news"], [class*="update"]').each((_, el) => {
      const title = $(el).find('h2, h3, h4, .title').first().text().trim();
      const summary = $(el).find('p').first().text().trim();
      const link = $(el).find('a').first().attr('href');
      const dateText = $(el).find('time, [class*="date"]').first().text().trim();

      if (title && title.length > 10) {
        news.push({
          title,
          summary: summary.slice(0, 300),
          url:     link ? (link.startsWith('http') ? link : config.urls.dha.base + link) : null,
          publishedAt: normaliseDate(dateText),
          source: 'Department of Home Affairs',
          state:  'National',
          topic:  categorizeTopic(title),
        });
      }
    });

    logger.info(`[DHA] Found ${news.length} news items`);
    return news;
  } catch (err) {
    logger.error('[DHA] Failed to scrape news', { error: err.message });
    return [];
  }
}

function categorizeTopic(title) {
  const t = title.toLowerCase();
  if (t.includes('occupation'))  return 'Occupation List';
  if (t.includes('points'))      return 'Points Test';
  if (t.includes('nomination'))  return 'Nomination';
  if (t.includes('invitation'))  return 'Invitation Round';
  if (t.includes('budget'))      return 'Policy';
  if (t.includes('regional'))    return 'Regional';
  if (t.includes('strategy'))    return 'Strategy';
  if (t.includes('skills'))      return 'Skills Assessment';
  return 'General';
}

module.exports = {
  scrapeInvitationRounds,
  scrapeOccupationList,
  scrapeDhaNews,
  getDbRounds,
};
