# Noobot 浏览器协议闭环自动化测试方案

## 1. 目标与原则

本文定义一套基于 Playwright 的真实浏览器自动化验收方案，覆盖：

- Session 创建、持久化、刷新和并发版本控制
- `turn.send`、`turn.resend`、`turn.continue`、`turn.stop`
- 权威 Turn Lifecycle、receipt、reconnect 和实时事件投影
- 用户停止、模型消息快照以及停止后继续
- 无附件、带附件、附件保留、增加、删除和快照恢复
- Harness 插件连接、Hook、Context Snapshot 和辅助模型调用
- Workflow 根执行、子执行、附件传递以及与 Harness 的联合运行
- 多标签页、断网重连、并发停止和非法协议拒绝

测试必须验证完整数据链，而不只是页面是否看起来正常。每个业务操作都必须同时满足：

```text
浏览器状态正确
AND WebSocket 协议正确
AND 生命周期正确
AND Session 持久化正确
AND 停止快照正确
AND 附件事实正确
AND Harness/Workflow 记录正确
AND 无禁止错误
```

遵循以下工程原则：

1. 浏览器是业务操作的唯一发起者；文件系统、HTTP、WebSocket 和日志只用于取证及断言。
2. 每条用例创建独立 Session，不依赖人工 Session，不与其他用例共享业务状态。
3. Agent Transport、Turn Lifecycle、Session、附件和 Context 各自只有一个权威协议。
4. 不允许 UI 定时推断后端业务状态，不允许用 WebSocket close 推导 Turn 终态。
5. 不允许测试依赖产品中的旁路、兼容分支或测试专用业务接口。
6. 测试失败必须保留足以复现和定位问题的浏览器、协议及持久化证据。

## 2. 代码协议入口

测试实现应直接以以下代码为协议事实源：

- Agent Transport 命令构造和校验：`agent-transport-protocol/src/commands.js`
- Agent Transport 命令及协议版本：`agent-transport-protocol/src/constants.js`
- Turn Lifecycle 和 receipt：`event-protocol/src/turn-lifecycle-protocol.mjs`
- 浏览器 WebSocket 分派：`client/noobot-chat/src/infrastructure/websocket/chatWebSocketClient.js`
- reconnect 协调与投影：`client/noobot-chat/src/modules/chat/runtime/session/reconnectCoordinator.js`
- 编辑重发事务：`client/noobot-chat/src/modules/chat/runtime/engine/resendTransaction.js`
- 前端附件序列化：`client/noobot-chat/src/modules/chat/runtime/engine/attachmentSerialization.js`
- 停止快照存取：`agent/src/runtime/resume/model-message-snapshot-store.js`
- Harness 运行路径：`plugin/noobot-plugin-harness/src/core/context.js`
- Harness Context Snapshot：`plugin/noobot-plugin-harness/src/tracing/buffer-manager.js`
- Harness 默认配置：`plugin/noobot-plugin-harness/src/core/options.js`

协议版本基线：

| 协议                   | 当前版本/事件                     |
| ---------------------- | --------------------------------- |
| Agent Transport        | `protocolVersion: 2`              |
| Turn Lifecycle         | `protocolVersion: 4`              |
| Lifecycle transport    | `transportProtocolVersion: 3`     |
| Lifecycle wire event   | `turn_lifecycle`                  |
| Lifecycle receipt      | `action: turn.lifecycle.received` |
| Model Context Snapshot | `version: 2`                      |

版本变化时应同步修改协议库、生产代码和本文断言，不得在测试中接受多个版本。

## 3. 建议目录结构

```text
client/noobot-chat/tests/e2e/protocol/
├── fixtures/
│   ├── auth.fixture.js
│   ├── noobot.fixture.js
│   ├── session.fixture.js
│   ├── protocol-capture.fixture.js
│   └── artifacts.fixture.js
├── helpers/
│   ├── browser-actions.js
│   ├── websocket-capture.js
│   ├── http-capture.js
│   ├── lifecycle-assertions.js
│   ├── session-assertions.js
│   ├── snapshot-assertions.js
│   ├── attachment-assertions.js
│   ├── harness-assertions.js
│   ├── workflow-assertions.js
│   └── log-assertions.js
├── specs/
│   ├── 002-send-no-attachment.spec.js
│   ├── 006-continue-from-snapshot.spec.js
│   ├── 007-attachment-continue.spec.js
│   ├── 008-repeated-stop-continue.spec.js
│   ├── 013-reconnect.spec.js
│   ├── 015-multi-page.spec.js
│   ├── 016-harness.spec.js
│   ├── 021-session-refresh.spec.js
│   ├── 023-concurrency.spec.js
│   ├── 025-offline-reconnect.spec.js
│   ├── 026-invalid-protocol.spec.js
│   ├── 027-plugin-protocol.spec.js
│   ├── 029-session-protocol.spec.js
│   ├── 030-local-session-refresh.spec.js
│   └── 031-workflow-lifecycle.spec.js
└── playwright.protocol.config.js
```

每次执行单独输出证据：

```text
test-results/protocol/<run-id>/
├── browser-console.jsonl
├── websocket-sent.jsonl
├── websocket-received.jsonl
├── http-requests.jsonl
├── http-responses.jsonl
├── lifecycle.json
├── session-audit.json
├── snapshot-audit.json
├── attachment-audit.json
├── harness-audit.json
├── workflow-audit.json
├── model-context-audit.json
├── screenshot-final.png
└── trace.zip
```

认证凭证只能由 fixture 在运行时读取，禁止写入日志、截图、trace 或测试报告。

## 4. 统一协议捕获与断言

### 4.1 WebSocket 发出帧

每个业务命令必须通过 Agent Transport Protocol v2。统一断言：

- `protocolVersion === 2`。
- 业务命令只能使用 `turn.send`、`turn.resend`、`turn.continue`、`turn.stop`。
- 不允许旧的 `action: send/continue/stop` 业务协议。
- 不允许未知顶层字段或命令类型不允许的字段。
- `commandId` 非空，并且在一次业务操作中唯一。
- `identity.sessionId` 等于浏览器当前 Session。
- `identity.turnScopeId` 为规范 `client-turn:*`。
- run 命令的 `expectedTurnRevision === 0`。
- stop 命令的 `expectedTurnRevision >= 1`。
- `input.attachments` 必须始终是数组。
- Continue 来源只能位于 `continuation.dialogProcessId/turnScopeId`。
- receipt 必须使用 `turn.lifecycle.received`，不得使用业务命令替代确认。

### 4.2 WebSocket 接收帧与 Lifecycle

自然完成的基本顺序：

```text
turn.action_accepted
  → turn.processing_started
  → turn.processing_completed
  → turn.completed
```

用户停止的基本顺序：

```text
turn.processing_started
  → turn.stop_accepted
  → turn.stop_processing_completed
  → turn.stop_completed
```

统一断言：

- `eventId` 非空且同一 Turn 内不重复。
- `sequence` 严格单调递增，`revision` 不倒退。
- `sessionId/dialogProcessId/turnScopeId` 与命令身份一致。
- 浏览器对每个合法 lifecycle 发出一次 receipt。
- 同一 lifecycle 不得被业务 reducer 重复消费。
- Stop 显示只能来自权威 lifecycle/snapshot 投影出的 `canStop`。
- 终态只能由权威 lifecycle 或 snapshot 确认。
- WebSocket close 只能是传输事实，不能成为业务终态。
- reconnect 控制事件只归 reconnect handler，活动 run 事件只归 active stream。

### 4.3 Session 审计

每条用例结束后审计：

```text
workspace/<userId>/runtime/session/<sessionId>/
├── session.json
├── session-summary.json
├── execution.json
├── turns/
├── execution-events/
├── model-message-snapshots/
└── events/
```

断言：

- 浏览器、Transport 和持久化目录的 userId/sessionId 完全一致。
- 每个 run 的 `dialogProcessId + turnScopeId` 唯一。
- 同一 Turn 不得存在两套 active 事实。
- Resend 的旧 Turn 和 replacement 关系明确，且不会同时 active。
- `aggregateVersion` 单调增长。
- UI 可见消息与持久化可见消息语义一致。
- hydration 不得自造后端不存在的 lifecycle 或 persistence 字段。

### 4.4 停止快照审计

快照路径：

```text
workspace/<userId>/runtime/session/<sessionId>/model-message-snapshots/
<dialogProcessId>__<turnScopeId>.json
```

断言：

- `version === 2`。
- `sessionId/dialogProcessId/turnScopeId` 与停止轮次一致。
- `messageBlocks.system/history/incremental` 都是数组。
- 每个 block 元素都是 plain object，整个文件可 JSON 序列化。
- 不含函数、class instance、Proxy 或 Vue reactive 对象。
- `messages` 与 `messageBlocks` 的投影一致。
- `updatedAt >= createdAt`。
- 日志存在 `stopped_model_message_snapshot_saved`。
- 不存在 `stopped_model_message_snapshot_save_failed`。
- Continue 必须加载其 `continuation` 指定的停止快照。

### 4.5 附件事实审计

附件链路必须唯一：

```text
浏览器 File
  → contentBase64
  → HTTP/WS command
  → Service canonical attachment
  → Session user message
  → Agent attachment metadata
  → Model Context
  → Stop snapshot
  → Continue 恢复
```

断言：

- 浏览器原始文件使用固定内容并预先计算 SHA256。
- `name/mimeType/size/contentSha256` 在全链路一致。
- `clientAttachmentId` 只负责上传关联。
- 持久化后必须产生且只产生一个 canonical `attachmentId`。
- Model Context 使用持久化 `attachmentId/path`。
- Continue 命令不得重复发送停止快照中的附件。
- Continue Model Context 必须从 snapshot 恢复附件。
- 被用户删除的附件不得进入新 Turn 的 Model Context。
- 附件路径必须位于当前用户、当前 Session 的 scoped 目录。

### 4.6 Harness 审计

运行目录：

```text
workspace/<userId>/runtime/harness/runs/<dialogProcessId>/
├── harness-run.json
├── context-snapshot.json
├── events.jsonl
├── prompts.jsonl
├── policy-checks.json
└── capability-traces.jsonl
```

断言：

- `selectedPlugins` 精确等于浏览器实际选择的插件。
- Harness run ID 等于 `dialogProcessId`。
- manifest 身份与 Session/Turn 一致。
- Hook 顺序合法，开始和结束事件成对。
- 用户停止时最终状态为 `abort`，自然完成时为 `success`。
- Context Snapshot 可以独立解析。
- runtime/tool 实例不得写入 Agent Context envelope。
- 辅助模型调用写入 `capability-traces.jsonl`，且与主模型身份可区分。

## 5. 浏览器自动化测试用例

### PBE-002：无附件普通发送

步骤：生成唯一测试 run ID，打开 Noobot UI，完成连接并通过 UI 创建新 Session；选择 Harness，输入唯一消息，点击发送，捕获 `turn.send`，等待 Stop 出现并等待自然完成。

断言：收到 `transport_ready`；Session ID 非空且浏览器、HTTP 和持久化身份一致；只有一个 `turn.send`；`input.attachments` 为 `[]`；生命周期自然完成；UI 不再 sending；Session 只有一个对应 user turn；Harness run 为 success；没有停止快照；控制台无 error；不存在旧 reconnect cursor 字段。

### PBE-006：无附件停止后继续

步骤：发送持续执行请求，等待 `processing_started`，点击 Stop，等待 `stop_completed` 并读取首个快照；在 Continue 输入框输入唯一提示，点击 Continue，等待新 run 启动后再次 Stop。

断言：首次 Stop identity 和 revision 正确且只发一次；首个快照身份一致、所有 block 为 plain object；Continue 使用新的 command/dialog/turn identity；`continuation` 精确引用旧停止轮次；`input.attachments` 为 `[]`；恢复旧快照内容；第二次 Stop 只停止新 run；Session 为 `user_stopped`；不存在 `socket_close` 或 Context envelope 错误。

### PBE-007：带附件停止后继续

步骤：上传附件并发送后 Stop，审计初始快照；点击 Continue，读取 Continue Model Context，然后再次 Stop。

断言：初始 Send 附件数为 1，初始快照 identity 与 Send 一致；Continue 命令附件数为 0；Continue Context 附件数为 1；文件名、SHA256、canonical ID 和持久化路径正确；两份停止快照均含附件元数据。

### PBE-008：连续三次停止和继续

步骤：依次执行 Send→Stop→Continue→Stop→Continue→Stop→Continue→Stop，收集全部 identity、lifecycle 和快照。

断言：四轮 identity 均唯一；每次 Continue 只引用前一停止轮次；每轮事件单调且不串线；四份停止快照一一匹配；旧轮 Stop 不得停止新轮；snapshot query cleanup 不得关闭 run 连接。

### PBE-009～012：编辑重发附件状态链（并入 PBE-029）

保留、移除和新增附件的编辑重发均在同一个 PBE-029 Session 中按 `attached -> retained -> removed -> added` 顺序验证；独立 Session 用例已删除。

### PBE-013：活动轮次刷新页面 reconnect

步骤：启动长运行，记录 lifecycle sequence，刷新页面，捕获 reconnect、`reconnect_data` 和 `reconnect_complete`，确认 Stop 可见并停止原轮次。

断言：reconnect 带 `knownLifecycleSequenceMap`；不带已删除的消息 cursor；authority baseline 在 live buffer 前提交；snapshot 后只回放 tail；UI 只投影一次 active Turn；重连后 Stop 正常。

### PBE-014：reconnect 与新 run 并发

步骤：页面连接后立即触发 reconnect，未完成时立即发起 Resend 或 Continue，捕获 lifecycle，等待 Stop 并停止。

断言：reconnect 控制事件只归 reconnect handler；run lifecycle/delta 只归 active stream；`turn.action_accepted` 不丢失、不重复；原页面 Stop 立即可用；snapshot query cleanup 不关闭 run connection；不存在 `socket_close`。

### PBE-015：双标签页生命周期一致性

步骤：两个独立浏览器 Context 打开同一 Session，A 发起 Send，B 点击 Stop，比较双方事件和最终 UI。

断言：双方收到相同 eventId/sequence；每个 socket 各发 receipt；只产生一条权威 Stop；双方最终为 user_stopped；Session 只有一个终态；关闭一端不会终止另一端链路。

### PBE-016：Harness 插件连接

步骤：只选择 Harness，发送简单请求，捕获 `preferences.selectedPlugins`，等待完成并读取 Harness 目录。

断言：选择结果精确为 `['harness']`；Agent 加载结果一致；run 目录以 dialogProcessId 命名；manifest、Context Snapshot 和 events 存在；不得通过默认分支启用未选择插件。

### PBE-017：Harness Hook 与 Model Context

步骤：开启 Harness trace、Context Snapshot 和 prompts，发送会触发工具调用的请求，工具开始后 Stop，读取 Harness、Agent Context debug 和模型快照。

断言：非模型 Hook 不携带 Model Context；`before_llm_call` 使用 Model Context v2；bindings 不进入 envelope；Harness mutation 使用规范 Context 命令；所有 block 为 plain object；prompt 只有一个权威存储。

### PBE-021：自然完成后刷新 Session

步骤：等待普通 Send 自然完成，记录 UI，刷新页面并等待 reconnect/hydration，再比较状态。

断言：刷新前后消息语义一致；已完成轮次不会重回 sending；不产生新 run、dialogProcessId 或 `aggregateVersion`；hydration 不制造业务事实。

### PBE-022：停止后关闭浏览器，再打开并继续

步骤：带附件 Send 后 Stop，关闭整个浏览器 Context，新建 Context 并重新打开同一 Session，点击 Continue，再 Stop。

断言：Continue 只依赖持久化事实；命令附件数为 0；Model Context 恢复附件；Stop 正常；不创建旁路 snapshot；不出现非法 Context envelope。

### PBE-023：Session aggregateVersion 冲突

步骤：两个页面打开同一 Session，A 先完成编辑重发，B 使用旧页面版本再次重发，观察 409 和权威刷新流程。

断言：旧版本 mutation 不提交；不得忽略 `expectedAggregateVersion`；不得创建本地伪 replacement；最终 replacement chain 唯一；`aggregateVersion` 单调增长。

### PBE-024：停止命令幂等性

步骤：两个页面近乎同时点击 Stop，捕获两次请求结果，等待终态并审计 lifecycle 和快照。

断言：只有一个 stop transition 被接受；只生成一个 `stop_completed` 和一份匹配快照；第二次请求获得明确 revision/terminal 结果；不得通过吞错伪造成功。

### PBE-025：断网重连后停止

步骤：启动长运行，设置浏览器离线，等待后恢复在线，完成 reconnect，确认原 run active 并点击 Stop。

断言：断网不生成 Turn failed 或 user_stopped；close 只属于 transport；snapshot 恢复原 run；最终终态来自 `turn.stop_completed`。

### PBE-026：非法和旧协议拒绝

该用例使用浏览器创建的原始测试 WebSocket，不经产品 UI 注入业务状态。

步骤：分别发送旧 `action: continue`、未知顶层字段、缺少 continuation identity 的 Continue、revision 为 0 的 Stop。

断言：全部明确失败；不创建 Turn、lifecycle 或 snapshot；不进入兼容 route；Proxy 不自动补字段；错误来自唯一协议 validator。

### PBE-027：Manifest V2 激活与 runtime-events 身份闭环

步骤：只选择 Harness，通过 UI 发起并停止一轮请求，读取 runtime-events 与 execution-events 中的插件协议事件。

断言：插件激活和贡献事件使用唯一插件协议版本；Session、dialog、Turn identity 在事件顶层与协议 data 中一致；runtime 与 execution 投影引用同一业务事实。

### PBE-028：Workflow + Harness 带附件统一协议

步骤：选择 Workflow + Harness，上传固定附件，要求一个 Workflow 子 Session 读取其精确内容并自然完成；读取插件事件、根 Session 附件索引、子 Session 模型调用和子 Session 附件索引。

断言：根 Session 只有一个 canonical 用户附件；Workflow 子 Session 通过规范 Session transfer 获得独立 child attachmentId，名称和来源保持一致且所有权切换为子 Session；子 agent 产生文件，根 model 附件索引同时包含 `workflow_node_agent_result` 和 `workflow_completed_attachment_summary`，前端 assistant 文件卡名称集合与索引完全一致，刷新后保持一致；Workflow 与 Harness 的 runtime/execution 插件身份闭合；根生命周期自然完成。

### PBE-029：统一 Session 协议闭环审计

步骤：使用浏览器在同一预分配 `sessionId` 下依次执行带附件 Send、Stop、保留附件 Resend、Stop、Continue、Stop、移除附件 Resend、新增附件 Resend，并读取 WebSocket 命令、lifecycle、Session manifest、Turn journals、runtime-events、execution-events 和模型停止快照。

断言：所有业务命令只使用 `commandId`；聚合并发只使用 `expectedAggregateVersion`；Turn 并发只使用 `revision/expectedTurnRevision`；事件顺序只使用 `sequence`；Session 身份只使用 `sessionId`。Session manifest 只含 `aggregateVersion`，每条消息有唯一 `messageUid`，每个 Turn 由 `(sessionId, turnScopeId)` 唯一定位。禁止出现 `backendSessionId`、`expectedVersion`、`expectedSessionVersion`、`sessionVersion`、`snapshotVersion`、`committedVersion`、`idempotencyKey` 或 Session-only/Dialog-only 缓存身份。每个停止轮次只有一个权威终态和一个 plain-object 模型快照，runtime-events 与 execution-events 的身份链闭合。

### PBE-030：未 provision Session 刷新

步骤：连接后新建一个尚未发送消息的本地 Session，记录当前历史 Session 集合和本地预分配身份，随后刷新浏览器并等待自动连接完成。

断言：本地预分配身份不进入可恢复 URL；刷新不显示“会话不存在”；未 provision 的本地草稿可以丢弃；刷新前的全部持久化 Session 仍在列表中；刷新后的 URL 若包含 `sessionId`，该身份必须来自后端权威列表且不得等于已丢弃的本地身份。

### PBE-031：Workflow 运行中停止并继续

步骤：选择 Workflow + Harness，发送包含多个顺序子任务的 Workflow；等待子 Session 的真实模型调用开始后停止根执行，再从同一 Session 发送继续请求并等待自然完成。

断言：停止和继续各自只有一个权威终态；Continue 显式引用被停止 Turn；Workflow 根执行、子 Session、子 Turn identity 不串线；模型调用观测来自根 Session execution event tree 中唯一的 `model_context_trace/llm_invoke_messages` 协议，且 `authority=model_invoke_port`。每个实际 provider 调用只有一个 `invocationId`，同一 `modelInstanceId` 的 `invocationSequence` 严格单调。

### PBE-032：Workflow 与普通消息连续切换

步骤：在同一 Session 中依次完成 Workflow 消息、无插件普通消息、第二条 Workflow 消息。

断言：三轮均使用独立 Turn identity；插件选择严格为 `workflow+harness -> [] -> workflow+harness`；两个 Workflow 根生命周期均携带 executionId 并自然完成；普通消息由根 Session 模型处理，两个 Workflow 分别产生不同子 Session 模型调用；每条模型调用必须来自 `authority=model_invoke_port`，消息的角色计数、dialog 分组、messageId 缺失数、content hash、预览和截断数量闭合。

### PBE-033：Harness 低轮次完整流程

步骤：从 Harness UI 设置 guidance analysis 强度并启用 planning/acceptance；测试通过正式 `update:pluginModelConfig` 参数边界设置仅供 E2E 使用的低轮次阈值，再驱动五步依赖工具链，同时捕获辅助模型和主模型调用。生产界面不展示 summary、plan update 和 phase acceptance 阈值。

断言：transport 中只有 `pluginModelConfig.harness` 的正式字段；planning、guidance analysis、plan revision/refinement、summary、phase acceptance、semantic validation 和 review 都形成 decision/execution 事实；阈值事件记录 `thresholdSource=runtime`；Harness summary 生成后唯一 Session checkpoint、消息 `summarized` 标记和 capability 模型观测闭合；辅助调用具有明确 purpose，主模型与辅助模型身份可区分，capability trace start/end 成对；主业务严格执行五次 `execute_script`，不得在小结后重做计算链。

### PBE-034：主 Agent 低轮次阶段小结

步骤：不选择 Harness，通过核心 Composer 正式参数边界设置仅供 E2E 使用的低轮次主流程小结阈值，发送三步依赖工具链；阈值达到后由主流程注入阶段小结要求，小结后继续完成第三步。生产界面不展示该阈值。

断言：`phase_summary_required`、`summary_checkpoint_committed` 和 `turn.completed` 依次发生；唯一 checkpoint receipt 与 Turn journal 的 `summarized=true` 消息对应且不拆分 tool call/result；checkpoint 后的主模型输入不再含已小结消息，阶段小结 marker 不累积；全程严格产生三次业务工具调用和一次 `task_summary`。

### PBE-035：周期任务检查

步骤：测试通过 Composer 正式参数边界降低 `taskCheckLoopTurns` 和 `phaseSummaryLoopTurns`，执行五步顺序工具链，再发送一条依赖上一轮结果的普通消息。生产界面不显示任何主流程阈值控件。

断言：`task_check_required` 每次只对应一个模型输入 marker 且下一轮不残留；`task_check` 输入遵循 `NOOBOT_TASK_CHECK/1`，结果只含协议回执且不保存附件；最后一次 checkpoint 前的最新检查 call/result 不被标记为已小结，思考面板展示本轮最新检查摘要，下一轮 history 仍包含该工具结果。

### PBE-042：停止后同页立即编辑重发

步骤：发送消息并等待 `processing_started`，点击 Stop 并等待 `stop_completed`；保持当前页面和连接，不刷新、不重连、不重新加载 Session 详情，立即编辑最新用户消息并提交重发。

断言：停止提交后的持久化 Session `aggregateVersion` 已推进；紧接着的 `replace-turn.expectedAggregateVersion` 精确等于该版本且 HTTP 成功；随后产生唯一 `turn.resend` 和对应的 `turn.processing_started`。不得依赖刷新或冲突后的重新水合修复前端并发版本。

### PBE-036：全工具、实时思考明细与交互结果闭环

步骤：启用 Harness 真实 guidance analysis 并关闭 planning/acceptance，顺序调用本场景声明的安全业务工具集合 `write_file/read_file/search/patch_file(dryRun)/execute_script/list_skills/user_interaction`；持续采样实时思考面板，在交互卡片填写固定必填值，完成后打开思考详情。模型/provider 未产生工具调用前文本时不得伪造主模型思考内容。

断言：execution-events 中工具集合严格相等，调用参数、成功结果和 `toolCallId` 一一闭合；`write_file` 的权威 `writtenFiles` 与 Turn journal、运行中/运行中刷新/完成前刷新/完成后刷新四个时点的前端生成文件卡数量和文件键集合一致；实时思考内容至少发生两次变化，分析与执行区域都有内容；实时面板最近 10 条执行日志窗口内的调用/返回均可展开，详情面板完整 7 对调用/返回均可展开且明细非空；思考内容实时展示；交互标题、字段、提交值、工具返回和最终模型回答闭合。

### PBE-044：多次工具停止继续与快照恢复闭环

步骤：先执行一个单工具命令并自然完成；随后在同一 Session 发起八步顺序工具链，观察到多个真实工具结果后停止，通过 Continue 恢复；再次观察到多个新工具结果后停止，再次 Continue 并自然完成剩余步骤。

断言：两次 Stop 各自产生且只产生一份版本 2 模型快照；快照的 system/history/incremental 分块与扁平 messages 完全一致，序列化消息字段符合 `context-protocol`，assistant tool call 与 tool result 不拆对。测试使用正式 `hydrateModelContextSnapshot` 和 `projectRecoveredMessagesToIdentity` 恢复每份快照；已完成 history 保留其原轮次身份，被停止的 incremental 统一重绑定到新 Turn identity；恢复后的完整 provider 消息指纹必须成为对应 Continue 第一次 `agent.main` 实际输入的精确前缀。三段工具执行合计恰好八次且每个调用结果成功配对，状态文件最终为 step=8，最后一轮产生自然完成终态。

### 模型调用唯一观测边界

模型输入观测发生在模型 factory 返回的 observed model 端口，并紧邻底层 provider `invoke()`。
这是主 Agent、retry、streaming、tool binding、capability、memory、MCP、协作和数据处理调用的
共同边界。业务分支不得自行发送 `llm_invoke_messages`，不得用 capability trace、HTTP header、
stream callback 或 retry 日志替代这一事实源。输入必须是消息数组；字符串 prompt 属于协议错误，
不得在端口内转换或 fallback。

每条权威记录至少包含：

```text
protocolVersion
authority = model_invoke_port
modelInstanceId
invocationId
invocationSequence
model(alias/name/format/streaming/boundToolCount)
invocation(flow/purpose/domain)
messages(count/roles/dialogGroups/missingDialogIdCount/missingMessageIdCount/preview/truncated)
```

审计时以 `invocationId` 判断调用唯一性，不以消息 hash 或文本近似去重；以
`modelInstanceId + invocationSequence` 检查实例内顺序。主 Agent 输入还需与 Context 的 system、
history、incremental 组装及小结策略结果闭合；辅助模型允许没有 Session messageId，但其
`missingMessageIdCount` 必须与 preview 和 truncated 数量闭合。

## 6. Debug 日志和禁止错误

协议测试环境应启用并收集以下 debug 类型：

- `agent-context-protocol`
- `agent-context`
- `context-identity`
- `agent-transport`
- `workflow-diagnostics`
- state machine/reconnect diagnostics
- Harness trace、prompts、Context Snapshot 和 capability traces

日志查询必须按本用例的 `sessionId/dialogProcessId/turnScopeId` 过滤，禁止用全局历史错误判断当前用例失败。

以下错误在当前用例时间窗内一旦出现即失败：

- `invalid agent context envelope`
- `must be a plain object`
- `socket_close` 被归类为业务或 Hook 致命错误
- `authoritative_snapshot_failed`
- `snapshot_timeout`
- lifecycle sequence/revision 回退
- duplicate canonical attachment
- Session identity conflict
- reconnect transaction 未完成或被错误替代

用户 Stop 导致的 `HOOK_EXECUTION_FAILED` 只有在错误类型明确为 `user_stop`、生命周期最终为 `turn.stop_completed` 且快照保存成功时才属于合法中止表示。

## 7. 执行分层

建议提供三个入口：

```bash
# 连接、发送、停止、继续
npm run test:e2e:protocol:smoke

# Session、快照、附件、reconnect、Harness
npm run test:e2e:protocol:core

# Workflow、多标签、断网、并发和负向协议
npm run test:e2e:protocol:full
```

推荐分组：

| 级别      | 用例                                            |
| --------- | ----------------------------------------------- |
| Smoke     | PBE-002、006                                    |
| Core      | PBE-007～014、016、017、021、022、027、029、030 |
| Full-only | PBE-015、023～026、028、031～036、044          |

## 8. CI 失败产物要求

每个失败用例必须保留：

- Playwright trace 和最后截图
- 浏览器 console error/warning
- WebSocket 收发帧
- HTTP replace-turn 请求和响应
- Session 审计摘要
- 生命周期和 receipt 审计摘要
- 模型停止快照审计摘要
- 附件 identity/SHA/path 审计摘要
- Harness 和 Workflow 审计摘要
- 与当前用例 identity 匹配的 Agent Proxy、Service、Agent 日志

报告必须指出数据链在哪个边界首次断裂，例如：

```text
UI 已发送
→ HTTP replacement 已提交
→ WS turn.resend 已发送
→ Service 已接受
→ lifecycle 未到达浏览器
```

不得只报告“Stop 按钮超时”或“页面断言失败”。测试的价值是定位第一个违反协议的边界，并证明其上游和下游状态。
