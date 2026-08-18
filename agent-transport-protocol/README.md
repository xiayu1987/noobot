# Agent Transport Protocol

`@noobot/agent-transport-protocol` is the strict command contract from the frontend to the Agent transport boundary. The frontend, HTTP service, WebSocket service, and Agent proxy use the same constructors and parser.

## V2 envelope

```js
{
  protocolVersion: 2,
  commandType,
  commandId,
  identity: {
    sessionId,
    parentSessionId?,
    dialogProcessId?,
    parentDialogProcessId?,
    turnScopeId?
  },
  // Command-specific sections follow.
}
```

Supported commands are exported through `AGENT_COMMAND`. Each command has one canonical location for identity, input, preferences, presentation, concurrency, continuation, stop, interaction, query, or options data.

Main-Agent phase summarization and periodic task checking use one per-run policy shape:

```js
preferences: {
  summaryPolicy: {
    phaseSummaryLoopTurns: 20, // positive integer; defaults to 20
    taskCheckLoopTurns: 10 // positive integer; defaults to 10
  }
}
```

The Service maps these values unchanged to `runConfig.summaryPolicy`; the Agent runtime reads only these fields. Harness thresholds remain owned by `pluginModelConfig.harness` and cannot control the Main-Agent policy. The browser Composer does not expose threshold controls.

## Boundary rules

- The service derives `userId` from authenticated HTTP or WebSocket identity. Client commands cannot provide it.
- The service always enables safe confirmation. The client may provide only `preferences.confirmationLevel`.
- Clients cannot provide internal runtime fields such as `thinkingStartedAt`, `runTimeoutMs`, plugin instances, hooks, tool policies, or execution ownership.
- Unknown top-level fields, unknown nested protocol fields, irrelevant command sections, legacy actions, and unsupported protocol versions are rejected.
- `pluginModelConfig`, attachment entries, and interaction response bodies are intentionally opaque payloads owned by their respective plugin, attachment, and interaction contracts.
- Proxy lifecycle controls such as join, reconnect, and lifecycle receipts remain outside this Agent command protocol.
- `turn.stop` requires the current positive authoritative turn revision in `concurrency.expectedTurnRevision`. Revision `0` is reserved for creating a new turn and is invalid for stop commands.

There is no V0 adapter or flat-payload compatibility path. Protocol changes require a new explicit protocol version.

## Transport diagnostics

The frontend, Agent Proxy, and Service emit `runtime-events` debug records with
`debugType: "agent-transport"` at command send, receive, validation, forwarding,
and failure boundaries. Records from each layer can be correlated by
`commandId`, `sessionId`, `turnScopeId`, `commandType`, and `protocolVersion`.

Diagnostics are enabled by default through
`RUNTIME_EVENTS_CONFIG_DEFAULTS.sessionLogControls.debug.agentTransport` in
`shared/runtime-events-config.js`. Set
`NOOBOT_RUNTIME_EVENT_AGENT_TRANSPORT_DEBUG=off` to disable them. They are
stored separately as `debug-agent-transport.jsonl`.

The diagnostic summary contains identifiers, field names, counts, lengths, and
outcomes only. It never contains message text, attachment content, interaction
responses, authenticated user ids, API keys, or tokens.
