import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { DidCommShortenUrlRepository } from '@2060.io/credo-ts-didcomm-shorten-url'

import { AGENT_TOKEN, SHORTEN_URL_REPO_TOKEN } from '../tokens.js'
import type { DidCommMediatorAgent } from '../../agent/DidCommMediatorAgent.js'

@Injectable()
export class AdminShortenUrlService {
  public constructor(
    @Inject(AGENT_TOKEN) private readonly agent: DidCommMediatorAgent,
    @Inject(SHORTEN_URL_REPO_TOKEN) private readonly repository: DidCommShortenUrlRepository
  ) {}

  public async list() {
    const all = await this.repository.getAll(this.agent.context)
    return all.map((r) => ({
      id: r.id,
      connectionId: r.connectionId,
      url: r.url,
      shortenedUrl: r.shortenedUrl,
      state: r.state,
      role: r.role,
      createdAt: r.createdAt.toISOString(),
      expiresTime: r.expiresTime?.toISOString?.() ?? null,
    }))
  }

  public async deleteById(id: string) {
    const record = await this.repository.findById(this.agent.context, id)
    if (!record) throw new NotFoundException(`Shorten URL record ${id} not found`)
    await this.repository.deleteById(this.agent.context, id)
    return { id }
  }
}
