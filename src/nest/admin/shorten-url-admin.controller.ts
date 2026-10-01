import { Controller, Delete, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AdminShortenUrlService } from './shorten-url-admin.service.js'

@ApiTags('admin')
@Controller('admin/shorten-urls')
export class AdminShortenUrlController {
  public constructor(private readonly service: AdminShortenUrlService) {}

  @Get()
  public async list() {
    return this.service.list()
  }

  @Delete(':id')
  public async deleteById(@Param('id') id: string) {
    return this.service.deleteById(id)
  }
}
