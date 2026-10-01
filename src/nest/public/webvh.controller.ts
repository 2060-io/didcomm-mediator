import { Controller, Get, Header, Inject, NotFoundException, Res } from '@nestjs/common'
import type { Response } from 'express'
import { DIDLog } from 'didwebvh-ts'

import { AGENT_TOKEN } from '../tokens.js'
import type { DidCommMediatorAgent } from '../../agent/DidCommMediatorAgent.js'

async function resolveDidDocumentData(agent: DidCommMediatorAgent) {
  if (!agent.did) return {}

  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  if (!didRecord) return {}

  const didDocument = didRecord.didDocument
  const didLog = didRecord.metadata.get('log') as DIDLog[] | null

  return { didDocument, didLog: didLog?.map((entry) => JSON.stringify(entry)).join('\n') }
}

/**
 * Serves the agent's public DID document and did:webvh log on well-known paths.
 * Mounted on the public Express app (shared with `HttpInboundTransport`) when the
 * agent has a public DID configured. When no public DID is set, the routes still
 * answer with 404 so they are safe to mount unconditionally.
 */
@Controller()
export class WebvhController {
  public constructor(@Inject(AGENT_TOKEN) private readonly agent: DidCommMediatorAgent) {}

  @Get('/.well-known/did.json')
  public async getDidDocument() {
    const { didDocument } = await resolveDidDocumentData(this.agent)
    if (!didDocument) throw new NotFoundException()
    return didDocument
  }

  @Get('/.well-known/did.jsonl')
  @Header('Content-Type', 'text/jsonl; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  public async getDidLog(@Res() res: Response) {
    const { didLog } = await resolveDidDocumentData(this.agent)
    if (!didLog) {
      res.status(404).end()
      return
    }
    res.send(didLog)
  }
}
