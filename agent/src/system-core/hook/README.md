# Hook System (system-core/hook)

## Overview

Noobot Agent supports lifecycle hooks via `createHookManager()` and `runRuntimeHook()`.

- Register hooks with `on / once / off`
- Execute by hook point name (sequential by default, optional parallel)
- Supports per-hook timeout
- Hook failures are captured and returned in `errors` (do not break main flow by default)

---

## Registration

```js
import { createHookManager, HOOK_POINTS } from "noobot-agent/hook";

const hookManager = createHookManager({ defaultTimeoutMs: 3000 });

hookManager.on(HOOK_POINTS.BEFORE_LLM_CALL, async (ctx) => {
  // observe or mutate ctx
});

runtime.hookManager = hookManager;
// or runtime.hooks = hookManager;
```

You can also pass via `runConfig` during context build:

- `runConfig.hookManager`
- `runConfig.hooks`

---

## Standard payload fields

Most hook payloads include the normalized runtime identifiers:

- `userId`
- `sessionId`
- `parentSessionId`
- `dialogProcessId`
- `caller`

Common lifecycle metadata:

- `phase`
- `status` (`start` / `success` / `error` / `abort`)
- `startedAt`
- `endedAt`
- `durationMs`

---

## Hook points

### Context
- `before_context_build`
- `after_context_build`
- `context_build_error`

### Turn / Engine
- `before_turn`
- `before_final_output`
- `after_turn`
- `on_abort`
- `on_error`

### LLM
- `before_llm_call`
- `after_llm_call`
- `llm_call_error`

### Tool
- `before_tool_calls`
- `before_tool_call`
- `after_tool_call`
- `tool_call_error`

### State commit
- `before_state_commit`
- `after_state_commit`

---

## Point-specific payload additions

- `before_llm_call` / `after_llm_call`:
  - `turn`, `mode`, `toolChoice`, `hasToolCalls`, `calls`, `ai`, `modelResponse`
- `before_tool_calls`:
  - `turn`, `toolCallCount`, `calls`
- `before_tool_call` / `after_tool_call` / `tool_call_error`:
  - `turn`, `toolName`, `call`, `args`, `success`, `failureReason`, `toolResultText`, `error`
- `before_state_commit` / `after_state_commit`:
  - `commitType` (`assistant_message` / `tool_result` / `attachment_metas`)
  - `payload`, `call` (for tool result)

---

## Notes

1. Hooks may mutate `context` objects; downstream logic will observe those changes.
2. Keep hooks lightweight; long hooks should use shorter timeouts.
3. Prefer observation, policy checks, audit, masking, tracing in hooks; avoid heavy business logic.

