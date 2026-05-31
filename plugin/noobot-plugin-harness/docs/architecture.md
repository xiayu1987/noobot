# Harness Plugin Architecture

## Semantic layout

- `src/core/`
  - `plugin.js`: plugin factory + registration flow
  - `hooks.js`: hook point policy + hook registration
  - `context.js`: runtime/hook context resolution
  - `options.js`: option schema + normalization
  - `workflow-params.js`: single source of truth for workflow params (thresholds, enums, event names)
  - `thresholds.js`: shared thresholds and retry limits
  - `constants.js`: plugin metadata + hook constants
- `src/capabilities/`: capability profile, hook map, runtime dispatcher, handlers
- `src/fsm/`: state machine transitions + audit commits
- `src/takeover/`: capability directives takeover dispatcher
- `src/tracing/`: trace events, prompt injection, run trace sink
- `src/prompt/`: prompt marker and dedupe helper
- `src/store/`: manifest/jsonl buffered persistence
- `src/utils/`: run cleanup utilities
- `src/data/`: record builders/shared serialization helpers

## Public API

`src/index.js` is the only public entry, re-exporting core plugin APIs and takeover dispatcher.

## Planning/Guidance/Acceptance closed loop

Current summary-driven plan update pipeline:

1. `summary` (guidance)
2. `planning_revision` (main plan update)
3. `planning_refinement` (target main-step refinement; optional when converged)
4. `acceptance_semantic_validation`

### Main rules

- Revision updates **main steps only** (`isMainStep=true`, `mainStepIndex=index`).
- Refinement is bound to `targetMainSteps` and does not overwrite main plan.
- Each main step can be refined once, until a later revision changes/removes/adds that step.
- If no valid target main step remains, refinement converges and is skipped.
- Revision attempts are capped by `MAX_PLAN_REVISION_ATTEMPTS`.
- Refinement attempts are capped by `MAX_PLAN_REFINEMENT_ATTEMPTS`.

### Persistence model (harness bucket)

- `taskChecklist`: latest main plan checklist.
- `planRevisions[]`: ordered revision/refinement history with `stage` and `mainPlanVersion`.
- `planRefinementRecords[]`: refinement-only records, including `targetMainStepIndexes`.
- `mainPlanVersion/currentMainPlanVersion`: versioning for matching refinements to main plan.
- `state.planRefinementState.byMainStep`: per-main-step refinement consumed status.

### Acceptance input model

Acceptance semantic validation uses:

- `finalMainPlan`
- `refinementPlansForFinalMainPlan`

and composes final validation checklist from those two sources (instead of relying only on raw `bucket.taskChecklist`).
