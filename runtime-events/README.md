# @noobot/runtime-events

Noobot runtime event center for backend startup, session runtime, and system runtime events.

This package exposes the general runtime-event API at `@noobot/runtime-events` and the specialized session-log transport at `@noobot/runtime-events/session-channel`.

## Scopes

`scope` is a required protocol field; the writer never infers it from context.

- `startup`: process/config/listen/bootstrap events. Does not require session context.
- `session`: events that clearly belong to a session. Requires `userId` and `sessionId`.
- `system`: runtime events not tied to one session. Does not require session context.

## Categories and levels

`category` is also required and must be a registered value; a missing or unknown category is rejected
instead of being folded into `system`. `level` defaults to `"info"` at the protocol level.

Non-debug session logs are gated by their category switch (`NOOBOT_RUNTIME_EVENT_<CATEGORY>_LOG`). Records with
`category: "debug"` have no category switch: they require a registered `debugType` and are gated only by that
debug type's switch, so disabling the `system` log does not affect them.

## API

`writeRuntimeEvent` writes one event through `writeRuntimeEvents`, the bounded batch entry.
Batch results are positional; each accepted write completes before the batch returns.

`flushRuntimeEvents` drains admitted event batches from location preparation through durable output,
including batches admitted during the drain. Concurrent barriers collect both rejected preparation
and per-record `ok: false` results and reject with `AggregateError` after admitted writes settle.
Completed failures remain owned by their individual receipts and are not replayed by later barriers.
Producers must stop admitting new events before flushing for shutdown or workspace removal.

`flushJsonLineBatches` drains pending and active transport writes, including writes admitted
by their receipts during the drain. Every concurrent barrier rejects with `AggregateError`
if a write fails while it is draining, after all accepted writes have settled. Individual
write receipts still report their own result. Failures settled before a barrier starts belong
to those receipts and are not replayed by later barriers. Producers must stop admitting new
work before using this barrier for shutdown.

```js
import { writeRuntimeEvent } from "@noobot/runtime-events";

await writeRuntimeEvent({
  source: "service",
  scope: "system",
  category: "transport",
  level: "warn",
  event: "service.runtime.pendingInteraction.rejected",
  data: { reason: "client_disconnected" },
});
```

Session events use the host-owned `locationResolver.locateSessionScope(userId, sessionId)` port
from `session-protocol` when supplied in writer options. Execution-log projection passes the same
bound resolver used by the authoritative repository, including recovery. The port returns a scope
with an absolute `sessionDir`, or `null` for absence; identity errors propagate without switching
location authorities. It is never read from an event payload. Scoped sessions therefore write to
their own `events` directory without creating a shadow registration in the default tree.
Without an injected port, placement is owned by the session tree (`workspace-protocol/session-tree`).
Both paths enforce user workspace containment, session tombstones and persisted head identity.
Events targeting a session
whose tree chain contains a tombstone return `{ ok: true, skipped: true, deleted: true }`.
An unregistered session returns `{ ok: false, error }`, with
`error.code === RUNTIME_EVENT_ERROR_CODE.SESSION_NOT_REGISTERED`. Missing registration is not a
delivery acknowledgement: source projection cursors must remain pending until registration is restored.
Neither outcome creates a session directory. For a registered session, the Session protocol resolves
the storage authority. The head for that authority (partition journal or Immutable store) must be
readable, valid, and match the session ID. An invalid authoritative head rejects preparation; the
writer does not switch stores. Placement uses the location authority, not caller-supplied
`parentSessionId`. Disabled log controls and authoritative tombstones intentionally skip delivery.

## Storage

The workspace root comes only from `NOOBOT_WORKSPACE_ROOT`, injected by the startup topology; a missing value
is an error. Log controls and storage limits come only from `RUNTIME_EVENTS_CONFIG_ENVS`. The JSONL transport
writes session events under the session's tree-chain directory
`<root>/<userId>/runtime/session/<rootSessionId>/.../<sessionId>/events` and startup/system events under
`<root>/<userId|system>/runtime/events/<scope>/<source>`. The desktop shell writes startup/system events under its
Electron `userData` events root and cannot write session events.

## Failures

Execution-log projection uses the output intent, receipt and byte-reservation
contracts exported by `@noobot/session-protocol`; see its execution-log projection
section. Source cursors remain owned by the authoritative repository. The JSONL
destination queue owns recovery and rotation: durable intent, durable output,
durable receipts, then durable intent retirement precede acknowledgement.
Receipts are stored in the authoritative turn directory supplied by delivery,
independently of rotated output files. Healthy publication and restart recovery
share the same output completion routine. Parallel receipt writes settle before
errors propagate, and each distinct receipt directory is synchronized once per
phase. Byte reservations partition opportunistic groups without re-encoding
growing payload prefixes. A corrupt pending record blocks later writes explicitly.

Every ordinary and projected append acquires the same destination mutation lock
across processes. Under that lock, it recovers any pending output before checking
receipts, rereads the destination's current size, and performs rotation and
publication. File sizes are never reused from a previous batch. Ordinary appends
sync their bytes on every batch; directory sync knowledge is bounded and tied to
the observed file identity. Creation, rotation, replacement and failed appends
require a new directory sync before acknowledgement.

Directory barriers apply on Linux and macOS. On Windows, Node.js cannot fsync
directory handles, so runtime output skips that barrier while retaining file
content flushes and file I/O errors. Directory-entry durability across power loss
therefore differs from the Linux and macOS guarantee.

Invalid envelopes, ownership violations and invalid session storage reject batch preparation before any
writes start. Missing registration and transport I/O errors return `{ ok: false, error }` per record;
runtime-events reports those failures to stderr. Callers that need delivery guarantees must handle both
rejected preparation and `ok: false` results, and must not acknowledge either as delivery.
An archive cleanup failure after a successful append is reported once per JSONL batch by the transport, and
every write in that batch returns `{ ok: true, cleanupError: true }`.

## Rules

Do not fabricate session context. Do not route runtime-events internal write failures back into runtime-events recursively. Sanitize sensitive fields before storing structured data.
