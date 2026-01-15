import { ConsoleLogger } from '@credo-ts/core'
import { initMediator } from './agent/initDidCommMediatorAgent.js'
import { agentDependencies } from '@credo-ts/node'
import { AgentLogger } from './config/logger.js'
import {
  AGENT_ENDPOINTS,
  AGENT_LOG_LEVEL,
  AGENT_NAME,
  AGENT_PORT,
  AGENT_PUBLIC_DID,
  HTTP_SUPPORT,
  KEY_DERIVATION_METHOD,
  POSTGRES_HOST,
  WALLET_KEY,
  WALLET_NAME,
  WS_SUPPORT,
  MPR_WS_URL,
  MPR_MAX_RECEIVE_BYTES,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  MPR_POSTGRES_DATABASE_NAME,
  SHORTEN_INVITATION_BASE_URL,
  SHORTEN_URL_CLEANUP_INTERVAL_SECONDS,
} from './config/constants.js'
import { askarPostgresConfig, keyDerivationMethodMap } from './config/wallet.js'
import { deriveShortenBaseFromPublicDid } from './util/invitationBase.js'

const logger = new ConsoleLogger(AGENT_LOG_LEVEL)

async function run() {
  logger.info(`Cloud Agent started on port ${AGENT_PORT}`)
  try {
    const computedShortenBase =
      SHORTEN_INVITATION_BASE_URL ?? (await deriveShortenBaseFromPublicDid(AGENT_PUBLIC_DID)) ?? 'http://localhost:4000'
    logger.info(`Using shorten invitation base URL: ${computedShortenBase}`)
    await initMediator({
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
  } catch (error) {
    logger.error(`${error}`)
    process.exit(1)
  }

  logger.info(`DIDComm mediator initialized OK`)
}

run()
