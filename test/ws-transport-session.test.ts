import { jest } from '@jest/globals'
import { ConsoleLogger, LogLevel, type AgentContext } from '@credo-ts/core'
import WebSocket from 'ws'
import { WS_SEND_TIMEOUT_MS } from '../src/config/constants.js'
import { WebSocketTransportSession } from '../src/transport/MediatorWsInboundTransport.js'

describe('WebSocketTransportSession', () => {
  const agentContext = {} as AgentContext
  const logger = new ConsoleLogger(LogLevel.Off)

  const sessionWith = (sendError?: Error): WebSocketTransportSession => {
    const socket = {
      readyState: WebSocket.OPEN,
      send: (_data: string, callback: (error?: Error) => void) => setImmediate(() => callback(sendError)),
    } as unknown as WebSocket
    return new WebSocketTransportSession('session-id', socket, logger)
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it('rejects when the socket fails to write the message', async () => {
    await expect(sessionWith(new Error('write EPIPE')).send(agentContext, { id: 'm1' })).rejects.toThrow(
      'WebSocket send message failed.'
    )
  })

  it('resolves once the socket wrote the message', async () => {
    await expect(sessionWith().send(agentContext, { id: 'm1' })).resolves.toBeUndefined()
  })

  it('terminates the socket and rejects when the write does not finish in time', async () => {
    jest.useFakeTimers()
    const terminate = jest.fn()
    const socket = { readyState: WebSocket.OPEN, send: () => undefined, terminate } as unknown as WebSocket

    const sent = new WebSocketTransportSession('session-id', socket, logger).send(agentContext, { id: 'm1' })
    jest.advanceTimersByTime(WS_SEND_TIMEOUT_MS)

    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(sent).rejects.toThrow('WebSocket send message timed out.')
  })
})
