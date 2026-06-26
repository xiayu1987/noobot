# Hook System (system-core/hook)

## Overview

Noobot Agent supports **agent-level** lifecycle hooks via `createAgentHookManager()` and `runAgentRuntimeHook()`.
Use `AGENT_HOOK_POINTS` as the hook-point constant.

- Register hooks with `on / once / off`
- Execute by hook point name (sequential by default, optional parallel)
- Supports per-hook timeout
- Hook failures are captured and returned in `errors` (do not break main flow by default)

---

## Registration

```js
import { createAgentHookManager, AGENT_HOOK_POINTS } from "noobot-agent/hook";

const hookManager = createAgentHookManager({ defaultTimeoutMs: 3000 });

hookManager.on(AGENT_HOOK_POINTS.BEFORE_LLM_CALL, async (ctx) => {
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

Most hook points (except `before_context_build`) now also include:

- `agentContext` (the complete in-memory agent context object; mutable)
- `emitHookClientEvent(event, data)` (plugin -> frontend event emitter)

`emitHookClientEvent` output is sanitized by runtime hook layer and strips internal fields such as
`agent`, `agentContext`, and `runtime` before forwarding to frontend.
Additionally, `hook_plugin_progress.data` is schema-whitelisted to:
`plugin, version, point, stage, status, fsmState, fsmRejected, reason, toolName, commitType, message, timestamp, durationMs, error`.

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
- `after_tool_calls`
- `before_tool_call`
- `after_tool_call`
- `tool_call_error`

### State commit
- `before_state_commit`
- `after_state_commit`

### Session lifecycle
- `after_session_delete`

---

## Point-specific payload additions

- `before_llm_call` / `after_llm_call`:
  - `turn`, `mode`, `toolChoice`, `hasToolCalls`, `calls`, `ai`, `modelResponse`, `messages`, `maxTurns`
- `before_tool_calls`:
  - `turn`, `toolCallCount`, `calls`
- `after_tool_calls`:
  - `turn`, `toolCallCount`, `calls`, `toolCallResults`, `hasTaskSummaryCall`, `hasRequestHelpCall`, `hasFinalAnswerCall`
- `before_tool_call` / `after_tool_call` / `tool_call_error`:
  - `turn`, `toolName`, `call`, `args`, `success`, `failureReason`, `toolResultText`, `error`
- `before_state_commit` / `after_state_commit`:
  - `commitType` (`assistant_message` / `tool_result` / `attachments`)
  - `payload`, `call` (for tool result)
- `after_session_delete`:
  - `deletedSessionIds` (deleted branch IDs)
  - `basePath` (workspace path used by cleanup plugins)

---

## Notes

1. Hooks may mutate `context` objects; downstream logic will observe those changes.
2. Keep hooks lightweight; long hooks should use shorter timeouts.
3. Prefer observation, policy checks, audit, masking, tracing in hooks; avoid heavy business logic.
