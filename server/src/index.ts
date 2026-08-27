import { buildServer } from './app'

/**
 * Entry point. Boots the service and wires signal handling.
 */
function main(): void {
  let built: ReturnType<typeof buildServer>
  try {
    built = buildServer()
  } catch (error) {
    console.error(`[startup] configuration error: ${(error as Error).message}`)
    process.exit(1)
    return
  }

  const { httpServer, config, logger, shutdown } = built

  httpServer.listen(config.port, () => {
    logger.info('multiplayer server listening', {
      port: config.port,
      env: config.nodeEnv,
      allowedOrigins: config.allowedOrigins,
    })
  })

  const stop = (signal: string) => {
    logger.info('received signal', { signal })
    void shutdown().then(() => process.exit(0))
  }

  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))

  // A crashed-but-running process serves errors forever; exit and let the
  // supervisor restart cleanly.
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error: error.message, stack: error.stack })
    void shutdown().then(() => process.exit(1))
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { reason: String(reason) })
  })
}

main()

export { buildServer } from './app'
