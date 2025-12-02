import { initMediator } from '../src/agent/initDidCommMediatorAgent'
import { agentDependencies } from '@credo-ts/node'
import {
  ConsoleLogger,
  LogLevel,
  MediationRepository,
  MediationRecord,
  MediationRole,
  MediationState,
} from '@credo-ts/core'
import type { DidCommMediatorAgent } from '../src/agent/DidCommMediatorAgent'
import {
  DidCommShortenUrlRecord,
  ShortenUrlRole,
  ShortenUrlState,
  DidCommShortenUrlEventTypes,
} from '@2060.io/credo-ts-didcomm-shorten-url'
import { log } from 'console'

// Mock LocalFcmNotificationSender to prevent actual FCM initialization during tests
jest.mock('../src/notifications/LocalFcmNotificationSender', () => ({
  LocalFcmNotificationSender: class {
    public isInitialized() {
      return false
    }
    public async sendMessage() {
      return false
    }
  },
}))

// Mock HttpInboundTransport to prevent actual server from starting during tests
jest.mock('../src/transport/HttpInboundTransport', () => ({
  HttpInboundTransport: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public app: any
    public server = { close: jest.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public constructor(options: any) {
      this.app = options.app
    }
    public async start() {
      log('HTTP Inbound Transport started')
    }
    public async stop() {
      log('HTTP Inbound Transport stopped')
    }
  },
}))

describe('Shorten URL integration', () => {
  const SHORT_BASE = 'https://tests.example.com'
  const CONNECTION_ID = 'conn-test-001'
  const THREAD_ID = 'thread-001'

  let agent: DidCommMediatorAgent
  let mediationRepository: MediationRepository

  beforeAll(async () => {
    const result = await initMediator({
      config: {
        label: 'mediator-test',
        endpoints: [],
        walletConfig: {
          id: 'mediator-test-wallet',
          key: 'mediator-test-key',
          storage: { type: 'sqlite', config: { inMemory: true } },
        },
        autoUpdateStorageOnStartup: false,
        backupBeforeStorageUpdate: false,
        logger: new ConsoleLogger(LogLevel.off),
      },
      did: 'did:web:tests.example.com',
      port: 0,
      enableHttp: true,
      enableWs: false,
      dependencies: agentDependencies,
      shortenInvitationBaseUrl: SHORT_BASE,
      shortenUrlCleanupIntervalSeconds: 0,
    })

    agent = result.agent
    mediationRepository = agent.dependencyManager.resolve(MediationRepository)
  })

  afterAll(async () => {
    await agent?.shutdown()
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('sends shortened URL using configured base when receiving a request event', async () => {
    const shortenUrlRecord = new DidCommShortenUrlRecord({
      connectionId: CONNECTION_ID,
      threadId: THREAD_ID,
      role: ShortenUrlRole.UrlShortener,
      state: ShortenUrlState.RequestReceived,
      url: 'https://example.com/invite?oob=abc',
      requestedValiditySeconds: 600,
    })

    const mediationRecord = new MediationRecord({
      connectionId: CONNECTION_ID,
      threadId: 'med-thread-001',
      state: MediationState.Granted,
      role: MediationRole.Mediator,
      recipientKeys: [],
      routingKeys: [],
    })

    const mediationSpy = jest.spyOn(mediationRepository, 'getByConnectionId').mockResolvedValue(mediationRecord)

    const sendSpy = jest
      .spyOn(agent.modules.shortenUrl, 'sendShortenedUrl')
      .mockResolvedValue({ messageId: 'mock-message' })

    // Emit the event to simulate receiving a request for a shortened URL
    agent.events.emit(agent.context, {
      type: DidCommShortenUrlEventTypes.DidCommRequestShortenedUrlReceived,
      payload: {
        shortenUrlRecord,
      },
    })

    await new Promise((resolve) => setImmediate(resolve))
    // Allow async event handlers to complete
    expect(sendSpy).toHaveBeenCalledWith({
      recordId: shortenUrlRecord.threadId,
      shortenedUrl: `${SHORT_BASE}/s?id=${shortenUrlRecord.id}`,
    })

    sendSpy.mockRestore()
    mediationSpy.mockRestore()
  })
})
