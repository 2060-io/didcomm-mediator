import { ConsoleLogger, KeyDerivationMethod } from '@credo-ts/core'
import { initCloudAgent } from './agent/initCloudAgent'
import { agentDependencies } from '@credo-ts/node'
import { AgentLogger } from './config/logger'
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
  POSTGRES_DATABASE_NAME,
} from './config/constants'
import { askarPostgresConfig, keyDerivationMethodMap } from './config/wallet'

const logger = new ConsoleLogger(AGENT_LOG_LEVEL)

async function run() {
  logger.info(`Cloud Agent started on port ${AGENT_PORT}`)
  try {
    await initCloudAgent({
      config: {
        label: AGENT_NAME,
        endpoints: AGENT_ENDPOINTS,
        walletConfig: {
          id: WALLET_NAME,
          key: WALLET_KEY,
          keyDerivationMethod: keyDerivationMethodMap[KEY_DERIVATION_METHOD ?? KeyDerivationMethod.Argon2IMod],
          storage: POSTGRES_HOST ? askarPostgresConfig : undefined,
        },
        autoUpdateStorageOnStartup: true,
        backupBeforeStorageUpdate: false,
        logger: new AgentLogger(AGENT_LOG_LEVEL),
      },
      did: AGENT_PUBLIC_DID,
      port: AGENT_PORT,
      enableWs: WS_SUPPORT,
      enableHttp: HTTP_SUPPORT,
      dependencies: agentDependencies,
      messagePickupRepositoryWebSocketUrl: MPR_WS_URL,
      messagePickupMaxReceiveBytes: MPR_MAX_RECEIVE_BYTES,
      postgresUser: POSTGRES_USER,
      postgresPassword: POSTGRES_PASSWORD,
      postgresHost: POSTGRES_HOST,
      postgresDatabaseName: POSTGRES_DATABASE_NAME,
    })
  } catch (error) {
    logger.error(`${error}`)
    process.exit(1)
  }

  logger.info(`Cloud Agent initialized OK`)
}

run()
