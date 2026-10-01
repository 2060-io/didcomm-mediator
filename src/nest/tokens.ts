/**
 * Dependency-injection tokens shared between the Nest PublicModule and AdminModule.
 *
 * The Credo agent (and its related APIs/repositories) live in the tsyringe container
 * managed by Credo; Nest never "owns" them. We simply register them as value
 * providers so Nest controllers/services can consume them via `@Inject(TOKEN)`.
 */

export const AGENT_TOKEN = Symbol('AGENT_TOKEN')
export const QUEUE_REPO_TOKEN = Symbol('QUEUE_REPO_TOKEN')
export const SHORTEN_URL_REPO_TOKEN = Symbol('SHORTEN_URL_REPO_TOKEN')
export const DIDCOMM_API_TOKEN = Symbol('DIDCOMM_API_TOKEN')
/** Separate pg.Pool opened against the transport-queue-postgres database. */
export const ADMIN_PG_POOL_TOKEN = Symbol('ADMIN_PG_POOL_TOKEN')
export const ADMIN_CONFIG_TOKEN = Symbol('ADMIN_CONFIG_TOKEN')
export const AGENT_LOGGER_TOKEN = Symbol('AGENT_LOGGER_TOKEN')
