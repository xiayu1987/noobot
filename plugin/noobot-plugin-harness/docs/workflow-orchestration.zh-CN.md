# Harness 工作流编排说明（中文）

English version: `docs/workflow-orchestration.md`

本文档说明：

1. 并发触发时的优先级规则。
2. 各流程的触发时机与阈值。
3. 各流程传给模型（或注入主模型）的消息顺序。
4. 统一执行范式。

## 统一执行范式

Planning / Guidance / Acceptance / Review 统一采用下表范式：

| 流程 | Trigger（触发） | Arbitrate（裁决） | Execute（执行） | Observe（观测） |
| --- | --- | --- | --- | --- |
| Planning | 在 `before_llm_call` 执行 workflow tick：基于轮次/字符阈值更新 `pending`（summary/planUpdate/phaseAcceptance） | 固定选择 `planning_bootstrap`（`after_llm_call` 选择 `planning_capture`） | 按模式执行：`runPlanningBySeparateModel` 或 `maybeInjectPlanningPrompt`；`after_llm_call` 捕获 `maybeCapturePlanningResult` | 统一写入 `workflow_priority_decision` + `workflow_execution_result`（domain=`planning`） |
| Guidance | 工具失败阈值/summary/planUpdate 形成 `pending` | `resolveNextGuidanceAction` 选择本轮动作：`guidance > plan_update > summary_overflow > summary_turns`；当 `phaseAcceptance` 已可执行时，summary 会让路以保留稳定上下文前缀缓存 | 统一执行入口按模式运行：inject 或 separate_model（含 plan_update 与 summary/guidance 联动） | 统一写入 `workflow_priority_decision` + `workflow_execution_result`（domain=`guidance`） |
| Acceptance | 在多 hook 点读取 `pending.phaseAcceptance`、`pending.acceptanceSemanticValidation`、`overflowForceAcceptancePending` | `resolveAcceptanceDecision` 根据 hook 与 pending 选择：`phase_acceptance` / `forced_acceptance` / `acceptance_semantic_validation` 等 | 按 hook 与模式执行 phase acceptance、semantic validation、final output guard、tool guard | 统一写入 `workflow_priority_decision` + `workflow_execution_result`（domain=`acceptance`） |
| Review | 在 review 相关 hook（如 `before_final_output`/`on_error`/`on_abort`）触发 | 固定选择 `review_report` | 生成报告并按配置决定是否附加到最终输出 | 统一写入 `workflow_priority_decision` + `workflow_execution_result`（domain=`review`） |

补充约定：

- `Trigger` 只负责“发现条件达到 + 更新 pending”，不直接执行其他域动作。
- `Arbitrate` 只负责“选出本轮主动作”。
- `Execute` 应由 `Arbitrate` 的 `chosenAction` 驱动，避免在执行阶段二次裁决。
- `Observe` 统一记录“选了什么 + 实际执行了什么 + 为什么没执行”。

标准事件（四个域统一）：

- `workflow_priority_decision`
- `workflow_execution_result`

## 并发触发优先级

当前 `before_llm_call` 下 guidance 调度顺序采用 cache-friendly 主线：

1. `guidance`
   触发条件：`pending.guidance != null`
2. `plan_update_revision` / `plan_update_refinement`
   触发条件：`pending.planUpdate === true`（或兼容旧字段 `pending.planRevision === true` / `pending.planRefinement === true`）
3. `summary_overflow`
   触发条件：`pending.summary === true && flags.summaryByCharsPrompted === true`
4. `summary_turns`
   触发条件：`pending.summary === true && flags.summaryByCharsPrompted !== true`
5. `none`

`phase_acceptance` 不由 guidance scheduler 直接选择执行；当仅有 summary 与 phase acceptance 同时 pending 时，summary 会在 guidance 域让路，让后续 acceptance 域执行阶段验收。真正的硬溢出由 `overflowForceAcceptancePending` 走 forced acceptance 抢占路径。

## 决策日志事件

事件名：`workflow_priority_decision`  
域：`guidance`  
Hook 点：`before_llm_call`

日志字段：

- `mode`: `inject` 或 `separate_model`
- `category`: `workflow` | `guard`（按流程语义分类，Acceptance 场景重点使用）
- `chosenAction`: `summary_overflow` | `guidance` | `plan_update_revision` | `plan_update_refinement` | `summary_turns` | `none`
- `chosenReason`: 调度原因码
- `chosenStage`: `revision` | `refinement` | `""`
- `candidateActions`: 本轮扫描到的可候选动作集合（推荐；旧字段 `triggeredActions` 可兼容保留）
- `deferredActions`: 本轮未执行、延后处理的动作集合（推荐）
- `blockedActions`: 当前被显式 blocker 阻塞的动作集合
- `blockedReasons`: blocker 原因码集合（推荐）
- `pending`: 状态快照
  - `summary`
  - `summaryByCharsPrompted`
  - `guidance`
  - `planUpdate`
  - `phaseAcceptance`

执行结果字段（`workflow_execution_result`）：

- `mode`: `inject` 或 `separate_model`
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

说明：
- `retryCount` 来自本轮新增日志中 `capability_reasoning_retry_scheduled` 的计数。
- `errorCode` 来自本轮新增日志中首个 `*_failed` / `*_error` 事件名（大写化）。

> 兼容说明：当前代码仍在使用 `triggeredActions`，建议逐步迁移到 `candidateActions/deferredActions/blockedReasons`，迁移期可双写字段。

## 触发时机与阈值

参数单一事实源：`src/core/workflow-params.js`（`WORKFLOW_PARAMS`），覆盖阈值、工具名、
调度顺序、workflow 的 action/reason/event 枚举，以及 capability 日志事件名（`logging.events.*`）。

Harness 调用 Agent 时的上下文裁剪窗口也已统一到插件侧配置：

- 默认值来源：`WORKFLOW_PARAMS.contextWindow.recentMessageLimit`（默认 `20`）
- 运行时可配置项：`plugins.harness.contextWindowRecentMessageLimit`
- 作用范围：`resolveModelMessages`（Harness 注入到 Agent 的统一消息裁剪入口）
- 说明：Harness 路径不再依赖 `session.recentMessageLimit`。

统一执行观测入口：

- `src/capabilities/handlers/shared/workflow/pattern.js`
  - `runWorkflowLifecycle(...)`：统一封装 `priority_decision -> execute -> execution_result`
  - `captureWorkflowLogCursor(...)` + `resolveWorkflowExecutionMetrics(...)`：统一统计 `retryCount/errorCode`

### Planning

- Hook 点：`before_llm_call`
- Summary 触发：
  - 轮次触发：`state.counters.llmTurns > LLM_SUMMARY_THRESHOLD`（默认 `8`）
  - 字符触发：`unsummarized_chars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD`（默认 `150000`）
- 溢出裁剪策略（`SUMMARY_POLICY.OVERFLOW_POLICY`）：
  - `ENABLE_PRUNE_AFTER_SUMMARY`
  - `PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS`
  - `FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW`
- Plan Update 触发：
  - `state.counters.planUpdateTurns >= PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD`（按模式读取 `WORKFLOW_PARAMS.modeThresholds.<full|programming|text>.planning.planUpdate`）
- Phase Acceptance 调度阈值：
  - `state.counters.phaseAcceptanceTurns >= PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD`（按模式读取 `WORKFLOW_PARAMS.modeThresholds.<full|programming|text>.acceptance.phase`）

### Guidance（工具失败恢复）

- Hook 点：
  - `after_tool_call`
  - `tool_call_error`
  - `before_llm_call`
- 失败阈值（`FAILURE_THRESHOLD`）：
  - 连续失败：`CONSECUTIVE = 3`
  - 累计失败：`ACCUMULATED = 10`
- 达阈值后会设置 `pending.guidance`，并在下一次 `before_llm_call` 参与调度。
- `requestedAction` 命名统一为“动作 + 模式”，例如：
  - `summary_inject` / `summary_separate_model`
  - `guidance_inject` / `guidance_separate_model`
  - `plan_update_revision_inject` / `plan_update_refinement_separate_model`
  - `phase_acceptance_inject` / `phase_acceptance_separate_model`
  - `forced_acceptance_before_tool_calls_rewrite`

### 消息中间表示（Message Plan）

Planning 注入与 separate-model 现在共享消息中间表示：

- 结构：`[{ kind, injectRole, separateRole, content }]`
- 渲染：
  - Inject：`renderMessagePlanForInject(plan)`
  - Separate-model：`renderMessagePlanForSeparateModel({ agentMessages, plan })`
- 实现文件：
  - `src/capabilities/handlers/shared/model/message-plan.js`

### Plan Update（revision/refinement）

- 触发来源：
  - Planning 轮次阈值达到（`planUpdateTurns` 达到当前模式的 `planning.planUpdate.triggerTurnsThreshold`）
  - Summary 完成后触发联动更新
- 独立重试预算：
  - `PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION = 10`
  - `PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REFINEMENT = 10`

### Acceptance

- Phase Acceptance：由 planning 触发调度；会被 guidance / plan update / planning 未捕获阻塞，但普通 summary pending 不再阻塞，以保持 provider prefix-cache 友好。
- Semantic Validation：由 acceptance 流程触发（主动验收或兜底验收），依赖模式与配置项。

## 职责归属矩阵（统一语义）

| 动作 | 触发者（设置 pending） | 执行者 | 主要 hook |
| --- | --- | --- | --- |
| `planning_bootstrap` | Planning | Planning | `before_llm_call` |
| `planning_capture` | Planning | Planning | `after_llm_call` |
| `summary` | Planning（阈值） | Guidance | `before_llm_call` |
| `guidance` | Guidance（失败阈值） | Guidance | `before_llm_call` |
| `plan_update_revision/refinement` | Planning（阈值） | Guidance | `before_llm_call` / `after_llm_call` |
| `phase_acceptance` | Planning（阈值） | Acceptance | `before_llm_call` |
| `acceptance_semantic_validation` | Acceptance | Acceptance | `before_llm_call` / `after_llm_call` |
| `review_report` | Review | Review | `before_final_output` / `on_error` / `on_abort` |

说明：Planning 在 `before_llm_call` 同时承担 workflow tick（调度触发）职责；具体动作由对应 domain 消费 pending 并执行。

## Pending 快照统一规范（推荐）

建议所有 domain 在 `workflow_priority_decision.pending` 中使用统一结构（允许按需裁剪字段）：

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

统一目标：

- 避免同一字段在不同域出现 `boolean`/`object` 混用（尤其 `planUpdate`）。
- 让 `blockedActions` 与 `blockedReasons` 可以直接映射到 pending 快照。
- 降低跨域排障成本（日志结构一致即可横向比对）。

## 决策驱动执行约束（推荐）

为保证日志可解释性，建议统一为：

1. `resolveDecision` 产出本轮唯一 `chosenAction`（可附带 `deferred/blocked`）。
2. `execute(decision)` 只执行 `chosenAction` 对应主路径，不再二次裁决。
3. 需要额外动作时，仅以 `executedFollowup` 标记，且必须在日志中可追踪其来源。

推荐伪代码：

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

## 生命周期与异常观测（推荐）

`runWorkflowLifecycle(...)` 建议保证“即使执行抛错也写 execution_result”：

- `priority_decision` 在执行前写入。
- `execute` 使用 `try/catch/finally` 包裹。
- 在 `finally` 中统一写 `workflow_execution_result`（含 `errorCode`、`durationMs`）。

这样能避免失败路径缺日志，提升可观测性完整度。

## 各流程消息顺序

说明：`existing_context` 指当前主模型调用已有上下文；`agent_messages` 指 `resolveCapabilityModelMessages(...)` 的结果。

| 流程 | Inject 模式传入模型内容顺序 | Separate-model 模式传入模型内容顺序 | 关键函数 |
| --- | --- | --- | --- |
| 计划生成（Planning bootstrap） | `existing_context -> 规划输入上下文摘要(system) -> 可用工具+allowlist(system) -> 计划请求(user)` | `agent_messages -> 规划输入上下文摘要(constraint) -> 可用工具+allowlist(constraint) -> 计划请求(task)` | `maybeInjectPlanningPrompt` / `buildPlanningMessagesForSeparateModel` |
| 小结（Summary） | `existing_context -> 计划清单上下文(system, 可选) -> 小结请求(user)` | `agent_messages -> 计划清单上下文(附加消息) -> 小结请求(task)` | `maybeInjectGuidanceOrSummaryPrompt` / `runGuidanceBySeparateModel(purpose=summary)` |
| 失败指导（Guidance） | `失败指导提示(system, prepend) -> existing_context` | `agent_messages -> 失败指导提示(task)` | `maybeInjectGuidanceOrSummaryPrompt` / `runGuidanceBySeparateModel(purpose=guidance)` |
| 计划修订（Plan update） | `existing_context -> 计划清单上下文(system, 可选) -> revision/refinement请求(user)` | `Revision: agent_messages -> 计划清单上下文(附加) -> revision请求(task); Refinement: agent_messages -> refinement请求(task)` | `maybeInjectPlanUpdatePrompt` / `runPendingPlanUpdateBySeparateModel` |
| 阶段验收（Phase acceptance） | `existing_context -> summary reports(system, N条) -> 主计划上下文(system) -> phase acceptance历史(system, N条) -> 阶段验收请求(user)` | `agent_messages -> summary reports(system, N条) -> 主计划上下文(system) -> phase acceptance历史(system, N条) -> 阶段验收请求(user)` | `maybeInjectPhaseAcceptancePrompt` / `runPhaseAcceptanceBySeparateModel` |
| 验收语义校验（Acceptance semantic validation） | `existing_context -> 主计划上下文(system) -> phase acceptance历史(system, N条) -> 语义校验请求(user)` | `主计划上下文(system) -> phase acceptance历史(system, N条) -> 语义校验请求(user)` | `maybeInjectAcceptanceSemanticValidationPrompt` / `runAcceptanceBySeparateModel` |

## 对应源码

- 工作流参数统一中心：
  - `src/core/workflow-params.js`
- 标准范式日志辅助：
  - `src/capabilities/handlers/shared/workflow/pattern.js`
- 策略中心化：
  - `src/capabilities/handlers/shared/workflow/policy.js`
- 一致性守卫（invariant）：
  - `src/capabilities/handlers/shared/workflow/invariants.js`
- 优先级调度：`src/capabilities/handlers/guidance/plan-update-scheduler.js`
- 决策日志埋点：`src/capabilities/handlers/guidance/controller.js`
- Planning 消息构建：
  - `src/capabilities/handlers/planning/prompt-builder.js`
  - `src/capabilities/handlers/planning/capture-runner.js`
- Guidance/Plan update：
  - `src/capabilities/handlers/guidance/prompt-injector.js`
  - `src/capabilities/handlers/guidance/model-runner.js`
  - `src/capabilities/handlers/guidance/revision-injector.js`
- Acceptance 消息组装：
  - `src/capabilities/handlers/acceptance/validation-runner.js`
- 各域统一生命周期入口（已接入 `runWorkflowLifecycle`）：
  - `src/capabilities/handlers/planning/controller.js`
  - `src/capabilities/handlers/guidance/controller.js`
  - `src/capabilities/handlers/acceptance/controller.js`
  - `src/capabilities/handlers/review/controller.js`
- Review 报告触发实现：
  - `src/capabilities/handlers/review/controller.js`
- 阈值与策略来源：
  - `src/core/workflow-params.js`

## Hook 白名单建议（Review）

Review 建议在 controller 内显式限制 hook 白名单：

- `before_final_output`
- `on_error`
- `on_abort`

并将白名单配置收敛到 `WORKFLOW_PARAMS.review.hooks`，避免由外部调度器隐式保证。

## Handler 导出规范（Facade + 语义子目录）

为保证“外部导入稳定 + 内部语义清晰”，当前采用以下分层：

| 层级 | 作用 | 文件 |
| --- | --- | --- |
| Facade（稳定入口） | 运行时/外部统一导入入口 | `src/capabilities/handlers/{planning,guidance,acceptance,review}.js` |
| 领域 index（语义入口） | 领域内部导出聚合 | `src/capabilities/handlers/{planning,guidance,acceptance,review}/index.js` |
| 领域实现层 | controller/deps/builder/runner 等具体实现 | `src/capabilities/handlers/<domain>/*.js` |
| Shared facade | 保持兼容的 shared 聚合导出 | `src/capabilities/handlers/shared.js` |
| Shared 语义 index | shared 目录下的标准导出映射 | `src/capabilities/handlers/shared/index.js` |
