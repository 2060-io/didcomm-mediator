import { jest } from '@jest/globals'
import { agentDependencies } from '@credo-ts/node'
import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import type { Express } from 'express'
import request from 'supertest'
import type { DidCommMediatorAgent } from '../src/agent/DidCommMediatorAgent'

const PUBLIC_DID = 'did:web:startup.example.com'
const ENDPOINT = 'wss://startup.example.com'

// Responses to the requests that the mocked transport sends while the agent initializes
const responsesDuringStartup: Record<string, number> = {}

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

// The real transport starts the HTTP server during agent initialization, before the public DID
// is created. This mock sends the requests at that time, without a listening port.
jest.unstable_mockModule('../src/transport/HttpInboundTransport.js', () => ({
  HttpInboundTransport: class {
    public app: Express
    public server = { close: jest.fn() }
    public constructor(options: { app: Express }) {
      this.app = options.app
    }
    public async start() {
      for (const path of ['/.well-known/did.json', '/.well-known/did.jsonl', '/health/ready', '/s?id=x']) {
        responsesDuringStartup[path] = (await request(this.app).get(path)).status
      }
    }
    public async stop() {
      return
    }
  },
}))

describe('Startup readiness', () => {
  let agent: DidCommMediatorAgent
  let app: Express

  beforeAll(async () => {
    const { initMediator } = await import('../src/agent/initDidCommMediatorAgent.js')
    const result = await initMediator({
      config: { logger: new ConsoleLogger(LogLevel.Off) },
      wallet: {
        id: 'startup-readiness-test-wallet',
        key: 'startup-readiness-test-key',
        storage: { type: 'sqlite', config: { inMemory: true } },
      },
      did: PUBLIC_DID,
      port: 0,
      enableHttp: true,
      enableWs: false,
      dependencies: agentDependencies,
      shortenUrlCleanupIntervalSeconds: 0,
      endpoints: [ENDPOINT],
    })
    agent = result.agent
    app = result.app
  })

  afterAll(async () => {
    await agent?.shutdown()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns 503 from storage routes and the readiness route before initialization is complete', () => {
    expect(responsesDuringStartup).toEqual({
      '/.well-known/did.json': 503,
      '/.well-known/did.jsonl': 503,
      '/health/ready': 503,
      '/s?id=x': 503,
    })
  })

  it('returns 200 from the readiness route after initialization', async () => {
    await request(app).get('/health/ready').expect(200)
  })

  it('returns the public DID document after initialization', async () => {
    const response = await request(app).get('/.well-known/did.json').expect(200)
    expect(response.body.id).toBe(PUBLIC_DID)
    expect(response.body.service).toEqual(
      expect.arrayContaining([expect.objectContaining({ serviceEndpoint: ENDPOINT })])
    )
  })

  it('returns 500 and keeps the process alive when the DID lookup fails', async () => {
    jest.spyOn(agent.dids, 'getCreatedDids').mockRejectedValue(new Error('storage failure'))

    await request(app).get('/.well-known/did.json').expect(500)
    await request(app).get('/.well-known/did.jsonl').expect(500)
  })
})
