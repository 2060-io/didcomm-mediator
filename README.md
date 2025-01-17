# DIDComm Mediator

## Configuration

### Mediator

At the moment, all configuration is done by environment variables. All of them are optional

| Variable                | Description                                                                                                                                                   | Default value       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| AGENT_NAME              | Label to show to other DIDComm agents                                                                                                                         | Test Cloud Agent    |
| AGENT_ENDPOINTS         | Comma-separated public endpoint list where agent DIDComm endpoints will be accessible (including protocol and port)                                           | ws://localhost:4000 |
| AGENT_PUBLIC_DID        | Agent's public DID (in did:web format)                                                                                                                        | None                |
| AGENT_PORT              | Port where DIDComm agent will be running                                                                                                                      | 4000                |
| AGENT_LOG_LEVEL         | Agent log level                                                                                                                                               | 2 (debug)           |
| HTTP_SUPPORT            | Enable support of incoming DIDComm messages through HTTP transport                                                                                            | true                |
| WS_SUPPORT              | Enable support of incoming DIDComm messages through WebSocket transport                                                                                       | true                |
| WALLET_NAME             | Wallet (database) name                                                                                                                                        | test-cloud-agent    |
| WALLET_KEY              | Wallet base encryption key                                                                                                                                    | 'Test Cloud Agent'  |
| KEY_DERIVATION_METHOD   | Wallet key derivation method                                                                                                                                  | ARGON2I_MOD         |
| POSTGRES_HOST           | PosgreSQL database host                                                                                                                                       | None (use SQLite)   |
| POSTGRES_USER           | PosgreSQL database username                                                                                                                                   | None                |
| POSTGRES_PASSWORD       | PosgreSQL database password                                                                                                                                   | None                |
| POSTGRES_ADMIN_USER     | PosgreSQL database admin user                                                                                                                                 | None                |
| POSTGRES_ADMIN_PASSWORD | PosgreSQL database admin password                                                                                                                             | None                |
| MPR_WS_URL              | Message Pickup Repository server WebSocket URL. If not defined, it will use internal Message Pickup management (for single-instance, local development only). | none                |
| MPR_MAX_RECEIVE_BYTES   | Message Pickup Repository Optional byte size limit for retrieving messages                                                                                    | none                |
| FCM_SERVICE_BASE_URL    | URL base for sending FCM notifications. This variable is only used when the PostgresMessagePickupRepository is configured.                                    | none                |

These variables might be set also in `.env` file in the form of KEY=VALUE (one per line).

## Deploy and run

2060-cloud-agent can be run both locally or containerized.

### Locally

2060-cloud-agent mediator can be built and run on localhost by just setting the corresponding variables and executing:

```
yarn build
yarn start
```

Upon a successful start, the following lines should be read in log:

```
INFO: Cloud Agent initialized OK
```

### Using docker

First of all, a docker image must be created by doing:

```
docker build -t 2060-cloud-agent:[tag] .
```

Then, a container can be created and deployed:

```
docker run -e AGENT_NAME=... -e AGENT_ENDPOINT=... -e AGENT_PUBLIC_DID=yyy -e AGENT_PORT=xxx -p yyy:xxx 2060-cloud-agent:[tag]
```

where yyy is an publicly accesible port from the host machine.

This one will run default command, which launches the mediator. If you want to run a VDR Proxy, you can override this command and use `yarn vdrproxy`.

# How to testing

## Testing with Agent Clients

For more details, see the [Client-Agent test](/src/test/Client-Agent/README.md).

## Testing massive message between Agents Clients

For more details, see the [Massive Message Sender test](/src/test/Send-Messages/README.md).

## Test Load balancer with Cloud agent live mode with message repository DB pub/sub and postgres wallets

- The porpuse is to be able to test the cloud agent live mode implemented with postgres for storage messagePickup, pub/sub for comunication instances and postgres for storage wallets, to do this you must do running docker compose locate on root of project file called [docker-comopose-lb.yml]

### Setup

1. You should be set IP local in the file nginx.conf locate on ngnix folder a section upstream

```
upstream loadbalancer {
server IP-HOST:4001;
server IP-HOST:4002;
}
```

2. Execute docker compose with load balancer:

```bash
docker compose -f docker-compose-lb.yml up --build
```

## Didcomm Mediator: Configurable Message Pickup Repository

The Didcomm Mediator now supports flexible configuration for message pickup repositories, allowing users to choose between different persistence methods depending on their needs. This enhancement provides seamless integration with the following repository options:

- MessagePickupRepositoryClient: A WebSocket-based repository for distributed environments.
- PostgresMessagePickupRepository: A PostgreSQL-based repository for persistent storage.
- InMemoryMessagePickupRepository: An in-memory repository for lightweight setups or testing purposes.

### How to configure

The repository configuration is controlled by these environment variables. The mediator will automatically detect the active variable and initialize the appropriate repository.

1. WebSocket-Based Repository (MessagePickupRepositoryClient): Set the `MPR_WS_URL` environment variable to the WebSocket server URL.
2. PostgreSQL-Based Repository (PostgresMessagePickupRepository): Set the `POSTGRES_HOST` environment variable to the PostgreSQL connection string and `MPR_WS_URL` is null
3. In-Memory Repository (InMemoryMessagePickupRepository): If neither `MPR_WS_URL` and `POSTGRES_HOST` is set, the mediator will default to InMemoryMessagePickupRepository.
