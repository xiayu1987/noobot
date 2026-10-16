# Harness Plugin Architecture

## Semantic layout

- `src/core/`
  - `plugin.js`: plugin factory + registration flow
  - `hooks.js`: hook point policy + hook registration
  - `context.js`: runtime/hook context resolution
  - `options.js`: option schema + normalization
  - `workflow-params.js`: single source of truth for workflow params (thresholds, enums, event names)
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
- Revision attempts are capped by `WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts`.
- Refinement attempts are capped by `WORKFLOW_PARAMS.planning.planUpdate.refinementMaxAttempts`.

### Persistence model (harness bucket)

- `planText`: the single source of the current plan (main steps and sub steps).
- `planRevisions[]`: ordered revision/refinement history with `stage` and `mainPlanVersion`.
- `planRefinementRecords[]`: refinement-only records, including `targetMainStepIndexes`.
- `mainPlanVersion/currentMainPlanVersion`: versioning for matching refinements to main plan.
- `state.planRefinementState.byMainStep`: per-main-step refinement consumed status.

### Acceptance input model

Acceptance semantic validation reads the plan only from `bucket.planText` and parses the checklist from it. The bucket stores no separate checklist; v5 migration removes the legacy `taskChecklist`/`taskChecklistSource` fields. Acceptance reports keep `planText` and `finalPlanChecklist` as their only plan and checklist fields; v6 migration removes the duplicated `taskChecklist` and `plan.planText` from persisted acceptance reports, including those embedded in review reports.

Checklist items carry only `index` (string plan id), `mainStepIndex`, `isMainStep` and `task`; v7 migration removes the unread `owner`, `subOwners`, `input`, `output` and `files` fields from persisted report items. Numeric `index` values in reports persisted before v7 are left as is: the original id (`1.1` vs `1.10`) cannot be recovered from the number, and new reports are rebuilt from `bucket.planText`.

`bucket.planText` is the only persisted plan fact. The parsed plan document is derived on demand and never stored; v8 migration removes the legacy `bucket.planDocument` cache, and checklist context renders only the explicit `planText` passed by the caller. Plan mutation runs one stage-specific patch per call: an invalid main-plan patch is rejected as `revision_not_applied` instead of falling back to full-table replacement.
