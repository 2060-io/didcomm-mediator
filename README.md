# DIDComm Mediator

## Configuration

### Environment variables

At the moment, all configuration is done by environment variables. All of them are optional

| Variable                    | Description                                                                                                                                                                                                                                                                                                                                                                              | Default value           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| AGENT_NAME                  | Label to show to other DIDComm agents                                                                                                                                                                                                                                                                                                                                                    | Test DIDComm Mediator   |
| AGENT_ENDPOINTS             | Comma-separated public endpoint list where agent DIDComm endpoints will be accessible (including protocol and port)                                                                                                                                                                                                                                                                      | ws://localhost:4000     |
| AGENT_PUBLIC_DID            | Agent's public DID (in did:web format)                                                                                                                                                                                                                                                                                                                                                   | None                    |
| AGENT_PORT                  | Port where DIDComm agent will be running                                                                                                                                                                                                                                                                                                                                                 | 4000                    |
| AGENT_LOG_LEVEL             | Agent log level                                                                                                                                                                                                                                                                                                                                                                          | 2 (debug)               |
| HTTP_SUPPORT                | Enable support of incoming DIDComm messages through HTTP transport                                                                                                                                                                                                                                                                                                                       | true                    |
| WS_SUPPORT                  | Enable support of incoming DIDComm messages through WebSocket transport                                                                                                                                                                                                                                                                                                                  | true                    |
| WALLET_NAME                 | Wallet (database) name                                                                                                                                                                                                                                                                                                                                                                   | test-didcomm-mediator   |
| WALLET_KEY                  | Wallet base encryption key                                                                                                                                                                                                                                                                                                                                                               | 'Test DIDComm Mediator' |
| KEY_DERIVATION_METHOD       | Wallet key derivation method                                                                                                                                                                                                                                                                                                                                                             | ARGON2I_MOD             |
| POSTGRES_HOST               | PosgreSQL database host                                                                                                                                                                                                                                                                                                                                                                  | None (use SQLite)       |
| POSTGRES_USER               | PosgreSQL database username                                                                                                                                                                                                                                                                                                                                                              | None                    |
| POSTGRES_PASSWORD           | PosgreSQL database password                                                                                                                                                                                                                                                                                                                                                              | None                    |
| POSTGRES_ADMIN_USER         | PosgreSQL database admin user                                                                                                                                                                                                                                                                                                                                                            | None                    |
| POSTGRES_ADMIN_PASSWORD     | PosgreSQL database admin password                                                                                                                                                                                                                                                                                                                                                        | None                    |
| MPR_WS_URL                  | Message Pickup Repository server WebSocket URL. If not defined, it will use internal Message Pickup management (for single-instance, local development only).                                                                                                                                                                                                                            | none                    |
| MPR_MAX_RECEIVE_BYTES       | Message Pickup Repository Optional byte size limit for retrieving messages                                                                                                                                                                                                                                                                                                               | none                    |
| FIREBASE_CFG_FILE           | Defines the path to the Firebase project configuration file used to initialize the Firebase Admin SDK. This file must be a JSON file containing the service account credentials for the Firebase project. If the variable is not set, Firebase-based notifications will be disabled. This applies to both the PostgresMessagePickupRepository and InMemoryMessagePickupRepository modes. | `./firebase.cfg.json`   |
| SHORTEN_INVITATION_BASE_URL | Base URL used when generating the public shorten-url link returned to clients. endpoint.                                                                                                                                                                                                                                                                                                 | <https://hologram.zone> |

These variables might be set also in `.env` file in the form of KEY=VALUE (one per line).

### Shorten URL support

The mediator can act as a DIDComm [shorten-url protocol](https://didcomm.org/shorten-url/1.0/) provider through the library ([@2060.io/credo-ts-didcomm-shorten-url](https://github.com/2060-io/credo-ts-didcomm-ext/tree/main/packages/shorten-url)).

- Set `SHORTEN_INVITATION_BASE_URL` to the publicly reachable origin that will host the `/s` endpoint (for example, the domain behind a reverse proxy). The mediator appends `/s?id=<recordId>` to this base when returning shortened links to clients.
- The `/s` endpoint resolves the stored long URL and issues an HTTP 302 redirect by default. When the request includes `Accept: application/json`, the mediator attempts to parse DIDComm invitation URLs and returns the invitation payload as JSON; non-invitation URLs are returned as `{ "url": "<longUrl>" }`.
- Shorten-url requests received from connected agents are stored once and then published through the DIDComm event system so that the shortened link can be delivered back to the requesting agent.

### Message Pickup modes

This apps supports a flexible configuration for Message Pickup repositories, allowing users to choose between different persistence methods depending on their needs. This enhancement provides seamless integration with the following repository options:

- **MessagePickupRepositoryClient**: A WebSocket-based repository for distributed environments. It requires a specific server
- **PostgresMessagePickupRepository**: A PostgreSQL-based repository for persistent storage. It is meant for simplicity, so it uses the same Postgres host than mediator's wallet.
- **InMemoryMessagePickupRepository**: An in-memory repository for lightweight setups or testing purposes. It only works when SQLite is used for mediator wallet.

### How to configure

The repository configuration is controlled by these environment variables. The mediator will automatically detect the active variable and initialize the appropriate repository.

1. WebSocket-Based Repository (MessagePickupRepositoryClient): Set the `MPR_WS_URL` environment variable to the WebSocket server URL.
2. PostgreSQL-Based Repository (PostgresMessagePickupRepository): Set the `POSTGRES_HOST` environment variable to the PostgreSQL connection string and `MPR_WS_URL` is null
3. In-Memory Repository (InMemoryMessagePickupRepository): If neither `MPR_WS_URL` and `POSTGRES_HOST` is set, the mediator will default to InMemoryMessagePickupRepository.

## Deploy and run

The DIDComm mediator can be run both locally or containerized.

### Locally

DIDComm mediator can be built and run on localhost by just setting the corresponding variables and executing:

```bash
pnpm prepare
pnpm build
pnpm start
```

Upon a successful start, the following lines should be read in log:

```text
INFO: DIDComm Mediator Agent initialized OK
```

### Using docker

First of all, a docker image must be created by doing:

```bash
docker build -t didcomm-mediator:[tag] .
```

Then, a container can be created and deployed:

```bash
docker run -e AGENT_NAME=... -e AGENT_ENDPOINT=... -e AGENT_PUBLIC_DID=yyy -e AGENT_PORT=xxx -p yyy:xxx didcomm-mediator:[tag]
```

where yyy is an publicly accesible port from the host machine.

## How to test

### Testing with Agent Clients

For more details, see the [Client-Agent test](/src/test/Client-Agent/README.md).

### Testing massive message between Agents Clients

For more details, see the [Massive Message Sender test](/src/test/Send-Messages/README.md).

### Test a load balancer with multiple agent instances supporting Message Pickup in Live mode

The purpose is to be able to test DIDComm mediator in a multi-instance environment, using Postgres as a backend for both Agent wallet and Message Pickup queue.

#### Setup

1. You should be set IP local in the file nginx.conf locate on ngnix folder a section upstream

```json
upstream loadbalancer {
server IP-HOST:4001;
server IP-HOST:4002;
}
```

1. Execute docker compose with load balancer:

```bash
docker compose -f docker-compose-lb.yml up --build
```
