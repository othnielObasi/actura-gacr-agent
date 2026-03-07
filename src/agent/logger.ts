/**
 * Structured Logger
 * Consistent log format with levels, timestamps, and context
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', FATAL: '\x1b[41m\x1b[37m',
};
const RESET = '\x1b[0m';

let minLevel: LogLevel = 'INFO';
const logHistory: Array<{ ts: string; level: LogLevel; module: string; msg: string; data?: unknown }> = [];
const MAX_HISTORY = 500;

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function formatTime(): string {
  return new Date().toISOString().slice(11, 23);
}

function write(level: LogLevel, module: string, msg: string, data?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const ts = formatTime();
  const entry = { ts, level, module, msg, data };

  // Store in memory
  logHistory.push(entry);
  if (logHistory.length > MAX_HISTORY) logHistory.shift();

  // Console output
  const color = LEVEL_COLOR[level];
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  console.log(`${color}${ts} [${level.padEnd(5)}]${RESET} [${module}] ${msg}${dataStr}`);
}

/** Create a scoped logger for a module */
export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: unknown) => write('DEBUG', module, msg, data),
    info: (msg: string, data?: unknown) => write('INFO', module, msg, data),
    warn: (msg: string, data?: unknown) => write('WARN', module, msg, data),
    error: (msg: string, data?: unknown) => write('ERROR', module, msg, data),
    fatal: (msg: string, data?: unknown) => write('FATAL', module, msg, data),
  };
}

/** Get recent logs (for dashboard/MCP) */
export function getRecentLogs(limit: number = 50): typeof logHistory {
  return logHistory.slice(-limit);
}

/** Get error logs only */
export function getErrorLogs(limit: number = 20): typeof logHistory {
  return logHistory.filter(l => l.level === 'ERROR' || l.level === 'FATAL').slice(-limit);
}
