import type { AgentDependencies } from '@credo-ts/core'
import { Agent, DependencyManager, InitConfig } from '@credo-ts/core'
import { askarNodeJS, KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { createRequire } from 'module'
import {
  DidCommHttpOutboundTransport,
  DidCommMessageForwardingStrategy,
  DidCommMimeType,
  DidCommModule,
  type DidCommOutboundTransport,
  DidCommWsOutboundTransport,
  type DidCommInboundTransport,
  type DidCommQueueTransportRepository,
  DidCommMediatorPickupStrategy,
} from '@credo-ts/didcomm'
import { PushNotificationsFcmModule } from '@credo-ts/didcomm-push-notifications'
import { DidCommShortenUrlModule, ShortenUrlRole } from '@2060.io/credo-ts-didcomm-shorten-url'

interface AgentOptions<Modules> {
  config: InitConfig
  modules?: Modules
  dependencies: AgentDependencies
}

export class DidCommMediatorAgent extends Agent {
  public did?: string

  public constructor(
    options: AgentOptions<Record<string, unknown>>,
    did?: string,
    dependencyManager?: DependencyManager
  ) {
    super(options, dependencyManager)
    this.did = did
  }
}

export interface CloudAgentOptions {
  config: InitConfig
  endpoints: string[]
  port: number
  did?: string
  enableHttp?: boolean
  enableWs?: boolean
  dependencies: AgentDependencies
  inboundTransports: DidCommInboundTransport[]
  outboundTransports: DidCommOutboundTransport[]
  queueTransportRepository: DidCommQueueTransportRepository
  wallet: {
    id: string
    key: string
    keyDerivationMethod?: `${KdfMethod.Argon2IInt}` | `${KdfMethod.Argon2IMod}` | `${KdfMethod.Raw}`
    storage?: unknown
  }
}

type AskarPostgresStorageConfig = {
  type: 'postgres'
  config: {
    host: string
    connectTimeout?: number
    idleTimeout?: number
    maxConnections?: number
    minConnections?: number
  }
  credentials: { account: string; password: string; adminAccount?: string; adminPassword?: string }
}

const cjsRequire = createRequire(import.meta.url)
const askarShared = cjsRequire('@openwallet-foundation/askar-shared')
askarShared.registerAskar?.({ askar: askarNodeJS })
const askarModulePromise = import('@credo-ts/askar')

export const createMediator = async (options: CloudAgentOptions): Promise<DidCommMediatorAgent> => {
  options.config.logger?.debug?.(`Askar backend registered: ${Boolean(askarShared.askar)}`)
  const { AskarModule } = await askarModulePromise
  const askar = askarNodeJS

  return new DidCommMediatorAgent(
    {
      config: {
        ...options.config,
      },
      dependencies: options.dependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: options.wallet.id,
            key: options.wallet.key,
            keyDerivationMethod: options.wallet.keyDerivationMethod,
            database: options.wallet.storage as AskarPostgresStorageConfig | undefined,
          },
          enableKms: true,
          enableStorage: true,
        }),
        didcomm: new DidCommModule({
          didCommMimeType: DidCommMimeType.V1,
          transports: {
            inbound: options.inboundTransports,
            outbound: options.outboundTransports.length
              ? options.outboundTransports
              : [new DidCommWsOutboundTransport(), new DidCommHttpOutboundTransport()],
          },
          connections: {
            autoAcceptConnections: true,
          },
          mediator: {
            autoAcceptMediationRequests: true,
            messageForwardingStrategy: DidCommMessageForwardingStrategy.QueueAndLiveModeDelivery,
          },
          mediationRecipient: {
            mediatorPickupStrategy: DidCommMediatorPickupStrategy.PickUpV2LiveMode,
          },
          basicMessages: false,
          credentials: false,
          proofs: false,
          queueTransportRepository: options.queueTransportRepository,
          endpoints: options.endpoints,
        }),
        pushNotifications: new PushNotificationsFcmModule(),
        shortenUrl: new DidCommShortenUrlModule({
          roles: [ShortenUrlRole.UrlShortener],
          maximumRequestedValiditySeconds: 1 * 24 * 60 * 60,
        }),
      },
    },
    options.did
  )
}
