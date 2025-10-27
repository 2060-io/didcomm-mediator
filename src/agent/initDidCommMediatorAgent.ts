import {
  ConsoleLogger,
  LogLevel,
  AgentMessageProcessedEvent,
  AgentEventTypes,
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  DidDocumentBuilder,
  KeyType,
  TypedArrayEncoder,
  convertPublicKeyToX25519,
  DidCommV1Service,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  WsOutboundTransport,
  HttpOutboundTransport,
  ConnectionService,
  OutOfBandInvitation,
  HandshakeProtocol,
  MessagePickupEventTypes,
  MessagePickupLiveSessionRemovedEvent,
  MessagePickupLiveSessionSavedEvent,
  MediationState,
  MediationStateChangedEvent,
  RoutingEventTypes,
  HangupMessage,
  MessagePickupRepository,
  utils,
} from '@credo-ts/core'
import {
  DidCommInvalidateShortenedUrlReceivedEvent,
  DidCommRequestShortenedUrlReceivedEvent,
  DidCommShortenUrlEventTypes,
  DidCommShortenUrlRepository,
  ShortenUrlRole,
  ShortenUrlState,
} from '@2060.io/credo-ts-didcomm-shorten-url'
import WebSocket from 'ws'
import { Socket } from 'net'

import { CloudAgentOptions, createMediator, DidCommMediatorAgent } from './DidCommMediatorAgent'
import { MediatorWsInboundTransport } from '../transport/MediatorWsInboundTransport'
import { HttpInboundTransport } from '../transport/HttpInboundTransport'
import express, { Express } from 'express'
import cors from 'cors'
import { PushNotificationsFcmSetDeviceInfoMessage } from '@credo-ts/push-notifications'
import { tryParseDid } from '@credo-ts/core/build/modules/dids/domain/parse'
import { InMemoryMessagePickupRepository } from '../storage/InMemoryMessagePickupRepository'
import { LocalFcmNotificationSender } from '../notifications/LocalFcmNotificationSender'
import { MessagePickupRepositoryClient } from '@2060.io/message-pickup-repository-client'
import { ConnectionInfo } from '@2060.io/message-pickup-repository-client/build/interfaces'
import { MessageQueuedEvent, PostgresMessagePickupRepository } from '@2060.io/credo-ts-message-pickup-repository-pg'
import {
  deleteShortUrlRecord,
  isShortenUrRecordExpired,
  startShortenUrlRecordsCleanupMonitor,
} from '../util/shortenUrlRecordsCleanup'

export const initMediator = async (
  config: CloudAgentOptions
): Promise<{ app: Express; agent: DidCommMediatorAgent }> => {
  const logger = config.config.logger ?? new ConsoleLogger(LogLevel.off)
  const publicDid = config.did

  const createMessagePickupRepository = (): MessagePickupRepository => {
    if (config.messagePickupRepositoryWebSocketUrl) {
      return new MessagePickupRepositoryClient({
        url: config.messagePickupRepositoryWebSocketUrl,
      })
    } else if (config.postgresHost) {
      const { postgresUser, postgresPassword, postgresHost } = config

      if (!postgresUser || !postgresPassword) {
        throw new Error(
          '[createMessagePickupRepository] Both postgresUser and postgresPassword are required when using PostgresMessagePickupRepository.'
        )
      }
      return new PostgresMessagePickupRepository({
        logger: logger,
        postgresUser,
        postgresPassword,
        postgresHost,
        postgresDatabaseName: 'messagepickuprepository',
      })
    } else {
      return new InMemoryMessagePickupRepository(new LocalFcmNotificationSender(logger), logger)
    }
  }

  const messageRepository = createMessagePickupRepository()

  if (!config.enableHttp && !config.enableWs) {
    throw new Error('No transport has been enabled. Set at least one of HTTP and WS')
  }

  const agent = createMediator(config, messageRepository)

  const repository = agent.dependencyManager.resolve(DidCommShortenUrlRepository)

  // Cleanup expired or invalid shorten-url records on startup
  startShortenUrlRecordsCleanupMonitor(agent.context, config.shortenUrlCleanupIntervalMs)
  logger.info(`[ShortenUrlCleanup] Cleanup on startup completed`)

  // Handle shorten URL requests
  agent.events.on<DidCommRequestShortenedUrlReceivedEvent>(
    DidCommShortenUrlEventTypes.DidCommRequestShortenedUrlReceived,
    async ({ payload }) => {
      const { connectionId, url, requestedValiditySeconds } = payload

      // Ensure connection exists
      if (!agent.connections.findById(connectionId))
        logger.error(`[ShortenUrl] No connection found for id ${connectionId}`)

      logger.debug(`[ShortenUrl] request-shortened-url received for connection ${JSON.stringify(payload, null, 2)}`)

      const shortUrlRecord = await repository.findSingleByQuery(agent.context, {
        connectionId,
        role: ShortenUrlRole.UrlShortener,
        state: ShortenUrlState.RequestReceived,
        url,
      })

      logger.debug(
        `[ShortenUrl] found record ${JSON.stringify(shortUrlRecord, null, 2)} for connection ${connectionId}`
      )

      if (!shortUrlRecord) {
        logger.error(`[ShortenUrl] no record found for connection ${connectionId}`)
        return
      }

      const shortenedUrl = `${config.shortenInvitationBaseUrl}/s?id=${shortUrlRecord.id}`

      try {
        await agent.modules.shortenUrl.sendShortenedUrl({
          connectionId,
          threadId: shortUrlRecord.id,
          shortenedUrl,
          expiresTime: requestedValiditySeconds,
        })

        logger.info(`[ShortenUrl] shortened url generated and sent for connection ${connectionId}`)
      } catch (error) {
        logger.error(`[ShortenUrl] failed to process shorten url request: ${error}`)
      }
    }
  )
  // Handle invalidate shortened URL requests
  agent.events.on<DidCommInvalidateShortenedUrlReceivedEvent>(
    DidCommShortenUrlEventTypes.DidCommInvalidateShortenedUrlReceived,
    async ({ payload }) => {
      const { connectionId, shortenedUrl } = payload
      logger.info(
        `[ShortenUrl] invalidate-shortened-url received for connection ${payload.connectionId} (${payload.shortenedUrl})`
      )
      try {
        await deleteShortUrlRecord(agent.context, { connectionId, shortenedUrl })
        logger.info(`[ShortenUrl] shortened url record deleted for connection ${connectionId})`)
      } catch (error) {
        logger.error(`[ShortenUrl] failed to process invalidate shortened url request: ${error}`)
      }
    }
  )

  if (messageRepository instanceof MessagePickupRepositoryClient) {
    await messageRepository.connect()

    // Define the generic callback to retrieve ConnectionInfo
    const getConnectionInfo = async (connectionId: string): Promise<ConnectionInfo | undefined> => {
      const connectionRecord = await agent.connections.findById(connectionId)
      return {
        pushNotificationToken: { type: 'fcm', token: connectionRecord?.getTag('device_token') as string | undefined },
        maxReceiveBytes: config.messagePickupMaxReceiveBytes,
      }
    }

    messageRepository.setConnectionInfo(getConnectionInfo)

    messageRepository.messagesReceived(async (data) => {
      const { connectionId, messages } = data

      logger.debug(`[messagesReceived] init with ${connectionId} message to ${JSON.stringify(messages, null, 2)}`)

      const liveSession = await agent.messagePickup.getLiveModeSession({ connectionId })

      if (liveSession) {
        logger.debug(`[messageReceived] found LiveSession for connectionId ${connectionId}, Delivering Messages`)

        await agent.messagePickup.deliverMessages({
          pickupSessionId: liveSession.id,
          messages,
        })
      } else {
        logger.debug(`[messagesReceived] not found LiveSession for connectionId ${connectionId}`)
      }
    })
  } else if (messageRepository instanceof InMemoryMessagePickupRepository) {
    messageRepository.setAgent(agent)
  } else if (messageRepository instanceof PostgresMessagePickupRepository) {
    logger.info('[PostgresMessagePickupRepository] Initializing repository and notification sender')

    const localFcmNotificationSender = new LocalFcmNotificationSender(logger)

    // Check if localFcmNotificationSender is initialized
    if (!localFcmNotificationSender.isInitialized()) {
      logger.error('[PostgresMessagePickupRepository] FCM Notification Sender is not initialized')
      throw new Error('FCM Notification Sender initialization failed')
    }
    logger.debug('[PostgresMessagePickupRepository] FCM Notification Sender initialized')

    await messageRepository.initialize({ agent })
    logger.info('[PostgresMessagePickupRepository] Repository initialization completed')

    // Register the listener for the MessageQueued event
    agent.events.on('MessagePickupRepositoryMessageQueued', async ({ payload }) => {
      const messageQueuedEvent = payload as unknown as MessageQueuedEvent
      logger.debug(`[MessagePickupRepositoryMessageQueued] received: ${JSON.stringify(messageQueuedEvent, null, 2)}`)

      // If the session is present, skip processing
      if (messageQueuedEvent.session) {
        logger.debug(
          `[MessagePickupRepositoryMessageQueued] Skipping processing because session is present for connectionId: ${messageQueuedEvent.message.connectionId}`
        )
        return
      }

      try {
        // Find the connection record associated with the message
        const connectionRecord = await agent.connections.findById(messageQueuedEvent.message.connectionId)
        if (!connectionRecord) {
          logger.warn(
            `[MessagePickupRepositoryMessageQueued] No connection record found for connectionId: ${messageQueuedEvent.message.connectionId}`
          )
          return
        }

        const token = connectionRecord.getTag('device_token') as string | null
        if (!token) {
          logger.warn(
            `[MessagePickupRepositoryMessageQueued] No device token found for connectionId: ${messageQueuedEvent.message.connectionId}`
          )
          return
        }

        logger.debug(
          `[MessagePickupRepositoryMessageQueued] Sending message with ID ${messageQueuedEvent.message.id} to device token: ${token}`
        )
        await localFcmNotificationSender.sendMessage(token, messageQueuedEvent.message.id)
        logger.info(
          `[MessagePickupRepositoryMessageQueued] Message ${messageQueuedEvent.message.id} notification sent successfully`
        )
      } catch (error) {
        logger.error(`[MessagePickupRepositoryMessageQueued] Error processing event: ${error}`)
      }
    })
  }

  const app = express()

  app.use(cors())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  app.set('json spaces', 2)

  app.get('/s', async (req, res) => {
    const id = req.query.id
    try {
      if (typeof id !== 'string') {
        logger.warn('[ShortenUrl] /s endpoint called without id query parameter')
        return res.status(400).json({ error: 'Query parameter "id" is required' })
      }
      logger.debug(`[ShortenUrl] /s endpoint called with id ${id}`)

      const shortUrlRecord = await repository.findById(agent.context, id)
      logger.debug(`[ShortenUrl] /s endpoint found record: ${JSON.stringify(shortUrlRecord, null, 2)}`)

      if (!shortUrlRecord) {
        logger.warn('[ShortenUrl] /s endpoint received unknown id', { id })
        return res.status(404).json({ error: 'Shortened URL not found' })
      }
      const longUrl = shortUrlRecord.url

      logger.debug(`[ShortenUrl] /s endpoint retrieved longUrl: ${longUrl}`)

      if (!longUrl) {
        logger.warn('[ShortenUrl] /s endpoint received unknown UUID', { id })
        return res.status(404).json({ error: 'Shortened URL not found' })
      }
      // Check if the shortened URL is expired
      if (await isShortenUrRecordExpired(shortUrlRecord)) {
        logger.info('[ShortenUrl] /s endpoint received expired shortened URL', { id })
        return res.status(410).json({ error: 'Shortened URL has expired' })
      }

      if (req.accepts('json')) {
        const invitationUrl = await agent.oob.parseInvitation(longUrl)
        res.send(invitationUrl.toJSON()).end()
      } else {
        res.status(302).location(longUrl).end()
      }
    } catch (error) {
      logger.error(`[ShortenUrl] failed to retrieve shortened url for id ${id}: ${error}`)
      res.status(500).send('Internal Server Error')
    }
  })

  let webSocketServer: WebSocket.Server
  let httpInboundTransport: HttpInboundTransport | undefined
  if (config.enableHttp) {
    httpInboundTransport = new HttpInboundTransport({ app, port: config.port })
    agent.registerInboundTransport(httpInboundTransport)
    agent.registerOutboundTransport(new HttpOutboundTransport())
  }

  if (config.enableWs) {
    webSocketServer = new WebSocket.Server({ noServer: true })
    agent.registerInboundTransport(new MediatorWsInboundTransport({ server: webSocketServer }))
    agent.registerOutboundTransport(new WsOutboundTransport())
  }

  app.get('/invitation', async (req, res) => {
    logger.info(`Invitation requested`)

    const outOfBandInvitation = agent.did
      ? new OutOfBandInvitation({
          id: agent.did,
          services: [agent.did],
          label: agent.config.label,
          handshakeProtocols: [HandshakeProtocol.DidExchange, HandshakeProtocol.Connections],
          imageUrl: process.env.AGENT_INVITATION_IMAGE_URL,
        })
      : (
          await agent.oob.createInvitation({
            imageUrl: process.env.AGENT_INVITATION_IMAGE_URL,
          })
        ).outOfBandInvitation
    res.send({
      url: outOfBandInvitation.toUrl({ domain: process.env.AGENT_INVITATION_BASE_URL ?? 'https://2060.io/i' }),
    })
  })

  await agent.initialize()
  logger.info('agent initialized')

  agent.events.on(MessagePickupEventTypes.LiveSessionRemoved, async (data: MessagePickupLiveSessionRemovedEvent) => {
    logger.debug(`********* Live Mode Session removed for ${data.payload.session.connectionId}`)
    if (messageRepository instanceof MessagePickupRepositoryClient) {
      const connectionId = data.payload.session.connectionId
      await messageRepository.removeLiveSession({ connectionId })
      logger.debug(`*** removeLiveSession succesfull ${data.payload.session.connectionId} ***`)
    }
  })

  agent.events.on(MessagePickupEventTypes.LiveSessionSaved, async (data: MessagePickupLiveSessionSavedEvent) => {
    logger.debug(`********** Live Mode Session for ${data.payload.session.connectionId}`)
    if (messageRepository instanceof MessagePickupRepositoryClient) {
      const connectionId = data.payload.session.connectionId
      const sessionId = data.payload.session.id
      await messageRepository.addLiveSession({ connectionId, sessionId })
      logger.debug(`*** addLiveSession successful for ${data.payload.session.connectionId} ***`)
    }
  })

  // Handle mediation events
  agent.events.on<MediationStateChangedEvent>(
    RoutingEventTypes.MediationStateChanged,
    async (data: MediationStateChangedEvent) => {
      const mediationRecord = data.payload.mediationRecord

      if (mediationRecord.state === MediationState.Requested) {
        await agent.mediator.grantRequestedMediation(mediationRecord.id)
      }
    }
  )

  const server = httpInboundTransport ? httpInboundTransport.server : app.listen(config.port)

  if (config.enableWs) {
    server?.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket as Socket, head, (socketParam) => {
        const socketId = utils.uuid()
        webSocketServer.emit('connection', socketParam, request, socketId)
      })
    })
  }

  agent.events.on<AgentMessageProcessedEvent>(AgentEventTypes.AgentMessageProcessed, async (data) => {
    logger.info(`Message processed for connection id ${data.payload.connection?.id} Type: ${data.payload.message.type}`)

    const { message, connection } = data.payload
    if (!connection) return

    if (message.type === PushNotificationsFcmSetDeviceInfoMessage.type.messageTypeUri) {
      connection.setTag('device_token', (message as PushNotificationsFcmSetDeviceInfoMessage).deviceToken)
      await agent.dependencyManager.resolve(ConnectionService).update(agent.context, connection)
    }

    // When receiving a hangup, we must delete connection in order to delete any user info
    if (message.type === HangupMessage.type.messageTypeUri) {
      logger.debug(`Hangup received. Connection Id: ${connection?.id}`)
      await agent.connections.deleteById(connection.id)
      logger.debug(`Connection ${connection?.id} deleted`)

      // TODO: Notify FCM notification sender to cancel any pending notification to connection's device token
    }
  })

  if (publicDid) {
    app.get('/.well-known/did.json', async (req, res) => {
      logger.info(`Public DidDocument requested`)

      const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })

      const didDocument = didRecord.didDocument?.toJSON()

      if (didDocument) {
        res.send(didDocument)
      } else {
        res.status(404).end()
      }
    })

    // If a public did is specified, check if it's already stored in the wallet. If it's not the case,
    // create a new one and generate keys for DIDComm (if there are endpoints configured)
    // TODO: Make DIDComm version, keys, etc. configurable. Keys can also be imported

    // Auto-accept connections that go to the public did
    agent.events.on(ConnectionEventTypes.ConnectionStateChanged, async (data: ConnectionStateChangedEvent) => {
      const connection = data.payload.connectionRecord
      logger.debug(`Incoming connection event: ${connection.state}}`)

      if (connection.outOfBandId) {
        const oob = await agent.oob.findById(connection.outOfBandId)

        if (!oob) return

        const parsedDid = tryParseDid(oob.outOfBandInvitation.id)
        if (parsedDid?.did === publicDid && data.payload.connectionRecord.state === DidExchangeState.RequestReceived) {
          logger.debug(`Incoming connection request for ${publicDid}`)
          await agent.connections.acceptRequest(data.payload.connectionRecord.id)
          logger.debug(`Accepted request for ${publicDid}`)
        }
      }
    })

    const didRepository = agent.context.dependencyManager.resolve(DidRepository)
    const builder = new DidDocumentBuilder(publicDid)

    // Create a set of keys suitable for did communication
    if (config.config.endpoints && config.config.endpoints.length > 0) {
      const verificationMethodId = `${publicDid}#verkey`
      const keyAgreementId = `${publicDid}#key-agreement-1`

      const ed25519 = await agent.context.wallet.createKey({ keyType: KeyType.Ed25519 })
      const publicKeyX25519 = TypedArrayEncoder.toBase58(
        convertPublicKeyToX25519(TypedArrayEncoder.fromBase58(ed25519.publicKeyBase58))
      )

      builder
        .addContext('https://w3id.org/security/suites/ed25519-2018/v1')
        .addContext('https://w3id.org/security/suites/x25519-2019/v1')
        .addVerificationMethod({
          controller: publicDid,
          id: verificationMethodId,
          publicKeyBase58: ed25519.publicKeyBase58,
          type: 'Ed25519VerificationKey2018',
        })
        .addVerificationMethod({
          controller: publicDid,
          id: keyAgreementId,
          publicKeyBase58: publicKeyX25519,
          type: 'X25519KeyAgreementKey2019',
        })
        .addAuthentication(verificationMethodId)
        .addAssertionMethod(verificationMethodId)
        .addKeyAgreement(keyAgreementId)

      for (let index = 0; index < agent.config.endpoints.length; index++) {
        builder.addService(
          new DidCommV1Service({
            id: `${publicDid}#did-communication-${index + 1}`,
            serviceEndpoint: agent.config.endpoints[index],
            priority: index,
            routingKeys: [], // TODO: Support mediation
            recipientKeys: [keyAgreementId],
            accept: ['didcomm/aip2;env=rfc19'],
          })
        )
      }
    }

    const existingRecord = await didRepository.findCreatedDid(agent.context, publicDid)
    if (existingRecord) {
      logger.debug('Public did record already stored. DidDocument updated')
      existingRecord.didDocument = builder.build()
      await didRepository.update(agent.context, existingRecord)
    } else {
      await didRepository.save(
        agent.context,
        new DidRecord({
          did: publicDid,
          role: DidDocumentRole.Created,
          didDocument: builder.build(),
        })
      )
      logger.debug('Public did record saved')
    }
  }

  return { app, agent }
}
