import {
  Agent,
  AgentDependencies,
  ConnectionsModule,
  DependencyManager,
  InitConfig,
  MediatorModule,
  MessagePickupModule,
  MessagePickupRepository,
} from '@credo-ts/core'
import { AskarModule } from '@credo-ts/askar'
import '@hyperledger/aries-askar-nodejs'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import { PushNotificationsFcmModule } from '@credo-ts/push-notifications'
import { MessageForwardingStrategy } from '@credo-ts/core/build/modules/routing/MessageForwardingStrategy'
import { DidCommShortenUrlModule, ShortenUrlRole } from '@2060.io/credo-ts-didcomm-shorten-url'

type DidCommMediatorAgentModules = {
  askar: AskarModule
  connections: ConnectionsModule
  mediator: MediatorModule
  messagePickup: MessagePickupModule
  pushNotifications: PushNotificationsFcmModule
  shortenUrl: DidCommShortenUrlModule
}

interface AgentOptions<Modules> {
  config: InitConfig
  modules?: Modules
  dependencies: AgentDependencies
}

export class DidCommMediatorAgent extends Agent<DidCommMediatorAgentModules> {
  public did?: string

  public constructor(
    options: AgentOptions<DidCommMediatorAgentModules>,
    did?: string,
    dependencyManager?: DependencyManager
  ) {
    super(options, dependencyManager)
    this.did = did
  }
}

export interface CloudAgentOptions {
  config: InitConfig
  port: number
  did?: string
  enableHttp?: boolean
  enableWs?: boolean
  dependencies: AgentDependencies
  messagePickupRepositoryWebSocketUrl?: string
  messagePickupMaxReceiveBytes?: number
  postgresUser?: string
  postgresPassword?: string
  postgresHost?: string
  messagePickupPostgresDatabaseName?: string
  shortenInvitationBaseUrl?: string
  shortenUrlCleanupIntervalMs?: number
}

export const createMediator = (
  options: CloudAgentOptions,
  messagePickupRepository: MessagePickupRepository
): DidCommMediatorAgent => {
  return new DidCommMediatorAgent(
    {
      config: options.config,
      dependencies: options.dependencies,
      modules: {
        askar: new AskarModule({ ariesAskar }),
        connections: new ConnectionsModule({ autoAcceptConnections: true }),
        mediator: new MediatorModule({
          messageForwardingStrategy: MessageForwardingStrategy.QueueOnly,
        }),
        messagePickup: new MessagePickupModule({ messagePickupRepository }),
        pushNotifications: new PushNotificationsFcmModule(),
        shortenUrl: new DidCommShortenUrlModule({
          roles: [ShortenUrlRole.UrlShortener],
        }),
      },
    },
    options.did
  )
}
