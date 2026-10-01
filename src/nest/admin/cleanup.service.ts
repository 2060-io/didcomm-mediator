import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'

import { ADMIN_CONFIG_TOKEN } from '../tokens.js'
import type { AdminConfig } from './admin-config.js'
import { AdminConnectionsService } from './connections.service.js'

/**
 * Periodically removes connections whose `updatedAt` is older than
 * `ADMIN_CLEANUP_INACTIVE_DAYS`, together with every queued message that
 * belongs to them. Registered only when `ADMIN_CLEANUP_ENABLED` is true.
 *
 * The cron expression is schedulable at runtime (not via decorator) so the
 * cadence can be tuned from env without a code change.
 */
@Injectable()
export class AdminCleanupService implements OnModuleInit {
  private readonly logger = new Logger(AdminCleanupService.name)
  private readonly jobName = 'admin-cleanup-inactive-connections'

  public constructor(
    private readonly registry: SchedulerRegistry,
    private readonly connections: AdminConnectionsService,
    @Inject(ADMIN_CONFIG_TOKEN) private readonly config: AdminConfig
  ) {}

  public onModuleInit() {
    if (!this.config.cleanup.enabled) {
      this.logger.log('Scheduled cleanup disabled (ADMIN_CLEANUP_ENABLED=false).')
      return
    }

    const job = new CronJob(this.config.cleanup.cron, () => {
      this.runOnce().catch((err) => this.logger.error(`[cleanup] unexpected failure: ${err}`))
    })

    this.registry.addCronJob(this.jobName, job)
    job.start()
    this.logger.log(
      `Scheduled cleanup enabled: cron="${this.config.cleanup.cron}" inactiveForDays=${this.config.cleanup.inactiveDays}`
    )
  }

  private async runOnce() {
    this.logger.log(`[cleanup] starting run (inactiveForDays=${this.config.cleanup.inactiveDays})`)
    const result = await this.connections.cleanupInactive({
      inactiveForDays: this.config.cleanup.inactiveDays,
    })
    this.logger.log(
      `[cleanup] finished: candidates=${result.candidates} deleted=${result.deleted} queuedMessagesDeleted=${result.queuedMessagesDeleted}`
    )
  }
}
