import type { Request, Response } from 'express'
import type { Server } from 'http'
import type { AgentContext } from '@credo-ts/core'

import { CredoError, EventEmitter, utils } from '@credo-ts/core'
import {
  DidCommEventTypes,
  DidCommMimeType,
  DidCommModuleConfig,
  DidCommTransportService,
  type DidCommInboundTransport,
  type DidCommTransportSession,
} from '@credo-ts/didcomm'
import express, { text, type Express } from 'express'

const supportedContentTypes: string[] = [DidCommMimeType.V0, DidCommMimeType.V1]

export class HttpInboundTransport implements DidCommInboundTransport {
  public readonly app: Express
  private port: number
  private path: string
  private _server?: Server
  private processedMessageListenerTimeoutMs: number

  public get server() {
    return this._server
  }

  public constructor({
    app,
    path,
    port,
    processedMessageListenerTimeoutMs,
  }: { app?: Express; path?: string; port: number; processedMessageListenerTimeoutMs?: number }) {
    this.port = port
    this.processedMessageListenerTimeoutMs = processedMessageListenerTimeoutMs ?? 10000

    this.app = app ?? express()
    this.path = path ?? '/'

    this.app.use(
      text({
        type: supportedContentTypes,
        limit: '5mb',
      })
    )
  }

  public async start(agentContext: AgentContext) {
    const transportService = agentContext.dependencyManager.resolve(DidCommTransportService)

    agentContext.config.logger.debug(`Starting HTTP inbound transport`, {
      port: this.port,
    })

    this.app.post(this.path, async (req, res) => {
      const contentType = req.headers['content-type']

      if (!contentType || !supportedContentTypes.includes(contentType)) {
        return res
          .status(415)
          .send(`Unsupported content-type. Supported content-types are: ${supportedContentTypes.join(', ')}`)
      }

      const session = new HttpTransportSession(utils.uuid(), req, res)
      req.once('close', () => transportService.removeSession(session))
      try {
        const message = req.body
        const encryptedMessage = JSON.parse(message)

        const eventEmitter = agentContext.dependencyManager.resolve(EventEmitter)
        eventEmitter.emit(agentContext, {
          type: DidCommEventTypes.DidCommMessageReceived,
          payload: {
            message: encryptedMessage,
            session,
          },
        })

        if (!res.headersSent) {
          res.status(200).end()
        }
      } catch (error) {
        agentContext.config.logger.error(`Error processing inbound message: ${error instanceof Error ? error.message : error}`, error)

        if (!res.headersSent) {
          res.status(500).send('Error processing message')
        }
      } finally {
        transportService.removeSession(session)
      }
    })

    this._server = this.app.listen(this.port)
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => this._server?.close((err) => (err ? reject(err) : resolve())))
  }
}

export class HttpTransportSession implements DidCommTransportSession {
  public id: string
  public readonly type = 'http'
  public req: Request
  public res: Response

  public constructor(id: string, req: Request, res: Response) {
    this.id = id
    this.req = req
    this.res = res
  }

  public async close(): Promise<void> {
    if (!this.res.headersSent) {
      this.res.status(200).end()
    }
  }

  public async send(agentContext: AgentContext, encryptedMessage: unknown): Promise<void> {
    if (this.res.headersSent) {
      throw new CredoError(`${this.type} transport session has been closed.`)
    }

    const didCommConfig = agentContext.dependencyManager.resolve(DidCommModuleConfig)
    let responseMimeType = didCommConfig.didCommMimeType as string

    const requestMimeType = this.req.headers['content-type']
    if (requestMimeType && supportedContentTypes.includes(requestMimeType)) {
      responseMimeType = requestMimeType
    }

    this.res.status(200).contentType(responseMimeType).json(encryptedMessage).end()
  }
}
