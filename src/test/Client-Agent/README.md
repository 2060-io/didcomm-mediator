# Client-Agent test

The agent is capable of handling connections, mediating between parties, and exchanging messages. Below is an overview of the key components and functionalities of the code.

## Prerequisites

Before running the client agent, ensure you have the following prerequisites installed:

- Node.js
- npm (Node Package Manager)
- Cloud-Agent Build (yarn build)
- Cloud-Agent running

## Environment Variables

To run this project, you will need to send the following environment variables to your file

`CLIENT_AGENT_PORT` Port on which the client agent will run (default is 3000).

`CLIENT_WALLET_ID` dentifier for the wallet used by the client agent.

`CLIENT_WALLET_KEY` Key for accessing the client wallet.

`CLIENT_MEDIATOR_DID_URL` Allow change method invitation DID (true) or URL(false) (default false).

`CLIENT_AGENT_BASE_URL` Url to receive invitation of mediator.

'https://ca.dev.2060.io/invitation'

Only use if you run Multiple-Agents

`CLIENT_QTY_OPEN` number of clients that open simultaneously

## Running Tests

To run tests, run the following command

```bash
  CLIENT_MEDIATOR_DID_URL=true CLIENT_AGENT_PORT=3001 CLIENT_WALLET_ID=client-001 node ./build/test/Client-Agent/ClientAgent.js
```

If you need run multiple Client-Agent you may use the Multiple_Agents script, run following command

```bash
  CLIENT_QTY_OPEN= 5 node build/test/Multiple_agents.js
```

## Endpoints

1. Invitation

- Endpoint: /invitation
- Method: GET
- Description: Generates and returns an invitation URL for establishing connections.

2. Connection List

- Endpoint: /connections
- Method: GET
- Description: Retrieves a simplified list of all connections.

3. Receive Invitation

- Endpoint: /receive-invitation
- Method: POST
- Description: Accepts an invitation URL, establishes a connection, and returns connection details.

4. Send Message

- Endpoint: /send-message
- Method: POST
- Description: Sends a message to a specified connection.

## Testing Agent Clients procedure

After run clientAgents you select 2 connections that are connected with diferent instance Cloud-Agent and begin process to match both clients via rest API each client

1. Client-01 = generate-invitation
2. Clentt-02 = receive-invitation
3. Client-01 = request-connections and obtain the connectionId of client 02
4. Client-01 = send-message for client 2

## Notes

- The client agent automatically accepts incoming connections (autoAcceptConnections is set to true).
- Mediation is initiated if no default mediator is found. The mediator's - - invitation URL is fetched from http://localhost:4000/invitation. You can change this url to that of the cloud-agent locate to cloud an connect with Mobile Agent.
- The agent utilizes WebSocket (WsOutboundTransport) for outbound transport.
