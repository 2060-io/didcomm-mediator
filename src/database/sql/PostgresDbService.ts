import { EncryptedMessage, Logger, QueuedMessage } from '@credo-ts/core'
import { Pool, Client } from 'pg'
import PGPubsub from 'pg-pubsub'
import { MessagePickupDbService } from '../MessagePickupDbService'
import { createTableMessage, tableNameLive, createTableLive } from './CollectionsDb'

import { DB_HOST, POSTGRES_USER, POSTGRES_PASSWORD, MessageState } from '../../config/constants'
import { MessagePickupSession } from '@credo-ts/core/build/modules/message-pickup/MessagePickupSession'

export class PostgresDbService implements MessagePickupDbService {
  private logger?: Logger
  public messagesCollection?: Pool
  private clientPubSub?: PGPubsub

  public constructor(logger?: Logger) {
    this.logger = logger
  }

  public async initialize(): Promise<void> {
    try {
      this.logger?.info(`[initialize] PostgresDbService Initializing PostgreSQL database handler`)
      // Database initialization
      await this.buildPgDatabase()
      this.logger?.info(`[initialize] PostgresDbService The database has been builded`)

      // Instance messages collection
      this.messagesCollection = new Pool({
        user: POSTGRES_USER,
        host: DB_HOST,
        database: 'messagepickuprepository',
        password: POSTGRES_PASSWORD,
        port: 5432,
      })
    } catch (error) {
      this.logger?.debug(`[initialize] PostgresDbService Error initializing the PostgresDbService database ${error}`)
    }
    //Instance clientPubSub
    this.clientPubSub = await this.pubSubConnection()
  }

  public async connect(): Promise<void> {
    try {
      if (!this.messagesCollection) {
        this.messagesCollection = new Pool({
          user: 'your_username',
          host: 'your_host',
          database: 'your_database',
          password: 'your_password',
          port: 5432,
        })

        await this.messagesCollection.connect()
        this.logger?.debug(`[connect] PostgresDbService Connected Database`)
      }
    } catch (error) {
      this.logger?.debug(`[connect] PostgresDbService Error connect Database ${error}`)
      throw error
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.messagesCollection) {
        await this.messagesCollection.end()
        this.logger?.debug(`[disconnect] PostgresDbService Disconnected from PostgreSQL server`)
      }
    } catch (error) {
      this.logger?.debug('[disconnect] PostgresDbService Error disconnecting from PostgreSQL:', error)
      throw error
    }
  }

  public async getMessagesInQueue(
    connectionId: string,
    limit: number | undefined,
    deleteMessages: boolean | undefined,
    recipientDid: string | undefined
  ): Promise<QueuedMessage[]> {
    try {
      // Obtain messages from the database
      const storedMessages = await this.messagesCollection
        ?.query(
          `SELECT id, encryptedmessage as encryptedMessage, state, created_at as receivedAt FROM queuedmessages WHERE (connectionid = $1 OR $2 = ANY (recipientkeys)) AND (state = ${MessageState.pending}) ORDER BY created_at LIMIT $3`,
          [connectionId, recipientDid, limit ?? 0]
        )
        .then(async (result: { rows: QueuedMessage[] }) => {
          const messagesToUpdateIds = result.rows.map((message) => message.id)
          // Update the state of messages to 'sending'
          if (!deleteMessages && messagesToUpdateIds.length > 0) {
            const updateResult = await this.messagesCollection?.query(
              `UPDATE queuedmessages SET state = ${MessageState.sending} WHERE id = ANY($1)`,
              [messagesToUpdateIds]
            )
            if (updateResult?.rowCount !== limit) {
              this.logger?.debug(
                `[getMessagesInQueue] PostgresDbService Not all messages were updated to "sending" state.`
              )
            } else {
              this.logger?.debug(
                `[getMessagesInQueue] PostgresDbService ${updateResult?.rowCount} / ${limit} Messages updated to "sending" state successfully.`
              )
            }
          }
          // Map and return the messages
          return result.rows.map(
            (message) =>
              ({
                id: message.id,
                receivedAt: message.receivedAt,
                encryptedMessage: message.encryptedMessage,
              } as QueuedMessage)
          )
        })

      if (!storedMessages || storedMessages.length === 0) {
        this.logger?.debug(`[getMessagesInQueue] PostgresDbService Message not found for ${connectionId}`)
        return []
      }
      // Return the messages

      return storedMessages
    } catch (error) {
      this.logger?.error(`[getMessagesInQueue] PostgresDbService Error: ${error}`)
      return []
    }
  }

  public async getQueuedMessagesCount(connectionId: string): Promise<number> {
    const result = await this.messagesCollection?.query(
      `SELECT COUNT(*) FROM queuedmessages WHERE connectionid = $1 and state = ${MessageState.pending}`,
      [connectionId]
    )
    const numberMessage = parseInt(result?.rows[0].count, 10)
    this.logger?.debug(`[getQueuedMessagesCount] PostgresDbService Count ${numberMessage}`)

    this.logger?.debug(
      `[getQueuedMessagesCount] PostgresDbService Message to deliver ${parseInt(result?.rows[0].count, 10)}`
    )

    return parseInt(result?.rows[0].count, 10)

    return 0
  }

  public async addMessageToQueue(
    connectionId: string,
    recipientDids: string[],
    payload: EncryptedMessage,
    liveSession: MessagePickupSession | undefined
  ): Promise<{ messageId: string; receivedAt: Date } | undefined> {
    let messageId: string
    let receivedAt: Date
    try {
      const insertMessageDB = await this.messagesCollection?.query(
        'INSERT INTO queuedmessages(connectionid, recipientKeys, encryptedmessage, state) VALUES($1, $2, $3, $4) RETURNING id, created_at',
        [connectionId, recipientDids, payload, liveSession ? MessageState.sending : MessageState.pending]
      )
      messageId = insertMessageDB?.rows[0].id
      receivedAt = insertMessageDB?.rows[0].created_at
      this.logger?.debug(
        `[addMessageToQueue] PostgresDbService add message for ${connectionId} and result ${messageId} and receivedAt ${receivedAt} `
      )
      return { messageId, receivedAt }
    } catch (error) {
      this.logger?.debug(`[addMessageToQueue] PostgresDbService Error adding message to queue`)
      return undefined
    }
  }

  public async removeMessagesFromQueue(connectionId: string, messageIds: string[]): Promise<void> {
    this.logger?.debug(
      `[removeMessagesFromQueue] PostgresDbService remove messages for messageIds ${messageIds} for connectionId ${connectionId}`
    )

    if (!messageIds || messageIds.length === 0) {
      this.logger?.debug(
        '[removeMessagesFromQueue] PostgresDbService No messageIds provided. No messages will be removed.'
      )
      return
    }

    try {
      // Generate the placeholder string for messageIds in the SQL query
      const placeholders = messageIds.map((_, index) => `$${index + 2}`).join(', ')

      // Construct the SQL query with the placeholders
      const query = `DELETE FROM queuedmessages WHERE connectionid = $1 AND id IN (${placeholders})`

      // Concatenate connectionId and messageIds into a single array for query parameters
      const queryParams = [connectionId, ...messageIds]

      await this.messagesCollection?.query(query, queryParams)
      this.logger?.debug(
        `[removeMessagesFromQueue] PostgresDbService Messages with ids ${messageIds} removed for connectionId ${connectionId}`
      )
    } catch (error) {
      this.logger?.error(`[removeMessagesFromQueue] PostgresDbService Error removing messages: ${error}`)
    }
  }

  public async checkPendingMessagesInQueue(connectionID: string): Promise<void> {
    try {
      this.logger?.debug(
        `[checkPendingMessagesInQueue] PostgresDbService Initialize verify messages on state 'sending'`
      )
      const messagesToSend = await this.messagesCollection?.query(
        'SELECT * FROM queuedmessages WHERE state = $1 and connectionid = $2',
        [MessageState.sending, connectionID]
      )
      if (messagesToSend && messagesToSend.rows.length > 0) {
        for (const message of messagesToSend.rows) {
          // Update the message state to 'pending'
          await this.messagesCollection?.query('UPDATE queuedmessages SET state = $1 WHERE id = $2', [
            MessageState.pending,
            message.id,
          ])
        }

        this.logger?.debug(
          `[checkPendingMessagesInQueue] PostgresDbService ${messagesToSend.rows.length} messages updated to 'pending'.`
        )
      } else {
        this.logger?.debug('[checkPendingMessagesInQueue] PostgresDbService No messages in "sending" state.')
      }
    } catch (error) {
      this.logger?.error(`[checkPendingMessagesInQueue] PostgresDbService Error processing messages: ${error.message}`)
    }
  }

  public async getLiveSession(connectionId: string): Promise<boolean> {
    this.logger?.debug(`[getLiveSession] PostgresDbService initializing find registry for connectionId ${connectionId}`)
    if (!connectionId) throw new Error('connectionId is not defined')
    try {
      const queryLiveSession = await this.messagesCollection?.query(
        `SELECT * FROM storelivesession WHERE connectionid = $1 LIMIT $2`,
        [connectionId, 1]
      )
      // Check if liveSession is not empty (record found)
      const recordFound = queryLiveSession && queryLiveSession.rows && queryLiveSession.rows.length > 0
      this.logger?.debug(
        `[getLiveSession] PostgresDbService record found status ${recordFound} to connectionId ${connectionId}`
      )
      return recordFound ? queryLiveSession.rows[0] : false
    } catch (error) {
      this.logger?.debug(`[getLiveSession] PostgresDbService Error find to connectionId ${connectionId}`)
      return false
    }
  }

  public async addLiveSession(id: string, connectionId: string, instance: string): Promise<void> {
    this.logger?.debug(
      `[addLiveSession] PostgresDbService initializing add LiveSession DB to connectionId ${connectionId}`
    )

    try {
      const insertMessageDB = await this.messagesCollection?.query(
        'INSERT INTO storelivesession (sessionid, connectionid, instance) VALUES($1, $2, $3) RETURNING sessionid',
        [id, connectionId, instance]
      )
      const liveSessionId = insertMessageDB?.rows[0].sessionid
      this.logger?.debug(
        `[addLiveSession] PostgresDbService add liveSession to ${connectionId} and result ${liveSessionId}`
      )
    } catch (error) {
      this.logger?.debug(`[addLiveSession] PostgresDbService error add liveSession DB ${connectionId}`)
    }
  }

  public async removeLiveSession(connectionId: string): Promise<void> {
    this.logger?.debug(
      `[removeLiveSession] PostgresDbService initializing remove LiveSession to connectionId ${connectionId}`
    )
    if (!connectionId) throw new Error('connectionId is not defined')
    try {
      // Construct the SQL query with the placeholders
      const query = `DELETE FROM storelivesession WHERE connectionid = $1`

      // Add connectionId  for query parameters
      const queryParams = [connectionId]

      await this.messagesCollection?.query(query, queryParams)

      this.logger?.debug(`[removeLiveSession] PostgresDbService removed LiveSession to connectionId ${connectionId}`)
    } catch (error) {
      this.logger?.error(`[removeLiveSession] PostgresDbService Error removing LiveSession: ${error}`)
    }
  }

  public async pubSubConnection() {
    try {
      this.logger?.debug(`[pubSubConnection] PostgresDbService PostgresDbService initialize pubSubInstance `)

      return new PGPubsub(`postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_HOST}/messagepickuprepository`)
    } catch (error) {
      this.logger?.debug(
        `[pubSubConnection] PostgresDbService PostgresDbService error initializing connection: ${error} `
      )
      return undefined
    }
  }

  public async publishPubSub(connectionId: string, message: string): Promise<void> {
    try {
      if (this.clientPubSub) {
        this.logger?.debug(`[publishPubSub] PostgresDbService Publishing message to ${connectionId} `)
        await this.clientPubSub.publish(connectionId, message)
      }
    } catch (error) {
      this.logger?.debug(`[publishPubSub] PostgresDbService PostgresDbService error publish message: ${error} `)
    }
  }

  public async subscribePubSub(connectionId: string, onMessageReceived: (message: string) => void): Promise<void> {
    this.logger?.info(`[subscribePubSub] PostgresDbService PostgresDbService Initializing Method to ${connectionId}`)

    await this.clientPubSub?.addChannel(connectionId, async (message) => {
      this.logger?.debug(`[subscribePubSub] PostgresDbService PostgresDbService subscribe on channel ${connectionId}`)
      onMessageReceived(message)
    })
  }

  public async subscribePubSubWithFixedChannel(onMessageReceived: (message: string) => void): Promise<void> {
    await this.clientPubSub?.addChannel('messageQueue', async (message) => {
      this.logger?.debug(
        `[subscribePubSubWithFixedChannel] PostgresDbService PostgresDbService subscribe on messageQueue channel`
      )
      onMessageReceived(message)
    })
  }

  public async publishPubSubWithFixedChannel(message: string): Promise<void> {
    try {
      if (this.clientPubSub) {
        this.logger?.debug(`[publishPubSubWithFixedChannel] PostgresDbService Publishing message to ${message} `)
        await this.clientPubSub.publish('messageQueue', message)
      }
    } catch (error) {
      this.logger?.debug(
        `[publishPubSubWithFixedChannel] PostgresDbService PostgresDbService error publish message: ${error} `
      )
    }
  }

  private async buildPgDatabase(): Promise<void> {
    this.logger?.info(`[buildPgDatabase] PostgresDbService Initializing`)
    const databaseName = 'messagepickuprepository'
    const tableNameMessage = 'queuedmessages'

    const clientConfig = {
      user: POSTGRES_USER,
      host: DB_HOST,
      password: POSTGRES_PASSWORD,
      port: 5432,
    }

    const poolConfig = {
      ...clientConfig,
      database: databaseName,
    }

    const client = new Client(clientConfig)

    try {
      await client.connect()

      // Check if the database already exists.
      const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
      this.logger?.debug(`[buildPgDatabase] PostgresDbService exist ${result.rowCount}`)

      if (result.rowCount === 0) {
        // If it doesn't exist, create the database.
        await client.query(`CREATE DATABASE ${databaseName}`)
        this.logger?.info(`[buildPgDatabase] PostgresDbService Database "${databaseName}" created.`)
      }

      // Create a new client connected to the specific database.
      const dbClient = new Client(poolConfig)

      try {
        await dbClient.connect()

        // Check if the 'queuedmessages' table exists.
        const messageTableResult = await dbClient.query(`SELECT to_regclass('${tableNameMessage}')`)
        if (!messageTableResult.rows[0].to_regclass) {
          // If it doesn't exist, create the 'queuedmessages' table.
          await dbClient.query(createTableMessage)
          this.logger?.info(`[buildPgDatabase] PostgresDbService Table "${tableNameMessage}" created.`)
        }

        // Check if the table exists.
        const liveTableResult = await dbClient.query(`SELECT to_regclass('${tableNameLive}')`)
        if (!liveTableResult.rows[0].to_regclass) {
          // If it doesn't exist, create the table.
          await dbClient.query(createTableLive)
          this.logger?.info(`[buildPgDatabase] PostgresDbService Table "${tableNameLive}" created.`)
        } else {
          // If the table exists, clean it (truncate or delete, depending on your requirements).
          await dbClient.query(`TRUNCATE TABLE ${tableNameLive}`)
          this.logger?.info(`[buildPgDatabase] PostgresDbService Table "${tableNameLive}" cleared.`)
        }
      } finally {
        await dbClient.end()
      }
    } catch (error) {
      this.logger?.error(`[buildPgDatabase] PostgresDbService Error creating database: ${error.message}`)
    } finally {
      await client.end()
    }
  }
}
