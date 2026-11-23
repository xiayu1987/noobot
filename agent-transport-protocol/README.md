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
    phaseSummaryLoopTurns: 30, // optional positive integer override
    taskCheckLoopTurns: 10 // positive integer; defaults to 10
  }
}
```

The Service maps these values unchanged to `runConfig.summaryPolicy`; the Agent runtime reads only these fields. Harness thresholds remain owned by `pluginModelConfig.harness` and cannot control the Main-Agent policy. The browser Composer does not expose threshold controls.

## Boundary rules

- The service derives `userId` from authenticated HTTP or WebSocket identity. Client commands cannot provide it.
- Safe confirmation is a user preference: `preferences.safeConfirm` toggles it and `preferences.safeConfirmLevel` (`low|medium|high|critical`) sets the minimum risk that requires confirmation. The service maps both unchanged into `runConfig`; the Agent validates them with `assertRunConfigPreferences` and reads no other source.
- Clients cannot provide internal runtime fields such as `thinkingStartedAt`, `runTimeoutMs`, plugin instances, hooks, tool policies, or execution ownership.
- Unknown top-level fields, unknown nested protocol fields, irrelevant command sections, legacy actions, and unsupported protocol versions are rejected.
- `pluginModelConfig`, attachment entries, and interaction response bodies are intentionally opaque payloads owned by their respective plugin, attachment, and interaction contracts.
- Proxy lifecycle controls such as join, reconnect, and lifecycle receipts remain outside this Agent command protocol.
- `turn.stop` requires the current positive authoritative turn revision in `concurrency.expectedTurnRevision`. Revision `0` is reserved for creating a new turn and is invalid for stop commands.

There is no V0 adapter or flat-payload compatibility path. Protocol changes require a new explicit protocol version.

## Channel subscription

A subscription is identified by the downstream socket and channel. Attaching a new
subscriber sends the current `channel_state` snapshot before subsequent broadcasts.
Attaching the same subscriber again is idempotent: it sends no snapshot and preserves
the delivery cursor. New channel states continue to arrive through live broadcasts.
Detaching and attaching again creates a new subscription and sends a fresh snapshot.
Reconnect explicitly attaches without sending a snapshot, then publishes its prepared
state baseline as part of the reconnect transaction, including for existing subscriptions.

## Reconnect navigation

`reconnect_data.identity.sessionId` identifies the requested browser Session. Entries in
`sessions` provide replay state and do not authorize navigation to another Session.
The browser activates only the requested Session when it is present in the replay set;
otherwise it preserves its current selection, including an unprovisioned local Session.
Running turns and pending interactions in other Sessions never determine the target.

## Transport diagnostics

The frontend, Agent Proxy, and Service emit `runtime-events` debug records with
`debugType: "agent-transport"` at command send, receive, validation, forwarding,
and failure boundaries. Records from each layer can be correlated by
`commandId`, `sessionId`, `turnScopeId`, `commandType`, and `protocolVersion`.

Service command transport diagnostics use `scope: "system"`: receiving or rejecting a
command precedes session acceptance and does not establish a persisted session. Requested
session and turn identifiers remain correlation fields; diagnostics never create session
storage. Session lifecycle records begin after authoritative acceptance and retain their
session scope. The service records command receipt once at the transport boundary.

Diagnostics are enabled by default through
`RUNTIME_EVENTS_CONFIG_DEFAULTS.sessionLogControls.debug.agentTransport` in
`shared/runtime-events-config.js`. Set
`NOOBOT_RUNTIME_EVENT_AGENT_TRANSPORT_DEBUG=off` to disable them. They are
stored separately as `debug-agent-transport.jsonl`.

The diagnostic summary contains identifiers, field names, counts, lengths, and
outcomes only. It never contains message text, attachment content, interaction
responses, authenticated user ids, API keys, or tokens.

Browser diagnostic construction or sink exceptions are reported by the shared lazy-debug
entry point as local warnings identifying the debug type and event. They must not be
silently discarded or replace the command's transport result. Disabled diagnostics do
not construct summaries; queue capacity and expiry drops remain observable through the
session-log sink's counters.

## Turn message ownership

`assertAgentTurnMessageAppend` applies the same message identity and uniqueness
rules as the complete list contract. `captureAgentTurnMessageValue` captures the
message's JSON value at admission or explicit update and deeply freezes that
detached value. Dates, getters and custom serializers are evaluated at this boundary;
later source mutations cannot alter an admitted message. Cycles, BigInt and
serialization failures reject the operation before publication. Serialization must
preserve the message identity. Provider metadata and plugin payloads keep their
native JSON representation without an additional field schema.

`patchAgentTurnMessageValue` requires a protocol-captured base and captures only
the changed top-level fields. Undefined or JSON-omitted fields remove the stored
field. Unchanged nested JSON values retain their immutable identity; metadata
patches do not serialize or traverse the retained body. A value-equivalent patch
returns the base and does not advance the store revision. Getters, nested
serializers and identity validation run before any store mutation. A root
`toJSON` function owns the complete candidate and therefore evaluates a complete
replacement, with the same identity-preservation requirement as admission.
Recapturing a value produced by this protocol returns that immutable value;
freezing an external object alone never permits bypassing JSON capture.

`captureAgentTurnMessages` validates uniqueness on the captured values, after all
serializers have run. Append admission also checks the captured identity against
the current UID index. Mutable source getters and serializers cannot bypass the
identity checks used to build indexes or enqueue changes.

The current-turn store exposes copied records with immutable nested values.
`readSnapshot` additionally freezes the list. All changes must use store mutation
methods, which advance the affected message revision and update its indexes.
Pending changes capture immutable message values; acknowledging an older revision
cannot discard a newer update. Persistence submits only pending changes and
acknowledges them after successful commit. Failed writes remain retryable.

Pending changes contain message writes only. Replacing the current-turn selection,
changing a local UID or evicting a message removes its local pending value and
revision; it does not enqueue a durable deletion. Previously captured in-flight
writes retain their snapshot. Reintroducing a UID allocates a new revision, so an
older acknowledgement cannot consume the new write. Durable deletion and turn
replacement use the explicit `messageDeletion` and `turnReplacement` operations
defined by session-protocol, independently of the current-turn selection.

Summary completion captures revisions for its selected UIDs before awaiting the
durable transaction. `readMessageRevisions` includes acknowledged messages and
records absence for historical UIDs outside the current-turn store;
`readUnchangedMessageUids` checks only those captured identities. Acknowledgement
does not change a message revision. Only unchanged revisions may be evicted from
memory or marked and pruned from model context after commit. An edit made while
the transaction or subsequent user metadata backwrite is pending remains in the
store, pending changes and model context for the next checkpoint, even if a later
edit restores the original content. Eviction never deletes a durable message.
