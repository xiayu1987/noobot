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

`writeRuntimeEvent` is the single write entry.

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

Session events are placed by the session tree (`workspace-protocol/session-tree`). Events targeting a session
whose tree chain contains a tombstone return `{ ok: true, skipped: true, deleted: true }`; events for a session
that is not registered in the tree, or whose nested directory has no persisted `session.json` yet, return
`{ ok: true, skipped: true, missingSession: true }`. Neither creates a session directory. An explicit
`parentSessionId` that contradicts the registered tree parent is rejected.

## Storage

The workspace root comes only from `NOOBOT_WORKSPACE_ROOT`, injected by the startup topology; a missing value
is an error. Log controls and storage limits come only from `RUNTIME_EVENTS_CONFIG_ENVS`. The JSONL transport
writes session events under the session's tree-chain directory
`<root>/<userId>/runtime/session/<rootSessionId>/.../<sessionId>/events` and startup/system events under
`<root>/<userId|system>/runtime/events/<scope>/<source>`. The desktop shell writes startup/system events under its
Electron `userData` events root and cannot write session events.

## Failures

Failures are reported once, to stderr, by runtime-events itself; callers never report write failures again.
A failed write (invalid envelope, ownership violation, I/O error) is reported by the writer and returned as
`{ ok: false, error }`; callers that need delivery guarantees check `ok`, fire-and-forget callers ignore it.
An archive cleanup failure after a successful append is reported once per JSONL batch by the transport, and
every write in that batch returns `{ ok: true, cleanupError: true }`.

## Rules

Do not fabricate session context. Do not route runtime-events internal write failures back into runtime-events recursively. Sanitize sensitive fields before storing structured data.
