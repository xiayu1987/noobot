# noobot-plugin-workflow

基于 Noobot 插件协议和 Agent hook 的 Workflow 插件：

1. 监听 `bot.before_agent_dispatch` hook（固定协议点，不暴露配置）
2. 通过模型调用把“自然语言工作流语义”转换为文本协议（DSL，非 JSON）
3. 插件侧完成文本协议解析，生成语义对象
4. 调用 `workflow` lib facade 按 `instanceId` 启动/推进实例
5. 每个节点通过 hook `workflow_node_agent_execute` 派发 agent 执行
6. workflow 侧仅管理实例流转，不负责节点 agent 编排

> 也支持注入 `nodeAgentExecutor`，由宿主为节点提供执行实现。
> 动作节点建议始终提供 `task` 字段，插件会把该字段原样作为子模型任务指令（不附加“工作流”描述）。

## DSL 协议（v1）

```text
WORKFLOW_DSL/1
NODE id=start type=state stateType=start name="开始"
NODE id=audit type=action name="审批" task="审核订单并给出审批结论"
NODE id=end type=state stateType=end name="结束"
EDGE from=start to=audit name="开始到审批" when="gte(order.amount,100)"
EDGE from=audit to=end name="审批到结束" when="always"
AUTO type=submit stepIndex=0
END
```

`EDGE when` 支持：`always/never/exists(path)/eq/ne/gt/gte/lt/lte/in`。

条件求值上下文可通过 `runConfig.workflowConditionContext` 传入（例如 `{"order":{"amount":120}}`）。

## 编排产物（统一 payload）

插件会把统一编排结果写入 `agentResult.workflow`，协议版本：

- `protocolVersion: "workflow.orchestration.v2"`

结构示例：

```json
{
  "protocolVersion": "workflow.orchestration.v2",
  "status": "succeeded",
  "interactionId": "wf_u1_s1_1748960000000_ab12cd",
  "timestamp": "2026-06-03T15:00:00.000Z",
  "runMeta": {
    "userId": "u1",
    "sessionId": "s1",
    "parentSessionId": "",
    "dialogProcessId": "d1",
    "hookPoint": "before_agent_dispatch",
    "locale": "zh-CN"
  },
  "orchestration": {
    "mode": "separate_model",
    "semanticPurpose": "workflow_semantic",
    "semanticModel": "qwen3_6_plus"
  },
  "interaction": {
    "sourceTextPreview": "...",
    "semanticTextPreview": "..."
  },
  "phaseTimeline": [
    { "phase": "hook_received", "status": "succeeded", "startedAt": "...", "endedAt": "..." },
    { "phase": "semantic_resolution", "status": "succeeded", "startedAt": "...", "endedAt": "..." },
    { "phase": "workflow_execution", "status": "succeeded", "startedAt": "...", "endedAt": "..." },
    { "phase": "payload_build", "status": "succeeded", "startedAt": "...", "endedAt": "..." }
  ],
  "retryMeta": {
    "policy": "single_shot",
    "maxAttempts": 1,
    "attempts": 1,
    "retried": false,
    "history": [{ "attempt": 1, "status": "succeeded", "timestamp": "..." }]
  },
  "semantic": {},
  "execution": {},
  "artifacts": {
    "semantic": {},
    "execution": {}
  },
  "diagnostics": {
    "invokerUsed": true,
    "invokerTraceCount": 2,
    "error": null
  }
}
```

## 配置契约

`src/core/options.js` 是配置字段、类型与默认值的唯一事实源。面向用户的常用 JSON 配置如下：

- `enabled: boolean`（默认 `true`）
- `mode: "on" | "off"`（默认 `off`）
- `semanticPrompt: string`（可覆盖默认 DSL 提示词）
- `semanticModel: string`（语义模型名）
- `maxAutoTransitions: number`（默认 `50`）
- `parallelNodeExecution: boolean`（默认 `false`，开启后同一批 pending 节点并发派发 agent）
- `maxParallelNodeAgents: number`（默认 `10`，并发上限）
- `priority: number`（默认 `10`）
- `timeoutMs: number`（默认 `18000000`）
- `miniRunnerMaxTurns: number`（默认 `3`，语义模型 mini-runner 轮数上限）
- `nodeAgentTimeoutMs: number`（默认 `18000000`，单个节点 Agent 超时）
- `denyToolNames: string[]`（可选；插件侧声明应禁用的工具名列表，默认值为多 agent 协作三件套）

宿主可通过 JavaScript API 注入执行、模型调用、消息解析、落盘、节点状态仓库和扩展挂载函数；这些端口同样由 `normalizeOptions()` 校验，不属于用户 JSON 配置。未知配置不会成为运行时行为。

## 会话接管与落盘（workflow session）

- 插件会在当轮追加一条 `workflowMessage=true` 的消息，`workflowMeta` 内含规划模型输出与节点会话索引。
- 规划阶段对话会落盘到：
  - `runtime/workflow/planning/<sessionId>/<dialogProcessId>/planning.json`
  - `runtime/workflow/planning/<sessionId>/<dialogProcessId>/events.jsonl`（规划与编排事件流）
- 每个工作流节点 agent 子会话由 agent 统一入口执行（插件只传策略），并落盘到：
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/session.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/session-summary.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/task.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/execution.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/execution.jsonl`
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/meta.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogProcessId>/events.jsonl`（节点事件流）
- 节点子会话采用 detached 执行与 scoped 落盘，不写入 `runtime/session` 主树；文件结构与主流程 session 落盘保持同构，路径由插件提供。
- 节点子会话会自动禁用 `workflow` 插件（`mode=off`）避免递归触发。

## Tool policy

Workflow 通过插件宿主的 `policy.patch({ denyToolNames })` 声明节点执行期间禁用的工具。默认禁用以下多 Agent 协作工具，避免节点子会话再次进入协作回路：

- `delegate_task_async`
- `wait_async_task_result`
- `plan_multi_task_collaboration`

`policy.patch` 是插件与 Agent 之间的唯一工具策略端口；插件不直接修改 Agent 内部配置。

## 开启方式

```json
{
  "toolPolicy": {
    "denyToolNames": [
      "delegate_task_async",
      "wait_async_task_result",
      "plan_multi_task_collaboration"
    ]
  },
  "plugins": {
    "workflow": {
      "enabled": true,
      "mode": "on",
      "semanticModel": "qwen3_6_plus",
      "maxAutoTransitions": 10,
      "priority": 10,
      "timeoutMs": 18000000
    }
  },
  "selectedPlugins": ["workflow"]
}
```
