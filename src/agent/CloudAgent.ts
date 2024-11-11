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

type CloudAgentModules = {
  askar: AskarModule
  connections: ConnectionsModule
  mediator: MediatorModule
  messagePickup: MessagePickupModule
  pushNotifications: PushNotificationsFcmModule
}

interface AgentOptions<ServiceAgentModules> {
  config: InitConfig
  modules?: ServiceAgentModules
  dependencies: AgentDependencies
}

export class CloudAgent extends Agent<CloudAgentModules> {
  public did?: string

  public constructor(options: AgentOptions<CloudAgentModules>, did?: string, dependencyManager?: DependencyManager) {
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
}

export const createCloudAgent = (
  options: CloudAgentOptions,
  messagePickupRepository: MessagePickupRepository
): CloudAgent => {
  return new CloudAgent(
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
      },
    },
    options.did
  )
}
