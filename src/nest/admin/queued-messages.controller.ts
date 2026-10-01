import { Controller, Delete, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AdminQueuedMessagesService } from './queued-messages.service.js'

function parseIntOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

@ApiTags('admin')
@Controller('admin/queued-messages')
export class AdminQueuedMessagesController {
  public constructor(private readonly service: AdminQueuedMessagesService) {}

  @Get('stats')
  public async stats() {
    return this.service.getStats()
  }

  @Get()
  public async list(
    @Query('connectionId') connectionId?: string,
    @Query('state') state?: 'pending' | 'sending',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.service.list({
      connectionId,
      state,
      limit: parseIntOrUndefined(limit),
      offset: parseIntOrUndefined(offset),
    })
  }

  @Delete()
  public async deleteBatch(@Query('connectionId') connectionId?: string, @Query('olderThan') olderThan?: string) {
    return this.service.deleteBatch({ connectionId, olderThan })
  }
}
