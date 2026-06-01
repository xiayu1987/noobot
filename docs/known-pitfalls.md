# Noobot 已知坑位（Known Pitfalls）

本文记录线上踩过且容易在重构时回归的问题。  
状态机相关请参考：`client/noobot-chat/docs/chat-state-machine.md`

---

## 1) 音频解析（DashScope / OpenAI-Compatible）坑

### 现象
- `media_to_data` 调用模型失败，报错：
  - `InternalError.Algo.InvalidParameter: The provided URL does not appear to be valid`
  - 或 `Invalid value: audio. Supported values are ...`

### 根因
1. **providerFormat 识别错误**  
   在 `invokeModelWithTextAndAttachments` 中把整个 `resolvedModelSpec` 传给了 `normalizeProviderFormat`，导致被误判为 `openai_compatible`。
2. **DashScope chat content block 对音频类型兼容性差异**  
   当前链路（LangChain + OpenAI-compatible endpoint）下，直接用 `type: "audio"` 不稳定；`input_audio` 更稳。

### 固化规则
- `invokeModelWithTextAndAttachments` 必须使用：
  - `normalizeProviderFormat(resolvedModelSpec.format)`
- 音频 attachment block：
  - DashScope：`type: "input_audio"`，`input_audio.data` 用 **Data URL**
  - OpenAI-compatible：`type: "input_audio"`，`data` 用 base64

---

## 2) 子会话工具调用路径串号坑（附件路径不存在）

### 现象
- `media_to_data` 提示：`文件不存在`
- 路径里 sessionId 与真实附件 scope 不一致（root session 与子 session 混用）

### 根因
- LLM 生成 tool 参数时把多个 UUID 字段（sessionId / parentSessionId / dialogProcessId）拼串，路径看起来“像真”但并非真实文件路径。

### 固化规则
- 工具侧不要完全信任 LLM 给出的绝对路径。
- 优先基于 `runtime.attachmentMetas`（`attachmentId/name/path`）回查真实路径并纠正。
- 允许 `file://` 输入时先归一化到本地路径再校验。

---

## 3) 重构前后回归检查建议

每次改动以下文件后，至少跑一次针对性验证：
- `agent/src/system-core/model/invoke/invoker.js`
- `agent/src/system-core/model/attachment/formatter.js`
- `agent/src/system-core/tools/data-processing/media2data-tool.js`

建议最小回归：
1. 上传 `webm` 音频走 `media_to_data`。
2. 检查是否命中正确 provider（`qwen3_5_omni_plus` + `dashscope`）。
3. 验证不会出现：
   - URL invalid
   - Invalid value: audio
   - RECOVERABLE_FILE_NOT_FOUND（路径串号）
