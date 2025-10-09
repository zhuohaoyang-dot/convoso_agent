const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    return log;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Create transports
const transports = [
  new winston.transports.Console({
    format: consoleFormat,
    level: config.logLevel
  })
];

// Add file transport if enabled
if (config.logToFile) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, `convoso-${timestamp}.log`),
      format: customFormat,
      level: config.logLevel
    })
  );
}

// Create logger
const logger = winston.createLogger({
  level: config.logLevel,
  transports
});

module.exports = logger;