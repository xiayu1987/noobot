# AgentContext 重构跟踪（已办 / 代办）

> 更新时间：2026-05-29（补充：forceToolCall 兼容入口删除）  
> 范围：`agentContext` 结构收敛、runtime 读取统一、兼容字段治理、文档拆分。

## 1. 目标

- 收敛 `agentContext` 的重复承载/双写字段，明确 canonical 读取路径。
- 兼容旧代码路径，避免一次性破坏式改动。
- 降低各模块手写深层路径的重复与漂移风险。

## 2. 已办

1. `forceTool` / `forceToolCall` 收敛（已完成）
- `systemRuntime.config.forceTool` 作为真值来源。
- `forceToolCall` 兼容入口已删除（仅保留输入解析兼容）。

2. `agentContext` facade 字段改为 runtime 动态映射（避免双写漂移）
- `execution.controllers.abortSignal`
- `execution.controllers.parentAsyncResultContainer`
- `session.current.attachments`
- `session.current.turnStore.currentTurnMessages/currentTurnTasks`
- `payload.tools.shared`

3. 统一 `forceTool` 判定逻辑
- `agent-collab` 路径改为统一使用 `resolveForceToolCall()`。
- subagent runConfig 透传仅写 `forceTool`（canonical）。

4. 文档拆分与补充
- 主文档：[agent-context-structure.md](./agent-context-structure.md)
- harness payload 独立文档：[harness-payload-structure.md](./harness-payload-structure.md)
- 已补兼容字段说明与 subagent 透传约定。

5. 新增统一 accessor 并在主链路落地
- 新增：`agent/src/system-core/context/agent-context-accessor.js`
- 新增测试：`agent/__tests__/system-core/context/agent-context-accessor.test.js`
- 已在 `agent-context-factory`、`session-execution-engine`、`execution/runner` 接入。

6. tools 层 runtime 读取统一
- `workflow/*` 已切换到 `getRuntimeFromAgentContext()`。
- `data-processing/*` 已切换到 `getRuntimeFromAgentContext()`。
- `connectors/*` 已切换到 `getRuntimeFromAgentContext()`。
- `execution/*` 已切换到 `getRuntimeFromAgentContext()`。
- `ai-models/model-tool.js` 已切换到 `getRuntimeFromAgentContext()`。
- `tools/*` 范围内本地 `getRuntime(agentContext)` 重复实现已清理完。

7. 回归验证
- 本轮涉及的 context/bot-manage/tools 相关测试均已通过（分批执行，0 failed）。

8. `vNext+3` 观测闭环补齐
- 已新增 `runner` 侧测试：`runner-bot-hook.test.js`
  - 验证兼容字段被访问时，会话收尾会发出 `agent_context_compat_field_hits` 事件。
- 已完成一轮回归（29 tests，0 failed），覆盖：
  - context accessor / mapper / provider
  - bot-manage runner hooks
  - agent-collab passthrough
  - data-processing guards
  - harness state migration

9. accessor 覆盖扩展（runtime / systemRuntime）
- `agent-context-accessor` 新增：
  - `getSystemRuntimeFromRuntime(runtime)`
- 已在 core 链路替换手写判空读取：
  - `hook/index.js`
  - `agent/core/state-builder.js`
  - `agent/core/capability-mini-runner/index.js`
  - `agent/core/turn/orchestrator.js`
  - `agent/core/turn/turn-executor.js`
  - `agent/core/turn/response-processor.js`
- 目标：减少 `runtime?.systemRuntime` 深层散落访问，统一空值语义，降低后续删除兼容字段时的修改面。

10. tools 层 accessor 收敛继续推进
- 已在以下工具路径切换到 `getSystemRuntimeFromRuntime()`：
  - `tools/workflow/agent-collab-tool.js`
  - `tools/workflow/user-interaction-tool.js`
  - `tools/workflow/request-help-tool.js`
  - `tools/connectors/connector-access-tool.js`
- 本轮回归（25 tests）通过，覆盖 collab / connector / user-interaction / tools registry / smoke。

11. 第一批兼容读取兜底移除（vNext+3 开始）
- 已移除以下字段的“读取兜底返回 runtime 值”行为（保留访问告警 + 命中统计）：
  - `execution.controllers.abortSignal`
  - `execution.controllers.parentAsyncResultContainer`
  - `payload.tools.shared`
- 新行为：
  - 读取返回 `undefined`
  - 写入继续忽略并告警
  - canonical 读取路径不变：`execution.controllers.runtime.*`
- 已更新 `agent-context-mapper.test.js`，并完成一轮回归（43 tests，0 failed）。

12. 第二批兼容读取兜底移除（vNext+3 继续）
- 已移除以下字段的“读取兜底返回 runtime 值”行为（保留访问告警 + 命中统计）：
  - `session.current.attachments`
  - `session.current.turnStore.currentTurnMessages`
  - `session.current.turnStore.currentTurnTasks`
- 新行为：
  - 读取返回 `undefined`
  - 写入继续忽略并告警
  - canonical 读取路径不变：`execution.controllers.runtime.attachmentMetas / currentTurnMessages / currentTurnTasks`
- 已更新 `agent-context-mapper.test.js`，并完成回归（43 tests，0 failed）。

13. 第三批兼容 facade 字段删除（vNext+3 收尾）
- 已从 `agent-context-mapper` 结构中移除以下兼容字段入口：
  - `execution.controllers.abortSignal`
  - `execution.controllers.parentAsyncResultContainer`
  - `session.current.attachments`
  - `session.current.turnStore.currentTurnMessages/currentTurnTasks`
  - `payload.tools.shared`
- 结果：这些字段在 schema 中不再暴露（`in` 判断为 `false`）。
- 已更新测试为“字段不存在”断言，并完成回归（43 tests，0 failed）。

14. `systemRuntime.config.forceToolCall` 兼容入口删除
- `buildDynamicInfo()` 不再注入 `config.forceToolCall` 别名字段，仅保留 canonical `config.forceTool`。
- 子任务 runConfig 透传事件中，不再输出 `forceToolCall` 兼容观测字段，仅输出 `forceTool`。
- `resolveForceToolCall()` 保留，用于解析外部输入兼容键（`forceTool/forceToolCall/...`），避免配置文件一次性破坏。
- 已更新相关单测并完成回归（43 tests，0 failed）。

15. 命名与文档收尾
- `environment-provider` 内部变量命名已去除 `forceToolCall` 语义，统一为 `forceTool`。
- tracker 文档中 `forceTool` 收敛阶段状态已更新为“已完成”。
- 仓库内剩余 `forceToolCall` 文本仅用于：
  - `resolveForceToolCall()` 的输入兼容解析；
  - 对应兼容行为测试/说明（不再代表 runtime 输出字段）。

## 3. 已推进（本次）

1. harness bucket 版本字段收敛（兼容实现）
- `state.__harnessBucketVersion` 改为 `bucket.__harnessBucketVersion` 的别名（getter/setter）。
- fast-path 判定收敛为 bucket 顶层版本号。
- 兼容旧数据：保留 state 侧读写入口，但不再作为独立真值源。

2. 测试补强（data-processing）
- 新增 `doc_to_data / media_to_data / web_to_data` 的保护性行为测试：
  - `doc_to_data` 对图片输入快速失败（应提示使用 `media_to_data`）。
  - `media_to_data` 对非媒体文件快速失败。
  - `web_to_data` 在空输入时快速失败（不进入网络抓取）。

## 4. 代办（当前真实剩余项）

1. 观测与发布窗口管理
- 基于 `agent_context_compat_field_hits` 观察一个发布周期，确认无异常消费方依赖已删除字段。
- 若有外部消费方告警，补一版迁移提示并给出过渡窗口。

2. harness 版本字段最终收口（可选）
- 当前 `state.__harnessBucketVersion` 为 `bucket.__harnessBucketVersion` 别名，兼容已满足。
- 可在后续版本评估是否彻底移除 `state` 侧别名入口（需先确认插件侧无直接依赖）。

3. 文档与发布说明收尾
- 在 Release Note/团队公告中补“破坏性变更提示”：
  - `execution.controllers.abortSignal` 等 facade 字段已删除；
  - `systemRuntime.config.forceToolCall` 已不再输出；
  - canonical 读取路径统一为 `execution.controllers.runtime.*` 与 `systemRuntime.config.forceTool`。

## 5. 迁移映射（旧路径 -> 新路径）

| 旧读取方式 | 新读取方式（canonical） | 状态 |
| --- | --- | --- |
| `agentContext.runtime` | `getRuntimeFromAgentContext(agentContext)` | 已落地 |
| `agentContext.runtime.systemRuntime` | `getSystemRuntimeFromAgentContext(agentContext)` | 已落地 |
| 手写拼接 `userId/sessionId/parent/root` | `getSessionIdsFromAgentContext(agentContext)` | 已落地 |
| `systemRuntime.config.forceToolCall` | `systemRuntime.config.forceTool` | 兼容入口已删除 |
| `payload.tools.shared` | `runtime.sharedTools` | 兼容入口已删除 |

## 6. 兼容字段废弃时间线（已完成）

1. `vNext`（当前阶段）
- 保留兼容字段读写。
- 新代码仅写 canonical 字段。

2. `vNext+1`
- 兼容字段改为只读别名，新增告警日志（一次/会话）。

3. `vNext+2`
- 删除兼容字段写入路径，仅保留读取兜底。

4. `vNext+3`（2026-05-29）
- 移除兼容字段读取兜底与兼容入口，清理完成。

## 7. 当前结论

- `agentContext` 兼容字段收敛主目标已完成，核心重复承载已移除。  
- 当前已进入“发布观测 + 文档收口”阶段，代码层面不再有高优先级结构改造阻塞项。

## 8. PR 摘要（可直接复用）

- 统一 `agentContext` canonical 读取路径，新增 accessor 并在 core/tools 主链路落地。
- 删除 runtime facade 兼容字段入口：
  - `execution.controllers.abortSignal / parentAsyncResultContainer`
  - `session.current.attachments / turnStore.*`
  - `payload.tools.shared`
- 删除 `systemRuntime.config.forceToolCall` 输出入口，保留 `resolveForceToolCall()` 输入兼容解析。
- 增加兼容字段命中统计与事件上报：`agent_context_compat_field_hits`。
- 补齐相关测试与回归，当前回归结果稳定（最近批次 43 tests, 0 failed）。
