# semantic-transfer（归档说明）

> ⚠️ 本文档已归档，仅保留历史背景。
> 
> **当前以 `docs/semantic-transfer-design.md` 与 `docs/semantic-transfer-refactor-file-tasks.md` 为准。**

## 当前实现口径（2026-06）

- 新增统一入口：
  - `transferSemanticContent(...)`（异步主入口）
  - `transferSemanticContentSync(...)`（同步场景入口，当前用于 `harness_final`）
- 兼容薄包装仍保留：
  - `transferToolMessage(...)`
  - `transferSubAgentMessages(...)`
  - `processStageMessage(...)`
  - `composeFinalMessage(...)`
- runtime 已注入以上接口（`sharedTools.semanticTransfer.*`）。
- 工具超限输入、workflow 子agent流转、harness 阶段/最终消息均已接入 transfer 语义。
- tool overflow 已完成去 legacy 写入（不再写 `overflow_file_path/overflow_file_sandbox_path/overflow_transfer_envelope`）。

## 目录语义分层（2026-06）

- `core/`：常量、策略、意图、结果、遥测、压缩
- `envelope/`：TransferEnvelope 定义、校验、规范化
- `storage/`：落盘/路径解析/消费适配
- `transfer/`：tool/subagent/harness 场景编排入口

根目录同名文件保留为兼容 re-export，避免存量深层 import 路径在迁移期中断。

## 语义优先原则

跨模块传递优先使用：

- `transferResult`
- `transferEnvelope`
- `transferEnvelopes`

仅在未完成迁移的存量链路上保留兼容解析，不再新增 legacy 输出协议依赖。`legacy-adapter` 已从公共 API 移除并删除。

## 迁移状态

请查看：

- `docs/semantic-transfer-refactor-file-tasks.md`（任务状态）
- `docs/semantic-transfer-delegacy-checklist.md`（去兼容清单）
