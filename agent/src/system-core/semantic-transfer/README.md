# semantic-transfer

统一管理 Noobot 内部信息传递语义：支持**直接传递内容**与**文件/附件路径传递**，并通过一套 envelope + adapter 同时兼容新旧消费方。

---

## 1) TransferEnvelope（统一语义）

核心 envelope：

```js
{
  protocol: "noobot.semantic-transfer",
  version: 1,
  direction: "input" | "output",
  transport: "direct" | "file",

  // direct transport
  content: "...",

  // file transport 兼容快捷字段：默认等价 files[0]
  filePath: "...",
  attachmentMeta: {},

  // file transport 一等多文件语义
  files: [
    {
      filePath: "...",
      attachmentMeta: {},
      pathView: {
        displayPath: "...",
        sandboxPath: "...",
        hostPath: "...",
        relativePath: "..."
      },
      role: "primary" | "secondary",
      name: "result.md",
      mimeType: "text/markdown",
      size: 123
    }
  ],

  // files[0].pathView 的兼容快捷字段
  pathView: {},

  // 文件存储来源（不等于 transport）
  storage: {
    kind: "attachment" | "workspace" | "temp" | "external",
    attachmentSource: "model",
    generationSource: "workflow_node_agent_result"
  },

  meta: {
    source: "user" | "agent" | "tool" | "model" | "connector" | "plugin" | "service",
    producer: {
      type: "plugin" | "tool" | "agent" | "model" | "service",
      id: "...",
      name: "...",
      capability: "...",
      operation: "..."
    },
    reason: "...",
    mimeType: "text/plain"
  }
}
```

### 关键约定

- `transport=file` 时，`filePath` 应是调用方可读路径：
  - 沙箱模式优先为 `sandboxPath`
  - 非沙箱模式为正常工作路径
- `filePath` / `attachmentMeta` / 顶层 `pathView` 均为 `files[0]` 的兼容快捷字段。
- 多文件必须以 `files[]` 为主语义；legacy 侧可继续读取 `filePath` / `attachmentMeta`。
- `transport` 仅表示传递方式；`storage.kind` 表示文件存储位置/来源。
- `meta.source` 使用通用类别，不写具体插件名。
- 具体插件身份请落在 `meta.producer`、`generationSource`、`reason` 等扩展字段。

---

## 2) TransferResult（结果层统一）

新代码优先使用 `materializeOutputResult()` 或持久化函数返回的 `result` 字段：

```js
{
  ok: true,
  status: "direct" | "file" | "fallback_direct" | "skipped" | "failed",
  envelope: {},
  error: {
    code: "TRANSFER_ERROR",
    message: "...",
    details: {}
  },
  meta: {}
}
```

兼容行为：

- `materializeOutput()` 仍返回旧式 envelope。
- `persistTransferArtifacts()` / `persistTransferFile()` 仍保留 `attachmentMetas`、`filePath` 等 legacy 字段，同时新增 `result`。

---

## 3) Compat Adapter（兼容入口）

统一入口：`legacy-adapter.js`

```js
import {
  buildLegacyTransferCompat,
  buildLegacyOverflowFields
} from "./legacy-adapter";
```

### `buildLegacyTransferCompat({ envelope, envelopes })`

从 `TransferEnvelope` / `TransferEnvelopes` 统一派生 legacy 字段：

- `attachmentMeta`
- `attachmentMetas`
- `filePath`
- `filePaths`
- `files`

### `buildLegacyOverflowFields({ envelope, hostPath })`

统一派生 tool overflow legacy 字段：

- `overflow_file_path`
- `overflow_file_sandbox_path`

### 迁移原则（强约束）

- 新写入点：**先生成标准 TransferEnvelope**。
- 需要兼容旧消费方时：**只通过 legacy-adapter 派生 legacy 字段**。
- 禁止在业务代码中手工散落拼接：
  - `attachmentMetas`
  - `filePath`
  - `overflow_file_path`
  - `overflow_file_sandbox_path`

---

## 4) Policy（输出策略）

`materializeOutputResult()` 支持统一策略：

```js
policy: {
  prefer: "auto" | "direct" | "file",
  maxDirectChars: 8000,
  allowFallbackDirect: true,
  allowAttachmentPersist: true
}
```

---

## 5) 二进制内容支持

`persistTransferFile()` 支持：

```js
persistTransferFile({ content: "文本" })
persistTransferFile({ contentBase64: "AQID" })
persistTransferFile({ bytes: new Uint8Array([1, 2, 3]) })
persistTransferFile({ content: "AQID", contentEncoding: "base64" })
```

---

## 6) Validator（轻量校验）

```js
const { ok, errors } = validateTransferEnvelope(envelope);
if (!ok) { /* handle errors */ }

validateTransferEnvelope(envelope, { strict: true }); // invalid 时抛错
```

---

## 7) Session/Message 保留字段

为支持 UI、replay、workflow payload 渐进迁移，保留：

```js
message.transferEnvelope
message.transferEnvelopes
```

legacy `attachmentMetas` 继续兼容。

---

## 8) 兼容重构进展（持续更新）

### 已完成

- 新增统一兼容适配器：`legacy-adapter.js`。
- `semantic-transfer/index.js` 已导出 `legacy-adapter`，避免业务侧重复实现。
- `tool-runner` 的 tool result overflow 已改为 `buildLegacyOverflowFields()` 统一生成。
- `persistTransferArtifacts()` / `persistTransferFile()` 的 legacy 字段已收敛到 `buildLegacyTransferCompat()` 统一派生。
- 已落地新语义输出（并保留 fallback 兼容字段）：
  - `multimodal_generate`
  - `media2data`
  - `doc2data`
  - `agent-collab wait_async_task_result`
  - `connector/access_connector(email)`（透出 transfer 字段并保留 attachmentMetas）
- 新增单测：
  - `legacy adapter centralizes backward compatible file/overflow fields`
  - 覆盖兼容字段生成行为不回退。

### 落地清单（按步骤）

- [x] Step 1: 核心适配器统一
  - 完成 `legacy-adapter` 建设与导出。
  - 完成 `persistTransferArtifacts/persistTransferFile` 的 compat 派生收敛。
- [x] Step 2: 主链路写入点落地
  - 在 AI 产物、数据处理、协作工具等主链路输出 `transferResult/envelope(s)`。
  - 同步保留 legacy fallback 字段（`attachmentMetas/filePath/...`）。
- [x] Step 3: Connector Email 落地
  - `emailAttachmentHandler` 支持返回 `{ attachmentMetas, transferResult, transferEnvelope, transferEnvelopes }`。
  - `read-email` 与 `access_connector` 兼容旧数组返回并透出 transfer 字段。
- [x] Step 4: Session/Replay 全链路回归清单（增强版）
  - [x] session 持久化：`session-message-service-transfer.test.js`
  - [x] replay 恢复：`message-converter-transfer.test.js`
  - [x] workflow payload：`agent-collab-delegate-wait-flow.test.js`
  - [x] tool overflow 展示：`tool-runner.test.js`
  - [x] 兼容矩阵补充：
    - `connector-toolkit.test.js`（email: 仅 transfer / 新旧并存 / stdout 非 JSON fallback）
    - `artifact-service.test.js`（仅 transferEnvelopes / transferResult+legacy 去重 / 无效 JSON fallback）
    - `semantic-transfer.test.js`（resolver 异常容错 / 持久化服务缺失 fallback）
    - `tool-runner.test.js`（tool result overflow 兼容字段回归）

### Step 4 建议 CI 分组（可直接执行）

- `semantic-transfer`：
  - `node --test agent/__tests__/system-core/semantic-transfer/semantic-transfer.test.js`
- `artifact/replay`：
  - `node --test agent/__tests__/system-core/agent/core/artifact-service.test.js`
  - `node --test agent/__tests__/system-core/session/session-message-service-transfer.test.js`
  - `node --test agent/__tests__/system-core/context/message-converter-transfer.test.js`
- `workflow/overflow/connectors`：
  - `node --test agent/__tests__/system-core/tools/agent-collab-delegate-wait-flow.test.js`
  - `node --test agent/__tests__/system-core/agent/core/tool-runner.test.js`
  - `node --test agent/__tests__/system-core/tools/connector-toolkit.test.js`

### 下一步

- 持续坚持“新语义优先消费，legacy 仅 fallback 输出”。
- 后续新增链路默认纳入 Step 4 CI 分组，避免回归退化。

### 后续计划（暂不执行）

- 引入兼容开关（例如 `SEMANTIC_TRANSFER_LEGACY_COMPAT`），用于灰度验证“完全语义化消费链路”。

---

## 9) 迁移速查（新旧字段映射）

| 新语义来源 | legacy 输出 | 说明 |
| --- | --- | --- |
| `envelope.files[0].filePath` | `filePath` | 主文件快捷字段 |
| `envelope.files[*].filePath` | `filePaths` | 多文件路径 |
| `envelope.files[0].attachmentMeta` | `attachmentMeta` | 主文件附件元信息 |
| `envelope.files[*].attachmentMeta` | `attachmentMetas` | 多文件附件元信息 |
| `envelope.files` | `files` | 兼容文件列表 |
| `envelope/pathView + hostPath` | `overflow_file_path` / `overflow_file_sandbox_path` | overflow 展示兼容字段 |

> 建议：新代码仅消费 `TransferEnvelope` / `TransferResult`；legacy 字段仅作为过渡输出，不作为新能力输入。
