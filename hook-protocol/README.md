# Noobot Hook Protocol

`@noobot/hook-protocol` is the single source of truth for Hook points, execution
semantics, registration, and results. Agent, Bot, Service, and plugins depend on
this package directly; none of them defines or aliases Hook points locally.

## Public API

```js
import {
  HOOK_POINT,
  HOOK_PROTOCOL_VERSION,
  HookExecutionError,
  createHookManager,
} from "@noobot/hook-protocol";

const hookManager = createHookManager({ defaultTimeoutMs: 3000 });

hookManager.on(
  HOOK_POINT.AGENT.BEFORE_LLM_CALL,
  async (context, { signal }) => {
    // Observe or mutate the context owned by this point.
  },
  { id: "example.before_llm_call", priority: 10, timeoutMs: 1000 },
);

const result = await hookManager.emit(
  HOOK_POINT.AGENT.BEFORE_LLM_CALL,
  context,
  { signal: parentSignal },
);
```

The Manager has one command surface: `on`, `once`, `off`, `clear`, `list`, and
`emit`. Every handler requires an ID that is unique within its point. Unknown
points and duplicate IDs are protocol violations and are rejected.

`emit` returns one result shape:

```js
{
  protocolVersion: 2,
  executed: true,
  point: "agent.before_llm_call",
  context,
  outcomes: [
    { handlerId, status, durationMs, value, error },
  ],
  failures: [],
}
```

There is no `run` alias and no `results` or `errors` result shape.

## Point Domains

- `HOOK_POINT.AGENT`: Agent context, model, tool, state, turn, and transfer lifecycle.
- `HOOK_POINT.BOT`: session orchestration and Agent dispatch lifecycle.
- `HOOK_POINT.SERVICE`: service-owned lifecycle such as session deletion.
- `HOOK_POINT.WORKFLOW`: workflow-owned execution lifecycle.

Point strings are namespaced (`agent.*`, `bot.*`, `service.*`, `workflow.*`).
Bare or historical point names are invalid and are not normalized.

Each point descriptor defines execution order and failure mode. Control points
use `fail_flow`; observer points use `continue`. Consumers do not implement a
second failure policy. Handler timeout and parent cancellation are exposed by
the invocation `signal`, and a failed control point throws `HookExecutionError`. Cancellation from the
parent invocation is not a hook failure: the runtime propagates the parent's abort reason unchanged,
does not call the hook error observer, and stops dispatching remaining serial handlers.
Cancellation policy belongs to each hook point descriptor. Terminal error and abort observers are
`detached`, so they can record the terminal fact after the parent execution signal has been cancelled.

## Ownership Boundaries

The protocol package owns Manager behavior and point descriptors. Runtime
adapters own context construction, telemetry, and client event projection:

- `agent/src/extensions/hooks`: Agent runtime adapter.
- `agent/src/bot/hook`: Bot runtime adapter.
- `service/services/service-plugin-host.js`: Service registration host.

Runtime wiring uses only `runtime.hookManager` for Agent hooks and
`runtime.botHookManager` for Bot hooks. Plugin options remain under
`runConfig.plugins`; a Hook Manager never stores plugin configuration or
registration flags.
