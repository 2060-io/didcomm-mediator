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
import WebSocket from 'ws'
import { Socket } from 'net'

import { CloudAgentOptions, createMediator } from './DidCommMediatorAgent'
import { MediatorWsInboundTransport } from '../transport/MediatorWsInboundTransport'
import { HttpInboundTransport } from '../transport/HttpInboundTransport'
import express from 'express'
import cors from 'cors'
import { PushNotificationsFcmSetDeviceInfoMessage } from '@credo-ts/push-notifications'
import { tryParseDid } from '@credo-ts/core/build/modules/dids/domain/parse'
import { InMemoryMessagePickupRepository } from '../storage/InMemoryMessagePickupRepository'
import { LocalFcmNotificationSender } from '../notifications/LocalFcmNotificationSender'
import { MessagePickupRepositoryClient } from '@2060.io/message-pickup-repository-client'
import { ConnectionInfo } from '@2060.io/message-pickup-repository-client/build/interfaces'
import { PostgresMessagePickupRepository } from '@2060.io/credo-ts-message-pickup-repository-pg'

export const initMediator = async (config: CloudAgentOptions) => {
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
    // Define function that use to send push notification.

    const localFcmNotificationSender = new LocalFcmNotificationSender(logger)

    const connectionInfoCallback = async (connectionId: string) => {
      const connectionRecord = await agent.connections.findById(connectionId)

      const token = connectionRecord?.getTag('device_token') as string | null

      return {
        sendPushNotification:
          token && localFcmNotificationSender.isInitialized()
            ? async (messageId: string) => {
                await localFcmNotificationSender.sendMessage(token, messageId)
              }
            : undefined,
      }
    }
    await messageRepository.initialize({
      agent,
      connectionInfoCallback,
    })
  }

  const app = express()

  app.use(cors())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  app.set('json spaces', 2)

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
