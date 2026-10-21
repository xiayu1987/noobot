# 消息身份归属规则

本文档定义 Noobot 各类消息身份的归属，并作为 messageId 相关全部任务（任务 A：流 ID 删除与身份拆分；任务 B：用户消息 `messageId` 收敛；任务 C：附件事件双重身份）的唯一任务清单。字段契约、前缀和校验以协议包实现为唯一规范：

- `context-protocol/src/message/message-identity.js`：消息相关身份
- `attachment-protocol/src/identity.js`：附件事件身份

本文档不定义第二套 schema。

## 1. 身份分类

| 类别              | 唯一字段名              | 唯一生成函数                                     | 含义                                                           |
| ----------------- | ----------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| 展示消息 ID       | `presentationMessageId` | `createPresentationMessageId`                    | 前端一条助手气泡的身份；消息事件信封 `ordering.scopeId` 等于它 |
| 模型消息 ID       | `modelMessageId`        | `createModelMessageId`                           | journal 中一条模型产出消息的身份                               |
| 会话消息 UID      | `messageUid`            | `createMessageUid`                               | 会话存储中每条消息的身份；summary、checkpoint 用它引用消息     |
| 用户消息客户端 ID | `userMessageId`         | `createUserMessageId`                            | 客户端发出时自带的 ID，用于去重和对账                          |
| 附件事件 ID       | `attachmentEventId`     | `createAttachmentEventId`（attachment-protocol） | 附件生命周期事件自身的身份，与消息无关                         |
| 前端占位 ID       | `placeholderId`         | 前端内部                                         | 只在前端存在，不进入协议字段，不落库                           |

规则：

- 每类身份只有一个字段名、一个生成函数。禁止内联拼接前缀生成。
- 一个字段只承载一类身份。禁止用 `a || b || c` 回退链读取身份。
- 派生 ID（例如 `deriveContextMessageProjectionId` 生成的 `<source>::<type>`）必须注明引用的是哪一类。

## 2. 已删除的身份

- 流 ID：`msg_event_` + `presentationMessageId`。它是展示消息 ID 的派生副本，生成函数 `createAssistantMessageEventId` 已删除，信封、Turn 实体、`requestHashFor` 和身份冲突校验统一使用 `presentationMessageId`。
- `assistantMessageId`：这个名字混用了两类身份，按含义拆分。
  - 前端、CLI、`command.presentation` 一侧指展示消息 ID，改为 `presentationMessageId`。
  - agent 运行时、workflow 一侧指模型消息 ID（`beginAssistantMessageEventStream` 返回的 `createModelMessageId()`），**尚未改名**，见第 8 节 M1。
- `messageId`（作为模型消息 ID 的字段名）：计划改为 `modelMessageId`，**尚未执行**，journal 仍写 `messageId`，见第 8 节 M2。
- `applyAuthoritativeMessageId` 写入三份同值身份：`additional_kwargs.noobotMessageId` 已删除，仍写 `id`、`messageId` 两份，见第 8 节 M3。
- `agent/src/context/session/message-uid.js`：只是透传，删除。

## 3. 已确认决策

D1. `noobotMessageId` 的归属（已确认）

- 现状：它是上下文层的消息键。`resolveContextMessageId` 读取它，并在它与 `messageUid` 同时存在时断言二者相等。多数写入方填的是 `messageUid`：
  - `turn-executor.js:463`
  - `turn-context-message-appender.js`
  - `state-committer.js:110`
  - `message-store.js`
  - `terminal-history.js`
- 例外：只有 no-tools 路径 `turn-executor.js:247` 填的是模型消息 ID。
- 存储：`store.js` 的 `assignMessageId` 把它写到三个位置。
- 结论：它属于会话消息 UID 一类，是 `messageUid` 的重复存储。
  - 上下文消息只保留 `messageUid` 一个字段。
  - 删除 `noobotMessageId`、三处写入和全部回退读取。
  - no-tools 路径的模型消息 ID 改由 `modelMessageId` 承载。

D2. `readContextMessageField` 收敛纳入本批（已确认）

- 范围：非测试源码约 25 处读写，测试 42 个文件。
  - agent：`message-event-stream`、`state-committer`、`message-store`、`turn-context-message-appender`、`tool-call-message`、`turn-executor`、`orchestrator:376`、`history`、`user-meta`、`message-entity`、`agent-dispatch`、`engine`、`turn-persister`。
  - context-protocol：`codec.resolveContextMessageId`、`store.assignMessageId`（三处写入）、`block.js`、`terminal-history.js`、`auxiliary-sequence.js`、`summary-context.js`。
  - 其他：harness `message-factory.js`、`shared/message-diagnostics.js`、前端 `subSessionSnapshotMerge.js`。
- 根因：`codec.readContextMessageField` 对任意字段按 `message`、`additional_kwargs`、`lc_kwargs`、`lc_kwargs.additional_kwargs` 四级回退读取。`dialogProcessId`、`turnScopeId`、`messageOrigin` 等全部上下文字段都走这条回退。
- 已存在的身份不一致：no-tools 路径里，modelContext 消息的 `noobotMessageId` 是模型消息 ID（`turn-executor.js:247`），journal 消息的同名字段却被 `state-committer.js:110` 覆盖为新生成的 `messageUid`。with-tools 路径在没有工具调用时，把 `messageUid` 写进了 `ai.messageId`（`turn-executor.js:453`）。

D3. 存量扫描结论（2026-10-21，脚本 `runtime/ops_workdir/scan-context-fields.mjs`，只读）

- 落库位置：带上下文元数据的消息只存在于 `runtime/session/*/model-message-snapshots/*.json`（23 个文件，2432 条，顶层带 `version`）。`turns`、`turn-snapshots`、`authority-outbox`、`events` 中没有 `noobotMessageId`，也没有 `additional_kwargs`。D1 中“改写 journal 和 checkpoint 的 `noobotMessageId`”不成立，迁移只覆盖 snapshot。
- 存储位置：LangChain 消息的元数据在 `additional_kwargs`；2332 条另在 `lc_kwargs` 和 `lc_kwargs.additional_kwargs` 有完全一致的镜像。
- 更正（补扫描）：快照记录的 `raw` 是第三个位置。100 条 harness 注入的普通对象消息把 `messageUid`、`injectedMessage`、`injectedBy`、`injectedMessageType`、`dialogProcessId`、`turnScopeId` 及插件字段 `purpose`、`pluginFlow`、`chain`、`relayCorrelationId`、`promptInjectionId`、`messageBlockPolicy` 写在顶层（`raw`），`additional_kwargs` 只有 `noobotMessageId`；`raw.messageUid` 与 `noobotMessageId` 100/100 一致；另有 544 条 `dialogProcessId`/`turnScopeId` 只在 `raw`。`contextPolicy` 116 条只在 `lc_kwargs`（写入方写顶层，LangChain 搬入 `lc_kwargs`）。快照记录顶层 `summarized` 没有一条为 `true`。
- `noobotMessageId` 实际是 4 种身份，D1“它是 `messageUid` 的重复存储”只对第一种成立：

| 值形态                           | 条数 | 生成位置                                                     | 问题                                                      |
| -------------------------------- | ---- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `sm_<uuid>`                      | 1924 | `createMessageUid`                                           | 正常，是 `messageUid`                                     |
| `am_<n>`                         | 368  | `store.js` `nextMessageId`，全部是 `system_context` 系统消息 | `context-blocks.js:62` 构造系统消息时没给身份，由仓库补位 |
| `user-interjection:<commandId>`  | 128  | `service/ws/chat-websocket/run-registry.js:101`              | 绕开协议生成，身份里嵌入命令 ID                           |
| `<turnScopeId>::terminal_status` | 12   | `context-protocol/src/policy/terminal-history.js:90`         | 内联拼接，绕开 `deriveContextMessageProjectionId`         |

- 同构回退还存在于：`shared/message-diagnostics.js:21-22`、`agent/src/observability/context-identity-debug.js:15`、`user-meta.js:106`、`codec.js` 的 `resolveContextUserMetaMaterialized` / `resolveContextMessageSummarized` / `resolveContextToolCalls` / `resolveContextMessageContent` / 角色读取。
- 质量门禁里锁定旧写法的正则：`scripts/quality/model-context-convergence/protocol-contracts.mjs:109,126`、`agent-contracts.mjs:20,128`、`scripts/check-agent-context-protocol-boundary.mjs:68`。
- `runtime/workspace-backups`（9 份）是升级前的整体备份，不迁移、不改写。

D4. 收敛方案（已确认）

- 唯一位置：上下文消息的 noobot 元数据只存 `additional_kwargs`（LangChain 规定的自定义字段载体）；身份字段名为 `messageUid`。`noobotMessageId` 删除。`readContextMessageField` 只读 `additional_kwargs`。`lc_kwargs` 是 LangChain 构造时生成的序列化镜像，noobot 代码不读不写。
- `am_`：删除 `nextMessageId`、`bumpNextMessageId`、`reserveExplicitMessageIds`。`canonicalizeMessage` 遇到没有 `messageUid` 的消息直接报错。`context-blocks.js` 构造系统消息时用 `createMessageUid`。
- interjection：`run-registry.js` 改为 `createMessageUid()` 生成 `messageUid`；`commandId` 已在 item 上单独存放，不再嵌进身份。
- terminal_status：改为 `deriveContextMessageProjectionId(turnScopeId, "terminal_status")`，由协议唯一函数生成。它是按回合每次重算的投影消息，ID 必须稳定，属于第 1 节允许的派生 ID。
- 迁移：`context-protocol/src/policy/snapshot.js` 的 `SNAPSHOT_VERSION` 由 3 升到 4，加载仍严格等于当前版本。
  - 输入必须是 v3，其他版本报错停止。
  - `additional_kwargs.noobotMessageId` 改名为 `messageUid`，删除 `lc_kwargs` 下的 noobot 元数据镜像。
  - `am_`：同一快照内同一个 `am_` 的全部出现位置（已核实只有 `messageBlocks.system[]` 和 `messages[]` 两处，184 个全部结构一致）替换为同一个新 `createMessageUid()`；出现在这两处之外即报错。
  - `user-interjection:`、`::terminal_status` 原值保留，已有消息的身份不改写。
  - 存量：v3 共 22 份；v2 共 1 份（`xiayu/.../0093bf08.../model-message-snapshots/6a9a03e0...json`），当前加载器已拒绝它，处理方式待确认（D5）。

- 形状边界：`readContextMessageField` 和 `resolveContextMessage*` 只用于上下文消息，只读 `additional_kwargs`；原生字段（`content`、`tool_calls`、`tool_call_id`、`type`/`role`）只读顶层。journal 消息、Turn、timing 等会话实体读各自协议的顶层字段，不借用上下文 codec。
- 写入：上下文消息的 noobot 元数据（含 `summarized`、`contextPolicy`、`injectedMessage`、`pluginMessage`、插件字段）只写 `additional_kwargs`，由 context-protocol 的唯一写入函数完成。harness `buildHarnessInjectedMessage` 和 agent 的 `contextPolicy` 写入方同步改；删除 `resolvePromptInjectionId` 从 `harness_prompt:` 前缀反推 ID 的推导。
- v4 迁移补充：`raw` 中的元数据并入 `additional_kwargs`（`raw.messageUid` 与 `noobotMessageId` 不一致即报错）；`lc_kwargs.contextPolicy` 移入 `additional_kwargs`；快照记录顶层 `summarized` 改存 `additional_kwargs.summarized`（仅为 `true` 时）。
- 质量门禁正则随协议同步改写为新写法；fallback-chain 基线中 `lc_kwargs` 的豁免删除。

D5. v2 快照（已确认）：删除这一份，不写 v2→v3 升级逻辑。

D6. 注入标记（已确认）

- 唯一事实源：`additional_kwargs.injectedMessage === true` 表示注入消息。`injectedBy` 只表示注入方，`injectedMessageType` 只表示注入类型，二者都不参与"是否注入"的判定。删除 `resolveContextMessageFlags` 中的 `|| injectedBy`。
- 写入：所有注入写入方（harness `buildHarnessInjectedMessage`、agent 内部提示 `noobot.task_check_prompt` / `noobot.help_tool_loop_prompt`）通过协议唯一写入函数同时写 `injectedMessage: true` 和 `injectedMessageType`；协议校验：有 `injectedMessageType` 或 `injectedBy` 而没有 `injectedMessage: true` 即报错。
- 存量不一致（扫描 2432 条）：6 条有 `injectedBy`、无 `injectedMessage`；16 条只有 `injectedMessageType`。根因是 `projectContextMessageIdentityMetadata` 只读顶层 `injectedMessage`，存量该字段在 `additional_kwargs`，每次重新投影丢一次。
- v4 迁移规则（明文协议规则，迁移内一次性执行，运行时不读）：`injectedMessageType` 非空且 `injectedMessage` 缺失，写入 `injectedMessage: true`。`injectedMessage` 为 `true` 而 `injectedMessageType` 为空即报错（存量 0 条）。

D7. 已被 D8 取代（唯一投影入口改为 `projectSessionRecordToContextMessage`，`projectJournalMessageContextMetadata` 删除）。

D8. 上下文消息唯一形状（已确认）

- 问题：正常构建路径由 `projectSessionRecordToContextMessage` 把元数据平铺在消息顶层；运行时追加的 LangChain 实例和 v4 快照恢复的消息把元数据放在 `additional_kwargs`。两种形状汇入同一组入口，四级回退读取就是为兼容这两种形状存在的。
- 规则：上下文消息只有一种形状。原生字段 `role`/`type`、`content`、`tool_calls`、`tool_call_id` 在顶层；其余全部 noobot 事实在 `additional_kwargs`，包括身份、回合、注入标记、`summarized`、`attachments`、`transferEnvelopes`、`rawModelContent`、`modelAdditionalKwargs`、`modelResponseMetadata`、`terminal*`、`userName`、`sessionId`、`parentSessionId`。
- 唯一投影入口：`projectSessionRecordToContextMessage` 只从会话记录顶层读取（会话实体协议），只经 `writeContextMessageMetadata` 写 `additional_kwargs`。删除 `codec.projectJournalMessageContextMetadata`。
- 读取方：`history.js`、`user-meta.js`、harness `capture-runner.js` 只经 codec 读取；构造 LangChain 实例时直接透传 `additional_kwargs`。删除 `hasMaterializedUserMeta`、`resolveAttachments`、`resolveMessageTurnScopeId` 的多路回退。
- provider 键：AI 消息构造时把 `modelAdditionalKwargs.reasoning` 合入 `additional_kwargs.reasoning`；noobot 元数据与 provider 键同名即报错，不覆盖。
- 写入方：harness `applyTransferPayloadToMessage` 对上下文消息改经 `writeContextMessageMetadata` 写 `transferEnvelopes`；经 `turnStore.updateLast` 写回 journal 的是会话实体，保持顶层。
- 恢复路径：`restoreSnapshotUserAttachmentFactsFromSessionAuthority` 经 `writeContextMessageMetadata` 写 `attachments`，事实仍只来自 Session authority。
- 内部消息：`phaseSummaryMemory` 消息构造时用 `createMessageUid` 给身份，标记改存 `additional_kwargs.noobotInternalMessageType`。

D9. 消息回合归属（待确认）

- 已删除的推导：HEAD 版 `block.js` 的 `createHistoryRoundIdentityResolver` 给缺 `dialogProcessId` 的 history 消息套用前一条消息的回合，属于事实推导，本批已删除。
- 规则：history 消息的回合只来自自身的 `additional_kwargs.dialogProcessId`。`window.js` 的 `resolveModelHistoryMessages` 由"缺字段静默丢弃"改为报错（`history context message requires additional_kwargs.dialogProcessId`），系统消息不分回合，不受约束。
- 存量扫描（2026-10-21，只读）：
  - journal 21302 条，缺 `dialogProcessId` / `turnScopeId` 0 条。
  - 快照 history 块 670 条，缺失 0 条，报错不影响恢复。
  - 快照 incremental 块 340 条中 250 条（human 41、ai 78、tool 131）两个字段都缺。其中 43 条按 `messageUid` 在 journal 命中，命中的回合全部等于所属快照记录顶层的 `turnScopeId`；207 条在 journal 中不存在（停止时未提交的回合内消息）。
- 依据：快照记录是按回合存储的，顶层 `dialogProcessId`、`turnScopeId` 就是 incremental 块的回合身份（文件名即 `<dialogProcessId>__<turnScopeId>`）。
- v4 迁移规则（明文，迁移内一次性执行，运行时不读）：incremental 块缺回合字段的消息写入所属快照记录顶层的 `dialogProcessId`、`turnScopeId`；消息已有回合字段且与快照记录不一致即报错；journal 中同 `messageUid` 记录的回合与快照不一致即报错。
- 写入方：运行时追加到 incremental 的 `AIMessage` / `ToolMessage` 必须经 `writeContextMessageMetadata` 写入当前回合字段（存量缺失说明写入方漏写，随第 2 步写入方收敛一起修）。

D11. semantic-transfer 信封升到 v3（已执行）

- 问题：信封顶层 `messageId` 改名为 `presentationMessageId` 时版本仍是 2，同一版本号对应两种形状。
- 存量扫描（2026-10-21，只读）：677 个文件、4261 个信封全部是 v2 旧形状，`messageId` 全部为 `msg_` 前缀（展示消息 ID）。分布：会话目录内 session.json、checkpoint、segment、session-summary、system/interaction 事件日志、outbox；另有 `plugin-data/workflow/**/meta.json` 3 个。
- 规则：`TRANSFER_VERSION = 3`。`semantic-transfer-protocol/src/migrations.js` 的 `upgradeTransferEnvelope` 是唯一迁移规则：v2 顶层 `messageId` 改名为 `presentationMessageId`；v2 已带 `presentationMessageId`、`messageId` 非 `msg_` 前缀、其他版本一律报错。运行时读取只接受 v3。
- 迁移通道：由第 4 步 v6 布局迁移调用 `upgradeTransferEnvelope` 改写全部存量文件；加载时的会话文档迁移（session-repair）只认 v3 形状，`isHistoricalMultimodalParseEnvelope` 已按 v3 判定。
- workflow `meta.json` 的 3 个信封属于作用域会话产物，由 v6 会话处理器覆盖（见 D12）。

D12. 作用域会话根与插件数据（已确认，方案 A，已执行）

- 事实：workflow `meta.json` 的信封位于 `upstreamWorkflowNodeResults[].transferEnvelopes[]`，由 agent `detached-subsession-runner` 经 `writeSessionMetadata` 写入作用域会话目录 `runtime/plugin-data/workflow/session`（6 个子会话），不是插件私有数据。
- 插件私有数据（`plugin-data/harness/runs`，101 个 run、6 类文件）按 `protocol === "noobot.semantic-transfer"` 递归扫描 86255 条记录，命中 0；不建插件迁移通道，`plugin-data-v6` 步骤和 `PLUGIN_DATA` owner 已撤销。
- 规则：作用域会话根只由插件 manifest `contributes.agent.scopedSessionRoots` 声明（workflow 声明 `session`）；`plugin-runtime` 的 `collectNoobotPluginScopedSessionRootDeclarations`（strict 模式读取插件目录下全部 manifest，不按启用状态过滤）收集，`workspace-protocol` 的 `resolveScopedSessionRoots` 校验；`agent/src/extensions/plugins/session-plugin-runtime-provider.js` 把结果交给 `ScopedSessionLocationResolver` 和 v6 处理器 `upgradeSessionTransferEnvelopes`，`meta.json` 纳入改写。
- 风险：插件目录被删除后，其作用域会话不再被迁移。

已修复的回归（D4 收敛引起）：`summary.js` 的 `collectTurnMessageOwnership` 处理会话实体，`dialogProcessId` 却经上下文 codec 读取，收敛后恒为空，删除消息（`turn-mutations.js:45`）和会话修复（`write-time-dialog-facts.js:104`）会静默清空全部摘要检查点。已改为 session-protocol 的 `resolveSessionMessageRecordDialogProcessId`。

## 4. 派生字段归类

| 字段                                                                                                | 引用类别                                                                           | 处理                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `resolveContextMessageId`                                                                           | 会话消息 UID，只读 `additional_kwargs.messageUid`                                  | 已收敛（D1/D4）                      |
| `summarizedMessageIds`、`summaryCheckpointMessageIds`、`markedMessageIds`                           | 会话消息 UID（`summary-checkpoint-committer` 按 `resolveMessageUid(record)` 匹配） | 已收敛；字段名不含 Uid，见第 8 节 M8 |
| `sourceMessageId`（`deriveContextMessageProjectionId`、summary-context、harness `message-factory`） | 会话消息 UID，派生投影的源                                                         | 已收敛；字段名不含 Uid，见第 8 节 M8 |
| `sourceMessageId`（`message-summary-projection.js` 展示摘要）                                       | 模型消息 ID                                                                        | 仍混用，见第 8 节 M4                 |
| `modelMessageIds`（state-builder）                                                                  | 模型消息 ID                                                                        | 保留                                 |
| `requested/bound/activePresentationMessageId`（agent-transport-consumption）                        | 展示消息 ID，只读 `activePresentationMessageId`                                    | 已收敛                               |
| 前端 `messageView`、`turnPresentation`、`subSessionSnapshotMerge` 的 `messageId`                    | 展示消息 ID、模型消息 ID、占位 ID 混用                                             | 仍混用，见第 8 节 M7                 |

## 5. 任务 A：流 ID 删除与身份拆分（当前执行）

基线提交：`550ce902f`。

0. 删除流 ID（已完成协议层）
   - [x] event-protocol：信封 `identity` 删除 `messageId`；`ordering.scopeId` 必须等于 `payload.presentationMessageId`；`createEventEnvelope` 遇到未声明字段抛 `unknown_envelope_field`，不再静默过滤。
   - [x] session-protocol：删除 `createAssistantMessageEventId`；Turn 信封、投影、物化校验删除 `messageId`。
   - [x] authoritative-state：Turn 实体、`requestHashFor`、身份冲突校验删除 `messageId`。
   - [x] semantic-transfer、context-protocol：transfer 信封和 agent context identity 的 `messageId` 改为 `presentationMessageId`；旧 `transferId` 原样保留。
   - [x] agent-proxy：trace 字段 `resolveMessageEventTrace().messageId` 改为 `presentationMessageId`（取自 payload）；夹具去掉信封和 Turn 上的流 ID。
   - [x] agent 写入方：`transfer-attachment-refs.js` 复制 `presentationMessageId`；`command-stage.js` 删除恒为空的 `messageId`。
1. 协议
   - [x] `identity.js` 原地改名为 `message-identity.js`，同步修改 exports 和 `index.js`，不保留旧路径。
   - [x] 新增 `createPresentationMessageId`、`createUserMessageId`，以及校验函数 `assertMessageIdentity`。
   - [x] attachment-protocol 新增 `createAttachmentEventId`；事件字段改为 `attachmentEventId`，reducer 状态改为 `attachmentEventIds`（只在前端内存，不落库）。
   - [x] 补协议测试。
2. 写入方
   - [x] `parsed-artifact-persistence.js` 改用 `createAttachmentEventId`。
   - [x] 随机源收敛到 `@noobot/shared/secure-identity`（唯一实现；非安全上下文浏览器用 `getRandomValues`），删除前端本地 `secureIdentity.js`。shared 55/55、context-protocol 124/124、attachment-protocol 11/11。
   - [x] 替换内联生成：`detached-subsession-runner.js:246`、`service/cli/run-turn.js:37-38`、前端 `sendFlowSupport.js`（删除本地两个生成函数）。service 新增依赖 `@noobot/context-protocol`，已核实可解析（workspace 链接，lockfile 已有条目）。
   - [x] 核实前端 `sendRequestResolver.js:95-96`：重发和复用回合时由调用方指定 ID 的合法入口，保留。
   - [x] 删除 `message-uid.js` 及 `entities/normalizers.js`、`entities.js` 两层转导出，6 个调用方直接引用 `createMessageUid`。
   - [x] 展示侧 `assistantMessageId` 改为 `presentationMessageId`：agent-transport-protocol（`PRESENTATION_KEYS`、`createTurnRunCommand`，校验码改为 `missing_presentation_message_id`）、前端发送链路、CLI `run-turn.js`、`chat-run-service.js`。命令不落库，不需要迁移。
   - [x] `agent-transport-consumption` 只读 `activePresentationMessageId`，诊断字段改为 `requested/boundPresentationMessageId`、`presentationMessageIdConsumed`；`detached-subsession-runner` 删除 3 处对 `runConfig.assistantMessageId` 的死 `delete`。
   - [ ] 运行时侧 `assistantMessageId` 改为 `modelMessageId`：`turn-executor`、`orchestrator`、`turn-result-aggregator`、`engine`、`agent-dispatch`、workflow `persistence.js`（第 8 节 M1，待拍板）。
   - [ ] 诊断事件 `canonical_turn_messages_accepted`、`authoritative_final_commit_*` 的 `data.assistantMessageId` 新写入改为 `modelMessageId`（随 M1）；`authoritative_final_commit_completed.messageId` 读已删除字段（M6）。存量没有回读方，不迁移。
   - [ ] `accepted[].messageId` 混用 `msg_`（模型消息）和 `sm_`（`messageUid`），按 D1 拆开。
   - [ ] `messageUid` 的生成收敛为"新建时生成，已有时必须一致"：`state-committer.js:76`（no-tools 路径的唯一生成入口）、`turn-upsert.js:179/207`、`turn-state.js:44`（同时删除从 `turn.presentationMessageId` 回填展示 ID 的推导）。
   - [ ] 模型消息 ID 字段改为 `modelMessageId`（M2，待拍板），`applyAuthoritativeMessageId` 只写一份（M3）。
   - [x] 按 D1 收敛 `noobotMessageId`（范围见 D2）：agent、context-protocol、harness、门禁正则已收敛；`shared/message-diagnostics.js` 与前端 `subSessionSnapshotMerge.js` 各 2 处残留归 D10。
3. 测试收敛
   - [x] agent-proxy 154/154（夹具 `presentation.assistantMessageId` 改为 `presentationMessageId`）。
   - [x] agent 1546/1546；删除 agent 侧重复的 `message-store.test.js`（context-protocol 同名用例已覆盖）。
   - [x] service 286/286。
   - [x] 前端 vitest 207 个文件 1398/1398；源码读取方 7 处已收敛。
   - [x] 其余包：context-protocol 124、session-protocol 110、session-repair 39、semantic-transfer 41、event-protocol 75、memory-protocol 29、workspace-protocol 30、plugin-runtime 19、harness 386、workflow 106，全部通过。
   - [ ] 测试侧 `runner-bot-hook.fixtures.js` 的 `reportedMessageId || createModelMessageId()` 回退链改为必填。
   - [ ] 两处静默丢弃改为报错：`normalizeCommandReceipt`、`normalizeAuthorityEventOutbox`。
   - [ ] activity timeline、thinking-detail 事实带未声明字段时被白名单静默跳过，改为报错。
4. v6 布局迁移
   - [x] 信封迁移规则 `upgradeTransferEnvelope`（D11）及 `upgradeTransferEnvelopesInValue` / `upgradeTransferEnvelopesInDocumentText`，semantic-transfer 41/41。
   - [x] v6 owner 处理器 `agent/src/workspace-lifecycle/session-transfer-envelope-upgrade.js`：遍历默认会话根和 D12 声明的作用域会话根，在会话锁内先全部校验计算、再逐文件备份后 `writeFileAtomic`；覆盖 journal（校验 hash，只改 `committedBytes` 内记录）、snapshot 链（重算 `contentHash`）、manifest、summary-details、session-summary（revision 仅在原值有效时重算）、events（含轮转归档）、outbox、execution-events、`meta.json`。
   - [x] ~~插件数据迁移通道~~：撤销，见 D12。
   - [x] 测试夹具信封全部改为 v3（测试目录内无 v2 信封）。
   - [x] 迁移测试 `agent/__tests__/workspace-session-transfer-envelope-upgrade.test.js`：改写结果、备份逐字节等于原文件、重跑无写入、过期 summary 保持过期、校验失败零落盘、`recordCount` 不变。
   - [ ] 跨文件写入不是原子的，中途失败只能靠备份恢复；恢复方式需写进运维说明。
   - [ ] 模型消息 `messageId` 改为 `modelMessageId`（M2，待拍板，涉及 journal 存量）。
   - [ ] 上下文快照 v3→v4 迁移（D4/D6/D9）未实现，依赖 D9 确认。
   - [ ] 只在夹具验证；真实工作区试跑须停服并用数据副本。
5. 读取方
   - [x] session-repair 按 v3 信封判定；harness、workflow 读取方已收敛（测试全绿）。
   - [ ] service `session-routes.js` 调试输出仍透传 `messageId`/`sourceMessageId`，随 M4 处理。
6. 前端
   - [x] 信封、transport、reconnect 读取方收敛到 `presentationMessageId`。
   - [ ] 剩余 `messageId` 混用与占位 ID 见第 8 节 M7。
7. 全量验证与收尾
   - [x] 全部包 `npm test`、`check:quality` 通过；基线收紧：complexity 245、fallbackChain 581、inlineTrim 96、rawTypeof 642，模型上下文豁免 11→10。
   - [x] 临时文件、`/tmp/mi-base` worktree、ops_workdir 一次性脚本已清理。
   - [ ] 用真实数据副本跑一次 v6 全量对比。

## 6. 任务 B：用户消息 `messageId` 收敛（已拆出，本批之后执行）

现状：journal 中 `role=user` 消息的 `messageId` 混着两类值。

| 值形态            | 条数 | 来源                                                                                               | 实际类别                |
| ----------------- | ---- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| `msg_<uuid>`      | 223  | 前端 `createUserMessageId`、CLI；经 `runtime-binding.js:36` 的 `currentUserMessage.messageId` 写入 | 用户消息客户端 ID       |
| 等于 `messageUid` | 2122 | 待核实写入方（疑似 `document-migration.js:641` 的 `messageId \|\| messageUid` 回填）               | 会话消息 UID 的重复存储 |

目标：用户消息只用 `userMessageId` 承载客户端 ID，`messageUid` 承载会话身份，用户消息上不再出现 `messageId`。

任务清单：

1. 事实源核实
   - [ ] 找出写入"`messageId` 等于 `messageUid`"的全部写入方，确认是否只有 `document-migration.js:641`。
   - [ ] 核实这 2122 条是否有客户端 ID 原值可恢复；没有原值的，迁移后不带 `userMessageId`（不推导）。
   - [ ] 核实读取方：`userMessageId`、`replacementUserMessageId`、展示消息上的 `messageId`（`missing_user_message_id` 校验）、前端对账和去重逻辑。
2. 协议
   - [ ] `message-identity.js` 的 `MESSAGE_IDENTITY_FIELD` 明确用户消息字段为 `userMessageId`。
   - [ ] event-protocol 用户展示消息校验由 `messageId` 改为 `userMessageId`。
3. 写入方
   - [ ] `runtime-binding.js:36`、`command-stage.js:136`、前端发送链路只写 `userMessageId`。
   - [ ] 删除 `document-migration.js:641` 的 `messageId || messageUid` 回退链。
4. 迁移（布局 v7）
   - [ ] `msg_<uuid>` 改写为 `userMessageId`；等于 `messageUid` 的直接删除；其他形态报错停止。
   - [ ] 覆盖 journal、checkpoint（重算哈希）、`session.json`、`runtime/agent/session`、outbox。
5. 读取方与前端
   - [ ] service、插件、session-repair、前端只读 `userMessageId`。
6. 验证
   - [ ] 全量 `npm test`、`check:quality`；真实数据副本跑 v7 对比。

## 7. 任务 C：附件事件双重身份（已拆出）

- [ ] 信封 `identity.eventId` 与 payload `attachmentEventId` 是否合并为一个，先核实两者的生成方和读取方。

## 8. 带 messageId 字段盘点（2026-10-21，非测试源码 1725 个文件）

已收敛（命名与职责一致）：`presentationMessageId`（348 处）、`modelMessageId`、`messageUid`、`userMessageId`、`createPresentationMessageId` / `createModelMessageId` / `createUserMessageId`、`resolveContextMessageId`、agent-transport-consumption 的 presentation 诊断字段、D12 作用域会话根。

仍混用，按处理方式分两类。

直接修（规则明确，不改协议）：

| 编号 | 位置                                                                        | 问题                                                                                           | 修法                                              |
| ---- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| M3   | `agent/src/events/message-event-stream.js` `applyAuthoritativeMessageId`    | 模型消息 ID 同时写 `id`、`messageId` 两份                                                      | 只写一份；随 M2 定字段名                          |
| M5   | `agent/src/session/entities/message-entity.js:59` `resolveRuntimeMessageId` | `messageId \|\| messageUid` 回退，把会话 UID 写成 `messageId`（任务 B 的 2122 条来源之一）     | 删除回退，`messageId` 只取自身；与任务 B 一起执行 |
| M5   | `session-repair/src/document-migration.js:641`                              | `item.messageId \|\| item.messageUid` 匹配 `replacementUserMessageId`                          | 随任务 B 改为只匹配 `userMessageId`               |
| M6   | `agent/src/runtime/engine.js:162`                                           | `authoritative_final_commit_completed.messageId` 读已删除的 `event.identity.messageId`，恒为空 | 删除该诊断字段                                    |

待拍板（涉及协议字段名或存量迁移）：

| 编号 | 位置                                                                                                                            | 现状                                                                                                                     | 建议                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| M1   | `turn-executor`、`orchestrator`、`turn-result-aggregator`、`engine`、`agent-dispatch`、workflow `persistence.js:430`（35 处）   | `assistantMessageId` 承载 `createModelMessageId()`，名不副实                                                             | 改名 `modelMessageId`；运行时字段不落库，无迁移                                                       |
| M2   | journal 助手消息、`turn-upsert`、`turn-persister`、`no-tools-commit-stage`、`state-committer`、workflow `persistence.js:402`    | 模型消息 ID 存在 `messageId`；用户消息的 `messageId` 是客户端 ID（任务 B）                                               | 助手消息改为 `modelMessageId`，布局 v7 迁移 journal/checkpoint；与任务 B 合并为一次迁移               |
| M4   | `agent/src/session/session-summary-builders/message-summary-projection.js:185`                                                  | 展示摘要 `messageId = presentationMessageId \|\| messageId`，展示 ID 与模型 ID 共用一个字段；`sourceMessageId` 存模型 ID | 摘要分别输出 `presentationMessageId`、`modelMessageId`，删除合并字段；前端和 `session-routes.js` 同步 |
| M7   | 前端 `messageView.js`、`turnPresentation.js`、`subSessionSnapshotMerge.js`、`messageModel.js`、`conversationFoldingIdentity.js` | 视图 `messageId` 混装展示 ID、模型 ID 和占位值（`turn-status-placeholder:<turnScopeId>`）                                | 视图身份只用 `presentationMessageId`，占位改 `placeholderId`；依赖 M4                                 |
| M8   | `summarizedMessageIds`、`summaryCheckpointMessageIds`、`markedMessageIds`、`sourceMessageId`（投影源）                          | 值是 `messageUid`，字段名不含 Uid                                                                                        | 改名 `*MessageUids` / `sourceMessageUid`；`summarizedMessageIds` 落库在 checkpoint，需迁移            |
| D10  | `shared/message-diagnostics.js:15-25,135,172`、前端 `subSessionSnapshotMerge.js:25,118`                                         | 四级回退读取 `noobotMessageId`                                                                                           | diagnostics 按消息形状只读 `additional_kwargs.messageUid`；前端删除 `noobotMessageId` 读取            |

建议顺序：M6、M3 → M1 → M4、M7 → M2 与任务 B 合并为布局 v7（含 M5）→ M8。
