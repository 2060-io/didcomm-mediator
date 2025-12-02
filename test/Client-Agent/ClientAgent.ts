import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  ConnectionsModule,
  ConsoleLogger,
  LogLevel,
  MediationRecipientModule,
  MediatorPickupStrategy,
  WsOutboundTransport,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import cors from 'cors'
import express from 'express'
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
const CLIENT_AGENT_HOST = process.env.CLIENT_AGENT_HOST
const CLIENT_WALLET_ID = process.env.CLIENT_WALLET_ID || 'client-agent'
const CLIENT_WALLET_KEY = process.env.CLIENT_WALLET_KEY || 'client-agent'
const CLIENT_MEDIATOR_DID_URL = Boolean(process.env.CLIENT_MEDIATOR_DID_URL) || false
const CLIENT_AGENT_BASE_URL = process.env.CLIENT_AGENT_URL || 'http://localhost:4000/invitation'

const logger = new ConsoleLogger(LogLevel.debug)
const port = Number(CLIENT_AGENT_PORT)

async function run() {
  logger.info(`Client Agent started on port ${port}`)

  const agent = new Agent({
    config: { label: CLIENT_WALLET_ID, walletConfig: { id: CLIENT_WALLET_ID, key: CLIENT_WALLET_KEY }, logger },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ ariesAskar }),
      mediationRecipient: new MediationRecipientModule({
        mediatorPickupStrategy: MediatorPickupStrategy.PickUpV2LiveMode,
      }),
      connections: new ConnectionsModule({ autoAcceptConnections: true }),
      shortenUrl: new DidCommShortenUrlModule({
        roles: [ShortenUrlRole.LongUrlProvider],
      }),
    },
  })

  agent.registerOutboundTransport(new WsOutboundTransport())

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
    // If no default mediator, request mediation from configured
    if (!(await agent.mediationRecipient.findDefaultMediator())) {
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
        ? agent.oob.receiveInvitationFromUrl(invitationUrl, {
            autoAcceptConnection: true,
            autoAcceptInvitation: true,
          })
        : agent.oob.receiveImplicitInvitation({
            did: 'did:web:ca.core.dev.2060.io',
            autoAcceptConnection: true,
            autoAcceptInvitation: true,
          }))

      if (!connectionRecord) throw new Error('Cannot create connetion record')
      const mediatorConnection = await agent.connections.returnWhenIsConnected(connectionRecord.id, { timeoutMs: 5000 })
      const mediationRecord = await agent.mediationRecipient.requestAndAwaitGrant(mediatorConnection)
      logger.debug('Mediation granted. Initializing mediator recipient module.')
      await agent.mediationRecipient.setDefaultMediator(mediationRecord)
      await agent.mediationRecipient.initialize()
    } else {
      logger.debug('Mediation already set up')
    }
  }

  if (CLIENT_AGENT_HOST) {
    app.listen(port, CLIENT_AGENT_HOST, onListen)
  } else {
    app.listen(port, onListen)
  }

  // Create invitation
  app.get('/invitation', async (req, res) => {
    logger?.info(`Invitation requested`)
    const outOfBandInvitation = (await agent.oob.createInvitation({ autoAcceptConnection: true })).outOfBandInvitation
    res.send({
      url: outOfBandInvitation.toUrl({ domain: process.env.AGENT_INVITATION_BASE_URL ?? 'https://2060.io/i' }),
    })
  })

  // Get a simplified list of all connections
  app.get('/connections', async (req, res) => {
    logger?.info(`Connection list requested`)
    const connections = await agent.connections.getAll()
    res.send(JSON.stringify(connections))
  })

  app.post('/receive-invitation', async (req, res) => {
    const invitationUrl = req.body.url
    logger.info(`invitationUrl: ${invitationUrl}`)
    const connection = await agent.oob.receiveInvitationFromUrl(invitationUrl, {
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
    await agent.basicMessages.sendMessage(connectionId, message)
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
      const result = await shorteUrlApi.invalidateShortenedUrl({
        recordId: id,
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
