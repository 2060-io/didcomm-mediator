import type {
  Logger,
  QueuedMessage,
  AddMessageOptions,
  GetAvailableMessageCountOptions,
  RemoveMessagesOptions,
  TakeFromQueueOptions,
} from '@credo-ts/core'
import { injectable } from '@credo-ts/core'
import { CloudAgent } from '../agent/CloudAgent'
import { FcmNotificationSender } from '../notifications/FcmNotificationSender'
import { MessagePickupRepository } from '@credo-ts/core'
import { uuid } from '@credo-ts/core/build/utils/uuid'

interface InMemoryQueuedMessage extends QueuedMessage {
  connectionId: string
  recipientKeys: string[]
}

@injectable()
export class InMemoryMessagePickupRepository implements MessagePickupRepository {
  private logger?: Logger
  private messages: InMemoryQueuedMessage[]
  private agent?: CloudAgent
  private notificationSender: FcmNotificationSender | undefined

  public constructor(notificationSender: FcmNotificationSender, logger?: Logger) {
    this.logger = logger
    notificationSender.isInitialized() ? (this.notificationSender = notificationSender) : undefined
    this.messages = []
  }

  public setAgent(agent: CloudAgent) {
    this.agent = agent
  }

  public getAvailableMessageCount(options: GetAvailableMessageCountOptions): number | Promise<number> {
    const { connectionId, recipientDid } = options

    const messages = this.messages.filter(
      (msg) =>
        msg.connectionId === connectionId && (recipientDid === undefined || msg.recipientKeys.includes(recipientDid))
    )
    return messages.length
  }

  public takeFromQueue(options: TakeFromQueueOptions) {
    const { connectionId, recipientDid, limit, deleteMessages } = options

    const messages = this.messages.filter(
      (msg) =>
        msg.connectionId === connectionId && (recipientDid === undefined || msg.recipientKeys.includes(recipientDid))
    )

    const messagesToTake = limit ?? messages.length
    this.logger?.debug(
      `[CustomMessageRepository] Taking ${messagesToTake} messages from queue for connection ${connectionId}`
    )
    if (deleteMessages) {
      this.removeMessages({ connectionId, messageIds: messages.map((msg) => msg.id) })
    }

    return messages
  }

  public async addMessage(options: AddMessageOptions) {
    const { connectionId, recipientDids, payload } = options
    this.logger?.info(`[CustomMessageRepository] Adding message for connection ${connectionId}`)

    const id = uuid()
    this.messages.push({
      id,
      connectionId,
      encryptedMessage: payload,
      recipientKeys: recipientDids,
    })

    if (this.agent) {
      const connectionRecord = await this.agent.connections.findById(connectionId)

      const token = connectionRecord?.getTag('device_token') as string | null

      if (token) {
        this.logger?.info(`[CustomMessageRepository] Send notification for connection ${connectionId}`)
        if (this.notificationSender) await this.notificationSender.sendMessage(token, 'messageId')
      }
    }

    return id
  }

  public removeMessages(options: RemoveMessagesOptions) {
    const { messageIds } = options

    for (const messageId of messageIds) {
      const messageIndex = this.messages.findIndex((item) => item.id === messageId)
      if (messageIndex > -1) this.messages.splice(messageIndex, 1)
    }
  }
}
