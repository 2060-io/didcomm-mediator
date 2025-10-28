import { AgentContext, ConsoleLogger, LogLevel } from '@credo-ts/core'
import {
  DidCommShortenUrlRecord,
  DidCommShortenUrlRepository,
  ShortenUrlRole,
  ShortenUrlState,
} from '@2060.io/credo-ts-didcomm-shorten-url'

const defaultLogger = new ConsoleLogger(LogLevel.off)

/**
 * Delete a single shorten-url record when an explicit invalidation is received.
 * It filters by connectionId + shortenedUrl and by UrlShortener role (mediator side).
 *
 * @returns true if a record was found and deleted; false otherwise.
 */
export async function deleteShortUrlRecord(
  agentContext: AgentContext,
  options: { connectionId?: string; shortenedUrl?: string; id?: string }
): Promise<boolean> {
  const logger = agentContext.config.logger ?? defaultLogger
  const repository = agentContext.dependencyManager.resolve(DidCommShortenUrlRepository)
  const { connectionId, shortenedUrl, id } = options
  let record

  try {
    if (id) {
      record = await repository.findById(agentContext, id)
      if (!record) {
        logger.debug(`[ShortenUrlCleanup] No record found for id=${id}`)
        return false
      }

      await repository.deleteById(agentContext, record.id)
      logger.info(`[ShortenUrlCleanup] Deleted record id=${record.id}`)
      return true
    } else {
      if (!connectionId || !shortenedUrl) {
        logger.error(
          `[ShortenUrlCleanup] Missing parameters to delete record by connectionId and shortenedUrl: connectionId=${connectionId} shortenedUrl=${shortenedUrl}`
        )
        return false
      }
      record = await repository.findSingleByQuery(agentContext, {
        connectionId,
        shortenedUrl,
        role: ShortenUrlRole.UrlShortener,
      })

      if (!record) {
        logger.debug(
          `[ShortenUrlCleanup] No record found for shortenedUrl=${shortenedUrl} connectionId=${connectionId}`
        )
        return false
      }

      await repository.deleteById(agentContext, record.id)
      logger.info(`[ShortenUrlCleanup] Deleted record id=${record.id}`)
    }

    return true
  } catch (error) {
    logger.error(`[ShortenUrlCleanup] Failed deleting record: ${error}`)
    return false
  }
}

/**
 * Scan shorten-url records and delete those that are:
 *  - invalidated (InvalidationReceived/Sent), OR
 *  - expired (prefers absolute expiresTime; falls back to requestedValiditySeconds).
 *
 * Only records with role=UrlShortener are considered (mediator responsibility).
 */
export async function cleanupExpiredOrInvalidShortenUrlRecords(
  agentContext: AgentContext
): Promise<{ scanned: number; deleted: number }> {
  const logger = agentContext.config.logger ?? defaultLogger
  const repository = agentContext.dependencyManager.resolve(DidCommShortenUrlRepository)
  let records: DidCommShortenUrlRecord[] = []

  try {
    records = await repository.getAll(agentContext)
  } catch (error) {
    logger.error(`[ShortenUrlCleanup] Failed to list records: ${error}`)
    return { scanned: 0, deleted: 0 }
  }

  let deleted = 0
  for (const rec of records) {
    try {
      const isInvalidated =
        rec.state === ShortenUrlState.InvalidationReceived || rec.state === ShortenUrlState.InvalidationSent

      // Check absolute expiration time
      const isExpired = await isShortenUrRecordExpired(rec)

      logger.debug(`[ShortenUrlCleanup] Record id=${rec.id} invalidated=${isInvalidated} expired=${isExpired}`)

      if (isInvalidated || isExpired) {
        await deleteShortUrlRecord(agentContext, { id: rec.id })
        deleted++
      }
    } catch (e) {
      logger.warn(`[ShortenUrlCleanup] Skipped record id=${rec?.id}: ${e}`)
    }
  }

  if (deleted > 0) {
    logger.info(`[ShortenUrlCleanup] Scanned ${records.length}, deleted ${deleted} record(s)`)
  } else {
    logger.debug(`[ShortenUrlCleanup] Scanned ${records.length}, no records deleted`)
  }

  return { scanned: records.length, deleted }
}

/**
 * Start a periodic cleanup task that removes invalidated or expired records.
 * Returns a stopper function to cancel the interval.
 *
 * Default interval: 5 minutes.
 */
export function startShortenUrlRecordsCleanupMonitor(agentContext: AgentContext, intervalSecond = 300): () => void {
  const logger = agentContext.config.logger
  if (intervalSecond !== undefined && intervalSecond <= 0) {
    return () => {
      logger.debug('[ShortenUrlCleanup] Cleanup monitor already disabled')
    }
  }
  logger.info(`[ShortenUrlCleanup] Starting periodic cleanup every ${intervalSecond} seconds`)

  const timer = setInterval(async () => {
    try {
      const { scanned, deleted } = await cleanupExpiredOrInvalidShortenUrlRecords(agentContext)
      logger.debug(`[ShortenUrlCleanup] Periodic cleanup completed: scanned=${scanned} deleted=${deleted}`)
    } catch (error) {
      logger.error(`[ShortenUrlCleanup] Periodic cleanup errored: ${error}`)
    }
  }, intervalSecond * 1000)

  return () => {
    clearInterval(timer)
    logger.info('[ShortenUrlCleanup] Periodic cleanup stopped')
  }
}

/**
 *  Check if a shorten-url record has expired based on requestedValiditySeconds.
 * @param shortUrlRecord
 * @returns true if expired; false otherwise.
 */
export async function isShortenUrRecordExpired(shortUrlRecord: DidCommShortenUrlRecord): Promise<boolean> {
  const ttlRecord = Number(shortUrlRecord.expiresTime ?? shortUrlRecord.requestedValiditySeconds ?? 0)
  if (ttlRecord > 0) {
    const baseTs = new Date(shortUrlRecord.updatedAt ?? shortUrlRecord.createdAt).getTime()
    const expiresAt = baseTs + ttlRecord
    if (Date.now() >= expiresAt) {
      return true
    }
  }
  return false
}
