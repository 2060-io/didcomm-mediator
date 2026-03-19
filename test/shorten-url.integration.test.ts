import { jest } from '@jest/globals'
import { agentDependencies } from '@credo-ts/node'
import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import {
  DidCommMediationRepository,
  DidCommMediationRecord,
  DidCommMediationRole,
  DidCommMediationState,
} from '@credo-ts/didcomm'
import type { DidCommMediatorAgent } from '../src/agent/DidCommMediatorAgent'
import {
  DidCommShortenUrlRecord,
  ShortenUrlRole,
  ShortenUrlState,
  DidCommShortenUrlEventTypes,
} from '@2060.io/credo-ts-didcomm-shorten-url'
import { log } from 'console'

// Mock LocalFcmNotificationSender to prevent actual FCM initialization during tests
jest.unstable_mockModule('../src/notifications/LocalFcmNotificationSender.js', () => ({
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
jest.unstable_mockModule('../src/transport/HttpInboundTransport.js', () => ({
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
  let mediationRepository: DidCommMediationRepository

  beforeAll(async () => {
    const { initMediator } = await import('../src/agent/initDidCommMediatorAgent.js')
    const result = await initMediator({
      config: {
        logger: new ConsoleLogger(LogLevel.off),
      },
      wallet: {
        id: 'mediator-test-wallet',
        key: 'mediator-test-key',
        storage: { type: 'sqlite', config: { inMemory: true } },
      },
      did: 'did:web:tests.example.com',
      port: 0,
      enableHttp: true,
      enableWs: false,
      dependencies: agentDependencies,
      shortenInvitationBaseUrl: SHORT_BASE,
      shortenUrlCleanupIntervalSeconds: 0,
      endpoints: [],
    })

    agent = result.agent
    mediationRepository = agent.dependencyManager.resolve(DidCommMediationRepository)
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

    const mediationRecord = new DidCommMediationRecord({
      connectionId: CONNECTION_ID,
      threadId: 'med-thread-001',
      state: DidCommMediationState.Granted,
      role: DidCommMediationRole.Mediator,
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
      recordId: shortenUrlRecord.id,
      shortenedUrl: `${SHORT_BASE}/s?id=${shortenUrlRecord.id}`,
    })

    sendSpy.mockRestore()
    mediationSpy.mockRestore()
  })
})
