import type { ServerConfig } from './env'

/**
 * Structured JSON logging in production, readable lines in development.
 * One line per event, so it can be shipped to any log aggregator as-is.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
export type LogLevel = keyof typeof LEVELS

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
}

export function createLogger(config: Pick<ServerConfig, 'logLevel' | 'nodeEnv'>): Logger {
  const threshold = LEVELS[config.logLevel]
  const structured = config.nodeEnv === 'production'

  function emit(level: LogLevel, message: string, base: Record<string, unknown>, fields?: Record<string, unknown>) {
    if (LEVELS[level] < threshold) return
    const record = { level, time: new Date().toISOString(), message, ...base, ...fields }
    const line = structured
      ? JSON.stringify(record)
      : `${record.time} ${level.toUpperCase().padEnd(5)} ${message}${
          Object.keys({ ...base, ...fields }).length ? ` ${JSON.stringify({ ...base, ...fields })}` : ''
        }`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }

  function build(base: Record<string, unknown>): Logger {
    return {
      debug: (m, f) => emit('debug', m, base, f),
      info: (m, f) => emit('info', m, base, f),
      warn: (m, f) => emit('warn', m, base, f),
      error: (m, f) => emit('error', m, base, f),
      child: (bindings) => build({ ...base, ...bindings }),
    }
  }

  return build({})
}
