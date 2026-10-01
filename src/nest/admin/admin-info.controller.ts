import { Controller, Get, Inject } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ADMIN_CONFIG_TOKEN, AGENT_TOKEN } from '../tokens.js'
import type { DidCommMediatorAgent } from '../../agent/DidCommMediatorAgent.js'
import type { AdminConfig } from './admin-config.js'

@ApiTags('admin')
@Controller('admin/info')
export class AdminInfoController {
  public constructor(
    @Inject(AGENT_TOKEN) private readonly agent: DidCommMediatorAgent,
    @Inject(ADMIN_CONFIG_TOKEN) private readonly config: AdminConfig
  ) {}

  /** Static snapshot of the mediator's configuration (handy for dashboards / smoke tests). */
  @Get()
  public getInfo() {
    return {
      publicDid: this.agent.did ?? null,
      endpoints: this.config.endpoints,
      queueBackend: this.config.postgresBackend ? 'postgres' : 'in-memory',
      cleanup: this.config.cleanup,
    }
  }
}
