# Noobot Coding Standard / Noobot 编码规范

> For AI coding only. Keep changes small and strict.  
> 仅供 AI 编程使用。规则从严，改动尽量小。

---

## 1. Naming / 命名规范

### EN
- **No single-letter names** (`t`, `i`, `x` are forbidden for variables and functions).
- Use descriptive, meaningful names that reflect purpose.

### 中文
- **禁止单字母命名**（`t`、`i`、`x` 等不允许用于变量和函数）。
- 使用描述性、有意义的名称，反映其用途。

---

## 2. Legacy Code / 历史兼容代码

### EN
- **No legacy compatibility code** unless explicitly required.
- Remove deprecated patterns when refactoring.

### 中文
- **禁止旧结构兼容代码**，除非明确要求保留。
- 重构时移除已废弃的模式。

---

## 3. Magic Strings / 魔法字符串

### EN
- **No magic strings in business logic**.
- Repeated or semantic strings (event names, statuses, tool IDs, provider names, etc.) must be extracted to constants/enums.
- Inline string literals are only allowed for one-off local values with clear meaning.

### 中文
- **业务逻辑中禁止使用魔法字符串**。
- 对于有业务语义或会复用的字符串（事件名、状态值、工具 ID、provider 名称等），必须提取为常量或枚举。
- 仅一次性、语义清晰的局部值允许内联字符串字面量。

---

## 4. Model Adapter Rules / 模型适配规范

### EN
- **Provider adapter logic must stay separated** (`dashscope`, `openai_compatible`, etc.).
- Do NOT force provider branches into one unified implementation just because the current payload appears similar.
- Keep independent adapter functions/classes per provider to avoid refactor regressions in multimodal fields.

### 中文
- **模型/供应商适配逻辑必须分开维护**（如 `dashscope`、`openai_compatible` 等）。
- 即使当前请求结构看起来一致，也**禁止强行归一实现**。
- 每个 provider 保持独立适配函数/类，避免多模态字段在重构中回归。

---

## 5. User-Facing Text / 用户可见文案

### EN
- **All user-facing text must be bilingual** (`zh-CN`, `en-US`).
- **No hardcoded UI/error text** in business logic. Use i18n keys.

### 中文
- **所有用户可见文案必须中英双语**（`zh-CN`、`en-US`）。
- **业务逻辑中禁止硬编码文案**，统一使用 i18n key。

---

## 6. Tool Documentation / 工具文档

### EN
- **Tool docs format**: "what it does + input + output".
- **Dispatcher tool descriptions** (except MCP) must use "can handle ... tasks", not "orchestrate/schedule ...".
- **Param docs format**:
  - With options: `a|b|c + short note`
  - No options: short note only

### 中文
- **工具描述格式**：做什么 + 输入什么 + 返回什么。
- **调度器工具描述**（MCP 除外）必须使用"可处理...任务"，不要写"调度/编排..."。
- **参数描述格式**：
  - 有可选项：`a|b|c + 简要说明`
  - 无可选项：仅简要说明

---

## 7. Frontend / 前端规范

### EN
- **Frontend must handle long content + mobile layout**.
- **Display limit != counter limit** (e.g., show last 10, count keeps increasing).

### 中文
- **前端必须适配长内容与移动端布局**。
- **展示条数限制不等于计数限制**（如只显示 10 条，但计数持续累加）。

---

## 8. Logging Standard / 日志规范

### 6.1 No `console.*` in Core Business Code / 核心业务代码禁止使用 `console.*`

#### EN
- Do NOT use `console.log`, `console.error`, `console.warn`, `console.info`, or `console.debug` in any core business module under `system-core/`.
- `console.*` output is unstructured, cannot be filtered or routed.
- Core business code should delegate logging to the designated logging infrastructure.

**Exceptions** (allowed to use `console.*`):
- `scripts/` — CLI tools and validation scripts
- `bootstrap/` — startup scripts (e.g., server start message)
- `tracking/` — the logging infrastructure module itself

#### 中文
- 禁止在 `system-core/` 下的任何核心业务模块中使用 `console.log`、`console.error`、`console.warn`、`console.info` 或 `console.debug`。
- `console.*` 输出非结构化，无法过滤或路由。
- 核心业务代码应将日志委托给指定的日志基础设施。

**例外**（允许使用 `console.*`）：
- `scripts/` — CLI 工具和验证脚本
- `bootstrap/` — 启动脚本（如服务器启动消息）
- `tracking/` — 日志基础设施模块本身

---

### 6.2 Use `errorLogger` for Structured Logging / 使用 `errorLogger` 进行结构化日志记录

#### EN
- All error and diagnostic logging in core modules MUST use the injected `errorLogger` instance.

**Injection Chain**:
```
BotManager (errorLogger)
  → SessionExecutionEngine (this.errorLogger)
    → runAgentTurn({ errorLogger })
      → loopState.errorLogger
        → executeToolCall({ errorLogger, userId, sessionId, parentSessionId })
```

**Usage Pattern**:
```javascript
// In function signature — always optional with null default
function myFunction({ ..., errorLogger = null }) {
  try {
    // business logic
  } catch (error) {
    // Non-blocking log (use void to not affect execution flow)
    if (errorLogger && typeof errorLogger.log === "function") {
      void errorLogger.log({
        source: "module-name",
        event: "error_type",
        error: error.message,
        stack: error.stack,
        userId,
        sessionId,
        parentSessionId,
        // ... other context
      });
    }
    throw error;
  }
}
```

#### 中文
- 核心模块中的所有错误和诊断日志必须使用注入的 `errorLogger` 实例。

**注入链路**：
```
BotManager (errorLogger)
  → SessionExecutionEngine (this.errorLogger)
    → runAgentTurn({ errorLogger })
      → loopState.errorLogger
        → executeToolCall({ errorLogger, userId, sessionId, parentSessionId })
```

**使用模式**：
```javascript
// 函数签名中 — 始终使用 null 作为默认值（可选参数）
function myFunction({ ..., errorLogger = null }) {
  try {
    // 业务逻辑
  } catch (error) {
    // 非阻塞日志（使用 void 不影响执行流程）
    if (errorLogger && typeof errorLogger.log === "function") {
      void errorLogger.log({
        source: "module-name",
        event: "error_type",
        error: error.message,
        stack: error.stack,
        userId,
        sessionId,
        parentSessionId,
        // ... 其他上下文
      });
    }
    throw error;
  }
}
```

---

### 6.3 Log Event Fields / 日志事件字段

| Field / 字段 | Required / 必填 | Description / 说明 |
|-------|----------|-------------|
| `source` | ✅ | Module name (e.g., "tool-runner", "engine", "media") / 模块名称 |
| `event` | ✅ | Event type (e.g., "tool_invoke_error", "llm_call_failed") / 事件类型 |
| `error` | ✅ | Error message string / 错误消息字符串 |
| `userId` | ✅ | Current user ID / 当前用户 ID |
| `sessionId` | ✅ | Current session ID / 当前会话 ID |
| `parentSessionId` | ✅ | Parent session ID (empty string if root) / 父会话 ID（根会话为空字符串） |
| `stack` | ⚠️ | Error stack trace (optional, for debugging) / 错误堆栈（可选，用于调试） |
| Additional context / 其他上下文 | ⚠️ | Any relevant business context (toolName, turn, etc.) / 任何相关业务上下文（工具名称、轮次等） |

---

### 6.4 Logging Levels / 日志级别

#### EN
- The `errorLogger` module handles log level routing.
- Core code should NOT implement its own level filtering — just call `errorLogger.log()` with appropriate `event` type.

#### 中文
- `errorLogger` 模块处理日志级别路由。
- 核心代码不应自行实现级别过滤 — 只需调用 `errorLogger.log()` 并传入适当的 `event` 类型。

---

### 6.5 Backward Compatibility / 向后兼容

#### EN
- All functions accepting `errorLogger` MUST use `= null` as default value to ensure backward compatibility with existing callers that don't pass this parameter.

#### 中文
- 所有接受 `errorLogger` 的函数必须使用 `= null` 作为默认值，以确保与未传递此参数的现有调用者的向后兼容性。

---

## 9. Pre-Merge Checklist / 提交前检查

### EN
- [ ] Build/syntax checks pass.
- [ ] zh/en keys are aligned.
- [ ] No single-letter names added.
- [ ] No magic strings added in business logic.
- [ ] No new hardcoded user text.
- [ ] Provider adapter branches are not over-unified.

### 中文
- [ ] 构建与语法检查通过。
- [ ] 中英文 key 对齐。
- [ ] 未新增单字母命名。
- [ ] 业务逻辑中未新增魔法字符串。
- [ ] 未新增硬编码用户文案。
- [ ] 未将 provider 适配分支强行归一。
