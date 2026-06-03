# noobot-plugin-workflow

基于 Noobot botmanage hook 的 Workflow 插件：

1. 监听 bot hook（默认 `after_agent_dispatch`）
2. 通过模型调用把“自然语言工作流语义”转换为文本协议（DSL，非 JSON）
3. 插件侧完成文本协议解析，生成语义对象
4. 调用 `workflow` lib facade 完成：编译模型 -> 启动实例 -> 流转
5. 插件仅负责编排与交互上下文处理，不承载工作流核心逻辑

## DSL 协议（v1）

```text
WORKFLOW_DSL/1
NODE id=start type=state stateType=start name="开始"
NODE id=audit type=action name="审批"
NODE id=end type=state stateType=end name="结束"
EDGE from=start to=audit name="开始到审批"
EDGE from=audit to=end name="审批到结束"
AUTO type=submit stepIndex=0
END
```

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
    "hookPoint": "after_agent_dispatch",
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

## 开启方式

```json
{
  "plugins": {
    "workflow": {
      "enabled": true,
      "mode": "on"
    }
  },
  "selectedPlugins": ["workflow"]
}
```
