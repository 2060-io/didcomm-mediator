import type { IncomingMessage } from 'http'
import type { Express } from 'express'

import {
  ConsoleLogger,
  DidCommV1Service,
  DidDocumentBuilder,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  LogLevel,
  TypedArrayEncoder,
  convertPublicKeyToX25519,
  utils,
} from '@credo-ts/core'
import {
  DidCommApi,
  DidCommRoutingEventTypes,
  DidCommMediationStateChangedEvent,
  DidCommMediationState,
  DidCommConnectionEventTypes,
  type DidCommConnectionStateChangedEvent,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import {
  DidCommInvalidateShortenedUrlReceivedEvent,
  DidCommRequestShortenedUrlReceivedEvent,
  DidCommShortenUrlEventTypes,
  DidCommShortenUrlRepository,
} from '@2060.io/credo-ts-didcomm-shorten-url'
import cors from 'cors'
import express from 'express'
import { WebSocketServer } from 'ws'
import { Socket } from 'net'
import { DidCommHttpOutboundTransport, DidCommWsOutboundTransport } from '@credo-ts/didcomm'

import { LocalFcmNotificationSender } from '../notifications/LocalFcmNotificationSender.js'
import {
  InMemoryQueueTransportRepository,
  PostgresQueueTransportRepository,
} from '../storage/QueueTransportRepository.js'
import { createMediator, type CloudAgentOptions, DidCommMediatorAgent } from './DidCommMediatorAgent.js'
import { deriveShortenBaseFromPublicDid } from '../util/invitationBase.js'
import { isShortenUrlRecordExpired, startShortenUrlRecordsCleanupMonitor } from '../util/shortenUrlRecordsCleanup.js'
import { HttpInboundTransport } from '../transport/HttpInboundTransport.js'
import { MediatorWsInboundTransport } from '../transport/MediatorWsInboundTransport.js'
import { DidCommTransportQueuePostgres } from '@credo-ts/didcomm-transport-queue-postgres'

export const initMediator = async (
  config: Omit<CloudAgentOptions, 'inboundTransports' | 'outboundTransports' | 'queueTransportRepository'> & {
    shortenInvitationBaseUrl?: string
    shortenUrlCleanupIntervalSeconds?: number
    messagePickupMaxReceiveBytes?: number
    postgresUser?: string
    postgresPassword?: string
    postgresHost?: string
    messagePickupPostgresDatabaseName?: string
    did?: string
  }
): Promise<{ app: Express; agent: DidCommMediatorAgent }> => {
  const logger = config.config.logger ?? new ConsoleLogger(LogLevel.off)
  const publicDid = config.did
  const shortenInvitationBaseUrl =
    config.shortenInvitationBaseUrl ??
    (config.did ? await deriveShortenBaseFromPublicDid(config.did) : undefined) ??
    'http://localhost:4000'
  const localFcmNotificationSender = new LocalFcmNotificationSender(logger)

  const queueTransportRepository =
    config.postgresHost && config.postgresUser && config.postgresPassword
      ? new PostgresQueueTransportRepository(
          {
            logger,
            postgresUser: config.postgresUser,
            postgresPassword: config.postgresPassword,
            postgresHost: config.postgresHost,
            postgresDatabaseName: config.messagePickupPostgresDatabaseName ?? 'messagepickuprepository',
          },
          localFcmNotificationSender 
        )
      : new InMemoryQueueTransportRepository(localFcmNotificationSender)

  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.set('json spaces', 2)

  const inboundTransports = []
  const outboundTransports = [new DidCommWsOutboundTransport(), new DidCommHttpOutboundTransport()]

  let webSocketServer: WebSocketServer | undefined
  if (config.enableHttp) {
    inboundTransports.push(new HttpInboundTransport({ app, port: config.port }))
  }
  if (config.enableWs) {
    webSocketServer = new WebSocketServer({ noServer: true })
    inboundTransports.push(new MediatorWsInboundTransport({ server: webSocketServer }))
  }

  const agent = await createMediator({
    ...config,
    endpoints: config.endpoints ?? [],
    inboundTransports,
    outboundTransports,
    queueTransportRepository,
  })

  const didcommApi = agent.dependencyManager.resolve(DidCommApi)
  const shortenUrlRepository = agent.dependencyManager.resolve(DidCommShortenUrlRepository)

  if (queueTransportRepository instanceof DidCommTransportQueuePostgres) {
    await queueTransportRepository.initialize(agent)
  }

  startShortenUrlRecordsCleanupMonitor(agent.context, config.shortenUrlCleanupIntervalSeconds)
  logger.info(`[ShortenUrlCleanup] Cleanup on startup completed`)

  agent.events.on<DidCommRequestShortenedUrlReceivedEvent>(
    DidCommShortenUrlEventTypes.DidCommRequestShortenedUrlReceived,
    async ({ payload }) => {
      const { shortenUrlRecord } = payload
      const shortenedUrl = `${shortenInvitationBaseUrl}/s?id=${payload.shortenUrlRecord.id}`
      try {
        await agent.modules.shortenUrl.sendShortenedUrl({
          recordId: payload.shortenUrlRecord.id,
          shortenedUrl,
        })
        logger.info(`[ShortenUrl] shortened url generated and sent for connection ${shortenUrlRecord.connectionId}`)
      } catch (error) {
        logger.error(`[ShortenUrl] failed to process shorten url request: ${error}`)
      }
    }
  )

  agent.events.on<DidCommInvalidateShortenedUrlReceivedEvent>(
    DidCommShortenUrlEventTypes.DidCommInvalidateShortenedUrlReceived,
    async ({ payload }) => {
      const { shortenUrlRecord } = payload
      logger.info(
        `[ShortenUrl] invalidate-shortened-url received for connection ${shortenUrlRecord.connectionId} (${shortenUrlRecord.shortenedUrl})`
      )
      try {
        await shortenUrlRepository.deleteById(agent.context, payload.shortenUrlRecord.id)
        logger.info(`[ShortenUrl] shortened url record deleted for connection ${shortenUrlRecord.connectionId})`)
      } catch (error) {
        logger.error(`[ShortenUrl] failed to process invalidate shortened url request: ${error}`)
      }
    }
  )

  agent.events.on<DidCommMediationStateChangedEvent>(
    DidCommRoutingEventTypes.MediationStateChanged,
    async ({ payload }) => {
      logger.info(
        `Mediation state changed to ${payload.mediationRecord.state} for record ${payload.mediationRecord.id}`
      )
      if (payload.mediationRecord.state === DidCommMediationState.Requested) {
        await didcommApi.mediator?.grantRequestedMediation(payload.mediationRecord.id)
      }
    }
  )

  if (publicDid) {
    app.get('/.well-known/did.json', async (_req, res) => {
      logger.info(`Public DidDocument requested`)

      const didRecord = await agent.dependencyManager.resolve(DidRepository).findCreatedDid(agent.context, publicDid)
      const didDocument = didRecord?.didDocument?.toJSON()

      if (didDocument) {
        res.send(didDocument)
      } else {
        res.status(404).end()
      }
    })

    agent.events.on<DidCommConnectionStateChangedEvent>(
      DidCommConnectionEventTypes.DidCommConnectionStateChanged,
      async ({ payload }) => {
        const connection = payload.connectionRecord
        if (connection.outOfBandId && payload.connectionRecord.state === DidCommDidExchangeState.RequestReceived) {
          const oob = await agent.didcomm.oob.findById(connection.outOfBandId)
          const invitationId = oob?.outOfBandInvitation?.id ?? oob?.outOfBandInvitation?.invitationId
          if (invitationId === publicDid) {
            logger.debug(`Incoming connection request for ${publicDid}`)
            await agent.didcomm.connections.acceptRequest(connection.id)
            logger.debug(`Accepted request for ${publicDid}`)
          }
        }
      }
    )

    const didRepository = agent.context.dependencyManager.resolve(DidRepository)
    const builder = new DidDocumentBuilder(publicDid)

    if (config.endpoints && config.endpoints.length > 0) {
      const verificationMethodId = `${publicDid}#verkey`
      const keyAgreementId = `${publicDid}#key-agreement-1`

      const wallet =
        (
          agent as unknown as {
            wallet?: { createKey: (options: { keyType: string }) => Promise<{ publicKeyBase58: string }> }
          }
        ).wallet ??
        (
          agent.context as unknown as {
            wallet?: { createKey: (options: { keyType: string }) => Promise<{ publicKeyBase58: string }> }
          }
        ).wallet
      const ed25519 = wallet
        ? await wallet.createKey({ keyType: 'ed25519' })
        : await (
            agent.context as unknown as {
              wallet: { createKey: (options: { keyType: string }) => Promise<{ publicKeyBase58: string }> }
            }
          ).wallet.createKey({
            keyType: 'ed25519',
          })
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

      for (let index = 0; index < config.endpoints.length; index++) {
        builder.addService(
          new DidCommV1Service({
            id: `${publicDid}#did-communication-${index + 1}`,
            serviceEndpoint: config.endpoints[index],
            priority: index,
            routingKeys: [],
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

  app.get('/s', async (req, res) => {
    const id = req.query.id
    try {
      if (typeof id !== 'string') {
        logger.warn('[ShortenUrl] /s endpoint called without id query parameter')
        return res.status(400).json({ error: 'Query parameter "id" is required' })
      }
      logger.debug(`[ShortenUrl] /s endpoint called with id ${id}`)

      const shortUrlRecord = await shortenUrlRepository.findById(agent.context, id)
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
      if (await isShortenUrlRecordExpired(shortUrlRecord)) {
        shortenUrlRepository.deleteById(agent.context, id)
        logger.info('[ShortenUrl] /s endpoint received expired shortened URL', { id })
        return res.status(410).json({ error: 'Shortened URL has expired' })
      }

      if (req.accepts('json')) {
        const invitationUrl = await didcommApi.oob.parseInvitation(longUrl)
        res.send(invitationUrl.toJSON()).end()
      } else {
        res.status(302).location(longUrl).end()
      }
    } catch (error) {
      logger.error(`[ShortenUrl] failed to retrieve shortened url for id ${id}: ${error}`)
      res.status(500).send('Internal Server Error')
    }
  })

  app.get('/invitation', async (req, res) => {
    logger.info(`Invitation requested`)
    const outOfBandInvitation = (
      await didcommApi.oob.createInvitation({
        imageUrl: process.env.AGENT_INVITATION_IMAGE_URL,
      })
    ).outOfBandInvitation
    res.send({
      url: outOfBandInvitation.toUrl({ domain: process.env.AGENT_INVITATION_BASE_URL ?? 'https://2060.io/i' }),
    })
  })

  await agent.initialize()
  logger.info('agent initialized')

  const server =
    (
      agent.modules.didcomm.inboundTransports.find(
        (transport: unknown) => transport instanceof HttpInboundTransport
      ) as HttpInboundTransport | undefined
    )?.server ?? app.listen(config.port)

  if (config.enableWs && webSocketServer) {
    server?.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      webSocketServer.handleUpgrade(request, socket as Socket, head, (socketParam) => {
        const socketId = utils.uuid()
        webSocketServer.emit('connection', socketParam, request, socketId)
      })
    })
  }

  return { app, agent }
}
