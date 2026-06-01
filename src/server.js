/**
 * PR Plus Backend — Main Server
 * Node.js + Express | Australian Immigration Data API
 */
require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const morgan     = require('morgan');

const config     = require('./config');
const { initDb } = require('./config/database');
const routes     = require('./routes/index');
const { limiter, errorHandler, notFoundHandler, requestLogger } = require('./middleware/index');
const { startScheduler } = require('./jobs/scheduler');
const logger     = require('./utils/logger');

const app = express();

// ── Security & Compression ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // API — no HTML
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      config.frontendUrl,
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
    ];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    logger.warn('[CORS] Blocked:', origin);
    cb(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods:     ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: true,
}));

// ── Body Parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HTTP Request Logging ──────────────────────────────────────────
if (config.nodeEnv !== 'test') {
  app.use(morgan('combined', {
    stream: { write: msg => logger.http(msg.trim()) },
    skip:   (req) => req.path === '/api/v1/health', // skip health checks
  }));
}
app.use(requestLogger);

// ── Rate Limiting ─────────────────────────────────────────────────
app.use('/api/', limiter);

// ── API Routes ────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ── Root ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  name:    'PR Plus API',
  version: '1.0.0',
  docs:    '/api/v1/health',
  github:  'https://github.com/your-org/prplus-backend',
}));

// ── 404 & Error Handlers ──────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────
async function start() {
  try {
    // 1. Initialise DB (creates tables if they don't exist)
    initDb();
    logger.info('✅ Database ready');

    // 2. Seed with static data if tables are empty
    const { seedIfEmpty } = require('./scripts/seedDatabase');
    await seedIfEmpty();

    // 3. Start cron jobs
    startScheduler();
    logger.info('✅ Scheduler started');

    // 4. Boot server
    const server = app.listen(config.port, () => {
      logger.info(`✅ PR Plus API running on http://localhost:${config.port}`);
      logger.info(`   Environment: ${config.nodeEnv}`);
      logger.info(`   Frontend:    ${config.frontendUrl}`);
    });

    // 5. Graceful shutdown
    const shutdown = (signal) => {
      logger.info(`[${signal}] Shutting down gracefully…`);
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000); // force after 10s
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });

    return server;
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

start();

module.exports = app; // for testing
