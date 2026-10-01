import { Controller, Delete, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AdminLiveSessionsService } from './live-sessions.service.js'

@ApiTags('admin')
@Controller('admin/live-sessions')
export class AdminLiveSessionsController {
  public constructor(private readonly service: AdminLiveSessionsService) {}

  @Get()
  public async list() {
    return this.service.list()
  }

  @Get('instances')
  public async listInstances() {
    return this.service.listInstances()
  }

  @Delete(':connectionId')
  public async deleteByConnectionId(@Param('connectionId') connectionId: string) {
    return this.service.deleteByConnectionId(connectionId)
  }
}
