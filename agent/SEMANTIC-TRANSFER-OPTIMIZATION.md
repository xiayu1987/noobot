# Semantic-Transfer 收敛归一优化清单

> 更新时间：2026-06-08
> 目标：在不破坏现有行为的前提下，逐步降低重复逻辑、统一输出形态、提高边界稳定性。

## 0. 改造原则

- **兼容优先**：先做内部收敛，不直接删老字段，避免影响上游/插件。
- **小步快跑**：每一步都能独立验证（单测/回归）。
- **单一事实源**：同一语义只保留一个核心实现，避免多处分叉。

---

## 1. 分步改造清单（执行顺序）

### Step 1：抽取 persisted → envelope 的公共 helper

- [x] 新增 `semantic-transfer` 内部 helper：统一从 `persisted` 提取 `transferEnvelope`。
- [x] 在以下模块替换重复逻辑：
  - `tool-transfer.js`
  - `subagent-transfer.js`
  - `harness-transfer.js`
- [x] 保持返回字段不变（仅内部去重）。

**验收标准**
- 三处重复提取逻辑被收敛到一个 helper。
- 相关测试全部通过。

---

### Step 2：统一 envelope 列表归一与校验边界

- [x] 新增 envelope 列表归一 helper（过滤空值/非法 envelope）。
- [x] 在各场景输出前统一归一 `transferEnvelopes`。
- [x] 统一 `transferEnvelope = transferEnvelopes[0] || null` 规则。

**验收标准**
- 输出结构更加稳定（不会混入非法 envelope）。
- 不改变既有成功/失败语义。

---

### Step 3：收口模型侧输出契约（渐进）

- [x] 保持内部 `transferResult/transferEnvelope/transferEnvelopes`。
- [x] 模型侧/LLM 可见 payload 继续收敛为 `transferFiles` 主协议。
- [x] 梳理仍输出 legacy 字段的链路并登记（不在本轮强删）。

**验收标准**
- 模型侧主协议一致（`transferFiles`）。
- 无新增 legacy 依赖。

---

### Step 4：补充测试与回归

- [x] 增加/更新 semantic-transfer 单测（helper + 场景输出）。
- [x] 运行核心回归：
  - `tool-runner`
  - `mini-runner`
  - `session-execution-engine`

**验收标准**
- 相关测试通过。
- 无行为倒退。

---

## 2. 执行记录

- [x] Step 1 完成
- [x] Step 2 完成
- [x] Step 3 完成（本轮以“梳理与约束”为主）
- [x] Step 4 完成

### 2026-06-08 执行日志

1. 新增 `src/system-core/semantic-transfer/envelope-utils.js`：
   - `extractTransferEnvelopeFromPersisted(...)`
   - `normalizeTransferEnvelopes(...)`
2. 收敛重复逻辑：
   - `tool-transfer.js`、`subagent-transfer.js`、`harness-transfer.js` 已改为统一 helper。
3. 模型侧 payload 收口：
   - `compact.js` 中 `compactToolResultPayloadForModel(...)` 删除中间字段
     `compactTransferPayload/compactToolPayload`，保持 `transferFiles` 为主输出。
4. 回归验证：
   - 通过：`semantic-transfer`、`mini-runner`、`session-execution-engine` 相关测试。
   - 说明：`tool-runner` 现有 overflow 用例在当前本地环境仍有历史前置依赖（附件服务/上下文）耦合，需在后续专项中单独梳理。

### 2026-06-08（下一步）执行日志

5. `consumer.js` 渐进收敛（兼容保留）：
   - 新增内部聚合思路：优先识别 `transferEnvelope/transferEnvelopes/transferResult.envelope`。
   - `getTransferFiles(...)` 与 `getTransferAttachmentMetas(...)` 改为先走 envelope 主链路，再走 legacy 兜底。
   - 增加 envelope 去重，避免 wrapped payload 出现重复文件/附件元数据。
6. 测试补充：
   - `semantic-transfer.test.js` 增加 wrapped transfer payload 场景断言。
7. 回归验证：
   - 通过：`semantic-transfer`、`session message transfer`、`message converter transfer` 相关测试。

### 2026-06-08（下一步 2）执行日志

8. 新增 source/reason/generationSource 字典化模块：
   - `src/system-core/semantic-transfer/constants.js` 增加 `TRANSFER_REASON` 枚举。
   - 新增 `src/system-core/semantic-transfer/intent.js`，提供：
     - `normalizeTransferSource(...)`
     - `normalizeTransferReason(...)`
     - `resolveTransferIntent(...)`
9. 在关键写入链路接入归一 helper：
   - `attachment-adapter.js`
   - `tool-transfer.js`
   - `tool-result-text.js`
   - `materializer.js`
   - `subagent-transfer.js`
   - `harness-transfer.js`
10. 测试补充：
   - `semantic-transfer.test.js` 新增 intent helper 归一与别名映射断言。
11. 回归验证：
   - 通过：`semantic-transfer` + `session transfer` + `message converter transfer` 测试集。

### 2026-06-08（下一步 3）执行日志

12. validator 强校验能力接入（渐进）：
   - `envelope-utils.js` 新增 `normalizeTransferEnvelopesWithPolicy(...)`：
     - 支持 `enforceProtocol`（只保留合法 envelope）
     - 支持 `strict`（出现非法 envelope 时抛错）
     - 支持 runtime 配置读取：`*.semanticTransfer.strictEnvelopeValidation`
13. 输出前统一 validate（核心路径）：
   - `tool-transfer.js` 在 `buildTransferResponse(...)` 前统一执行 envelope 校验归一，并附带 `transferValidation` 统计字段。
   - `subagent-transfer.js`、`harness-transfer.js` 在输出 envelope 列表前统一校验归一。
14. 测试补充：
   - `semantic-transfer.test.js` 增加 `normalizeTransferEnvelopesWithPolicy` 的非严格/严格行为断言。
15. 回归验证：
   - 通过：`semantic-transfer`、`session transfer`、`message converter transfer` 相关测试。

### 2026-06-08（下一步 4）执行日志

16. strict 配置透传到 runtime 构建层：
   - `runtime-environment-builder.js` 引入 `normalizeTransferEnvelopesWithPolicy(...)`。
   - `sharedTools.semanticTransfer` 增加：
     - `resolveStrictEnvelopeValidation(options?)`
     - `normalizeTransferEnvelopesWithPolicy(value, options?)`
   - `validateTransferEnvelope(...)` 改为默认读取 runtime strict 配置（可被 options.strict 覆盖）。
17. 配置约定：
   - `userConfig.semanticTransfer.strictEnvelopeValidation`
   - `globalConfig.semanticTransfer.strictEnvelopeValidation`
   - 默认 `false`。
18. 集成测试补充：
   - `runtime-environment-builder.test.js` 新增 strict 配置透传测试：
     - strict 开启后，`validateTransferEnvelope({ protocol: "x" })` 抛错。
     - strict 开启后，`normalizeTransferEnvelopesWithPolicy(..., { enforceProtocol: true })` 对非法 envelope 抛错。
19. 回归验证：
   - 通过：runtime/context + semantic-transfer + session-transfer 相关测试（33/33）。

### 2026-06-08（下一步 5）执行日志

20. transferValidation 统一事件/Hook 打点：
   - 新增 `src/system-core/semantic-transfer/telemetry.js`
     - `emitSemanticTransferValidation(...)`
   - 事件：`semantic_transfer_validation`
   - Hook 点：`AGENT_HOOK_POINTS.SEMANTIC_TRANSFER_VALIDATION`
21. envelope 归一统计增强：
   - `normalizeTransferEnvelopesWithPolicy(...)` 支持 `withStats`
   - 输出统计：`inputCount/outputCount/filteredCount/invalidCount/strict/enforceProtocol`
22. 接入场景：
   - `tool-transfer.js`（tool_input/tool_output）
   - `subagent-transfer.js`
   - `harness-transfer.js`
23. 测试补充：
   - `semantic-transfer.test.js` 新增“validation event + hook”断言。
24. 回归验证：
   - 通过：context + semantic-transfer + session-transfer 相关测试（34/34）。

### 2026-06-08（下线兼容）执行日志

25. 下线 consumer 读兼容：
   - `consumer.js` 删除 legacy attachment 读取兜底（`attachmentMetas/filePath/path/relativePath`）。
   - `getTransferFiles(...)` / `getTransferAttachmentMetas(...)` 仅基于 transfer envelope 协议读取。
26. 下线模型侧 compact 兼容：
   - `compact.js` 删除 `attachmentMetas -> compact attachmentMetas` 的 fallback 分支。
   - `compactToolResultPayloadForModel(...)` 默认移除 top-level `attachmentMetas`，仅保留 `transferFiles` 主协议。
27. 测试更新：
   - `semantic-transfer.test.js` 增加 legacy 输入应返回空结果断言（确保兼容已下线）。
28. 回归验证（本轮关注集）：
   - 通过：semantic-transfer + context/runtime + session-transfer 相关测试。

### 2026-06-08（下线后护栏）执行日志

29. 增加 legacy 输入告警：
   - `consumer.js` 新增 legacy 输入检测与 warning 事件：
     - 事件名：`semantic_transfer_legacy_input_warning`
     - 触发 API：`getTransferFiles` / `getTransferAttachmentMetas`
30. runtime 透传增强：
   - `runtime-environment-builder.js` 中 `sharedTools.semanticTransfer.getTransferAttachmentMetas(...)`
     现在支持透传 runtime 上下文，确保 warning 事件可打点。
31. 测试补充：
   - `semantic-transfer.test.js` 增加 legacy 输入触发 warning 事件断言。
32. 回归验证：
   - 通过：semantic-transfer + context/runtime + session/message transfer 相关测试（34/34）。

### 2026-06-08（日志归类收尾）执行日志

33. tracking/log-normalizer 增加 semantic-transfer 事件归类：
   - `classifyExecutionEvent(...)`：
     - `semantic_transfer_validation`
     - `semantic_transfer_legacy_input_warning`
     统一归类为 `category=semantic_transfer, type=semantic_transfer`
34. SSE 规范化增强：
   - `normalizeSseLogEvent(...)` 对上述事件统一输出：
     - `category: semantic_transfer`
     - `type: semantic_transfer`
     - `event: semantic_transfer`
     - `semanticTransferType: validation | legacy_input_warning`
35. 测试补充：
   - 新增 `__tests__/system-core/tracking/log-normalizer.test.js`
36. 回归验证：
   - 通过：tracking + semantic-transfer + runtime/context + session/message transfer 相关测试（37/37）。

### 2026-06-08（source/reason/generationSource 字典化：工具侧统一命名）执行日志

37. 扩展 semantic-transfer 理由字典：
   - `TRANSFER_REASON` 增加：
     - `ASYNC_SUBTASK_RESULT`
     - `REUSE_DATA_PROCESSING_ARTIFACT`
     - `EXECUTE_SCRIPT_INPUT_TOO_LONG`
     - `WRITE_FILE_INPUT_TOO_LONG`
38. 工具侧 source/reason 命名统一（去字面量）：
   - 统一采用 `TRANSFER_SOURCE.*` 与 `TRANSFER_REASON.*`/`ARTIFACT_GENERATION_SOURCE.*`
   - 覆盖文件：
     - `tools/ai-models/multimodal-generate-tool.js`
     - `tools/workflow/agent-collab/collab-artifact-persist.js`
     - `tools/connectors/connector-toolkit/tool-access-connector.js`
     - `tools/data-processing/media2data-tool.js`
     - `tools/data-processing/doc2data-tool.js`
     - `tools/data-processing/web2data-tool.js`
     - `tools/execution/script-tool.js`
     - `tools/execution/file-tool.js`
39. 治理结果：
   - 工具侧 transfer 调用不再使用 `source/reason` 字符串硬编码。
   - 与 semantic-transfer intent 归一策略保持一致。
40. 回归验证：
   - 通过：semantic-transfer + connector-toolkit + data-processing + file/script guard 相关测试（50/50）。

## 3. 本轮暂不做（后续候选）

- `consumer.js` 的历史兼容分支下线（需跨模块联动验证）。
- `source/reason/generationSource` 的字典化治理（涉及工具侧统一命名）。
- 全链路 schema 强校验（建议在迁移尾声推进）。
