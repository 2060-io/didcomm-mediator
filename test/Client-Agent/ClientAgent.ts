import { Agent, ConsoleLogger, LogLevel, utils } from '@credo-ts/core'
import {
  DidCommMediatorPickupStrategy,
  DidCommModule,
  DidCommMimeType,
  DidCommWsOutboundTransport,
} from '@credo-ts/didcomm'
import { agentDependencies, DidCommWsInboundTransport } from '@credo-ts/node'
import { askarNodeJS } from '@openwallet-foundation/askar-nodejs'
import cors from 'cors'
import express from 'express'
import { createRequire } from 'module'
import { Socket } from 'net'
import path from 'path'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import {
  DidCommShortenUrlEventTypes,
  DidCommShortenedUrlReceivedEvent,
  DidCommShortenUrlModule,
  ShortenUrlRole,
  DidCommShortenUrlRepository,
  DidCommShortenUrlApi,
  DidCommShortenedUrlInvalidatedEvent,
} from '@2060.io/credo-ts-didcomm-shorten-url'

const CLIENT_AGENT_PORT = process.env.CLIENT_AGENT_PORT || 3000
const CLIENT_AGENT_HOST = process.env.CLIENT_AGENT_HOST || '192.168.10.20'
const CLIENT_AGENT_WS_ENDPOINT = process.env.CLIENT_AGENT_WS_ENDPOINT
const CLIENT_WALLET_ID = process.env.CLIENT_WALLET_ID || 'client-agent'
const CLIENT_WALLET_KEY = process.env.CLIENT_WALLET_KEY || 'client-agent-key'
const CLIENT_AGENT_DB_PATH =
  process.env.CLIENT_AGENT_DB_PATH ||
  path.join(process.cwd(), `.afj/data/${CLIENT_WALLET_ID}`, `${CLIENT_WALLET_ID || 'client-agent'}.db`)
const CLIENT_MEDIATOR_DID_URL = Boolean(process.env.CLIENT_MEDIATOR_DID_URL) || false
const CLIENT_AGENT_BASE_URL = process.env.CLIENT_AGENT_URL || 'http://localhost:4000/invitation'

const cjsRequire = createRequire(import.meta.url)
const { registerAskar } = cjsRequire('@openwallet-foundation/askar-shared')

registerAskar?.({ askar: askarNodeJS })
const askar = askarNodeJS

const logger = new ConsoleLogger(LogLevel.debug)
const port = Number(CLIENT_AGENT_PORT)
const wsEndpoint = CLIENT_AGENT_WS_ENDPOINT ?? `ws://${CLIENT_AGENT_HOST ?? 'localhost'}:${port}`

async function run() {
  logger.info(`Client Agent started on port ${port}`)
  fs.mkdirSync(path.dirname(CLIENT_AGENT_DB_PATH), { recursive: true })

  const { AskarModule } = await import('@credo-ts/askar')
  const inboundTransports = []
  const outboundTransports = [new DidCommWsOutboundTransport()]
  const webSocketServer = new WebSocketServer({ noServer: true })
  inboundTransports.push(new DidCommWsInboundTransport({ server: webSocketServer }))

  const agent = new Agent({
    config: { logger },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: CLIENT_WALLET_ID,
          key: CLIENT_WALLET_KEY,
          keyDerivationMethod: 'kdf:argon2i:mod',
          database: {
            type: 'sqlite',
            config: {
              inMemory: false,
              path: CLIENT_AGENT_DB_PATH,
            },
          },
        },
      }),
      didcomm: new DidCommModule({
        didCommMimeType: DidCommMimeType.V1,
        transports: {
          inbound: inboundTransports,
          outbound: outboundTransports,
        },
        connections: { autoAcceptConnections: true },
        mediationRecipient: {
          mediatorPickupStrategy: DidCommMediatorPickupStrategy.PickUpV2LiveMode,
        },
        endpoints: [wsEndpoint],
      }),
      shortenUrl: new DidCommShortenUrlModule({
        roles: [ShortenUrlRole.LongUrlProvider],
      }),
    },
  })

  const shortenUrlRepository = agent.dependencyManager.resolve(DidCommShortenUrlRepository)
  const shorteUrlApi = agent.dependencyManager.resolve(DidCommShortenUrlApi)

  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.set('json spaces', 2)

  // Handle shortened URL responses
  agent.events.on<DidCommShortenedUrlReceivedEvent>(
    DidCommShortenUrlEventTypes.DidCommShortenedUrlReceived,
    async (event) => {
      logger.info(
        `[ShortenUrl] shortened url received for connection ${event.payload.shortenUrlRecord.connectionId}: ${event.payload.shortenUrlRecord.shortenedUrl}****`
      )
    }
  )

  // Handle invalidate shortened URL responses
  agent.events.on<DidCommShortenedUrlInvalidatedEvent>(
    DidCommShortenUrlEventTypes.DidCommShortenedUrlInvalidated,
    async ({ payload }) => {
      const { shortenUrlRecord } = payload
      logger.info(
        `[ShortenUrl] shortened-url-invalidated event received for connection ${shortenUrlRecord.connectionId} (${payload.shortenUrlRecord.shortenedUrl})`
      )
      await shortenUrlRepository.deleteById(agent.context, shortenUrlRecord.id).catch((error) => {
        logger.error(`[ShortenUrl] failed to delete shortened url record: ${error}`)
      })
    }
  )

  const onListen = async () => {
    await agent.initialize()
    logger.info(`Client Agent initialized OK ${CLIENT_MEDIATOR_DID_URL}`)
    if (!(await agent.didcomm.mediationRecipient?.findDefaultMediator())) {
      logger.debug('No default mediator. Connecting...')

      let invitationUrl

      if (!CLIENT_MEDIATOR_DID_URL) {
        logger.debug('Initialize URL Method')
        const invitationResponse = await fetch(CLIENT_AGENT_BASE_URL)

        if (invitationResponse.status !== 200) {
          throw new Error(`Cannot connect to mediator. Response status: ${invitationResponse.status}`)
        }

        invitationUrl = JSON.parse(await invitationResponse.text()).url
      }

      const { connectionRecord } = await (!CLIENT_MEDIATOR_DID_URL
        ? agent.didcomm.oob.receiveInvitationFromUrl(invitationUrl, {
            label: CLIENT_WALLET_ID,
            autoAcceptConnection: true,
            autoAcceptInvitation: true,
          })
        : agent.didcomm.oob.receiveImplicitInvitation({
            did: 'did:web:ca.core.dev.2060.io',
            label: CLIENT_WALLET_ID,
            autoAcceptConnection: true,
            autoAcceptInvitation: true,
          }))

      if (!connectionRecord) throw new Error('Cannot create connetion record')
      const mediatorConnection = await agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id, {
        timeoutMs: 5000,
      })
      const mediationRecord = await agent.didcomm.mediationRecipient?.requestAndAwaitGrant(mediatorConnection)
      logger.debug('Mediation granted. Initializing mediator recipient module.')
      if (mediationRecord) {
        await agent.didcomm.mediationRecipient?.setDefaultMediator(mediationRecord)
        // Start live mode pickup to register a live session on the mediator (required for Postgres queue repo)
        await agent.didcomm.mediationRecipient?.initiateMessagePickup(
          mediationRecord,
          DidCommMediatorPickupStrategy.PickUpV2LiveMode
        )
      }
    } else {
      logger.debug('Mediation already set up')
    }
  }

  if (CLIENT_AGENT_HOST) {
    const server = app.listen(port, CLIENT_AGENT_HOST, onListen)
    server.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket as Socket, head, (socketParam) => {
        const socketId = utils.uuid()
        webSocketServer.emit('connection', socketParam, request, socketId)
      })
    })
  } else {
    const server = app.listen(port, onListen)
    server.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket as Socket, head, (socketParam) => {
        const socketId = utils.uuid()
        webSocketServer.emit('connection', socketParam, request, socketId)
      })
    })
  }

  // Create invitation
  app.get('/invitation', async (req, res) => {
    logger?.info(`Invitation requested`)
    const outOfBandInvitation = (
      await agent.didcomm.oob.createInvitation({ autoAcceptConnection: true, label: CLIENT_WALLET_ID })
    ).outOfBandInvitation
    res.send({
      url: outOfBandInvitation.toUrl({ domain: process.env.AGENT_INVITATION_BASE_URL ?? 'https://2060.io/i' }),
    })
  })

  // Get a simplified list of all connections
  app.get('/connections', async (req, res) => {
    logger?.info(`Connection list requested`)
    const connections = await agent.didcomm.connections.getAll()
    res.send(JSON.stringify(connections))
  })

  app.post('/receive-invitation', async (req, res) => {
    const invitationUrl = req.body.url
    logger.info(`invitationUrl: ${invitationUrl}`)
    const connection = await agent.didcomm.oob.receiveInvitationFromUrl(invitationUrl, {
      label: CLIENT_WALLET_ID,
      acceptInvitationTimeoutMs: 5000,
      autoAcceptConnection: true,
      autoAcceptInvitation: true,
    })
    res.json(connection)
  })

  app.post('/send-message', async (req, res) => {
    const connectionId = req.body.connectionId
    const message = req.body.message
    logger.info(`connectionId: ${connectionId}; message: ${message}`)
    await agent.didcomm.basicMessages.sendMessage(connectionId, message)
    res.end()
  })

  app.post('/shorten-url/request', async (req, res) => {
    const { connectionId, url, goalCode, requestedValiditySeconds, shortUrlSlug } = req.body

    if (!connectionId || !url || !goalCode || !requestedValiditySeconds) {
      return res.status(400).json({
        error:
          'connectionId, url, goalCode and requestedValiditySeconds are required to request a shortened URL via DIDComm',
      })
    }

    try {
      const result = await shorteUrlApi.requestShortenedUrl({
        connectionId,
        url,
        goalCode,
        requestedValiditySeconds: Number(requestedValiditySeconds),
        shortUrlSlug,
      })

      logger.info(`[ShortenUrl] request sent for connection ${connectionId} (message id ${result.messageId})`)
      return res.json(result)
    } catch (error) {
      logger.error(`[ShortenUrl] failed to send request: ${error}`)
      return res.status(500).json({ error: 'Failed to send request-shortened-url message' })
    }
  })

  app.post('/shorten-url/invalidate', async (req, res) => {
    const { id } = req.body

    if (!id) {
      return res.status(400).json({
        error: 'id is required to invalidate a shortened URL via DIDComm',
      })
    }

    try {
      const findRecord = await shortenUrlRepository.getSingleByQuery(agent.context, { threadId: id })
      const result = await shorteUrlApi.invalidateShortenedUrl({
        recordId: findRecord.id,
      })
      logger.info(`[ShortenUrl] invalidate request sent for record id ${id} (message id ${result.messageId})`)

      return res.json(result)
    } catch (error) {
      logger.error(`[ShortenUrl] failed to send request: ${error}`)
      return res.status(500).json({ error: 'Failed to send request-shortened-url message' })
    }
  })
}

run()
