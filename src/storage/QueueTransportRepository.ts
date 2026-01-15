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

const notify = async (
  agentContext: AgentContext,
  connectionId: string,
  notificationSender?: FcmNotificationSender,
  logger?: Logger
) => {
  if (!notificationSender) return
  try {
    const repo = agentContext.dependencyManager.resolve(DidCommPushNotificationsFcmRepository)
    const record = await repo.findSingleByQuery(agentContext, { connectionId })
    const token = record?.deviceToken
    if (token) {
      await notificationSender.sendMessage(token, connectionId)
    }
  } catch (error) {
    logger?.error(`[QueueTransport] Failed to send notification: ${error}`)
  }
}

type InMemoryQueuedMessage = QueuedDidCommMessage & {
  connectionId: string
  recipientDids: string[]
}

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
    void notify(agentContext, connectionId, this.notificationSender, this.logger ?? agentContext.config.logger)
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

export class PostgresQueueTransportRepository extends DidCommTransportQueuePostgres {
  public constructor(
    config: PostgresTransportQueuePostgresConfig,
    private readonly notificationSender?: FcmNotificationSender
  ) {
    super(config)
  }

  public override async addMessage(agentContext: AgentContext, options: AddMessageOptions) {
    const id = await super.addMessage(agentContext, options)
    void notify(agentContext, options.connectionId, this.notificationSender, agentContext.config.logger)
    return id
  }
}
