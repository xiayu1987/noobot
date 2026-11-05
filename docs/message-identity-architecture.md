# 消息身份架构与任务清单

本文件只维护当前规则与任务状态。旧编号、提交记录和历次测试明细已移到[历史档案](message-identity-architecture-history.md)，查历史时再读，不以档案里的待办作为当前任务。

核实日期：2026-11-03（Asia/Shanghai）。代码基线：HEAD `49c3e3fe2` 加本轮未提交改动；布局版本 **30**、会话 artifact schema **21**、上下文 snapshot **6**。开始核实时工作树干净；历史验证保留原日期与范围，不作为本轮重新执行的结果。

验证期间工作树出现其他任务的并发修改（artifacts、配置与会话 invariant 等）；本轮消息身份改动仅涉及升级主流程、启动升级回归和两份本文档，其他差异不归入本任务。

## 1. 现在是什么状态

**基础身份协议、T01–T10、V01–V04、V06–V07 已完成列明范围；整体尚未完成。** 副本演练修复了升级前 outbox 准入顺序问题（T08）、非法 activity fact 的错误码缺失（T09）及批次发送抛错时成功前序事件未获确认（T10）。V05 已核实缓存与前缀规则，并迁移验证八条历史候选；候选与旧登记的对应关系仍待确认。O01–O03 的生产验证/操作仍未完成。这些是工作分组，不计算完成百分比。

| 状态              | 含义                                                           | 去哪里看        |
| ----------------- | -------------------------------------------------------------- | --------------- |
| 已完成            | 只关闭列明的实现范围，不代表同一旧编号的其他内容完成           | 第 3 节         |
| 未完成            | 已确认的开发任务已关闭；后续核实发现的问题在第 4 节登记        | 第 4 节         |
| 待核实            | 缺少足够的协议、调用链或集成证据，不能先定为缺陷或完成         | 第 5 节 V05     |
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

### T08 升级前 outbox 准入顺序：已完成

- **实证缺陷**：布局 v29、schema21 的七份 xiayu 会话在隔离副本升级时整体失败；`writeSessionArtifact` 先通过 `readPreviousTurnManifest` 恢复生命周期 outbox，早于迁移准入触发缺失 `consumerId` 的未分类异常。原有 schema12 回归没有覆盖该路径。
- **根因修复**：[升级主流程](../agent/src/workspace-lifecycle/session-message-identity-upgrade.js)先迁移并校验暂存 outbox，再写入会话；继续使用公开协议断言和既有逐会话隔离，不猜测消费者身份、不新增兼容或恢复旁路。隔离 details 保留协议拒绝原因，避免序列化丢失 `cause` 后只剩泛化错误。
- **验证**：[启动升级回归](../agent/__tests__/workspace-attachment-lifecycle-upgrade.test.js)覆盖当前 schema 的坏会话先于写入恢复被隔离、健康附件事件升级及投递次数保持、布局推进、坏会话字节不变和重复准备幂等；与旧身份迁移、生命周期恢复专项合计 **21/21**。真实存量的限定副本演练从整体失败变为七份隔离、布局30，源 **197** 个文件及副本会话文件不变；只改副本布局标记。副本没有需要重写的健康会话，健康会话实际重写由专项覆盖。证据见第 7 节；生产存量未改写。

### T09 非法 activity fact 的不可用状态闭环：已完成

- **实证根因**：隔离副本捕获 `SESSIONS_SUMMARY_PROJECTION_FAILED` 的 `cause` 和 `errors`，两者均为事件协议抛出的无错误码 `TypeError: activity timeline contains a noncanonical fact`。摘要协议只接受带明确错误码的不可用原因，原始拒绝因此再次导致不可用摘要投影失败；不是另一次存储写入失败。
- **协议修复**：[activity 协议](../event-protocol/src/activity-timeline.js)统一声明 `ACTIVITY_TIMELINE_ERROR_CODE.FACT_INVALID`，非法事实仍严格拒绝，但携带 `ACTIVITY_TIMELINE_FACT_INVALID`。列表、维护、详情沿用既有协议处理，不新增默认原因、身份推断或实现层兼容分支。
- **验证**：协议与摘要闭环专项 **13/13**，事件协议全量及相关摘要/迁移回归 **225/225**；覆盖输入不变、重复维护、列表/详情明确不可用及健康会话可读。真实存量副本复验保留具体错误原因，异常会话20个文件及全部197个源文件不变。生产缺失身份仍未处置；证据见第7节及[存量核查](message-identity-stock-audit.md)。

### T10 批次发送异常后的确认闭环：已完成

- **实证根因**：[服务派发主流程](../service/ws/chat-websocket/authority-event-dispatcher.js)只在整批发送返回后确认成功项；后序发送抛错会丢失本批已成功发送的前序事件确认，导致下次重复发送。新增回归在修复前明确失败。
- **修复**：发送阶段保留已成功项及发送错误，由同一派发流程完成持久化确认，再传播原发送错误。发送与确认同时失败时保留两项错误；未成功事件仍待投递。未增加消费者身份推断、替代队列或兼容入口，不增加逐事件确认 I/O。
- **验证**：最终专项 **37/37**、质量门禁 **49/49**，最终全仓 `npm test` 通过；此前服务测试 **353/353**。三独立进程的真实会话存储、正式派发器、出站发送器及 TCP WebSocket 收发验证通过；确认失败重投、消费者隔离及范围限制见[本轮证据](message-identity-stock-audit.md#2026-11-04-消费者投递根因修复与真实-websocket-验证)。这不关闭生产完整备份恢复或原部署回滚。

### V04 运行中删除会话的完整集成：已完成

旧编号：163。

- **墓碑统一**：[会话仓库](../agent/src/session/repositories/file-system-session-repository/crud-methods.js)的 `requireById` 是必存在读取的唯一入口，墓碑会话统一抛出 `session_deleted`；[回合状态服务](../agent/src/session/services/session-message-service/turn-state.js)的生命周期非创建分支与计时写入均改用该入口，删除 `saved===false` 僵尸分支、重复意图校验和默认参数，删除后的写入不再重建会话。
- **集成覆盖**：新增 4 条隔离工作区集成用例，覆盖运行中删除后的生命周期提交、最终持久化、消息持久化与计时写入之间的删除，以及已调度记忆后处理报告 `SESSION_DELETED`；均断言无残留、不重建会话。detached 测试替身已补齐必存在读取契约。
- **边界**：验证基于隔离工作区，不代替生产存量；最终全仓与质量结果见第 7 节。

### V06 子会话计时与详情来源：已完成

- **终态工厂契约**：[turn-terminal-resolution.js](../session-protocol/src/lifecycle/turn-terminal-resolution.js) 的 `createTurnTerminalResolution` 立即运行完整 `validateTurnTerminalResolution`；缺失身份、缺失 `generatedAt`、非法标志、空未决原因及 resolved 响应缺少合法 turn 均拒绝。`generatedAt` 由调用方以 Authority 时钟（service `this.now()`）显式传入，工厂不读取本地时钟。`turn-terminal-resolution-input.test.js` 覆盖合法结果可被同一校验器接受，以及非法输入不被清洗或改写。
- **计时事实来源**：[authority-query-service.js](../authoritative-state/src/application/authority-query-service.js) 的权威快照和终态解析都通过 `projectTurnTiming` 合并 lifecycle 与 `turnTimings`，没有第二套计时计算。`admitWorkflowSessionSnapshot` 的 aggregateVersion、lifecycle sequence 与 timing 各守其版本域；事件协议和前端专项验证旧 aggregate 仍可推进更新的 lifecycle/timing，生命周期陈旧则阻止后续 timing，计时冲突抛错且更正后可重放。不得将这些域强行合并为一个版本闸门。
- **未加载语义**：[turnRuntimeSelectors.js](../client/noobot-chat/src/modules/chat/runtime/run-state-machine/turnRuntimeSelectors.js) 在无回合时返回 `modelLoopRound: null`，已加载回合读取 `turn.timing?.modelLoopRound ?? null`，不把未加载伪装成 0。
- **详情消费链**：主详情只从经过 `requireSessionDetailDocument` 校验的 `mainEntry` 读取 lifecycle、timing 和 messages；[sessionLifecycleHydration.js](../client/noobot-chat/src/modules/chat/runtime/session/sessionLifecycleHydration.js) 只应用会话权威 snapshot；workflow execution detail 通过 `requireSelectedExecutionDetail` 读取所选 session；REST snapshot 通过统一 workflow runtime event 合并；子会话 snapshot 经 `admitWorkflowSessionSnapshot` 准入；thinking-detail timeline 由已准入消息及 activity 投影。没有证据支持额外并行的计时事实源。
- **边界**：以上关闭代码契约与所读调用链，不代表生产历史快照已合规；隔离迁移和生产存量仍归 O01/O02。

### V01–V03、V07 历史定位与协议边界审计：已完成

- **V01**：workflow 请求、插件端口、节点归属、附件 transfer、语义结果、消息路由、频道恢复和错误闭环已逐项登记当前入口与协议。删除语义输出回落原始输入和旧 traces 旁路；交互超时提交失败保留提交错误与超时错误，不再伪称网络已投递。
- **V02**：登记消息投影及视图键的生产消费者与准入链；空投影、可选元数据和集合复制按各自协议保留，不另建修补规则。
- **V03**：harness bucket **v14** 统一当前状态断言与显式迁移，登记 counters 推进、完成和重置职责；删除无消费者的 summaryRounds。canonical ledger 先验证候选集合，再提交更新。
- **V07**：负向夹具保留显式损坏输入，共享合法消息夹具；会话消息双向投影复用公开身份断言，删除身份裁剪与会话角色大小写转换。隔离浏览器核实错误通知，不扩大为生产 E2E。
- **证据与边界**：逐项符号、调用链和裁定见[核实记录](message-identity-verification-audit.md)，最终代码验证见第 7 节；历史八条原始样本及生产存量不在这些关闭范围内。

## 4. 未完成：已确认存在的代码问题

当前无已确认但未修复的开发任务；T01–T10 的列明范围均已关闭。已确认问题的修复和验证见第 3 节。第 5 节核实出新问题后，在本节登记协议依据、动作与验收条件。存在 `text()`、默认参数或 catch 本身不等于缺陷，禁止机械删除合法 UI 状态或诊断能力。

## 5. 待核实：证据不足，先补证再改

这些条目仍是开放任务；“待核实”不等于已完成，也不等于代码一定有缺陷。核实后应删除过期登记，或把确认的问题移入第 4 节；不能在两处同时维护状态。

| ID / 旧编号 | 核实范围                                                                           | 完成核实的条件                                                             |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| V05 / 49    | 历史八条空身份的来源对应关系；已找到一份恰含八条事件的可追溯备份候选，并验证其迁移 | 取得旧登记的原始扫描范围或来源记录，确认是否就是候选；不能仅凭数量相同关闭 |

V05 已核实部分：`sessions.json` 的路径由工作区协议声明，`sessions-summary` 协议约束结构；仓库从会话事实重建，并对不可读取会话投影 unavailable，不是消息身份权威源。身份工厂使用 schema 前缀，`assertMessageIdentity` 只约束非空且无首尾空白的字符串，存量不按前缀重写。备份候选的协议为 event v3 / workflow.runtime schema1，八条均为节点状态事件；公开迁移删除退役 `identity.messageId`，不生成消息主键，迁移后信封与 outbox 校验及幂等均通过。具体路径、SHA-256、行号和边界见[本轮核查](message-identity-stock-audit.md)。其他 V 项的销账依据见第 3 节及核实记录。

## 6. 生产验证与需要授权的操作

| ID                    | 当前状态与剩余动作                                                                                                                                                                                                         | 验收 / 授权边界                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O01 存量合规与升级    | 限定重扫62份会话，消息身份通过；七份 xiayu outbox 缺 `consumerId`。另有一份 schema21 会话缺 `activityId`，早期备份已缺，历史写者未确认。隔离回归通过，但既有隔离仅登记原因、不搬移或停用会话；存量未处置，扫描不是原子快照 | 部署准备时按实际安装插件范围检查 backwrites、checkpoint、journal、事件集合及生命周期迁移前提；生产升级/重启单独授权。布局号不能替代内容校验                           |
| O02 停服副本演练      | 本轮完成 xiayu 三个会话根及布局标记的限定副本演练：197个源文件复制前后哈希稳定且未修改；修复后七份隔离、布局29→30、重跑幂等。未取得停服全工作区备份，也未演练完整恢复和后续写入                                            | v6 transfer 逐文件回滚不是跨文件事务。仍需同一时点完整备份、全部准备流程与后续写入验证、中断后整份恢复；停止生产写者及正式部署须授权                                  |
| O03 孤儿 summary 缓存 | 只读调用链核实与逐文件清单准备完成：63份中22份作用域缓存为当前仓库范围的清理候选；其会话均未注册会话树，副本删除前后生产作用域快照一致，172个源文件未变。历史写者/旧20份对应关系未证明；生产清理未授权、未执行             | 准确路径和哈希见[处置清单](../workspace/admin/runtime/ops_workdir/message-identity-cache-disposition-20261103.json)；停写备份后复核调用边界及哈希，删除生产文件须授权 |

O01 的[逐会话处置基线](../workspace/admin/runtime/ops_workdir/message-identity-operation-preflight-20261103.json)已准备：七份 outbox 拒绝项与一份 activity 异常项，130个源文件两次读取哈希一致；这不是新一轮协议全量扫描或原子备份。准确路径、原证据引用和每项动作只在该清单维护。O01 处置决策及 O02 的真实入口、完整备份、中断、整份恢复、后续写入验收见[执行准备方案](message-identity-stock-audit.md#o01-逐会话处置方案与-o02-恢复演练准备)。准备阶段完成不等于生产处置完成。

已核实完整启动准备为工作区修复 → 摘要维护 → 重启回合恢复；后者会对可用且有活动回合的树会话提交生命周期事件，之前的限定副本未覆盖。宿主 PM2 与不同挂载命名空间的另一组进程不能混用；宿主启动插件为4.4.2、当前磁盘 manifest 为4.4.3，并存在工作区外浏览器 socket 链接，见[部署输入补证](message-identity-stock-audit.md#部署输入补证与演练隔离映射)。已固定目标源码采集时点快照及当前磁盘安装依赖，完成空白工作区的真实 bot 隔离初始化和两次正式准备，详见[实际配置与边界验证](message-identity-stock-audit.md#2026-11-04-依赖固定与真实-bot-隔离初始化)。源运行字节、全部写者、外部资源、原生系统库固定、同点完整备份及存量恢复仍待完成。headless 前须沿正式服务协议初始化运行参数；启动事件、全局配置及旁侧备份、工作区与旁侧 mutation-locks 均须隔离。七份 outbox 拒绝不能直接等同于详情不可用或会话停用；这些结果纳入逐项验收。V05、O01–O03 保持开放。

历史 v9 迁移函数不是读取期兼容旁路：最低支持版本未提高前，不能因名字含 legacy 或旧字段就删除整档升级链。退役须按版本支持范围和调用证据处理。提交也须单独授权；不得把其他主题工作树差异混入本主题。

## 7. 核实与验证记录

- **2026-11-04 O02 新建 scoped 样本写入**：公开接口新建 agent/plugin 两份显式沙箱样本，两进程重复写入后每份消息仅一份，无默认目录影子数据，父会话及会话树不变。130个异常原文件、133个选定生产文件和前批沙箱 state 未变。报告及边界见[本轮记录](message-identity-stock-audit.md#2026-11-04-新建-agentplugin-scoped-样本跨进程写入)。相关回归 **11/11**、质量门禁 **49/49**，未修改生产实现或基线，未重跑全仓测试。新建样本不替代可写存量 scoped 恢复或真实消费者投递；生产完整恢复、源部署及资源证据缺口保留，V05、O01–O03 开放。

- **2026-11-04 O02 活动回合与配置改写**：固定目标沙箱中，显式构造的 processing 回合经独立进程正式准备收敛为 `processing_failed / service_restart_orphaned_turn`，两轮恢复数1/0；重放原接受命令不改会话。旧配置演练输入经真实初始化改写，旁侧备份字节一致，第二启动配置不变。四份 agent 会话因父会话删除而拒绝写入，插件目录为空，scoped 健康写入仍待验收。报告、失败批次及边界见[本轮记录](message-identity-stock-audit.md#2026-11-04-活动回合重启收敛配置改写与-scoped-样本核查)。相关回归 **30/30**、质量门禁 **49/49**，未改生产实现或基线，未重跑全仓测试。文档格式、差异、221个本地链接目标、脚本语法及报告断言检查通过。130个异常原文件与133个选定生产文件未变；生产完整备份恢复、投递验收、源部署及外置资源仍未闭环，V05、O01–O03 保持开放。

此前存量限定副本记录补记后，文档格式、差异、209个本地链接目标、演练脚本语法及报告断言检查通过。

- **2026-11-04 O02 阶段中断恢复与健康写入**：首轮正式准备返回后终止独立沙箱，移出中断状态，从整个沙箱 state 备份恢复383项路径、类型、模式、内容与链接并重跑成功。另在固定健康树会话通过公开门面写入、重读及同进程/跨进程重复提交，新增 messageUid 始终一份且原消息一致。异常原文件130项、选定生产文件133项未变。成功报告、驱动失败批次及验收范围统一见[阶段演练记录](message-identity-stock-audit.md#2026-11-04-阶段中断恢复与健康树会话写入)。相关回归 **28/28**，质量门禁 **49/49**，未改基线或豁免，未重跑全仓测试。该沙箱状态恢复不是生产停写完整备份；活动回合、scoped 健康样本、生命周期及投递、配置改写、源部署及外部资源证据仍待验证，V05、O01–O03 继续开放。

- **2026-11-04 O02 存量限定副本与独立重启**：固定代码3401项与原清单一致，当前工作树36条原清单路径不同；真实 bot 对三个会话根及布局标记的在线副本执行正式准备。七份 outbox 升级拒绝且列表详情仍为 `available`；activity 会话持续 `unavailable / ACTIVITY_TIMELINE_FACT_INVALID`。新进程再次拒绝七份 outbox，同进程次轮差异与隔离重试去重一致，不能认定身份已恢复。130个异常原文件及133个选定生产文件未变，回合恢复均0。失败批次、独立重启断言、最新资源观察与目标恢复/原部署回滚的不同验收条件统一见[存量演练记录](message-identity-stock-audit.md#2026-11-04-存量限定副本与独立进程重启验证)。正式准备回归 **11/11**，本轮质量门禁 **49/49**，未改基线或新增豁免；未重跑全仓测试。源部署、全部写者、外置资源及完整恢复仍缺证据，V05、O01–O03 开放。

- **2026-11-04 O02 最终验证补记**：已读回[相关回归日志](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-regression-20261104.log)，**31/31** 通过，失败、取消、跳过均0；[最终质量门禁](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-quality-final-20261104.log)明确记录 **49/49** 通过。未使用依赖实测29，旧基线30触发过期检查，按实测收紧至29，未新增豁免；依据及初始化验收限制统一见[完整记录](message-identity-stock-audit.md#2026-11-04-依赖固定与真实-bot-隔离初始化)。本次未重跑全仓测试，V05、O01–O03 继续开放。

**T01–T10、V01–V04、V06–V07 已完成列明实现与验证；未执行生产升级或其他生产操作。** 实现范围见第 3 节，V05 的历史来源对应关系仍开放，生产边界仍归 O01–O03。

- **2026-11-04 O02 实际隔离初始化**：[成功报告](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/retry-20261104T015732613422Z/report.json)验证真实 `BotManager` 与两次正式准备，失败0；无存量会话，摘要重建和回合恢复均0，不替代完整恢复验收。14个依赖根/55200项已固定，135条执行链接校验通过；代码与根目录只读、网络及两条源浏览器 socket 不可达。133个选定生产文件及固定依赖未变。失败批次、源进程观察、35条既有快照路径差异、实际配置及写入范围见[完整记录](message-identity-stock-audit.md#2026-11-04-依赖固定与真实-bot-隔离初始化)。源运行字节及生产资源闭环仍缺证据，O02 不关闭。

- **O02 目标输入固定与隔离契约核查**：[快照报告](../workspace/admin/runtime/ops_workdir/identity-input-freeze-20261103T163901756438Z/report.json)记录3401项目标代码的归档字节校验、两次读取一致性及22个可访问网络命名空间观察；两个工作区可写描述符指向本次工具日志。源运行字节与 socket 持有者仍未确认。启动上下文、路径一致性及正式准备入口回归 **21/21**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-freeze-contract-tests-20261103.log)；统一质量门禁 **49/49**，见[门禁日志](../workspace/admin/runtime/ops_workdir/message-identity-input-freeze-quality-20261103.log)。归档哈希、报告断言、脚本语法及文档格式检查通过。没有调用 headless 或执行完整恢复，不以代码快照代替安装依赖固定或停写证明。

- **2026-11-03 摘要失败根因闭环（T09）**：捕获[修复前错误链](../workspace/admin/runtime/ops_workdir/message-identity-projection-causes-20261103.json)，在事件协议补齐非法 fact 的错误码；[修复后副本报告](../workspace/admin/runtime/ops_workdir/message-identity-projection-fixed-20261103.json)验证维护、列表、详情及重复维护均保留明确不可用原因，源文件未改写，副本已清理。[专项13/13](../workspace/admin/runtime/ops_workdir/message-identity-projection-regression-20261103.log)、[相关回归225/225](../workspace/admin/runtime/ops_workdir/message-identity-projection-related-20261103.log)。这关闭代码层处理缺口，不关闭 O01–O03 或 V05。

- **T09 质量验证**：统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-projection-quality-20261103.log)；未调整基线或新增豁免。本轮未重跑全仓测试。

- **O01/O02 执行准备验证**：逐会话基线8项/130个文件，两次读取哈希一致；正式启动准备、工作区生命周期与 outbox 恢复既有回归 **37/37**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-operation-readiness-regression-20261103.log)。两份文档格式、差异及156个本地链接目标检查通过。统一质量门禁 **47/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-operation-readiness-quality-20261103.log)：deepNestingCount 250低于252、rawTypeof 426低于427，且fallbackChain 248超过247；未改基线或新增豁免。此为准备工作验证，完整停服恢复及生产操作均未执行，全仓测试未重跑；历史49/49不替代本轮结果。

- **O02 部署输入补证及门禁复验**：新增[只读核查报告](../workspace/admin/runtime/ops_workdir/message-identity-deployment-inputs-20261103.json)，区分进程挂载视角，关联宿主启动上下文与插件日志，记录磁盘 manifest、外部链接和演练映射。插件启动记录与磁盘版本不同、socket 持有者未定位，不宣称演练输入已齐备。统一质量门禁重新执行 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-readiness-followup-quality-20261103.log)；兜底链实测247，前轮248未复现，本轮未修改已有基线改动或生产源码。全仓测试未重跑，生产操作未执行。

- **2026-11-03 处置清单推进**：22份作用域缓存所属会话均未注册当前会话树，生产缓存调用方绑定树上下文；生产作用域快照直接从事实构建。逐份副本删除缓存前后快照一致、缓存读取0、storage写入尝试0，172个源文件及对应会话树哈希不变，副本已清理。形成22份当前仓库范围的准确清理候选，见[处置清单](../workspace/admin/runtime/ops_workdir/message-identity-cache-disposition-20261103.json)；没有生产流量观测或仓库外调用方的穷尽结论。公开门面对损坏/缺失缓存的回归及activity升级专项 **14/14**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-disposition-regression-20261103.log)。隔离默认只登记原因、不搬移会话，处置边界见[存量核查](message-identity-stock-audit.md)。

- **此前阶段补证与验证**：限定副本实际运行布局升级、摘要维护和详情门面；七份outbox拒绝登记并经同次隔离重试仍拒绝，activity异常因无已有隔离登记未触发v21重试，摘要维护报告失败、详情返回unavailable。异常会话20个文件与全部197个源文件不变，副本清理完成；[阶段报告](../workspace/admin/runtime/ops_workdir/message-identity-prepare-phases-20261103.json)不是完整启动或停服恢复演练。格式、测试文件ESLint、差异检查通过，统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-disposition-quality-20261103.log)；未重跑全仓测试或调整基线。该阶段尚未展开摘要投影错误，后续已由 T09 核实并修复。

- **2026-11-03 来源与缓存读取复核**：异常activity在早期备份日志和后续checkpoint中均缺 `activityId`，9个命中文件读前/读后哈希一致；22份作用域缓存均为旧版，生产读取器全部返回null，缓存及manifest变化0、写入尝试0。scoped仓库缓存命中、删除后重建、manifest字节不变与activity迁移专项 **14/14**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-lineage-regression-20261103.log)。本轮格式、测试文件ESLint、差异和本地链接检查通过；质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-lineage-quality-20261103.log)。详细边界与证据见[存量核查](message-identity-stock-audit.md)；未证明具体历史写者或22份文件的运行时调用，V05/O01–O03不关闭。

- **2026-11-03 后续推进**：V05 原登记定位到 `584a18939`，该提交未提供八条的路径或事件清单，来源对应关系继续待核实。O03 新增[逐文件盘点](../workspace/admin/runtime/ops_workdir/message-identity-cache-inventory-20261103.json)：63份缓存、22份作用域缓存可重建、缓存哈希变化0、storage写入尝试0；范围与读取边界见[存量核查](message-identity-stock-audit.md)。O01 新增一份缺 `activityId` 的存量证据，并补充“不推断身份且全部 checkpoint 字节不变”的迁移隔离回归；activity 专项 **7/7**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-activity-regression-20261103.log)。本次新增测试与核查不改变实现主流程，不以消息身份断言通过替代完整展示内容合规。

- **后续验证**：新增回归与两份文档的格式、测试文件 ESLint、`git diff --check` 通过；统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-next-quality-20261103.log)。上一轮47/49的两项失败本次未复现，本任务未改基线。本次未重新执行全仓测试，新增回归的7/7只证明其覆盖范围。
- **2026-11-03 当前基线复核**：session-protocol / event-protocol / session-repair / workspace-protocol 共 **306 + 168 + 122 + 30 = 626 项通过**，失败与跳过均0；[协议日志](../workspace/admin/runtime/ops_workdir/message-identity-protocol-20261103.log)。T08 修复后迁移与恢复专项 **21/21**，失败与跳过均0；[专项日志](../workspace/admin/runtime/ops_workdir/message-identity-upgrade-20261103.log)。该626项结果早于T08主流程改动，后者由21项专项验证。
- **本轮存量与历史补证**：[只读重扫](../workspace/admin/runtime/ops_workdir/message-identity-stock-20261103.json)覆盖62份会话，七份 outbox 拒绝、写入尝试0；当前会话有并发变化。历史候选扫描1261份文件，42份文件中240处结构化空身份全部来自备份；不是240条独立消息，也不能替代旧八条登记。[历史扫描](../workspace/admin/runtime/ops_workdir/message-identity-history-20261103.json)及[修复后副本与八条迁移实证](../workspace/admin/runtime/ops_workdir/message-identity-copy-rehearsal-fixed-20261103.json)保留路径、哈希及结果。
- **本轮最终验证**：修复后的 `npm test` 全仓 **PASSED exit=0**，见[执行日志](../workspace/admin/runtime/ops_workdir/message-identity-all-20261103.log)。统一质量门禁本次为 **47/49**，见[质量日志](../workspace/admin/runtime/ops_workdir/message-identity-quality-20261103.log)：其他并发改动的两份 artifacts 文件格式不合规，复杂度实测123/嵌套270低于既有基线126/286而要求收紧；不将这些并发差异改动或基线变化计入本主题。历史48项门禁不能替代本次49项结果。
- 本任务四个文件的 Prettier、两个代码文件的 ESLint、两份文档全部本地链接和 `git diff --check` 均通过。演练生成的两份会话副本与副本备份已清理，扫描脚本、JSON 报告及测试日志保留；未删除任何源存量或历史备份。

- 本轮 V05 代码复验：model-proxy 专项 **18/18**；当前工作树全仓 `PASSED exit=0`，日志：[V05 全仓复验](../workspace/admin/runtime/ops_workdir/v05-all-current.log)；质量门禁 **48/48**，日志：[V05 质量复验](../workspace/admin/runtime/ops_workdir/v05-quality-current.log)。质量实测 rawTypeof **432**、unusedExports **91**，均等于既有基线；未调整基线或新增豁免。此前报告的格式、rawTypeof 与 unusedExports 三项失败在当前版本复验中均未复现。
- V05 存量与迁移：仓库工作区限定范围 **59** 份会话读取和身份校验通过，**7** 份 xiayu outbox attempt 缺 `consumerId`；升级漏校验已修复，坏会话隔离、源字节不变及健康会话继续升级专项 **10/10**。报告见[存量核查](message-identity-stock-audit.md)及[扫描数据](../workspace/admin/runtime/ops_workdir/v05-readonly-audit.json)。扫描不覆盖生产、备份、隔离目录、归档或仓库外插件安装；七份存量尚未升级或重扫。

- 本轮 V06 收尾：session-protocol 工作区历史结果 **302/302**（此前最终 V06 记录）；新增执行报告 UI 专项 **5/5**；最新全仓 `PASSED exit=0`，日志：[V 审计全仓复验](../workspace/admin/runtime/ops_workdir/v-audit-resume-final-all.log)；质量门禁 **48/48**，日志：[V 审计质量复验](../workspace/admin/runtime/ops_workdir/v-audit-resume-final-quality.log)。全仓包含本轮测试字段修正。质量初次失败由 `.tmp` 中不属于源码的临时配置备份触发；备份逐字节校验后移入 ops 工作区，未改内容、未放宽规则。`git diff --check` 通过。
- V06 代码审计：工厂结果由协议完整校验；权威快照与终态查询复用 `projectTurnTiming`；aggregateVersion、lifecycle sequence、timing 分域处理由事件协议与前端 admission 回归明确覆盖；未加载轮次为 `null`。主详情、hydration、workflow execution detail/REST snapshot、子会话 snapshot 与 thinking-detail 的权威输入已逐入口核实，详见第 3 节 V06。
- V02 投影消费映射与 V03 bucket v14 状态写者已完成核实，详见核实记录。当前运行断言与历史版本转换职责分开；字段推进和完成重置共用同一权威状态，不维护推算副本。
- V05 当前工作区核查报告见[存量核查](message-identity-stock-audit.md)，逐会话结果见 `v05-readonly-audit.json`。本轮 `rg` 复核历史档案及核实记录，历史档案第 439 行仍只登记“8 条空 identity.messageId 复核”，未提供八条原始数据的路径与版本。这不证明所有历史来源均已排查。59 份扫描未命中不能替代样本定位，V05 保持开放。七份 outbox `consumerId` 异常与历史八条空消息身份是不同问题。

- V04/V06 最终版本：session-protocol **302/302**，日志：[协议专项](../workspace/admin/runtime/ops_workdir/v06-protocol.log)；全仓 `PASSED exit=0`，日志：[执行结果](../workspace/admin/runtime/ops_workdir/v06-all.log)、完整日志 `test-results/test-runs/npm-2026-11-01T09-38-57-150Z.log` 当前已不在仓库，保留原路径记录。agent 工作区有 1 项既有条件跳过（`attachment-source-path-and-stream.test.js` 声明 `skip: getuid()===0`，当前以 root 运行），不在本轮差异中，不计为通过。质量门禁 **48/48**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/v06-quality.log)；按实测收紧基线 complexityCount **141→140**、deepNestingCount **299→298**、fallbackChain **278→272**，未新增豁免。早于 V06 改动的 V04 中间日志不作为最终结论。

- T07 迁移与监听专项 **3/3**，日志：[隔离迁移及监听](../workspace/admin/runtime/ops_workdir/t07-agent-contract.log)；前端专项 **6/6**，日志：[live/reconnect 去重](../workspace/admin/runtime/ops_workdir/t07-client.log)。最终修复后的全仓退出码 **0**，日志：完整日志 `test-results/test-runs/npm-2026-11-01T06-54-14-685Z.log` 当前已不在仓库，保留原路径记录、[执行结果](../workspace/admin/runtime/ops_workdir/t07-final-all.log)；质量门禁 **48/48**，退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t07-final-quality.log)。通过抽取冲突检查降低嵌套并合并重复导入修复门禁，未调整基线或新增豁免；隔离测试不代替生产存量抽样。

- T06 相关工作区 **229 项通过**，日志：[配置与 workflow 回归](../workspace/admin/runtime/ops_workdir/t06-related.log)。包含最终语言枚举复用与无用导出清理的全仓退出码 **0**，日志：完整日志 `test-results/test-runs/npm-2026-11-01T06-35-17-732Z.log` 当前已不在仓库，保留原路径记录、[执行结果](../workspace/admin/runtime/ops_workdir/t06-final-all.log)。质量门禁复验 **48/48**，退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t06-final-quality.log)。未调整基线或新增豁免。

- T05 契约专项 **18/18**，失败、取消、跳过均为 0，日志：[结果、hook 与持久化](../workspace/admin/runtime/ops_workdir/t05-contract.log)。包含新增回归的全仓退出码 **0**，日志：完整日志 `test-results/test-runs/npm-2026-11-01T06-15-13-352Z.log` 当前已不在仓库，保留原路径记录、[执行结果](../workspace/admin/runtime/ops_workdir/t05-all.log)。质量门禁复验 **48/48**，退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t05-final-quality.log)；rawTypeof 基线按实测 **453→452** 收紧，未新增豁免。

- T03 最终全仓退出码 **0**，日志：完整日志 `test-results/test-runs/npm-2026-11-01T06-01-20-471Z.log` 当前已不在仓库，保留原路径记录、[执行结果](../workspace/admin/runtime/ops_workdir/t03-final-all.log)。Node 专项 **44/44**，日志：[协议与路由](../workspace/admin/runtime/ops_workdir/t03-node.log)；前端 6 文件 **59/59**，日志：[详情与展示](../workspace/admin/runtime/ops_workdir/t03-client.log)。质量门禁 **48/48**，日志：[质量检查](../workspace/admin/runtime/ops_workdir/t03-quality.log)。删除无用参数与重复规则，rawTypeof 基线按实测 **454→453** 收紧，未新增豁免。

- T04 最终全仓退出码 **0**，日志：[执行结果](../workspace/admin/runtime/ops_workdir/t04-final-all.log)（完整日志 `npm-2026-11-01T05-19-46-022Z.log` 当前已不在仓库，保留执行结果中的原路径记录），其中 session-protocol **296/296**、前端 **1577/1577**，包含生命周期关系拒绝无残留回归。前端专项 **27/27**，日志：[专项结果](../workspace/admin/runtime/ops_workdir/t04-client-final.log)。质量门禁 **48/48**、退出码 **0**，日志：[质量检查](../workspace/admin/runtime/ops_workdir/t04-final-quality.log)。删除旧子索引的生产及测试引用，未调整质量基线或新增豁免。

- T02 最终全仓退出码 **0**，日志：[执行结果](../workspace/admin/runtime/ops_workdir/t02-closure-all.log)（完整日志 `npm-2026-11-01T05-04-55-607Z.log` 当前已不在仓库，保留执行结果中的原路径记录）。其中 session-protocol **294/294**、前端 **1574/1574**，包含新增逐记录诊断与拒绝无副作用测试。专项：[跨协议 51 项](../workspace/admin/runtime/ops_workdir/t02-cross-contract.log)、[CLI/监听器/派发 29 项](../workspace/admin/runtime/ops_workdir/t02-service-contract.log)、[代理层 160 项](../workspace/admin/runtime/ops_workdir/t02-proxy-recheck.log)、[前端 22 项](../workspace/admin/runtime/ops_workdir/t02-store-recheck.log)。兜底链基线按实测 **292→280** 收紧，未放宽复杂度或新增豁免。文档状态统一后质量门禁再次 **48/48**、退出码 **0**，日志：[最终质量检查](../workspace/admin/runtime/ops_workdir/t02-closure-quality.log)；文档格式与 `git diff --check` 通过。

- T01 最终全仓测试通过，退出码 **0**，包含接受与终态的保存失败、投影失败及进程中断恢复测试；日志：[执行结果](../workspace/admin/runtime/ops_workdir/t01-closure-all.log)。历史完整日志 `npm-2026-11-01T04-15-23-420Z.log` 当前已不在仓库，保留执行结果中的原路径记录。最新质量门禁 **48/48**，退出码 **0**，日志：[完整质量检查](../workspace/admin/runtime/ops_workdir/t01-verified-quality.log)。恢复与锁专项 **23/23**，无失败、取消或跳过。结果已实际读回，不沿用早于最终测试版本的全仓结论。
- 迁移依据包括原实体对缺省字段的读取规则，以及旧转移器保留非可重试失败 intent 的路径；有内容的退役 intent payload 不猜测迁移，直接隔离。当前 schema 不再补历史字段。测试覆盖的是构造的旧 schema 与隔离工作区，不是全部已发布版本或生产存量抽样。

- 本轮重新运行 `npm test -w session-protocol -w event-protocol -w plugin-protocol`：**251 + 145 + 28 = 424 项通过，失败0、跳过0**。日志：[协议复核](../workspace/admin/runtime/ops_workdir/message-identity-checklist-protocol-tests.log)。这是协议包回归，不是本轮全仓复验。
- 文档重组后重新运行统一质量门禁：**48/48 通过**，日志：[清单整理质量检查](../workspace/admin/runtime/ops_workdir/message-identity-checklist-quality.log)。两份文档的格式、本地链接、任务 ID 唯一性、历史章节保留及 `git diff --check` 均通过。
- 已实际读回历史全仓日志 `test-results/test-runs/npm-2026-11-01T01-45-11-766Z.log` 的 `PASSED exit=0`，及 `message-identity-forest-quality-verified.log` 的 **48/48**。它们属于执行森林阶段，不记成本轮新执行结果。
- 历史专项、提交、版本迁移样本和生产只读结果全部保留在[历史档案](message-identity-architecture-history.md)。档案状态不覆盖本文。

## 8. 下一步顺序

1. V05 已追溯到引入登记的提交，但无原扫描路径；继续寻找原始来源记录，不能只凭八条数量一致关闭。缓存与前缀规则已经核实，不重复安排开发。
2. T08/T09 已修复并通过相关回归及限定副本演练；摘要投影失败根因已展开并闭环，不再重复安排排查。新问题按第 4 节登记并闭环。
3. O02 已完成列明范围的目标代码与依赖固定、真实 bot 隔离准备、健康树与新建 scoped 写入、活动回合失败收敛、配置改写、沙箱状态恢复及真实 WebSocket 重投验证，证据见[存量核查](message-identity-stock-audit.md)。剩余阻塞为源启动部署包、全部写者与外置资源归属、生产停写同点完整备份恢复，以及可写存量 scoped 样本。七份 outbox 拒绝及 activityId 缺失的生产处置仍开放，禁止猜填身份或以原因登记替代实际处置。
4. O03 调用链核实与22份清理候选清单已完成；正式清理前停写备份并复核调用边界和清单哈希。生产操作按第6节授权边界办理，不能用隔离副本或专项测试关闭；历史写者/旧20份对应关系仍标待验证，不再重复按旧数量安排清理。
