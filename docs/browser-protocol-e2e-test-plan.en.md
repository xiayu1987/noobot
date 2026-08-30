# Noobot Browser Protocol Closed-Loop E2E Test Plan

[English](./browser-protocol-e2e-test-plan.en.md) | [中文](./browser-protocol-e2e-test-plan.zh-CN.md)

> Language note: this document and the Chinese version describe the same executable suite. PBE
> identifiers, protocol implementations, specs, and `model-observation-policy.js` are the single
> source of truth. Translation must not introduce different acceptance rules.

## 1. Goals And Principles

This Playwright plan validates real browser behavior for:

- Session creation, persistence, refresh, and concurrent version control.
- `turn.send`, `turn.resend`, `turn.continue`, and `turn.stop`.
- Authoritative Turn Lifecycle, receipts, reconnect, and realtime projection.
- User stop, model-message snapshots, and continuation after stop.
- Attachments retained, added, removed, and restored from snapshots.
- Harness connection, Hooks, Context Snapshots, and auxiliary model calls.
- Workflow roots, child executions, attachment transfer, and combined Harness execution.
- Agent configuration, interaction timeout, connectors, and character animation artifacts.
- Multiple pages, offline reconnect, concurrent stop, and invalid protocol rejection.

Each operation must close the complete data chain:

```text
correct browser state
AND correct WebSocket protocol
AND correct lifecycle
AND correct Session persistence
AND correct stopped snapshot
AND correct attachment facts
AND correct Harness/Workflow records
AND no forbidden errors
```

Rules:

1. The browser is the only business-operation initiator. Files, HTTP, WebSocket captures, and logs
   are evidence only.
2. Every test creates an independent Session and shares no business state with another test.
3. Agent Transport, Turn Lifecycle, Session, attachments, and Context each have one authority.
4. The UI must not infer backend state with timers or infer a terminal Turn from WebSocket close.
5. Tests must not depend on product bypasses, compatibility routes, or test-only business APIs.
6. Failures must retain enough browser, protocol, and persistence evidence to locate the first
   broken boundary.

## 2. Authoritative Code Boundaries

- Agent Transport commands and validation: `agent-transport-protocol/src/commands.js`
- Agent Transport constants: `agent-transport-protocol/src/constants.js`
- Turn Lifecycle and receipts: `session-protocol/src/turn-lifecycle.js`
- Browser WebSocket dispatch: `client/noobot-chat/src/infrastructure/websocket/chatWebSocketClient.js`
- Reconnect projection: `client/noobot-chat/src/modules/chat/runtime/session/reconnectCoordinator.js`
- Resend transaction: `client/noobot-chat/src/modules/chat/runtime/engine/resendTransaction.js`
- Attachment serialization: `client/noobot-chat/src/modules/chat/runtime/engine/attachmentSerialization.js`
- Stopped snapshot store: `agent/src/runtime/resume/model-message-snapshot-store.js`
- Harness runtime: `plugin/noobot-plugin-harness/src/core/context.js`
- Harness Context Snapshot: `plugin/noobot-plugin-harness/src/tracing/buffer-manager.js`
- Harness defaults: `plugin/noobot-plugin-harness/src/core/options.js`

Protocol baseline:

| Protocol               | Current version/event             |
| ---------------------- | --------------------------------- |
| Agent Transport        | `protocolVersion: 2`              |
| Turn Lifecycle         | `protocolVersion: 1`              |
| Lifecycle transport    | `transportProtocolVersion: 3`     |
| Lifecycle wire event   | `turn_lifecycle`                  |
| Lifecycle receipt      | `action: turn.lifecycle.received` |
| Model Context Snapshot | `version: 2`                      |

Version changes must update the protocol package, production code, and assertions together. Tests
must never accept multiple protocol versions as a compatibility path.

## 3. Test And Evidence Layout

```text
client/noobot-chat/tests/e2e/protocol/
├── fixtures/                 # authentication, Session, capture, evidence
├── helpers/                  # browser actions and protocol assertions
├── specs/                    # executable PBE scenarios
└── playwright.protocol.config.js
```

Each run writes isolated evidence under `test-results/protocol/<run-id>/`, including browser
console output, WebSocket and HTTP captures, lifecycle/Session/snapshot/attachment/Harness/Workflow
audits, model-context evidence, a final screenshot, and `trace.zip`. Runtime credentials must never
be written to any artifact.

## 4. Shared Capture And Assertions

### 4.1 Outbound WebSocket Commands

- Every business command uses Agent Transport Protocol v2.
- Only `turn.send`, `turn.resend`, `turn.continue`, and `turn.stop` are allowed.
- Legacy `action: send/continue/stop`, unknown fields, and fields forbidden for a command fail.
- `commandId` is non-empty and unique per operation.
- `identity.sessionId` equals the current browser Session.
- `identity.turnScopeId` is a canonical `client-turn:*` identity.
- Run commands use `expectedTurnRevision === 0`; stop uses `expectedTurnRevision >= 1`.
- `input.attachments` is always an array.
- Continue origins exist only in `continuation.dialogProcessId/turnScopeId`.
- Receipts use `turn.lifecycle.received`; no business command substitutes for acknowledgement.

### 4.2 Inbound Frames And Lifecycle

Natural completion:

```text
turn.action_accepted
  -> turn.processing_started
  -> turn.processing_completed
  -> turn.completed
```

User stop:

```text
turn.processing_started
  -> turn.stop_accepted
  -> turn.stop_processing_completed
  -> turn.stop_completed
```

Event IDs are unique, sequence is strictly increasing, revision never decreases, and Session,
dialog, and Turn identities match the command. Each socket sends one receipt per lifecycle event.
Stop visibility and terminal state come only from authoritative lifecycle or snapshots. Reconnect
control events belong to the reconnect handler; active-run events belong to the active stream.

### 4.3 Session Audit

The audit reads the scoped Session directory and validates `session.json`, `session-summary.json`,
execution records, Turn journals, execution events, model-message snapshots, and events. Browser,
transport, and persistence identities must agree. Each `(dialogProcessId, turnScopeId)` is unique,
only one active fact exists, resend replacement relationships are explicit, `aggregateVersion`
increases monotonically, and hydration creates no lifecycle or persistence facts.

### 4.4 Stopped Snapshot Audit

Snapshot files are addressed by `<dialogProcessId>__<turnScopeId>.json` and must use version 2.
Identity must match the stopped Turn. `system`, `history`, and `incremental` blocks contain only JSON
plain objects; flattened `messages` equals their projection. Timestamps are ordered, save success is
logged, save failure is absent, and Continue loads exactly the snapshot named by `continuation`.

### 4.5 Attachment Audit

```text
browser File -> contentBase64 -> command -> canonical attachment
  -> Session user message -> Agent metadata -> Model Context
  -> stopped snapshot -> Continue restoration
```

Fixed content is hashed before upload. Name, MIME type, size, and SHA-256 remain stable. A client ID
only correlates upload; persistence creates exactly one canonical `attachmentId`. Continue does not
resend snapshot attachments but restores them in Model Context. Deleted attachments do not enter a
new Turn. Every path remains inside the current user and Session scope.

### 4.6 Harness Audit

Harness evidence is scoped by `dialogProcessId` and includes the run manifest, Context Snapshot,
events, prompts, policy checks, and capability traces. Selected plugins exactly equal browser
selection; run, Session, and Turn identities agree; Hook starts and ends pair; stop ends as `abort`
and natural completion as `success`. Context is independently parseable, runtime/tool instances do
not enter the Agent Context envelope, and auxiliary model calls remain distinguishable from the
main model.

## 5. Browser Scenarios

### PBE-002: Send Without Attachments

Create a Session through the UI, select Harness, send a unique message, and wait for natural
completion. Assert one `turn.send`, empty attachments, matching browser/HTTP/persistence identity,
the natural lifecycle, one user Turn, a successful Harness run, no stopped snapshot, and no legacy
reconnect cursor.

### PBE-006: Stop And Continue Without Attachments

Stop a long request, inspect its snapshot, Continue with a unique prompt, and stop again. Assert one
correct stop, plain-object blocks, new command/dialog/Turn identity, exact continuation reference,
empty command attachments, restored snapshot content, and no transport-close or Context errors.

### PBE-007: Attachment Stop And Continue

Upload one fixed attachment, stop, Continue, and stop again. Assert the initial Send owns one
attachment, Continue sends none, restored Context owns one, canonical identity/hash/path remain
correct, and both stopped snapshots retain attachment metadata.

### PBE-008: Three Consecutive Stop/Continue Cycles

Run Send/Stop followed by three Continue/Stop cycles. All four identities are unique, every Continue
references only the immediately preceding stop, lifecycle streams do not cross, four snapshots map
one-to-one, and cleanup never closes the active run connection.

### PBE-009-012: Resend Attachment State Chain

These cases are merged into PBE-029 and validate `attached -> retained -> removed -> added` in one
Session. Independent duplicate scenarios are removed.

### PBE-013: Refresh During An Active Turn

Refresh an active run, capture reconnect baseline and tail, then stop the original Turn. Reconnect
uses `knownLifecycleSequenceMap`, carries no removed message cursor, commits baseline before live
buffer, projects the active Turn once, and keeps Stop operational.

### PBE-014: Reconnect Concurrent With A New Run

Start resend or Continue while reconnect is incomplete. Reconnect control and run streams retain
separate ownership; `turn.action_accepted` is neither lost nor duplicated; Stop remains immediately
available and no `socket_close` business failure appears.

### PBE-015: Two-Page Lifecycle And Message Consistency

Open one Session in two independent browser contexts. After A sends, B must receive the user
message, assistant presentation entity, assistant content, and the same running state. B stops the
Turn. Both pages receive the same lifecycle identity/order, each socket receipts it, only one stop
is authoritative, and both pages finish `user_stopped`.

### PBE-016-017: Harness Activation, Hooks, And Context

Selection is exactly `['harness']`; run directories use `dialogProcessId`; manifest, Context, and
events exist. Tool-triggering execution validates Model Context v2 only at `before_llm_call`, no
runtime bindings in envelopes, canonical Context mutations, plain-object blocks, and one prompt
authority.

### PBE-021-026: Recovery, Concurrency, Offline, And Negative Protocol

- PBE-021 refreshes a naturally completed Session without creating a new run or active state.
- PBE-022 reopens a stopped attachment Session in a new context and continues from persistence.
- PBE-023 rejects stale `aggregateVersion` mutation and preserves one replacement chain.
- PBE-024 accepts one of two concurrent stops and creates one terminal event and snapshot.
- PBE-025 treats offline close as transport only and stops after authoritative reconnect.
- PBE-026 rejects legacy/invalid raw WebSocket commands without creating business facts.

### PBE-027-032: Plugin, Session, And Workflow Protocols

- PBE-027 closes Manifest V2 activation and runtime/execution-event identities.
- PBE-028 transfers one attachment from root to Workflow child through canonical Session transfer,
  validates child ownership and root result attachments, refresh projection, and natural completion;
  then runs a second Workflow Turn whose child performs three sequential real failed `read_file`
  calls and verifies the internal Harness failure prompt remains non-presentational while the
  authoritative node lifecycle is terminal.
- PBE-029 audits the complete Session protocol through send, stop, resend variants, Continue,
  manifests, journals, runtime/execution events, and stopped snapshots. Only canonical identity,
  revision, sequence, and version fields are permitted.
- PBE-030 refreshes an unprovisioned local draft without persisting or restoring its local identity.
- PBE-031 stops and continues Workflow root/child execution without identity crossover.
- PBE-032 alternates Workflow, plain, and Workflow Turns with exact plugin selection and distinct
  root/child model observations.

### PBE-033: Low-Turn Complete Harness Flow

Use the formal plugin-model boundary to lower E2E thresholds and execute a five-step dependent tool
chain. Planning, guidance, summary, refinement, phase acceptance, semantic validation, and review
must all produce decision/execution facts. Capability relays, checkpoint marks, cache prefixes, and
exactly five business tool calls close without recomputation.

### PBE-034: Low-Turn Main-Agent Phase Summary

Without Harness, lower the main summary threshold through the Composer and execute three dependent
steps. Assert summary requirement, checkpoint, and completion order; exact summarized UIDs without
split call/result pairs; no summarized content in later provider input; and exactly one
`task_summary`.

### PBE-035: Periodic Task Check

Lower task-check and summary thresholds through the Composer, run five dependent steps, and send a
follow-up. Each requirement contributes one non-leaking marker. `task_check` uses
`NOOBOT_TASK_CHECK/1`, returns only its receipt, retains the latest unsummarized check evidence, and
remains visible in thinking details and later history.

### PBE-036: Tools, Live Thinking, And Interaction

Run the declared safe tool set under real Harness guidance and complete the interaction card.
Execution events must contain exactly the declared tools with paired IDs/arguments/results. Written
file cards agree with Turn journals before and after refresh, live thinking changes over time, all
seven pairs remain expandable, and interaction/tool facts reach the final response.

### PBE-037-043: Interaction, Attachments, Agent Config, And Tool Boundaries

- PBE-037 verifies that a timed-out `user_interaction` closes the real modal and is not replayed.
- PBE-038 preserves canonical parsed-attachment identity, preview, download, and refresh behavior.
- PBE-039-041 verify the canonical Agent Config command, connect response, and refresh persistence.
- PBE-042 verifies immediate same-page resend after stop.
- PBE-043 closes native, multimodal, external-tool, and result-observation paths for a regular user.

### PBE-042: Immediate Same-Page Resend After Stop

After `stop_completed`, edit and resend without refresh, reconnect, or Session reload. The frontend
uses the newly committed `aggregateVersion`; replacement succeeds and produces one `turn.resend`.
Conflict hydration must not be required to repair local concurrency state.

### PBE-044-045: Snapshot Restoration Across Tool Execution

PBE-044 stops an eight-step sequential tool chain twice and continues to natural completion. Both
version-2 snapshots serialize exact Context blocks, keep call/result pairs atomic, restore through
the formal Context protocol, and form exact prefixes of the first continued provider inputs.

PBE-045 starts four tools in one assistant response, stops after partial completion, and continues
without rerunning tools. Every call owns one result; interrupted work becomes canonical
`status=aborted, stopType=user_stop`; the restored projection is the exact provider-input prefix.

### PBE-046: Real-Time Workflow Card Consistency Across Browsers

After a baseline Turn, B opens A's Session. A starts a Workflow Turn. B must receive the user
message and assistant presentation before Workflow runtime, then render the same Workflow card.
Both pages always expose the DSL toggle with DSL collapsed by default. B stops the Turn and both
pages converge on the same stop state. Lifecycle must not manufacture messages, status must not
trigger a REST refresh, and Workflow runtime must not create a separate host message.

### PBE-047: Connector Selection, Query, And Session Authority

Create and connect a MySQL connector through the browser, select it for the Session, and send a
query. The Session selection write must commit before the model command; connector tool execution,
model context, persistence, and provider observation must all reference that authoritative
selection.

### PBE-048: Character Import, Animation, And Session Artifact

Enable the Character plugin, import and select an animated GLB, and request an animation through a
real model call. The tool result and authoritative plugin artifact must agree; desktop and mobile
render one Three.js card in the Session artifact panel, and refresh restores it without placing a
duplicate card in the Character panel.

### Single Model Invocation Observation Boundary

All model observations occur at the observed model port adjacent to provider `invoke()`. Main Agent,
retry, streaming, tool binding, capability, memory, MCP, collaboration, and data processing must not
emit their own duplicate `llm_invoke_messages` events. Each record includes protocol/authority,
model instance, invocation identity and sequence, model metadata, flow/purpose/domain, and message
counts, roles, dialogs, missing IDs, previews, and truncation. Audits deduplicate only by
`invocationId`, order by `modelInstanceId + invocationSequence`, and never convert string prompts or
infer calls from hashes.

## 6. Debug Evidence And Forbidden Errors

Capture Agent Context, context identity, Agent Transport, Workflow diagnostics, state-machine and
reconnect diagnostics, plus Harness traces, prompts, snapshots, and capability traces. Queries are
scoped to the current Session/dialog/Turn.

The scenario fails on invalid Context envelopes, non-plain objects, transport close classified as a
business/Hook failure, authoritative snapshot failure or timeout, lifecycle regression, duplicate
canonical attachments, Session identity conflict, or incomplete/replaced reconnect transaction.
A stop-related `HOOK_EXECUTION_FAILED` is valid only when typed `user_stop`, followed by
`turn.stop_completed`, with a successfully persisted snapshot.

## 7. Execution Tiers

```bash
npm run test:e2e:protocol:smoke
npm run test:e2e:protocol:core
npm run test:e2e:protocol:full
```

| Tier      | Scenarios                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------ |
| Smoke     | PBE-002, PBE-006                                                                                 |
| Core      | PBE-007-014, PBE-016, PBE-017, PBE-021, PBE-022, PBE-027, PBE-029, PBE-030, PBE-037, PBE-039-042 |
| Full-only | PBE-015, PBE-023-026, PBE-028, PBE-031-036, PBE-038, PBE-043-048                                 |

## 8. CI Failure Artifacts

Every failed test retains Playwright trace/screenshot, browser console, WebSocket frames, HTTP
replacement traffic, Session/lifecycle/receipt/snapshot/attachment audits, Harness/Workflow audits,
and identity-scoped Proxy/Service/Agent logs. The report names the first broken boundary, for example:

```text
UI sent
-> HTTP replacement committed
-> WS turn.resend sent
-> Service accepted
-> lifecycle did not reach browser
```

Reporting only “Stop button timed out” or “page assertion failed” is insufficient. The purpose of
the suite is to prove the intact upstream/downstream facts around the first protocol violation.
