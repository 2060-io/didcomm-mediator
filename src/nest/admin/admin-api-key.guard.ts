import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'

import { ADMIN_CONFIG_TOKEN } from '../tokens.js'
import type { AdminConfig } from './admin-config.js'

/**
 * Bound globally on the Admin Nest app. Rejects any request whose
 * `X-Admin-Api-Key` header does not match `ADMIN_API_KEY`.
 *
 * The bootstrap refuses to start the admin app when `ADMIN_API_KEY` is unset
 * (fail-closed), so this guard can safely assume the configured key is a
 * non-empty string.
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  public constructor(@Inject(ADMIN_CONFIG_TOKEN) private readonly config: AdminConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const header = req.header('x-admin-api-key')

    if (!header || header !== this.config.apiKey) {
      throw new UnauthorizedException('Invalid or missing X-Admin-Api-Key header')
    }

    return true
  }
}
