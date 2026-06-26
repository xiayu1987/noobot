# Harness Workflow Orchestration

Chinese version: `docs/workflow-orchestration.zh-CN.md`

This document describes:

1. Concurrent-trigger priority rules.
2. Trigger timing and thresholds for each flow.
3. Message order passed to model (or injected to main model) for each flow.
4. Unified workflow pattern.

## Unified Workflow Pattern

Planning, guidance, acceptance, and review follow the matrix below:

| Flow | Trigger | Arbitrate | Execute | Observe |
| --- | --- | --- | --- | --- |
| Planning | At `before_llm_call`, run planning tick: threshold checks update pending states (`planUpdate`/`phaseAcceptance`) | Fixed action `planning_bootstrap` (`planning_capture` at `after_llm_call`) | Runs by mode: `runPlanningBySeparateModel` or `maybeInjectPlanningPrompt`; capture by `maybeCapturePlanningResult` | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`planning`) |
| Guidance | Owns analysis and summary triggers, plus failure thresholds and plan-update execution signals | `resolveNextGuidanceAction` consumes the unified scheduler order for guidance-owned actions: `guidance > plan_update > analysis > summary_overflow > summary_turns`; summary defers when phase acceptance is ready so the stable context prefix remains provider-cache friendly | One execution path per mode (inject/separate-model), including analysis, plan-update, summary/guidance chaining, and summary capture | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`guidance`) |
| Acceptance | Multi-hook triggers from `pending.phaseAcceptance`, `pending.acceptanceSemanticValidation`, and overflow flags | `resolveAcceptanceDecision` picks `phase_acceptance` / `forced_acceptance` / `acceptance_semantic_validation` etc. | Executes phase acceptance, semantic validation, final-output guard, and tool guards by hook and mode | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`acceptance`) |
| Review | Triggered on review hooks (`before_final_output`, `on_error`, `on_abort`, etc.) | Fixed action `review_report` | Builds report and conditionally attaches it to final output | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`review`) |

Additional constraints:

- `Trigger` only detects conditions and updates pending state; it should not directly execute actions in another domain.
- `Arbitrate` only selects the primary action for this turn.
- `Execute` should be driven by `Arbitrate.chosenAction`; avoid re-arbitration inside execution.
- `Observe` records what was chosen, what actually ran, and why some actions were deferred/blocked.

Standard events (all four domains):

- `workflow_priority_decision`
- `workflow_execution_result`

## Concurrent Trigger Priority

Unified scheduler order (`before_llm_call`) follows this semantic priority:

`hard guard > failure recovery > planning structure > main-flow acceptance > auxiliary diagnosis > context compression > validation`

The concrete order is:

1. `forced_acceptance`
   Trigger condition: `flags.overflowForceAcceptancePending === true`
2. `guidance`
   Trigger condition: `pending.guidance != null`
3. `planning_bootstrap`
   Trigger condition: `flags.planningCaptured !== true && flags.planningPromptInjected !== true`
4. `plan_update_revision`
   Trigger condition: `pending.planRevision === true`
5. `plan_update_refinement`
   Trigger condition: `pending.planRefinement === true`
6. `phase_acceptance`
   Trigger condition: `pending.phaseAcceptance === true`
7. `analysis`
   Trigger condition: `pending.analysis === true`
8. `summary_overflow`
   Trigger condition: `pending.summary === true && flags.summaryByCharsPrompted === true`
9. `summary_turns`
   Trigger condition: `pending.summary === true && flags.summaryByCharsPrompted !== true`
10. `acceptance_semantic_validation`
    Trigger condition: `pending.acceptanceSemanticValidation != null`

`phase_acceptance` can block lower-priority validation and can make summary defer in selected cases so the stable context prefix remains provider-cache friendly. True hard overflow uses the `overflowForceAcceptancePending` forced-acceptance override.


## Scheduler Architecture And Failure Isolation

Ordering decisions live in `src/capabilities/handlers/shared/workflow/scheduler.js`. The complete order is described by one config item, `WORKFLOW_PARAMS.workflow.scheduler.order` (flow / subflow / action / executor / kind), and the scheduler derives executors and sorting from it with these layers:

- Strategy: `WORKFLOW_PARAMS.workflow.scheduler.order` defines semantic business priority; lower index wins when actions are simultaneously pending.
- Chain of Responsibility: `resolveBlockReason(...)` applies blockers one by one (for example, summary defers when phase acceptance is eligible).
- Command routing: `WORKFLOW_ACTION_EXECUTOR` maps each action to an executor domain (planning/guidance/acceptance).

Rules:

1. The scheduler only returns `chosenAction / deferredActions / blockedActions / blockedReasons`; it does not mutate state or execute actions.
2. Handler execution must follow `chosenAction` exactly and must not let another pending action preempt inside the executor.
3. The capability runtime is fail-open per flow: if one flow throws, it records `capability_flow_failed` and continues running later flows on the same hook.

## Decision Log Event

Event: `workflow_priority_decision`  
Domain: `guidance`  
Hook point: `before_llm_call`

Log detail fields:

- `mode`: `inject` or `separate_model`
- `category`: `workflow` | `guard` (semantic grouping; especially useful for acceptance flow)
- `chosenAction`: `forced_acceptance` | `guidance` | `planning_bootstrap` | `plan_update_revision` | `plan_update_refinement` | `phase_acceptance` | `analysis` | `summary_overflow` | `summary_turns` | `acceptance_semantic_validation` | `none`
- `chosenReason`: scheduler reason code
- `chosenStage`: `revision` | `refinement` | `""`
- `candidateActions`: all candidate actions scanned in this turn
- `deferredActions`: actions not executed this turn and deferred
- `blockedActions`: actions blocked by explicit blockers
- `blockedReasons`: blocker reason code list
- `triggeredActions`: legacy field kept for compatibility (mapped from candidate actions)
- `pending`: snapshot
  - `summary`
  - `guidance`
  - `analysis`
  - `planUpdate`
  - `phaseAcceptance`
  - `acceptanceSemanticValidation`
  - `flags.summaryByCharsPrompted`

Execution result fields (`workflow_execution_result`):

- `mode`: `inject` or `separate_model`
- `category`
- `chosenAction`
- `chosenReason`
- `requestedAction`
- `executedPrimary`
- `executedFollowup`
- `changed`
- `durationMs`
- `retryCount`
- `errorCode`

Notes:
- `retryCount` is derived from newly appended `capability_reasoning_retry_scheduled` events in the same execution window.
- `errorCode` is derived from the first newly appended `*_failed` / `*_error` event name (uppercased).

Compatibility note:
- During migration, writers may keep both legacy `triggeredActions` and new `candidateActions/deferredActions/blockedReasons`.

## Trigger Timing And Thresholds

Parameter source of truth: `src/core/workflow-params.js` (`WORKFLOW_PARAMS`), including
thresholds, tool names, scheduler order, workflow action/reason/event enums, and
capability log event names (`logging.events.*`).

Unified observation/lifecycle entry:

- `src/capabilities/handlers/shared/workflow/pattern.js`
  - `runWorkflowLifecycle(...)`: standardized `priority_decision -> execute -> execution_result`
  - `captureWorkflowLogCursor(...)` + `resolveWorkflowExecutionMetrics(...)`: shared `retryCount/errorCode` metrics

### Planning

- Hook point: `before_llm_call`
- Plan update trigger:
  - `state.counters.planUpdateTurns >= PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD` (mode-specific via `WORKFLOW_PARAMS.modeThresholds.<full|programming|text>.planning.planUpdate`)
- Phase acceptance scheduling threshold:
  - `state.counters.phaseAcceptanceTurns >= PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD` (mode-specific via `WORKFLOW_PARAMS.modeThresholds.<full|programming|text>.acceptance.phase`)

### Guidance (analysis, summary, and tool-failure recovery)

- Hook points:
  - `before_llm_call`
  - `after_llm_call`
  - `after_tool_calls`
  - `after_tool_call`
  - `tool_call_error`
- Summary trigger:
  - Turn-based: `state.counters.summaryTurns > LLM_SUMMARY_THRESHOLD` (`8`)
  - Char-based: `unsummarized_chars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD` (`200000`)
  - Tool-burst: `after_tool_calls` when enabled and call count reaches the summary threshold
- Overflow prune policy (`SUMMARY_POLICY.OVERFLOW_POLICY`):
  - `ENABLE_PRUNE_AFTER_SUMMARY`
  - `PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS`
  - `FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW`
- Analysis trigger:
  - `state.counters.analysisTurns >= ANALYSIS_TRIGGER_TURNS_THRESHOLD`
- Failure thresholds (`FAILURE_THRESHOLD`):
  - Consecutive failures: `CONSECUTIVE = 3`
  - Accumulated failures: `ACCUMULATED = 10`
- When threshold hit, set `pending.guidance` and guidance flow is eligible at next `before_llm_call`.
- `requestedAction` naming now follows `action + mode`, for example:
  - `summary_inject` / `summary_separate_model`
  - `guidance_inject` / `guidance_separate_model`
  - `plan_update_revision_inject` / `plan_update_refinement_separate_model`
  - `phase_acceptance_inject` / `phase_acceptance_separate_model`
  - `forced_acceptance_before_tool_calls_rewrite`

### Message Intermediate Representation (Message Plan)

Planning inject and separate-model paths now share an intermediate message plan:

- Shape: `[{ kind, injectRole, separateRole, content }]`
- Rendering:
  - Inject: `renderMessagePlanForInject(plan)`
  - Separate-model: `renderMessagePlanForSeparateModel({ agentMessages, plan })`
- Implementation:
  - `src/capabilities/handlers/shared/model/message-plan.js`

### Plan Update (revision/refinement)

- Scheduled when planning threshold is reached (`planUpdateTurns >= 10`).
- Independent retry budgets:
  - `PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION = 10`
  - `PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REFINEMENT = 10`

### Acceptance

- Phase acceptance can be scheduled in planning flow when threshold reached; it is blocked by guidance / plan update / missing planning capture, but not by ordinary summary pending so stable provider prefix-cache context is preserved.
- Semantic acceptance validation is triggered by acceptance flow (active or forced), depending on mode and options.

## Responsibility Matrix (Unified Semantics)

| Action | Trigger owner (sets pending) | Executor | Primary hooks |
| --- | --- | --- | --- |
| `planning_bootstrap` | Planning | Planning | `before_llm_call` |
| `planning_capture` | Planning | Planning | `after_llm_call` |
| `summary` | Guidance (thresholds) | Guidance | `before_llm_call` / `after_llm_call` / `after_tool_calls` |
| `guidance` | Guidance (failure thresholds) | Guidance | `before_llm_call` |
| `plan_update_revision/refinement` | Planning (thresholds) | Guidance | `before_llm_call` / `after_llm_call` |
| `phase_acceptance` | Planning (thresholds) | Acceptance | `before_llm_call` |
| `acceptance_semantic_validation` | Acceptance | Acceptance | `before_llm_call` / `after_llm_call` |
| `review_report` | Review | Review | `before_final_output` / `on_error` / `on_abort` |

Notes:
- Planning also acts as workflow tick in `before_llm_call`; actual action execution stays in each domain controller.

## Unified Pending Snapshot

`workflow_priority_decision.pending` should use a consistent object shape (fields can be trimmed by domain):

```json
{
  "summary": { "active": false, "reason": "" },
  "guidance": { "active": false, "payload": null },
  "planUpdate": { "active": false, "stage": "", "context": {} },
  "phaseAcceptance": { "active": false, "blockedBy": [] },
  "acceptanceSemanticValidation": { "active": false },
  "flags": {
    "planningCaptured": false,
    "summaryByCharsPrompted": false,
    "overflowForceAcceptancePending": false
  }
}
```

Benefits:

- Avoid `boolean`/`object` mixed representations across domains (especially `planUpdate`).
- Make `blockedActions`/`blockedReasons` directly explainable from snapshot fields.
- Improve cross-domain debugging with stable log shape.

## Decision-Driven Execution

To keep logs explainable and deterministic:

1. `resolveDecision` returns one primary `chosenAction` (plus deferred/blocked metadata).
2. `execute(decision)` runs only the primary path for `chosenAction`.
3. Optional follow-up work must be logged as `executedFollowup` with an explicit reason.

Pseudo code:

```js
const decision = resolveDecision();
switch (decision.chosenAction) {
  case "forced_acceptance":
    runForcedAcceptance();
    break;
  case "phase_acceptance":
    runPhaseAcceptance();
    break;
  default:
    break;
}
```

## Lifecycle Error Observability

`runWorkflowLifecycle(...)` should guarantee `workflow_execution_result` is emitted even on execution errors:

- Emit `priority_decision` before execution.
- Wrap `execute` in `try/catch/finally`.
- Emit `workflow_execution_result` in `finally` with `errorCode` and `durationMs`.

## Message Order By Flow

Notation: `existing_context` is the current main-model context; `agent_messages` is the output of `resolveCapabilityModelMessages(...)`.

| Flow | Inject-mode message order | Separate-model message order | Key functions |
| --- | --- | --- | --- |
| Planning bootstrap | `existing_context -> planning context summary(system) -> available tools+allowlist(system) -> planning request(user)` | `agent_messages -> planning context summary(constraint) -> available tools+allowlist(constraint) -> planning request(task)` | `maybeInjectPlanningPrompt` / `buildPlanningMessagesForSeparateModel` |
| Summary | `existing_context -> plan checklist context(system, optional) -> summary request(user)` | `agent_messages -> plan checklist context(extra messages) -> summary request(task)` | `maybeInjectGuidanceOrSummaryPrompt` / `runGuidanceBySeparateModel(purpose=summary)` |
| Guidance (failure analysis) | `guidance failure prompt(system, prepend) -> existing_context` | `agent_messages -> guidance failure prompt(task)` | `maybeInjectGuidanceOrSummaryPrompt` / `runGuidanceBySeparateModel(purpose=guidance)` |
| Plan update | `existing_context -> plan checklist context(system, optional) -> revision/refinement request(user)` | `Revision: agent_messages -> plan checklist context(extra) -> revision request(task); Refinement: agent_messages -> refinement request(task)` | `maybeInjectPlanUpdatePrompt` / `runPendingPlanUpdateBySeparateModel` |
| Phase acceptance | `existing_context -> summary reports(system, N) -> main plan context(system) -> phase acceptance history(system, N) -> phase acceptance request(user)` | `agent_messages -> summary reports(system, N) -> main plan context(system) -> phase acceptance history(system, N) -> phase acceptance request(user)` | `maybeInjectPhaseAcceptancePrompt` / `runPhaseAcceptanceBySeparateModel` |
| Acceptance semantic validation | `existing_context -> main plan context(system) -> phase acceptance history(system, N) -> semantic validation request(user)` | `main plan context(system) -> phase acceptance history(system, N) -> semantic validation request(user)` | `maybeInjectAcceptanceSemanticValidationPrompt` / `runAcceptanceBySeparateModel` |

## Source Files

- Unified workflow parameter center:
  - `src/core/workflow-params.js`
- Standard workflow log helpers:
  - `src/capabilities/handlers/shared/workflow/pattern.js`
- Centralized workflow policy:
  - `src/capabilities/handlers/shared/workflow/policy.js`
- Invariant guards:
  - `src/capabilities/handlers/shared/workflow/invariants.js`
- Unified priority scheduler:
  - `src/capabilities/handlers/shared/workflow/scheduler.js`
- Guidance scheduler adapter:
  - `src/capabilities/handlers/planning/plan-update-scheduler.js`
- Priority decision log emit:
  - `src/capabilities/handlers/shared/workflow/pattern.js`
  - domain controllers (`planning/controller.js`, `guidance/controller.js`, `acceptance/controller.js`, `review/controller.js`)
- Planning inject/separate message builders:
  - `src/capabilities/handlers/planning/prompt-builder.js`
  - `src/capabilities/handlers/planning/capture-runner.js`
- Guidance and plan-update model calls:
  - `src/capabilities/handlers/guidance/prompt-injector.js`
  - `src/capabilities/handlers/guidance/model-runner.js`
  - `src/capabilities/handlers/guidance/revision-injector.js`
- Acceptance message composition:
  - `src/capabilities/handlers/acceptance/validation-runner.js`
- Domain lifecycle entries (wired to `runWorkflowLifecycle`):
  - `src/capabilities/handlers/planning/controller.js`
  - `src/capabilities/handlers/guidance/controller.js`
  - `src/capabilities/handlers/acceptance/controller.js`
  - `src/capabilities/handlers/review/controller.js`
- Review trigger implementation:
  - `src/capabilities/handlers/review/controller.js`
- Threshold and policy source:
  - `src/core/workflow-params.js`

## Review Hook Allowlist

Review hook filtering should be explicit in controller and centralized in `WORKFLOW_PARAMS.review.hooks`:

- `before_final_output`
- `on_error`
- `on_abort`

## Handler Export Convention (Facade + Semantic Subdirectories)

To keep a single stable API surface while preserving semantic internals:

| Layer | Purpose | Files |
| --- | --- | --- |
| Facade (stable imports) | Public entry for runtime and external imports | `src/capabilities/handlers/{planning,guidance,acceptance,review}.js` |
| Domain index (semantic entry) | Domain-local export aggregation | `src/capabilities/handlers/{planning,guidance,acceptance,review}/index.js` |
| Domain implementation | Controller/deps/builders/runners | `src/capabilities/handlers/<domain>/*.js` |
| Shared facade | Backward-compatible shared exports | `src/capabilities/handlers/shared.js` |
| Shared semantic index | Canonical shared export map | `src/capabilities/handlers/shared/index.js` |
