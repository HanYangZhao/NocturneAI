// src/app/logger.tsx

// Logging levels: 'debug' < 'info' < 'warn' < 'error' < 'none'
const LEVELS = ['debug', 'info', 'warn', 'error', 'none'] as const;
type LogLevel = typeof LEVELS[number];

// Get log level from env (default: 'info')
const envLevel =
  typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_LOG_LEVEL
    ? process.env.NEXT_PUBLIC_LOG_LEVEL.toLowerCase()
    : (typeof window !== 'undefined' && (window as any).NEXT_PUBLIC_LOG_LEVEL)
      ? (window as any).NEXT_PUBLIC_LOG_LEVEL.toLowerCase()
      : 'info';

const currentLevel: LogLevel = LEVELS.includes(envLevel as LogLevel)
  ? (envLevel as LogLevel)
  : 'info';

function shouldLog(level: LogLevel) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(currentLevel);
}

export const logger = {
  debug: (...args: any[]) => shouldLog('debug') && console.debug('[DEBUG]', ...args),
  info: (...args: any[]) => shouldLog('info') && console.info('[INFO]', ...args),
  warn: (...args: any[]) => shouldLog('warn') && console.warn('[WARN]', ...args),
  error: (...args: any[]) => shouldLog('error') && console.error('[ERROR]', ...args),
};

export default logger;
