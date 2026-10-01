import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { Pool } from 'pg'

import { ADMIN_PG_POOL_TOKEN } from '../tokens.js'

export interface QueuedMessageListFilter {
  connectionId?: string
  state?: 'pending' | 'sending'
  limit?: number
  offset?: number
}

export interface QueuedMessageDeleteFilter {
  connectionId?: string
  /** ISO date; delete every message whose `created_at` is strictly older than this. */
  olderThan?: string
}

/**
 * Read/delete helpers over the `queued_message` table managed by
 * `@credo-ts/didcomm-transport-queue-postgres`. We intentionally do NOT go
 * through the `DidCommTransportQueuePostgres` instance — its public API is
 * scoped to per-connection pickup and doesn't expose any of the admin-style
 * queries (stats, batch delete). Instead we open a separate short-lived
 * connection pool against the same database; this keeps the admin code
 * self-contained and does not interfere with the transport's own pool.
 */
@Injectable()
export class AdminQueuedMessagesService {
  public constructor(@Inject(ADMIN_PG_POOL_TOKEN) private readonly pool: Pool | null) {}

  private getPool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Queued-message admin endpoints require the Postgres transport queue backend (set POSTGRES_HOST).'
      )
    }
    return this.pool
  }

  public async list(filter: QueuedMessageListFilter) {
    const pool = this.getPool()
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.connectionId) {
      params.push(filter.connectionId)
      conditions.push(`connection_id = $${params.length}`)
    }
    if (filter.state) {
      params.push(filter.state)
      conditions.push(`state = $${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM queued_message ${where}`,
      params
    )
    const total = Number.parseInt(countResult.rows[0]?.count ?? '0', 10)

    params.push(limit)
    params.push(offset)
    const rows = await pool.query<{
      id: string
      connection_id: string | null
      recipient_dids: string[] | null
      state: string
      created_at: Date
    }>(
      `SELECT id, connection_id, recipient_dids, state, created_at
         FROM queued_message
         ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    return {
      total,
      offset,
      limit,
      items: rows.rows.map((r) => ({
        id: r.id,
        connectionId: r.connection_id,
        recipientDids: r.recipient_dids ?? [],
        state: r.state,
        createdAt: r.created_at.toISOString(),
      })),
    }
  }

  public async getStats() {
    const pool = this.getPool()
    const byState = await pool.query<{ state: string; count: string }>(
      `SELECT state, COUNT(*)::text AS count FROM queued_message GROUP BY state`
    )
    const oldest = await pool.query<{ oldest: Date | null }>(`SELECT MIN(created_at) AS oldest FROM queued_message`)
    const top = await pool.query<{ connection_id: string | null; count: string }>(
      `SELECT connection_id, COUNT(*)::text AS count
         FROM queued_message
         GROUP BY connection_id
         ORDER BY COUNT(*) DESC
         LIMIT 10`
    )

    const stateCounts: Record<string, number> = {}
    for (const row of byState.rows) stateCounts[row.state] = Number.parseInt(row.count, 10)

    return {
      totalByState: stateCounts,
      oldestQueuedAt: oldest.rows[0]?.oldest?.toISOString() ?? null,
      topConnections: top.rows.map((r) => ({
        connectionId: r.connection_id,
        count: Number.parseInt(r.count, 10),
      })),
    }
  }

  public async deleteBatch(filter: QueuedMessageDeleteFilter) {
    const pool = this.getPool()
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.connectionId) {
      params.push(filter.connectionId)
      conditions.push(`connection_id = $${params.length}`)
    }
    if (filter.olderThan) {
      params.push(new Date(filter.olderThan))
      conditions.push(`created_at < $${params.length}`)
    }

    // Require at least one filter to avoid accidental full-table wipes.
    if (conditions.length === 0) {
      return { deleted: 0, reason: 'At least one of connectionId or olderThan is required' }
    }

    const result = await pool.query(`DELETE FROM queued_message WHERE ${conditions.join(' AND ')}`, params)
    return { deleted: result.rowCount ?? 0 }
  }
}
