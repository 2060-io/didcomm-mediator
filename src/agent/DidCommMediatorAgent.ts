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
    if (parsedDid) {
      // If a public did is specified, check if it's already stored in the wallet. If it's not the case,
      // create a new one and generate keys for DIDComm (if there are endpoints configured)
      // TODO: Make DIDComm version, keys, etc. configurable. Keys can also be imported
      const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id

      const existingRecord = await this.findCreatedDid(parsedDid)

      // DID has not been created yet. Let's do it
      if (!existingRecord) {
        if (parsedDid.method === 'web') {
          const didDocument = new DidDocument({ id: parsedDid.did })
          await this.createAndAddDidCommKeysAndServices(didDocument)

          await this.dids.create({
            method: 'web',
            domain,
            didDocument,
          })
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
      // DID Already exists: update it in case that agent parameters have been changed. At the moment, we can only update
      //  DIDComm endpoints, so we'll only replace the service (if different from previous)
      const didDocument = existingRecord.didDocument!
      const hasLegacyMethods = (didDocument.verificationMethod ?? []).some((vm) =>
        ['Ed25519VerificationKey2018', 'X25519KeyAgreementKey2019'].includes(vm.type)
      )
      const servicesChanged = this.havePublishedDidCommServicesChanged(didDocument)
      if (hasLegacyMethods || servicesChanged) {
        if (servicesChanged) {
          didDocument.service = [
            ...(didDocument.service
              ? didDocument.service.filter((service) => !MANAGED_DIDCOMM_SERVICE_TYPES.includes(service.type))
              : []),
            ...this.getDidCommServices(didDocument.id),
          ]
        }
        if (hasLegacyMethods) await this.createAndAddDidCommKeysAndServices(didDocument)

        await this.dids.update({ did: didDocument.id, didDocument })
        this.logger?.debug('Public did record updated')
      } else {
        this.logger?.debug('Existing DID record found. No updates')
      }
      this.did = existingRecord.did
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

  private havePublishedDidCommServicesChanged(didDocument: DidDocument): boolean {
    const fromDoc = (didDocument.service ?? [])
      .filter((s) => MANAGED_DIDCOMM_SERVICE_TYPES.includes(s.type))
      .map((s) => JsonTransformer.toJSON(s))
    const expected = this.getDidCommServices(didDocument.id).map((s) => JsonTransformer.toJSON(s))
    return JSON.stringify(fromDoc) !== JSON.stringify(expected)
  }

  private getDidCommServices(publicDid: string) {
    const keyAgreementId = `${publicDid}#key-agreement-1`
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
            recipientKeys: [keyAgreementId],
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

  private async createAndAddDidCommKeysAndServices(didDocument: DidDocument) {
    const publicDid = didDocument.id

    const context = [
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/x25519-2019/v1',
    ]
    const keyAgreementId = `${publicDid}#key-agreement-1`
    const kms = this.agentContext.resolve(Kms.KeyManagementApi)
    const didRepository = this.agentContext.resolve(DidRepository)

    // Create didcomm keys
    const key = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const publicKeyBytes = Kms.PublicJwk.fromPublicJwk(key.publicJwk).publicKey.publicKey
    const publicKeyMultibase = multibaseEncode(
      new Uint8Array([0xed, 0x01, ...publicKeyBytes]),
      MultibaseEncoding.BASE58_BTC
    )
    const [record] = await didRepository.findByQuery(this.agentContext, { did: publicDid })
    record.keys?.push({
      kmsKeyId: key.keyId,
      didDocumentRelativeKeyId: `#${publicKeyMultibase}`,
    })
    await didRepository.update(this.agentContext, record)
    const verificationMethodId = `${publicDid}#${publicKeyMultibase}`
    const publicKeyX25519 = convertPublicKeyToX25519(publicKeyBytes)
    const x25519Key = Kms.PublicJwk.fromPublicKey({ kty: 'OKP', crv: 'X25519', publicKey: publicKeyX25519 })

    // Remove legacy if exist
    const legacyContexts = ['https://w3id.org/security/suites/ed25519-2018/v1']
    const legacyAuthId = (didDocument.verificationMethod ?? []).find((vm) =>
      ['Ed25519VerificationKey2018'].includes(vm.type)
    )?.id
    if (legacyAuthId) {
      didDocument.authentication = (didDocument.authentication ?? []).filter((id) => id !== legacyAuthId)
      didDocument.assertionMethod = (didDocument.assertionMethod ?? []).filter((id) => id !== legacyAuthId)
    }
    const filteredMethods = (didDocument.verificationMethod ?? []).filter(
      (vm) => !['Ed25519VerificationKey2018', 'X25519KeyAgreementKey2019'].includes(vm.type)
    )

    const verificationMethods = [
      {
        controller: publicDid,
        id: verificationMethodId,
        publicKeyMultibase,
        type: 'Ed25519VerificationKey2020',
      },
      {
        controller: publicDid,
        id: keyAgreementId,
        publicKeyMultibase: x25519Key.fingerprint,
        type: 'Multikey',
      },
    ]

    const authentication = verificationMethodId
    const assertionMethod = verificationMethodId
    const keyAgreement = keyAgreementId

    const didcommServices = this.getDidCommServices(publicDid)

    const currentContexts = Array.isArray(didDocument.context)
      ? didDocument.context
      : didDocument.context
      ? [didDocument.context]
      : []
    didDocument.context = [...new Set([...currentContexts.filter((ctx) => !legacyContexts.includes(ctx)), ...context])]
    didDocument.verificationMethod = [...filteredMethods, ...verificationMethods]
    didDocument.authentication = [...new Set([...(didDocument.authentication ?? []), authentication])]
    didDocument.assertionMethod = [...new Set([...(didDocument.assertionMethod ?? []), assertionMethod])]
    didDocument.keyAgreement = [...new Set([...(didDocument.keyAgreement ?? []), keyAgreement])]
    didDocument.service = [
      ...(didDocument.service
        ? didDocument.service.filter((service) => !MANAGED_DIDCOMM_SERVICE_TYPES.includes(service.type))
        : []),
      ...didcommServices,
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
