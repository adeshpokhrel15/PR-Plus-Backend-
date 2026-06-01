const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const config = require('../config');

// ── Global rate limiter ───────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    logger.warn('[RateLimit] Too many requests', { ip: req.ip, path: req.path });
    res.status(429).json({
      success: false,
      error:   'Too many requests. Please wait before retrying.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    });
  },
});

// Tighter limiter for scrape-trigger endpoints
const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max:      5,
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Scrape endpoint rate limited. Max 5/min.' });
  },
});

// ── Global error handler ──────────────────────────────────────────
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = config.nodeEnv === 'production' && status === 500
    ? 'Internal server error'
    : err.message;

  logger.error('[Error]', {
    status,
    message: err.message,
    stack:   config.nodeEnv !== 'production' ? err.stack : undefined,
    path:    req.path,
    method:  req.method,
    ip:      req.ip,
  });

  res.status(status).json({
    success: false,
    error:   message,
    ...(config.nodeEnv !== 'production' && { stack: err.stack }),
  });
}

// ── 404 handler ───────────────────────────────────────────────────
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error:   `Route not found: ${req.method} ${req.path}`,
    docs:    '/api/v1/health',
  });
}

// ── Request logger ────────────────────────────────────────────────
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger[level]?.(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  next();
}

module.exports = { limiter, scrapeLimiter, errorHandler, notFoundHandler, requestLogger };
