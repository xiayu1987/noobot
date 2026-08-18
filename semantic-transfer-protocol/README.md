# @noobot/semantic-transfer-protocol

Canonical protocol for semantic information transfer. This package owns only the V2 wire contract, canonical attachment references, strict validation, and pure direct/attachment policy decisions.

It has no filesystem, runtime, session repository, path resolver, or business-scenario dependency. Hosts materialize content through their attachment service and pass only the canonical attachment identity into the envelope.

## Invariants

- V2 is the only supported envelope version.
- `payload.mode` is `direct`, `attachment`, or `source_reference`; the payload forms are mutually exclusive.
- Attachment references contain an attachment-protocol identity and never a path.
- Invalid envelopes are rejected; they are not filtered, normalized from legacy shapes, or silently downgraded.
- A transfer is bound to stable `transferId`, `messageId`, and producer identity. `sessionId` is mandatory; execution-scoped transfers also carry `turnScopeId` and `runId`.

## Registered Scenarios

Only registered scenario/strategy pairs may create an envelope. Business points are
registered under the scenario category and are validated when supplied in `intent`.

Strategy definitions live in `src/strategies/`; tool input and output policies live
in `src/policies/`. `src/registry.js` only owns registration and validation.

| Scenario   | Category     | Strategy              | Business points                                                                                                                                                                                                                                               |
| ---------- | ------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness`  | `summary`    | `harness_summary`     | `summary_detail`                                                                                                                                                                                                                                              |
| `harness`  | `planning`   | `harness_planning`    | `planning`, `planning_followup`, `planning_revision`, `planning_revision_followup`, `planning_refinement`, `planning_refinement_followup`, `next_phase_plan`, `next_phase_plan_followup`, `next_phase_plan_refinement`, `next_phase_plan_refinement_followup` |
| `harness`  | `acceptance` | `harness_acceptance`  | `acceptance_plan`, `acceptance_report`, `acceptance_checklist`, `phase_acceptance`, `phase_acceptance_before_final`, `acceptance_semantic_validation`                                                                                                         |
| `workflow` | `main_agent` | `workflow_final_plan` | `final_plan`                                                                                                                                                                                                                                                  |
| `workflow` | `sub_agent`  | `workflow_subagent`   | `delegation`, `task_result`                                                                                                                                                                                                                                   |

`read_file` uses the registered `tool_output` source-reference policy for oversized
results. It returns a sandbox-visible source address and line range; it does not write
the source file content into an attachment.

Other harness flows, including ordinary `guidance` and `analysis`, do not have a
registered transfer strategy and therefore must remain messages/events without
attachment persistence. A caller cannot select an unregistered strategy or business
point as a compatibility fallback.
