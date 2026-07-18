const winston = require('winston');
const path = require('path');
const fs = require('fs');

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(info => `[${info.timestamp}] [${info.level}]: ${info.message}${info.stack ? '\n' + info.stack : ''}`)
    )
  })
];

// Skip the file transport during test runs so simulated log output from
// tests doesn't pollute the real app-*.log files used for diagnostics.
if (process.env.NODE_ENV !== 'test') {
  transports.push(new (require('winston-daily-rotate-file'))({
    filename: (() => {
      const logsDir = path.join(__dirname, '../../logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      return path.join(logsDir, 'app-%DATE%.log');
    })(),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '20m',
    format: winston.format.combine(
      winston.format.printf(info => `[${info.timestamp}] [${info.level}]: ${info.message}${info.stack ? '\n' + info.stack : ''}`)
    )
  }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports
});

module.exports = logger;
