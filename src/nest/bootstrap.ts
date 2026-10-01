import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { INestApplication, Logger as NestLogger } from '@nestjs/common'
import pg from 'pg'
// `pg` is CommonJS; named imports fail under ESM. We pull `Pool` off the
// default export at runtime and re-type it for the type-only uses below.
const { Pool } = pg
type Pool = pg.Pool

import type { InitMediatorResult } from '../agent/initDidCommMediatorAgent.js'
import type { AdminConfig } from './admin/admin-config.js'
import { AdminModule } from './admin.module.js'
import { PublicModule } from './public.module.js'

export interface NestBootstrapOptions {
  /** Result of `initMediator({ autoInitialize: false, registerPublicHttpRoutes: false })`. */
  mediator: InitMediatorResult
  adminConfig: AdminConfig
  /**
   * Connection parameters for the transport-queue-postgres database. When
   * omitted (in-memory queue backend), admin endpoints that require Postgres
   * will respond with 503.
   */
  postgres?: {
    user: string
    password: string
    host: string
    database: string
    port?: number
  }
  /** Shared logger used only for bootstrap-level messages. */
  logger?: Pick<NestLogger, 'log' | 'warn' | 'error'> | Console
}

export interface NestBootstrapResult {
  publicApp: INestApplication
  adminApp: INestApplication
  adminPgPool: Pool | null
  shutdown: () => Promise<void>
}

/**
 * Brings up the Nest surface around the already-created Credo agent:
 *
 *  1. Mounts the `PublicModule` controllers on the shared Express instance
 *     owned by `HttpInboundTransport` via `ExpressAdapter`. We never call
 *     `.listen()` on this Nest app — the HTTP server is started later by the
 *     Credo inbound transport during `agent.initialize()`.
 *
 *  2. Boots a standalone `AdminModule` on `adminConfig.host:adminConfig.port`,
 *     behind `AdminApiKeyGuard`. Swagger is mounted at `/admin/docs`.
 *
 * Call `mediator.finalize()` AFTER this function returns to actually start the
 * public HTTP listener and wire the WebSocket upgrade.
 */
export async function bootstrapNest(options: NestBootstrapOptions): Promise<NestBootstrapResult> {
  const logger = options.logger ?? console

  // --- Public Nest app: mounts on the Express instance owned by HttpInboundTransport ---
  const publicModule = PublicModule.register({
    agent: options.mediator.agent,
    shortenUrlRepository: options.mediator.shortenUrlRepository,
    didcommApi: options.mediator.didcommApi,
  })
  const publicApp = await NestFactory.create(publicModule, new ExpressAdapter(options.mediator.app), {
    // We don't want Nest to re-wire logging over our Credo logger. Keep it quiet.
    logger: ['error', 'warn'],
  })
  // `init()` (not `listen()`) registers the controllers on the underlying Express
  // without starting its own HTTP server. The Credo HttpInboundTransport will
  // call `app.listen()` during agent.initialize().
  await publicApp.init()

  // --- Admin Postgres pool (separate from the queue-postgres internal pool) ---
  const adminPgPool = options.postgres
    ? new Pool({
        user: options.postgres.user,
        password: options.postgres.password,
        host: options.postgres.host,
        database: options.postgres.database,
        port: options.postgres.port ?? 5432,
        // Admin traffic is low; keep the footprint minimal.
        max: 4,
      })
    : null

  // --- Admin Nest app: standalone, separate port, api-key guard ---
  const adminApp = await NestFactory.create(
    AdminModule.register({
      agent: options.mediator.agent,
      shortenUrlRepository: options.mediator.shortenUrlRepository,
      didcommApi: options.mediator.didcommApi,
      adminPgPool,
      config: options.adminConfig,
    }),
    { logger: ['error', 'warn'] }
  )

  if (options.adminConfig.corsOrigin) {
    adminApp.enableCors({ origin: options.adminConfig.corsOrigin })
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('DIDComm Mediator Admin API')
    .setDescription('Operational / diagnostic endpoints for the DIDComm mediator.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Admin-Api-Key', in: 'header' }, 'admin-api-key')
    .build()
  const document = SwaggerModule.createDocument(adminApp, swaggerConfig)
  SwaggerModule.setup('admin/docs', adminApp, document)

  await adminApp.listen(options.adminConfig.port, options.adminConfig.host)
  logger.log?.(
    `Admin API listening on http://${options.adminConfig.host}:${options.adminConfig.port} (docs at /admin/docs)`
  )

  const shutdown = async () => {
    const errors: unknown[] = []
    try {
      await adminApp.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await publicApp.close()
    } catch (error) {
      errors.push(error)
    }
    if (adminPgPool) {
      try {
        await adminPgPool.end()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new Error(`Nest shutdown failed: ${errors.map((e) => String(e)).join('; ')}`)
  }

  return { publicApp, adminApp, adminPgPool, shutdown }
}
