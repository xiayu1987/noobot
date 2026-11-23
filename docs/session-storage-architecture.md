# 会话存储架构

本文说明**目标架构、当前实现、权威数据与升级协议**，不是研发记录、运行手册或部署报告。字段、格式及错误语义以 [Session 协议](../session-protocol/README.md) 和源码为准；“已实现”指代码存在，不表示生产部署或容量验收已完成。

## 1. 规划：三个目标与取舍

| 目标                                     | 前台工作范围                                                                              | 不作的承诺                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 同一轮越来越长，下一次固定大小操作不变贵 | 流式写只处理新增内容和本次状态变化；轮可以跨多个有界分区；读按块、按页、按窗口            | 不要求完整导出或整条替换与增量等价；无限模型上下文无法保持固定成本                            |
| 当前轮不随历史轮数增加而变慢             | 当前轮按已知作用域和归属定位；展示、模型上下文各自受扫描量、字节、候选数或 token 预算约束 | 全历史随机身份查找、首次唯一身份占用和冷查询不是零成本；不得把它们伪装成每个 chunk 的必要步骤 |
| 存储不失控                               | 保留规则、局部回收、各类积压与容量准入组成闭环；空间不足时停非必要写入、背压或拒绝新轮    | 不靠自动抹除正式历史来维持空间；要求无限保留时只能扩容、受控归档或拒绝新增                    |

从改造前保留**按轮归属、增量追加、已发布字节边界**三个原则；不恢复旧格式清单全量改写、整轮差异比较或在线双写。轮是业务边界，分区是物理边界，两者不是一一对应。取代的 Immutable 路径在一次业务提交后发布对象图、回执索引和物理定位树；高频小改动会累积旧定位页。新路径用顺序日志保存事务事实，而不是为每次增量重建会话级对象图。

### 目标结构

| 部件               | 职责与不变量                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 活跃分区与热状态   | 承接已验证归属的增量；热状态只保留活跃控制、有限索引和待完成操作，而非整个当前轮。按字节与记录界限滚动，检查点只覆盖恢复所需状态；未应用尾部达到上限时背压。                     |
| 封存分区与局部索引 | 按逻辑序号和归属定位；普通追加不改写冷分区。确需历史修改时定位所属分区并局部发布。任意全局身份仍有唯一性协议，但已有消息的每次内容块追加不应重新接纳消息身份。                   |
| 事务、投影与读者   | 业务事实和同事务事件由已发布日志或其等价封存表示承载；展示及上下文不另设权威。读者固定发布位置；需要读己之写时只补预算内的尾部，超出则显式等待或报错，不扫描整段历史。           |
| 维护与容量         | 维护器只整理预算内的候选分区，由同一发布协议决定何时可替换并回收旧版本。容量准入同时考虑有效数据、所有保留引用、维护临时文件与未落盘预留；不能靠后台最终会释放空间作为准入依据。 |

目标复杂度针对固定增量和固定窗口：追加应由新增字节和有界局部索引工作主导；分页应由页预算与定位成本主导；导出仍随输出大小增长。严格的增长验收不以宣称所有冷查找都是 O(1) 为前提，也不能仅凭顺序日志已接通推断达到这三个目标。

## 2. 实现：装配、协议与权威

1. [服务装配](../service/bootstrap/create-app-dependencies.js) 仅调用 [分区会话服务](../agent/src/session/index.js)；[运行配置](../service/services/runtime-config-service.js) 要求全局 `partitionSessionStorage`，包含 `journalLimits` 和 `maxJournals`。缺失或无效即失败，不回退到 Immutable。
2. 一个会话运行时使用一个 [Journal Owner](../agent/src/session/partition-storage/partition-journal-owner.js)，所有工作区共享驻留名额。名额满时通过退役释放空闲实例；没有空闲实例则报忙。退役失败不释放名额，后续准入可重试同一退役流程。停用工作区必须排空该工作区的租约。驻留数不是磁盘配额。
3. [权威读取与迁移协议](../session-protocol/src/session-reader.js) 区分原生分区目录、已迁移目录和旧源。原生分区直接使用会话目录；已迁移会话的 `session-authority` 选择 `partition-session/`，并校验发布身份和目标日志头。暂存目录与阶段凭据均不能授权在线读写。未升级的 Immutable 会话在线报 `SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED`。
4. 单会话只有一个可写权威；旧 `head.json` 即使物理保留，也不是在线候选。消息身份和作用域由协议校验；插件通过作用域和会话接口访问，不读写分区文件。附件索引、摘要及展示只能按其契约引用已提交事实，不能凭投影补造身份。

### 2.1 物理组织与提交

```text
Bot 当前轮持久化 / 服务会话接口
    → Session 仓储（作用域、变更协调、读者生命周期）
    → PartitionSessionMessages / PartitionSessionTransactions（业务事实与响应）
    → PartitionTransactions（快照、请求接纳、集合读写）
    → PartitionJournal（批量追加、索引发布、持久回执）
```

依赖只向下。日志不了解轮、消息、插件或模型；业务层不直接编辑日志文件。Session 协议定义层间请求、记录和返回值；[仓储](../agent/src/session/repositories/file-system-session-repository/reader-methods.js) 向调用方交付绑定作用域的读者和提交端口。

- [日志协议](../session-protocol/src/partition-journal.js) 定义磁盘格式（版本以 `PARTITION_JOURNAL_FORMAT` 常量为准）、限额、序列和位置；`CURRENT` 持久发布已提交位置、目录状态与策略。层级分区目录内保存 `records.log`，`offsets.idx` 用定长偏移定位分区内序列。目录与实体页按需读取，不等于一个每次都重写的全会话 JSON 清单。见 [日志 I/O](../agent/src/session/partition-storage/journal-io.js)、[偏移索引](../agent/src/session/partition-storage/journal-offsets.js) 和 [实体目录](../agent/src/session/partition-storage/partition-entity-directory.js)。
- [会话事务](../agent/src/session/partition-storage/partition-session-transactions.js) 将消息、生命周期、索引变化及相关 outbox 事实按业务一致性边界提交；[日志写入](../agent/src/session/partition-storage/journal-writer.js) 合批发布，但保留事务顺序、各自位置和回执。事务帧包含长度、摘要和提交尾标；单有完整帧并不代表已发布。数据与索引先同步，发布 `CURRENT` 再完成持久确认。
- [消息协议](../session-protocol/src/partition-session-messages.js) 区分创建、正文追加、元数据更新和正文替换。追加携带预期正文引用，更新要验证归属及版本；元数据变更不等同于重发正文。首次身份占用与维护已有实体都应有协议证据，不能分配旁路 ID，也不能漏掉首次占用的冲突校验。
- [事务协议](../session-protocol/src/partition-transaction.js) 约束身份、代次和重放。外部副作用的执行前意图与执行后结果是两个持久化边界，不能为了实现“一次工具调用一次提交”而合并；结果不确定时按工具协议处理，不能盲目重跑。

| 对象               | 持久事实与访问方式                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日志头 `CURRENT`   | `sessionId`、`epoch`、已提交 `sequence` 与 `tail`、活跃分区记录数、回执起点、限额和目录根。提交可见性取决于它，不取决于文件实际长度。                                         |
| 分区目录与偏移索引 | 封存分区记录首尾序列、已提交字节和集合根；按序列定位分区，再以定长偏移定位帧。集合帧可按 slot 读取变更，不要求解码所有同帧变更。                                              |
| 实体目录           | 分别组织身份占用、最近更新、活动集合和迁移历史操作。实体拥有者引用包含 `epoch/partition/sequence/slot`，不是物理文件名或消息 UUID。索引决定如何定位事实，不授权越过提交边界。 |
| 消息与正文         | 消息记录保存业务身份、归属、元数据及正文引用；`messageContent` 保存版本化正文。按正文引用和范围读取，不从展示预览重建正文。轮次和消息的业务标识不随分区滚动而改变。           |
| 投递与回执         | outbox 记录事件顺序、消费者投递状态及游标；提交回执记录事务已经提交的身份与结果。这两类确认含义不同，不能彼此替代。                                                           |

**提交可见性与重放：**写者在发布锁内重读日志头，拒绝 epoch 不符或序列回退。新事务必须连续；已有位置只有回执仍在窗口且内容一致时才重放，同位置不同内容报冲突，过期拒绝，不能当作新操作。先发布帧、偏移及集合/分区目录，再以 `CURRENT` 切换可见性。发布阶段结果不确定时返回 `SESSION_COMMIT_UNCERTAIN`；从持久状态重开并重试**同一请求**，由回执决定是否已经提交，不重新生成操作身份。

**Outbox：**[实现](../agent/src/session/partition-storage/partition-outbox.js) 将业务事件及其顺序纳入会话事务；消费者按自有游标读取并提交确认。推进游标须核对预期位置以及覆盖区间的投递状态，不能越过未交付事实。逻辑投递压缩、轮退役与物理日志删除不是同一操作。

### 2.2 读取、投影与恢复

- 自动标题仅从固定快照内的已提交消息派生，业务元数据不存 `autoTitle`；`customTitle` 是独立设置。候选索引只保存位置，标题读取校验可见归属后读取有界正文预览，不扫描历史。列表、详情与导出采用同一派生流程；迁移分别严格对账业务元数据与两端快照的派生标题。旧分区原型格式显式拒绝，不在线解释为当前格式。
- [Partition Reader](../agent/src/session/partition-storage/partition-session-reader.js) 从快照读取轮状态、消息页、正文页、摘要检查点、工具配对、展示与上下文。展示、时序、上下文等索引遵循同一提交边界；实体更新可在协议预留内延后发布，未应用的记录数与字节受限。索引滞后不能授权绕过快照或转为无界扫描。
- [仓储读取契约](../agent/src/session/repositories/file-system-session-repository/reader-methods.js) 中 `findSessionReader` 在不存在或已删除时返回空值，`requireSessionReader` 区分 `SESSION_NOT_FOUND` 和 `SESSION_DELETED`。已登记且存活的作用域必须打开权威存储；存储损坏或权威不匹配不能折叠成会话不存在。
- [执行查询](../agent/src/session/services/execution-read-service.js) 逐会话获取并释放权威快照，通过 [`readExecutionSource`](../session-protocol/src/session-reader.js) 读取可见生命周期记录，不使用会话时间戳、聚合版本或全量导出。任何参与查询的会话不可读时，快照、子执行和执行树查询均返回 [`execution_query_incomplete`](../session-protocol/src/execution-lifecycle.js)，不发布部分结果，也不把未知当成不存在。服务保留按会话诊断，WebSocket 返回失败回执。各会话独立固定快照，不提供工作区级原子视图。此路径仍扫描生命周期历史；按执行、父执行和根执行定位的有界契约未完成，不用于聊天首屏。
- [上下文读路径](../agent/src/session/partition-storage/partition-context-reader.js) 走上下文索引和读取预算；限历史轮数并不替代候选与读取预算。当前轮也要受上下文限制；摘要、裁剪或拒绝按上层明确策略执行，不能把整个不断增长的当前轮反复交给模型。
- [HTTP 路由](../service/routes/session-routes.js) 已提供 `detail-start`、`display-page`、`display-artifact-page`、`message-content-page`。展示页、展示产物页和思考详情页共用响应中断释放流程；[快照期限及释放归属](../session-protocol/README.md#retained-session-pages)以 Session 协议为准。[浏览器展示页传输层](../client/noobot-chat/src/infrastructure/api/chat/chatApi.js) 在续页失败时释放请求中已持有的游标，首屏校验失败时释放已解码的游标；释放失败和原错误一并报告。
- 选会话、重连及详情刷新仍使用完整详情 GET。`detail-start` 的展示行、元数据与轮次状态来自同一会话快照；实际消息行只返回正文版本和 JSON 字节数，不读取正文块。[正文分页协议](../session-protocol/README.md#retained-session-pages)按展示行的版本读取，变化时返回冲突，不替换成新版本正文。`display-artifact-page` 独立固定单个会话和轮次，不承诺与首屏同版本，也不提供跨会话父链归属。父链附件及插件受管事实仍需明确契约。不能把一页伪装成完整分支文档，也不能拉齐所有页复原旧 GET。目标是仅显式导出才全量遍历。
- 展示产物页同样只返回元数据和版本化正文引用。[作用域会话读取](../agent/src/session/session-scoped-artifact-reader.js)按 [Session 协议](../session-protocol/README.md#retained-session-pages)在实际读取所用的快照内校验已提交的直接父会话和请求所选目标。[插件服务会话端口](../service/services/plugin-service-ports.js)不读取无已发布会话的孤立执行报告。作用域校验不等同于跨会话附件归属或浏览器消费链路。
- 展示页与展示产物页的浏览器续页都必须传入上一页，由 Session 协议校验游标、代次及各自的快照事实；服务端独立校验单页。展示产物读失败后按原会话、对话进程和轮次释放游标；读与释放均失败时保留两项错误。这不表示聊天首屏已切换为分页。
- Workflow 节点思考详情与主聊天共用 Session 协议的接收、续页校验和 HTTP 发送流程。请求前核对上一页签发的游标；响应须保留代次和消息总数。未被上一页签发的游标不发送也不释放；请求发出后，读失败按原作用域释放。节点路由中断会退役未写完响应的游标。插件仅使用其受管会话端口，不引用主应用的内部实现。[前端回归](../plugin/noobot-plugin-workflow/frontend/__tests__/WorkflowNodeSessionViewer.spec.js) · [HTTP 回归](../service/__tests__/routes/session-routes-workflow.test.js)
- [恢复](../agent/src/session/partition-storage/journal-recovery.js) 依据 `CURRENT` 恢复已发布尾部，清理未发布后缀。已提交内容缺失或损坏是错误，不静默截断；修复需可信分区备份及写入证据。常驻对象退役失败也不能吞错释放容量后继续复用。打开/恢复的增长验收应同时测控制状态、目录页和未发布尾部，不只测日志回放。

#### 聊天详情切换验收（未完成）

- [详情请求](../client/noobot-chat/src/modules/session/model/list/sessionDetailRequests.js) 和[详情应用](../client/noobot-chat/src/modules/session/model/list/sessionDetailApply.js) 仍以完整分支文档为契约。[Session 父链协议](../session-protocol/src/aggregate/session-detail-branch-dialogs.js) 从已提交的分支消息解析父对话关系，校验归属冲突与环。[附件投影](../client/noobot-chat/src/modules/session/model/list/detailMessages.js) 依据该关系归并多级子轮附件。展示产物页目前仅固定一个会话和轮次。
- 现有[分支归属](../session-protocol/src/aggregate/session-detail-branch-dialogs.js)来自权威会话已提交消息中的 `dialogProcessId` / `parentDialogProcessId`，而非附件目录、父会话路径或展示产物的轮内计数。它在完整输入中校验同一对话的归属冲突、父链冲突和环；不能把该算法直接用于不完整的分页输入。
- 切换前，Session 协议须定义如何以首屏可见轮次为起点有界定位已提交的跨会话附件引用，并区分完整且为空、归属冲突、来源不可读和定位未完成。索引只能定位已提交事实，不能另设归属真相。协议须声明根会话页与各来源的发布视图如何关联和失效；现有独立快照不提供跨会话原子视图。插件受管来源按声明的作用域参与，不从路径推断父对话；浏览器不遍历插件存储、不从未读历史推断归属。
- 归属和附件元数据由不同协议事实提供。[入轮解析](../agent/src/context/providers/attachment-resolver.js)和[完整详情](../agent/src/session/services/session-attachment-projection.js)按完整身份访问[附件目录](../agent/src/artifacts/attachment-catalog.js)。工作区布局 v45 为每个会话和来源发布一个 SQLite 目录。按附件 ID 和客户端附件 ID 查对应索引，显式列表才遍历作用域。测试核对了查询计划，并验证无关记录损坏时单条查询仍只解码目标。[附件元数据契约](../attachment-protocol/README.md#已提交附件引用的元数据读取)
- 附件写入先持久化待发布正文清单，正文同步后提交元数据并清除待发布记录。工作区修复或同一作用域的下一次写入按清单回收未发布正文。测试强制终止独立写进程，验证未发布正文不可查询、恢复只保留重试提交的正文。v45 升级发布并逐条核对目录后备份旧索引，随后移除源索引。升级中断时重复核对同一份源数据。[迁移](../agent/src/workspace-lifecycle/attachment-catalog-upgrade.js) · [进程恢复测试](../agent/__tests__/artifacts/attachment-catalog-recovery.test.js)
- 浏览器分别处理列表摘要可用性和详情读取结果。[完整分支详情协议](../session-protocol/README.md#full-branch-detail-availability)规定主会话或任一分支条目不可用都不能应用或缓存为成功；先显示主会话的失败，否则显示首个不可用分支条目的原始原因。失败清除已应用详情，不覆盖列表摘要；重新选中可重试，强制重选不复用已完成的详情缓存。重连协调和变更后刷新以实际详情应用结果判定成功，不把收到响应等同于恢复。
- 切换须覆盖选会话、重连和详情刷新，并验证子轮附件归属、正文版本变化、切换会话时的游标释放，以及固定窗口下不请求完整详情、不预取全部分页。不能把分页响应包装成旧完整文档后交给现有投影。

#### 执行定位与分页验收（未完成）

- [Session 执行查询协议](../session-protocol/README.md#execution-query-ownership--执行查询归属) 定义查询目标及冲突范围；无效目标在访问存储前拒绝。关系筛选确定哪些执行 ID 参与查询，但不能只用关系筛选后的声明判定身份唯一。
- [仓储枚举](../agent/src/session/repositories/file-system-session-repository/agent-session-methods.js) 合并工作区会话树与协议声明的受管作用域，从同一份持久删除状态排除已删除身份及仍处于目录清理阶段的确切路径和子树，排除发生在读取存储权威之前。目录阶段确认后，旧目标路径不再排除复用该路径的新会话；未标记目录损坏仍使查询失败。真实 Bot 回归覆盖 Workflow 子执行的单点、直接子级与整树查询。[执行来源](../agent/src/session/partition-storage/partition-session-source.js) 仍枚举各快照的全部 `lifecycle` 键，并分批读取可见状态。当前查询成本同时受工作区会话数和各会话生命周期历史影响。
- 有界方案须证明按执行 ID、直接父执行和根执行定位所涉及的会话，不保存第二份执行状态。定位声明及退役必须能与发布位置对账，覆盖创建、替换、删除、迁移和中断恢复；缺失或滞后的定位不能用全扫补齐，也不能返回不存在。续页需绑定明确的读取视图、范围和预算，并有取消、结束和过期后的释放责任。
- 验收应在固定目标和页大小、递增无关会话及历史的冷读中观察打开会话数、候选数、读字节与租约释放，覆盖直接子级与整树的冲突范围和续页一致性。[重连恢复](../client/noobot-chat/src/modules/chat/runtime/session/reconnectCoordinator.js) 已发出整树和单点查询，是现有历史扫描的调用者；不得把现路径再接入首屏，也不得用客户端拉齐分页重建整树。

#### 分支删除与清理恢复（部分完成）

- [分支删除](../agent/src/session/services/session-tree-service.js)在生命周期锁内按 Workspace 协议合并会话树和声明作用域内已提交的父子关系，将会话删除标记、确切目录、插件处理器清单及下一阶段一并写入[工作区删除状态](../workspace-protocol/src/session-tombstone.js)，随后撤销分页快照并删除目录及树节点。[HTTP 路由](../service/routes/session-routes.js)按同一份已记录目标执行插件、附件和短期记忆阶段。
- 语义传输产物由附件服务写入。不再删除无当前写入者的旧 `.semantic-transfer` 路径；外部部署遗留目录须核对归属后单独处理。
- [插件删除协议](../hook-protocol/README.md#session-deletion-hooks)将有序处理器清单与删除目标、标记一同持久化，重试只使用已记录的清单；已登记处理器缺失时不跳过。超时会发出取消信号，但删除锁会等处理器退出才释放。[Harness](../plugin/noobot-plugin-harness/src/utils/cleanup.js)在删除正文前先将目标运行目录原子移入可重放的暂存命名空间，运行清单已被部分删除时仍可重试。
- Harness 按运行清单的 `sessionId`／`parentSessionId` 清理，不把目录名当作会话归属；新运行先发布归属，再写诊断产物。[准入与互斥](../plugin/noobot-plugin-harness/src/store/run-mutation.js)对建目录、写入、延迟刷盘和清理使用同一个工作区级 Harness 描述符锁，并以工作区持久删除标记拒绝迟到写入。删除会取消目标运行未发布的诊断数据，不触发全局刷盘。[并发与重启回归](../plugin/noobot-plugin-harness/__tests__/shared/run-cleanup.test.js)验证清理不会越过进行中的写入、取消后可重试、延迟刷盘不重建目录，新进程仍拒绝已删除会话的写入，并保留无关运行的缓冲数据。
- [HTTP 故障注入](../service/__tests__/partition-session-plugin-deletion-recovery.integration.test.js)验证了真实 Harness 在部分删除、清理成功但阶段未确认后，可在 Bot 重建后重试；重叠批次显式拒绝并保留无关会话。并发测试验证同一请求要等超时处理器退出才重试。分区 Bot 测试另验证了附件清理完成但确认未落盘的重放，以及已确认的插件阶段不会重做。
- [独立进程 HTTP 故障注入](../service/__tests__/partition-session-deletion-crash.integration.test.js)覆盖目录、会话树、Harness 插件、附件、短期记忆五个阶段：每次在该阶段执行完成但尚未写入确认时强制终止。新进程按原目标及处理器清单从未确认阶段续跑，不重做已确认阶段，保留无关会话、运行、附件和记忆；完成后重复请求不再执行清理。进程退出释放描述符锁，不依赖心跳过期或手工清锁。
- [跨进程快照退役](../service/__tests__/partition-branch-deletion-process.test.js)：删除标记先阻止目标续读；分区适配器按已发布权威选择原生或迁移日志根，在 journal 发布锁内检查快照所有权描述符，不要求 `CURRENT` 或保留记录正文可解码。其他进程仍持有快照时返回 HTTP 409 `SESSION_MUTATION_BUSY`，操作停留在目录阶段；保留记录缺少所有权锁仍报告损坏。子目录先于父目录处理。目标游标退役后可重试同一删除请求，无关游标仍可续读。[所有权回归](../agent/__tests__/session/partition-snapshot-ownership.test.js)覆盖日志头损坏且保留正文损坏或缺失时的活跃读者保护与进程退出后续跑。
- 读者退役后，[仓储](../agent/src/session/repositories/file-system-session-repository/crud-methods.js)在同一发布锁内将目标目录原子改名至同级暂存位置。暂存名由[工作区删除协议](../workspace-protocol/src/session-tombstone.js)从已记录目标派生，不新增持久进度记录。仓储同步父目录后递归清理，再同步父目录；重试继续清理暂存，不读取其中的权威文件或重建锁。[独立进程测试](../service/__tests__/partition-session-deletion-crash.integration.test.js)验证原子改名后及递归清理中遭 `SIGKILL` 均可用原请求续跑，发现扫描不把暂存目录当作会话。
- 同一测试还验证了物理子目录已改名、子会话树节点尚未移除时的父会话删除：由于父分支包含已标记的子会话，返回 `410 SESSION_DELETED`，不创建父删除记录、不改动子清理状态。子会话原请求续跑完成后，父会话可正常删除，无关会话保留。
- [短期记忆](../agent/src/memory/short-memory/index.js)的捕获、消费确认和清理使用同一文档描述符锁。捕获在锁内用工作区持久删除标记检查会话及其父会话，命中即返回 `SESSION_DELETED`，不另存标记。未发布的 JSON 暂存由下一次持锁变更回收，不作为读取权威。独立进程测试在短期记忆清理持锁、暂存已写但尚未发布时强制终止，验证原请求可直接续跑、暂存回收，且删除完成前后均拒绝目标及其子会话的迟到捕获，无关记忆不变。
- [会话运行日志](../runtime-events/src/session-publication.js)在工作区共享锁内解析会话位置、检查删除标记并完成追加。会话目录移入删除暂存位置时持有同一把锁的独占租约。回归测试在暂停日志位置解析时发布删除标记，验证已接纳的追加先完成，随后退役目录，同一会话的迟到日志无法重建目录。[日志回归](../runtime-events/__tests__/runtime-events.writer-flush.test.js)
- [附件目录写入](../agent/src/artifacts/index-manager.js)使用同一入口：持作用域锁读取权威删除标记。跨会话解析结果关联按固定顺序持有两端的锁，在锁内统一检查删除标记，再核对两端元数据；元数据缺失不创建空目录。目录修复只处理未标记作用域；已标记范围内的残留由原分支删除操作清理，修复不推进其阶段。
- [附件清理中断测试](../service/__tests__/partition-session-deletion-crash.integration.test.js)在目标 SQLite 目录索引已删除、正文尚有残留时强制终止进程。原 HTTP 删除请求重放后清除目标附件目录，不重做已确认阶段。恢复前后，目标会话的上传、生成和邮件附件写入，以及涉及该会话任一端的解析结果关联，均返回 `SESSION_DELETED`；无关会话的附件元数据保持不变。另验证了关联失败不创建空目录、目录修复不接管已标记并尚未清理的损坏目录。以上均非掉电验收。
- 待验收：其他未覆盖的阶段内部中断、掉电恢复、其余写入者的删除检查、锁吞吐与删除标记读取成本，以及删除操作记录的保留与容量边界。进程中断测试不能替代掉电验收。锁协议切换应在工作区停写后统一升级所有写入进程，不支持不同锁实现混跑。

## 3. 空间闭环：已实现与待验收

**已有机制：**[容量协议](../session-protocol/src/partition-journal-capacity.js) 按单 journal 核算 `quotaBytes`、`quotaInodes`、`quotaPartitions`，并计入数据、目录、偏移索引、投影待发布预留、保留记录和维护余量。单次集合查询和分页分别执行集合页预算。批次、事务帧和队列有独立上限。延迟投影超出可预留范围时，先发布已有的待投影片段，再按真实索引写入量核算新事务。需要立即完成的索引和事务共享一次 `CURRENT` 发布。读者保持快照，维护不能把仍可读取的旧版本视作垃圾。冷启动清理未发布文件不等同于回收已提交数据。

**目标闭环，未据代码宣布验收：**由生产维护器选取有界低存活分区，固定发布视图和保留条件，搬迁存活记录，持久化新数据及索引，原子发布，再等引用释放后删除。保留条件覆盖当前状态、读者、分支、备份/迁移、未确认投递和有效回执。存活字节用于排序，不单独决定删除。诊断、待投递、历史回执、临时空间分别有预算；必需消费者超限要背压，可选消费者仅在协议明确支持时重同步。会话、工作区/用户、磁盘应有组合准入和独立应急余量，以保障完成、取消、恢复及整理。现有单 journal 限额和驻留数不证明工作区总容量、持续回收及释放后的写入恢复达标。

**旧格式维护仅用于离线处置。** [维护门面](../agent/src/session/session-artifact-maintenance.js) 定义检查、读者恢复、定位退役、整理、清理及修复入口。定位退役不是物理删除；先核对读者、发布版本和保留证明，再准备并执行清理。不能把手工删段、清锁、跳过隔离或覆盖 `head.json` 当作恢复步骤。旧清理候选捕获仍需目录枚举，捕获阶段的跨进程有界续跑不是现有保证。

## 4. 离线升级协议与权威状态机

升级是对会话事实的转换，不是在线兼容。早期布局由[工作区升级链](../agent/src/workspace-lifecycle/session-storage-upgrade.js)规范化；分区导入只接受可验证的 Immutable 源。旧布局和旧请求的解释只存在于显式升级协议中，不能由仓储按文件缺失临时猜测。

| 状态                       | 权威                 | 约束                                                                                                                                                                     |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 旧源，未开始或暂存未验证   | Immutable 源         | 在线分区服务拒绝该会话。源身份绑定原会话及其提交；读者保留、清理计划、隔离项或缺失身份阻止迁移。不能从布局推断活动归属；旧时间线可能需要现有和轮转后的系统事件作为证据。 |
| 业务已验证，历史回执可续跑 | 仍为 Immutable 源    | `business-verified` 绑定源身份、目标 epoch 和已验证位置。凭据不授权读写，不替代最终对账。无凭据的暂存可重建；凭据不符或目标缺失显式报错。                                |
| 目标已就位，权威尚未发布   | 仍为 Immutable 源    | 目标目录存在不等同于切换；发布前再次验证源和目标，并同步目录项。在权威未发布时不能把目标当作原生分区会话。                                                               |
| `session-authority` 已发布 | `partition-session/` | 发布记录把原源身份和目标位置关联起来。批次按会话生效，不存在整个工作区的原子切换。既有迁移回执可核验，但不是重新完整对账的结果；原生分区会话没有迁移回执。               |

[单会话迁移](../agent/src/workspace-lifecycle/migrate-immutable-session-to-partition.js)持有源权威锁，发布再使用暂存发布锁；单会话锁不证明工作区已停写。[工作区迁移](../agent/src/workspace-lifecycle/migrate-workspace-sessions-to-partition.js)依工作区布局与插件清单发现主会话和受管会话，按协议使用目标容量与分页预算。页和提交批受限不等于整个扫描或报告为常数内存。

**等价性契约：**[暂存对账](../agent/src/workspace-lifecycle/reconcile-immutable-session-staging.js)覆盖生命周期、轮次、消息顺序与绑定、工具配对、检查点、附件、命令和投递。历史回执保留原操作标识、请求证据和结果，而非重新执行原动作。迁移前原请求以 `epoch: null` 进入历史重放；缺来源代数的旧重复检查点回执阻止发布（`SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED`）。回执导入中的中断可以在有效业务凭据和同一源下续跑，不允许把已经发布的前缀计算两次。

**失效边界：**发布后旧副本不能替代已写入的分区事实；恢复承诺取决于可验证的分区备份及后续写入保全。旧文件的物理存留不构成在线兼容；回收另受保留期与引用安全约束。

### 4.1 切换执行入口

服务启动与离线工作区命令共用[布局准备主流程](../agent/src/workspace-lifecycle/sections.js)。服务在 HTTP 和 WebSocket 开放前，使用生效的 `partitionSessionStorage` 配置，在工作区存储独占锁内执行待升级布局步骤。v46 在主会话和受管会话对账完成、权威发布后才提交布局版本；失败不会推进 v46，已发布的单会话回执则保留供重试验证。启动会记录失败并继续准备其他工作区；失败工作区不恢复准入。

v47 将已发布的分区日志从格式 93 升级到 95。在暂存日志内按可见消息重建标题候选目录，移除当前业务元数据里的 `autoTitle`，保留会话身份和已提交日志。暂存数据持久化后才发布新版 `CURRENT`。中断可以使用同一工作区升级计划重试，已切换到 95 的会话会跳过转换。迁移事务与普通事务使用同一个有限的重放窗口。见[分区格式升级](../agent/src/workspace-lifecycle/upgrade-workspace-partition-format.js)。

服务准入读取磁盘上的布局版本和迁移隔离状态，热重建后继续阻止有遗留隔离项的工作区。隔离移动前持久化路径和文件身份，恢复后保留记录直到负责处理器和后续转换成功。隔离扫描把有记录的受管目录作为整体处理，发现没有对应记录的文件时报告具体路径并阻止发布。v46 在枚举会话前校验预算，空工作区也遵循同一配置要求。[隔离恢复](../agent/src/workspace-lifecycle/migration-quarantine.js) · [Bot 重建回归](../service/__tests__/partition-bot-workspace-maintenance.integration.test.js)

手动执行时，先在一致性备份的隔离副本演练。正式执行前停掉指向目标工作区的所有写入进程，并确认备份可恢复。离线命令只接受工作区升级计划，不允许绕过布局版本单独切换会话：

```sh
node agent/scripts/migrate-session-storage.js --upgrade-workspace "$runtime_params" "$plan"
```

入口输出 `layoutMigrations`、`layoutUpgrades` 和 `sessionTreeRecovery`。成功执行 v46 时，`layoutUpgrades` 的对应结果包含 `receipts` 和 `nativePartition`；版本提交后重跑不重新执行 v46，也不重新生成报告。命令不负责停止服务或创建整个工作区的一致性备份。

- `runtime_params` 是有效运行参数文档的绝对路径。服务若未配置参数文件而使用默认值，离线命令仍需显式提供按同一版本默认值生成的文档。
- 工作区计划只含 `workspaceDir`、`pluginRootDir`、`targetStorageBudget`。前两者为绝对路径，插件目录须与部署一致；`targetStorageBudget` 取目标全局配置中实际生效的 `partitionSessionStorage`。迁移分页预算由 Session 协议统一推导，不在工作区计划另设字段。
- 旧插件路径迁移先于版本化步骤；路径冲突、未解决的隔离项或证据缺失须按报错处理，不手动跳版本或删隔离记录。保存首次成功输出，按主会话、内部会话和插件会话清单对账。中断后保持停写，用同一计划续跑；核验既有发布回执不等于重新全量对账。
- 开放流量前检查启动工作区准备结果，并实际验证历史读取和新轮写入；`/health` 成功不代表工作区准备成功。保留旧副本直至验收及保留期结束。新存储接收写入后，不能仅切回旧存储或还原旧备份，否则会丢失切换后的写入。

隔离测试已覆盖[离线 CLI](../agent/__tests__/workspace-immutable-migration-cli.test.js)失败不推进版本、同一计划续跑及成功后重跑不重复升级；[独立进程迁移回归](../agent/__tests__/workspace-isolated-immutable-migration.test.js)覆盖权威发布前后进程终止；[Bot 集成回归](../service/__tests__/partition-bot-migration.integration.test.js)验证主会话、子会话和插件受管会话对账、切换后写入的冷恢复，以及从分区备份还原后继续写入。这些是隔离回归，不替代目标部署副本的离线演练或掉电验收。

## 5. 性能与容量不变量

| 维度     | 架构验收标准                                                                                                                                                     | 证据入口                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 轮内增长 | 固定增量与历史，创建和追加分别验证。正文追加不重写既有正文；读写工作量、同步次数、热内存与延迟边界不能被整轮物化或无界排队破坏。                                 | [仓储 E2E](../agent/__tests__/e2e/session-storage-performance.e2e.js)、[事务增长 E2E](../agent/__tests__/e2e/partition-transactions-performance.e2e.js)   |
| 历史增长 | 固定当前轮，当前轮提交、冷重开读取一页和有界上下文不扫描全历史。首次身份接纳与日常追加分别观测，组件测试不能替代业务仓储。                                       | [目录冷读 E2E](../agent/__tests__/e2e/partition-directory-cold-performance.e2e.js)、[仓储 E2E](../agent/__tests__/e2e/session-storage-performance.e2e.js) |
| 空间     | 分开核算累计写入、有效数据与物理占用、临时空间和 inode；并发读者、慢消费、持续更新和故障下仍受预算控制。配额恢复前不丢已提交事实；一次小样本通过不代表稳定回收。 | [容量协议](../session-protocol/src/partition-journal-capacity.js)、[仓储 E2E](../agent/__tests__/e2e/session-storage-performance.e2e.js)                  |

适配器 I/O、设备写入和端到端延迟是不同指标。本地 10、1,000、10,000 条消息样本中，长轮首屏读取 4,465、7,478、8,382 字节，历史增长场景读取 4,746、8,910、10,799 字节，两组均通过仓储首屏读预算。[首屏测试](../agent/__tests__/e2e/session-storage-performance.e2e.js)

浏览器覆盖另以 [混合会话场景](../client/noobot-chat/tests/e2e/protocol/specs/README.md) 和[门禁定义](../scripts/lib/development-thresholds.mjs)为准；端到端须覆盖普通轮、长轮和停止后继续。不能用仓储基准推断浏览器验收或生产 SLA。
