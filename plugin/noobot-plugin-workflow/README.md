# noobot-plugin-workflow

基于 Noobot botmanage hook 的 Workflow 插件：

1. 监听 bot hook（固定 `before_agent_dispatch`，不暴露配置）
2. 通过模型调用把“自然语言工作流语义”转换为文本协议（DSL，非 JSON）
3. 插件侧完成文本协议解析，生成语义对象
4. 调用 `workflow` lib facade 按 `instanceId` 启动/推进实例
5. 每个节点通过 hook `workflow_node_agent_execute` 派发 agent 执行
6. workflow 侧仅管理实例流转，不负责节点 agent 编排

> 也支持直接执行：可传 `nodeAgentExecutor` 函数绕过 hook，在插件内部直接创建/调度节点 agent。  
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

## 当前有效配置项（2026-06-04）

仅以下配置会被插件读取：

- `enabled: boolean`（默认 `true`）
- `mode: "on" | "off"`（默认 `off`）
- `semanticPrompt: string`（可覆盖默认 DSL 提示词）
- `semanticModel: string`（语义模型名）
- `maxAutoTransitions: number`（默认 `10`）
- `parallelNodeExecution: boolean`（默认 `false`，开启后同一批 pending 节点并发派发 agent）
- `maxParallelNodeAgents: number`（默认 `4`，并发上限）
- `priority: number`（默认 `10`）
- `timeoutMs: number`（默认 `180000`）
- `capabilityModelInvoker: function`（可选，语义模型调用器）
- `nodeAgentExecutor: function`（可选，直接执行节点 agent；返回 action）

已移除/不再生效的旧字段：

- `semanticMode`
- `workflowProjectPath`
- `miniRunnerMaxTurns`
- `autoSubmit`
- `hookPoint`（已固定为 `before_agent_dispatch`）

## 会话接管与落盘（workflow session）

- 插件会在当轮追加一条 `workflowMessage=true` 的消息，`workflowMeta` 内含规划模型输出与节点会话索引。
- 规划阶段对话会落盘到：
  - `runtime/workflow/planning/<sessionId>/<dialogId>/planning.json`
  - `runtime/workflow/planning/<sessionId>/<dialogId>/events.jsonl`（规划与编排事件流）
- 每个工作流节点 agent 子会话由 agent 统一入口执行（插件只传策略），并落盘到：
  - `runtime/workflow/session/<sessionId>/<nodeDialogId>/session.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogId>/task.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogId>/execution.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogId>/meta.json`
  - `runtime/workflow/session/<sessionId>/<nodeDialogId>/events.jsonl`（节点事件流）
- 节点子会话采用 detached 执行与 scoped 落盘，不写入 `runtime/session` 主树。
- 节点子会话会自动禁用 `workflow` 插件（`mode=off`）避免递归触发。

## 开启方式

```json
{
  "plugins": {
    "workflow": {
      "enabled": true,
      "mode": "on",
      "semanticModel": "qwen3_6_plus",
      "maxAutoTransitions": 10,
      "priority": 10,
      "timeoutMs": 180000
    }
  },
  "selectedPlugins": ["workflow"]
}
```
