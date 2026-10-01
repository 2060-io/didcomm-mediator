import 'reflect-metadata'

import { ConsoleLogger } from '@credo-ts/core'
import { DidCommTransportQueuePostgres } from '@credo-ts/didcomm-transport-queue-postgres'
import { agentDependencies } from '@credo-ts/node'

import { initMediator } from './agent/initDidCommMediatorAgent.js'
import { AgentLogger } from './config/logger.js'
import {
  ADMIN_API_KEY,
  ADMIN_CLEANUP_CRON,
  ADMIN_CLEANUP_ENABLED,
  ADMIN_CLEANUP_INACTIVE_DAYS,
  ADMIN_CORS_ORIGIN,
  ADMIN_HOST,
  ADMIN_PORT,
  AGENT_ENDPOINTS,
  AGENT_LOG_LEVEL,
  AGENT_PORT,
  AGENT_PUBLIC_DID,
  HTTP_SUPPORT,
  KEY_DERIVATION_METHOD,
  MPR_POSTGRES_DATABASE_NAME,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  SHORTEN_INVITATION_BASE_URL,
  SHORTEN_URL_CLEANUP_INTERVAL_SECONDS,
  WALLET_KEY,
  WALLET_NAME,
  WS_SUPPORT,
} from './config/constants.js'
import { askarPostgresConfig, keyDerivationMethodMap } from './config/wallet.js'
import { deriveShortenBaseFromPublicDid } from './util/invitationBase.js'
import { bootstrapNest } from './nest/bootstrap.js'
import type { AdminConfig } from './nest/admin/admin-config.js'

const logger = new ConsoleLogger(AGENT_LOG_LEVEL)

// Maximum time we wait for a graceful shutdown before forcing process exit.
// Should be lower than k8s `terminationGracePeriodSeconds` to leave room for
// stdout/stderr flushing and container runtime cleanup.
const SHUTDOWN_TIMEOUT_MS = 15_000

async function run() {
  logger.info(`Cloud Agent started on port ${AGENT_PORT}`)

  // Fail-closed: the admin Nest app enforces `X-Admin-Api-Key` and is bound to
  // 0.0.0.0 by default, so starting without a key would leave an unauthenticated
  // mutation surface open on the pod network. Operators who want to run without
  // the admin API entirely should drop the admin Service/port in their deployment.
  if (!ADMIN_API_KEY) {
    logger.error('ADMIN_API_KEY must be set. Refusing to start without an admin API key.')
    process.exit(1)
  }

  try {
    const computedShortenBase =
      SHORTEN_INVITATION_BASE_URL ?? (await deriveShortenBaseFromPublicDid(AGENT_PUBLIC_DID)) ?? 'http://localhost:4000'
    logger.info(`Using shorten invitation base URL: ${computedShortenBase}`)

    const mediator = await initMediator({
      config: {
        logger: new AgentLogger(AGENT_LOG_LEVEL),
        autoUpdateStorageOnStartup: true,
      },
      wallet: {
        id: WALLET_NAME,
        key: WALLET_KEY,
        keyDerivationMethod: keyDerivationMethodMap[KEY_DERIVATION_METHOD ?? 'ARGON2I_MOD'],
        storage: POSTGRES_HOST ? askarPostgresConfig : undefined,
      },
      did: AGENT_PUBLIC_DID,
      port: AGENT_PORT,
      enableWs: WS_SUPPORT,
      enableHttp: HTTP_SUPPORT,
      dependencies: agentDependencies,
      postgresUser: POSTGRES_USER,
      postgresPassword: POSTGRES_PASSWORD,
      postgresHost: POSTGRES_HOST,
      messagePickupPostgresDatabaseName: MPR_POSTGRES_DATABASE_NAME,
      shortenInvitationBaseUrl: computedShortenBase,
      shortenUrlCleanupIntervalSeconds: SHORTEN_URL_CLEANUP_INTERVAL_SECONDS,
      endpoints: AGENT_ENDPOINTS,
      // The Nest PublicModule owns `/.well-known/did.json`, `/.well-known/did.jsonl`
      // and `/s`; we also defer `agent.initialize()` until after the Nest public
      // app has mounted its controllers on the shared Express instance.
      autoInitialize: false,
      registerPublicHttpRoutes: false,
    })

    const adminConfig: AdminConfig = {
      port: ADMIN_PORT,
      host: ADMIN_HOST,
      apiKey: ADMIN_API_KEY,
      corsOrigin: ADMIN_CORS_ORIGIN,
      cleanup: {
        enabled: ADMIN_CLEANUP_ENABLED,
        inactiveDays: ADMIN_CLEANUP_INACTIVE_DAYS,
        cron: ADMIN_CLEANUP_CRON,
      },
      postgresBackend: mediator.queueTransportRepository instanceof DidCommTransportQueuePostgres,
      publicDid: AGENT_PUBLIC_DID,
      endpoints: AGENT_ENDPOINTS,
    }

    const nest = await bootstrapNest({
      mediator,
      adminConfig,
      postgres:
        POSTGRES_HOST && POSTGRES_USER && POSTGRES_PASSWORD
          ? {
              user: POSTGRES_USER,
              password: POSTGRES_PASSWORD,
              host: POSTGRES_HOST,
              database: MPR_POSTGRES_DATABASE_NAME ?? 'messagepickuprepository',
            }
          : undefined,
      logger: {
        log: (msg: string) => logger.info(msg),
        warn: (msg: string) => logger.warn(msg),
        error: (msg: string) => logger.error(msg),
      },
    })

    // Finally bring the agent online: this starts the HttpInboundTransport
    // listener, wires the WebSocket upgrade, and initializes the Credo modules.
    await mediator.finalize()

    // Graceful shutdown on SIGTERM/SIGINT.
    let shuttingDown = false
    const handleShutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) return
      shuttingDown = true
      logger.info(`[${signal}] Shutting down...`)

      const forceExit = setTimeout(() => {
        logger.error(`[${signal}] Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit.`)
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)
      forceExit.unref()

      const agentContext = mediator.agent.context
      ;(async () => {
        try {
          await nest.shutdown()
          logger.info(`[${signal}] Nest apps shutdown complete.`)
        } catch (error) {
          logger.error(`[${signal}] Error during Nest shutdown: ${error}`)
        }
        try {
          await mediator.agent.shutdown()
          logger.info(`[${signal}] Agent shutdown complete.`)
        } catch (error) {
          logger.error(`[${signal}] Error during agent.shutdown(): ${error}`)
        }
        if (mediator.queueTransportRepository instanceof DidCommTransportQueuePostgres) {
          try {
            await mediator.queueTransportRepository.shutdown(agentContext)
            logger.info(`[${signal}] Postgres transport queue shutdown complete.`)
          } catch (error) {
            logger.error(`[${signal}] Error during queueTransportRepository.shutdown(): ${error}`)
          }
        }
        process.exit(0)
      })()
    }

    process.once('SIGTERM', handleShutdown)
    process.once('SIGINT', handleShutdown)
  } catch (error) {
    logger.error(`${error}`)
    process.exit(1)
  }

  logger.info(`DIDComm mediator initialized OK`)
}

run()
