# Massive Message Sender

This script has created to sends a specified number of messages to a endpoint agent-client (send-message) and send massive messages using Axios.

## Prerequisites

- Node.js installed on your machine.
- Axios package installed.
- Use script ClientAgent.ts to generate Client Agent
- Create the connection between two client agents and you obtain connectionId among them.

## Usage

Execute the script by providing environment variables for configuration. Below is an example command:

```bash
  EXECUTION_COUNT=5 MESSAGE_COUNT=100 PORT=3011 CONNECTION_ID=a2f83f74-b8cd-4a7a-a036-75abfdecb096 node build/test/Send-Messages/send-massive-message.js

```

## Environment Variables

To run this project, you will need to send the following environment variables to your file

`MESSAGE_COUNT` The number of messages to send.

`PORT` The port of the endpoint

`CONNECTION_ID` The connectionId to extract of request connection client you use for this test

`EXECUTION_COUNT` Number of test executions
