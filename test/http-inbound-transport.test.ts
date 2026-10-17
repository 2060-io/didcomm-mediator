import { EventEmitter as NodeEventEmitter } from 'events'
import { ConsoleLogger, EventEmitter, LogLevel, type AgentContext } from '@credo-ts/core'
import {
  DIDCOMM_V2_ENCRYPTED_MIME_TYPE,
  DIDCOMM_V2_SIGNED_MIME_TYPE,
  DidCommEventTypes,
  DidCommMimeType,
  DidCommModuleConfig,
  DidCommTransportService,
  type DidCommEncryptedMessage,
  type DidCommMessageReceivedEvent,
} from '@credo-ts/didcomm'
import request from 'supertest'
import { HttpInboundTransport } from '../src/transport/HttpInboundTransport.js'

const v2EncryptedMessage = {
  protected: Buffer.from(
    JSON.stringify({ typ: DIDCOMM_V2_ENCRYPTED_MIME_TYPE, alg: 'ECDH-ES+A256KW', enc: 'A256GCM' })
  ).toString('base64url'),
  recipients: [{ header: { kid: 'did:example:bob#key-1' }, encrypted_key: 'key' }],
  iv: 'iv',
  ciphertext: 'ciphertext',
  tag: 'tag',
}

const v1EncryptedMessage = {
  protected: Buffer.from(
    JSON.stringify({ enc: 'xchacha20poly1305_ietf', typ: 'JWM/1.0', alg: 'Anoncrypt', recipients: [] })
  ).toString('base64url'),
  iv: 'iv',
  ciphertext: 'ciphertext',
  tag: 'tag',
}

describe('HttpInboundTransport', () => {
  const emitter = new NodeEventEmitter()
  const eventEmitter = {
    on: (type: string, listener: (event: unknown) => void) => emitter.on(type, listener),
    off: (type: string, listener: (event: unknown) => void) => emitter.off(type, listener),
    emit: (_agentContext: AgentContext, event: { type: string }) => emitter.emit(event.type, event),
  }
  const agentContext = {
    config: { logger: new ConsoleLogger(LogLevel.Off) },
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === EventEmitter) return eventEmitter
        if (token === DidCommTransportService) return { removeSession: () => undefined }
        if (token === DidCommModuleConfig) return { didCommMimeType: DidCommMimeType.V1 }
        throw new Error(`Unexpected dependency ${token}`)
      },
    },
  } as unknown as AgentContext

  const transport = new HttpInboundTransport({ port: 0 })
  let received: unknown[] = []
  let reply: DidCommEncryptedMessage | undefined

  beforeAll(async () => {
    emitter.on(DidCommEventTypes.DidCommMessageReceived, async (event: DidCommMessageReceivedEvent) => {
      received.push(event.payload.message)
      if (reply) await event.payload.session?.send(agentContext, reply)
      emitter.emit(DidCommEventTypes.DidCommMessageProcessed, {
        type: DidCommEventTypes.DidCommMessageProcessed,
        payload: { encryptedMessage: event.payload.message },
      })
    })
    await transport.start(agentContext)
  })

  beforeEach(() => {
    received = []
    reply = undefined
  })

  afterAll(async () => {
    await transport.stop()
  })

  it.each([
    DIDCOMM_V2_ENCRYPTED_MIME_TYPE,
    DIDCOMM_V2_SIGNED_MIME_TYPE,
    `${DIDCOMM_V2_ENCRYPTED_MIME_TYPE}; charset=utf-8`,
    'didcomm-encrypted+json',
  ])('accepts a POST with content type %s', async (contentType) => {
    const response = await request(transport.app)
      .post('/')
      .set('Content-Type', contentType)
      .send(JSON.stringify(v2EncryptedMessage))

    expect(response.status).toBe(200)
    expect(received).toEqual([v2EncryptedMessage])
  })

  it('answers a v2 message on the same request with the v2 encrypted content type', async () => {
    reply = v2EncryptedMessage

    const response = await request(transport.app)
      .post('/')
      .set('Content-Type', DIDCOMM_V2_ENCRYPTED_MIME_TYPE)
      .send(JSON.stringify(v2EncryptedMessage))

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain(DIDCOMM_V2_ENCRYPTED_MIME_TYPE)
    expect(JSON.parse(response.text)).toEqual(v2EncryptedMessage)
  })

  it.each([DidCommMimeType.V0, DidCommMimeType.V1])(
    'answers a %s message on the same request with the request content type',
    async (contentType) => {
      reply = v1EncryptedMessage

      const response = await request(transport.app)
        .post('/')
        .set('Content-Type', contentType)
        .send(JSON.stringify(v1EncryptedMessage))

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain(contentType)
      expect(received).toEqual([v1EncryptedMessage])
    }
  )

  it('rejects an unsupported content type', async () => {
    const response = await request(transport.app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(v2EncryptedMessage))

    expect(response.status).toBe(415)
    expect(received).toEqual([])
  })
})
