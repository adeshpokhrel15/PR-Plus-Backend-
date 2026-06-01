/**
 * PR Plus API Routes
 * Base: /api/v1
 */
const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const dataService = require('../services/dataService');
const { calculateTotal, checkEligibility, getBreakdown, getRecommendations, POINTS_TABLE, COMPETITIVE_CUTOFFS } = require('../utils/pointsCalculator');
const { getDb } = require('../config/database');
const { getJobStatus } = require('../jobs/scheduler');
const logger = require('../utils/logger');

// ── Validation middleware ─────────────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ════════════════════════════════════════════════════════════════
// GET /api/v1/health
// ════════════════════════════════════════════════════════════════
router.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    jobs:      getJobStatus(),
    cache:     dataService.getCacheStats(),
  });
});

// ════════════════════════════════════════════════════════════════
// POINTS & ELIGIBILITY
// ════════════════════════════════════════════════════════════════

// GET /api/v1/points/table — Official points table
router.get('/points/table', (req, res) => {
  res.json({ success: true, data: { table: POINTS_TABLE, cutoffs: COMPETITIVE_CUTOFFS } });
});

// POST /api/v1/points/calculate
router.post('/points/calculate',
  body('age').optional().isString(),
  body('english').optional().isString(),
  body('education').optional().isString(),
  validate,
  asyncHandler(async (req, res) => {
    const profile = req.body;
    const total     = calculateTotal(profile);
    const breakdown = getBreakdown(profile);
    const eligibility = checkEligibility(profile);
    const recommendations = getRecommendations(profile, parseInt(req.query.target) || 90);

    res.json({
      success: true,
      data: { total, breakdown, eligibility, recommendations, maxPossible: 120 },
    });
  })
);

// ════════════════════════════════════════════════════════════════
// INVITATION ROUNDS
// ════════════════════════════════════════════════════════════════

// GET /api/v1/invitations
router.get('/invitations',
  query('visa').optional().isIn(['189','190','491','494']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('page').optional().isInt({ min: 1 }),
  validate,
  asyncHandler(async (req, res) => {
    const { visa, limit = 24, page = 1 } = req.query;
    const data = await dataService.getInvitationRounds({
      visaSubclass: visa,
      limit:        parseInt(limit),
      page:         parseInt(page),
    });
    res.json({ success: true, data, meta: { visa, limit, page, fetchedAt: new Date().toISOString() } });
  })
);

// GET /api/v1/invitations/trends — Pivoted by date for charting
router.get('/invitations/trends', asyncHandler(async (req, res) => {
  const data = await dataService.getInvitationTrends();
  res.json({ success: true, data });
}));

// POST /api/v1/invitations/refresh — Manually trigger rescrape
router.post('/invitations/refresh', asyncHandler(async (req, res) => {
  const { scrapeInvitationRounds } = require('../services/scrapers/homeAffairs');
  dataService.flushMemCache('rounds');
  scrapeInvitationRounds().catch(e => logger.error('Manual rescrape failed', { e: e.message }));
  res.json({ success: true, message: 'Refresh triggered. Data will be updated shortly.' });
}));

// ════════════════════════════════════════════════════════════════
// STATE NOMINATIONS
// ════════════════════════════════════════════════════════════════

// GET /api/v1/states
router.get('/states', asyncHandler(async (req, res) => {
  const { state } = req.query;
  const data = await dataService.getStateNominations({ stateCode: state });
  res.json({ success: true, data, meta: { count: data.length, fetchedAt: new Date().toISOString() } });
}));

// GET /api/v1/states/:code
router.get('/states/:code',
  param('code').isIn(['NSW','VIC','QLD','WA','SA','TAS','ACT','NT']),
  validate,
  asyncHandler(async (req, res) => {
    const data = await dataService.getStateNominations({ stateCode: req.params.code });
    if (!data.length) return res.status(404).json({ success: false, message: 'State not found' });
    res.json({ success: true, data: data[0] });
  })
);

// POST /api/v1/states/refresh
router.post('/states/refresh', asyncHandler(async (req, res) => {
  dataService.flushMemCache('states');
  const { scrapeAllStates } = require('../services/scrapers/stateNomination');
  scrapeAllStates().catch(e => logger.error('State refresh failed', { e: e.message }));
  res.json({ success: true, message: 'State data refresh triggered.' });
}));

// ════════════════════════════════════════════════════════════════
// OCCUPATIONS
// ════════════════════════════════════════════════════════════════

// GET /api/v1/occupations
router.get('/occupations',
  query('search').optional().isString().isLength({ max: 100 }),
  query('demand').optional().isIn(['Critical','Very High','High','Medium','Low']),
  query('stream').optional().isIn(['189','190','491']),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  validate,
  asyncHandler(async (req, res) => {
    const { search, demand, category, stream, limit = 50, page = 1 } = req.query;
    const data = await dataService.getOccupations({ search, demand, category, stream, limit: parseInt(limit), page: parseInt(page) });
    res.json({ success: true, ...data });
  })
);

// GET /api/v1/occupations/:code
router.get('/occupations/:code',
  param('code').matches(/^\d{6}$/),
  validate,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const occ = db.prepare('SELECT * FROM occupations WHERE code = ?').get(req.params.code);
    if (!occ) return res.status(404).json({ success: false, message: 'Occupation not found' });
    res.json({ success: true, data: { ...occ, visa_streams: JSON.parse(occ.visa_streams || '[]') } });
  })
);

// ════════════════════════════════════════════════════════════════
// MIGRATION NEWS
// ════════════════════════════════════════════════════════════════

// GET /api/v1/news
router.get('/news',
  query('state').optional().isString(),
  query('topic').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validate,
  asyncHandler(async (req, res) => {
    const { state, topic, limit = 20, page = 1 } = req.query;
    const data = await dataService.getMigrationNews({ state, topic, limit: parseInt(limit), page: parseInt(page) });
    res.json({ success: true, ...data });
  })
);

// ════════════════════════════════════════════════════════════════
// OPEN DATA (data.gov.au)
// ════════════════════════════════════════════════════════════════

// GET /api/v1/opendata/datasets
router.get('/opendata/datasets', asyncHandler(async (req, res) => {
  const data = await dataService.getOpenDatasets();
  res.json({ success: true, data, source: 'data.gov.au' });
}));

// GET /api/v1/opendata/stats
router.get('/opendata/stats', asyncHandler(async (req, res) => {
  const data = await dataService.getProgramStats();
  res.json({ success: true, data, source: 'data.gov.au' });
}));

// ════════════════════════════════════════════════════════════════
// USER PROFILES
// ════════════════════════════════════════════════════════════════

// POST /api/v1/profiles
router.post('/profiles',
  body('alias').optional().isString().isLength({ max: 50 }),
  validate,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const id = uuidv4();
    const { alias, ...fields } = req.body;
    const total = calculateTotal(fields);

    db.prepare(`
      INSERT INTO user_profiles (id, alias, age_band, english_level, education,
        work_exp, aus_work_exp, partner_skills, aus_study, specialist_edu, nomination, total_points)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, alias || null, fields.age, fields.english, fields.education,
           fields.workExperience, fields.australianWork, fields.partnerSkills,
           fields.australianStudy, fields.specialistEducation, fields.nomination, total);

    res.status(201).json({ success: true, data: { id, totalPoints: total } });
  })
);

// GET /api/v1/profiles/:id
router.get('/profiles/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    res.json({ success: true, data: profile });
  })
);

// PUT /api/v1/profiles/:id
router.put('/profiles/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM user_profiles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Profile not found' });

    const { alias, ...fields } = req.body;
    const total = calculateTotal(fields);

    db.prepare(`
      UPDATE user_profiles SET
        alias = ?, age_band = ?, english_level = ?, education = ?,
        work_exp = ?, aus_work_exp = ?, partner_skills = ?,
        aus_study = ?, specialist_edu = ?, nomination = ?,
        total_points = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(alias || null, fields.age, fields.english, fields.education,
           fields.workExperience, fields.australianWork, fields.partnerSkills,
           fields.australianStudy, fields.specialistEducation, fields.nomination,
           total, req.params.id);

    res.json({ success: true, data: { id: req.params.id, totalPoints: total } });
  })
);

// ════════════════════════════════════════════════════════════════
// EOI TRACKER
// ════════════════════════════════════════════════════════════════

// GET /api/v1/eoi/:profileId
router.get('/eoi/:profileId',
  param('profileId').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const entries = getDb().prepare('SELECT * FROM eoi_entries WHERE profile_id = ? ORDER BY created_at DESC').all(req.params.profileId);
    res.json({ success: true, data: entries });
  })
);

// POST /api/v1/eoi
router.post('/eoi',
  body('profileId').optional().isUUID(),
  body('visaSubclass').isIn(['189','190','491','494']),
  body('occupation').isString().notEmpty(),
  body('pointsClaimed').optional().isInt({ min: 0, max: 120 }),
  body('status').optional().isString(),
  body('eoiDate').optional().isISO8601(),
  validate,
  asyncHandler(async (req, res) => {
    const id = uuidv4();
    const { profileId, visaSubclass, occupation, anzscoCode, pointsClaimed, status, eoiDate, invitationDate, lodgedDate, nominationState, notes } = req.body;

    getDb().prepare(`
      INSERT INTO eoi_entries (id, profile_id, visa_subclass, occupation, anzsco_code, points_claimed, status, eoi_date, invitation_date, lodged_date, nomination_state, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, profileId || null, visaSubclass, occupation, anzscoCode || null, pointsClaimed || null, status || 'EOI Submitted', eoiDate || null, invitationDate || null, lodgedDate || null, nominationState || null, notes || null);

    res.status(201).json({ success: true, data: { id } });
  })
);

// PUT /api/v1/eoi/:id
router.put('/eoi/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const existing = getDb().prepare('SELECT id FROM eoi_entries WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'EOI entry not found' });

    const { status, invitationDate, lodgedDate, nominationState, notes, pointsClaimed } = req.body;
    getDb().prepare(`
      UPDATE eoi_entries SET
        status = COALESCE(?, status),
        invitation_date = COALESCE(?, invitation_date),
        lodged_date = COALESCE(?, lodged_date),
        nomination_state = COALESCE(?, nomination_state),
        notes = COALESCE(?, notes),
        points_claimed = COALESCE(?, points_claimed),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status || null, invitationDate || null, lodgedDate || null, nominationState || null, notes || null, pointsClaimed || null, req.params.id);

    res.json({ success: true, data: { id: req.params.id } });
  })
);

// DELETE /api/v1/eoi/:id
router.delete('/eoi/:id', param('id').isUUID(), validate,
  asyncHandler(async (req, res) => {
    getDb().prepare('DELETE FROM eoi_entries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  })
);

// ════════════════════════════════════════════════════════════════
// VISA FEES (static, updated periodically)
// ════════════════════════════════════════════════════════════════
router.get('/visa-fees', (req, res) => {
  try {
    const fees = require('../../data/static/visa-fees.json');
    res.json({ success: true, data: fees });
  } catch {
    res.status(503).json({ success: false, message: 'Visa fee data unavailable' });
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN / CACHE MANAGEMENT
// ════════════════════════════════════════════════════════════════
router.post('/admin/flush-cache', asyncHandler(async (req, res) => {
  dataService.flushMemCache(req.query.pattern);
  res.json({ success: true, message: 'Cache flushed' });
}));

router.get('/admin/cache-stats', (req, res) => {
  res.json({ success: true, data: dataService.getCacheStats() });
});

module.exports = router;
