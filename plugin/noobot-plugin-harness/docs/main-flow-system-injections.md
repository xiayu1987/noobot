# Harness Main-Flow System Message Injection Inventory

[中文](./main-flow-system-injections.zh-CN.md) | English

This document inventories the message-injection paths through which `noobot-plugin-harness` writes system messages into the main-flow model context. It covers messages entering `ctx.messages`, `messageBlocks.system`, or `agentContext.payload.messages.system`. Temporary system messages built inside separate-model requests are excluded.

## Injection Mechanisms

The Harness plugin currently injects messages into the main flow through these paths:

- `injectSystemMessages(...)`: global Harness prompts such as the policy prompt and final-response prompt.
- `injectMessageWithPolicy(ctx, { role: "system", ... })`: appends system messages from capability flows.
- `appendMessage(ctx, message, { block: "system" })`: writes directly to the main-flow system block.
- `agentContext.payload.messages.system.unshift(...)`: writes directly to agent system context during takeover.
- `pushRoleMessage(ctx, messages, "system", content)`: appends system messages for some acceptance inject modes.

The global `before_llm_call` Harness policy is now injected by the capability runtime's internal `globalBootstrap` stage, before planning, guidance, and acceptance flows. After bootstrap, the capability runtime runs planning first, followed by guidance and acceptance according to the hook map. The runtime does not block later flows because of main-plan state; each flow decides whether its own pending/ready conditions permit execution. The `before_final_output` final-response prompt remains injected by the outer hook after the capability runtime completes.

## System Injection Inventory

The table lists only fixed code paths that write messages into the main-flow system block or agent system context. System, constraint, and workflow-policy messages constructed inside separate-model requests are excluded.

| Flow / trigger                                                                     |   Role | Injected message / marker                   | Content summary                                                                                                   | Injection identifier                           |
| ---------------------------------------------------------------------------------- | -----: | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Global Harness policy, `before_llm_call`, internal `globalBootstrap`               | system | `[HARNESS_POLICY_SELECTION]`                | Current scenario, `policy_prompt`, `i18n_key`, `policy_source`, and the policy text for that scenario             | `harness_prompt:noobot-harness-policy`         |
| Global final response, `before_final_output`                                       | system | `noobot-harness-final-response`             | Final-response constraints and safeguards                                                                         | `harness_prompt:noobot-harness-final-response` |
| Initial planning, `before_llm_call`, inject mode                                   | system | `planning_context_summary`                  | Planning context summary: `latestUserGoal`, `operationDirectory`, `sceneTools`, `toolAllowlist`, and related data | `planning_context_summary`                     |
| Initial planning, `before_llm_call`, inject mode                                   | system | `planning_plan_checklist_context`           | `<!-- harness-plan-checklist-context -->` plus the current complete plan and task goal                            | `planning_plan_checklist_context`              |
| Initial planning, `before_llm_call`, inject mode                                   | system | `planning_tool_context`                     | Tools available to planning, the tool allowlist, and scenario-tool information                                    | `planning_tool_context`                        |
| After applying the planning result                                                 | system | `<!-- noobot-harness-current-task-goal -->` | `[CURRENT_TASK_GOAL]` current task goal                                                                           | `CURRENT_TASK_GOAL_INJECTED_MESSAGE_TYPE`      |
| Guidance summary, `before_llm_call`, inject mode                                   | system | `guidance_summary_checklist`                | `<!-- harness-plan-checklist-context -->` plus the current complete plan                                          | `guidance_summary_checklist`                   |
| Guidance summary, `before_llm_call`, inject mode, with a previous summary          | system | `guidance_summary_previous_summary`         | Previous summary context                                                                                          | `guidance_summary_previous_summary`            |
| Planning revision/refinement, `before_llm_call`, inject mode                       | system | `planning_revision_checklist`               | `<!-- harness-plan-checklist-context -->` plus the current complete plan                                          | `planning_revision_checklist`                  |
| Phase acceptance, `before_llm_call`, inject mode, with a complete summary          | system | Summary reports marker                      | Latest complete summary report context                                                                            | `acceptance_prompt`                            |
| Phase acceptance, `before_llm_call`, inject mode                                   | system | Main-plan context marker                    | Main-plan context for acceptance                                                                                  | `acceptance_prompt`                            |
| Phase acceptance, `before_llm_call`, inject mode, with previous phase reports      | system | Phase acceptance reports marker             | Historical phase-acceptance reports                                                                               | `acceptance_prompt`                            |
| Acceptance semantic validation, `before_llm_call`, inject mode                     | system | `acceptance_main_plan_context`              | Main-plan context for semantic acceptance                                                                         | `acceptance_main_plan_context`                 |
| Acceptance semantic validation, `before_llm_call`, inject mode, with phase reports | system | `acceptance_phase_report`                   | Phase-acceptance report context                                                                                   | `acceptance_phase_report`                      |

## Dynamic System Injection

These paths can also write system messages into the main flow, but they are driven by a capability handler's takeover or directive rather than a fixed flow prompt.

| Path                                        |   Role | Content summary                                                          | Target                                                                    |
| ------------------------------------------- | -----: | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `messageTakeover` / `systemMessageTakeover` | system | `<!-- ${id} -->` plus takeover content                                   | The `ctx.messages` system block or `agentContext.payload.messages.system` |
| `memoryTakeover`                            | system | `<!-- harness-memory-takeover -->` or a custom marker plus a memory note | `agentContext.payload.messages.system`                                    |

## System Messages Excluded From This Inventory

The following code constructs system-like messages but does not inject them directly into the main-flow system block:

- `buildCapabilityModelMessages(...)` / `buildCapabilityProtocolModelMessages(...)` inside separate-model requests.
- Planning's `planning_workflow_policy`: inject mode filters it through `renderMessagePlanForInject()` rather than writing it as a main-flow system message; separate-model mode sends it as workflow policy in the child request.
- `relaySeparateModelOutputAsUserMessage(...)`: relays separate-model output to the main flow as a `user` message.

## Non-System Main-Flow Injection

These flows also inject `user` messages into the main flow. They do not enter the system block, but they affect context ordering and the cache prefix.

| Flow                           | User message                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Initial planning               | `planning_task`, `planning_responsibility_constraint`                                                    |
| Normal guidance                | `guidance_failure:*`                                                                                     |
| Guidance summary               | `guidance_summary_prompt`, `guidance_summary_responsibility_constraint`                                  |
| Planning revision/refinement   | `planning_revision_prompt` / `planning_refinement_prompt`, plus the corresponding responsibility message |
| Phase acceptance               | Phase-acceptance request and responsibility message                                                      |
| Acceptance semantic validation | `acceptance_semantic_validation_request`, `acceptance_responsibility_constraint`                         |
| Separate-model relay           | `separate_model_relay:*`, normally the separate-model output relayed to the main flow                    |

## Cache-Diagnostic Focus

When investigating low prompt-cache hit rates on non-main flows, inspect these system injections first:

- `harness_prompt:noobot-harness-policy`: contains `[HARNESS_POLICY_SELECTION]` and is injected by the global `before_llm_call` hook.
- `planning_plan_checklist_context`: contains `<!-- harness-plan-checklist-context -->` and is injected in planning inject mode.
- `guidance_summary_checklist`: contains `<!-- harness-plan-checklist-context -->` and is injected in guidance-summary inject mode.
- `planning_revision_checklist`: contains `<!-- harness-plan-checklist-context -->` and is injected in planning revision/refinement inject mode.
- `CURRENT_TASK_GOAL_INJECTED_MESSAGE_TYPE`: contains `<!-- noobot-harness-current-task-goal -->`.

The injection timing of `[HARNESS_POLICY_SELECTION]` and `<!-- harness-plan-checklist-context -->` differs. That timing can change the main-flow system block between turns and reduce the stable cache prefix on non-main flows.

## Code Entry Points

- Global policy and final-response prompts: `plugin/noobot-plugin-harness/src/tracing/buffer-manager.js`
- Low-level system-prompt injection: `plugin/noobot-plugin-harness/src/prompt/prompt-injector.js`
- Shared message-injection utilities: `plugin/noobot-plugin-harness/src/capabilities/handlers/shared/message/injection-utils.js`
- Planning prompt injection: `plugin/noobot-plugin-harness/src/capabilities/handlers/planning/prompt-builder.js`
- Planning current-task-goal injection: `plugin/noobot-plugin-harness/src/capabilities/handlers/planning/result-pipeline.js`
- Guidance summary and guidance prompt injection: `plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/prompt-injector.js`
- Planning revision/refinement injection: `plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/revision-injector.js`
- Acceptance and phase-acceptance injection: `plugin/noobot-plugin-harness/src/capabilities/handlers/acceptance/validation-runner.js`
- Memory takeover injection: `plugin/noobot-plugin-harness/src/capabilities/takeover/memory-takeover.js`
