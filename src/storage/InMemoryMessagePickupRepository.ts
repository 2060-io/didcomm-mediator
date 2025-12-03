import type {
  Logger,
  QueuedMessage,
  AddMessageOptions,
  GetAvailableMessageCountOptions,
  RemoveMessagesOptions,
  TakeFromQueueOptions,
} from '@credo-ts/core'
import { injectable, MessagePickupRepository, utils } from '@credo-ts/core'
import { DidCommMediatorAgent } from '../agent/DidCommMediatorAgent'
import { FcmNotificationSender } from '../notifications/FcmNotificationSender'

interface InMemoryQueuedMessage extends QueuedMessage {
  connectionId: string
  recipientKeys: string[]
}

@injectable()
export class InMemoryMessagePickupRepository implements MessagePickupRepository {
  private logger?: Logger
  private messages: InMemoryQueuedMessage[]
  private agent?: DidCommMediatorAgent
  private notificationSender: FcmNotificationSender | undefined
  private sendSilentNotifications: boolean

  public constructor(notificationSender: FcmNotificationSender, logger?: Logger, sendSilentNotifications = false) {
    this.logger = logger
    this.notificationSender = notificationSender
    this.sendSilentNotifications = sendSilentNotifications
    this.messages = []
  }

  public setAgent(agent: DidCommMediatorAgent) {
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
      `[InMemoryMessagePickupRepository] Taking ${messagesToTake} messages from queue for connection ${connectionId}`
    )
    if (deleteMessages) {
      this.removeMessages({ connectionId, messageIds: messages.map((msg) => msg.id) })
    }

    return messages
  }

  public async addMessage(options: AddMessageOptions) {
    const { connectionId, recipientDids, payload } = options
    this.logger?.info(`[InMemoryMessagePickupRepository] Adding message for connection ${connectionId}`)

    const id = utils.uuid()
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
        this.logger?.info(`[InMemoryMessagePickupRepository] Send notification for connection ${connectionId}`)
        if (this.notificationSender)
          await this.notificationSender.sendMessage(token, 'messageId', this.sendSilentNotifications)
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
