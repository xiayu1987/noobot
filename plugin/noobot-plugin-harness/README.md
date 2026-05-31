# noobot-plugin-harness

Hook-based Harness Engineering plugin for Noobot.

Workflow orchestration reference:

- `docs/workflow-orchestration.md` (English: concurrent trigger priority, threshold triggers, model message order)
- `docs/workflow-orchestration.zh-CN.md` (中文：并发触发优先级、触发阈值、模型消息顺序)
- `docs/architecture.md` (module-level architecture)

Current architecture split:
- `src/data/record-builders.js`: trace/snapshot/prompt record generation
- `src/core/`: plugin composition (`plugin.js`), hook wiring (`hooks.js`), runtime context (`context.js`), options/constants/thresholds
- `src/core/workflow-params.js`: single parameter center for workflow orchestration (planning/guidance/acceptance)
  - canonical shape: `WORKFLOW_PARAMS.{workflow,planning,guidance,acceptance}.*`
  - capability log event names are centralized at `WORKFLOW_PARAMS.logging.events.*`
- `src/capabilities/profile.js`: capability contract profile (planning/guidance/assistance/memory/synthesis/supervision/review)
- `src/capabilities/hook-map.js`: capability to lifecycle hook mapping
- `src/capabilities/handlers/index.js`: capability handler skeleton (default noop planned handlers)
- `src/capabilities/runtime.js`: capability runtime dispatcher (runs mapped handlers on hook points)
- `src/capabilities/handlers/shared/`: semantic subfolders by concern
  - `workflow/`, `model/`, `message/`, `plan/`, `runtime/`
- `src/prompt/`: prompt injection helpers
- `src/store/`: manifest/jsonl buffered persistence
- `src/utils/`: cleanup helpers
- `src/index.js`: public entry and exports

Handler export convention (Facade + semantic subdirectories):

| Layer | Purpose | Files |
| --- | --- | --- |
| Facade (stable import) | External/runtime stable entry | `src/capabilities/handlers/{planning,guidance,acceptance,review}.js` |
| Domain semantic entry | Domain-local export aggregation | `src/capabilities/handlers/{planning,guidance,acceptance,review}/index.js` |
| Domain implementation | Controller/deps/prompt/runner details | `src/capabilities/handlers/<domain>/*.js` |
| Shared facade | Backward-compatible shared aggregate export | `src/capabilities/handlers/shared.js` |
| Shared semantic entry | Canonical shared export map | `src/capabilities/handlers/shared/index.js` |

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
        enabled: true,
        mode: "on"
      }
    }
  }
});
```

## Enable from globalConfig

Harness can be enabled globally, then overridden by per-run config.

```json
{
  "plugins": {
    "harness": {
      "enabled": true,
      "mode": "on",
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
      mode: "off"
    }
  }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Global plugin switch. Must be `true` for harness to run. |
| `mode` | `off` | Runtime mode: `on` enables harness for the run; `off` keeps it inactive. |
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
| `stepModels` / `capabilityModelByPurpose` | `{}` | Per harness flow model alias. Values can be strings or `{ "model": "alias" }`. Recommended big-flow keys: `planning`, `guidance`, `acceptance`, `default`. Detailed purpose keys such as `planning_json_repair`, `summary`, `planning_revision`, `acceptance_semantic_validation` are still accepted when a fine-grained override is needed. |
| `capabilityToolAllowlist` | `[]` | Tool allowlist passed from harness to capability invoker (all purposes). Empty means no tools. |
| `capabilityToolAllowlistByPurpose` | `{}` | Per-purpose allowlist override, e.g. `planning`, `guidance`, `summary`, `acceptance_semantic_validation`. |
| `acceptance.semanticValidation` | `true` | Enables semantic task-acceptance validation through `capabilityModelInvoker`. The rule-based acceptance report is still generated first; model failures are logged and do not block the main flow. |
| `miniRunnerMaxTurns` | `50` | Hint option for agent-side mini-runner injector (when `planningGuidanceMode=separate_model`). |
| `miniRunnerToolAllowlist` | `[]` | Fallback allowlist used by the injected mini-runner when harness does not pass a per-call allowlist. Empty means no tools. |

## Model invocation flow

Harness itself only calls a model through `capabilityModelInvoker` when a capability is in `separate_model` mode or when a feature explicitly enables semantic validation. The selected model alias is resolved from `stepModels` / `capabilityModelByPurpose` and is passed to the invoker as `payload.model`.

| Purpose / step | When it calls a model | Model key | Fallback behavior |
| --- | --- | --- | --- |
| Planning bootstrap | At `before_llm_call`, when `planningGuidanceMode=separate_model`, the current run has not captured a checklist yet, and a `capabilityModelInvoker` is available. | `planning` | If no invoker is available, separate-model planning is skipped; plugin-runtime normalization may fall back to `inject`. |
| Planning JSON repair | After planning output is received, only when local parsing fails and the output looks like JSON. | `planning` by default; optional detail override `planning_json_repair` | If repair fails or returns unusable content, Harness applies the built-in default checklist; it does not call another synthesis model. |
| Summary | When guidance detects the LLM turn counter exceeded the summary threshold and schedules a summary in `separate_model` mode. | `guidance` by default; optional detail override `summary` | If the model call fails, Harness keeps running without blocking the main flow. |
| Planning revision | When planning turn-threshold schedules a plan update, Harness asks for a revised **main plan** in `separate_model` mode. | `planning` by default; optional detail override `planning_revision` | If no invoker is available, Harness schedules an injected planning-revision prompt instead. |
| Planning refinement | After revision succeeds, Harness asks for refinement under selected **target main step(s)**. | `planning` by default; optional detail override `planning_refinement` | If no valid target main step remains, refinement is considered converged and skipped. |
| Guidance | When tool failure thresholds are reached and `planningGuidanceMode=separate_model`. | `guidance` | If the model call fails, Harness logs the failure and continues. |
| Acceptance semantic validation | During forced final acceptance or active `request_task_acceptance`, only when `acceptance.semanticValidation=true`. | `acceptance` by default; optional detail override `acceptance_semantic_validation` | If validation fails to run, base rule-based acceptance remains authoritative and the main flow continues. |

These steps do **not** call a separate Harness model by themselves:

- `promptPolicy`: injects a system prompt into the main agent call.
- `finalResponseGuard`: injects final-output instructions.
- Base acceptance: rule-based checklist validation.
- Review: rule-based report generation.
- Planning fallback default checklist: local built-in checklist, no model call.

When `planningGuidanceMode=inject`, planning/guidance prompts are injected into the **main agent model** instead of calling `capabilityModelInvoker`; in that mode `stepModels` does not select a separate Harness model for those injected prompts.

## Plan revision/refinement lifecycle (latest)

Harness now uses a two-stage plan update pipeline when plan update is triggered:

1. **Revision first** (`planning_revision`): update the main plan only (main steps).
2. **Refinement second** (`planning_refinement`): refine only under selected target main step(s).

This order is the same in both `separate_model` and `inject` modes.

### Main plan vs refinement plan

- **Main plan**: authoritative checklist for top-level steps.
- **Refinement plan**: step-level refinements tied to specific main steps.

Revision writes main plan; refinement does **not** overwrite main plan.

### Refinement targeting and convergence

- Harness computes `targetMainSteps` from unrefined main steps (prefers `nextPhase.checklistIndexes`).
- One main step can be refined at most once until a later revision changes/removes/adds that step.
- If no target main step exists, refinement is skipped as converged (`planning_refinement_converged_no_target_main_step`).

### Hard validation for refinement output

Refinement output is accepted only when items:

- have `mainStepIndex`
- belong to current `targetMainSteps`
- are not main steps themselves (`isMainStep !== true`)

Otherwise refinement is rejected (`planning_refinement_rejected_invalid_target_main_step`).

### Retry/limits

- Revision attempts are capped by `MAX_PLAN_REVISION_ATTEMPTS` (default `10`).
- Refinement attempts are capped by `MAX_PLAN_REFINEMENT_ATTEMPTS` (default `10`).
- On each successful revision, changed/new main steps reset refinement eligibility.

### Acceptance payload semantics

Semantic acceptance validation now emphasizes:

- `finalMainPlan` (latest revised main plan)
- `refinementPlansForFinalMainPlan` (only refinements belonging to the same `mainPlanVersion`)

Validation checklists (`taskChecklist`/`finalPlanChecklist`) are composed from:

- `finalMainPlan.taskChecklist`
- plus refinement items from `refinementPlansForFinalMainPlan`

## Acceptance semantic validation

By default, acceptance includes semantic validation (when `capabilityModelInvoker` is available) in addition to rule-based checks. To explicitly configure it:

```json
{
  "plugins": {
    "harness": {
      "enabled": true,
      "mode": "on",
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
When `stepModels` is set, the injected mini runner uses the configured provider alias/model name for each purpose; custom `capabilityModelInvoker` implementations receive the same value as `payload.model`.

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
      "mode": "on",
      "planningGuidanceMode": "separate_model",
      "stepModels": {
        "planning": "qwen3_6_plus",
        "guidance": "qwen3_6_plus",
        "acceptance": "qwen3_6_plus",
        "default": "qwen3_6_plus"
      },
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
import { createAgentHookManager } from "noobot-agent/hook";
import { registerNoobotPlugin } from "./plugin/noobot-plugin-harness/src/index.js";

const hookManager = createAgentHookManager();

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
