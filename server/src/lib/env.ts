import dotenv from 'dotenv'

dotenv.config()

/**
 * Validated configuration.
 *
 * The server refuses to start on bad input rather than discovering it at the
 * first request. In production it additionally insists on an explicit CORS
 * allowlist - the old build hardcoded a wildcard `*.vercel.app` regex, which
 * let any subdomain anyone could register talk to the game server.
 */

export type NodeEnv = 'development' | 'production' | 'test'

export interface ServerConfig {
  nodeEnv: NodeEnv
  port: number
  allowedOrigins: string[]
  /** Regex forms, only permitted outside production. */
  allowedOriginPatterns: RegExp[]
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  trustProxy: boolean
  /** Chain the signatures are expected to be produced for. Informational. */
  chainId: number
  maxHttpBodyBytes: number
}

class ConfigError extends Error {}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigError(`${name} must be a non-negative integer, got "${raw}"`)
  }
  return value
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (['1', 'true', 'yes'].includes(raw.toLowerCase())) return true
  if (['0', 'false', 'no'].includes(raw.toLowerCase())) return false
  throw new ConfigError(`${name} must be a boolean, got "${raw}"`)
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export function loadConfig(): ServerConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as NodeEnv
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new ConfigError(`NODE_ENV must be development, production or test, got "${nodeEnv}"`)
  }

  const explicitOrigins = parseOrigins(process.env.ALLOWED_ORIGINS)
  const isProduction = nodeEnv === 'production'

  if (isProduction && explicitOrigins.length === 0) {
    throw new ConfigError(
      'ALLOWED_ORIGINS must list the exact frontend origins in production, ' +
        'e.g. ALLOWED_ORIGINS=https://farm.example.com'
    )
  }

  const allowedOrigins = explicitOrigins.length > 0
    ? explicitOrigins
    : ['http://localhost:3000', 'http://127.0.0.1:3000']

  // Preview-deployment patterns are a development convenience only.
  const allowedOriginPatterns = isProduction
    ? []
    : parseOrigins(process.env.ALLOWED_ORIGIN_PATTERNS).map((p) => new RegExp(p))

  const logLevel = (process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug')) as ServerConfig['logLevel']
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be debug, info, warn or error, got "${logLevel}"`)
  }

  return {
    nodeEnv,
    port: parseIntEnv('PORT', 3001),
    allowedOrigins,
    allowedOriginPatterns,
    logLevel,
    trustProxy: parseBoolEnv('TRUST_PROXY', isProduction),
    chainId: parseIntEnv('CHAIN_ID', 11155111),
    maxHttpBodyBytes: parseIntEnv('MAX_HTTP_BODY_BYTES', 16 * 1024),
  }
}

export function isOriginAllowed(origin: string | undefined, config: ServerConfig): boolean {
  // Same-origin and non-browser clients (health checks) send no Origin header.
  if (!origin) return true
  if (config.allowedOrigins.includes(origin)) return true
  return config.allowedOriginPatterns.some((pattern) => pattern.test(origin))
}
