/**
 * Snapshot of admin-related env configuration, captured at bootstrap and
 * injected into admin services/guards via `ADMIN_CONFIG_TOKEN`.
 */
export interface AdminConfig {
  port: number
  host: string
  apiKey: string
  corsOrigin?: string
  cleanup: {
    enabled: boolean
    inactiveDays: number
    cron: string
  }
  /** Whether a real Postgres queue backend is in use (admin queue endpoints require it). */
  postgresBackend: boolean
  /** Only needed to report it back from /admin/info. */
  publicDid?: string
  /** Only needed to report it back from /admin/info. */
  endpoints: string[]
}
