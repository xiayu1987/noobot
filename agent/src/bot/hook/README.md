# Bot Hook Runtime Adapter

This directory adapts `@noobot/hook-protocol` to Bot session orchestration and
telemetry. It does not define a Bot-specific Manager or duplicate point list.
Runtime resolution accepts only `runtime.botHookManager`.

Bot dispatch contexts expose `agentContextSummary`, not the mutable full Agent
context. Register handlers with `createHookManager` and `HOOK_POINT.BOT` from
`@noobot/hook-protocol`.

## Dispatch takeover

A `HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH` hook is an execution router. A handler that replaces the
main Agent must:

1. call `ctx.claimAgentDispatch({ owner, source, executionId, executionKind,
   rootExecutionId, origin, stage })` as
   soon as it accepts exclusive ownership;
2. return a versioned `bot_dispatch_outcome` from
   `@noobot/agent-transport-protocol/bot-dispatch`;
3. return `handled` with its final result, or `handled` with a structured
   failure; and
4. never return `pass` after creating side effects or child executions.

The runner rejects competing `handled` owners. Once an owner has claimed the
Turn, hook errors and handled failures terminate that Turn and can never fall
back to the root Agent. The claim also publishes the root `RUNNING` lifecycle
boundary immediately, so cancellation remains available during planning and
child execution.

A structured `handled` outcome without an earlier claim, a claim followed by
`pass`, or a claim/outcome owner mismatch is a dispatch protocol violation and
fails the Turn.

The structured dispatch outcome is the only takeover contract.
