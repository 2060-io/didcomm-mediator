import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AdminConnectionsService, type ConnectionsListFilter } from './connections.service.js'

function parseBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (v === 'true' || v === true) return true
  if (v === 'false' || v === false) return false
  return undefined
}

function parseIntOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

interface CleanupInactiveBody {
  inactiveForDays?: number
  dryRun?: boolean
}

@ApiTags('admin')
@Controller('admin/connections')
export class AdminConnectionsController {
  public constructor(private readonly service: AdminConnectionsService) {}

  @Get()
  public async list(
    @Query('state') state?: string,
    @Query('hasDeviceToken') hasDeviceToken?: string,
    @Query('updatedBefore') updatedBefore?: string,
    @Query('updatedAfter') updatedAfter?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const filter: ConnectionsListFilter = {
      state,
      hasDeviceToken: parseBool(hasDeviceToken),
      updatedBefore,
      updatedAfter,
      limit: parseIntOrUndefined(limit),
      offset: parseIntOrUndefined(offset),
    }
    return this.service.list(filter)
  }

  @Get(':id')
  public async getOne(@Param('id') id: string) {
    return this.service.getById(id)
  }

  @Delete(':id')
  public async deleteOne(@Param('id') id: string) {
    return this.service.deleteById(id)
  }

  /**
   * Triggers the inactive-connection cleanup synchronously. This is the same
   * operation the scheduler runs; exposed as an endpoint so operators can run
   * it on demand (e.g. after raising / lowering `ADMIN_CLEANUP_INACTIVE_DAYS`
   * without waiting for the next cron tick).
   */
  @Post('cleanup')
  public async cleanup(@Body() body: CleanupInactiveBody) {
    const inactiveForDays = body.inactiveForDays ?? 365
    return this.service.cleanupInactive({ inactiveForDays, dryRun: body.dryRun })
  }
}
