# 消息身份归属规则

本文档是消息身份相关任务的唯一任务清单，按"需求 → 规则 → 已完成 → 未完成 → 待授权"组织。字段契约、前缀和校验以协议包实现为唯一规范，本文档不定义第二套 schema：

- `session-protocol/src/identity/message-identity-schema.js`：`MESSAGE_FIELD_SCHEMA`（类别、前缀、角色约束、`renamedFrom` 迁移来源）
- `session-protocol/src/identity/message-identity.js`：生成函数与校验（前缀读自 schema）
- `attachment-protocol/src/identity.js`：附件事件身份

当前基线：提交 `22aab68ca`；M15 共 9 个文件未提交，按用户决定（2026-10-21）等 M16 完成后一起提交。

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

### 3.2 上下文消息身份：方案 A（M16，已确认，未执行）

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
- 已否决方案 B（全部必填单独生成）：历史消息每轮重投影，ID 不稳定；要稳定只能落库或复制主键，违反 R4。

### 3.3 迁移规范（D14，链执行器已实施，版本链门禁未做）

- 每种存储的每个版本声明字段 schema：当前版本在各 protocol 包，历史版本在 repair 包，运行时只认当前版本。
- 每步只做 vN→vN+1：先按 vN schema 校验输入，执行声明式映射（改名、删除、加常量；结构重组才写转换函数），再按 vN+1 schema 校验输出。
- 版本号升级必须同时登记迁移步骤和样例数据；`check:quality` 门禁检查版本链完整，防止 65b 那种只升版本不写迁移的回归。
- 映射不了（R7）：
  - 可选字段：删除该字段并写入迁移报告，继续。
  - 必填字段或身份字段、未知版本：不猜。原文件整份移到 `runtime/migration-quarantine/<kind>/<原路径>`，旁写 `.reason.json`（版本、步骤、字段、原因），其他文档继续迁移。
  - 隔离文件补上映射规则后可重跑迁回；只由用户手动删除。
- 取代：D4、D11、任务 B 中"其他版本/其他形态一律报错停止"的规则；`session-repair/README.md` 中"身份无法无猜测恢复时必须失败"的约定随实施改写。

### 3.4 系统不阻断（D15，已实施，未提交）

会阻断系统的是 `ensureUserWorkspace`（`agent/src/workspace-lifecycle/index.js:103-140`），不是单会话读取修复：

| 阻断点       | 代码                                                                                                                          | 影响                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 服务启动     | `service/app.js:91-93` 逐用户调用 `ensureUserWorkspace`，循环无 try                                                           | 任一用户任一步抛错，`startHttpServer` 不执行，服务退出 |
| 用户全部请求 | `execution/initializer.js`、`session-execution-engine.js`、`turn-attachment-enricher.js` 每次请求先调它；失败步骤不写布局版本 | 该用户所有会话都无法执行，且每次重跑都失败             |

切片 1 已实施（未提交）：

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

## 4. 已完成

| 项            | 内容                                                                                                                                                                                                                                                                                                                       | 提交                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 任务 A 协议   | 流 ID 删除：event-protocol 信封 `identity` 删 `messageId`，`ordering.scopeId` 必须等于 `presentationMessageId`；session-protocol、authoritative-state、semantic-transfer、context-protocol、agent-proxy 同步                                                                                                               | `65b39481f`                                         |
| 生成函数      | `identity.js` 改名 `message-identity.js`；新增 `createPresentationMessageId`、`createUserMessageId`、`assertMessageIdentity`、`createAttachmentEventId`；随机源收敛到 `@noobot/shared/secure-identity`；内联生成全部替换                                                                                                   | `65b39481f`（`createUserMessageId` 在 `22aab68ca`） |
| M1            | 运行时 `assistantMessageId` 改名 `modelMessageId`（不落库，无迁移）                                                                                                                                                                                                                                                        | `22aab68ca`                                         |
| M3、M6        | 删除 `applyAuthoritativeMessageId` 三份写入；删除恒为空的 `authoritative_final_commit_completed.messageId`                                                                                                                                                                                                                 | `22aab68ca`                                         |
| D1/D2/D4/D8   | `noobotMessageId` 在 agent、context-protocol、harness、门禁中删除；`readContextMessageField` 只读 `additional_kwargs`；`am_` 补位删除；唯一投影入口                                                                                                                                                                        | `65b39481f`                                         |
| D11、D12      | semantic-transfer 信封升 v3，`upgradeTransferEnvelope` 唯一迁移规则；布局 v6 处理器 `session-transfer-envelope-upgrade.js` 覆盖默认会话根和插件声明的作用域会话根                                                                                                                                                          | `65b39481f`                                         |
| M11           | 插话主键改用 `createMessageUid`，`user-interjection:` 拼接已无残留                                                                                                                                                                                                                                                         | `22aab68ca`                                         |
| M12           | thinking-detail 来源字段按 `contentKind` 唯一规定                                                                                                                                                                                                                                                                          | `22aab68ca`                                         |
| M13           | 三处内联 `::user_meta` 拼接改用 `deriveContextMessageProjectionId`（将被 3.2 取代）                                                                                                                                                                                                                                        | `22aab68ca`                                         |
| schema 与门禁 | `MESSAGE_FIELD_SCHEMA` 落地；前缀 `sm_`/`mm_`/`pm_`/`um_`；`check:message-identity-fields` 接入 `check:quality`                                                                                                                                                                                                            | `22aab68ca`                                         |
| M15           | 删除写入时补生成和按裸 `messageId` 推导身份：`assignTerminalAssistantSessionIdentity` 无条件生成主键；upsert 只按主键定位，缺主键报 `SESSION_MESSAGE_UID_REQUIRED`，删除 `findCompositeIdentityIndex`、`SESSION_MESSAGE_UID_MISMATCH` 和两处 `\|\| createMessageUid()`；门禁基线 751→746；agent 1545/1545、service 286/286 | 未提交（9 个文件）                                  |

## 5. 未完成（对照代码核实，2026-10-21）

### 5.1 M16：上下文消息身份（按 3.2 实施）

| 位置                                                                                                                      | 现状                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent/src/context/assembly/message-builder/context-blocks.js:29`                                                         | 不落库的 system 上下文用 `createMessageUid()` 生成伪会话主键                                                                                                                                                                                                                   |
| harness `buildHarnessInjectedRecord` / `buildHarnessInjectedMessage`（`injected-message-utils.js`）                       | 一个入口同时产出落库记录和临时注入；拆为两个入口，删除 `persistHarnessRecordToCurrentTurn` 的 `enabled` 开关。落库：`prompt-injector`、`injection-utils`；临时：`memory-takeover`、`message-takeover`、`result-pipeline`、`validation-runner-prompts`、`acceptance/controller` |
| `context-protocol/src/message/codec.js:133` `deriveContextMessageProjectionId`、`store.js:68` `deriveMessageProjectionId` | 两个拼接函数并存，删除                                                                                                                                                                                                                                                         |
| `context-protocol/src/message/store.js:187` `getMessageId`                                                                | 别名，调用方 `agent/src/runtime/turn/orchestrator.js:99`、harness `prompt-injector.js:167,173`、`signal-tracker.js:33,58`；按用途改到 `resolveContextMessageKey` / `resolveContextSourceMessageUid`                                                                            |
| `codec.js:123` `resolveContextMessageId`                                                                                  | 删除，由上两个函数取代                                                                                                                                                                                                                                                         |
| `user-meta-backwrite.js:42-81`                                                                                            | `userMetaMessageUid` 装拼接 ID，`backwriteId` 去重；改用 `sourceMessageUid` + `attachmentRef` 定位，字段改名 `userMetaSourceMessageUid`；backwrite 落 `turns/*.jsonl`，需随 v8 迁移                                                                                            |
| `session-protocol/src/identity/message-identity-schema.js:84`                                                             | `contextMessageId` 旧定义，按 3.2 重写，并登记 `projectionType`、`sourceMessageUid`、`sourceTurnScopeId`                                                                                                                                                                       |
| `scripts/quality/model-context-convergence/protocol-contracts.mjs`                                                        | 锁定旧实现的正则契约同步改写                                                                                                                                                                                                                                                   |

### 5.2 D13：模型上下文快照迁移（原文档记为"D9 快照迁移"，改号）

- 现状（切片 2 已实施，未提交）：v3→v4 迁移已接入布局 v7，尚未在真实数据上运行（需授权后重启服务）。
  - 映射：`context-protocol/src/policy/snapshot-migration.js`（`migrateModelContextSnapshot`，与 `SNAPSHOT_VERSION` 同包）；旧字段名取自 schema 的 `MESSAGE_REMOVED_FIELD_NAME`，不新增门禁豁免。
  - 文件层：`agent/src/workspace-lifecycle/model-context-snapshot-upgrade.js`，owner `model-context-snapshot-v7`；遍历 `SESSION_DIR` 与作用域会话根，加会话锁，备份后原子写回；映射不了的快照移入隔离区。快照目录名登记在 `SESSION_ARTIFACT_FILE_NAMES.modelMessageSnapshotsDir`。
- 存量（在用）：24 份，v3 22、v2 1、v4 1。重启后 22 份 v3 迁移，v2 按 `unsupported_version` 移入隔离区（D5 原定删除，改为隔离，删除仍由用户手动执行）。
- 副本验证：166 份（含 workspace-backups）中 v3 163 份全部迁移成功，v4 1 份不动，v2 2 份进隔离。
- 方案：按 3.3 建版本链。v3→v4 = 当前代码形状（v4 可能已在其他机器写出，不复用版本号），v4→v5 = 3.2 身份形状。
- v3→v4 映射（原 D4/D6/D9 规则，失败处理改为 3.3）：
  - `additional_kwargs.noobotMessageId` → `messageUid`；删除 `lc_kwargs` 镜像，删除前确认与正本一致。
  - `raw` 中的元数据并入 `additional_kwargs`；`lc_kwargs.contextPolicy` 移入；记录顶层 `summarized` 仅为 `true` 时移入。
  - `am_*`：同一快照内同值替换为同一个新 ID（v5 中归入 `contextMessageId`）。
  - incremental 块缺回合字段的消息写入所属快照记录顶层的 `dialogProcessId`、`turnScopeId`（文件名即 `<dialogProcessId>__<turnScopeId>`）。
  - `injectedMessageType` 非空且缺 `injectedMessage` 时补 `true`。
- v4→v5 映射：`sm_*` 不变；伪主键挪到 `contextMessageId`；`<src>::<type>` 拆为 `projectionType` + `sourceMessageUid`/`sourceTurnScopeId`，类型未知或来源在 journal 中不存在则隔离。
- 已核实（2026-10-21）：隔离后按无快照继续。`loadStoppedModelMessageSnapshot`（`model-message-snapshot-store.js:234`）以 `allowMissing: true` 调用时文件不存在返回 null，`prepareStoppedSnapshotResumeTurnExecution`（`turn-execution-preparer.js:117`）转 `prepareWithoutStoppedSnapshot`；阻断继续的是原地 v3 文件在 `hydrateModelContextSnapshot` 抛错。

### 5.3 D14、D15：迁移框架与不阻断

- D15 已完成（切片 1，见 3.4）：lifecycle、transfer 信封按文档/会话隔离；`upgradeWorkspaceLayout` 按步推进、不抛错；启动循环按用户捕获。
- D14 部分完成：链执行器在 `shared/migration.js`（`defineVersionChain` 校验步骤连续不重复，`runVersionChain` 把链外版本统一报 `MIGRATION_UNMAPPABLE`）。未做：版本链门禁（升版本必须登记迁移步骤与样例）、每步按 vN/vN+1 schema 校验（目前由 hydrate 终检）。重跑由重启服务时的隔离区重试承担，不另设命令。
- 其他存储（transfer 信封、session 文档 `document-migration.js`、长期记忆）暂不迁到新框架，之后单独排期。

### 5.4 裸 `messageId` 拆分与布局 v8（任务 B，含 M2/M4/M5/M7/M8/M9/M14）

journal 中 `messageId` 按角色承载三类事实（admin 工作区 23554 条）：

| 角色      | 条数  | 实际值            | 去向                   |
| --------- | ----- | ----------------- | ---------------------- |
| assistant | 13100 | 模型消息 ID       | `modelMessageId`（M2） |
| user      | 220   | 客户端 ID         | `userMessageId`        |
| user      | 2899  | 等于 `messageUid` | 删除                   |
| tool      | 7043  | 等于 `messageUid` | 删除（M9）             |
| system    | 292   | 等于 `messageUid` | 删除                   |

| 编号 | 位置（已核实仍存在）                                                                                                                                                                                                  | 处理                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| M5   | `agent/src/session/entities/message-entity.js:58-59` `resolveRuntimeMessageId` 的 `firstText(message.messageId, messageUid)`；`session-repair/src/document-migration.js:641` 的 `item.messageId \|\| item.messageUid` | 删除回退，只认 `userMessageId`；门禁 `agent-contracts.mjs` 中固化该回退的规则同步改                               |
| M9   | `agent/src/runtime/tool-execution/state-committer.js:156` `messageId: messageUid`                                                                                                                                     | 删除副本；测试 `state-committer-hook.test.js:214,306` 的同值断言一并删除                                          |
| M2   | journal 助手消息、`turn-upsert`、`turn-persister`、`no-tools-commit-stage`、workflow `persistence.js`                                                                                                                 | 改写 `modelMessageId`                                                                                             |
| M4   | `message-summary-projection.js:185` 展示摘要 `presentationMessageId \|\| messageId`                                                                                                                                   | 分别输出两个字段；session-summary 由 v8 重建；`session-routes.js` 调试输出同步                                    |
| M7   | 前端 `messageView`、`turnPresentation`、`subSessionSnapshotMerge`、`messageModel`、`conversationFoldingIdentity`                                                                                                      | 视图只用 `presentationMessageId`，占位改 `placeholderId`；依赖 M4                                                 |
| M8   | `summarizedMessageIds`、`summaryCheckpointMessageIds`、`markedMessageIds`、投影源 `sourceMessageId`                                                                                                                   | 改名 `*MessageUids` / `sourceMessageUid`；`replacementUserMessageId` → `replacementUserMessageUid`；落库部分随 v8 |
| M14  | `runner-bot-hook.fixtures.js:84` 内联 `msg_user_test_`                                                                                                                                                                | 改 `userMessageId`                                                                                                |

- v8 覆盖：journal、checkpoint（重算哈希）、`session.json`、session-summary（重建）、outbox、作用域会话；命令回执新增 `requestHashVersion`（存量 1，新写 2，版本不一致重放返回 `command_receipt_superseded`）；M16 的 backwrite 字段一并迁移。
- 不迁移：`events`、`execution-events` 诊断日志（只追加审计，无读取方）。
- 顺序：源码引用改名 → 按角色拆分 → v8 迁移与源码同批，不保留旧名读取 → 门禁收紧到 0。当前门禁基线 `legacyKeyField 746 / unregisteredField 131`（`scripts/check-message-identity-fields.mjs`）。

### 5.5 其他遗留

| 编号     | 位置                                                                                                                                       | 处理                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| D10      | `shared/message-diagnostics.js`（2 处）、前端 `client/noobot-chat/src/modules/chat/stores/subSessionSnapshotMerge.js` 读 `noobotMessageId` | 只读 `additional_kwargs.messageUid`；前端删除读取 |
| M10      | `session.json` `turnSummaryCheckpoints.receipts[]` 与 `turn-snapshots/*/checkpoint-*.json` 各存一份 `persisted/summarizedMessageUids`      | 定事实源后删副本；快照参与哈希链，v8 前确认       |
| D1 遗留  | `accepted[].messageId` 混装模型 ID 和 `messageUid`                                                                                         | 随 5.4 拆分                                       |
| 任务 C   | 附件事件信封 `identity.eventId` 与 payload `attachmentEventId` 是否合并                                                                    | 先核实生成方和读取方                              |
| 测试侧   | `runCanonicalAgent` 把 store 内所有助手消息写成同一 `messageId`，多助手场景会掩盖冲突                                                      | 随 M2 改                                          |
| 静默丢弃 | `normalizeCommandReceipt`、`normalizeAuthorityEventOutbox`；activity timeline、thinking-detail 未声明字段被白名单跳过                      | 改为报错                                          |
| v6 运维  | 跨文件写入非原子，中途失败只能靠备份恢复；只在夹具验证过                                                                                   | 写运维说明；停服用真实数据副本试跑                |
| e2e      | `050-user-interjection` 断言已改（M11）                                                                                                    | 需真实服务环境运行                                |

登记（不合并）：`CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META`（内部消息类型）与 `CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META`（投影类型）取值相同、概念不同。

## 6. 待用户授权

| 事项                                                                                    | 原因                     |
| --------------------------------------------------------------------------------------- | ------------------------ |
| 链执行器 `runVersionChain` 放在 `@noobot/shared/migration`，重跑命令放根 `package.json` | 已授权（2026-10-21）     |
| 改 `service/app.js` 启动循环、`agent/src/workspace-lifecycle` 三个升级处理器            | 已授权并完成（切片 1）   |
| 重启服务执行布局 v7：22 份 v3 快照迁移，1 份 v2 移入隔离区（是否删除另定）              | 改动真实数据，副本已验证 |
| M15 与 M16 合并提交；本文档在 M15 的 9 个文件中，随之提交                               | 提交须授权（R8）         |

## 7. 执行顺序

1. D15（切片 1）：已完成，未提交。
2. D14 链执行器 + D13 v3→v4 + 布局 v7（切片 2）：已完成，未提交，副本验证通过；全量测试 shared 60、session-protocol 122、context-protocol 128、workspace-protocol 30、agent 1548、service 288 通过，`check:quality` 通过（746/131，豁免 1）。待授权重启执行真实迁移。
3. D14 余项：版本链门禁。
4. M16：codec 互斥身份、生成点拆分、调用方改到两个读取函数、删除派生函数与别名；快照升 v5，写 v4→v5。
5. 全量测试与 `check:quality`；M15 + M16 提交（授权后）。
6. 5.4 任务 B 与布局 v8（v7 已被快照迁移占用）；之后 5.5。
