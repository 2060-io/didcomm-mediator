import { jest } from '@jest/globals'
import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import {
  type DidCommTransportQueuePostgres,
  PostgresMessagesPendingEventType,
} from '@credo-ts/didcomm-transport-queue-postgres'
import type { DidCommMediatorAgent } from '../src/agent/DidCommMediatorAgent.js'
import { startPendingMessagesPush } from '../src/util/pendingMessagesPush.js'

describe('startPendingMessagesPush', () => {
  const delayMs = 1000
  let onPending: (event: { payload: { connectionId: string } }) => void
  let pendingCount: number
  let liveSession: object | undefined
  const sendPushNotification = jest.fn<(connectionId: string, messageId: string) => Promise<boolean>>(async () => true)

  beforeEach(() => {
    jest.useFakeTimers()
    pendingCount = 1
    liveSession = undefined
    sendPushNotification.mockClear()
    const agent = {
      context: {},
      events: {
        on: (type: string, listener: typeof onPending) => {
          if (type === PostgresMessagesPendingEventType) onPending = listener
        },
      },
    } as unknown as DidCommMediatorAgent
    const queue = {
      getAvailableMessageCount: async () => pendingCount,
      findLiveSessionInDb: async () => liveSession,
    } as unknown as DidCommTransportQueuePostgres
    startPendingMessagesPush(agent, queue, delayMs, sendPushNotification, new ConsoleLogger(LogLevel.Off))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('sends one push per connection after the delay', async () => {
    onPending({ payload: { connectionId: 'c1' } })
    onPending({ payload: { connectionId: 'c1' } })

    await jest.advanceTimersByTimeAsync(delayMs - 1)
    expect(sendPushNotification).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1)
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
    expect(sendPushNotification).toHaveBeenCalledWith('c1', expect.any(String))
  })

  it('skips the push when nothing is pending or a live session exists', async () => {
    pendingCount = 0
    onPending({ payload: { connectionId: 'c1' } })
    await jest.advanceTimersByTimeAsync(delayMs)

    pendingCount = 1
    liveSession = { id: 'session-1' }
    onPending({ payload: { connectionId: 'c1' } })
    await jest.advanceTimersByTimeAsync(delayMs)

    expect(sendPushNotification).not.toHaveBeenCalled()
  })
})
