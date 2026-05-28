# AgentContext 当前数据结构

> 本文记录当前 `agentContext` 的运行时结构，便于 agent 主流程、tools、hook 与 harness 插件侧保持字段认知一致。  
> 依据代码：
> - `agent/src/system-core/context/index.js`
> - `agent/src/system-core/context/formatters/agent-context-mapper.js`
> - `agent/src/system-core/context/builders/runtime-environment-builder.js`
> - `plugin/noobot-plugin-harness/src/capabilities/handlers/shared/bucket-utils.js`
> - 重构跟踪（已办/代办）：[agent-context-refactor-tracker.md](./agent-context-refactor-tracker.md)

## 1. 总览

`agentContext` 由 `ContextBuilder` 构建，核心输出分为四个顶层域：

```js
{
  environment: {}, // 静态环境、工作区、身份信息
  execution: {},   // 本次执行元信息、模型、运行时控制器
  session: {},     // 根/父/当前 session 信息
  payload: {},     // 模型消息、工具注册表，以及插件扩展数据
}
```

主流程中的 canonical runtime 位于：

```js
agentContext.execution.controllers.runtime
```

工具构建阶段为了兼容旧调用，会临时传入：

```js
{
  ...agentContext,
  runtime: agentContext.execution.controllers.runtime,
}
```

因此新代码应优先读取 `execution.controllers.runtime`；只有在工具兼容场景下才依赖顶层 `runtime`。

## 2. 顶层结构

```ts
type AgentContext = {
  environment: EnvironmentContext;
  execution: ExecutionContext;
  session: SessionContext;
  payload: PayloadContext;

  // 非 canonical：部分工具构建/旧代码兼容时可能存在
  runtime?: RuntimeContext;
};
```

## 3. environment

静态环境信息来自 `_buildStaticAgentContext()` 与 `buildStaticInfo()`。

```ts
type EnvironmentContext = {
  os: {
    platform: string;    // process.platform 或静态解析结果
    arch: string;        // process.arch 或静态解析结果
    timezone: string;    // Intl.DateTimeFormat().resolvedOptions().timeZone
    nodeVersion: string; // process.version
  };

  workspace: {
    cwd: string;                  // 当前进程 cwd
    basePath: string;             // runtime base path
    workspaceDirectories: any[];  // 工作区目录解析结果
    globalDefaults: {
      workspaceRoot?: string;
      [key: string]: any;
    };
  };

  identity: {
    userId: string;
  };
};
```

## 4. execution

执行域保存本轮对话执行信息、模型信息与 runtime 控制器引用。

```ts
type ExecutionContext = {
  dialogProcessId: string;
  timestamp: string; // ISO 时间字符串

  flags: {
    allowUserInteraction: boolean;
    forceTool: false | string | Record<string, any> | any;
    maxToolLoopTurns: number;
  };

  models: {
    runtimeModel: string;
    allEnabledProviders: Record<string, any>;
  };

  controllers: {
    runtime: RuntimeContext;
  };
};
```

### 4.1 flags 来源

- `allowUserInteraction`：`runConfig.allowUserInteraction !== false`。
- `forceTool`：由 `resolveForceToolCall(systemRuntime.config)` 解析。
- `maxToolLoopTurns`：由 `safeNum(systemRuntime.config.maxToolLoopTurns)` 解析。

## 5. RuntimeContext

`RuntimeContext` 是主流程与工具/插件共享的可变运行时对象。canonical 路径为 `agentContext.execution.controllers.runtime`。

```ts
type RuntimeContext = {
  userId: string;
  basePath: string;

  globalConfig: Record<string, any>;
  userConfig: Record<string, any>;
  eventListener: any;

  sessionManager: any;
  attachmentService: any;
  botManager: any;
  userInteractionBridge: any;

  abortSignal: AbortSignal | null;

  runtimeModel: string;
  allEnabledProviders: Record<string, any>;

  sharedTools: SharedTools;
  hookManager: any | null;
  hooks: any | null;

  childAsyncResultContainers: any[];
  parentAsyncResultContainer: Record<string, any> | null;

  systemRuntime: SystemRuntimeContext;

  currentTurnMessages: any; // createCurrentTurnMessagesStore()
  currentTurnTasks: any;    // createCurrentTurnTasksStore()

  attachmentMetas: any[];

  // initializeRuntimeEnvironment() 后可能追加
  connectorChannels?: {
    databases: any[];
    terminals: any[];
    emails: any[];
  };
};
```

### 5.1 SharedTools

`initializeRuntimeEnvironment(runtime)` 会初始化或补齐以下共享工具：

```ts
type SharedTools = {
  fetch?: typeof fetch | null;

  textCleaner?: {
    cleanUniversal(input?: string, options?: Record<string, any>): string;
    cleanText(input?: string, maxLines?: number): string;
    cleanHtml(input?: string, options?: { url?: string; readable?: boolean }): string;
    cleanAny(input?: string, options?: { contentType?: string; url?: string }): string;
  };

  sessionCrypto?: {
    encryptBySessionId(payload?: Record<string, any>, sessionId?: string): string;
    decryptBySessionId(cipherText?: string, sessionId?: string): any;
  };

  connectorChannelStore?: any;
  connectorHistoryStore?: any;
  connectorEventListener?: any;

  browser?: any;
  browserInitError?: string;

  // runConfig.sharedTools 可透传更多字段
  [key: string]: any;
};
```

### 5.2 SystemRuntimeContext

`systemRuntime` 由 `buildDynamicInfo()` 生成，并在多个位置作为 session / dialog / runConfig 的运行时来源。

```ts
type SystemRuntimeContext = {
  userId?: string;
  sessionId?: string;
  caller?: string;
  parentSessionId?: string;
  rootSessionId?: string;
  dialogProcessId?: string;
  parentDialogProcessId?: string;

  now?: string;
  sessionTree?: Record<string, any>;

  config?: {
    selectedConnectors?: Record<string, any>;
    allowUserInteraction?: boolean;
    forceTool?: any;
    maxToolLoopTurns?: number;
    [key: string]: any; // runConfig 其他字段
  };

  [key: string]: any;
};
```

> 注意：`mapToAgentContextSchema()` 对 `systemRuntime` 字段做容错读取，所以具体 `buildDynamicInfo()` 增补字段时不需要同步改 mapper；但文档应随实际使用字段更新。

## 6. session

Session 域记录根会话、父会话与当前会话。

```ts
type SessionContext = {
  root: {
    id: string;
    tree: Record<string, any>;
    sharedState: Record<string, any>;
  };

  parent: {
    id: string;
    caller: string;
  };

  current: {
    id: string;
    connectors: Record<string, any>;
  };
};
```

字段来源：

- `root.id`：`systemRuntime.rootSessionId` 或已解析 root session id。
- `root.tree`：`systemRuntime.sessionTree` 或已解析 session tree。
- `parent.id`：`systemRuntime.parentSessionId` 或构建参数 `parentSessionId`。
- `parent.caller`：`systemRuntime.caller` 或构建参数 `caller`。
- `current.id`：`systemRuntime.sessionId` 或构建参数 `sessionId`。
- `current.connectors`：由 `systemRuntime.config.selectedConnectors` 归一化得到。

## 7. payload

Payload 是传模消息、工具列表和插件扩展数据的承载域。

```ts
type PayloadContext = {
  messages: {
    system: any[];  // composeSystemInfoSections() 生成的 system context
    history: any[]; // 会话历史转换后的 conversation messages
  };

  tools: {
    registry: any[];              // buildTools() 后写入
  };

  // harness 插件运行后可能存在
  harness?: HarnessPayloadBucket;

  [key: string]: any;
};
```

### 7.1 messages

- `payload.messages.system`：由 `_buildSystemContext()` 组装出的系统上下文消息数组。
- `payload.messages.history`：continue 模式下来自 session records，经过：
  1. `filterSummarizedMessages()`；
  2. `normalizeContextWindow()`；
  3. `toConversationMessages()`。
- initial 模式下 `history` 为空数组。

真正传给模型前，主流程还会在 `buildContextMessages()` 中对 `history` 再执行一次 `resolveModelContextMessages()`，用于按当前 `dialogProcessId`、tool-call pair 合法性等规则过滤。

### 7.2 tools

```ts
type PayloadTools = {
  registry: any[];             // 当前可用工具定义列表
};
```

`registry` 初始为空，随后由 `buildTools({ agentContext })` 返回值覆盖。

## 8. harness 插件扩展：payload.harness

`payload.harness` 使用独立文档维护，避免主文档过长：

- 详见：[harness-payload-structure.md](./harness-payload-structure.md)
- 主文档仅保留入口与高层约定。

## 9. 构建链路

### 9.1 initial

```text
AgentContextFactory.buildAgentContext(mode="initial")
  -> ContextBuilder.buildInitialContext()
    -> _buildSystemContext()
    -> _buildAgentContext(systemContext, [])
      -> buildRuntimeContext()
      -> initializeRuntimeEnvironment(runtime)
      -> mapToAgentContextSchema(...)
      -> buildTools(...)
      -> agentContext.payload.tools.registry = builtTools
```

### 9.2 continue

```text
AgentContextFactory.buildAgentContext(mode="continue")
  -> ContextBuilder.buildContinueContext()
    -> _resolveSessionRecords()
    -> _normalizeSessionRecordsForConversation()
    -> resolveLongMemory()
    -> _buildSystemContext({ longMemory })
    -> _buildAgentContext(systemContext, toConversationMessages(...))
      -> buildRuntimeContext()
      -> initializeRuntimeEnvironment(runtime)
      -> mapToAgentContextSchema(...)
      -> buildTools(...)
      -> agentContext.payload.tools.registry = builtTools
```

## 10. 读写约定

1. **runtime 读取优先级**：新代码优先读取 `agentContext.execution.controllers.runtime`。
2. **不要把 payload.messages.history 当作最终传模消息**：最终传模前还会经过 `resolveModelContextMessages()`。
3. **插件扩展应挂在 payload 下自己的 namespace**：例如 harness 使用 `payload.harness`，避免污染顶层。
4. **工具共享能力放在 runtime.sharedTools**：`payload.tools.shared` 兼容入口已删除。
5. **附件优先读 runtime.attachmentMetas**：`session.current.attachments` 兼容入口已删除，工具侧应回查 attachment metas。
6. **session.root.sharedState 当前默认 `{}`**：如需跨子会话共享状态，应先定义写入/持久化策略。
7. **优先使用 accessor 而非手写路径**：建议通过
   `context/agent-context-accessor.js` 的 `getRuntimeFromAgentContext()`、
   `getSystemRuntimeFromAgentContext()`、`getSessionIdsFromAgentContext()`、
   `getBasePathFromAgentContext()`、`getDialogProcessIdFromAgentContext()` 读取核心字段。

## 11. 兼容字段与收敛策略（已落地）

以下字段已完成兼容收敛并删除兼容入口：

1. `forceToolCall`（legacy 输入键）
   - 真值来源：`systemRuntime.config.forceTool`
   - 当前行为：runtime/config 中兼容入口已删除，仅在 `resolveForceToolCall()` 输入解析层保留兼容。
2. `execution.controllers.abortSignal`
   - 真值来源：`execution.controllers.runtime.abortSignal`
   - 当前行为：兼容入口已删除。
3. `execution.controllers.parentAsyncResultContainer`
   - 真值来源：`execution.controllers.runtime.parentAsyncResultContainer`
   - 当前行为：兼容入口已删除。
4. `session.current.attachments`
   - 真值来源：`execution.controllers.runtime.attachmentMetas`
   - 当前行为：兼容入口已删除。
5. `session.current.turnStore.currentTurnMessages/currentTurnTasks`
   - 真值来源：`execution.controllers.runtime.currentTurnMessages/currentTurnTasks`
   - 当前行为：兼容入口已删除。
6. `payload.tools.shared`
   - 真值来源：`execution.controllers.runtime.sharedTools`
   - 当前行为：兼容入口已删除。

## 12. Subagent RunConfig 透传约定（forceTool）

`delegate_task_async` 在向子会话透传 runConfig 时，force-tool 字段遵循以下规则：

1. 透传开关判断统一使用 `resolveForceToolCall()`：
   - 支持 `forceTool` / `forceToolCall`（以及 snake_case 兼容键）；
   - 任一显式为 `true` 即视为开启。
2. 父会话 force-tool 真值统一从 `systemRuntime.config` 通过 `resolveForceToolCall()` 解析。
3. 实际透传给子会话时同时写入：
   - `forceTool`（canonical）
4. 新代码统一读取 `forceTool`；`forceToolCall` 不再输出到 runtime/config/event。
5. `resolveForceToolCall(runConfig)` 仍保留用于外部配置输入解析兼容。
