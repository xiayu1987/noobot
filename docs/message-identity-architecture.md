# 消息身份架构与任务清单

本文件只维护当前规则与任务状态。旧编号、提交记录和历次测试明细已移到[历史档案](message-identity-architecture-history.md)，查历史时再读，不以档案里的待办作为当前任务。

核实日期：2026-11-01（Asia/Shanghai）。代码基线：HEAD `238ff0cd5` 加当前未提交工作树；布局版本 **30**、会话 artifact schema **21**、上下文 snapshot **6**。工作树包含其他主题改动，不能把全部差异归为消息身份任务。

## 1. 现在是什么状态

**基础身份协议、T01–T07、V04 和多项收敛切片已经完成；整体尚未完成。当前没有已确认的剩余开发任务，仍有 6 组待核实事项（V06 已部分收敛），以及 3 组生产验证/操作事项。** 这些是工作分组数量，不代表原始缺陷数量，也不计算完成百分比。

| 状态              | 含义                                                           | 去哪里看        |
| ----------------- | -------------------------------------------------------------- | --------------- |
| 已完成            | 只关闭列明的实现范围，不代表同一旧编号的其他内容完成           | 第 3 节         |
| 未完成            | 已确认的开发任务已关闭；后续核实发现的问题在第 4 节登记        | 第 4 节         |
| 待核实            | 缺少足够的协议、调用链或集成证据，不能先定为缺陷或完成         | 第 5 节 V01–V07 |
| 生产待验证/待授权 | 测试不能替代生产证据；只读核实可继续，部署、停服和删除单独授权 | 第 6 节 O01–O03 |

阅读顺序：继续推进先读第 5 节，核实后的开发问题在第 4 节登记；要部署，读第 6 节。每项状态只在所属章节维护。旧编号仅用于追溯，不再使用“182 整项”“31 切片5h”等编号安排工作。

## 2. 必须遵守的规则

- 每种身份只有一个语义、一个字段名和一个生成入口。身份不能通过别名回退、前缀、字符串拼接或读取时补生成来恢复。
- `messageUid` 是会话消息主键；`modelMessageId`、`presentationMessageId`、`userMessageId` 是不同的关联身份。裸 `messageId` 的历史改名只属于显式迁移。
- 跨模块契约归协议包。实现层消费协议，不另设规则，不复制事实；插件与宿主通过公开协议和能力交互。
- 合法缺省必须由协议说明，例如未加载返回 `null`、部分更新省略 `messages`。损坏输入不能被转成空对象、空数组或成功结果。
- 修复贯通生产者、协议、存储、消费者与测试；同步删除旧入口、兼容分支和无调用方代码，不留旁路。
- 迁移由版本链和启动准备入口负责；请求期不执行升级。不能恢复的身份按既有隔离协议处理，不猜测，也不阻断其他用户和会话。
- 测试通过只证明所跑范围。实现完成、存量合规、生产升级和提交分别判断。提交须授权，并按主题拆分。

字段的唯一规范在代码中：

| 事实                        | 权威入口                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息字段类别、改名/删除来源 | [message-identity-schema.js](../session-protocol/src/identity/message-identity-schema.js)                                                     |
| 消息身份生成与断言          | [message-identity.js](../session-protocol/src/identity/message-identity.js)                                                                   |
| 上下文消息身份              | `context-protocol` 的上下文 codec：会话消息、临时上下文消息、来源投影三种互斥形状                                                             |
| 事件信封与 reducer 输入     | [event-registry.js](../event-protocol/src/event-registry.js) 及各事件 family 协议                                                             |
| 插件选择器和流路由上下文    | [frontend.js](../plugin-protocol/src/frontend.js)                                                                                             |
| 执行目录和父子关系          | [execution-lifecycle.js](../session-protocol/src/execution-lifecycle.js)                                                                      |
| 附件生命周期身份            | [附件身份](../attachment-protocol/src/identity.js)；事件身份与去重见 [attachment-lifecycle.js](../event-protocol/src/attachment-lifecycle.js) |

历史规则细节保留在档案原第 1–3 节。协议实现与旧文字冲突时，先核实协议和调用链，不能按档案另造实现规则。

## 3. 已完成的实现范围

下面按功能合并历史切片。完成的是本表明确列出的范围，相关剩余问题均已另列为 T/V/O 任务。

| 范围                  | 已完成内容                                                                                                                                                             | 代码证据与核实边界                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础消息身份          | 拆分消息主键、模型/展示/用户关联身份；上下文身份方案 A；旧字段显式版本迁移                                                                                             | `session-protocol/src/identity/`、上下文 codec、`session-repair`；完成依据为历史提交与既有回归，本轮没有重新审计所有历史改名点                                                                                                                    |
| 检查点与事件存储      | checkpoint 持有完整 UID 链，receipt 保留引用；事件集合严格读写；schema18→19→20 迁移保留前序 manifest                                                                   | `session-protocol/src/aggregate/session-artifact-events.js`、`event-protocol/src/session-artifact-events.js`、`agent/src/session/session-artifact-session/`；生产验证归 O01                                                                       |
| 权威提交与路由        | outbox 投递事实和请求校验；信封身份单源；监听器只查询实时 runMeta；live/reconnect 共用路由上下文                                                                       | `event-protocol/src/authority-event-outbox.js`、`service/ws/chat-websocket/run-event-listener.js`、`plugin-protocol:requireRuntimeStreamRouteContext`；其他传输条目归 V01                                                                         |
| 消息事件准入          | 规范身份及事件类型精确匹配；可选模型身份不靠类型转换修正；workflow 归属成对校验                                                                                        | `event-protocol/src/message-event.js`；剩余视图读取语义归 V02                                                                                                                                                                                     |
| 时间线与内容合并      | 工具按 canonical key、activity 按 activityId/sequence 合并；拒绝退役 rawEvents；完整文档与部分内容更新有独立协议                                                       | `event-protocol/src/tool-timeline.js`、`activity-timeline.js`、`session-protocol/src/aggregate/session-detail.js`、`client/.../model/sessionDetailMerge.js`                                                                                       |
| workflow 详情与执行树 | 消息顶层身份筛选；选择器明确 null/已加载；删除跨会话拼接及非法数组转空；节点尝试列表和执行目录按协议读取；执行森林拒绝重复/环，修复折叠后代重新出现                    | `plugin-protocol:requireSelectedSessionDocument/requireSelectedExecutionDetail`、`event-protocol:selectWorkflowNodeChildExecutionIds`、`session-protocol:buildExecutionForest`；前端消费位于 `workflowUnifiedSessionDetail.js`、live 控制器和抽屉 |
| 已关闭的旧登记        | 141 回写时间、149 恢复标记、154/164 摘要事务、156 receipt 读取、158 收尾端口、160 参数/UID 过滤、184 快照身份与数值；26-A 输入错误分类；89/95 时间线与真实 upsert 测试 | 保留历史完成结论与测试记录；本轮复读了 backwrite、summary、finalization、route-wrapper 和合并入口，没有逐项重新验证全部生产调用链                                                                                                                 |
| 已确认的合法可选能力  | systemMessageFactory 缺省表示无额外系统消息；block/window 保留实际使用的恢复回调；summary/completion 的无效 policyOptions 链已删除                                     | 历史专项与档案原 5.0.2；不再作为“待删兜底”登记，其他结果/计数规则归 T05、V03                                                                                                                                                                      |
| 生命周期完整契约 T01  | 记录、转移、请求准入、投影、显式迁移及持久化恢复闭环                                                                                                                   | 本节 T01 列出实现、测试和生产验证边界                                                                                                                                                                                                             |

本轮纠正的过期待办：

- `AgentExecutionView.vue` 的 `executionId`、`messages` 必传，事件使用真实执行身份，展示键复用 `resolveMessageViewKey`；原身份回退、消息默认值与展示键待办已由 T03 关闭。
- `chatWebSocketCommandRequests.js` 已显式接收 payload、expectedEvents 和回调；旧 payload 空对象、超时文案回退及 optional callback 描述撤销。它的其余端到端契约不因这次读取而全部关闭，归 V01。
- workflow 详情中的 metadata/pluginMeta 身份别名、跨会话执行拼接、非法 messages/children/descendants 转空已删除；详情请求与展示边界由 T03 关闭。
- `turnTransportEnvelope.js` 当前使用 `readProtocolEventReducerInput`；旧 `reducerInput || payload` 双来源不再作为当前问题。

### T01 生命周期完整契约：已完成

旧编号：84，以及 27/32 中重叠的生命周期条目。

- **已完成**：[记录协议](../session-protocol/src/lifecycle/turn-record.js)统一字段、状态与 intent/failure/terminalStatus 约束；完整性断言覆盖容器、sequence、active 引用、替换记录和回执。[实体](../authoritative-state/src/domain/turn-lifecycle-entity.js)删除读取修正逻辑，校验后复制；[快照](../session-protocol/src/lifecycle/turn-projection.js)只投影声明字段并复制嵌套事实。后续事件读取已存执行归属，冲突拒绝；运行通知不再重复提交执行归属。可重试收尾失败通过未解决查询与快照恢复，前端复用 `isSettledTurn` 保留活动回合。
- **已完成的提交与迁移验证**：已覆盖非法请求字段在时钟/事件分配/物化前拒绝、原回执重放不再物化、物化失败不修改源生命周期。schema20→21 迁移只补协议定义的缺省，拒绝损坏身份、origin 和不可恢复 intent；隔离工作区实测损坏会话字节不变、健康会话继续升级且重跑不改写。生产存量是否符合迁移前提仍归 O01。
- **请求准入已完成**：[turn-request.js](../session-protocol/src/lifecycle/turn-request.js)声明顶层字段闭集，未知字段在事实分配前拒绝。会话门面负责范围绑定，会话服务分离创建、并发和持久化参数；领域请求不再携带 `parentSessionId` 等会话层参数，测试同步走各自公开边界。
- **持久化恢复已实现并通过专项**：[turn-outbox-projection.js](../event-protocol/src/turn-outbox-projection.js)从已保存的生命周期事件回执投影 outbox，保留原事件身份、信封和提交时间，冲突拒绝；合法会话命令回执按协议类型区分，不产生事件。保存后、读取投递队列及覆盖旧 manifest 前共用该投影；直接追加生命周期事件的旧入口已删除。REMOVE 墓碑及 checkpoint 序号下限阻止删除、压缩后复活。这是可恢复的持久化投影，不是跨文件原子事务。
- **真实仓库证据**：[恢复测试](../agent/__tests__/session/turn-lifecycle-outbox-recovery.test.js)覆盖接受与终态的保存失败、保存后投影失败、SIGKILL 后重新创建服务恢复、原回执重放、覆盖回执前保留事件、删除/压缩不复活及投影冲突无源数据修改。恢复与锁专项 **23/23**；明确死亡的锁持有者和等待者可回收，活进程及尚未写完身份的锁仍受保护。日志：[恢复与锁](../workspace/admin/runtime/ops_workdir/t01-recovery-lock.log)。
- **关闭依据与边界**：包含最终新增终态故障测试的全仓复验通过，质量门禁 **48/48**，证据见第 7 节。旧发布版本的全部样本和生产升级仍归 O01/O02，不由隔离测试代替。

### T02 权威事件输入契约：已完成

旧编号：27-C、32 的运行态重叠条目。

- **协议与来源**：[runtime-event.js](../session-protocol/src/runtime-event.js)统一事件类型、身份、时间、序号及 authority 投影。本地调度入口生成 timestamp；权威事件读取 updatedAt，传输事件读取 updatedAtMs；序号、时间副本冲突拒绝，不转换非法值或补当前时间。intent/failure/continuation 复用生命周期记录校验，显式能力对象和快照标记验证形状。
- **主流程收敛**：删除旧 eventNormalization.js 转发入口，消费者直接读取协议；reducer 不从 dialog 路由恢复缺失身份。composer 删除尚未分配完整回合身份的重复开始/结束派发；会话级传输观察不进入 TURN 状态机，发送流程负责本地回合事件。
- **拒绝无副作用**：[快照投影](../client/noobot-chat/src/modules/chat/runtime/run-state-machine/turnLifecycleSnapshotProjection.js)先准备全部回合，再写回合、路由及元数据；后续身份或计时冲突不残留前序修改。快照逐条收集记录及运行态诊断，不因其他记录错误跳过校验。
- **验证范围**：确定性回放、本地生产时间、缺失/冲突身份与数值、同 scope 跨会话隔离、快照身份与计时冲突无副作用均有回归。代理层 **160/160**，前端 store 与输入原子性 **22/22**，跨协议 **51/51**，CLI/监听器/派发 **29/29**；派发超时在修正事件生产夹具后消除。负向测试直接提交损坏输入，不通过合法事件夹具补齐。最终全仓与门禁证据集中在第 7 节；生产历史数据验证仍归 O01/O02。

### T04 宿主执行后代遍历契约：已完成

旧编号：30-插件、31-D、32 中的 execution 选择器部分。

- **协议统一**：[execution-lifecycle.js](../session-protocol/src/execution-lifecycle.js) 的 `selectExecutionRelations` 校验目录键与 executionId 一致，复用 `buildExecutionForest` 的身份、重复及环规则；直接子项与全部后代使用同一入口。后代按广度优先、同层目录顺序返回原记录引用，保留各记录的会话归属，不修改输入。
- **事实单源**：删除 registry 的 `childExecutionIdsByParentId` 及全部写入、清理和读取入口；父子关系只读取执行记录的 `parentExecutionId`。宿主不再清洗查询身份、过滤缺失子记录或用 visited 跳过损坏关系，插件继续通过公开宿主能力获取结果。
- **合法空态与拒绝边界**：规范身份但根执行未加载时返回 `[]`，叶节点也返回 `[]`；目录外父节点是合法加载边界，不生成占位根。空白/缺失查询身份、目录键冲突、非法记录及独立环显式拒绝，即使查询根不存在也不掩盖已加载目录损坏。
- **写入闭环**：[执行投影](../client/noobot-chat/src/modules/chat/runtime/run-state-machine/executionRuntimeProjection.js)提交前校验关系；children/tree 批量准备成功后才写回，环拒绝不保留前序写入。[生命周期入口](../client/noobot-chat/src/modules/chat/runtime/run-state-machine/authoritativeTurnRuntime.js)先准备执行投影，关系拒绝发生在回合、路由和元数据修改之前。
- **验证边界**：协议专项 **19/19**，前端专项 **27/27**；覆盖父节点迁移、跨会话后代、顺序和引用保持、损坏目录、单条/批量/生命周期关系拒绝无残留，以及重连树与快照恢复。最终全仓与质量证据见第 7 节。

### T03 workflow 详情请求与展示边界：已完成

旧编号：26-D、30-插件、31-D、102/106 中的 workflow 详情部分。

- **请求协议**：[workflow-session-detail.js](../event-protocol/src/workflow-session-detail.js)统一详情、思考详情和执行报告的请求字段闭集；身份校验后原样传递，未知字段拒绝。思考查询复用回合查询协议，缺失/非法身份按协议返回 400；路由删除重复查询校验。插件与宿主继续通过公开协议和能力交互。
- **响应事实单源**：REST 详情只提供 `snapshotEnvelope` 与 `executionLogs`；会话内容读取快照 payload，版本读取 ordering，删除并行 `sessionSummary`、`aggregateVersion` 和 meta 副本。前端核对 authority、节点会话与 dialog 归属，冲突快照不物化；诊断也读取同一快照。
- **展示边界**：[详情投影](../plugin/noobot-plugin-workflow/frontend/runtime/workflowUnifiedSessionDetail.js)区分未分配、未加载和已加载空消息；占位展示键由会话与回合身份构成，跨会话消息拒绝。`AgentExecutionView` 只接收真实执行 ID；已加载但无执行 ID 的内容由抽屉通过公开 `ChatMessageItem` 展示，思考详情事件原样转发，不以会话 ID 代替执行 ID。
- **错误闭环**：请求准备失败使事务失效并展示失败，不发送非法请求；[实时投影控制器](../plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/live-projection-controller.js)将构建与应用异常接入同一失败事务。失败后禁止继续合并，用户显式重新打开才恢复；节点切换与过期响应仍按事务归属隔离。
- **验证范围**：Node 专项 **44/44**、前端专项 **59/59**，覆盖请求闭集与身份拒绝、唯一快照、空态、无执行 ID 展示、冲突不物化、实时失败与重新打开；最终全仓和质量门禁通过，证据见第 7 节。生产存量和升级仍归 O01/O02。

### T05 agent 结果、插件 hook 与持久化消息契约：已完成

旧编号：173/175/177、31 的结果与持久化部分。

- **统一结果协议**：[agent-turn-result.js](../agent-transport-protocol/src/agent-turn-result.js)复用消息身份协议校验 `messageUid`，拒绝非法容器、成员、重复 UID 和稀疏数组；显式空消息数组合法，不补对象或身份。
- **删除插件修补**：workflow 删除 `ensureTurnMessages`，直接校验结果后物化消息；harness 在状态及产物操作前校验，删除非法数组转空、成员补空对象和结果顶层附加消息附件的旁路。附件只附加到实际 assistant 消息，没有 assistant 时由既有调用者处理交付。
- **hook 接纳闭环**：[agent-dispatch.js](../agent/src/bot/execution/runner/agent-dispatch.js)在结果 hook 前校验，hook 完成后再次校验并接纳到 canonical store；[hook 协议](../hook-protocol/src/points.js)将 `AFTER_AGENT_DISPATCH` 声明为失败阻断流程。非法修改或 hook 抛错进入失败生命周期，不进入最终提交。
- **持久化边界**：[finalizer.js](../agent/src/bot/execution/finalizer.js)消费同一完整结果协议，删除实现层非空数组限制；合法空消息可以完成，非法输入在时钟、生命周期和写入副作用前拒绝。
- **验证范围与边界**：契约专项 **18/18**，覆盖非法输入不变且无写入、合法空消息、hook 合法新增消息、非法修改及抛错阻断提交；全仓与质量证据见第 7 节。附件既有回归随全仓通过，未逐项重审所有交付形态；ledger/counters 等状态审计仍归 V03，生产验证仍归 O01/O02。

### T06 统一运行语言的权威来源：已完成

旧编号：31 的 locale 与 semantic-resolution 条目。

- **权威契约**：[配置协议](../agent-config-protocol/src/contract/run-config.js)的 `requireRunLocale` 复用语言枚举，只接受已解析运行配置中的规范语言。聊天服务入口规范化请求语言，bot hook 公开传递 `runConfig`；workflow 只读取 `ctx.runConfig.locale`，缺失或非法值明确拒绝，不从上下文别名或宿主内部配置恢复。
- **删除重复来源**：[workflow i18n](../plugin/noobot-plugin-workflow/src/core/i18n.js)删除多级候选链并复用协议语言枚举；插件选项删除独立 `locale` 和旧缺省常量，不再在初始化时按插件语言固化默认语义提示词。工具规划、附件及节点文案、语义模型调用与解析诊断统一消费运行语言。
- **缺省职责**：未配置语义提示词时，[语义入口](../plugin/noobot-plugin-workflow/src/core/orchestrator/semantic-resolution.js)按运行语言选择默认提示词；显式自定义提示词保持原文。静态文案查询和公开独立 DSL 解析保留各自入口的合法缺省，不作为运行语言来源。子会话由宿主既有主流程继承父运行配置，workflow 不另维护语言副本。
- **验证范围**：[语言契约回归](../plugin/noobot-plugin-workflow/__tests__/orchestrator/workflow-run-locale.test.js) **12/12**，覆盖中英文、冲突候选、缺失/非法语言在模型调用前拒绝且输入不变、自定义提示词和解析诊断；真实子会话 runner 回归增加父语言继承断言。相关工作区 **86 + 143 = 229 项通过**，最终全仓及质量门禁 **48/48** 通过，日志见第 7 节。未调整质量基线或新增豁免；生产存量和升级仍归 O01/O02。

### T07 附件生命周期事件身份契约：已完成

旧编号：任务 C、32 中的附件身份部分。

- **身份单源**：权威提交唯一生成信封 `identity.eventId`；[附件生产者](../agent/src/tools/core/parsed-artifact-persistence.js)只构建 v2 payload，删除 `attachmentEventId` 及独立生成器。附件身份仍描述附件本身，不充当事件身份；旧 payload 字段在当前协议中明确拒绝。
- **统一消费**：[事件协议 reducer](../event-protocol/src/attachment-lifecycle.js)消费完整信封，live 与 reconnect 使用同一入口；按信封 ID 去重，一致重投返回原状态，同 ID 不同事实明确拒绝。删除附件协议中旧 payload reducer 及其导出，不保留双输入入口。
- **版本化迁移**：[迁移协议](../event-protocol/src/attachment-lifecycle-migration.js)接入布局 v30 启动升级，旧 v1 payload 显式转为 v2，保留既有信封身份、排序及投递记录；重复旧 ID 对应多个信封、记录身份冲突及损坏数据拒绝，不猜测身份。复用既有暂存、备份和逐会话隔离流程，健康会话继续升级。
- **验证范围与边界**：事件协议 **157/157**、工作区协议 **30/30**；真实隔离迁移与监听专项 **3/3**、前端专项 **6/6**，覆盖重投去重、冲突拒绝、投递记录保持、损坏会话字节不变、备份与重跑幂等。最后冲突检查抽取及重复导入清理后的全仓与质量门禁均通过，见第 7 节。未调整基线或新增豁免；生产存量合规及升级仍归 O01/O02。

### V04 运行中删除会话的完整集成：已完成

旧编号：163。

- **墓碑统一**：[会话仓库](../agent/src/session/repositories/file-system-session-repository/crud-methods.js)的 `requireById` 是必存在读取的唯一入口，墓碑会话统一抛出 `session_deleted`；[回合状态服务](../agent/src/session/services/session-message-service/turn-state.js)的生命周期非创建分支与计时写入均改用该入口，删除 `saved===false` 僵尸分支、重复意图校验和默认参数，删除后的写入不再重建会话。
- **集成覆盖**：新增 4 条隔离工作区集成用例，覆盖运行中删除后的生命周期提交、最终持久化、消息持久化与计时写入之间的删除，以及已调度记忆后处理报告 `SESSION_DELETED`；均断言无残留、不重建会话。detached 测试替身已补齐必存在读取契约。
- **边界**：验证基于隔离工作区，不代替生产存量；最终全仓与质量结果见第 7 节。

## 4. 未完成：已确认存在的代码问题

当前无已确认的剩余开发任务；T01–T07 的列明范围均已关闭。第 5 节核实出具体问题后，在本节登记协议依据、动作与验收条件。存在 `text()`、默认参数或 catch 本身不等于缺陷，禁止机械删除合法 UI 状态或诊断能力。

## 5. 待核实：证据不足，先补证再改

这些条目仍是开放任务；“待核实”不等于已完成，也不等于代码一定有缺陷。核实后应删除过期登记，或把确认的问题移入第 4 节；不能在两处同时维护状态。

| ID / 旧编号                                  | 核实范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 完成核实的条件                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| V01 / 26、27、31、32、182 的其他旧定位       | 协议/传输/代理/工作流的剩余登记，包括 ctx 身份补位、planning revision、caller 白名单、cleanup planning.json、上游 handler、socket/频道状态、replay 回执、诊断私有字段及工具风险/系统 prompt。完整原定位见档案原 5.3 的 26/27/31/32/182 和原第 7 节尾项；已明确拆出的 T01–T07 不重复处理                                                                                                                                                                                                                                             | 对每个旧定位给出当前符号、生产调用者和协议依据；判断已删除、合法缺省或实际缺陷。不能把旧行号和“约 13 处”直接当当前事实 |
| V02 / 186                                    | `event-protocol/src/message-event.js` 的 projectMessageEventMetadata / projectAuthoritativeFinalMessage 等视图入口仍有 text/Array.isArray；准入已收严，需确认下游是否重复校验或另有输入语义                                                                                                                                                                                                                                                                                                                                         | 列明每个导出的生产调用链与入口校验；未匹配事件返回空投影等合法探测语义有协议和测试依据                                 |
| V03 / 173/175/177                            | harness/workflow 的 ledger、counters、恢复状态与结果规则，除 T05 外仍未闭环。已搜索到 bucket-migration、pending-cleanup、guidance controller 等多处补字段/数值转换，需区分显式迁移和当前运行读取                                                                                                                                                                                                                                                                                                                                    | 明确每项状态的创建者、版本与唯一写者；迁移和运行时职责分开；确认的问题形成具体修复任务                                 |
| V05 / 49                                     | sessions.json、历史空 identity.messageId 与“前缀只约束新值”的旧登记；历史提到 8 条空身份，不是当前复核数量                                                                                                                                                                                                                                                                                                                                                                                                                          | 只读重新取证，区分当前 schema、历史迁移输入与冻结日志；给出样本范围、版本和处置依据，不因未命中搜索关闭                |
| V06 / 方案一后续、102/106 的非 workflow 部分 | 已收敛：终态解析由 coordinator `settleResponse` 唯一校验，删除前端重复校验、可重试包装、补值与重放缓存；协议 `validateTurnTerminalResolution` 删除默认参数与 turn 兜底。仍待核实：`createTurnTerminalResolution` 工厂默认值及 `clean()` 与校验器契约是否一致；计时一个写入源、两条读取通道（`createAuthoritativeTurnSnapshot`/`resolveAuthoritativeTurnTerminal`）待协议裁定；selector 中 `modelLoopRound ?? 0` 是否混淆未加载与 0；sessionLifecycleHydration、applyExecutionDetail/applyRestSnapshot、thinking-detail-content 路径 | 从权威执行/会话文档追踪到计时和详情消费者，证明身份/时间唯一来源；错误与合法未加载有分别测试                           |
| V07 / 测试侧与零散旧尾项                     | 已登记的 Object.assign 工厂旁路有部分修复；其余 harness 夹具、canonicalMessages 重复、时间戳夹具及浏览器 errorHandler 实测仍缺完整复核                                                                                                                                                                                                                                                                                                                                                                                              | 区分生产风险、测试旁路和纯重构；实际生产故障形成任务，僵尸测试/重复夹具清理后运行相关回归                              |

V01 是旧登记审计任务，不是“已确认仍存在的一大包缺陷”。档案保留全部旧定位用于逐项销账，避免整理时丢项；后续继续审计应缩小这个分组，不能再追加无验收条件的长列表。

## 6. 生产验证与需要授权的操作

| ID                    | 当前状态与剩余动作                                                                                                                        | 验收 / 授权边界                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O01 存量合规与升级    | 代码为布局30/schema21/snapshot6；旧记录只读核实 admin/xiayu 布局25、6份缺事件集合文档。本轮未重新核查生产数据，不能当作当前数量或当前版本 | 先只读按协议检查 backwrites、checkpoint、journal、事件集合及生命周期迁移前提并输出报告；生产升级/重启单独授权。布局号不能替代内容校验                                  |
| O02 停服副本演练      | v6 transfer 的逐文件备份/写入/回滚不是跨文件事务；历史尚无完整停服副本演练证据                                                            | 保留同一时点完整备份，在隔离副本通过启动准备入口升级，检查 failed/quarantined、哈希链、manifest 和后续写入；中断恢复整个备份，不手改布局。停止生产写者及正式部署须授权 |
| O03 孤儿 summary 缓存 | rebuilt summary 已从会话事实重建，旧迁移改写入口已删除；历史登记20份孤儿缓存，未重新审计数量和来源                                        | 先只读确认无读取依赖及可重建性，给出准确删除清单；删除生产文件须授权                                                                                                   |

历史 v9 迁移函数不是读取期兼容旁路：最低支持版本未提高前，不能因名字含 legacy 或旧字段就删除整档升级链。退役须按版本支持范围和调用证据处理。提交也须单独授权；不得把其他主题工作树差异混入本主题。

## 7. 核实与验证记录

**T01–T07、V04 已完成实现与验证，V06 已收敛部分同批验证；未执行生产升级或其他生产操作。** 实现范围见第 3 节对应条目，生产边界仍归 O01/O02。

- V04/V06 最终版本：session-protocol **302/302**，日志：[协议专项](../workspace/admin/runtime/ops_workdir/v06-protocol.log)；全仓 `PASSED exit=0`，日志：[执行结果](../workspace/admin/runtime/ops_workdir/v06-all.log)、[完整运行](../test-results/test-runs/npm-2026-11-01T09-38-57-150Z.log)。agent 工作区有 1 项既有条件跳过（`attachment-source-path-and-stream.test.js` 声明 `skip: getuid()===0`，当前以 root 运行），不在本轮差异中，不计为通过。质量门禁 **48/48**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/v06-quality.log)；按实测收紧基线 complexityCount **141→140**、deepNestingCount **299→298**、fallbackChain **278→272**，未新增豁免。早于 V06 改动的 V04 中间日志不作为最终结论。

- T07 迁移与监听专项 **3/3**，日志：[隔离迁移及监听](../workspace/admin/runtime/ops_workdir/t07-agent-contract.log)；前端专项 **6/6**，日志：[live/reconnect 去重](../workspace/admin/runtime/ops_workdir/t07-client.log)。最终修复后的全仓退出码 **0**，日志：[完整运行](../test-results/test-runs/npm-2026-11-01T06-54-14-685Z.log)、[执行结果](../workspace/admin/runtime/ops_workdir/t07-final-all.log)；质量门禁 **48/48**，退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t07-final-quality.log)。通过抽取冲突检查降低嵌套并合并重复导入修复门禁，未调整基线或新增豁免；隔离测试不代替生产存量抽样。

- T06 相关工作区 **229 项通过**，日志：[配置与 workflow 回归](../workspace/admin/runtime/ops_workdir/t06-related.log)。包含最终语言枚举复用与无用导出清理的全仓退出码 **0**，日志：[完整运行](../test-results/test-runs/npm-2026-11-01T06-35-17-732Z.log)、[执行结果](../workspace/admin/runtime/ops_workdir/t06-final-all.log)。质量门禁复验 **48/48**，退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t06-final-quality.log)。未调整基线或新增豁免。

- T05 契约专项 **18/18**，失败、取消、跳过均为 0，日志：[结果、hook 与持久化](../workspace/admin/runtime/ops_workdir/t05-contract.log)。包含新增回归的全仓退出码 **0**，日志：[完整运行](../test-results/test-runs/npm-2026-11-01T06-15-13-352Z.log)、[执行结果](../workspace/admin/runtime/ops_workdir/t05-all.log)。质量门禁复验 **48/48**，退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t05-final-quality.log)；rawTypeof 基线按实测 **453→452** 收紧，未新增豁免。

- T03 最终全仓退出码 **0**，日志：[完整运行](../test-results/test-runs/npm-2026-11-01T06-01-20-471Z.log)、[执行结果](../workspace/admin/runtime/ops_workdir/t03-final-all.log)。Node 专项 **44/44**，日志：[协议与路由](../workspace/admin/runtime/ops_workdir/t03-node.log)；前端 6 文件 **59/59**，日志：[详情与展示](../workspace/admin/runtime/ops_workdir/t03-client.log)。质量门禁 **48/48**，日志：[质量检查](../workspace/admin/runtime/ops_workdir/t03-quality.log)。删除无用参数与重复规则，rawTypeof 基线按实测 **454→453** 收紧，未新增豁免。

- T04 最终全仓退出码 **0**，日志：[执行结果](../workspace/admin/runtime/ops_workdir/t04-final-all.log)（完整日志 `npm-2026-11-01T05-19-46-022Z.log` 当前已不在仓库，保留执行结果中的原路径记录），其中 session-protocol **296/296**、前端 **1577/1577**，包含生命周期关系拒绝无残留回归。前端专项 **27/27**，日志：[专项结果](../workspace/admin/runtime/ops_workdir/t04-client-final.log)。质量门禁 **48/48**、退出码 **0**，日志：[质量检查](../workspace/admin/runtime/ops_workdir/t04-final-quality.log)。删除旧子索引的生产及测试引用，未调整质量基线或新增豁免。

- T02 最终全仓退出码 **0**，日志：[执行结果](../workspace/admin/runtime/ops_workdir/t02-closure-all.log)（完整日志 `npm-2026-11-01T05-04-55-607Z.log` 当前已不在仓库，保留执行结果中的原路径记录）。其中 session-protocol **294/294**、前端 **1574/1574**，包含新增逐记录诊断与拒绝无副作用测试。专项：[跨协议 51 项](../workspace/admin/runtime/ops_workdir/t02-cross-contract.log)、[CLI/监听器/派发 29 项](../workspace/admin/runtime/ops_workdir/t02-service-contract.log)、[代理层 160 项](../workspace/admin/runtime/ops_workdir/t02-proxy-recheck.log)、[前端 22 项](../workspace/admin/runtime/ops_workdir/t02-store-recheck.log)。兜底链基线按实测 **292→280** 收紧，未放宽复杂度或新增豁免。文档状态统一后质量门禁再次 **48/48**、退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t02-closure-quality.log)；文档格式与 `git diff --check` 通过。

- T01 最终全仓测试通过，退出码 **0**，包含接受与终态的保存失败、投影失败及进程中断恢复测试；日志：[执行结果](../workspace/admin/runtime/ops_workdir/t01-closure-all.log)。历史完整日志 `npm-2026-11-01T04-15-23-420Z.log` 当前已不在仓库，保留执行结果中的原路径记录。最新质量门禁 **48/48**，退出码 **0**，日志：[完整质量检查](../workspace/admin/runtime/ops_workdir/t01-verified-quality.log)。恢复与锁专项 **23/23**，无失败、取消或跳过。结果已实际读回，不沿用早于最终测试版本的全仓结论。
- 迁移依据包括原实体对缺省字段的读取规则，以及旧转移器保留非可重试失败 intent 的路径；有内容的退役 intent payload 不猜测迁移，直接隔离。当前 schema 不再补历史字段。测试覆盖的是构造的旧 schema 与隔离工作区，不是全部已发布版本或生产存量抽样。

- 本轮重新运行 `npm test -w session-protocol -w event-protocol -w plugin-protocol`：**251 + 145 + 28 = 424 项通过，失败0、跳过0**。日志：[协议复核](../workspace/admin/runtime/ops_workdir/message-identity-checklist-protocol-tests.log)。这是协议包回归，不是本轮全仓复验。
- 文档重组后重新运行统一质量门禁：**48/48 通过**，日志：[清单整理质量检查](../workspace/admin/runtime/ops_workdir/message-identity-checklist-quality.log)。两份文档的格式、本地链接、任务 ID 唯一性、历史章节保留及 `git diff --check` 均通过。
- 已实际读回历史全仓日志 `test-results/test-runs/npm-2026-11-01T01-45-11-766Z.log` 的 `PASSED exit=0`，及 `message-identity-forest-quality-verified.log` 的 **48/48**。它们属于执行森林阶段，不记成本轮新执行结果。
- 历史专项、提交、版本迁移样本和生产只读结果全部保留在[历史档案](message-identity-architecture-history.md)。档案状态不覆盖本文。

## 8. 下一步顺序

1. V01–V03、V05–V07 持续销账；优先 V06 剩余项（工厂默认值契约、计时读取通道裁定、`modelLoopRound` 未加载语义、hydration/REST 快照/thinking-detail 路径）。每完成一个范围就更新所属条目，不再追加切片日记。
2. 核实确认的新代码问题进入第 4 节，先明确协议与生产调用链，再完成实现及验证。
3. O01–O03 留到部署准备与授权阶段；代码测试通过不能把它们自动关闭。
