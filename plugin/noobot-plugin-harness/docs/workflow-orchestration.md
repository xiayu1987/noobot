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
| Planning | At `before_llm_call`, threshold checks update pending states (`summary`/`planUpdate`/`phaseAcceptance`) | Fixed action `planning_bootstrap` (`planning_capture` at `after_llm_call`) | Runs by mode: `runPlanningBySeparateModel` or `maybeInjectPlanningPrompt`; capture by `maybeCapturePlanningResult` | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`planning`) |
| Guidance | Pending states come from failure thresholds and summary/plan-update signals | `resolveNextGuidanceAction` chooses: `summary_overflow > guidance > plan_update > summary_turns` | One execution path per mode (inject/separate-model), including plan-update and summary/guidance chaining | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`guidance`) |
| Acceptance | Multi-hook triggers from `pending.phaseAcceptance`, `pending.acceptanceSemanticValidation`, and overflow flags | `resolveAcceptanceDecision` picks `phase_acceptance` / `forced_acceptance` / `acceptance_semantic_validation` etc. | Executes phase acceptance, semantic validation, final-output guard, and tool guards by hook and mode | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`acceptance`) |
| Review | Triggered on review hooks (`before_final_output`, `on_error`, `on_abort`, etc.) | Fixed action `review_report` | Builds report and conditionally attaches it to final output | Unified `workflow_priority_decision` + `workflow_execution_result` (domain=`review`) |

Standard events (all four domains):

- `workflow_priority_decision`
- `workflow_execution_result`

## Concurrent Trigger Priority

Current guidance scheduler decision order (`before_llm_call`):

1. `summary_overflow`
   Trigger condition: `pending.summary === true && flags.summaryByCharsPrompted === true`
2. `guidance`
   Trigger condition: `pending.guidance != null`
3. `plan_update_revision` / `plan_update_refinement`
   Trigger condition: `pending.planUpdate === true` (or legacy `pending.planRevision === true`)
4. `summary_turns`
   Trigger condition: `pending.summary === true && flags.summaryByCharsPrompted !== true`
5. `none`

`phase_acceptance` is not selected by guidance scheduler, but is included in decision snapshots as a blocked lower-priority pending flow when applicable.

## Decision Log Event

Event: `workflow_priority_decision`  
Domain: `guidance`  
Hook point: `before_llm_call`

Log detail fields:

- `mode`: `inject` or `separate_model`
- `chosenAction`: `summary_overflow` | `guidance` | `plan_update_revision` | `plan_update_refinement` | `summary_turns` | `none`
- `chosenReason`: scheduler reason code
- `chosenStage`: `revision` | `refinement` | `""`
- `blockedActions`: pending flows blocked by current selected action
- `pending`: snapshot
  - `summary`
  - `summaryByCharsPrompted`
  - `guidance`
  - `planUpdate`
  - `phaseAcceptance`

Execution result fields (`workflow_execution_result`):

- `mode`: `inject` or `separate_model`
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

## Trigger Timing And Thresholds

Parameter source of truth: `src/core/workflow-params.js` (`WORKFLOW_PARAMS`), including
thresholds, tool names, scheduler order, workflow action/reason/event enums, and
capability log event names (`logging.events.*`).

### Planning

- Hook point: `before_llm_call`
- Summary trigger:
  - Turn-based: `state.counters.llmTurns > LLM_SUMMARY_THRESHOLD` (`8`)
  - Char-based: `unsummarized_chars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD` (`150000`)
- Overflow prune policy (`SUMMARY_POLICY.OVERFLOW_POLICY`):
  - `ENABLE_PRUNE_AFTER_SUMMARY`
  - `PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS`
  - `FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW`
- Plan update trigger:
  - `state.counters.planUpdateTurns >= PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD` (`10`)
- Phase acceptance scheduling threshold:
  - `state.counters.phaseAcceptanceTurns >= PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD` (`10`)

### Guidance (tool-failure recovery)

- Hook points:
  - `after_tool_call`
  - `tool_call_error`
  - `before_llm_call`
- Failure thresholds (`FAILURE_THRESHOLD`):
  - Consecutive failures: `CONSECUTIVE = 3`
  - Accumulated failures: `ACCUMULATED = 10`
- When threshold hit, set `pending.guidance` and guidance flow is eligible at next `before_llm_call`.

### Plan Update (revision/refinement)

- Scheduled when planning threshold is reached (`planUpdateTurns >= 10`) or when summary completion triggers update chaining.
- Shared retry budget:
  - `PLAN_UPDATE_POLICY.MAX_ATTEMPTS = 5`
  - Shared between `revision` and `refinement`.

### Acceptance

- Phase acceptance can be scheduled in planning flow when threshold reached and higher-priority pendings are clear.
- Semantic acceptance validation is triggered by acceptance flow (active or forced), depending on mode and options.

## Message Order By Flow

Notation: `existing_context` is the current main-model context; `agent_messages` is the output of `resolveCapabilityModelMessages(...)`.

| Flow | Inject-mode message order | Separate-model message order | Key functions |
| --- | --- | --- | --- |
| Planning bootstrap | `existing_context -> planning context summary(system) -> available tools+allowlist(system) -> planning request(user)` | `agent_messages -> planning context summary(constraint) -> available tools+allowlist(constraint) -> planning request(task)` | `maybeInjectPlanningPrompt` / `buildPlanningMessagesForSeparateModel` |
| Summary | `existing_context -> plan checklist context(system, optional) -> summary request(user)` | `agent_messages -> plan checklist context(extra messages) -> summary request(task)` | `maybeInjectGuidanceOrSummaryPrompt` / `runGuidanceBySeparateModel(purpose=summary)` |
| Guidance (failure analysis) | `guidance failure prompt(system, prepend) -> existing_context` | `agent_messages -> guidance failure prompt(task)` | `maybeInjectGuidanceOrSummaryPrompt` / `runGuidanceBySeparateModel(purpose=guidance)` |
| Plan update | `existing_context -> plan checklist context(system, optional) -> revision/refinement request(user)` | `Revision: agent_messages -> plan checklist context(extra) -> revision request(task); Refinement: agent_messages -> refinement request(task)` | `maybeInjectPlanUpdatePrompt` / `runPendingPlanUpdateBySeparateModel` / `runPlanUpdateAfterSummary` |
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
- Priority scheduler: `src/capabilities/handlers/guidance/plan-update-scheduler.js`
- Priority decision log emit: `src/capabilities/handlers/guidance/controller.js`
- Planning inject/separate message builders:
  - `src/capabilities/handlers/planning/prompt-builder.js`
  - `src/capabilities/handlers/planning/capture-runner.js`
- Guidance and plan-update model calls:
  - `src/capabilities/handlers/guidance/prompt-injector.js`
  - `src/capabilities/handlers/guidance/model-runner.js`
  - `src/capabilities/handlers/guidance/revision-injector.js`
- Acceptance message composition:
  - `src/capabilities/handlers/acceptance/validation-runner.js`
- Threshold constants:
  - `src/core/thresholds.js`

## Handler Export Convention (Facade + Semantic Subdirectories)

To keep a single stable API surface while preserving semantic internals:

| Layer | Purpose | Files |
| --- | --- | --- |
| Facade (stable imports) | Public entry for runtime and external imports | `src/capabilities/handlers/{planning,guidance,acceptance,review}.js` |
| Domain index (semantic entry) | Domain-local export aggregation | `src/capabilities/handlers/{planning,guidance,acceptance,review}/index.js` |
| Domain implementation | Controller/deps/builders/runners | `src/capabilities/handlers/<domain>/*.js` |
| Shared facade | Backward-compatible shared exports | `src/capabilities/handlers/shared.js` |
| Shared semantic index | Canonical shared export map | `src/capabilities/handlers/shared/index.js` |
