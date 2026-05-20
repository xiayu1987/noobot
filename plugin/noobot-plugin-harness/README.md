# noobot-plugin-harness

Hook-based Harness Engineering plugin for Noobot.

Current architecture split:
- `src/data/record-builders.js`: trace/snapshot/prompt record generation
- `src/capabilities/profile.js`: capability contract profile (planning/guidance/assistance/memory/synthesis/supervision/review)
- `src/capabilities/hook-map.js`: capability to lifecycle hook mapping
- `src/capabilities/handlers.js`: capability handler skeleton (default noop planned handlers)
- `src/capabilities/runtime.js`: capability runtime dispatcher (runs mapped handlers on hook points)
- `src/index.js`: hook wiring + persistence orchestration

The plugin is non-invasive: it is attached through Noobot hooks, and hook errors are captured by Noobot's hook manager instead of breaking the main agent flow.

## Capabilities

- Writes run manifest: `runtime/harness/runs/{dialogProcessId}/harness-run.json`
- Writes lifecycle event stream: `events.jsonl`
- Writes context snapshot: `context-snapshot.json`
- Writes prompt injection records: `prompts.jsonl`
- Writes tool call index: `tool-calls.jsonl`
- Writes state commit index: `state-commits.jsonl`
- Writes separate-model capability traces: `capability-traces.jsonl`
- Injects lightweight prompt policy through `before_llm_call`
- Injects final response guard through `before_final_output`
- Cleans related harness run artifacts on `after_session_delete`

## Session delete cleanup hook

Harness listens to `after_session_delete`.
When this hook is emitted with `deletedSessionIds` (or fallback `sessionId`), harness will:

1. flush in-memory manifest/jsonl buffers
2. delete matching `runtime/harness/runs/*` records by run-id or manifest `sessionId`

`service/routes/session-routes.js` emits this hook after `deleteSessionBranch` succeeds.

## Recommended usage: enable from runConfig

`SessionExecutionEngine.runSession()` can automatically create/reuse `hookManager` and register this plugin.

```js
await botManager.runSession({
  userId,
  sessionId,
  message: "hello",
  runConfig: {
    plugins: {
      harness: {
        enabled: true
      }
    }
  }
});
```

Shorthand forms are also supported:

```js
runConfig: {
  enableHarness: true
}
```

```js
runConfig: {
  harness: true
}
```

## Enable from globalConfig

Harness can be enabled globally, then overridden by per-run config.

```json
{
  "plugins": {
    "harness": {
      "enabled": true,
      "trace": true,
      "promptPolicy": true
    }
  }
}
```

Per-run config takes precedence over global config:

```js
runConfig: {
  plugins: {
    harness: {
      enabled: false
    }
  }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enables plugin registration. In `runSession`, the plugin is registered only when explicitly enabled by `runConfig` or `globalConfig`. |
| `basePath` | current user workspace | Root workspace for harness output. If omitted, `SessionExecutionEngine` resolves it from `workspaceService.getWorkspacePath(userId)`. |
| `trace` | `true` | Writes hook events to `events.jsonl` and related index files. |
| `promptPolicy` | `true` | Injects a lightweight system message before LLM calls. |
| `finalResponseGuard` | `true` | Reserved option for final response guard behavior. |
| `writeContextSnapshot` | `true` | Writes `context-snapshot.json` after context build. |
| `writePrompts` | `true` | Writes prompt injection records to `prompts.jsonl`. |
| `runtimeDirName` | `runtime` | Runtime directory name below `basePath`. |
| `harnessDirName` | `harness` | Harness directory name below runtime directory. |
| `promptPriority` | `80` | Hook priority for prompt injection handlers. |
| `tracePriority` | `20` | Hook priority for trace handlers. |
| `timeoutMs` | `1000` | Hook handler timeout. |
| `maxPreviewChars` | `1200` | Maximum preview size for recorded payload snippets. |
| `promptText` | built-in policy | System prompt text injected at `before_llm_call`. |
| `finalResponseText` | built-in guard | System prompt text injected at `before_final_output`. |
| `capabilityProfile` | built-in planned profile | Declares Harness Engineering capability contract; implementation can be filled later. |
| `capabilityHandlers` | built-in noop handlers | Optional capability handler overrides for each capability domain. |
| `planningGuidanceMode` | `separate_model` | `inject` or `separate_model`. In `separate_model`, planning/guidance can call an external model invoker. |
| `capabilityModelInvoker` | `null` | Optional async invoker used by `separate_model` mode. If the invoker returns `traces`, harness records them to `capability-traces.jsonl`. |
| `capabilityToolAllowlist` | `[]` | Tool allowlist passed from harness to capability invoker (all purposes). Empty means no tools. |
| `capabilityToolAllowlistByPurpose` | `{}` | Per-purpose allowlist override, e.g. `planning`, `guidance`, `summary`, `acceptance_semantic_validation`. |
| `acceptance.semanticValidation` | `false` | Enables semantic task-acceptance validation through `capabilityModelInvoker`. The rule-based acceptance report is still generated first; model failures are logged and do not block the main flow. |
| `miniRunnerMaxTurns` | `50` | Hint option for agent-side mini-runner injector (when `planningGuidanceMode=separate_model`). |
| `miniRunnerToolAllowlist` | `[]` | Fallback allowlist used by the injected mini-runner when harness does not pass a per-call allowlist. Empty means no tools. |

## Acceptance semantic validation

By default, acceptance is rule-based and uses the captured harness checklist plus runtime signals. To additionally verify semantic consistency between the checklist, the acceptance report, tool signals, and final output, enable:

```json
{
  "plugins": {
    "harness": {
      "enabled": true,
      "planningGuidanceMode": "separate_model",
      "acceptance": {
        "semanticValidation": true
      }
    }
  }
}
```

When enabled, both forced final-output acceptance and active `request_task_acceptance` tool calls can invoke the configured `capabilityModelInvoker` with purpose `acceptance_semantic_validation`. The model result is stored on `lastAcceptanceReport.semanticValidation`. If semantic validation returns `status: "fail"` or `consistent: false`, review reports include `acceptance_semantic_validation_failed_or_inconsistent`. If the model invocation fails, harness records `acceptance_semantic_validation_failed` and keeps the base acceptance result.

## Mini runner

Mini runner now lives in `agent` and is injected into harness through run-time options (`capabilityModelInvoker`).
When `planningGuidanceMode` is `separate_model`, the engine can inject the mini runner as the capability model invoker.

Mini-runner diagnostics are preserved when the invoker returns `traces`:

- Harness appends each capability-model trace envelope to `capability-traces.jsonl`.
- `harness-run.json.paths.capabilityTraces` points to that artifact.
- Tool-call records inside traces include status values such as `pending`, `executed`, `rejected`, and `not_found`.

Example config:

```json
{
  "plugins": {
    "harness": {
      "enabled": true,
      "planningGuidanceMode": "separate_model",
      "miniRunnerMaxTurns": 50,
      "miniRunnerToolAllowlist": ["read_context", "search_memory"]
    }
  }
}
```

### Tool takeover (hook-level)

Harness now supports **hook takeover directives** returned by capability handlers:

- Tool takeover: rewrite/intercept tool calls
- Message takeover: force-inject system message in middle lifecycle hooks
- Memory takeover: rewrite state-commit payload and trim in-memory history

Supported hook points:

- `before_tool_calls`: rewrite tool call queue (`ctx.calls`)
- `before_tool_call`: override single tool call (`ctx.call`)

Accepted return shapes (any one):

- `result.toolTakeover`
- `result.takeover.tool`
- `result.directives.toolTakeover`

Message takeover accepted return shapes (any one):

- `result.messageTakeover`
- `result.systemMessageTakeover`
- `result.takeover.message`
- `result.directives.messageTakeover`
- `result.directives.systemMessageTakeover`

Memory takeover accepted return shapes (any one):

- `result.memoryTakeover`
- `result.takeover.memory`
- `result.directives.memoryTakeover`

Directive fields:

- `enabled?: boolean` (default true when directive exists)
- `allowToolNames?: string[]` / `allowTools?: string[]`
- `denyToolNames?: string[]` / `denyTools?: string[]`
- `forceCall?: { name: string, args?: object, id?: string }`
- `overrideCall?: { name: string, args?: object, id?: string }`
- `mode?: "replace"` (`before_tool_calls` only; replace all calls with `forceCall`)
- `replace?: boolean` (`before_tool_calls` only; alias of `mode: "replace"`)
- `maxCalls?: number` (`before_tool_calls` only)
- `cancelAll?: boolean` (`before_tool_calls` only)

Message takeover directive fields:

- `enabled?: boolean` (default true when directive exists)
- `content?: string` / `text?: string` / `message?: string`
- `id?: string` (for idempotent marker `<!-- id -->`)
- `role?: string` (default `system`)
- `mode?: "prepend" | "append" | "replace"` (default `prepend`)
- `target?: "auto" | "ctx_messages" | "agent_system"` (default `auto`)
- `dedupe?: boolean` (default `true`)
- `cancelInternalForcedMessages?: boolean` (remove all agent internal forced messages with `noobotInternalMessageType`)
- `removeInternalMessageTypes?: string[]` (selective remove, e.g. `tool_choice_required_retry_prompt`)

Memory takeover directive fields:

- `enabled?: boolean` (default true when directive exists)
- `priority?: number` (higher value applied later, so higher priority wins)
- `priorityByCommitType?: Record<string, number>` (e.g. `assistant_message`)
- `allowCommitTypes?: string[]` / `blockCommitTypes?: string[]` (for `before_state_commit`)
- `overridePayload?: object` (shallow merge into `ctx.payload`)
- `stripPayloadKeys?: string[]` / `redactPayloadKeys?: string[]`
- `content?: string` / `replaceContent?: string` / `prependContent?: string` / `appendContent?: string`
- `clearToolCalls?: boolean`
- `clearAttachmentMetas?: boolean`
- `trimHistoryTo?: number` (trim `agentContext.payload.messages.history`)
- `clearHistory?: boolean`
- `memoryNote?: string` / `injectSystemNote?: string` (inject into system messages)

Conflict strategy:

- Multiple directives are sorted by `priority` ascending then registration order.
- Later-applied directive wins in overwrite scenarios.
- For memory + `before_state_commit`, `priorityByCommitType[commitType]` overrides generic `priority`.
- Profile-level defaults are also supported via:
  - `capabilityProfile.<capability>.priority`
  - `capabilityProfile.<capability>.takeoverPriority`
  - `capabilityProfile.<capability>.memoryTakeover.priority`
  - `capabilityProfile.<capability>.memoryTakeover.priorityByCommitType`

Example:

```js
registerNoobotPlugin({ hookManager }, {
  capabilityHandlers: {
    assistance: async ({ point }) => {
      if (point !== "before_tool_calls") return null;
      return {
        toolTakeover: {
          allowToolNames: ["wait"],
          forceCall: { name: "wait", args: { seconds: 1 } },
          mode: "replace",
        },
      };
    },
    supervision: async ({ point }) => {
      if (point !== "before_tool_calls") return null;
      return {
        systemMessageTakeover: {
          id: "harness-mid-hook-guard",
          content: "中途工具阶段触发：请先执行安全检查再继续。",
          target: "agent_system",
          mode: "prepend",
        },
      };
    },
    guidance: async ({ point }) => {
      if (point !== "before_llm_call") return null;
      return {
        messageTakeover: {
          removeInternalMessageTypes: ["tool_choice_required_retry_prompt"],
          id: "harness-replace-retry-prompt",
          content: "工具重试提示由 harness 接管。",
          target: "ctx_messages",
          mode: "prepend",
        },
      };
    },
    memory: async ({ point }) => {
      if (point !== "before_state_commit") return null;
      return {
        memoryTakeover: {
          allowCommitTypes: ["assistant_message"],
          stripPayloadKeys: ["rawModelContent"],
          prependContent: "[memory-guard] ",
        },
      };
    },
  },
});
```

## Output directory

Default output path:

```text
workspace/{userId}/runtime/harness/runs/{dialogProcessId}/
```

If `basePath` is provided, output path becomes:

```text
{basePath}/runtime/harness/runs/{dialogProcessId}/
```

## Output files

```text
harness-run.json       Run manifest: ids, status, timestamps, output paths, last event.
context-snapshot.json  Sanitized context summary after context build.
events.jsonl           Hook lifecycle event stream.
prompts.jsonl          Prompt/final-response guard injection records.
tool-calls.jsonl       Tool-call related hook events.
state-commits.jsonl    State-commit related hook events.
capability-traces.jsonl Separate-model mini-runner/capability traces, including tool-call status.
policy-checks.json     Reserved for policy check results.
```

JSONL files contain one JSON object per line, suitable for streaming and incremental inspection.

## Minimal example config

See:

```text
plugin/noobot-plugin-harness/examples/run-config.example.json
```

## Manual hookManager usage

Manual registration is still supported when running outside `SessionExecutionEngine.runSession()`.

```js
import { createHookManager } from "noobot-agent/hook";
import { registerNoobotPlugin } from "./plugin/noobot-plugin-harness/src/index.js";

const hookManager = createHookManager();

registerNoobotPlugin({ hookManager }, {
  basePath: "/path/to/workspace/user",
  promptPolicy: true,
  trace: true
});

runConfig.hookManager = hookManager;
```

## Validation

```bash
npm --prefix plugin/noobot-plugin-harness test
npm --prefix plugin/noobot-plugin-harness run check
```
