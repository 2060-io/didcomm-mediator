import crypto from 'crypto'
import { utils, type AgentContext, type Logger } from '@credo-ts/core'
import type {
  AddMessageOptions,
  GetAvailableMessageCountOptions,
  RemoveMessagesOptions,
  TakeFromQueueOptions,
  QueuedDidCommMessage,
  DidCommQueueTransportRepository,
} from '@credo-ts/didcomm'
import { DidCommPushNotificationsFcmRepository } from '@credo-ts/didcomm-push-notifications'

import type { FcmNotificationSender } from '../notifications/FcmNotificationSender.js'

const sendPushNotification = async (
  agentContext: AgentContext,
  connectionId: string,
  notificationSender?: FcmNotificationSender,
  logger?: Logger
) => {
  if (!notificationSender) return
  try {
    logger?.debug(`[QueueTransport] initialize sending push notification for connection ${connectionId}`)
    const repo = agentContext.dependencyManager.resolve(DidCommPushNotificationsFcmRepository)
    const record = await repo.findSingleByQuery(agentContext, { connectionId })
    const token = record?.deviceToken
    if (token) {
      logger?.debug(
        `[QueueTransport] Found FCM token for connection ${connectionId}, with ${token} sending notification`
      )
      await notificationSender.sendMessage(token, connectionId)
      return
    }
    logger?.debug(`[QueueTransport] no FCM token found for connection ${connectionId}, skipping notification`)
  } catch (error) {
    logger?.error(`[QueueTransport] Failed to send notification: ${error}`)
  }
}

type InMemoryQueuedMessage = QueuedDidCommMessage & {
  connectionId: string
  recipientDids: string[]
  state: 'pending' | 'sending'
}

/**
 * In-memory implementation of the DidCommQueueTransportRepository with push notifications.
 * Intended for local testing only; production deployments should use the Postgres transport queue.
 */
export class InMemoryDidCommQueueTransportRepository implements DidCommQueueTransportRepository {
  private readonly messages: InMemoryQueuedMessage[] = []

  public constructor(private readonly notificationSender?: FcmNotificationSender, private readonly logger?: Logger) {}

  public getAvailableMessageCount(agentContext: AgentContext, options: GetAvailableMessageCountOptions) {
    const { connectionId, recipientDid } = options
    const filtered = this.messages.filter(
      (msg) =>
        msg.connectionId === connectionId &&
        msg.state === 'pending' &&
        (recipientDid === undefined || msg.recipientDids.includes(recipientDid))
    )
    return filtered.length
  }

  public takeFromQueue(agentContext: AgentContext, options: TakeFromQueueOptions) {
    const { connectionId, recipientDid, limit, deleteMessages } = options
    let filtered = this.messages.filter(
      (msg) =>
        msg.connectionId === connectionId &&
        msg.state === 'pending' &&
        (recipientDid === undefined || msg.recipientDids.includes(recipientDid))
    )
    const messagesToTake = limit ?? filtered.length
    filtered = filtered.slice(0, messagesToTake)

    for (const msg of filtered) {
      const index = this.messages.findIndex((item) => item.id === msg.id)
      if (index !== -1) this.messages[index].state = 'sending'
    }

    if (deleteMessages) {
      this.removeMessages(agentContext, { connectionId, messageIds: filtered.map((m) => m.id) })
    }
    return filtered
  }

  public addMessage(agentContext: AgentContext, options: AddMessageOptions) {
    const { connectionId, recipientDids, payload } = options
    const id = crypto.randomUUID?.() ?? utils.uuid()
    this.messages.push({
      id,
      connectionId,
      recipientDids,
      encryptedMessage: payload,
      receivedAt: options.receivedAt ?? new Date(),
      state: 'pending',
    })
    void sendPushNotification(
      agentContext,
      connectionId,
      this.notificationSender,
      this.logger ?? agentContext.config.logger
    )
    return id
  }

  public removeMessages(_agentContext: AgentContext, options: RemoveMessagesOptions) {
    const { messageIds } = options
    for (const messageId of messageIds) {
      const index = this.messages.findIndex((item) => item.id === messageId)
      if (index > -1) this.messages.splice(index, 1)
    }
  }
}
