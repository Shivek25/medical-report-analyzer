/**
 * src/shared/logger.ts
 * Lightweight structured logger. Phase 1 can swap this for pino or winston.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getEnvLevel(): LogLevel {
  const raw = process.env['LOG_LEVEL'] ?? 'info';
  return (raw in LEVELS ? raw : 'info') as LogLevel;
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  const currentLevel = getEnvLevel();
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...(meta !== undefined ? { meta } : {}),
  };

  const formatted = JSON.stringify(entry);
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.info(formatted);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown): void => log('debug', message, meta),
  info: (message: string, meta?: unknown): void => log('info', message, meta),
  warn: (message: string, meta?: unknown): void => log('warn', message, meta),
  error: (message: string, meta?: unknown): void => log('error', message, meta),
};
