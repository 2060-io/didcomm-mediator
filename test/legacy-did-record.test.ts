import { jest } from '@jest/globals'
import { agentDependencies } from '@credo-ts/node'
import {
  ConsoleLogger,
  DidCommV1Service,
  DidDocumentBuilder,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  Kms,
  LogLevel,
  NewDidCommV2Service,
  TypedArrayEncoder,
  parseDid,
} from '@credo-ts/core'
import type { DidCommMediatorAgent } from '../src/agent/DidCommMediatorAgent'

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
      return
    }
    public async stop() {
      return
    }
  },
}))

const PUBLIC_DID = 'did:web:legacy.example.com'
const ENDPOINT = 'wss://legacy.example.com'

describe('Legacy did:web record', () => {
  let agent: DidCommMediatorAgent
  let didRepository: DidRepository

  beforeAll(async () => {
    const { initMediator } = await import('../src/agent/initDidCommMediatorAgent.js')
    const result = await initMediator({
      config: { logger: new ConsoleLogger(LogLevel.Off) },
      wallet: {
        id: 'legacy-did-test-wallet',
        key: 'legacy-did-test-key',
        storage: { type: 'sqlite', config: { inMemory: true } },
      },
      port: 0,
      // The HTTP inbound transport is mocked above, so no server listens
      enableHttp: true,
      enableWs: false,
      dependencies: agentDependencies,
      shortenUrlCleanupIntervalSeconds: 0,
      endpoints: [ENDPOINT],
    })
    agent = result.agent
    didRepository = agent.dependencyManager.resolve(DidRepository)
  })

  afterAll(async () => {
    await agent.shutdown()
  })

  // Build the record exactly as mediator 1.x did: an Ed25519VerificationKey2018 key, an X25519
  // key derived from it, and did-communication services that reference the X25519 key.
  const seedLegacyRecord = async () => {
    const kms = agent.context.resolve(Kms.KeyManagementApi)
    const { publicJwk } = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const ed25519 = Kms.PublicJwk.fromPublicJwk(publicJwk)
    const x25519 = ed25519.convertTo(Kms.X25519PublicJwk)

    const didDocument = new DidDocumentBuilder(PUBLIC_DID)
      .addContext('https://w3id.org/security/suites/ed25519-2018/v1')
      .addContext('https://w3id.org/security/suites/x25519-2019/v1')
      .addVerificationMethod({
        controller: PUBLIC_DID,
        id: `${PUBLIC_DID}#verkey`,
        publicKeyBase58: TypedArrayEncoder.toBase58(ed25519.publicKey.publicKey),
        type: 'Ed25519VerificationKey2018',
      })
      .addVerificationMethod({
        controller: PUBLIC_DID,
        id: `${PUBLIC_DID}#key-agreement-1`,
        publicKeyBase58: TypedArrayEncoder.toBase58(x25519.publicKey.publicKey),
        type: 'X25519KeyAgreementKey2019',
      })
      .addAuthentication(`${PUBLIC_DID}#verkey`)
      .addAssertionMethod(`${PUBLIC_DID}#verkey`)
      .addKeyAgreement(`${PUBLIC_DID}#key-agreement-1`)
      .addService(
        new DidCommV1Service({
          id: `${PUBLIC_DID}#did-communication-1`,
          serviceEndpoint: ENDPOINT,
          priority: 0,
          routingKeys: [],
          recipientKeys: [`${PUBLIC_DID}#key-agreement-1`],
          accept: ['didcomm/aip2;env=rfc19'],
        })
      )
      .build()

    await didRepository.save(
      agent.context,
      new DidRecord({ did: PUBLIC_DID, role: DidDocumentRole.Created, didDocument })
    )
  }

  const bootstrap = async () => {
    agent.did = PUBLIC_DID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (agent as any).bootstrapPublicDid(parseDid(PUBLIC_DID))
  }

  test('recreates a 1.x record with managed keys and services', async () => {
    await seedLegacyRecord()
    const legacyRecord = await didRepository.findCreatedDid(agent.context, PUBLIC_DID)
    expect(legacyRecord?.keys).toBeUndefined()

    await bootstrap()

    const records = await didRepository.findByQuery(agent.context, { did: PUBLIC_DID })
    expect(records).toHaveLength(1)
    const [record] = records
    expect(record.id).not.toBe(legacyRecord?.id)
    expect(record.getTag('domain')).toBe('legacy.example.com')

    const didDocument = record.didDocument
    expect(didDocument).toBeDefined()
    const verificationMethods = didDocument?.verificationMethod ?? []
    expect(verificationMethods.map((vm) => vm.type).sort()).toEqual(['Ed25519VerificationKey2020', 'Multikey'])
    expect(verificationMethods.find((vm) => vm.id === `${PUBLIC_DID}#verkey`)).toBeUndefined()

    const ed25519 = verificationMethods.find((vm) => vm.type === 'Ed25519VerificationKey2020')
    const keyAgreement = verificationMethods.find((vm) => vm.id === `${PUBLIC_DID}#key-agreement-1`)
    expect(keyAgreement?.publicKeyMultibase?.startsWith('z6LS')).toBe(true)
    expect(didDocument?.authentication).toEqual([ed25519?.id])
    expect(didDocument?.keyAgreement).toEqual([keyAgreement?.id])

    const services = didDocument?.service ?? []
    const v1Service = services.find((s) => s.type === DidCommV1Service.type) as DidCommV1Service | undefined
    expect(v1Service?.recipientKeys).toEqual([ed25519?.id])
    expect(v1Service?.serviceEndpoint).toBe(ENDPOINT)
    expect(services.some((s) => s.type === NewDidCommV2Service.type)).toBe(true)

    // Both managed keys are mapped to KMS keys
    expect(record.keys?.map((key) => key.didDocumentRelativeKeyId).sort()).toEqual(
      [`#${ed25519?.publicKeyMultibase}`, '#key-agreement-1'].sort()
    )
  })

  test('keeps the recreated record on the next start', async () => {
    const [before] = await didRepository.findByQuery(agent.context, { did: PUBLIC_DID })

    await bootstrap()

    const records = await didRepository.findByQuery(agent.context, { did: PUBLIC_DID })
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(before.id)
    expect(records[0].keys).toEqual(before.keys)
  })
})
