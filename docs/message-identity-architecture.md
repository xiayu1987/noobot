# 消息身份归属规则

本文档是消息身份相关任务的唯一任务清单，按"需求 → 规则 → 已完成 → 未完成 → 待授权"组织。字段契约、前缀和校验以协议包实现为唯一规范，本文档不定义第二套 schema：

- `session-protocol/src/identity/message-identity-schema.js`：`MESSAGE_FIELD_SCHEMA`（类别、前缀、角色约束、`renamedFrom` 迁移来源）
- `session-protocol/src/identity/message-identity.js`：生成函数与校验（前缀读自 schema）
- `attachment-protocol/src/identity.js`：附件事件身份

当前基线：提交 `81f3a83f7`（M15、切片 1、切片 2）。切片 3 已实施，切片 4 部分实施（3.5），按用户决定暂不提交。

## 1. 需求（用户已确认）

| 编号 | 需求                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | 每类身份只有一个字段名、一个生成函数；一个字段只承载一类身份；禁止 `a \|\| b` 回退链读取身份，禁止内联拼接前缀                            |
| R2   | `messageUid` 保持为会话主键名，不改名；裸 `messageId` 必须消失，按角色拆为 `modelMessageId` / `userMessageId`，其余角色是主键副本直接删除 |
| R3   | 带前缀的关联键 `modelMessageId`、`presentationMessageId`、`userMessageId` 名字保留；曾提议的 `modelOutputId` 等改名已撤回                 |
| R4   | 单一事实源：不复制身份到第二个字段，不按值、前缀或拼接字符串推导事实，不在读取时补生成                                                    |
| R5   | 上下文消息身份采用方案 A：每条消息恰好一种身份形状，三者互斥（见 3.2）                                                                    |
| R6   | 迁移统一规范：每种存储的每个版本声明字段 schema，按版本链逐级映射（vN→vN+1），迁移逻辑只放在 `session-repair` / `memory-repair`           |
| R7   | 映射不了不能阻断系统：服务必须能启动，其他用户和其他会话照常使用；单个会话打不开可以接受                                                  |
| R8   | 提交严格按主题拆分，提交须用户授权；message 范围以外的改动可以混入，但须先授权                                                            |

## 2. 身份分类

| 类别              | 字段                             | 生成函数                                         | 含义                                                       |
| ----------------- | -------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| 会话消息主键      | `messageUid`（`sm_`）            | `createMessageUid`                               | 会话存储中一条消息的唯一主键；summary、checkpoint 用它引用 |
| 模型消息 ID       | `modelMessageId`（`mm_`）        | `createModelMessageId`                           | 一条模型产出消息的身份，仅 assistant                       |
| 展示消息 ID       | `presentationMessageId`（`pm_`） | `createPresentationMessageId`                    | 前端一条助手气泡；事件信封 `ordering.scopeId` 等于它       |
| 用户消息客户端 ID | `userMessageId`（`um_`）         | `createUserMessageId`                            | 客户端发出时自带，用于去重和对账，仅 user                  |
| 附件事件 ID       | `attachmentEventId`              | `createAttachmentEventId`（attachment-protocol） | 附件生命周期事件自身的身份                                 |
| 前端占位 ID       | `placeholderId`                  | 前端内部                                         | 只在前端内存，不进协议，不落库                             |

- 前缀只为排查可读性，代码不按前缀判断类别；存量 `msg_` 值不改写。
- 引用会话主键的字段统一叫 `*MessageUid(s)`；`*MessageId(s)` 只能以三个关联键结尾。
- `messageUid` 只在消息第一次写入会话时生成一次，任何读取方不得补生成；不给不落库的临时消息用。

已删除的身份：流 ID `msg_event_*`（`createAssistantMessageEventId`）、`assistantMessageId`（拆为 `presentationMessageId` / `modelMessageId`）、`applyAuthoritativeMessageId` 三份同值写入、`agent/src/context/session/message-uid.js` 透传、源码中的 `noobotMessageId`（D10 残留除外）。

## 3. 已定规则

### 3.1 上下文消息形状（D4、D8，已执行）

- 原生字段 `role`/`type`、`content`、`tool_calls`、`tool_call_id` 在顶层；其余 noobot 事实只存 `additional_kwargs`，由 context-protocol 唯一写入函数 `writeContextMessageMetadata` 写入。`lc_kwargs` 是 LangChain 序列化镜像，noobot 不读不写。
- 唯一投影入口 `projectSessionRecordToContextMessage`：只从会话记录顶层读取。
- 会话实体（journal、Turn、timing）读各自协议的顶层字段，不借用上下文 codec。
- 注入标记（D6）：只有 `additional_kwargs.injectedMessage === true` 表示注入；有 `injectedMessageType`/`injectedBy` 而无 `injectedMessage` 即报错。
- 回合归属（D9）：history 消息的回合只来自自身 `additional_kwargs.dialogProcessId`，缺失即报错，不套用前一条。

### 3.2 上下文消息身份：方案 A（M16，切片 3，未提交）

每条上下文消息恰好属于下面一种形状，codec 校验互斥，都不带或带多种即报错：

```js
{ messageUid: "sm_1" }                                          // 从会话投影的消息
{ contextMessageId: "cm_7" }                                    // 不落库的上下文消息，构造时生成一次
{ projectionType: "user_meta", sourceMessageUid: "sm_1" }       // 从会话消息派生的投影
{ projectionType: "terminal_status", sourceTurnScopeId: "t_1" } // 从回合派生的投影
```

- 投影不存自己的 ID，身份就是"类型 + 来源"两个已有事实；store 需要的唯一键由 codec `resolveContextMessageKey` 在内存中组合，不落盘、不对外。
- `resolveContextSourceMessageUid` 只返回真正的会话主键，供 summary、snapshot 引用。
- 取代：schema 中 `contextMessageId` 的旧定义（`KIND.DERIVED`，"journal 投影时等于主键，派生投影为 `<主键>::<type>`"）、`deriveContextMessageProjectionId`、`deriveMessageProjectionId`、M13 的拼接写法。
- `phase_summary` 归入 `{ projectionType, sourceMessageUid }`。`user-interjection:command:<uuid>` 是真实旧格式会话主键，按会话形状保留，codec 不校验 `sm_` 前缀。
- 严格解析 `resolveContextMessageIdentity` / `Key` 只用于主流程定位；诊断、审计统一用 `inspectContextMessageIdentity`（不抛错，返回 `{ shape, key, fields }`），日志只写形状和"是否找到"，不写带 `\u0000` 的内存键。
- user_meta 回写（用户选方案 A）：附件解析结果存到源用户消息的 `userMetaParsedResults`（`recordUserMetaParsedResult`），user_meta 每次从源消息重新派生，不再单独落盘投影消息；backwrite 记录用 `userMetaSourceMessageUid` + `attachmentRef` 定位，删除 `backwriteId`。
- 已否决方案 B（全部必填单独生成）：历史消息每轮重投影，ID 不稳定；要稳定只能落库或复制主键，违反 R4。

### 3.3 迁移规范（D14，已实施）

- 每种存储的每个版本声明字段 schema：当前版本在各 protocol 包，历史版本在 repair 包，运行时只认当前版本。
- 每步只做 vN→vN+1：先按 vN schema 校验输入，执行声明式映射（改名、删除、加常量；结构重组才写转换函数），再按 vN+1 schema 校验输出。
- 版本号升级必须同时登记迁移步骤和样例数据。门禁 `check:version-chain-coverage`（已接入 `check:quality`）检查三条：每个 `defineVersionChain` 步骤在导入它的测试里有 `version: N` 样例；`WORKSPACE_LAYOUT_UPGRADES` 逐级连续到 `WORKSPACE_LAYOUT_VERSION`；每个 owner 绑定处理器且有 agent 测试调用。
- 未做：每步按 vN/vN+1 schema 校验，目前靠 `hydrateModelContextSnapshot` 做最终校验。
- 映射不了（R7）：
  - 可选字段：删除该字段并写入迁移报告，继续。
  - 必填字段或身份字段、未知版本：不猜。原文件整份移到 `runtime/migration-quarantine/<kind>/<原路径>`，旁写 `.reason.json`（版本、步骤、字段、原因），其他文档继续迁移。
  - 隔离文件补上映射规则后可重跑迁回；只由用户手动删除。
- 取代：D4、D11、任务 B 中"其他版本/其他形态一律报错停止"的规则；`session-repair/README.md` 中"身份无法无猜测恢复时必须失败"的约定随实施改写。

### 3.4 系统不阻断（D15，已实施，`81f3a83f7`）

会阻断系统的是 `ensureUserWorkspace`（`agent/src/workspace-lifecycle/index.js:103-140`），不是单会话读取修复：

| 阻断点       | 代码                                                                                                                          | 影响                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 服务启动     | `service/app.js:91-93` 逐用户调用 `ensureUserWorkspace`，循环无 try                                                           | 任一用户任一步抛错，`startHttpServer` 不执行，服务退出 |
| 用户全部请求 | `execution/initializer.js`、`session-execution-engine.js`、`turn-attachment-enricher.js` 每次请求先调它；失败步骤不写布局版本 | 该用户所有会话都无法执行，且每次重跑都失败             |

切片 1 已实施：

- 隔离区：`runtime/migration-quarantine/<owner>/`（`workspace-protocol` 的 `MIGRATION_QUARANTINE_DIR`），runtime 重置时保留，session 遍历时跳过。共用实现在 `agent/src/workspace-lifecycle/migration-quarantine.js`。
- lifecycle（v4）逐条记录处理，映射不了的记录移入隔离区并附 `.reason.json`；tombstone 改为先写后删，中途失败不会让已删会话复活。
- transfer 信封（v6）按会话捕获 `UPGRADE_INVALID`，原文件不动，只写 `<sessionDir>.reason.json`；`commitWritePlan` 中途失败时按备份回滚。
- `upgradeWorkspaceLayout` 每步成功才推进布局版本，失败记入返回值 `failed` 后停在该步，不再抛错。
- 快照（v7）按单文件处理：映射不了的移入隔离区（`move:true`）；文件系统等非映射错误原位写 `.reason.json`（`move:false`），其余文件照常迁移，重启时随隔离区重试。
- 失败可见：`repairUserWorkspace` 返回完整 report，启动时 `prepareUserWorkspaces` 把 `layoutUpgrades` 的 `failed` 和各处理器的 `quarantined` 带 `userId`/`stage` 汇入 `workspacePreparation.completed.failures`。
- 重试：每个进程对每个工作区的每个 owner 重试一次隔离区（`sections.js` 的 `retriedQuarantines`），即补上映射规则后重启服务自动重试；不在每次请求时重跑。
- 启动：`service/bootstrap/prepare-user-workspaces.js` 按用户捕获，失败带 `userId`/`stage` 记入 `failures`，服务照常启动。启动事件改名为 `service.startup.workspacePreparation.*`，外层兜底为 `service.startup.failed`。
- 取代：`session-repair/README.md` 中"身份无法无猜测恢复时迁移必须失败"的约定，对布局批量迁移改为"进隔离区不阻断"。会话读取修复的 `repair.status = "failed"` 和 `PreviousRepairFailure` 保持不动（单会话打不开可以接受）。

首次真实迁移的事故（2026-10-21，已修复）：admin 的 v7 整步失败而启动事件 `failures=[]`。根因是 `writeFileAtomic` 临时名 `.<basename>.noobot-<pid>-<ts>-<uuid>` 对 213 字节的快照文件名达到 280 字节，触发 `ENAMETOOLONG`；该错误非映射类，旧处理器整步抛出，而 `ensureUserWorkspace` 只返回 `base`，report 被丢弃。修复：临时名改为固定长度 `.noobot-atomic-<uuid>`（`platform-compatibility/src/atomic-file-write.js`）；处理器按单文件记录；启动汇总 report。

残留风险：请求期调用点仍走 `ensureUserWorkspace`，不读 report。某一步整步失败时，每次请求会重跑该步并重复写备份（这次 admin 留下 7 个重复备份目录）。按单文件记录后整步失败只剩处理器外层错误（遍历、加锁），概率低，暂不改调用点。

### 3.5 切片 4 协议（已实施，未提交）

规则由协议包函数唯一实现，本节只登记归属和语义。

- 主流程控制：插件只能通过端口 `createMainFlowControlPort`（`agent/src/runtime/main-flow-control.js`）下达指令。指令由 context-protocol `policy/main-flow-control.js` 构造，`MAIN_FLOW_CONTROL_ACTION` 只有 `final_no_tools_turn` 和 `summary_checkpoint` 两种。committer 只接受 `action === SUMMARY_CHECKPOINT` 的指令，不探测能力，也不软返回。
- 上下文构建模式：`AGENT_CONTEXT_MODE`（`new_session` / `existing_session`）。factory 在任何 hook 之前调用 `assertAgentContextMode`，非法值报 `INVALID_CONTEXT_MODE`(400)。
- 活动上下文：`runtime.activeMessageContext` 是 modelContext 和 `userMetaBackwrites` 唯一的持有方。state 构建完成后，只能通过 `requireActiveModelContext` 读取，缺失就抛错。
  - 快照里的 backwrites 经信封 `modelContext.userMetaBackwrites` 进入 `createModelContext`，runtime 上不再另存。
  - 停止候选只保存身份和 `systemRuntime`，保存时从活动上下文投影。不变式：有候选，就一定有活动上下文。
  - hook context 只读活动上下文，raw 中禁止出现 `modelContext`。
- hook manager：显式的可选能力，值只能是 manager 或 null（`assertOptionalHookManager`）。runner 在准备完成前 `preparedBotHookManager` 为 null，失败处理只读这个值。
- 摘要检查点：
  - 是否已持久化，只按 `messageUid` 集合判断。按条数切前缀的写法已删除（`summaryCheckpointPersistedCount/Total`、`alreadyPersistedTurnMessageCount`）。current-turn ledger 拒绝没有 `messageUid` 的消息。
  - commit 请求必须显式提供：身份、`turnScopeId`、三组 uid 数组（可以为空）、整数 `expectedCheckpointRevision`。缺一项或非法即报 `REQUEST_INVALID`(400)。会话缺失或已删除时，原样抛出协议错误。
  - 状态：receipt revision 严格递增，且不超过状态 revision；append 必须恰好 +1；prune 只删 receipt，不回退状态 revision（`context-protocol/src/policy/summary.js`）。
  - modelContext 的 revision 只能通过 `advanceContextCheckpointRevision` 推进，严格递增。runtime 上的 `summaryCheckpointRevision` 只作为创建 modelContext 时的初值。
  - `finalizeRunSession` 有四个必填字段：`persistedTurnMessageUids`、`persistedTurnMessages`、`durableTurnMessages`、`summaryCheckpointPromotionSources`。turn 消息为空时直接拒绝，不再合成默认 assistant 消息。
- plugin artifact：提交判定 `decidePluginArtifactCommit`、拒绝结构 `createPluginArtifactCommitRejection`（原因取自 `PLUGIN_ARTIFACT_REJECTION_REASON`）、receipt 和查询结果，都由 event-protocol `plugin-artifact-event.js` 唯一定义，authority-event 和 reducer 共用。
  - 请求中的 `operation`、`baseRevision` 必须显式传入；created 时传 `baseRevision: null`。
  - authority 提交在会话缺失或已删除时，原样抛出协议错误。
  - `pluginArtifactKey` 只接受 payload，三段身份缺一即抛错；`createPluginArtifactEnvelope` 的 `sequence`、`revision`、`occurredAt` 必须显式传入。
- event 信封版本：每个 event family 的 `schemaVersion` 只由 registry 描述（`event-registry.js`）声明，缺失或不是 ≥1 的整数时构建期抛错。版本常量放在各 family 模块（`TURN_SNAPSHOT_SCHEMA_VERSION`、`WORKFLOW_RUNTIME_SCHEMA_VERSION`、`EXECUTION_QUERY_SCHEMA_VERSION`、`PLUGIN_ARTIFACT_SCHEMA_VERSION`），registry 引用；协议包外通过 `getEventFamily(family).schemaVersion` 读取。`createEventEnvelope` 全字段必填，无默认参数、无数字强转；`commitAuthorityEvent` 未知 family 直接拒绝。
  - 信封 section（identity、causality、ordering、producer）必须是对象，非对象报 `invalid_envelope_section`；`causality` 无值时显式传 `{}`。
  - `producer` 由调用方显式提供；同一生产者只有一个协议常量，durable 与 transient 两条路径共用。
- authority outbox（event-protocol `authority-event-outbox.js`）：
  - checkpoint 的解析、序列化、floor 读取、sequence 分配和推进都只由协议函数实现。`schemaVersion` 必须等于 `AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION`，floor 必须是 ≥1 的整数，sequence key 的 domain、scope 缺一即抛错。
  - floor 缺失读作 0，这是显式语义。journal 只在 ENOENT 时返回空 checkpoint；JSON 损坏、版本不符、floor 非法时直接抛错。
  - 分配取 floor 与同作用域 envelope 的最大值再 +1；推进只升不降。
  - 调用方确认提交只用 `requireCommittedAuthorityEvent`：拒绝时抛错并带 `code`，envelope 非法时抛 `TypeError`。不再用 `?.reason || "unknown"`。
- 流身份（agent `events/message-event-stream.js`）：
  - 流状态形状只由 `createMessageEventStreamState` 定义；`createRuntimeContext` 是唯一初始化点，入参 `systemRuntime` 自带 `messageEventStream` 时拒绝。
  - `bindAssistantMessageEventStream` 要求 `presentationMessageId`、`parentSessionId`、`workflowRunId`、`nodeExecutionId` 四个字段都显式传字符串，非 workflow 场景传 `""`；已绑定的字段不允许改值。生产调用点只有 `runtime-binding.js`，workflow 身份只读 `runConfig.workflowRunId/workflowNodeExecutionId`。
  - `beginAssistantMessageEventStream` 要求整数 `turn`（≥0）；draft content 必须是字符串。
  - 事件 payload 的 data 必须是 plain object，不得携带 `messageId`/`presentationMessageId`；身份字段原样写入，空值与缺失只由协议 `validatePayloadEnvelope` 判定。
- 测试 runtime：只能通过 `createTestRuntimeContext` 构造，接受工厂输入字段和白名单内的 post-mount 字段。`runConfig` 必须显式带 `hookManager`，夹具不做隐式合并。`Object.assign(createTestRuntimeContext(), …)` 会绕过白名单，待清理（见 5.3 测试侧）。

## 4. 已完成

| 项             | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 提交                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 任务 A 协议    | 流 ID 删除：event-protocol 信封 `identity` 删 `messageId`，`ordering.scopeId` 必须等于 `presentationMessageId`；session-protocol、authoritative-state、semantic-transfer、context-protocol、agent-proxy 同步                                                                                                                                                                                                                                                                                                                                              | `65b39481f`                                         |
| 生成函数       | `identity.js` 改名 `message-identity.js`；新增 `createPresentationMessageId`、`createUserMessageId`、`assertMessageIdentity`、`createAttachmentEventId`；随机源收敛到 `@noobot/shared/secure-identity`；内联生成全部替换                                                                                                                                                                                                                                                                                                                                  | `65b39481f`（`createUserMessageId` 在 `22aab68ca`） |
| M1             | 运行时 `assistantMessageId` 改名 `modelMessageId`（不落库，无迁移）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `22aab68ca`                                         |
| M3、M6         | 删除 `applyAuthoritativeMessageId` 三份写入；删除恒为空的 `authoritative_final_commit_completed.messageId`                                                                                                                                                                                                                                                                                                                                                                                                                                                | `22aab68ca`                                         |
| D1/D2/D4/D8    | `noobotMessageId` 在 agent、context-protocol、harness、门禁中删除；`readContextMessageField` 只读 `additional_kwargs`；`am_` 补位删除；唯一投影入口                                                                                                                                                                                                                                                                                                                                                                                                       | `65b39481f`                                         |
| D11、D12       | semantic-transfer 信封升 v3，`upgradeTransferEnvelope` 唯一迁移规则；布局 v6 处理器 `session-transfer-envelope-upgrade.js` 覆盖默认会话根和插件声明的作用域会话根                                                                                                                                                                                                                                                                                                                                                                                         | `65b39481f`                                         |
| M11            | 插话主键改用 `createMessageUid`，`user-interjection:` 拼接已无残留                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `22aab68ca`                                         |
| M12            | thinking-detail 来源字段按 `contentKind` 唯一规定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `22aab68ca`                                         |
| M13            | 三处内联 `::user_meta` 拼接改用 `deriveContextMessageProjectionId`（将被 3.2 取代）                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `22aab68ca`                                         |
| schema 与门禁  | `MESSAGE_FIELD_SCHEMA` 落地；前缀 `sm_`/`mm_`/`pm_`/`um_`；`check:message-identity-fields` 接入 `check:quality`                                                                                                                                                                                                                                                                                                                                                                                                                                           | `22aab68ca`                                         |
| M15            | 删除写入时补生成和按裸 `messageId` 推导身份：`assignTerminalAssistantSessionIdentity` 无条件生成主键；upsert 只按主键定位，缺主键报 `SESSION_MESSAGE_UID_REQUIRED`，删除 `findCompositeIdentityIndex`、`SESSION_MESSAGE_UID_MISMATCH` 和两处 `\|\| createMessageUid()`；门禁基线 751→746                                                                                                                                                                                                                                                                  | `81f3a83f7`                                         |
| 切片 3         | 版本链门禁；M16（3.2）；快照 v5（v4→v5 接入布局 v8）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 未提交                                              |
| 切片 4（部分） | M2、M4、M5、M8、M9、M14 源码侧完成；写入口身份校验；service 出口与前端视图身份收口；3.5 全部协议，其中：摘要检查点按 uid 判定并删除条数推导旁路；plugin artifact 提交判定、拒绝、receipt、查询收敛到 event-protocol（authority-event 与 reducer 共用一份判定）；`MESSAGE_RUNTIME_PRODUCER` 由 durable/transient 共用，`messageEventCommitInput` 显式传 producer，`emitMessageEvent` 默认参数和投影 `?.()` 探测删除；流身份收敛到单一状态定义和单一初始化点（3.5）；门禁基线 `legacyKeyField 145 / unregisteredField 0`、complexity 234、fallbackChain 561 | 未提交                                              |

## 5. 未完成（对照代码核实，2026-10-22）

当前版本：`WORKSPACE_LAYOUT_VERSION = 8`、`SNAPSHOT_VERSION = 5`。admin、xiayu 已于 2026-10-22 00:35 升到布局 v8（备份 `workspace-backups/2026-10-21T16-35-13-377Z`，隔离区为空）；admin1 无布局状态文件。

副本实证（2026-10-22，`_readNormalizedSession` 纯读取）：46 个会话单元全部被拒绝。39 个默认会话报 `session_message_messageId_removed`、`session_message_userMetaMaterialized_removed`；6 份 workflow 作用域会话 `schemaVersion` 为 7，报 `SESSION_TURN_JOURNAL_SCHEMA_REQUIRED`（读取期修复只对默认会话根生效，作用域会话从未升级）；xiayu `e5cf6060` 只有 `events` 目录，不在 session-tree 与 tombstone 中，是孤儿目录。读取期修复的 `migrateMessageIdField` 是 id→messageId 回填，方向与 v9 相反，救不回这批会话。

### 5.1 存量迁移（切片 4，高风险）

| 项          | 内容                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 快照 v6     | 删除存量快照中的 `userMetaMaterialized`（admin v5 快照 426 处）。必须配 `version: 5` 样例                                                                                                                                                                                                                                                                                                              |
| 布局 v9     | journal 裸 `messageId` 按 5.2 的映射拆分；session-summary 重建；`userMetaMaterialized` 从记录中删除；命令回执 `requestHashVersion`。必须配 handler 测试                                                                                                                                                                                                                                                |
| 内嵌 outbox | 4 份 schemaVersion 6 的 `session.json` 内嵌 `authorityEventOutbox`（各 4 条），由布局 v9 迁入 outbox journal。迁移落地后删除读取期分支 `extractLegacyAuthorityEventOutbox`（`document-migration.js`）、`migrateLegacyAuthorityEventOutbox`（`artifact-methods.js:195-201`、`authority-event-outbox.js`）及其测试（`authoritative-state/__tests__/authority-outbox.test.js`、`session-repair.test.js`） |
| 文档迁移    | `session-repair/src/document-migration.js` 中 id→messageId 的回填，以及 transfer 去重键（`current-turn-message-event-projection.js:80-81`）                                                                                                                                                                                                                                                            |
| 约束        | v9 上线前禁止重启服务：读取校验已经收紧，存量 journal 未迁移，已有会话会被拒绝读取（`session-entity.js:123`）                                                                                                                                                                                                                                                                                          |

schema 中 `removal("userMetaMaterialized")`、`renamed("replacementUserMessageId")` 是迁移来源登记，不是残留。

### 5.2 裸 `messageId` 映射（v9 用，副本实测）

| 角色      | 条数  | 实际值            | 去向             |
| --------- | ----- | ----------------- | ---------------- |
| assistant | 13100 | 模型消息 ID       | `modelMessageId` |
| user      | 220   | 客户端 ID         | `userMessageId`  |
| user      | 2899  | 等于 `messageUid` | 删除             |
| tool      | 7043  | 等于 `messageUid` | 删除             |
| system    | 292   | 等于 `messageUid` | 删除             |

- 实测：journal upsert 29737 条（assistant 17703、user 3609 其中 3359 等于 uid、tool 8102、system 323，后两者全部等于 uid）；checkpoint 快照记录 assistant 41403、user 11868、tool 26923、system 69；`userMetaMaterialized` 与 `messageOrigin` 全部一致；作用域会话残留 `id` 101 条。无冲突样本。
- 记录级规则由协议 `migrateSessionMessageRecordIdentity`（session-protocol）按 `messageFieldRenamesFor`/`messageFieldRemovalsFor` 执行，冲突显式拒绝（`SESSION_MESSAGE_RECORD_MIGRATION_INVALID`），交给隔离。
- 未登记路径（v9 前补登 schema）：manifest `turnLifecycle.turns.*.messageId`、`commandReceipts[].envelope.identity/payload.messageId`；outbox `envelope.payload.presentation.userMessage/assistantMessage` 下嵌套的 `messageId`、`userMetaMaterialized`；session-summary `recentTerminalTurns[].messageId`（summary 按策略重建）。
- v9 覆盖：journal、checkpoint（重算哈希链）、`session.json`、session-summary（重建）、outbox、作用域会话（同时补跑 schema 7→12）。
- 不迁移：`events`、`execution-events` 诊断日志（只追加，无读取方）。
- v9 与源码同批上线，不保留旧名读取，之后门禁 `legacyKeyField` 收紧到 0。

### 5.3 源码兜底（切片 4，未删）

| 项          | 位置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 处理                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 182         | workflow `routes.js:44` `sessionSummary?.updatedAt \|\| session?.updatedAt` 双来源、`:41-43,53` `meta?.` 宽读取；`createWorkflowRuntimeEnvelope` identity 的 `text(...)` 补位；outbox `normalizeConsumerDelivery` 的 `Number(...) \|\| 0`、`normalizeAuthorityEventOutbox` 静默丢弃；attempt/ack/compact 与 `getPendingAuthorityEvents`/`compactAuthorityEvents` 的 `reason` 软返回；`session-entity.js:29` `Array.isArray`（6 份 session.json 缺 `sessionArtifactEvents`）；`service/routes/session-routes.js:174` `Number(doc.schemaVersion \|\| 0)`；`run-event-listener.js:77` `countOf(protocol?.schemaVersion)` | 显式必填、显式拒绝；存量缺字段并入布局 v9                                                    |
| 186         | `model-manager.js` `createStreamingCallbacks(eventListener = null, runtime = {})` 与 `String(value \|\| "")`、`resolveCurrentModelInfo(modelState = {})`；`buildSystemRuntime` 默认参数、environment-provider `runConfig?.`；`run-initialization.js:82/92` 同一 `dialogProcessId` 一处 `text()`、一处原值；`runtime-binding.js` workflow 身份 `text(resolvedRunConfig.*)` 把缺失读作空串；event-protocol `validatePayloadEnvelope`/`validateMessageEventPayload`/`projectMessage*` 的 `text(value?.x)` 宽读取与 `= {}` 默认参数；插件 `workflowNodeExecutionId` 与事件 `nodeExecutionId` 同一事实两个名字             | 显式必填；协议层校验只做类型判定；命名在协议统一为一个                                       |
| 184         | `turn-snapshot.js` eventId 以 `commandId:snapshot:sequence` 拼接推导、`producer` 默认值、`Number(snapshot.sequence)`；session-protocol 快照校验 `Number()` 强转 protocolVersion/sequence、`recentTerminalTurns` 的 `Array.isArray`，投影 `Number(turn.sequence \|\| 0)`；agent-proxy `reconnect.fixtures.js:20` 同样拼接                                                                                                                                                                                                                                                                                              | 先收严 session-protocol 校验与投影；eventId 由 service 调用点显式提供；producer 收成协议常量 |
| 158         | `finalizer.js`、`result-finalizer.js` 的默认参数、可选链、`.filter(Boolean)`；`dialogProcessId` 放宽过滤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 删除；过滤先核实写入路径和存量                                                               |
| 154/164     | `turn-summary-checkpoint.js` 的 `assertCheckpointTargetsTurn` 宽松读取；committer `assertCheckpointScope` 的 `text()` 与笼统 `Error`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | lifecycle 协议提供读取函数；改为 `SESSION_ERROR_CODE`                                        |
| 160         | `summary-checkpoint-command.js`、包装层 `payload = {}`；协议 `createSummaryCheckpointInstruction({...} = {})`；committer 内部默认参数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 删除                                                                                         |
| 156         | `turn-journal-store.js:71-85` 自行解析 receipt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 复用协议 `readTurnSummaryCheckpointState`                                                    |
| 141         | `hook-context.js` 的 `attachModelContext` 静默返回；`user-meta-backwrite.js` 的 `Array.isArray`、`\|\| {}`、`createdAt` 补当前时间                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 显式拒绝；`active-model-context.js` 校验上移 context-protocol                                |
| 149         | `state-machine.js:125-127` `resumeFromStoppedSnapshot` 双来源                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 定唯一来源                                                                                   |
| 173/175/177 | 子会话 `readArray`、harness 与 workflow 的 turnMessages 兜底；`applyTurnCompletionPolicy` 的 `policyOptions = {}`；ledger、counters 同类兜底                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 删除                                                                                         |
| 84          | `turn-terminal.js:98-104`、`turn-projection.js` 静默丢弃未知键                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 显式拒绝                                                                                     |
| 163         | 运行中会话被删除时，检查点和 authority 提交抛 `SESSION_DELETED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 补测试，确认 run-failure 处置                                                                |
| 测试侧      | `Object.assign(createTestRuntimeContext(), …)` 15 处；harness 夹具默认值；e2e `user-interjection-history` 手写 `loopState.modelContext`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 改为工厂覆盖项、迁到 runtime                                                                 |

### 5.4 前端与其他（切片 5）

| 编号     | 位置                                                                                                         | 处理                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| D10      | `shared/message-diagnostics.js:135,172` 读 `noobotMessageId` 并输出裸 `messageId`（前端已清零）              | 只读 `additional_kwargs.messageUid`，输出 `messageUid` |
| 49       | sessions.json 规则登记；8 条空 `identity.messageId` 复核；协议写明前缀只约束新值                             | 登记                                                   |
| stop     | `client/noobot-chat/src/modules/chat/runtime/engine/stop.js:75-83` parent 身份回退链                         | 只读回合事实                                           |
| 89/95    | `sessionDetailMerge.js:80-89` 回退链；`useChatEngineHarness.js:242` upsert 替身                              | 对照 timeline 协议；复用真实实现                       |
| 102/106  | `thinking-detail-content.js:93` 空 `presentationMessageId`；workflow `buildUnifiedSessionDetail` legacy 兜底 | 协议定；核实后删除                                     |
| M10      | receipts 与 checkpoint 快照各存一份 uid 列表                                                                 | v9 前定事实源                                          |
| 任务 C   | 附件信封 `identity.eventId` 与 `attachmentEventId` 是否合并                                                  | 先核实                                                 |
| 迁移框架 | 每步按 vN/vN+1 schema 校验；`retryQuarantinedUnits` 测试                                                     | 补                                                     |
| v6 运维  | 跨文件写入非原子                                                                                             | 写运维说明，停服用副本试跑                             |
| 测试边界 | client vitest（如 `messageEvent.e2e.spec.js`）以相对路径直接引用 `agent/src`、`service/ws` 源码（既有问题）  | 改走包导出或移至集成测试                               |

提交前核对：`agent/__tests__/runtime/core/*.test.js` 曾按目录 glob 运行 prettier，35 个文件的 diff 需逐个确认只含本切片改动。

登记（不合并）：`CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META` 与 `CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META` 取值相同，概念不同。

## 6. 待用户授权

| 事项                              | 原因                                        |
| --------------------------------- | ------------------------------------------- |
| 重启服务执行布局 v8、v9           | 改动真实数据；v9 必须先实现，迁移前自动备份 |
| 切片 3、切片 4 提交（按主题拆分） | 提交须授权（R8）                            |

## 7. 执行顺序

1. 切片 1、切片 2：已完成，`81f3a83f7`。
2. 切片 3：已完成，未提交。
3. 切片 4：协议收敛已完成（3.5），`test:all`、`check:quality` 全绿（2026-10-22）。流身份已收敛（2026-10-22 全绿）。进行中的是 5.3 源码兜底，顺序 182 剩余 → 186 → 184 → 158 → 154/164 → 160 → 156 → 141 → 149 → 173/175/177 → 84 → 163 → 测试侧；之后 5.1 文档迁移、快照 v6、布局 v9，经授权后重启。
4. 切片 5：5.4 前端与其他，门禁两项归零。
