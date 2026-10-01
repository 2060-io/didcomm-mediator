import { DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import type { Pool } from 'pg'
import type { DidCommShortenUrlRepository } from '@2060.io/credo-ts-didcomm-shorten-url'
import type { DidCommApi } from '@credo-ts/didcomm'

import {
  ADMIN_CONFIG_TOKEN,
  ADMIN_PG_POOL_TOKEN,
  AGENT_TOKEN,
  DIDCOMM_API_TOKEN,
  SHORTEN_URL_REPO_TOKEN,
} from './tokens.js'
import type { DidCommMediatorAgent } from '../agent/DidCommMediatorAgent.js'
import type { AdminConfig } from './admin/admin-config.js'
import { AdminApiKeyGuard } from './admin/admin-api-key.guard.js'
import { AdminInfoController } from './admin/admin-info.controller.js'
import { AdminConnectionsController } from './admin/connections.controller.js'
import { AdminConnectionsService } from './admin/connections.service.js'
import { AdminQueuedMessagesController } from './admin/queued-messages.controller.js'
import { AdminQueuedMessagesService } from './admin/queued-messages.service.js'
import { AdminLiveSessionsController } from './admin/live-sessions.controller.js'
import { AdminLiveSessionsService } from './admin/live-sessions.service.js'
import { AdminShortenUrlController } from './admin/shorten-url-admin.controller.js'
import { AdminShortenUrlService } from './admin/shorten-url-admin.service.js'
import { AdminCleanupService } from './admin/cleanup.service.js'

export interface AdminModuleDeps {
  agent: DidCommMediatorAgent
  shortenUrlRepository: DidCommShortenUrlRepository
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  didcommApi: DidCommApi<any>
  adminPgPool: Pool | null
  config: AdminConfig
}

@Module({})
export class AdminModule {
  /**
   * Builds the admin Nest module with all its cross-cutting dependencies wired
   * as value providers. Called by the bootstrap after the Credo agent has been
   * created but BEFORE `agent.initialize()`, so that the admin app can answer
   * `/admin/info` immediately when Nest starts listening.
   */
  public static register(deps: AdminModuleDeps): DynamicModule {
    return {
      module: AdminModule,
      imports: [ScheduleModule.forRoot()],
      controllers: [
        AdminInfoController,
        AdminConnectionsController,
        AdminQueuedMessagesController,
        AdminLiveSessionsController,
        AdminShortenUrlController,
      ],
      providers: [
        { provide: AGENT_TOKEN, useValue: deps.agent },
        { provide: SHORTEN_URL_REPO_TOKEN, useValue: deps.shortenUrlRepository },
        { provide: DIDCOMM_API_TOKEN, useValue: deps.didcommApi },
        { provide: ADMIN_PG_POOL_TOKEN, useValue: deps.adminPgPool },
        { provide: ADMIN_CONFIG_TOKEN, useValue: deps.config },
        { provide: APP_GUARD, useClass: AdminApiKeyGuard },
        AdminConnectionsService,
        AdminQueuedMessagesService,
        AdminLiveSessionsService,
        AdminShortenUrlService,
        AdminCleanupService,
      ],
    }
  }
}
