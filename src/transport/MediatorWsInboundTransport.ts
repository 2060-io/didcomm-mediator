import type { AgentContext, Logger } from '@credo-ts/core'
import { CredoError, EventEmitter, utils } from '@credo-ts/core'
import {
  DidCommEventTypes,
  DidCommModuleConfig,
  DidCommTransportService,
  type DidCommInboundTransport,
  type DidCommTransportSession,
} from '@credo-ts/didcomm'
import WebSocket, { WebSocketServer } from 'ws'

interface ExtWebSocket extends WebSocket {
  isAlive: boolean
}

export class MediatorWsInboundTransport implements DidCommInboundTransport {
  private socketServer: WebSocketServer
  private logger!: Logger
  private socketIds: Record<string, unknown> = {}

  public constructor({
    server,
    port,
  }: { server: WebSocketServer; port?: undefined } | { server?: undefined; port: number }) {
    this.socketServer = server ?? new WebSocketServer({ port })
  }

  public async start(agentContext: AgentContext) {
    const transportService = agentContext.dependencyManager.resolve(DidCommTransportService)
    const didCommConfig = agentContext.dependencyManager.resolve(DidCommModuleConfig)

    this.logger = agentContext.config.logger

    const wsEndpoint = didCommConfig.endpoints.find((e) => e.startsWith('ws'))
    this.logger.debug(`Starting WS inbound transport`, {
      endpoint: wsEndpoint,
    })

    this.socketServer.on('connection', (socket: WebSocket) => {
      const socketId = utils.uuid()
      this.logger.debug('Socket connected.')
      ;(socket as ExtWebSocket).isAlive = true
      if (!this.socketIds[socketId]) {
        this.logger.debug(`Saving new socket with id ${socketId}.`)
        this.socketIds[socketId] = socket
        const session = new WebSocketTransportSession(socketId, socket, this.logger)
        this.listenOnWebSocketMessages(agentContext, socket, session)
        socket.on('close', () => {
          this.logger.debug(`Socket closed. Session id: ${session.id}`)
          transportService.removeSession(session)
        })
      } else {
        this.logger.debug(`Socket with id ${socketId} already exists.`)
      }
    })

    this.startHeartBeatPing()
  }

  public async stop() {
    this.logger.debug('Closing WebSocket Server')

    return new Promise<void>((resolve, reject) => {
      this.socketServer.close((error) => {
        if (error) {
          reject(error)
        }

        resolve()
      })
    })
  }

  private startHeartBeatPing(interval?: number) {
    const pingInterval = interval ?? 3000

    setInterval(() => {
      this.socketServer.clients.forEach((ws: WebSocket) => {
        if (!(ws as ExtWebSocket).isAlive) {
          this.logger.debug('Client session closed by timeout')
          ws.terminate()
        }

        ;(ws as ExtWebSocket).isAlive = false
        ws.ping(null, undefined)
      })
    }, pingInterval)
  }

  private listenOnWebSocketMessages(agentContext: AgentContext, socket: WebSocket, session: WebSocketTransportSession) {
    const eventEmitter = agentContext.dependencyManager.resolve(EventEmitter)

    socket.on('pong', () => {
      ;(socket as ExtWebSocket).isAlive = true
    })

    socket.addEventListener('message', async (event) => {
      this.logger.debug('WebSocket message event received.', { session: session.id })
      try {
        const encryptedMessage = JSON.parse((event as { data: string }).data)
        eventEmitter.emit(agentContext, {
          type: DidCommEventTypes.DidCommMessageReceived,
          payload: {
            message: encryptedMessage,
            session,
          },
        })
      } catch (error) {
        this.logger.error(`Error processing message: ${error}`)
      }
    })
  }
}

export class WebSocketTransportSession implements DidCommTransportSession {
  public id: string
  public readonly type = 'WebSocket'
  public socket: WebSocket
  public logger: Logger

  public constructor(id: string, socket: WebSocket, logger: Logger) {
    this.id = id
    this.socket = socket
    this.logger = logger
  }

  public async send(_agentContext: AgentContext, encryptedMessage: unknown): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new CredoError(`${this.type} transport session has been closed.`)
    }

    this.socket.send(JSON.stringify(encryptedMessage), (error) => {
      if (error != void 0) {
        this.logger.debug(`Error sending message: ${error}`)
        throw new CredoError(`${this.type} send message failed.`, { cause: error })
      }
      this.logger.debug(`${this.type} sent message successfully.`)
    })
  }

  public async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close()
    }
  }
}
