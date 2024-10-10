import { MongoClient, Collection, ObjectId } from 'mongodb'
import { EncryptedMessage, Logger, QueuedMessage } from '@credo-ts/core'
import { DB_URL_CONNECT, MessageState } from '../../config/constants'
import { CustomQueuedMessage, CustomLiveSession } from './CollectionsDb'
import { MessagePickupDbService } from '../MessagePickupDbService'
import { MubSub } from '@mawhea/mongopubsub'
import { MessagePickupSession } from '@credo-ts/core/build/modules/message-pickup/MessagePickupSession'

export class MongoDBService implements MessagePickupDbService {
  private client?: MongoClient
  private clientPubSub?: MubSub
  private messagesCollection?: Collection<CustomQueuedMessage>
  private livesessionCollection?: Collection<CustomLiveSession>
  private logger?: Logger

  public constructor(logger?: Logger) {
    this.logger = logger
  }

  public async initialize(): Promise<void> {
    try {
      this.logger?.info(`[initialize] MongoDBService Initializing Mongo Database to ${DB_URL_CONNECT}`)

      // create connection to MongoDB
      this.client = new MongoClient(DB_URL_CONNECT, { monitorCommands: true })

      // Access database and collections
      const db = this.client.db('MessagePickupRepository')
      this.messagesCollection = db.collection('QueuedMessage')
      this.livesessionCollection = db.collection('StoreLiveSession')

      // Create indexes
      await this.messagesCollection.createIndex({ connectionId: 1 })
      await this.livesessionCollection.createIndex({ connectionId: 1 })

      // Use pubSubConnection to create connection DB, always instance this connection
      this.clientPubSub = await this.pubSubConnection()
      this.logger?.debug(`[initialize] MongoDBService database has been successfully initialized`)
    } catch (error) {
      this.logger?.error(`[initialize] MongoDBService Error initializing the Mongo database: ${error}`)
      throw error // Rethrow the error for the caller to handle appropriately
    }
  }

  public async connect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.connect()
        this.logger?.debug(`[connect] MongoDBService connection MongoDb was successfully established`)
      }
    } catch (error) {
      this.logger?.debug(`[connect] MongoDBService Error establishing the connection ${error}`)
    }
  }

  public async disconnect() {
    if (!this.client) {
      throw new Error('[disconnect] MongoDBService mongoClient is not initialized')
    }
    try {
      this.logger?.info(`[disconnect] MongoDBService Closing MongoDB connection`)
      await this.client.close()
      this.logger?.info(`[disconnect] MongoDBService MongoDB connection closed successfully`)
    } catch (error) {
      this.logger?.error(`[disconnect] MongoDBService Error closing MongoDB connection: ${error}`)
    }
  }

  public async getMessagesInQueue(
    connectionId: string,
    limit: number,
    deleteMessages: boolean,
    recipientDid: string
  ): Promise<QueuedMessage[]> {
    try {
      if (!this.messagesCollection) {
        throw new Error('[getMessagesInQueue] MongoDBService messagesCollection is not initialized')
      }

      let messagesToUpdateIds: string[] = []
      const startTime = performance.now() // Start the timer

      // Obtain messages from the database
      const storedMessages = await this.messagesCollection
        .find({
          $or: [{ connectionId }, { recipientKeys: recipientDid }],
          state: MessageState.pending,
        })
        .sort({ created_at: 1 })
        .limit(limit)
        .project({ _id: 1, state: 1, encryptedMessage: 1, created_at: 1, receivedAt: '$created_at' })
        .toArray()
        .then(async (result) => {
          messagesToUpdateIds = result.map((message) => message._id.toString())

          // Update the state of messages to 'sending'
          if (!deleteMessages && messagesToUpdateIds.length > 0 && this.messagesCollection) {
            await this.messagesCollection.updateMany(
              { _id: { $in: result.map((message) => message._id) } },
              { $set: { state: MessageState.sending } }
            )
          }

          // Map and return the messages
          return result.map((message) => {
            const { _id, ...rest } = message
            return { id: _id.toString(), ...rest } as QueuedMessage
          })
        })

      if (!storedMessages || storedMessages.length === 0) {
        this.logger?.debug(`[getMessagesInQueue] MongoDBService No messages found for ${connectionId}`)
        return []
      }
      const endTime = performance.now() // Stop the timer
      const duration = endTime - startTime
      this.logger?.debug(
        `[getMessagesInQueue] MongoDBService deliver ${storedMessages.length} message on execution time: ${duration} milliseconds`
      )

      return storedMessages
    } catch (error) {
      this.logger?.error(`[getMessagesInQueue] MongoDBService Error: ${error}`)
      return []
    }
  }

  public async getQueuedMessagesCount(connectionId: string): Promise<number> {
    this.logger?.debug(`[getQueuedMessagesCount] MongoDBService Initializing method`)
    if (!this.messagesCollection) {
      throw new Error('[getQueuedMessagesCount] MongoDBService messagesCollection is not initialized')
    }

    try {
      const messageCount = await this.messagesCollection.countDocuments({ connectionId })

      this.logger?.debug(
        `[getQueuedMessagesCount] MongoDBService connectionId ${connectionId} has ${messageCount} messages`
      )

      return messageCount
    } catch (error) {
      this.logger?.error(`[getQueuedMessagesCount] MongoDBService Error: ${error}`)
      return 0
    }
  }

  public async addMessageToQueue(
    connectionId: string,
    recipientDids: string[],
    payload: EncryptedMessage,
    liveSession: MessagePickupSession | undefined
  ): Promise<{ messageId: string; receivedAt: Date } | undefined> {
    if (!this.messagesCollection) {
      throw new Error('[addMessageToQueue] MongoDBService messagesCollection is not initialized')
    }
    let messageId: string
    let receivedAt: Date
    try {
      const messageDocument = {
        connectionId: connectionId,
        recipientKeys: recipientDids,
        encryptedMessage: payload,
        state: liveSession ? MessageState.sending : MessageState.pending,
        created_at: new Date(),
      }

      const result = await this.messagesCollection.insertOne(messageDocument)

      messageId = result.insertedId.toHexString()
      receivedAt = result.insertedId.getTimestamp()

      this.logger?.debug(
        `[addMessageToQueue] MongoDBService add message for ${connectionId} and result ${messageId} and receivedAt ${receivedAt}`
      )
      return { messageId, receivedAt }
    } catch (error) {
      this.logger?.debug(`[addMessageToQueue] MongoDBService Error adding message to queue`)
      return undefined
    }
  }

  public async removeMessagesFromQueue(connectionId: string, messageIds: string[]): Promise<void> {
    this.logger?.debug(
      `[removeMessagesFromQueue] MongoDBService remove messages for messageIds ${messageIds} for connectionId ${connectionId}`
    )

    if (!messageIds || messageIds.length === 0) {
      this.logger?.debug(
        '[removeMessagesFromQueue] MongoDBService No messageIds provided. No messages will be removed.'
      )
      return
    }
    if (!this.messagesCollection) {
      throw new Error('[removeMessagesFromQueue] MongoDBService messagesCollection is not initialized')
    }

    try {
      const messageIdsAsObjectId = messageIds.map((id) => new ObjectId(id))

      const result = await this.messagesCollection.deleteMany({
        connectionId: connectionId,
        _id: { $in: messageIdsAsObjectId },
      })

      this.logger?.debug(
        `[removeMessagesFromQueue] MongoDBService ${result.deletedCount} messages removed for connectionId ${connectionId}`
      )
    } catch (error) {
      this.logger?.error(`[removeMessagesFromQueue] MongoDBService Error removing messages: ${error}`)
    }
  }

  public async checkPendingMessagesInQueue(connectionId: string): Promise<void> {
    if (!this.messagesCollection) {
      throw new Error('[checkPendingMessagesInQueue] MongoDBService messagesCollection is not initialized')
    }
    try {
      this.logger?.debug(`[checkPendingMessagesInQueue] MongoDBService Init verify messages state 'sending'`)

      // Find messages with state 'sending'
      const messagesToSend = await this.messagesCollection
        .find({
          state: MessageState.sending,
          connectionId,
        })
        .toArray()

      if (messagesToSend.length > 0) {
        for (const message of messagesToSend) {
          // Update state to 'pending'
          await this.messagesCollection.updateOne({ _id: message._id }, { $set: { state: MessageState.pending } })
        }

        this.logger?.debug(
          `[checkPendingMessagesInQueue] MongoDBService ${messagesToSend.length} messages updated to 'pending'.`
        )
      } else {
        this.logger?.debug('[checkPendingMessagesInQueue] MongoDBService No messages in "sending" state.')
      }
    } catch (error) {
      this.logger?.error(`[checkPendingMessagesInQueue] MongoDBService Error processing messages: ${error.message}`)
    }
  }

  public async getLiveSession(connectionId: string): Promise<boolean> {
    if (!this.livesessionCollection) {
      throw new Error('[getLiveSession] MongoDBService livesessionCollection is not initialized')
    }
    try {
      this.logger?.debug(`[getLiveSession] MongoDBService initializing find registry for connectionId ${connectionId}`)

      // find liveSession to connectionId
      const liveSession = await this.livesessionCollection.find({ connectionId }).limit(1).next()

      // check if has session
      const recordFound = !!liveSession

      this.logger?.debug(
        `[getLiveSession] MongoDBService record found status ${recordFound} for connectionId ${connectionId}`
      )

      return recordFound
    } catch (error) {
      this.logger?.error(
        `[getLiveSession] MongoDBService Error finding live session for connectionId ${connectionId}: ${error.message}`
      )
      return false
    }
  }

  public async addLiveSession(id: string, connectionId: string, instance: string): Promise<void> {
    this.logger?.debug(
      `[addLiveSession] MongoDBService initializing add LiveSession DB to connectionId ${connectionId}`
    )

    if (!id) throw new Error('[addLiveSession] MongoDBService id session is not defined')

    if (!this.livesessionCollection) {
      throw new Error('[addLiveSession] MongoDBService messagesCollection is not initialized')
    }

    try {
      const liveSessionDocument = {
        sessionid: id,
        connectionId,
        instance,
        created_at: new Date(),
      }

      const result = await this.livesessionCollection.insertOne(liveSessionDocument)

      if (result.insertedId) {
        this.logger?.debug(`[addLiveSession] MongoDBService added liveSession to ${connectionId}`)
      } else {
        this.logger?.debug(`[addLiveSession] MongoDBService failed to add liveSession to ${connectionId}`)
      }
    } catch (error) {
      this.logger?.error(`[addLiveSession] MongoDBService error adding liveSession to DB ${connectionId}: ${error}`)
    }
  }

  public async removeLiveSession(connectionId: string): Promise<void> {
    if (!this.livesessionCollection) {
      throw new Error('[removeLiveSession] MongoDBService livesessionCollection is not initialized')
    }
    try {
      this.logger?.debug(
        `[removeLiveSession] MongoDBService initializing remove LiveSession to connectionId ${connectionId}`
      )

      const result = await this.livesessionCollection.deleteMany({ connectionId })

      this.logger?.debug(`[removeLiveSession] MongoDBService result  ${JSON.stringify(result)}`)
      if (result.deletedCount >= 1) {
        this.logger?.debug(`[removeLiveSession] MongoDBService removed LiveSession for connectionId ${connectionId}`)
      } else {
        this.logger?.debug(`[removeLiveSession] MongoDBService No LiveSession found for connectionId ${connectionId}`)
      }
    } catch (error) {
      this.logger?.error(
        `[removeLiveSession] MongoDBService Error removing LiveSession for connectionId ${connectionId}: ${error.message}`
      )
    }
  }

  public async pubSubConnection() {
    if (!this.client) {
      throw new Error('[pubSubConnection] MongoDbService client is not initialized')
    }
    try {
      const mongoDb = new MongoClient(DB_URL_CONNECT).db('MessagePickupRepository')
      this.logger?.debug(`[pubSubConnection] MongoDbService initializing connection`)
      return new MubSub({ mongoDb })
    } catch (error) {
      this.logger?.debug(`[pubSubConnection] MongoDbService error initializing connection ${error} `)
      return undefined
    }
  }

  public async subscribePubSub(
    connectionId: string,
    onMessageReceived: (message: string) => void
  ): Promise<{ unsubscribe: () => void } | undefined> {
    this.logger?.info(`[subscribePubSub] MongoDbService Initializing Method ${connectionId}`)

    const event = connectionId
    let subscription
    const callback = async (message: string) => {
      onMessageReceived(message)
    }
    if (this.clientPubSub) {
      subscription = this.clientPubSub?.subscribe({ event, callback })
    }
    return subscription
  }

  public async publishPubSub(connectionId: string, message: string): Promise<void> {
    this.logger?.info(`[publishPubSub] MongoDbService Initializing Method `)
    try {
      this.clientPubSub?.publish({ event: connectionId, message: { message } })

      this.logger?.info(`[publishPubSub] MongoDbService publish on channel ${connectionId} message ${message}`)
    } catch (error) {
      this.logger?.debug(`[publishPubSub] MongoDbService error publish event ${error} `)
    }
  }

  public async subscribePubSubWithFixedChannel(onMessageReceived: (message: string) => void): Promise<void> {
    this.logger?.info(`[subscribePubSubWithFixedChannel] MongoDbService Initializing Method `)

    const callback = async (message: string) => {
      onMessageReceived(message)
    }

    if (this.clientPubSub) {
      this.clientPubSub?.subscribe({ event: 'messageQueue', callback })
    }
  }

  public async publishPubSubWithFixedChannel(message: string): Promise<void> {
    this.logger?.info(`[publishPubSubWithFixedChannel] MongoDbService Initializing Method `)
    try {
      this.clientPubSub?.publish({ event: 'messageQueue', message: { message } })
      this.logger?.info(
        `[publishPubSubWithFixedChannel] MongoDbService publish on event messageQueue message ${message}`
      )
    } catch (error) {
      this.logger?.debug(`[publishPubSubWithFixedChannel] MongoDbService error publish event ${error} `)
    }
  }
}
