require('dotenv').config();

module.exports = {
  port:         parseInt(process.env.PORT) || 4000,
  nodeEnv:      process.env.NODE_ENV || 'development',
  frontendUrl:  process.env.FRONTEND_URL || 'http://localhost:3000',
  dbPath:       process.env.DB_PATH || './data/prplus.db',

  cache: {
    ttlInvitations: parseInt(process.env.CACHE_TTL_INVITATIONS) || 86400,
    ttlStates:      parseInt(process.env.CACHE_TTL_STATES)      || 21600,
    ttlNews:        parseInt(process.env.CACHE_TTL_NEWS)        || 3600,
    ttlOccupations: parseInt(process.env.CACHE_TTL_OCCUPATIONS) || 604800,
  },

  scraper: {
    timeout:    parseInt(process.env.SCRAPER_TIMEOUT_MS)     || 15000,
    retries:    parseInt(process.env.SCRAPER_RETRY_ATTEMPTS) || 3,
    delay:      parseInt(process.env.SCRAPER_DELAY_MS)       || 2000,
    userAgent:  process.env.USER_AGENT || 'PRPlus-Bot/1.0',
  },

  dataGovAu: {
    base: process.env.DATA_GOV_AU_BASE || 'https://data.gov.au/api/3/action',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS)      || 900000,
    max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)   || 100,
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir:   process.env.LOG_DIR   || './logs',
  },

  anthropicKey: process.env.ANTHROPIC_API_KEY || '',

  // Official Australian government URLs
  urls: {
    dha: {
      base:            'https://immi.homeaffairs.gov.au',
      invitationRounds:'https://immi.homeaffairs.gov.au/visas/working-in-australia/skillselect/invitation-rounds',
      visaStats:       'https://immi.homeaffairs.gov.au/visas/working-in-australia/skillselect/invitation-rounds/2024',
      occupationList:  'https://immi.homeaffairs.gov.au/visas/working-in-australia/skill-occupation-list',
      visaFees:        'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing',
    },
    states: {
      nsw: 'https://www.nsw.gov.au/topics/skilled-worker-visa',
      vic: 'https://business.vic.gov.au/visas-and-migrants',
      qld: 'https://migration.qld.gov.au',
      wa:  'https://migration.wa.gov.au',
      sa:  'https://www.migration.sa.gov.au',
      tas: 'https://www.skillsandworkforce.tas.gov.au',
      act: 'https://www.act.gov.au/migration',
      nt:  'https://migration.nt.gov.au',
    },
    dataGovAu: 'https://data.gov.au/dataset',
    abs: 'https://www.abs.gov.au/statistics/people/population/overseas-migration/latest-release',
  },
};
