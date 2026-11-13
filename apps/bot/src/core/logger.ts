export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

type LogListener = (entry: LogEntry) => void;

export class Logger {
  private entries: LogEntry[] = [];
  private listeners = new Set<LogListener>();
  private nextId = 1;
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  private write(
    level: LogLevel,
    scope: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
      meta,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${scope}]`;
    const serializedMeta = meta ? ` ${JSON.stringify(meta)}` : '';
    if (level === 'error') {
      console.error(`${prefix} ${message}${serializedMeta}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}${serializedMeta}`);
    } else if (level !== 'debug' || process.env.NODE_ENV === 'development') {
      console.log(`${prefix} ${message}${serializedMeta}`);
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Ignore broken log subscribers
      }
    }
  }

  debug(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write('debug', scope, message, meta);
  }

  info(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write('info', scope, message, meta);
  }

  warn(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write('warn', scope, message, meta);
  }

  error(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write('error', scope, message, meta);
  }

  getRecent(limit = 100): LogEntry[] {
    return this.entries.slice(-limit);
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
