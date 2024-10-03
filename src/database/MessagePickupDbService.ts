import { EncryptedMessage, QueuedMessage } from '@credo-ts/core'
import { MessagePickupSession } from '@credo-ts/core/build/modules/message-pickup/MessagePickupSession'
import { MubSub } from '@mawhea/mongopubsub'
import { CloudAgent } from '../agent/CloudAgent'

export interface MessagePickupDbService {
  initialize(): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  /**
   * This method returns the messages that will be sent to a connectionId.
   * This method will be used by 'takeFromQueue' implemented in the CustomMessageRepository
   * @param connectionId
   * @param limit
   * @param deleteMessages
   * @param recipientDid
   * @returns QueuedMessage[]
   */
  getMessagesInQueue(
    connectionId: string,
    limit: number | undefined,
    deleteMessages: boolean | undefined,
    recipientDid: string | undefined
  ): Promise<QueuedMessage[]>

  /**
   * Return the quantity that a connectionId has in the message queue.
   * This method will be used by 'getAvailableMessageCount' implemented in the CustomMessageRepository
   * @param connectionId
   * @returns Promise<number>
   */
  getQueuedMessagesCount(connectionId: string): Promise<number>
  /**
   * Add the messages that have been sent to an agent to the queue.
   * This method should be utilized in the 'addMessages' implemented in the CustomMessageRepository.
   * @param connectionId
   * @param recipientDids
   * @param payload
   * @param liveSession
   * @returns Promise<{ messageId: string; receivedAt: Date } | undefined>
   */
  addMessageToQueue(
    connectionId: string,
    recipientDids: string[],
    payload: EncryptedMessage,
    liveSession: any
  ): Promise<{ messageId: string; receivedAt: Date } | undefined>
  /**
   * Remove messages of queue that have been sent and received by the client is allowed.
   * This method should be utilized in the 'removeMessages' method implemented in the CustomMessageRepository.
   * @param connectionId
   * @param messageIds
   * @returns Promise<void>
   */
  removeMessagesFromQueue(connectionId: string, messageIds: string[]): Promise<void>
  /**
   * This function checks that messages from the connectionId, which were left in the 'sending'
   * state after a liveSessionRemove event, are updated to the 'pending' state for subsequent sending
   * @param connectionID
   * @returns Promise<void>
   */
  checkPendingMessagesInQueue(connectionID: string): Promise<void>
  /**
   * This method allow find record into DB to determine if the connectionID has a liveSession in another instance
   * @param connectionId
   * @returns Promise<any | boolean>
   */
  getLiveSession(connectionId: string): Promise<any | boolean>
  /**
   * This method adds a new connectionId and instance name to DB upon LiveSessionSave event
   * @param connectionId
   * @param instance
   * @returns Promise<void>
   */
  addLiveSession(id: string, connectionId: string, instance: string): Promise<void>
  /**
   *This method remove connectionId record to DB upon LiveSessionRemove event
   * @param connectionId
   * @returns Promise<void>
   */
  removeLiveSession(connectionId: string): Promise<void>
  /**
   * Implement the PubSub module to MongoDB with'@mawhea/mongopubsub' or Postgres with PGPubsub module,
   * which allows publishing to other instances subscribed to the channel that there
   * are messages for a certain connectionId
   * @returns Promise a connection DB
   */
  pubSubConnection(): any

  /**
   * Allow creating a subscription to a channel to listen for events generated
   * for the publication of new messages in the queue for a connectionId
   * @param event define a listener
   * @onMessageReceived Utilize method overloading for the fixed-channel and connectionId-defined methods.
   * The difference will lie in sending the 'message' parameter, as in the case of a fixed-channel method,
   * we will need to include the connectionId in the message.
   */

  subscribePubSub(
    connectionId: string,
    onMessageReceived: () => void
  ): Promise<{ unsubscribe: () => void } | void | undefined>

  /**
   * Publish a message, for example a connectionId, to the specified channel after inserting a message into the queue
   * @param event listener when publish message defined be method selected fixed-channel or connectionId-channel
   * @param message
   */

  publishPubSub(connectionId: string, message: string): Promise<void>

  /**
   * Subscribe Fixed channel messageQueue to delivery messages
   * @param onMessageReceived
   */

  subscribePubSubWithFixedChannel(onMessageReceived: (message: any) => void): Promise<void>

  /**
   * Publish message in Fixed Channel messageQueue
   * @param message
   */

  publishPubSubWithFixedChannel(message: string): Promise<void>
}
