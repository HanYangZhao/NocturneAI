// src/app/logger.tsx

// Logging levels: 'debug' < 'info' < 'warn' < 'error' < 'none'
const LEVELS = ['debug', 'info', 'warn', 'error', 'none'] as const;
type LogLevel = typeof LEVELS[number];


// Always use process.env.NEXT_PUBLIC_LOG_LEVEL (Next.js exposes this to browser)
const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL?.toLowerCase() || 'debug';
const currentLevel: LogLevel = LEVELS.includes(envLevel as LogLevel)
  ? (envLevel as LogLevel)
  : 'debug';
function shouldLog(level: LogLevel) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(currentLevel);
}

export const logger = {
  debug: (...args: unknown[]) => shouldLog('debug') && console.info('[DEBUG]', ...args),
  info: (...args: unknown[]) => shouldLog('info') && console.info('[INFO]', ...args),
  warn: (...args: unknown[]) => shouldLog('warn') && console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => shouldLog('error') && console.error('[ERROR]', ...args),
};

export default logger;
