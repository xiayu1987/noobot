# Bot Hook System (bot/hook)

Bot hooks are used for **session orchestration / multi-agent management** at bot-manage layer.
Bot dispatch points expose `agentContextSummary` (not full `agentContext`) to keep orchestration API stable.

## Hook points

- `before_session_run`
- `before_agent_dispatch`
- `after_agent_dispatch`
- `agent_dispatch_error`
- `after_session_run`
- `session_run_error`

## Registration

```js
import { createBotHookManager, BOT_HOOK_POINTS } from "noobot-agent/bot-manage/hook";

const botHookManager = createBotHookManager();
botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, async (ctx) => {
  // orchestration policy / routing / audit
});

await botManager.runSession({
  userId,
  sessionId,
  message,
  runConfig: {
    botHookManager,
  },
});
```

## Dispatch takeover

A `before_agent_dispatch` hook is an execution router. A hook that replaces the
main Agent must:

1. call `ctx.claimAgentDispatch({ owner, source, executionId, executionKind,
   rootExecutionId, origin, stage })` as
   soon as it accepts exclusive ownership;
2. return a versioned `bot_dispatch_outcome` from
   `@noobot/shared/bot-dispatch-protocol`;
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

`ctx.skipAgentDispatch` and `ctx.overrideAgentResult` remain read-only
compatibility inputs for older plugins. New plugins must use the structured
outcome contract.
