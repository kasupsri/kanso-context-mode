export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVELS: ReadonlySet<LogLevel> = new Set(['debug', 'info', 'warn', 'error']);
let currentLevel: LogLevel = 'info';

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '[unserializable metadata]';
  }
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

const envLevel = process.env['LOG_LEVEL'];
if (envLevel && LOG_LEVELS.has(envLevel as LogLevel)) {
  currentLevel = envLevel as LogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    return `${prefix} ${message} ${safeStringify(data)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  setLevel(level: LogLevel): void {
    setLogLevel(level);
  },
  getLevel(): LogLevel {
    return getLogLevel();
  },
  debug(message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      process.stderr.write(formatMessage('debug', message, data) + '\n');
    }
  },
  info(message: string, data?: unknown): void {
    if (shouldLog('info')) {
      process.stderr.write(formatMessage('info', message, data) + '\n');
    }
  },
  warn(message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      process.stderr.write(formatMessage('warn', message, data) + '\n');
    }
  },
  error(message: string, data?: unknown): void {
    if (shouldLog('error')) {
      process.stderr.write(formatMessage('error', message, data) + '\n');
    }
  },
};
