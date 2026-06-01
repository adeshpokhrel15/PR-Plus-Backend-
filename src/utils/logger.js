const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const { log } = require('../config');

// Ensure log directory exists
if (!fs.existsSync(log.dir)) fs.mkdirSync(log.dir, { recursive: true });

const fmt = winston.format;

const logger = winston.createLogger({
  level: log.level,
  format: fmt.combine(
    fmt.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    fmt.errors({ stack: true }),
    fmt.json()
  ),
  transports: [
    // Console — coloured, human-readable
    new winston.transports.Console({
      format: fmt.combine(
        fmt.colorize(),
        fmt.printf(({ timestamp, level, message, ...meta }) => {
          const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${extras}`;
        })
      ),
    }),
    // Daily rotating file
    new DailyRotateFile({
      dirname:       log.dir,
      filename:      'prplus-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      maxFiles:      '14d',
      maxSize:       '20m',
      zippedArchive: true,
    }),
    // Errors only
    new DailyRotateFile({
      level:         'error',
      dirname:       log.dir,
      filename:      'prplus-error-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      maxFiles:      '30d',
    }),
  ],
});

module.exports = logger;
