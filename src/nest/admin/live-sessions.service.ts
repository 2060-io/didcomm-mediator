import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { Pool } from 'pg'

import { ADMIN_PG_POOL_TOKEN } from '../tokens.js'

/**
 * Read/evict helpers over the `live_session` and `instance` tables managed by
 * `@credo-ts/didcomm-transport-queue-postgres`.
 *
 * Evicting a live_session row does NOT kill the underlying WebSocket; it just
 * removes the shared-state pointer. The transport's own `LiveSessionRemoved`
 * handler and the reaper tick will converge the cluster within a few seconds.
 * Use this only for recovery scenarios (e.g. a stuck row that outlives its
 * client), not as a regular connection-management tool.
 */
@Injectable()
export class AdminLiveSessionsService {
  public constructor(@Inject(ADMIN_PG_POOL_TOKEN) private readonly pool: Pool | null) {}

  private getPool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Live-session admin endpoints require the Postgres transport queue backend (set POSTGRES_HOST).'
      )
    }
    return this.pool
  }

  public async list() {
    const pool = this.getPool()
    const rows = await pool.query<{
      session_id: string
      connection_id: string | null
      protocol_version: string | null
      instance: string | null
      created_at: Date
      last_seen: Date | null
    }>(
      `SELECT ls.session_id, ls.connection_id, ls.protocol_version, ls.instance, ls.created_at, i.last_seen
         FROM live_session ls
         LEFT JOIN instance i ON i.name = ls.instance
         ORDER BY ls.created_at DESC`
    )
    return rows.rows.map((r) => ({
      sessionId: r.session_id,
      connectionId: r.connection_id,
      protocolVersion: r.protocol_version,
      instance: r.instance,
      createdAt: r.created_at.toISOString(),
      instanceLastSeen: r.last_seen?.toISOString() ?? null,
    }))
  }

  public async listInstances() {
    const pool = this.getPool()
    const rows = await pool.query<{ name: string; last_seen: Date }>(
      `SELECT name, last_seen FROM instance ORDER BY last_seen DESC`
    )
    return rows.rows.map((r) => ({ name: r.name, lastSeen: r.last_seen.toISOString() }))
  }

  public async deleteByConnectionId(connectionId: string) {
    const pool = this.getPool()
    const result = await pool.query(`DELETE FROM live_session WHERE connection_id = $1`, [connectionId])
    return { connectionId, deleted: result.rowCount ?? 0 }
  }
}
