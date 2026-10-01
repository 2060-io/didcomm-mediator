import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Pool } from 'pg'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { ADMIN_PG_POOL_TOKEN, AGENT_TOKEN } from '../tokens.js'
import type { DidCommMediatorAgent } from '../../agent/DidCommMediatorAgent.js'

export interface ConnectionListItem {
  id: string
  state?: string
  role?: string
  theirLabel?: string
  theirDid?: string
  createdAt: string
  updatedAt: string
  hasDeviceToken: boolean
}

export interface ConnectionsListFilter {
  state?: string
  hasDeviceToken?: boolean
  /** ISO date; filter to connections whose `updatedAt` is <= this value. */
  updatedBefore?: string
  /** ISO date; filter to connections whose `updatedAt` is >= this value. */
  updatedAfter?: string
  limit?: number
  offset?: number
}

function toListItem(record: DidCommConnectionRecord): ConnectionListItem {
  return {
    id: record.id,
    state: record.state,
    role: record.role,
    theirLabel: record.theirLabel,
    theirDid: record.theirDid,
    createdAt: record.createdAt.toISOString(),
    updatedAt: (record.updatedAt ?? record.createdAt).toISOString(),
    hasDeviceToken: Boolean(record.getTag('device_token')),
  }
}

@Injectable()
export class AdminConnectionsService {
  private readonly logger = new Logger(AdminConnectionsService.name)

  public constructor(
    @Inject(AGENT_TOKEN) private readonly agent: DidCommMediatorAgent,
    /** Optional: null when the in-memory queue backend is used. */
    @Inject(ADMIN_PG_POOL_TOKEN) private readonly pool: Pool | null
  ) {}

  public async list(filter: ConnectionsListFilter) {
    // Credo's DidCommConnectionsApi does not expose a native SQL-backed filter;
    // we load all records and filter in memory. This is acceptable for the
    // current deployment scale (thousands of connections). If this becomes a
    // bottleneck, we should add a native query via DidCommConnectionRepository.
    const all = (await this.agent.didcomm.connections.getAll()) as DidCommConnectionRecord[]

    const updatedBefore = filter.updatedBefore ? new Date(filter.updatedBefore).getTime() : undefined
    const updatedAfter = filter.updatedAfter ? new Date(filter.updatedAfter).getTime() : undefined

    const filtered = all.filter((record: DidCommConnectionRecord) => {
      if (filter.state && record.state !== filter.state) return false
      if (filter.hasDeviceToken !== undefined) {
        const hasToken = Boolean(record.getTag('device_token'))
        if (hasToken !== filter.hasDeviceToken) return false
      }
      const updatedAtMs = (record.updatedAt ?? record.createdAt).getTime()
      if (updatedBefore !== undefined && updatedAtMs > updatedBefore) return false
      if (updatedAfter !== undefined && updatedAtMs < updatedAfter) return false
      return true
    })

    // Stable, newest-first ordering.
    filtered.sort((a: DidCommConnectionRecord, b: DidCommConnectionRecord) => {
      return (b.updatedAt ?? b.createdAt).getTime() - (a.updatedAt ?? a.createdAt).getTime()
    })

    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 100
    const page = filtered.slice(offset, offset + limit).map(toListItem)

    return {
      total: filtered.length,
      offset,
      limit,
      items: page,
    }
  }

  public async getById(id: string) {
    const record = await this.agent.didcomm.connections.findById(id)
    if (!record) throw new NotFoundException(`Connection ${id} not found`)

    return {
      ...toListItem(record as DidCommConnectionRecord),
      tags: record.getTags(),
      outOfBandId: record.outOfBandId,
      invitationDid: record.invitationDid,
      mediatorId: record.mediatorId,
    }
  }

  public async deleteById(id: string) {
    const record = await this.agent.didcomm.connections.findById(id)
    if (!record) throw new NotFoundException(`Connection ${id} not found`)

    // Delete any queued messages belonging to this connection BEFORE removing the
    // connection record itself. If we did it the other way around and the first
    // delete failed, the second would orphan rows in `queued_message` with no
    // connection record left to reference them.
    const queuedDeleted = await this.deleteQueuedMessagesFor(id)

    await this.agent.didcomm.connections.deleteById(id)
    this.logger.log(`Deleted connection ${id} (queued messages removed: ${queuedDeleted})`)

    return { id, queuedMessagesDeleted: queuedDeleted }
  }

  /**
   * Bulk cleanup: deletes every connection whose `updatedAt` is older than
   * `inactiveForDays` (default 365). Returns aggregate counts.
   *
   * Deletes queued messages per connection, then the connection record itself.
   * Live-session rows are left alone — the queue-postgres reaper will drop any
   * that reference a now-gone connection, and if the client reconnects later
   * the DIDComm layer will re-establish the connection naturally.
   */
  public async cleanupInactive(options: { inactiveForDays: number; dryRun?: boolean }) {
    const thresholdMs = Date.now() - options.inactiveForDays * 24 * 60 * 60 * 1000
    const all = (await this.agent.didcomm.connections.getAll()) as DidCommConnectionRecord[]
    const stale = all.filter((r: DidCommConnectionRecord) => {
      return (r.updatedAt ?? r.createdAt).getTime() < thresholdMs
    })

    if (options.dryRun) {
      return { dryRun: true, candidates: stale.length, deleted: 0, queuedMessagesDeleted: 0 }
    }

    let deleted = 0
    let queuedMessagesDeleted = 0
    for (const record of stale) {
      try {
        queuedMessagesDeleted += await this.deleteQueuedMessagesFor(record.id)
        await this.agent.didcomm.connections.deleteById(record.id)
        deleted++
      } catch (error) {
        this.logger.error(`[cleanupInactive] failed to delete connection ${record.id}: ${error}`)
      }
    }

    this.logger.log(
      `[cleanupInactive] inactiveForDays=${options.inactiveForDays} candidates=${stale.length} deleted=${deleted} queuedMessagesDeleted=${queuedMessagesDeleted}`
    )
    return { dryRun: false, candidates: stale.length, deleted, queuedMessagesDeleted }
  }

  private async deleteQueuedMessagesFor(connectionId: string): Promise<number> {
    if (!this.pool) return 0
    try {
      const result = await this.pool.query(`DELETE FROM queued_message WHERE connection_id = $1`, [connectionId])
      return result.rowCount ?? 0
    } catch (error) {
      this.logger.warn(`[deleteQueuedMessagesFor] ${connectionId}: ${error}`)
      return 0
    }
  }
}
