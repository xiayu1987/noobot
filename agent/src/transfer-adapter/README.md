# semantic-transfer（归档说明）

> ⚠️ 本文档已归档，仅保留历史背景。当前整改状态以 `docs/semantic-transfer-code-alignment-todos.md` 为准，原始需求对照以 `docs/semantic-transfer-raw-notes.md` 为准。

## 当前实现口径（2026-06）

- 对外统一入口：
  - `transferSemanticContent(...)`
- 调用模型已收敛为：
  - `scenario: "tool" | "bot_plugin" | "agent_plugin"`
  - `strategy: "..."`
- 统一入口标准调用必须显式传入 `strategy`；不再从 `direction` / `transferMode` / 旧 `scenario` 推断策略。
- 以下旧场景 wrapper 已从公共 re-export 与 `sharedTools.semanticTransfer` 暴露面移除，且不再作为源码实现函数名使用：
  - `transferToolMessage(...)`
  - `transferSubAgentMessages(...)`
  - `processStageMessage(...)`
  - `composeFinalMessage(...)`
  - `transferSemanticContentSync(...)`
- 内部实现按策略语义函数分派；外部不得直接调用私有实现函数。

## 已接入场景

- 工具超限输入/输出：`tool_input`、`tool_output`、`tool_result_text`
- bot plugin 子agent 结果与最终附件摘要：`bot_plugin_subagent_result`、`bot_plugin_final_return`
- agent plugin 阶段消息、小结注入、最终消息：`agent_plugin_stage_message`、`agent_plugin_summary_injection`、`agent_plugin_final_message`

## 目录语义分层（2026-06）

- `core/`：常量、策略、意图、结果、校验事件、压缩
- `envelope/`：TransferEnvelope 定义、校验、规范化
- `storage/`：落盘/路径解析/消费适配
- `transfer/`：统一入口与内部场景编排实现

## 语义优先原则

跨模块传递优先使用：

- `transferResult`
- `transferEnvelopes`

传输 envelope 字段统一使用 `transferEnvelopes` 数组；普通附件场景不适用本段，不允许为了统一输出而越权生成 `noobot.semantic-transfer` envelope。
