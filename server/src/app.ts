import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { createServer, type Server as HttpServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { loadConfig, isOriginAllowed, type ServerConfig } from './lib/env'
import { createLogger, type Logger } from './lib/logger'
import { AuthService } from './lib/auth'
import { PlayerRegistry } from './game/PlayerRegistry'
import { KeyedRateLimiter } from './lib/rateLimit'
import { registerSocketHandlers, startMaintenance, type GameServer } from './socket/handlers'
import { PROTOCOL_VERSION, WORLD } from './protocol'

export interface BuiltServer {
  app: Express
  httpServer: HttpServer
  io: GameServer
  registry: PlayerRegistry
  auth: AuthService
  config: ServerConfig
  logger: Logger
  shutdown: () => Promise<void>
}

/**
 * Builds the HTTP + Socket.IO service.
 *
 * Exported separately from the entry point so tests can boot a real server on
 * an ephemeral port and drive it over a real socket connection.
 */
export function buildServer(overrides: Partial<ServerConfig> = {}): BuiltServer {
  const config = { ...loadConfig(), ...overrides }
  const logger = createLogger(config)

  const app = express()
  if (config.trustProxy) {
    // Required for correct client IPs (and therefore rate limiting) behind a
    // load balancer. One hop only - trusting the whole chain would let a
    // client forge X-Forwarded-For and evade limits.
    app.set('trust proxy', 1)
  }

  app.disable('x-powered-by')
  app.use(helmet({
    // The API serves JSON only; no inline content to protect.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }))

  const corsOptions: cors.CorsOptions = {
    origin(origin, callback) {
      if (isOriginAllowed(origin, config)) {
        callback(null, true)
      } else {
        logger.warn('blocked CORS origin', { origin })
        callback(new Error('Origin not allowed'))
      }
    },
    credentials: true,
    methods: ['GET', 'POST'],
  }
  app.use(cors(corsOptions))

  // Bounded body: the API takes no large payloads, and an unbounded parser is
  // a trivial memory-pressure vector.
  app.use(express.json({ limit: config.maxHttpBodyBytes }))

  app.use(rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  }))

  const httpServer = createServer(app)
  const registry = new PlayerRegistry()
  const auth = new AuthService()
  const challengeLimiter = new KeyedRateLimiter(10, 0.2)

  const io: GameServer = new SocketServer(httpServer, {
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin ?? undefined, config)) callback(null, true)
        else callback(new Error('Origin not allowed'))
      },
      credentials: true,
    },
    pingTimeout: 30_000,
    pingInterval: 25_000,
    // Payloads are small; anything larger is not a legitimate game message.
    maxHttpBufferSize: 16 * 1024,
    connectionStateRecovery: {
      maxDisconnectionDuration: 30_000,
      skipMiddlewares: false,
    },
  })

  const deps = { io, registry, auth, logger, challengeLimiter }
  registerSocketHandlers(deps)
  const stopMaintenance = startMaintenance(deps)

  // ------------------------------------------------------------- routes
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      players: registry.count,
      zones: registry.zoneCount,
      timestamp: new Date().toISOString(),
    })
  })

  // Liveness/readiness split, for orchestrators that distinguish them.
  app.get('/health/live', (_req, res) => { res.json({ status: 'ok' }) })
  app.get('/health/ready', (_req, res) => { res.json({ status: 'ok', players: registry.count }) })

  /**
   * Aggregate stats only.
   *
   * The old server exposed a `/players` route listing every connected player.
   * Even without raw addresses that is a live roster of who is online, handed
   * out to anyone who asks, so it is gone - the count is all the UI needs.
   */
  app.get('/stats', (_req: Request, res: Response) => {
    res.json({
      onlinePlayers: registry.count,
      activeZones: registry.zoneCount,
      world: { width: WORLD.width, height: WORLD.height, zoneSize: WORLD.zoneSize },
      uptimeSeconds: Math.floor(process.uptime()),
    })
  })

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Express identifies an error handler by its four-parameter signature. The
  // previous one took three, so it was registered as ordinary middleware and
  // never ran - every unhandled error fell through to Express's default HTML
  // stack-trace page.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('unhandled request error', { error: err.message, stack: err.stack })
    if (res.headersSent) return
    const isCors = err.message === 'Origin not allowed'
    res.status(isCors ? 403 : 500).json({
      error: isCors ? 'Origin not allowed' : 'Internal server error',
    })
  })

  // ----------------------------------------------------------- shutdown
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('shutting down')

    stopMaintenance()

    // Tell clients before dropping them, so they can show "reconnecting"
    // rather than a silent freeze.
    io.emit('server:error', { code: 'INTERNAL', message: 'Server is restarting.' })
    await io.close()
    registry.reset()
    auth.reset()

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
      // Do not hang forever on a straggling keep-alive connection.
      setTimeout(resolve, 5_000).unref?.()
    })
    logger.info('shutdown complete')
  }

  return { app, httpServer, io, registry, auth, config, logger, shutdown }
}
