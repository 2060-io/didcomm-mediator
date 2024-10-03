import type { Logger, MessagePickupLiveSessionRemovedEvent, MessagePickupLiveSessionSavedEvent } from '@credo-ts/core'
import {
  AddMessageOptions,
  GetAvailableMessageCountOptions,
  MessagePickupEventTypes,
  MessagePickupRepository,
  QueuedMessage,
  RemoveMessagesOptions,
  TakeFromQueueOptions,
} from '@credo-ts/core'
import { MessagePickupSession } from '@credo-ts/core/build/modules/message-pickup/MessagePickupSession'
import { injectable } from '@credo-ts/core'
import { CloudAgent } from '../agent/CloudAgent'
import * as os from 'os'
import { FcmNotificationSender } from '../notifications/FcmNotificationSender'
import { MessagePickupDbService } from '../database/MessagePickupDbService'

@injectable()
export class CustomMessageRepository implements MessagePickupRepository {
  private logger?: Logger
  private agent?: CloudAgent
  private dbPubSubFixed?: boolean
  private subscription: { unsubscribe: () => void } | void | undefined
  private instanceName?: string
  private notificationSender: FcmNotificationSender
  private MessagePickupDbService: MessagePickupDbService

  public constructor(
    notificationSender: FcmNotificationSender,
    MessagePickupDbService: MessagePickupDbService,
    logger?: Logger
  ) {
    this.logger = logger
    this.notificationSender = notificationSender
    this.MessagePickupDbService = MessagePickupDbService
  }

  public async initialize(agent: CloudAgent, dbPubSubFixed: boolean) {
    try {
      // Database initialization
      await this.MessagePickupDbService.initialize()

      // define variables to use pubSub solution

      this.dbPubSubFixed = dbPubSubFixed

      // Agent initialization
      this.agent = agent

      // Instance name initialization
      this.instanceName = os.hostname()

      // Create pubSubInstance with channel fixed mode
      this.logger?.debug(`[initialize] Listener Mode channel fixed: ${this.dbPubSubFixed} `)

      if (dbPubSubFixed) {
        this.logger?.debug(`[initialize] initialize pubSubInstance with fixed channel `)

        await this.MessagePickupDbService.subscribePubSubWithFixedChannel(async (message) => {
          const connectionId = message.message
          this.logger?.debug(
            `[subscribePubSubWithFixedChannel] Publish new Message on ${this.instanceName} to connectionId:  ${connectionId} `
          )

          if (!agent) throw new Error('Agent is not defined')

          const pickupLiveSession = await agent.messagePickup.getLiveModeSession({ connectionId })

          this.logger?.debug(
            `[subscribePubSubWithFixedChannel] find pickupLiveSession ${pickupLiveSession?.id} to connectionId ${connectionId} `
          )
          if (pickupLiveSession) {
            this.logger?.debug(
              `[subscribePubSubWithFixedChannel] found LiveSession for connectionId ${connectionId}, Delivering Messages`
            )

            agent.messagePickup.deliverMessagesFromQueue({ pickupSessionId: pickupLiveSession.id })
          }
        })
      }

      // Event handler LiveSessionSaved
      agent.events.on(MessagePickupEventTypes.LiveSessionSaved, async (data: MessagePickupLiveSessionSavedEvent) => {
        const liveSessionData = data.payload.session
        this.logger?.info(
          `***Session ${liveSessionData.id} saved for ${JSON.stringify(data.payload.session.connectionId)}, ***`
        )
        //introduce method to add record connectionId to DB
        await this.MessagePickupDbService.addLiveSession(
          liveSessionData.id,
          liveSessionData.connectionId,
          this.instanceName!
        )
        const connectionId = liveSessionData.connectionId

        if (!this.dbPubSubFixed) {
          this.logger?.debug(`[initialize] initialize subscribe with connectionId ${connectionId}`)
          this.subscription = await this.MessagePickupDbService.subscribePubSub(connectionId, async () => {
            this.logger?.debug(
              `[subscribePubSub] Publish new Message in channel to ${connectionId}
            )}`
            )
            if (!agent) throw new Error('Agent is not defined')

            const pickupLiveSession = await agent.messagePickup.getLiveModeSession({ connectionId })

            this.logger?.debug(
              `[subscribePubSub] find pickupLiveSession ${pickupLiveSession} to connectionId ${connectionId} `
            )
            if (pickupLiveSession) {
              this.logger?.debug(
                `[subscribePubSub] found LiveSession connectionId ${connectionId}, Delivering Messages`
              )

              agent.messagePickup.deliverMessagesFromQueue({ pickupSessionId: pickupLiveSession.id })
            }
          })
        }
      })

      // Event handler LiveSessionRemove
      agent.events.on(
        MessagePickupEventTypes.LiveSessionRemoved,
        async (data: MessagePickupLiveSessionRemovedEvent) => {
          const connectionId = data.payload.session.connectionId
          this.logger?.info(`***Session removed for ${connectionId}***`)
          //verify message sending method
          this.MessagePickupDbService.checkPendingMessagesInQueue(connectionId)
          //delete record LiveSession to DB
          await this.MessagePickupDbService.removeLiveSession(connectionId)
          //if (!this.dbPubSubFixed) this.subscription?.unsubscribe()
        }
      )
    } catch (error) {
      this.logger?.error(`[initialize] Error:  ${error}`)
      throw new Error()
    }
  }

  public async takeFromQueue(options: TakeFromQueueOptions): Promise<QueuedMessage[]> {
    const { connectionId, limit, deleteMessages, recipientDid } = options
    this.logger?.info(`[takeFromQueue] Initializing method for ConnectionId: ${connectionId}, Limit: ${limit}`)

    try {
      // Obtain messages from the database
      const storedMessages = await this.MessagePickupDbService.getMessagesInQueue(
        connectionId,
        limit,
        deleteMessages,
        recipientDid
      )
      return storedMessages
    } catch (error) {
      this.logger?.error(`[takeFromQueue] Error: ${error}`)
      return []
    }
  }

  public async getAvailableMessageCount(options: GetAvailableMessageCountOptions): Promise<number> {
    const { connectionId } = options
    this.logger?.debug(`[getAvailableMessageCount] Initializing method`)

    try {
      const messageCount = await this.MessagePickupDbService.getQueuedMessagesCount(connectionId)

      this.logger?.debug(`[getAvailableMessageCount] Count ${messageCount}`)

      return messageCount
    } catch (error) {
      this.logger?.error(`[getAvailableMessageCount] Error: ${error}`)
      return 0
    }
  }

  public async addMessage(options: AddMessageOptions): Promise<string> {
    const { connectionId, recipientDids, payload } = options
    this.logger?.debug(`[addMessage] initializing new message for connectionId ${connectionId}`)
    let liveSession: MessagePickupSession | undefined
    if (!this.agent) throw new Error('Agent is not defined')

    try {
      liveSession = await this.getLocalliveSession(connectionId)

      const result = await this.MessagePickupDbService.addMessageToQueue(
        connectionId,
        recipientDids,
        payload,
        liveSession
      )

      if (!result) throw new Error('[addMessages] Error adding messages to queue')

      const { messageId, receivedAt } = result
      this.logger?.debug(`[addMessage] result addMessageToQueue messageId: ${messageId} -- receiveAt: ${receivedAt} `)

      this.logger?.debug(
        `[addMessage] add message for ${connectionId} and result ${messageId} and receivedAt ${receivedAt}`
      )
      // If there is an ongoing live session, don't publish to pub/sub channel, as we already know we are the ones
      // holding client web socket: simply go ahead and deliver any queued message

      if (liveSession) {
        await this.agent.messagePickup.deliverMessages({
          pickupSessionId: liveSession.id,
          messages: [
            {
              id: messageId,
              receivedAt: receivedAt,
              encryptedMessage: payload,
            },
          ],
        })
      } else {
        //Make verification if Agent is LiveSession on another instance if not session send notification
        const verifyInstance = await this.MessagePickupDbService.getLiveSession(connectionId)

        if (!verifyInstance) {
          this.logger?.debug(`[addMessage] connectionId not found in other instace ${verifyInstance}`)
          const connectionRecord = await this.agent.connections.findById(connectionId)
          const token = connectionRecord?.getTag('device_token') as string | null

          this.logger?.debug(`[addMessage] Push notification parameters token: ${token}; MessageId: ${messageId} `)

          if (token && messageId) {
            await this.notificationSender.sendMessage(token, messageId)
          }
        } else {
          //introduce new handle subscribe publish ConnectionId or Channel
          if (!this.dbPubSubFixed) {
            this.logger?.debug(`[addMessage] publish with connectionId found in other instace ${verifyInstance}`)
            await this.MessagePickupDbService.publishPubSub(connectionId, JSON.stringify(payload))
          } else {
            await this.MessagePickupDbService.publishPubSubWithFixedChannel(connectionId)
          }
        }
      }
      return messageId
    } catch (error) {
      this.logger?.error(`[CustomMessageRepository] error insert or publish: ${error}`)
      throw new Error()
    }
  }

  public async removeMessages(options: RemoveMessagesOptions) {
    const { connectionId, messageIds } = options
    this.logger?.debug(`[removeMessages] remove messages for messageIds ${messageIds} for connectionId ${connectionId}`)

    if (!messageIds || messageIds.length === 0) {
      this.logger?.debug('[removeMessages] No messageIds provided. No messages will be removed.')
      return
    }

    try {
      const result = await this.MessagePickupDbService.removeMessagesFromQueue(connectionId, messageIds)
    } catch (error) {
      this.logger?.error(`[removeMessages] Error removing messages: ${error}`)
    }
  }
  /**
   * Get current active live mode message pickup session for a given connection
   * @param connectionId
   * @returns
   */
  private async getLocalliveSession(connectionId: string): Promise<MessagePickupSession | undefined> {
    this.logger?.debug(`[getLocalliveSession] Verify current active live mode for connectionId ${connectionId}`)

    try {
      if (!this.agent) throw new Error('Agent is not defined')
      return this.agent.messagePickup.getLiveModeSession({ connectionId })
    } catch (error) {
      this.logger?.error(`[getLocalliveSession] error in getLocalliveSession: ${error.message}`)
    }
  }
}
