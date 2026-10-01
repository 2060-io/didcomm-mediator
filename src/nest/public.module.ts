import { DynamicModule, Module } from '@nestjs/common'
import type { DidCommShortenUrlRepository } from '@2060.io/credo-ts-didcomm-shorten-url'
import type { DidCommApi } from '@credo-ts/didcomm'

import { AGENT_TOKEN, DIDCOMM_API_TOKEN, SHORTEN_URL_REPO_TOKEN } from './tokens.js'
import type { DidCommMediatorAgent } from '../agent/DidCommMediatorAgent.js'
import { WebvhController } from './public/webvh.controller.js'
import { ShortenUrlController } from './public/shorten-url.controller.js'

export interface PublicModuleDeps {
  agent: DidCommMediatorAgent
  shortenUrlRepository: DidCommShortenUrlRepository
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  didcommApi: DidCommApi<any>
}

/**
 * Nest module mounted on the Express instance owned by `HttpInboundTransport`.
 * Provides the mediator's *public* HTTP surface — anything that needs to be
 * reachable by DIDComm clients / wallets without authentication. The DIDComm
 * POST handler, WS upgrade, and Askar-related middleware are all still owned
 * by Credo transports and are NOT represented here.
 */
@Module({})
export class PublicModule {
  public static register(deps: PublicModuleDeps): DynamicModule {
    return {
      module: PublicModule,
      controllers: [WebvhController, ShortenUrlController],
      providers: [
        { provide: AGENT_TOKEN, useValue: deps.agent },
        { provide: SHORTEN_URL_REPO_TOKEN, useValue: deps.shortenUrlRepository },
        { provide: DIDCOMM_API_TOKEN, useValue: deps.didcommApi },
      ],
    }
  }
}
