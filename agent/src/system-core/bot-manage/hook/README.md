# Bot Hook System (system-core/bot-manage/hook)

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
