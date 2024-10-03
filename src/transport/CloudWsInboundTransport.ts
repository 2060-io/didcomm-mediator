import {
  Agent,
  InboundTransport,
  Logger,
  TransportSession,
  EncryptedMessage,
  ConnectionRecord,
  AgentContext,
  MessageReceiver,
} from '@credo-ts/core'

import { CredoError, AgentConfig, TransportService, utils } from '@credo-ts/core'
import WebSocket, { Server } from 'ws'

// Workaround for types (https://github.com/DefinitelyTyped/DefinitelyTyped/issues/20780)
interface ExtWebSocket extends WebSocket {
  isAlive: boolean
}

export class CloudWsInboundTransport implements InboundTransport {
  private socketServer: Server
  private logger!: Logger

  // We're using a `socketId` just for the prevention of calling the connection handler twice.
  private socketIds: Record<string, unknown> = {}

  public constructor({ server, port }: { server: Server; port?: undefined } | { server?: undefined; port: number }) {
    this.socketServer = server ?? new Server({ port })
  }

  public async start(agent: Agent) {
    const transportService = agent.dependencyManager.resolve(TransportService)
    const config = agent.dependencyManager.resolve(AgentConfig)

    this.logger = config.logger

    const wsEndpoint = config.endpoints.find((e) => e.startsWith('ws'))
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
        this.listenOnWebSocketMessages(agent, socket, session)
        socket.on('close', () => {
          this.logger.debug(`Socket closed. Session id: ${session}`)
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
    interval = interval ?? 3000

    setInterval(() => {
      this.socketServer.clients.forEach((ws: WebSocket) => {
        if (!(ws as ExtWebSocket).isAlive) {
          this.logger.debug('Client session closed by timeout')
          ws.terminate()
        }

        ;(ws as ExtWebSocket).isAlive = false
        ws.ping(null, undefined)
      })
    }, interval)
  }

  private listenOnWebSocketMessages(agent: Agent, socket: WebSocket, session: WebSocketTransportSession) {
    const messageReceiver = agent.dependencyManager.resolve(MessageReceiver)

    socket.on('pong', () => {
      ;(socket as ExtWebSocket).isAlive = true
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.addEventListener('message', async (event: any) => {
      this.logger.debug('WebSocket message event received.', { session: session.id })
      try {
        await messageReceiver.receiveMessage(JSON.parse(event.data), { session })
      } catch (error) {
        this.logger.error(`Error processing message: ${error}`)
      }
    })
  }
}

export class WebSocketTransportSession implements TransportSession {
  public id: string
  public readonly type = 'WebSocket'
  public socket: WebSocket
  public connection?: ConnectionRecord
  public logger: Logger

  public constructor(id: string, socket: WebSocket, logger: Logger) {
    this.id = id
    this.socket = socket
    this.logger = logger
  }

  public async send(agentContext: AgentContext, encryptedMessage: EncryptedMessage): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new CredoError(`${this.type} transport session has been closed.`)
    }

    this.socket.send(JSON.stringify(encryptedMessage))
  }

  public async close(): Promise<void> {
    this.logger.debug(`Web Socket Transport Session close requested. Connection Id: ${this.connection?.id}`)
    // Do not actually close socket. Leave heartbeat to do its job
  }
}
