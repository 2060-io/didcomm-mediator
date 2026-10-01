import { BadRequestException, Controller, Get, Inject, Logger, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { DidCommShortenUrlRepository } from '@2060.io/credo-ts-didcomm-shorten-url'
import type { DidCommApi } from '@credo-ts/didcomm'

import { AGENT_TOKEN, DIDCOMM_API_TOKEN, SHORTEN_URL_REPO_TOKEN } from '../tokens.js'
import type { DidCommMediatorAgent } from '../../agent/DidCommMediatorAgent.js'
import { isShortenUrlRecordExpired } from '../../util/shortenUrlRecordsCleanup.js'

/**
 * Public resolver for shortened invitation URLs emitted by the shorten-url
 * module. The path (`/s`) is part of the external contract — it appears inside
 * QR codes and invitation links — so do not change it without coordinating
 * with the clients that generate the short URLs.
 */
@Controller('s')
export class ShortenUrlController {
  private readonly logger = new Logger(ShortenUrlController.name)

  public constructor(
    @Inject(AGENT_TOKEN) private readonly agent: DidCommMediatorAgent,
    @Inject(SHORTEN_URL_REPO_TOKEN) private readonly shortenUrlRepository: DidCommShortenUrlRepository,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject(DIDCOMM_API_TOKEN) private readonly didcommApi: DidCommApi<any>
  ) {}

  @Get()
  public async resolve(@Query('id') id: string, @Req() req: Request, @Res() res: Response) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new BadRequestException('Query parameter "id" is required')
    }

    const shortUrlRecord = await this.shortenUrlRepository.findById(this.agent.context, id)
    if (!shortUrlRecord || !shortUrlRecord.url) {
      res.status(404).json({ error: 'Shortened URL not found' })
      return
    }

    if (await isShortenUrlRecordExpired(shortUrlRecord)) {
      // Best-effort async cleanup; any failure is already logged by the repo itself.
      this.shortenUrlRepository.deleteById(this.agent.context, id).catch(() => undefined)
      res.status(410).json({ error: 'Shortened URL has expired' })
      return
    }

    const longUrl = shortUrlRecord.url
    try {
      if (req.accepts('json')) {
        const invitationUrl = await this.didcommApi.oob.parseInvitation(longUrl)
        res.send(invitationUrl.toJSON()).end()
      } else {
        res.status(302).location(longUrl).end()
      }
    } catch (error) {
      this.logger.error(`failed to resolve shortened url for id ${id}: ${error}`)
      res.status(500).send('Internal Server Error')
    }
  }
}
