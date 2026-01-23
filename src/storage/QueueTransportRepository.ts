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
import {
  DidCommTransportQueuePostgres,
  type PostgresTransportQueuePostgresConfig,
} from '@credo-ts/didcomm-transport-queue-postgres'
import { DidCommPushNotificationsFcmRepository } from '@credo-ts/didcomm-push-notifications'

import type { FcmNotificationSender } from '../notifications/FcmNotificationSender.js'

/**
 * Send a push notification to a device associated with the connectionId
 * @param agentContext
 * @param connectionId
 * @param notificationSender
 * @param logger
 * @returns
 */
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

/**
 * In-memory implementation of the DidCommQueueTransportRepository
 */
type InMemoryQueuedMessage = QueuedDidCommMessage & {
  connectionId: string
  recipientDids: string[]
}
/**
 * In-memory implementation of the DidCommQueueTransportRepository with push notifications
 */
export class InMemoryQueueTransportRepository implements DidCommQueueTransportRepository {
  private readonly messages: InMemoryQueuedMessage[] = []

  public constructor(private readonly notificationSender?: FcmNotificationSender, private readonly logger?: Logger) {}

  public getAvailableMessageCount(agentContext: AgentContext, options: GetAvailableMessageCountOptions) {
    const { connectionId, recipientDid } = options
    const filtered = this.messages.filter(
      (msg) =>
        msg.connectionId === connectionId && (recipientDid === undefined || msg.recipientDids.includes(recipientDid))
    )
    return filtered.length
  }

  public takeFromQueue(agentContext: AgentContext, options: TakeFromQueueOptions) {
    const { connectionId, recipientDid, limit, deleteMessages } = options
    const filtered = this.messages.filter(
      (msg) =>
        msg.connectionId === connectionId && (recipientDid === undefined || msg.recipientDids.includes(recipientDid))
    )
    const slice = limit ? filtered.slice(0, limit) : filtered
    if (deleteMessages) {
      this.removeMessages(agentContext, { connectionId, messageIds: slice.map((m) => m.id) })
    }
    return slice
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

/**
 * Postgres implementation of the DidCommQueueTransportRepository with push notifications
 */
export class PostgresQueueTransportRepository extends DidCommTransportQueuePostgres {
  public constructor(
    config: PostgresTransportQueuePostgresConfig,
    private readonly notificationSender?: FcmNotificationSender
  ) {
    super(config)
  }

  public override async addMessage(agentContext: AgentContext, options: AddMessageOptions) {
    agentContext.config.logger.debug(
      `[QueueTransport] Adding message to Postgres queue for connection ${options.connectionId}`
    )
    const id = await super.addMessage(agentContext, options)
    void sendPushNotification(agentContext, options.connectionId, this.notificationSender, agentContext.config.logger)
    return id
  }
}
