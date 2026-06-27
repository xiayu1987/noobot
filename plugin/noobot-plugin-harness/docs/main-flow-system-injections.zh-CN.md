# Harness 插件主流程 System 消息注入清单

本文档盘点 `noobot-plugin-harness` 会写入主流程模型上下文的消息注入路径，重点记录会进入 `ctx.messages`、`messageBlocks.system` 或 `agentContext.payload.messages.system` 的 system 消息。Separate model 内部临时构造的 system 消息不计入本清单。

## 注入机制

Harness 插件当前主要通过以下路径向主流程注入消息：

- `injectSystemMessages(...)`：用于全局 harness prompt 注入，例如 policy prompt 和 final response prompt。
- `injectMessageWithPolicy(ctx, { role: "system", ... })`：用于 capability 流程向主流程追加 system 消息。
- `appendMessage(ctx, message, { block: "system" })`：用于直接写入主流程 system block。
- `agentContext.payload.messages.system.unshift(...)`：用于 takeover 场景直接写入 agent system 上下文。
- `pushRoleMessage(ctx, messages, "system", content)`：用于部分 acceptance inject 模式追加 system 消息。

`before_llm_call` 的全局 harness policy 注入现在由 capability runtime 的内部 `globalBootstrap` 阶段执行，发生在 planning / guidance / acceptance 等业务流程之前。全局 bootstrap 之后，capability runtime 按 hook map 顺序先运行 planning，再运行 guidance / acceptance；runtime 不会因为主计划状态而阻塞后续流程，具体动作是否执行由各流程自己的 pending/ready 条件决定。`before_final_output` 的 final response prompt 仍在 capability runtime 完成后由 hook 外层注入。

## System 注入清单

下表只列“固定代码路径会写入主流程 system block / agent system”的消息。Separate model 请求内部构造的 system / constraint / workflow_policy 消息不计入。

| 流程 / 触发点 | 注入角色 | 注入消息 / 标记 | 内容概要 | 实际注入标识 |
|---|---:|---|---|---|
| 全局 Harness policy，`before_llm_call`，runtime 内部 `globalBootstrap` | system | `[HARNESS_POLICY_SELECTION]` | 当前 scenario、policy_prompt、i18n_key、policy_source，以及对应场景策略正文 | `harness_prompt:noobot-harness-policy` |
| 全局 final response，`before_final_output` | system | `noobot-harness-final-response` | 最终回复约束/保护类 system prompt | `harness_prompt:noobot-harness-final-response` |
| Planning 初始规划，`before_llm_call`，inject 模式 | system | `planning_context_summary` | 规划输入上下文摘要：latestUserGoal、operationDirectory、sceneTools、toolAllowlist 等 | `planning_context_summary` |
| Planning 初始规划，`before_llm_call`，inject 模式 | system | `planning_plan_checklist_context` | `<!-- harness-plan-checklist-context -->` 当前完整计划清单/当前任务目标 | `planning_plan_checklist_context` |
| Planning 初始规划，`before_llm_call`，inject 模式 | system | `planning_tool_context` | 规划可用工具、工具白名单、场景工具信息 | `planning_tool_context` |
| Planning 结果应用后 | system | `<!-- noobot-harness-current-task-goal -->` | `[CURRENT_TASK_GOAL]` 当前任务目标 | `CURRENT_TASK_GOAL_INJECTED_MESSAGE_TYPE` |
| Guidance summary，`before_llm_call`，inject 模式 | system | `guidance_summary_checklist` | `<!-- harness-plan-checklist-context -->` 当前完整计划清单 | `guidance_summary_checklist` |
| Guidance summary，`before_llm_call`，inject 模式，有历史 summary 时 | system | `guidance_summary_previous_summary` | 上一次 summary 上下文 | `guidance_summary_previous_summary` |
| Guidance plan revision/refinement，`before_llm_call`，inject 模式 | system | `planning_revision_checklist` | `<!-- harness-plan-checklist-context -->` 当前完整计划清单 | `planning_revision_checklist` |
| Phase acceptance，`before_llm_call`，inject 模式，有完整 summary 时 | system | summary reports marker | 最新完整 summary report 上下文 | `acceptance_prompt` |
| Phase acceptance，`before_llm_call`，inject 模式 | system | main plan context marker | 验收用主计划上下文 | `acceptance_prompt` |
| Phase acceptance，`before_llm_call`，inject 模式，有历史 phase reports 时 | system | phase acceptance reports marker | 历史阶段验收报告 | `acceptance_prompt` |
| Acceptance semantic validation，`before_llm_call`，inject 模式 | system | `acceptance_main_plan_context` | 语义验收用主计划上下文 | `acceptance_main_plan_context` |
| Acceptance semantic validation，`before_llm_call`，inject 模式，有 phase reports 时 | system | `acceptance_phase_report` | 阶段验收报告上下文 | `acceptance_phase_report` |

## 动态 System 注入

以下路径也可能写入主流程 system，但不是固定流程 prompt；它们取决于 capability handler 返回的 takeover/directive。

| 路径 | 注入角色 | 内容概要 | 目标 |
|---|---:|---|---|
| `messageTakeover` / `systemMessageTakeover` | system | `<!-- ${id} -->` + takeover content | `ctx.messages` 的 system block，或 `agentContext.payload.messages.system` |
| `memoryTakeover` | system | `<!-- harness-memory-takeover -->` 或自定义 marker + memory note | `agentContext.payload.messages.system` |

## 不计入本清单的 System 消息

以下代码会构造 system-like 消息，但不会直接作为主流程 system 注入：

- Separate model 请求内部的 `buildCapabilityModelMessages(...)` / `buildCapabilityProtocolModelMessages(...)`。
- Planning 的 `planning_workflow_policy`：在 inject 模式下会被 `renderMessagePlanForInject()` 过滤，不会以 system 消息写入主流程；separate-model 模式下才作为 workflow policy 进入子请求。
- `relaySeparateModelOutputAsUserMessage(...)`：转回主流程时是 `user` 消息，不是 system。

## 非 System 的主流程注入

以下流程也会向主流程注入 `user` 消息。它们不会进入 system block，但会影响主流程上下文顺序和缓存前缀。

| 流程 | user 消息 |
|---|---|
| Planning 初始规划 | `planning_task`、`planning_responsibility_constraint` |
| Guidance 普通指导 | `guidance_failure:*` |
| Guidance summary | `guidance_summary_prompt`、`guidance_summary_responsibility_constraint` |
| Planning revision/refinement | `planning_revision_prompt` / `planning_refinement_prompt`，以及对应 responsibility |
| Phase acceptance | phase acceptance request、responsibility |
| Acceptance semantic validation | `acceptance_semantic_validation_request`、`acceptance_responsibility_constraint` |
| Separate model relay | `separate_model_relay:*`，通常是 separate model 输出转回主流程 |

## 与模型缓存排查相关的重点

排查非主链路 prompt cache 命中量偏小时，优先关注以下 system 注入：

- `harness_prompt:noobot-harness-policy`：内容包含 `[HARNESS_POLICY_SELECTION]`，由全局 `before_llm_call` 注入。
- `planning_plan_checklist_context`：内容包含 `<!-- harness-plan-checklist-context -->`，由 planning inject 模式注入。
- `guidance_summary_checklist`：内容包含 `<!-- harness-plan-checklist-context -->`，由 guidance summary inject 模式注入。
- `planning_revision_checklist`：内容包含 `<!-- harness-plan-checklist-context -->`，由 planning revision/refinement inject 模式注入。
- `CURRENT_TASK_GOAL_INJECTED_MESSAGE_TYPE`：内容包含 `<!-- noobot-harness-current-task-goal -->`。

其中 `[HARNESS_POLICY_SELECTION]` 和 `<!-- harness-plan-checklist-context -->` 的注入时机差异，可能导致非主链路在不同轮次解析到的主流程 system block 不一致，从而影响连续缓存前缀。

## 代码入口索引

- 全局 policy / final response prompt：`plugin/noobot-plugin-harness/src/tracing/buffer-manager.js`
- 底层 system prompt 注入：`plugin/noobot-plugin-harness/src/prompt/prompt-injector.js`
- 通用消息注入工具：`plugin/noobot-plugin-harness/src/capabilities/handlers/shared/message/injection-utils.js`
- Planning prompt 注入：`plugin/noobot-plugin-harness/src/capabilities/handlers/planning/prompt-builder.js`
- Planning 当前任务目标注入：`plugin/noobot-plugin-harness/src/capabilities/handlers/planning/result-pipeline.js`
- Guidance summary / guidance prompt 注入：`plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/prompt-injector.js`
- Planning revision/refinement 注入：`plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/revision-injector.js`
- Acceptance / phase acceptance 注入：`plugin/noobot-plugin-harness/src/capabilities/handlers/acceptance/validation-runner.js`
- Memory takeover 注入：`plugin/noobot-plugin-harness/src/capabilities/takeover/memory-takeover.js`
