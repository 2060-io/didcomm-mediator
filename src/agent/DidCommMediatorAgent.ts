import {
  Agent,
  AgentDependencies,
  convertPublicKeyToX25519,
  CredoError,
  DependencyManager,
  DidCommV1Service,
  DidDocument,
  DidRepository,
  DidsModule,
  InitConfig,
  JsonTransformer,
  Kms,
  NewDidCommV2Service,
  NewDidCommV2ServiceEndpoint,
  ParsedDid,
  parseDid,
  PeerDidNumAlgo,
  WebDidResolver,
} from '@credo-ts/core'
import { askarNodeJS, KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { createRequire } from 'module'
import {
  DidCommHttpOutboundTransport,
  DidCommMessageForwardingStrategy,
  DidCommMimeType,
  DidCommModule,
  type DidCommOutboundTransport,
  DidCommWsOutboundTransport,
  type DidCommInboundTransport,
  type DidCommQueueTransportRepository,
} from '@credo-ts/didcomm'
import { PushNotificationsFcmModule } from '@credo-ts/didcomm-push-notifications'
import { DidCommShortenUrlModule, ShortenUrlRole } from '@2060.io/credo-ts-didcomm-shorten-url'
import { WebVhDidResolver, WebVhDidRegistrar } from '@credo-ts/webvh'
import { multibaseEncode, MultibaseEncoding } from 'didwebvh-ts'
import { WebDidRegistrar } from './WebDidRegistrar.js'
import { DIDCOMM_V1_SUPPORT, DIDCOMM_V2_SUPPORT } from '../config/constants.js'

const MANAGED_DIDCOMM_SERVICE_TYPES = [DidCommV1Service.type, NewDidCommV2Service.type] as const

interface AgentOptions<Modules> {
  config: InitConfig
  modules?: Modules
  dependencies: AgentDependencies
}

export class DidCommMediatorAgent extends Agent {
  public did?: string

  public constructor(
    options: AgentOptions<Record<string, unknown>>,
    did?: string,
    dependencyManager?: DependencyManager
  ) {
    super(options, dependencyManager)
    this.did = did
  }

  public async initialize() {
    await super.initialize()

    const parsedDid = this.did ? parseDid(this.did) : null
    if (!parsedDid) return

    // Add a lock to make a single instance update the DID record if needed
    const lockId = `did-bootstrap:${parsedDid.did}`
    const acquired = await this.acquireBootstrapLock(lockId, {
      ttlMs: 5 * 60 * 1000,
      maxWaitMs: 2 * 60 * 1000,
      pollMs: 1000,
    })
    if (!acquired) {
      this.logger?.warn(
        `Could not acquire DID bootstrap lock for ${parsedDid.did} within the wait window; proceeding with best-effort read-only initialization`
      )
    }
    try {
      await this.bootstrapPublicDid(parsedDid)
    } finally {
      if (acquired) await this.releaseBootstrapLock(lockId)
    }
  }

  private async bootstrapPublicDid(parsedDid: ParsedDid) {
    // If a public did is specified, check if it's already stored in the wallet. If it's not the case,
    // create a new one and generate keys for DIDComm (if there are endpoints configured)
    // TODO: Make DIDComm version, keys, etc. configurable. Keys can also be imported
    const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id

    const existingRecord = await this.findCreatedDid(parsedDid)

    // DID has not been created yet. Let's do it
    if (!existingRecord) {
      if (parsedDid.method === 'web') {
        const didDocument = new DidDocument({ id: parsedDid.did })

        // Create the DID record first so it exists when createAndAddDidCommKeysAndServices
        // attempts to attach KMS keys to it (mirrors the did:webvh ordering below).
        await this.dids.create({
          method: 'web',
          domain,
          didDocument,
        })

        await this.createAndAddDidCommKeysAndServices(didDocument)

        // Persist the didDocument mutations (services, verification methods) applied above.
        await this.dids.update({ did: parsedDid.did, didDocument })

        this.did = parsedDid.did
      } else if (parsedDid.method === 'webvh') {
        // If there is an existing did:web with the same domain, this could be an
        // upgrade. There should be no problem on removing did:web record since we
        // can use newer keys for DIDComm bootstrapping, but we should at least warn
        // about that
        const didRepository = this.dependencyManager.resolve(DidRepository)
        const existingDidWebRecord = await didRepository.findCreatedDid(this.context, `did:web:${domain}`)
        if (existingDidWebRecord) {
          this.logger.warn('Existing record for legacy did:web found. Removing it')
          await didRepository.delete(this.context, existingDidWebRecord)
        }

        this.logger.debug(`Creating did:webvh for domain: ${domain}`)
        const {
          didState: { did: publicDid, didDocument },
        } = await this.dids.create({ method: 'webvh', domain })
        if (!publicDid || !didDocument) {
          this.logger.error('Failed to create did:webvh record')
          process.exit(1)
        }

        // Add DIDComm services and keys
        await this.createAndAddDidCommKeysAndServices(didDocument)

        didDocument.alsoKnownAs = [`did:web:${domain}`]

        const result = await this.dids.update({ did: publicDid, didDocument })
        if (result.didState.state !== 'finished') {
          this.logger.error(`Cannot update DID ${publicDid}`)
          process.exit(1)
        }
        this.logger?.debug('Public did:webvh record created')
        this.did = publicDid
      } else {
        throw new CredoError(`Agent DID method not supported: ${parsedDid.method}`)
      }

      return
    }

    // Make sure did:webvh record has the did:web form as an alternative, in order to support
    // implicit invitations
    if (
      parsedDid.method === 'webvh' &&
      !(existingRecord?.getTag('alternativeDids') as string[])?.includes(`did:web:${domain}`)
    ) {
      this.logger?.debug('Adding did:web form as an alternative DID')

      existingRecord.setTag('alternativeDids', [`did:web:${domain}`])
      const didRepository = this.dependencyManager.resolve(DidRepository)
      await didRepository.update(this.agentContext, existingRecord)
    }
    // DID already exists: the only mutation we can apply at startup is updating the
    // DIDComm service entries (e.g. endpoint config has changed). Keys are never
    // rebuilt — they're managed at DID creation time only.
    const didDocument = existingRecord.didDocument!
    if (this.havePublishedDidCommServicesChanged(didDocument)) {
      // `havePublishedDidCommServicesChanged` only returns true when our managed
      // Ed25519VerificationKey2020 is present, so the lookup below cannot be undefined.
      const recipientKeyId = this.findEd25519VerificationMethodId(didDocument)!
      didDocument.service = [
        ...(didDocument.service?.filter((s) => !MANAGED_DIDCOMM_SERVICE_TYPES.includes(s.type)) ?? []),
        ...this.getDidCommServices(didDocument.id, recipientKeyId),
      ]
      await this.dids.update({ did: didDocument.id, didDocument })
      this.logger?.debug(`Public did record updated. Agent public DID: ${this.did}`)
    } else {
      this.logger?.debug(`Existing DID record found. No updates. Agent public DID: ${this.did}`)
    }
    this.did = existingRecord.did
  }

  private async acquireBootstrapLock(
    lockId: string,
    opts: { ttlMs: number; maxWaitMs: number; pollMs: number }
  ): Promise<boolean> {
    const key = `mediator-bootstrap-lock:${lockId}`
    const instanceTag = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const deadline = Date.now() + opts.maxWaitMs

    const tryOnce = async (): Promise<boolean> => {
      try {
        await this.genericRecords.save({
          id: key,
          content: { acquiredAt: Date.now(), instanceTag, ttlMs: opts.ttlMs },
        })
        return true
      } catch {
        // Either duplicate id (lock held) or transient error: inspect existing record
        const existing = await this.genericRecords.findById(key).catch(() => null)
        if (!existing) return false
        const acquiredAt = (existing.content?.acquiredAt as number | undefined) ?? 0
        const ttlMs = (existing.content?.ttlMs as number | undefined) ?? opts.ttlMs
        if (Date.now() - acquiredAt < ttlMs) return false
        // Stale: try to forcibly take over
        this.logger?.warn(`Bootstrap lock ${key} is stale (held by ${existing.content?.instanceTag}); taking over`)
        try {
          await this.genericRecords.delete(existing)
        } catch {
          return false
        }
        try {
          await this.genericRecords.save({
            id: key,
            content: { acquiredAt: Date.now(), instanceTag, ttlMs: opts.ttlMs },
          })
          return true
        } catch {
          return false
        }
      }
    }

    while (true) {
      if (await tryOnce()) return true
      if (Date.now() >= deadline) return false
      this.logger?.debug(`Bootstrap lock ${key} held by another instance; waiting`)
      await new Promise((r) => setTimeout(r, opts.pollMs))
    }
  }

  private async releaseBootstrapLock(lockId: string) {
    const key = `mediator-bootstrap-lock:${lockId}`
    try {
      await this.genericRecords.deleteById(key)
    } catch (error) {
      this.logger?.debug(`Failed to release bootstrap lock ${key}: ${error}`)
    }
  }

  private async findCreatedDid(parsedDid: ParsedDid) {
    const didRepository = this.dependencyManager.resolve(DidRepository)

    // Particular case of webvh: parsedDid might not include the SCID, so we'll need to find it by domain
    if (parsedDid.method === 'webvh') {
      const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id
      return await didRepository.findSingleByQuery(this.context, { method: 'webvh', domain })
    }

    return await didRepository.findCreatedDid(this.context, parsedDid.did)
  }

  /**
   * Look up our managed DIDComm Ed25519 verification method id from a DID Document. The
   * DIDComm v1 `did-communication` service requires an Ed25519 key as `recipientKeys`
   * (not the X25519 key-agreement key, which is reserved for DIDComm v2 / `keyAgreement`).
   * We publish ours as `Ed25519VerificationKey2020`; other Ed25519 keys that may appear
   * in the document (notably the `did:webvh` update key, published as a `Multikey` with
   * `z6Mk…` multibase) are intentionally ignored here.
   */
  private findEd25519VerificationMethodId(didDocument: DidDocument): string | undefined {
    return (didDocument.verificationMethod ?? []).find((vm) => vm.type === 'Ed25519VerificationKey2020')?.id
  }

  private havePublishedDidCommServicesChanged(didDocument: DidDocument): boolean {
    const recipientKeyId = this.findEd25519VerificationMethodId(didDocument)
    if (!recipientKeyId) return false
    const fromDoc = (didDocument.service ?? [])
      .filter((s) => MANAGED_DIDCOMM_SERVICE_TYPES.includes(s.type))
      .map((s) => JsonTransformer.toJSON(s))
    const expected = this.getDidCommServices(didDocument.id, recipientKeyId).map((s) => JsonTransformer.toJSON(s))
    return JSON.stringify(fromDoc) !== JSON.stringify(expected)
  }

  private getDidCommServices(publicDid: string, recipientKeyId: string) {
    const includeV1 = DIDCOMM_V1_SUPPORT
    const includeV2 = DIDCOMM_V2_SUPPORT
    const services: (DidCommV1Service | NewDidCommV2Service)[] = []

    this.didcomm.config.endpoints.forEach((endpoint: string, index: number) => {
      if (includeV1) {
        services.push(
          new DidCommV1Service({
            id: `${publicDid}#did-communication`,
            serviceEndpoint: endpoint,
            priority: index,
            routingKeys: [],
            recipientKeys: [recipientKeyId],
            accept: ['didcomm/aip2;env=rfc19'],
          })
        )
      }
      if (includeV2) {
        services.push(
          new NewDidCommV2Service({
            id: `${publicDid}#didcomm-messaging-${index}`,
            serviceEndpoint: new NewDidCommV2ServiceEndpoint({
              uri: endpoint,
              accept: ['didcomm/v2'],
            }),
          })
        )
      }
    })

    return services
  }

  /**
   * Generate the DIDComm Ed25519 + derived X25519 keys, register the Ed25519 key with the
   * DID record's KMS mapping, and append the corresponding verification methods, verification
   * relations, contexts, and managed services to the passed DID document. Intended to be
   * invoked exactly once per public DID, at creation time.
   */
  private async createAndAddDidCommKeysAndServices(didDocument: DidDocument) {
    const publicDid = didDocument.id

    const didCommContexts = [
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/x25519-2019/v1',
    ]
    const keyAgreementId = `${publicDid}#key-agreement-1`
    const kms = this.agentContext.resolve(Kms.KeyManagementApi)
    const didRepository = this.agentContext.resolve(DidRepository)

    const key = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const publicKeyBytes = Kms.PublicJwk.fromPublicJwk(key.publicJwk).publicKey.publicKey
    const publicKeyMultibase = multibaseEncode(
      new Uint8Array([0xed, 0x01, ...publicKeyBytes]),
      MultibaseEncoding.BASE58_BTC
    )
    const [record] = await didRepository.findByQuery(this.agentContext, { did: publicDid })
    record.keys = [...(record.keys ?? []), { kmsKeyId: key.keyId, didDocumentRelativeKeyId: `#${publicKeyMultibase}` }]
    await didRepository.update(this.agentContext, record)

    const verificationMethodId = `${publicDid}#${publicKeyMultibase}`
    const publicKeyX25519 = convertPublicKeyToX25519(publicKeyBytes)
    const x25519Key = Kms.PublicJwk.fromPublicKey({ kty: 'OKP', crv: 'X25519', publicKey: publicKeyX25519 })

    const verificationMethods = [
      { controller: publicDid, id: verificationMethodId, publicKeyMultibase, type: 'Ed25519VerificationKey2020' },
      { controller: publicDid, id: keyAgreementId, publicKeyMultibase: x25519Key.fingerprint, type: 'Multikey' },
    ]

    const currentContexts = Array.isArray(didDocument.context)
      ? didDocument.context
      : didDocument.context
      ? [didDocument.context]
      : []
    didDocument.context = [...new Set([...currentContexts, ...didCommContexts])]
    didDocument.verificationMethod = [...(didDocument.verificationMethod ?? []), ...verificationMethods]
    // Replace (rather than merge with) the verification relations so that ONLY our managed
    // DIDComm keys are reachable as invitation keys. Some DID method registrars (e.g.
    // did:webvh) add their own update/signing key to `authentication` / `keyAgreement`;
    // peers running `getRecipientKeysWithVerificationMethod` over the resolved doc would
    // otherwise pick those up and treat them as invitation keys, breaking DID Exchange v1.x
    // signature verification on the receiver side. Update keys remain available in
    // `verificationMethod` for the DID method's own log-signing logic.
    didDocument.authentication = [verificationMethodId]
    didDocument.assertionMethod = [verificationMethodId]
    didDocument.keyAgreement = [keyAgreementId]
    didDocument.service = [
      ...(didDocument.service?.filter((s) => !MANAGED_DIDCOMM_SERVICE_TYPES.includes(s.type)) ?? []),
      ...this.getDidCommServices(publicDid, verificationMethodId),
    ]
  }
}

export interface CloudAgentOptions {
  config: InitConfig
  endpoints: string[]
  port: number
  did?: string
  enableHttp?: boolean
  enableWs?: boolean
  dependencies: AgentDependencies
  inboundTransports: DidCommInboundTransport[]
  outboundTransports: DidCommOutboundTransport[]
  queueTransportRepository: DidCommQueueTransportRepository
  wallet: {
    id: string
    key: string
    keyDerivationMethod?: `${KdfMethod.Argon2IInt}` | `${KdfMethod.Argon2IMod}` | `${KdfMethod.Raw}`
    storage?: unknown
  }
}

type AskarPostgresStorageConfig = {
  type: 'postgres'
  config: {
    host: string
    connectTimeout?: number
    idleTimeout?: number
    maxConnections?: number
    minConnections?: number
  }
  credentials: { account: string; password: string; adminAccount?: string; adminPassword?: string }
}

const cjsRequire = createRequire(import.meta.url)
const askarShared = cjsRequire('@openwallet-foundation/askar-shared')
askarShared.registerAskar?.({ askar: askarNodeJS })
const askarModulePromise = import('@credo-ts/askar')

export const createMediator = async (options: CloudAgentOptions): Promise<DidCommMediatorAgent> => {
  options.config.logger?.debug?.(`Askar backend registered: ${Boolean(askarShared.askar)}`)
  const { AskarModule } = await askarModulePromise
  const askar = askarNodeJS

  return new DidCommMediatorAgent(
    {
      config: {
        ...options.config,
      },
      dependencies: options.dependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: options.wallet.id,
            key: options.wallet.key,
            keyDerivationMethod: options.wallet.keyDerivationMethod,
            database: options.wallet.storage as AskarPostgresStorageConfig | undefined,
          },
          enableKms: true,
          enableStorage: true,
        }),
        dids: new DidsModule({
          resolvers: [new WebDidResolver(), new WebVhDidResolver()],
          registrars: [new WebDidRegistrar(), new WebVhDidRegistrar()],
        }),
        didcomm: new DidCommModule({
          didcommVersions: ['v1', 'v2'],
          didCommMimeType: DidCommMimeType.V1,
          peerDidNumAlgoForV2OOB:
            process.env.PEER_DID_NUM_ALGO === '2'
              ? PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc
              : PeerDidNumAlgo.ShortFormAndLongForm,
          transports: {
            inbound: options.inboundTransports,
            outbound: options.outboundTransports.length
              ? options.outboundTransports
              : [new DidCommWsOutboundTransport(), new DidCommHttpOutboundTransport()],
          },
          connections: {
            autoAcceptConnections: true,
            autoCreateConnectionOnFirstMessage: true,
          },
          mediator: {
            autoAcceptMediationRequests: true,
            mediationProtocolVersions: ['v1', 'v2'],
            messageForwardingStrategy: DidCommMessageForwardingStrategy.QueueAndLiveModeDelivery,
          },
          credentials: false,
          proofs: false,
          queueTransportRepository: options.queueTransportRepository,
          endpoints: options.endpoints,
        }),
        pushNotifications: new PushNotificationsFcmModule(),
        shortenUrl: new DidCommShortenUrlModule({
          roles: [ShortenUrlRole.UrlShortener],
          maximumRequestedValiditySeconds: 1 * 24 * 60 * 60,
        }),
      },
    },
    options.did
  )
}
