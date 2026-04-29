import { ConsoleLogger } from '@credo-ts/core'
import { DidCommTransportQueuePostgres } from '@credo-ts/didcomm-transport-queue-postgres'
import { initMediator } from './agent/initDidCommMediatorAgent.js'
import { agentDependencies } from '@credo-ts/node'
import { AgentLogger } from './config/logger.js'
import {
  AGENT_ENDPOINTS,
  AGENT_LOG_LEVEL,
  AGENT_PORT,
  AGENT_PUBLIC_DID,
  HTTP_SUPPORT,
  KEY_DERIVATION_METHOD,
  POSTGRES_HOST,
  WALLET_KEY,
  WALLET_NAME,
  WS_SUPPORT,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  MPR_POSTGRES_DATABASE_NAME,
  SHORTEN_INVITATION_BASE_URL,
  SHORTEN_URL_CLEANUP_INTERVAL_SECONDS,
} from './config/constants.js'
import { askarPostgresConfig, keyDerivationMethodMap } from './config/wallet.js'
import { deriveShortenBaseFromPublicDid } from './util/invitationBase.js'

const logger = new ConsoleLogger(AGENT_LOG_LEVEL)

// Maximum time we wait for a graceful shutdown before forcing process exit.
// Should be lower than k8s `terminationGracePeriodSeconds` to leave room for
// stdout/stderr flushing and container runtime cleanup.
const SHUTDOWN_TIMEOUT_MS = 15_000

async function run() {
  logger.info(`Cloud Agent started on port ${AGENT_PORT}`)
  try {
    const computedShortenBase =
      SHORTEN_INVITATION_BASE_URL ?? (await deriveShortenBaseFromPublicDid(AGENT_PUBLIC_DID)) ?? 'http://localhost:4000'
    logger.info(`Using shorten invitation base URL: ${computedShortenBase}`)
    const { agent, queueTransportRepository } = await initMediator({
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
    })

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

      const agentContext = agent.context
      ;(async () => {
        try {
          await agent.shutdown()
          logger.info(`[${signal}] Agent shutdown complete.`)
        } catch (error) {
          logger.error(`[${signal}] Error during agent.shutdown(): ${error}`)
        }
        if (queueTransportRepository instanceof DidCommTransportQueuePostgres) {
          try {
            await queueTransportRepository.shutdown(agentContext)
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
