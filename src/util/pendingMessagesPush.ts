import { type Logger, utils } from '@credo-ts/core'
import {
  type DidCommTransportQueuePostgres,
  type PostgresMessagesPendingEvent,
  PostgresMessagesPendingEventType,
} from '@credo-ts/didcomm-transport-queue-postgres'
import type { DidCommMediatorAgent } from '../agent/DidCommMediatorAgent.js'

export function startPendingMessagesPush(
  agent: DidCommMediatorAgent,
  queueTransportRepository: DidCommTransportQueuePostgres,
  delayMs: number,
  sendPushNotification: (connectionId: string, messageId: string) => Promise<boolean>,
  logger: Logger
): void {
  const pendingPushTimers = new Map<string, NodeJS.Timeout>()
  agent.events.on<PostgresMessagesPendingEvent>(PostgresMessagesPendingEventType, ({ payload: { connectionId } }) => {
    if (pendingPushTimers.has(connectionId)) return

    const timer = setTimeout(async () => {
      pendingPushTimers.delete(connectionId)
      try {
        const pending = await queueTransportRepository.getAvailableMessageCount(agent.context, { connectionId })
        if (pending === 0 || (await queueTransportRepository.findLiveSessionInDb(agent.context, connectionId))) return

        logger.debug(
          `[TransportQueuePostgresMessagesPending] ${pending} message(s) pending and no live session, sending push notification to connection ${connectionId}`
        )
        if (await sendPushNotification(connectionId, utils.uuid())) {
          logger.info(`[TransportQueuePostgresMessagesPending] Push notification sent to connection ${connectionId}`)
        }
      } catch (error) {
        logger.error(`[TransportQueuePostgresMessagesPending] Error processing event: ${error}`)
      }
    }, delayMs)
    timer.unref()
    pendingPushTimers.set(connectionId, timer)
  })
}
