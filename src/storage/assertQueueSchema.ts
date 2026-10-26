import { CredoError } from '@credo-ts/core'
import type { PostgresTransportQueuePostgresConfig } from '@credo-ts/didcomm-transport-queue-postgres'
import { Client } from 'pg'

// The queue's migration runner logs and swallows a failed migration, so check the columns it adds
export async function assertQueueSchema(config: PostgresTransportQueuePostgresConfig): Promise<void> {
  const client = new Client({
    user: config.postgresUser,
    password: config.postgresPassword,
    host: config.postgresHost,
    database: config.postgresDatabaseName,
    port: 5432,
  })
  await client.connect()
  try {
    await client.query('SELECT sending_since, attempts FROM queued_message LIMIT 0')
  } catch (error) {
    throw new CredoError(`Postgres queue database is missing the columns from migration 004: ${error}`, {
      cause: error,
    })
  } finally {
    await client.end()
  }
}
