# 会话存量只读核查

本报告维护仓库工作区只读核查证据，不代表生产全量合规或已完成升级。最新核查为 **2026-11-03**，代码基线 `49c3e3fe2` 加本轮改动；2026-11-02 结果作为历史保留。历史八条空身份已找到并验证一份候选，候选与旧登记的对应关系仍待确认，V05 保持开放。

## 2026-11-04 消费者投递根因修复与真实 WebSocket 验证

本轮发现并修复 T10：[派发器](../service/ws/chat-websocket/authority-event-dispatcher.js)在整批发送返回后才确认成功项，后序发送抛错导致已成功前序项也未获持久化确认。新增[回归](../service/__tests__/routes/authority-event-dispatcher.test.js)先复现失败，再验证成功前序项获确认、原发送错误继续传播、重试只发剩余项；同步发送抛错与确认拒绝同时发生时，两项错误均保留。发送返回 false、确认拒绝仍沿既有协议，未推断消费者、增加旁路或逐事件确认写入。

[演练脚本](../workspace/admin/runtime/ops_workdir/message-identity-consumer-20261104.py)沿用既有隔离入口，固定目标上只读覆盖本次派发器文件，覆盖文件的源路径及 SHA-256 写入[成功报告](../workspace/admin/runtime/ops_workdir/identity-consumer-20261104T051435147369Z/report.json)。结论适用于该明确代码组合，不外推到全部当前工作树或源运行部署。

- 进程0在真实健康会话副本通过公开生命周期接口产生两条事件。第二条发送抛错，第一条完成真实持久化确认，错误原样传播；剩余一条待投递。
- 进程1正式准备产生重启失败收敛事件，待投递共两条。公开会话确认边界显式注入拒绝，派发返回失败且待投递集合不变；CLI 独立确认不影响 WebSocket 消费状态。
- 进程2使用正式 `createOutboundEventSender`、真实 WebSocket 服务端及客户端，通过隔离网络命名空间的 TCP loopback 收发。客户端收到两条事件且身份、类型与顺序一致；派发后持久化队列为空，重复派发0条，原成功前序事件未重发，CLI 也不再重发。这证明列明传输及持久化闭环，不证明生产客户端处理或业务模型执行。
- 三进程均沿用既有代码/根目录 EROFS、外网 ENETUNREACH、源浏览器套接字 ENOENT 及链接检查；130个异常原文件、133个选定生产文件与前批沙箱状态未变。哈希范围不能代替完整停写证明。

首批[失败报告](../workspace/admin/runtime/ops_workdir/identity-consumer-20261104T050404514086Z/state/initialization-result.json)为演练驱动漏复制 `stock-baseline.json`，真实准备已运行但投递探测未开始；补齐同一基线后重新创建独立批次，保留全部失败现场。中间回调模拟批次不作为最终 TCP 传输证据。

最终代码验证：专项 **37/37**，最终质量门禁 **49/49**，全仓 `npm test` **PASSED exit=0**；此前服务全量测试 **353/353**。日志分别为[服务测试](../workspace/admin/runtime/ops_workdir/authority-prefix-service-tests.log)、[专项](../workspace/admin/runtime/ops_workdir/authority-prefix-regression-final.log)、[最终门禁](../workspace/admin/runtime/ops_workdir/authority-prefix-quality-final.log)及[最终全仓测试](../workspace/admin/runtime/ops_workdir/identity-completion-full-tests-final.log)。门禁曾因新增分支使 deepNestingCount 252超过基线251而失败，已展平分支修复并复验；未修改基线或增加豁免。全仓测试包括当前工作树其他既有未提交改动，不声明其作者归属。

**剩余验收阻塞**：可写存量 scoped 样本、源启动不可变部署包及运行字节对应关系、原生系统库固定、全部生产写者与两条外部浏览器 socket 归属、外置资源和生产停写同点完整备份恢复仍未完成。V05 原登记缺少原始扫描范围，现有八条候选不能据数量替代来源证明。七份 outbox 的 `consumerId` 与 activity 的 `activityId` 缺失没有可恢复事实源；不猜填、不删除坏事件、不重建已删除父会话。V05、O01–O03 继续开放。生产停服、处置、正式清理、部署及提交均未执行。

## 2026-11-03 复核与继续处理

- 复用原只读脚本重扫 **62** 份会话，全部会话读取和消息身份断言通过；仍为相同七份 xiayu outbox 因 attempt 缺 `consumerId` 被拒绝。写入尝试 **0**；当前运行会话在扫描期间有事件文件并发变化，不能声称全范围字节稳定或原子快照。admin 布局30、xiayu 布局29。完整结果见[重扫报告](../workspace/admin/runtime/ops_workdir/message-identity-stock-20261103.json)。
- 对仓库 workspace 的 JSON/JSONL 进行候选检索，再结构化解析 `identity.messageId === ""`。排除 ops_workdir、browser-profiles 与 node_modules；**1261** 份候选文件中，**42** 份命中 **240** 处，全部在备份，解析失败0。命中包含同一事件的日志与 outbox 副本，不代表独立事件数。[扫描结果](../workspace/admin/runtime/ops_workdir/message-identity-history-20261103.json)记录路径、指针与 SHA-256；这是限定检索，不涵盖其他编码、压缩归档、仓库外或未授权来源。
- 找到恰含八条的候选：`workspace/admin/runtime/workspace-backups/2026-10-22T15-32-00-809Z/runtime/session/cbbfaeac-8fe0-44b6-b437-cfdf83c07953/authority-outbox/outbox.jsonl`，SHA-256 为 `0eedf36e014479aea9abde18dc14e5c16659e1e41db1a079a8f301c58f1fad49`；行号 **16、19、22、25、28、31、34、37**。协议为 event v3 / workflow.runtime schema1，类型均为 `workflow_node_state_committed`。公开 `migrateSessionDocumentIdentity(..., OUTBOX)` 删除退役字段后，八条全部通过信封及 outbox 断言，事件身份不变、输入字节不变、重跑无变化。该字段是旧信封冗余字段，不能据其空值推断缺失会话消息主键。仍无旧登记扫描范围证据证明候选就是原八条。
- `sessions.json` 由 `WORKSPACE_LAYOUT.SESSION_SUMMARY_FILE` 声明，仓库 `summary-methods.js` 消费 `sessions-summary` 协议；从会话事实重建，可用性失败显式投影 unavailable，投影失败保留原错误与投影错误。它是派生列表缓存。`message-identity.js` 的工厂按 schema 生成前缀，断言不按前缀判断身份类型，不重写旧值。以上关闭这两项代码规则核实，不关闭存量缓存清理。

### 副本演练发现并修复 T08

复制 xiayu 的 `runtime/session`、`runtime/agent/session`、`runtime/plugin-data/workflow/session` 与布局标记，共 **197** 个文件；复制前、复制后及演练后比较源 SHA-256，全部一致。副本放在 ops_workdir；这是会话根的限定副本，未复制整个工作区、未停止生产写者，不能视为 O02 的完整停服演练。

修复前调用启动准备共用的 `upgradeWorkspaceLayout`，v29→v30 因 `consumerId` 异常整体失败，副本仍为29。[失败报告](../workspace/admin/runtime/ops_workdir/message-identity-copy-rehearsal-20261103.json)保留现场。调用栈证明 `writeSessionArtifact → readPreviousTurnManifest → materializeCommittedTurnEvents → projectCommittedTurnOutbox` 先于 outbox 迁移准入，导致当前 schema 的错误绕过升级隔离分类；旧 schema12 用例未覆盖。

根因修复将暂存 outbox 的迁移和协议准入前移至会话写入前，删除旧的后置调用；拒绝继续沿既有逐会话隔离，details 保留协议错误文本，没有补写身份或新增兼容入口。修复后新建副本实测 **7** 份隔离、无 failed、布局 **30**，重跑无变化。副本会话文件未修改，只有布局标记变化；不存在需要重写的健康会话。健康附件事件实际升级、投递次数保持和坏会话字节不变由新增启动集成回归覆盖。[修复后报告及八条迁移验证](../workspace/admin/runtime/ops_workdir/message-identity-copy-rehearsal-fixed-20261103.json)。

四个协议工作区 **626/626**；修复后的身份/附件升级与生命周期 outbox 恢复专项 **21/21**。生产七份坏记录仍未改写，不从后续 ack 推断消费者。O01 存量处置、O02 完整停服备份/恢复/后续写入、O03 准确删除清单继续开放；本轮没有生产升级、删除、停服或重启。

修复后全仓 `npm test` **PASSED exit=0**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-all-20261103.log)。质量门禁本次 **47/49**：两份其他任务并发改动的 artifacts 文件格式失败，以及复杂度/嵌套实测低于旧基线而要求收紧，详见[日志](../workspace/admin/runtime/ops_workdir/message-identity-quality-20261103.log)。本主题未放宽质量规则或改动基线。

## 2026-11-03 后续只读盘点

### V05 来源追溯

`git log --all -S '8 条空' -- docs/message-identity-architecture.md` 定位到 `584a18939`（2026-10-22）引入登记，后由 `3e72ced90` 调整文档。引入版本只有“8 条空 identity.messageId 复核”，未列原扫描路径、事件 ID 或报告。因此新增的 Git 证据只能确定登记来源，不能证明首节八条备份候选与原登记相同，V05 继续开放。

### O03 当前缓存清单与读取边界

新增[盘点脚本](../workspace/admin/runtime/ops_workdir/message-identity-cache-inventory-20261103.mjs)与[逐文件清单](../workspace/admin/runtime/ops_workdir/message-identity-cache-inventory-20261103.json)，扫描仓库 workspace 的 runtime，排除备份、隔离、浏览器、ops、附件等目录；实际排除目录随报告保存。根目录来自工作区协议与仓库插件 manifest，文件名来自 `SESSION_ARTIFACT_FILE_NAMES`。结果为 **63** 份缓存：默认根 **41** 份，`runtime/agent/session` **22** 份，声明根外 **0** 份；workflow 根没有命中。缓存读前/读后哈希变化 **0**，storage 写入尝试 **0**。仅缓存文件做稳定性比较，不代表会话源的原子快照。

22 份作用域缓存全部通过生产 `readSessionArtifact` 读取并调用 `buildSessionDisplaySummary` 在内存重建；报告保留每个路径、SHA-256、大小及重建结果。默认根 41 份中 40 份可重建，另1份的失败见下节。以上为当前核查结果，不能沿用历史“20份”的数量作为删除清单。

历史 `ad741210c` 将20份 scoped 缓存登记为孤儿，但没有逐文件路径。当前读取链有两种职责：`session-scoped-artifact-reader.js → readSessionArtifactSnapshot` 直接从会话重建；`session-crud-service.js` 的详情与维护通过会话树读取缓存。与此同时，`ScopedSessionLocationResolver` 可将仓库缓存入口绑定到作用域目录，`_refreshSessionDisplaySummary` 也消费同一 scope。因此“主详情与启动维护不读这些文件”不足以证明所有调用方均无读取依赖；22份保留为审查清单，**当前批准删除清单为空**。还需核对 scoped persistenceContext 的实际调用方、写入来源和旧20份的对应关系，禁止直接删除。

### O01 新增存量拒绝证据

`workspace/xiayu/runtime/session/56954429-d93a-4348-a3a3-d1dd78bbdeac` 的 schema21 会话可读取且消息身份断言通过，但第3条消息的第1项 activity fact 缺少协议必填 `activityId`，`buildSessionDisplaySummary` 抛出 `activity timeline contains a noncanonical fact`。其类型为 `thinking`、activityKind 为 `guidance_analysis`；同目录 outbox 文件为空，不能从中恢复来源身份。[诊断报告](../workspace/admin/runtime/ops_workdir/message-identity-activity-stock-20261103.json)仅保留身份元数据，不含消息正文。该用户未发现 `runtime/migration-quarantine` 目录，当前没有该会话升级隔离的磁盘证据；不能据此推断升级从未执行或确定历史写者。

既有 `session-activity-timeline-upgrade.js` 对此形状会以 `activity_fact_unrecognized` 拒绝，没有补写 activityId 的分支。新增[回归](../agent/__tests__/workspace-session-activity-timeline-upgrade.test.js)复现该缺字段形状，实测会话隔离且 manifest 与全部 checkpoint 字节不变；activity 升级专项 **7/7**，失败/跳过0，[日志](../workspace/admin/runtime/ops_workdir/message-identity-activity-regression-20261103.log)。目前证明的是存量不满足协议及既有迁移能拒绝，不是已证明新的实现缺陷；存量来源与处置仍归 O01，生产文件未修改。

### O02 完整演练的验收准备

正式演练需要先停止全部生产写者并取得同一时点完整工作区备份，保留逐文件哈希；在独立副本通过实际启动准备入口运行完整布局升级、摘要维护，保存逐阶段报告及隔离原因。对可用会话验证后续写入与重读，核对事件身份与投递记录；对上述拒绝会话验证源字节不变与健康会话不受阻断。再于副本中断准备流程，从完整备份恢复并核对全部哈希，重新准备验证幂等。恢复必须使用整份备份，不能把逐文件迁移回滚视作跨文件事务。本轮只完成这些验收项的整理，未执行停服、完整备份或恢复，不关闭 O02。

本次后续改动的 Prettier、测试文件 ESLint 与 `git diff --check` 通过；统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-next-quality-20261103.log)。上一轮47/49的两项失败本次未复现；未调整质量基线。本次仅新增回归与核查文档，未重新执行全仓测试，7/7不代替全仓结论。

## 2026-11-03 来源与缓存读取复核

### O01：缺失身份已存在于早期事件记录

以异常 `eventId` 为精确键，只读检查该 xiayu 会话及同会话的未压缩备份，命中 **9** 个文件。最早命中的备份为 `2026-10-11T02-39-33-130Z`，其 `execution-events/segment-000001.jsonl` 第46行已有同一事件，时间字段为 `2026-08-04T15:41:42.605Z`；事件 data 未含 `activityId`，同文件第70、87、102行的消息 activityTimeline 也未含该字段。10月22、26、28、30日备份 checkpoint 与当前 checkpoint 均缺此字段。该证据证明缺失早于本轮升级，不能据事件时间确定运行代码版本或具体历史写者。

[来源比对报告](../workspace/admin/runtime/ops_workdir/message-identity-activity-lineage-20261103.json)保存路径、JSON 指针、字段集合、身份元数据与 SHA-256，不含消息正文；9个命中文件各自读前/读后哈希一致，未修改源文件。这是限定检索，不是全部历史来源的穷尽证明。日志中的 eventId、presentationMessageId 与当前协议的 activityId 职责不同，不能互相补写；O01 继续按不可恢复身份处理候选保留，生产隔离尚未执行。

### O03：22份均为旧版缓存，不能据此认定孤儿

对上轮清单中的22份作用域缓存调用生产 `readSessionDisplaySummaryArtifact`，全部返回 null，无异常；当前读取器要求 summary schema37 / session schema21，实物为 **18份 schema26 / source schema7**、**4份 schema19（无 source schema）**，版本门槛已足以解释拒绝。当前有效缓存 **0**，写入尝试 **0**，22份缓存及各自 manifest 哈希变化 **0**。见[读取核查脚本](../workspace/admin/runtime/ops_workdir/message-identity-cache-readers-20261103.mjs)与[逐文件结果](../workspace/admin/runtime/ops_workdir/message-identity-cache-readers-20261103.json)。可重建性仍引用前次盘点，本次没有改写或重建磁盘文件。

已核实的调用边界：facade 在 `session/index.js` 根据协议 persistenceScope 创建绑定上下文；仓库 `artifact-methods.js` 的 ensure/read 经同一 scope 读取缓存，失效后由 `_refreshSessionDisplaySummary → rebuildSessionDisplaySummaryArtifact` 重建并写入该目录。`session-scoped-artifact-reader.js → readSessionArtifactSnapshot` 则直接从事实生成内存摘要。`listAgentSessionScopes → resolveSessionPersistenceContext` 的现有调用方是分支删除规划，不能把它当作摘要读取证据。以上证明仓库能力及代码调用关系，不证明这22份文件当前均被运行时调用；具体历史写者、实际运行调用及与旧20份的对应关系仍待核实。当前批准删除清单仍为空。

扩展既有 scoped 仓库集成回归，验证有效缓存命中（rebuilt=false）、仓库读取结果一致、在测试副本删除缓存后从事实重建（rebuilt=true），并核对 manifest 字节不变和默认根无影子数据。scoped仓库与activity迁移专项 **14/14**，失败/跳过0，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-lineage-regression-20261103.log)。未改动实现主流程，未重新运行全仓测试，不沿用历史门禁结果作为本轮复验。

本轮 Prettier、测试文件 ESLint、`git diff --check` 通过，统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-lineage-quality-20261103.log)；两份文档的本地链接检查通过。未放宽规则或调整基线。

V05 原登记的扫描路径/事件清单仍缺失；本轮没有新增能够确认八条候选对应关系的证据。O02 完整停服备份与恢复演练尚未执行。

## 2026-11-03 清理候选与处置边界

### O03：当前仓库调用范围内的22份准确清理候选

新增[核查脚本](../workspace/admin/runtime/ops_workdir/message-identity-cache-disposition-20261103.mjs)与[逐文件处置清单](../workspace/admin/runtime/ops_workdir/message-identity-cache-disposition-20261103.json)。清单以每份缓存的路径、SHA-256、所属会话和会话树哈希记录本次证据，不重复维护另一份文件列表。**22份均满足当前仓库调用范围内的清理候选条件，生产删除尚未授权或执行。** 此结论替代前两轮“调用关系仍待核实”的当前状态；历史记录保留。

- 对仓库生产源码检索 `readSessionDisplaySummary`、`ensureSessionDisplaySummary` 及底层 artifact 读写入口：生产缓存读取调用方为 `SessionCrudService._readSessionDetailEntry` 与 `maintainSessionDisplaySummaries`，两者均绑定 `treePersistenceContext`。`SessionTreeLocationContext` 经 `resolveSessionDirSegments` 只定位默认会话根。22份缓存所属会话在各自当前会话树中均未注册，无法由这些入口定位。仓库接受显式 scoped context 是内部能力，既有测试调用不能证明存在相应生产调用方。
- 插件详情经 `service/services/plugin-service-ports.js` 的 `sessions.readSnapshot`，通过公开门面到 `createScopedSessionArtifactReader → readSessionArtifactSnapshot`，后者直接从会话事实构建摘要。插件路径由插件数据协议限定；本次22份均位于 `runtime/agent/session`，没有将它们当作 workflow 当前插件路径。
- 逐份复制完整会话目录后调用生产作用域读取器，在副本删除**仅该份 `session-summary.json`**，再次读取所得 `sessionSummary`、`executionLogs`、`meta` 全部一致；storage 观察到该缓存读取 **0**、写入尝试 **0**。删除后副本其他文件不变；对应 **172** 个源文件及会话树在各次核查前后哈希不变。演练副本已清理。该读取追踪是本次主动调用结果，不声称观察过生产流量或穷尽仓库外安装插件。
- 扩展[公开门面回归](../agent/__tests__/session/scoped-session-repositories.test.js)：缓存损坏和删除均不改变作用域快照，不重写缓存或 manifest。与 activity 升级回归合计 **14/14**，失败、取消、跳过均0，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-disposition-regression-20261103.log)。

清理动作只允许引用本次清单中的22个缓存文件；不包括 manifest、checkpoint、journal、outbox、详情目录或默认根41份缓存。执行前需停止相关写者、取得完整备份，并复核当前源码调用边界及清单里的缓存和会话树哈希；任一变化都停止该项清理并重新核实。历史20份与当前22份的对应关系、具体历史写者仍未证明，不再以数量相近归并；本次候选资格来自逐文件现状证据。O03 的只读调用链核实与清单准备完成，生产清理仍开放。

### O01：原因登记不等于搬移或停用会话

`upgradeSessionDirectories` 调用 `quarantineMigrationUnit` 时没有传入 `move`，后者默认 `move=false`，因此只写 `.reason.json` 并保留源会话，不搬移或删除数据。此前七份 outbox 副本隔离和缺 `activityId` 的迁移专项证明的是协议拒绝、原因登记、源字节保持及其他会话继续处理；不能据此声称生产坏会话已经被搬走、停用或恢复。

七份 outbox 的准确范围继续由[存量扫描报告](../workspace/admin/runtime/ops_workdir/message-identity-stock-20261103.json)中 `checks.outbox.ok=false` 的条目维护；activity 异常由[诊断报告](../workspace/admin/runtime/ops_workdir/message-identity-activity-stock-20261103.json)维护。处置不得用 ack 反推 `consumerId`、用 eventId 补 activityId、删除坏事件或清空 outbox。应在完整备份后通过正式准备入口验证各实际版本阶段的拒绝/可用性结果，保留异常源供后续有证据的恢复；本轮没有执行这些生产动作，也未新增第二套隔离实现。单独运行 activity 迁移的专项不证明布局29→30会重跑历史v21阶段。

本轮没有新增可确认 V05 原八条对应关系或异常历史写者的证据；这些来源问题继续明确标为待验证。O02 的完整停服备份、全部准备流程、后续写入和整份恢复演练仍未执行。

### O01：实际版本阶段与详情可用性补证

新增[阶段核查脚本](../workspace/admin/runtime/ops_workdir/message-identity-prepare-phases-20261103.mjs)及[报告](../workspace/admin/runtime/ops_workdir/message-identity-prepare-phases-20261103.json)。复制 xiayu 三个会话根（含会话树）与布局标记，在独立副本依次调用实际 `upgradeWorkspaceLayout`、公开门面的 `maintainSessionDisplaySummaries` 和 `getSessionDisplayData`。使用测试运行配置；未执行完整 `repairUserWorkspace`、启动回合恢复或生产准备。

源工作区隔离登记为0。副本从布局29升级至30，七份 outbox 被拒绝并登记；同次准备的 `quarantine-retry:session-message-identity` 重试后仍拒绝这七份，最终七份原因均为 `moved=false`。启动入口存在已有隔离登记的重试机制，不能笼统声称旧迁移永不重跑；本次没有 activity 隔离登记，因此 v21 activity 阶段没有执行。

缺 `activityId` 的会话随后在摘要维护中报告 `SESSIONS_SUMMARY_PROJECTION_FAILED`，详情返回 `exists=true` 且会话 `availability=unavailable`，没有伪装为正常空消息。报告证明实际失败与不可用性；该投影错误的具体嵌套原因尚未在本次报告展开，不把它直接判为新代码缺陷。异常会话20个文件字节不变，全部197个源文件哈希不变，源隔离登记仍为0；副本已清理。O01 仍需生产处置和完整准备验证。

本轮新增回归与文档的 Prettier、测试文件 ESLint、`git diff --check` 通过；统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-disposition-quality-20261103.log)。未调整基线，未重跑全仓测试。

### O01：摘要不可用投影失败根因与协议修复（T09）

新增[错误链核查脚本](../workspace/admin/runtime/ops_workdir/message-identity-projection-causes-20261103.mjs)，通过隔离副本仓库入口捕获异常，原样重抛，不改变被测主流程。[修复前报告](../workspace/admin/runtime/ops_workdir/message-identity-projection-causes-20261103.json)显示：原始 `cause` 和投影异常 `errors[0]` 均为 `mergeCanonicalActivityTimelines` 抛出的无错误码 `TypeError: activity timeline contains a noncanonical fact`。`createSessionUnavailableReason` 按协议拒绝无法分类的异常并原样抛出，因此该 AggregateError 不代表第二次存储故障。前节“嵌套原因尚未展开”是修复前状态，现已核实。

[事件协议](../event-protocol/src/activity-timeline.js)现统一声明 `ACTIVITY_TIMELINE_ERROR_CODE.FACT_INVALID`，非法 fact 拒绝携带 `ACTIVITY_TIMELINE_FACT_INVALID`；未放宽合法性校验、补写缺失身份或新增摘要侧默认错误。摘要维护、列表、详情继续沿同一错误契约工作。

[修复后报告](../workspace/admin/runtime/ops_workdir/message-identity-projection-fixed-20261103.json)验证维护失败原因、持久化列表 unavailable 条目、详情原因一致，重复维护结果相同。异常会话20个文件及全部197个源文件哈希不变，源隔离登记仍为0，副本已清理。此为三个会话根和布局标记的限定副本、测试运行配置，不能替代完整停服恢复演练。

[协议回归](../event-protocol/__tests__/activity-timeline.test.js)覆盖缺失身份、非法 sequence、null 的明确错误及输入不变；[摘要回归](../agent/__tests__/session/session-display-summary-canonical-source.test.js)在规范会话读取边界注入损坏 activity，验证重复维护、列表/详情明确不可用、健康会话可读以及输入和 manifest 字节不变。该自动化用例不冒充真实历史存储，真实 checkpoint 链由上述副本演练覆盖。两项专项 **13/13**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-projection-regression-20261103.log)；事件协议全量及相关摘要、activity 迁移回归 **225/225**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-projection-related-20261103.log)。

统一质量门禁 **49/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-projection-quality-20261103.log)；未调整基线或新增豁免，未重跑全仓测试。

T09 关闭实现缺口；V05 原始样本对应关系、O01 存量身份处置、O02 完整停服恢复及 O03 生产清理仍未完成。未修改生产会话、停服、发布或提交。

## O01 逐会话处置方案与 O02 恢复演练准备

### O01：逐项基线与处置决策

[只读预检脚本](../workspace/admin/runtime/ops_workdir/message-identity-operation-preflight-20261103.mjs)从既有存量报告选取七份 outbox 拒绝项，与 T09 副本报告的隔离路径逐项匹配，再加入 activity 异常会话；不按目录名重新猜测异常类型。[逐会话处置基线](../workspace/admin/runtime/ops_workdir/message-identity-operation-preflight-20261103.json)是本方案准确路径清单，保存原证据报告哈希、每项下一步及会话内逐文件路径/大小/SHA-256。共 **8份会话、130个文件**，两次顺序读取哈希一致；这是只读基线，不是原子快照、完整备份或新的协议全量扫描。后续执行引用该清单，不在文档重复维护八组路径。

| 逐项范围                   | 当前处置建议                                                                                                   | 正式准备中必须记录的结果                                                                                                       | 关闭条件                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 清单中七份 outbox 拒绝会话 | 保留全部原始文件，沿正式版本链拒绝与登记；不推断 consumerId，不删除 attempt、清空 outbox 或人工搬目录          | 每份升级/隔离重试结果、原因文件与 moved 值、列表/详情可用性、是否被活动回合恢复选中及其结果；任何额外写入逐文件归因            | 完整副本及获授权生产准备的逐项结果可核验；仍缺消费者身份时继续登记为未恢复，不用布局30或原因文件销账 |
| 清单中 activity 异常会话   | 保留源事实，沿协议明确呈现 unavailable；恢复身份必须有权威来源，不能使用 eventId 或 presentationMessageId 替代 | 维护、列表、详情保持 ACTIVITY_TIMELINE_FACT_INVALID；重启恢复不选中 unavailable 会话；checkpoint、journal、outbox 等源事实不变 | 不可用状态传播与故障隔离验收完成可单独记录；身份恢复或最终留存决定未完成时，O01 仍开放               |

每项执行顺序为：停写后复核清单哈希 → 从同一份完整备份创建独立演练工作区 → 运行下节完整入口 → 对照该项源文件基线和阶段报告 → 归档结果。出现新异常、新路径或哈希变化时重新核实，不把它纳入旧结论。七份 outbox 的既有证据只证明迁移拒绝，不证明详情一定 unavailable、运行请求已停用或后续不会写入；上述结果须实测。原因登记不构成访问控制，不能作为允许自动恢复/继续写入坏会话的证据。

处置选择：当前证据支持“保留原始事实并明确拒绝/不可用”，不支持“身份已恢复”或“可安全删除”。若要求物理搬移、停用或永久丢弃，先核实会话树、作用域、请求准入和恢复契约，再提出独立变更；不直接调用底层 move 参数绕过会话管理。历史写者与 V05 来源仍待验证。

### O02：真实入口、写入范围与执行顺序

正式入口为 [prepareUserWorkspaces](../service/bootstrap/prepare-user-workspaces.js)，依次执行：

1. `bot.repairUserWorkspace` 经 [WorkspaceService](../agent/src/bot/workspace-infra/workspace-service.js)进入[工作区生命周期](../agent/src/workspace-lifecycle/index.js)：旧目录布局迁移、版本升级、运行目录、配置修复、模型库升级、记忆修复、资产应用。它会修改会话根外的内容，不能仅备份三份会话根。
2. `bot.session.maintainSessionDisplaySummaries` 更新派生列表及摘要；逐会话失败必须保留明确原因。
3. [recoverServiceRestartTurns](../service/bootstrap/recover-service-restart-turns.js)从列表选取 available 且有 activeTurnScopeId 的树会话，通过 `finalizeTurnSnapshot → applyTurnLifecycleEvent` 提交恢复事件。它有生命周期及 outbox 写入副作用，不是只读校验；本入口不能代替作用域会话的全部恢复证明。

演练按下表推进，报告必须区分“计划”“实际执行”“失败”。目前仅完成准备，不声称下列步骤已执行。

| 阶段                 | 操作与证据                                                                                                                                                                                                                                                                                          | 通过条件 / 失败处理                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 固定执行输入       | 登记部署代码版本及本主题未提交差异、实际 workspaceRoot、用户集合、安装插件及协议声明的 scopedSessionRoots、模板包、解析配置来源、外置存储/挂载、进程管理器和所有写者。确认备份空间、权限、恢复目标及维护窗口                                                                                        | 任何路径、写者、插件或外置事实源未核实，不能宣布准备就绪；不猜测服务名或停服命令                                                                                 |
| B 停写与完整备份     | 授权后停止服务、子进程、插件任务、定时任务及其他写者，确认不再持有写入。把受影响用户的完整工作区复制到 workspaceRoot 外的独立备份位置，包含隐藏文件、配置、记忆、附件、事件、会话树、隔离原因、历史备份和布局标记；记录路径集合、文件大小/哈希、目录、权限及链接目标。外置事实源按 A 的映射同点备份 | 两次清点一致且备份校验通过；两次一致不能替代已停写证明。遇到未映射链接、不可读文件或并发变化即停止，不排除目录来制造通过                                         |
| C 隔离完整准备       | 从 B 的完整备份建立独立 workspaceRoot，使用相同代码、模板和插件声明，所有可写路径及外部能力指向演练环境。通过正式 prepareUserWorkspaces 驱动真实 bot，保存进度、完整修复报告、摘要结果、回合恢复结果、错误原因链及逐项前后差异                                                                      | 不启动生产投递、模型请求或定时任务；无法隔离外部写入时停止该演练。不能以 upgradeWorkspaceLayout、测试替身 bot 或测试运行参数替代完整入口的验收                   |
| D 八份异常与健康对照 | 按 O01 清单逐项验收；健康树会话、agent scope 与已安装插件 scope 分别选取可用样本，用公开会话能力执行合法后续写入、重读及同命令重放，核对消息 UID、生命周期、原事件身份及投递次数                                                                                                                    | 各 scope 分别给出实际样本及断言；无可用样本的 scope 标为待验证。拒绝会话的原始事实应保持，若恢复阶段写入它们，须展开根因并停止该项验收，不笼统要求整个副本零变化 |
| E 中断与整份恢复     | 先做准备入口返回后的边界中断；再在独立子进程执行准备并于有阶段进度证据后终止，记录最后完成阶段和退出信号。确认子进程及演练写者已退出后，将受损演练工作区整体移出目标，从 B 的完整备份恢复到空目标，不能向旧目录覆盖复制；恢复外置事实源的同点备份                                                   | 恢复后的完整路径集合、字节哈希及元数据与 B 一致，额外文件为0；不是从迁移的逐文件备份拼接。阶段间中断不冒充文件写入中断；后者另由既有进程故障回归覆盖             |
| F 恢复后重跑与复审   | 从恢复目标重跑完整准备，再次验证异常原因、健康读写及同命令重放；保留两次阶段报告和差异，说明时间戳、原因登记等允许变化的职责来源                                                                                                                                                                    | 不仅以布局号、计数或进程退出0判断幂等；身份、事件和投递不重复，未新增故障。所有样本、报告、备份可定位后，才具备申请生产操作的证据                                |

工作区变更锁位于 `${workspaceRoot}.mutation-locks`（见生命周期源码），在用户工作区之外；必须核实其持有进程，不把锁目录当作会话事实恢复，也不在活写者存在时强删。备份与报告置于备份源外，避免递归包含自身。恢复演练只替换演练目标；生产回滚必须另行授权，并说明恢复点后写入的保全方案。

部署输入的后续只读核实见下节，已取得宿主 PM2、配置路径和启动插件证据，但尚未穷尽全部写者与外部资源，未取得同点完整备份或独立演练 bot。O03 的22份缓存可作为 B 之后的独立演练步骤，不混入 O01 的异常事实处置；生产删除仍单独授权。

### 本轮准备工作的验证

正式启动准备、工作区生命周期、生命周期 outbox 恢复的既有回归 **37/37**，失败/取消/跳过均0，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-operation-readiness-regression-20261103.log)。这些测试支持入口和恢复边界的代码判断，不替代真实完整停服演练。两份文档格式、差异检查及156个本地链接目标检查通过。

统一质量门禁本轮 **47/49**，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-operation-readiness-quality-20261103.log)：`deepNestingCount=250` 低于基线252，`rawTypeof=426` 低于基线427，须收紧；同时 `fallbackChain=248` 高于基线247，须核查新增链。工作树存在并发修改，本轮只改两份文档及 workspace 内核查产物，未改生产源码、质量基线或豁免，不将失败笼统归为“仅需收紧”。全仓测试未重跑；V05、O01–O03 仍开放，未停服、执行生产清理或提交。

### 部署输入补证与演练隔离映射

[部署输入核查脚本](../workspace/admin/runtime/ops_workdir/message-identity-deployment-inputs-20261103.mjs)已实际执行，[报告](../workspace/admin/runtime/ops_workdir/message-identity-deployment-inputs-20261103.json)为准确进程、路径、manifest 哈希、启动日志位置和链接目标的单一清单。脚本只输出白名单元数据；读取进程环境及全局配置但不保存凭证或原始内容，不激活插件、不启动 bot、不控制进程。以下结论来自该次实时观察，不是停写证明。

- **执行视角**：宿主服务 PID 1089952 的父进程为仓库 `.pm2` 守护进程，服务与当前工具的挂载命名空间相同。另一组 PM2 使用 `/var/lib/noobot-e2e/pm2`；其服务、代理的环境虽声明相同工作区字符串，挂载命名空间及工作区 inode 不同。不能混用两组数据或停止任意同名进程来代替确认目标。宿主 admin 工作区还有常驻 Python 进程，其写入职责待验证；清单不等于全部写者已枚举。
- **有效路径证据**：按全局配置路径协议和宿主服务环境解析配置，`workspace_root` 与进程环境一致，模板指向仓库 `user-template/default-user`。配置及两个启动日志读取前后哈希一致。环境与配置一致不证明整个工作区已冻结，也不证明进程内配置从未热更新。
- **版本边界**：启动上下文及插件生命周期记录的 `process.pid` 对应宿主服务，时间与独立 `ps` 启动时间核对一致。该次启动记录的 character、harness、workflow 均为 **4.4.2**，磁盘三个 manifest 均为 **4.4.3**。这证明启动记录与当前磁盘版本不同，不推断运行中每个模块的确切字节或历史写者。实际 scoped roots 由公开插件声明收集能力及工作区协议取得，不加载插件模块。
- **外部资源**：完整遍历当时工作区目录项，记录6条符号链接，其中2条 `SingletonSocket` 指向工作区外的 `/tmp` Unix socket，目标 `stat` 成功。当前调用者网络命名空间的 Unix socket 表没有匹配项，fd 检索未定位持有者；不能据此认定浏览器正在运行、已经退出或链接可删除。进程读取的 ESRCH/ENOENT 与 fd 检索错误均保留，其他命名空间、配置内容引用的资源和模板链接未穷尽。

| 演练输入                     | 固定及隔离要求                                                                                                                                                           | 尚缺证据                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 代码与插件                   | 分别固定源运行版本、目标代码和全部未提交差异；以启动生命周期记录核验目标插件版本，不能将当前 manifest 当作源运行版本                                                     | 源运行代码字节快照、目标完整代码清单                              |
| 工作区与配置                 | 使用独立 `NOOBOT_GLOBAL_CONFIG_PATH` 和 `NOOBOT_WORKSPACE_ROOT`，由现有配置构建器消费；配置与环境必须通过既有一致性检查                                                  | 演练配置产物及全部可写路径核验                                    |
| 模板与 scoped roots          | 固定完整模板及插件声明；通过公开协议解析 roots，健康样本逐 scope 验收                                                                                                    | 模板链接/外部依赖及真实样本固定                                   |
| 浏览器资源                   | 完整备份保留链接本身，不追随链接把 socket 当作普通文件复制；停写证明覆盖关联浏览器及其他持有者。演练浏览器通过既有生命周期使用独立 profile 和 socket，禁止连接源环境目标 | 原持有者、网络命名空间、停写及独立 profile 验证；不删除源锁或链接 |
| 连接器、模型、任务与外置存储 | 沿正式能力协议建立独立环境及明确资源映射；启动真实 bot 前逐项验证，不另设跳过恢复或兼容入口                                                                              | 外部资源完整清单及实际隔离配置                                    |

统一质量门禁已重新执行 **49/49**，见[本次日志](../workspace/admin/runtime/ops_workdir/message-identity-readiness-followup-quality-20261103.log)。独立复杂度与兜底链检查同样通过，`deepNestingCount=250`、`fallbackChain=247`、`rawTypeof=423`；此前248的超标在当前工作树未复现。工作树已有基线收紧等其他改动，本轮未修改它们，不归因或重做已经通过的修复。上述47/49保留为前一轮记录，不代表当前结果。本轮仅新增只读核查产物及更新两份文档，未修改生产源码、生产存量或配置；全仓测试未重跑。

本次最终检查：两份文档及核查脚本格式、脚本 `node --check`、`git diff --check`、报告关键断言和166个本地链接目标检查通过。报告断言仅核实所记录的进程、版本、链接及哈希证据，不替代完整恢复验收。

后续代码固定及隔离入口核查见下节。V05 来源对应关系、O01 生产处置、O02 完整演练和 O03 正式清理均保持开放；未停服、删除、部署或提交。

### 目标代码快照与 headless 隔离契约核查

[输入固定脚本](../workspace/admin/runtime/ops_workdir/message-identity-input-freeze-20261103.py)已执行，[本轮报告](../workspace/admin/runtime/ops_workdir/identity-input-freeze-20261103T163901756438Z/report.json)为快照路径、HEAD、逐项清单、模板目录项及进程观察的准确来源。

- **目标代码**：归档3401项 Git 跟踪及未忽略的未跟踪路径，保留删除状态、文件模式和符号链接；逐项验证 tar 内字节，并核对归档前后清单、源码哈希、HEAD 和 Git 状态一致。归档31006720字节，含当时已有未提交修改，另保留差异及状态；不推断改动作者或任务归属。快照固定的是采集时点输入，本节后续文档更新未包含其中。忽略文件、生产配置、安装依赖和构建输出不在归档范围，不能称为可直接运行的完整部署包。
- **源运行代码**：仍未固定。4.4.2 启动记录不能证明内存模块字节等于某个 Git tag，也不能用当前4.4.3磁盘快照替代；尚不能宣称可恢复到原运行字节。源部署包或启动时不可变发布清单待补证。
- **写者观察**：报告中的两个可写描述符属于宿主服务，路径均指向本次会话工具执行的 stdout/stderr。常驻 Python PID183409 的命令模块已确认为 `http.server`；这只证明入口，不能证明全部写者已穷尽。10项读取错误为9项 process ENOENT 和1项 fd ENOENT，逐项保留，未当作成功读取；没有打开可写描述符不排除后续打开、mmap、定时任务或远端写入。
- **外置 socket 与模板**：读取22个可访问网络命名空间的 Unix socket 表，未匹配两条既有 socket 路径，仍未定位持有者，不能据此删除链接或宣布浏览器停写。模板遍历7个目录项，未发现符号链接，文件哈希见报告；这是实时目录清点，不是模板原子备份或外部资源全量映射。

既有 [createHeadlessRuntime](../service/bootstrap/create-headless-runtime.js)可以构造真实 bot，但它不是只读预检：按顺序应用 `startupContext.runtime.env`、写启动事件、调用 [upgradeGlobalModelLibrary](../service/bootstrap/upgrade-global-model-library.js)，随后通过配置构建器及插件运行包创建 bot，并注册连接器。模型库升级可能在全局配置旁写备份并替换配置文件，早于工作区路径一致性断言。演练不另设跳过这些步骤的入口；启动前必须完成下列输入隔离：

| 契约输入                                    | 核实结果与演练要求                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--startup-context`                         | 由 [startup-context-service](../service/services/startup-context-service.js) 归一化；`runtime.env` 会覆盖进程环境，须核验覆盖后的最终路径。`paths.backendRoot`、`paths.pluginRootDir` 和 `runtime.cwd` 必须指向固定演练代码，不能默认沿用源启动上下文。 |
| `NOOBOT_GLOBAL_CONFIG_PATH`                 | [配置源](../service/services/global-config-source.js)通过既有路径协议解析；必须指向独立可写配置，连同旁侧模型库备份路径一起隔离。不能等工作区断言失败后才阻止生产配置写入。                                                                             |
| `NOOBOT_WORKSPACE_ROOT` 与 `workspace_root` | 启动事件依赖运行环境，须在调用 headless 前就指向演练根；配置经既有构建器归一化后，由 [workspace-path-service](../service/services/workspace-path-service.js)核验与环境一致。此断言不能代替前述全局配置隔离。                                            |
| `workspace_template_path`                   | 指向独立固定模板；现有7项清点尚不等于模板备份或完整运行依赖固定。                                                                                                                                                                                       |
| 插件、连接器与外部能力                      | headless 会装配真实插件包并注册内置连接器。调用返回不能作为未产生外部副作用的证明；须核实插件激活链、连接器访问、模型端点、任务及网络隔离，再接正式 `prepareUserWorkspaces`。                                                                           |

启动上下文、工作区路径一致性及正式准备入口既有回归本轮 **21/21**，失败/取消/跳过均0，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-freeze-contract-tests-20261103.log)。没有调用 headless、启动 bot 或执行完整恢复。本轮新增的代码快照和观察报告不替代停写证明；下一步补齐源部署包、安装依赖及原生工具的固定输入，并沿上述契约形成实际隔离配置。V05、O01–O03 继续开放。

### 2026-11-04 依赖固定与真实 bot 隔离初始化

[输入及初始化脚本](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-20261104.py)、[实际入口驱动](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-runner-20261104.mjs)与[重试脚本](../workspace/admin/runtime/ops_workdir/message-identity-isolated-retry-20261104.py)已执行。文件清点和 SHA-256 统一使用[证据模块](../workspace/admin/runtime/ops_workdir/identity_evidence_files.py)。[成功报告](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/retry-20261104T015732613422Z/report.json)是本次结果及实际写入清单的权威来源；[输入目录](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/report.json)保留首轮失败报告，不以重试覆盖失败结果。

- **代码与依赖**：重新核对既有代码归档 SHA-256，解包固定目标；[当前与固定版本差异](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/current-vs-frozen.json)记录35条既有清单路径发生变化，新增路径另见同目录 Git 状态。本次运行的是此前固定代码，不能把结果外推到当前工作树。复制并核验14个已安装依赖根、55200个文件/目录/链接项，逐项保留模式、链接或文件哈希；清单见[安装依赖](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/installed-dependencies.json)。依赖副本与源两次读取一致，重试前后依赖副本仍与清单一致；这固定当前磁盘输入，不证明源进程加载的依赖字节。模板7项完成独立复制及前后核验，Node 可执行文件也已复制并校验。宿主系统库仍通过只读 `/usr` 提供，尚非可移植完整部署包。
- **源部署证据**：[源进程观察](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/source-observation.json)记录宿主服务及两个代理的挂载命名空间、Node 可执行文件和映射文件磁盘哈希。JavaScript 模块缓存不在该证据范围，映射文件当前磁盘哈希也不能证明进程映射页相同；原启动部署包、不可变发布清单及源运行 JavaScript 字节仍待取得，不能用目标4.4.3归档替代源4.4.2启动记录。
- **实际隔离配置**：[启动上下文](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/startup-context.json)与[全局配置](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/state/global.config.json)使用独立代码、模板、工作区及 HOME。全局配置来自固定代码的公开示例，仅明确设置演练工作区、模板与空 `mcp_servers`；未复制生产凭证。模型配置仍由既有构建器读取，网络命名空间阻断外部访问。没有启动 HTTP 服务、模型回合或任务调度器。文件系统仅挂入演练输入和只读系统工具，宿主工作区不挂入；两条 PM2 绝对链接通过原仓库路径到固定副本的明确别名解析，未改写链接或增加实现分支。135条执行链接均在沙箱中校验解析目标。
- **失败与修复**：首轮输入校验拒绝 PM2 宿主绝对链接，随后建立明确映射；沙箱首轮运行又因临时根目录可写被探测阻止，尚未调用 headless。增加根挂载只读后，[第二次失败](../workspace/admin/runtime/ops_workdir/identity-isolated-init-20261104T015204412776Z/retry-20261104T015437940688Z/report.json)确认代码和根目录写入均为 `EROFS`、测试网络为 `ENETUNREACH`、两条源浏览器 socket 为 `ENOENT`，但 headless 构造前因运行参数未初始化失败。沿[正式服务入口](../service/app.js)使用 `resolveConfiguredWorkspaceRoot → initializeRuntimeParams` 补齐驱动顺序后成功；未修改生产实现、放宽断言或跳过正式准备。
- **真实初始化与写入**：真实 `BotManager` 构造成功，公开插件运行包声明两个 scoped roots；`prepareUserWorkspaces` 连续两次返回 `userCount=1`、失败0、摘要重建0、回合恢复0。本次无存量会话，进度列表为空，不证明坏会话恢复、健康后续写入或迁移重跑。持久差异包括全局工作区配置参数、admin 配置/记忆/模板资产/布局状态、空会话树与摘要、启动事件，以及工作区旁侧 `workspace.mutation-locks` 目录，均位于独立 state 挂载内。不能只备份 workspace 子目录而遗漏此旁侧锁目录的隔离归属。全局配置前后字节不变，没有模型库备份文件：此次调用经过模型库升级入口，但未实测其改写分支。`/tmp` 为独立临时挂载，退出时销毁，未做系统调用审计或逐个临时文件写入追踪。
- **生产边界**：生产全局配置、两个 lockfile 及逐会话清单的130个文件，共133个选定文件，重试前后 SHA-256 一致；固定依赖亦未变。这是限定文件核验，不能证明完整工作区停写、全部写者穷尽或外部资源归属。生产浏览器 socket 持有者、外置资源全量映射、原生工具固定与完整同点备份继续待验证。

下一步须取得可证明源运行字节的部署包/清单，补齐生产写者和外置资源归属，并把本次已验证的初始化隔离映射用于完整停写副本；随后逐会话验证、健康后续写入、中断整份恢复与重跑。V05、O01–O03 保持开放；本次没有停服、生产数据处置、正式清理、部署或提交。

最终验证已读回日志：[相关回归](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-regression-20261104.log) **31/31**，失败、取消、跳过均0；[最终质量门禁](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-quality-final-20261104.log) **49/49**。此前[独立死代码检查](../workspace/admin/runtime/ops_workdir/message-identity-isolated-init-dead-code-20261104.log)实测 `unusedDependencies=29`，因低于旧基线30失败；[死代码门禁](../scripts/check-dead-code.mjs)已按实测收紧至29，最终门禁通过，未新增豁免。上述结果仅证明对应日志记录的检查通过，初始化结论仅适用于固定代码和空白工作区；本次未重跑全仓测试。

### 2026-11-04 存量限定副本与独立进程重启验证

[副本脚本](../workspace/admin/runtime/ops_workdir/message-identity-stock-isolated-20261104.py)沿既有证据清单复制 xiayu 的三个会话根和布局标记；源、目标及复制后再次读取一致，八份异常会话仍符合原130文件基线。用户发现依赖 `user.json`，通过既有 `createWorkspaceUsersService.writeWorkspaceUsersConfig` 写入独立演练用户，不复制生产连接码。其余配置沿用前节已验证沙箱，生产目录未挂入。只运行真实 bot 的正式准备及列表详情读取，没有启动 HTTP、模型回合或调度器；这是在线限定副本，不是完整工作区或停写备份。

[首个成功批次](../workspace/admin/runtime/ops_workdir/identity-stock-isolated-20261104T032529760694Z/report.json)退出0，首轮准备报告七份 outbox 在升级及同轮隔离重试中各拒绝一次，另有一份 activity 错误；次轮仅报告 activity 错误。七份 outbox 的列表和详情均为 `available`，不代表消费者身份有效、异常修复、会话停用或可以恢复后续写入。activity 会话两轮列表及详情均为 `unavailable`，原因一致为 `ACTIVITY_TIMELINE_FACT_INVALID`。两轮摘要重建与回合恢复均0，不能据此验收健康写入或活动回合恢复。

[独立重启脚本](../workspace/admin/runtime/ops_workdir/message-identity-stock-restart-20261104.py)与[重启成功报告](../workspace/admin/runtime/ops_workdir/identity-stock-isolated-20261104T032529760694Z/restart-20261104T032812766985Z/report.json)确认：新进程首轮再次报告七份 outbox 隔离重试拒绝及一份 activity 错误，次轮仅一份 activity 错误。固定代码 `sections.js` 的 `retriedQuarantines` 按进程、工作区及 owner 去重，解释同进程次轮差异；不得以次轮缺少失败项认定历史异常已消失。七份原因文件仍为 `moved=false`；八份会话130个原文件、133个选定生产文件、三个源会话根清单及固定依赖清单均未变。列表摘要与详情按各自契约仅比较会话身份、可用性及不可用原因，不要求含消息正文的详情与摘要对象整体相等。

失败证据保留：`identity-stock-isolated-20261104T032403577312Z` 在 bot 启动前因只读父目录下无法创建基线挂载点失败，报告复制遗留的 `initialization.ok=true` 无效，不能作为本次执行结果；后续每批删除复制的旧结果，只读取本次产物，改为独立只读 `/stock-input` 挂载。`identity-stock-isolated-20261104T032446535004Z` 在用户发现断言失败，正式准备未执行；补齐协议用户清单后成功。首个重启批次因驱动错误要求详情与摘要整体相等而校验失败，未判通过；修正为上述接口契约断言后新进程重跑通过。未改生产实现或增加兼容入口。

[目标复核](../workspace/admin/runtime/ops_workdir/message-identity-stock-target-check-20261104.json)逐项确认固定代码3401项与原清单一致，当前工作树的原清单路径有36项差异，新增路径另存 Git 状态；本节结果只适用于固定代码。[资源观察](../workspace/admin/runtime/ops_workdir/message-identity-resource-observation-20261104.json)重新观察三个源进程及22个可访问网络命名空间：两条目标 socket 未命中，四个工作区可写描述符均指向本次工具日志；另记录257项 ENOENT 观察错误，不把未观察到持有者当作无写者证明。限定仓库归档搜索排除 workspace、node_modules、.git、dist、build，仅命中测试路径 `trace.zip`，未建立其与源启动部署的对应关系；仓库外发布包及配置引用的外置资源未穷尽。当前 Node 磁盘哈希不能证明源运行 JavaScript 字节，源部署和全部写者继续待验证。

验收拆分：**固定目标恢复**须继续完成健康会话后续写入、活动回合、配置升级实际改写、中断后整份恢复与重跑，并最终使用已停写的完整工作区及外置事实源备份；本节只关闭限定副本中的逐项观察缺口。**原部署回滚**另须取得启动时不可变代码、插件、依赖、原生库和配置资源映射，并验证恢复点后写入保全；目标4.4.3成功不能代替源4.4.2运行字节或回滚验收。V05、O01–O03 均保持开放；未停服、处置生产数据、正式清理、部署或提交。

本节正式准备相关回归 **11/11**，失败、取消、跳过均0，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-stock-prepare-regression-20261104.log)；本轮[质量门禁](../workspace/admin/runtime/ops_workdir/message-identity-stock-quality-20261104.log) **49/49** 通过，未修改基线或新增豁免。文档格式、差异、209个本地链接目标、三个 Python 脚本语法、生成驱动语法及报告断言检查通过，结果存于演练目录 `message-identity-stock-final-validation-20261104.json`；本轮未重跑全仓测试。

### 2026-11-04 阶段中断恢复与健康树会话写入

[恢复脚本](../workspace/admin/runtime/ops_workdir/message-identity-stock-restore-20261104.py)复制上一节保留的独立沙箱 state，删除历史初始化结果后，备份整个 state。首轮真实正式准备返回时写入阶段证据并等待，宿主仅终止本次创建的进程组，退出码为 SIGKILL；确认无进程挂载继续引用本批 state 后，将中断状态整体移出，再从备份复制到不存在的目标。[成功报告](../workspace/admin/runtime/ops_workdir/identity-stock-restore-20261104T041610821314Z/report.json)确认383项路径、类型、文件字节哈希、模式与链接目标完全一致，无额外项。未核验时间戳、所有权、ACL 或 xattr；这是已完成阶段之间的中断，不是文件写入中的故障。

恢复后独立进程重跑成功，沙箱仍满足代码及根目录 EROFS、网络 ENETUNREACH、两条浏览器 socket ENOENT 和135条链接映射。首轮七份 outbox 拒绝加一份 activity 异常，次轮一份 activity 异常；列表与详情可用性及异常原因一致。130个异常原文件、133个选定生产文件及上一节沙箱 state 未变。本次完整恢复的对象仅是由在线限定副本衍生的沙箱 state，不能替代停写完整生产工作区、外置事实源或源部署回滚验收。

[健康写入脚本](../workspace/admin/runtime/ops_workdir/message-identity-stock-healthy-20261104.py)在另一份独立副本，通过公开 `bot.session` 门面验证固定树会话 `0093bf08-d2a2-4e18-a485-dbabba04802d`。树会话按协议显式传入 `persistenceScope: null`；演练生成的用户消息标记 `messageOrigin: internal`。写入后重读、同进程再次提交、独立进程重读及再次提交全部通过，[报告](../workspace/admin/runtime/ops_workdir/identity-stock-healthy-20261104T041951544677Z/report.json)确认同一 messageUid 始终仅一份，原有一条消息保持一致，详情 available。未调用模型或连接器；这是 `appendTurns` 持久化幂等验证，不是生命周期命令重放或投递次数验收。两进程准备仍分别报告8/1项异常，130个异常原文件、133个选定生产文件及前批沙箱 state 未变。

失败批次保留：`identity-stock-restore-20261104T041535002099Z` 已到阶段边界，但恢复前挂载检查读到僵尸进程的 mountinfo EINVAL 而中止；核实其 stat 为 Z 后，检查明确记录已退出进程，其他活进程的读取错误仍阻断恢复。健康批次 `identity-stock-healthy-20261104T041733620737Z` 遗漏必填持久化作用域，`identity-stock-healthy-20261104T041825899840Z` 遗漏用户消息来源，均为驱动输入错误；`identity-stock-healthy-20261104T041912514191Z` 首进程写入成功，但写入改变列表顺序，第二进程按首项选错样本而断言失败。修正为固定已核实的会话 ID 后新批次通过，未改生产实现或放宽协议。

本节相关回归 **28/28**，失败、取消、跳过均0，见[日志](../workspace/admin/runtime/ops_workdir/message-identity-stock-followup-regression-20261104.log)；[质量门禁](../workspace/admin/runtime/ops_workdir/message-identity-stock-followup-quality-20261104.log) **49/49**。未修改生产实现、基线或豁免，未重跑全仓测试。

剩余验收：agent/plugin scope 健康样本、活动回合恢复、生命周期及投递不重复、配置升级实际改写、生产停写同点完整备份与恢复，以及源部署、全部写者和外部资源证据仍待完成。V05、O01–O03 保持开放；未停服、处置生产数据、正式清理、部署或提交。

### 2026-11-04 活动回合重启收敛、配置改写与 scoped 样本核查

[演练脚本](../workspace/admin/runtime/ops_workdir/message-identity-stock-branches-20261104.py)沿用固定目标代码、依赖及既有 bwrap 隔离入口，在新的独立 state 中运行两个真实 bot 进程。[成功报告](../workspace/admin/runtime/ops_workdir/identity-stock-branches-20261104T044610311978Z/report.json)确认两进程的根目录与代码写入均为 EROFS，网络 ENETUNREACH，两条源浏览器 socket ENOENT，135条执行链接映射通过。130个异常原文件、133个选定生产文件及前批沙箱 state 未变；未穷尽全部生产文件或写者。

- **活动回合**：在既有健康树会话的独立副本上，通过公开生命周期接口构造接受及 processing-started，首进程退出前确认活动回合存在。第二进程正式准备的恢复数为 **1/0**；快照显示活动回合清空，指定回合收敛为 `processing_failed`，failure code 为 `service_restart_orphaned_turn`。这是执行丢失后的明确失败终态，不是恢复模型执行或成功完成业务。跨进程重放原接受命令返回 applied=false，整个会话对象不变；未验收消费者投递次数。
- **配置改写**：仅对演练配置删除 `model_library_version` 构造旧版本输入，经真实 headless 初始化改写配置，旁侧仅生成一份模型库备份，其哈希等于升级前字节；第二次启动配置哈希不变、没有新增备份。此结果覆盖配置改写与备份路径，不代表源生产配置确实需要同一迁移。
- **scoped 样本**：四份既有 agent 会话均可通过 scoped bundle 读取；树详情接口按契约不展示这些会话。逐项公开写入检查确认其父会话均已登记删除，appendTurns 返回 `SESSION_DELETED`，原消息不变。workflow 插件会话目录为空。因此 **agent/plugin 健康写入尚未验收**，没有重建父会话或绕过删除保护。

失败批次保留在 `identity-stock-branches-*`：`044146995265Z` 误用树详情接口；`044237256129Z` 首次写入触发父会话删除保护；`044351837916Z`、`044443900508Z`、`044534964677Z` 分别遗漏快照恢复回调、knownSequence、commandId。均为驱动输入或样本选择问题，修正为完整快照契约及逐项拒绝验证，没有修改生产实现或放宽协议。首次直接 node --test 未初始化运行参数而失败，原日志保留；使用仓库既有隔离测试入口复跑后，相关回归 **30/30**，失败、取消、跳过均0，见[最终日志](../workspace/admin/runtime/ops_workdir/message-identity-stock-branches-regression-final-20261104.log)。本轮[质量门禁](../workspace/admin/runtime/ops_workdir/message-identity-stock-branches-quality-20261104.log) **49/49**，未改基线或豁免，未重跑全仓测试。

本轮文档格式、差异、221个本地链接目标、Python 及生成驱动语法检查通过；报告断言复核了失败终态、重复接受不改会话、两进程隔离及配置备份等结果，记录于演练目录 `message-identity-stock-branches-final-validation-20261104.json`。

剩余验收：可写 agent/plugin 存量样本、消费者投递不重复、生产停写同点完整备份与恢复、源启动部署包及原生库、全部生产写者和外置资源映射。活动回合及配置为显式演练输入，结论限定于固定目标。V05、O01–O03 保持开放；未停服、处置生产数据、正式清理、部署或提交。

### 2026-11-04 新建 agent/plugin scoped 样本跨进程写入

[演练脚本](../workspace/admin/runtime/ops_workdir/message-identity-scoped-fixtures-20261104.py)在限定副本的独立 state 中，通过公开 `createSession`、`appendTurns`、`getSessionBundle` 接口新建两份显式演练样本，分别落在插件声明的 agent 与 workflow 会话根，父会话为副本中可写的既有健康树会话。[报告](../workspace/admin/runtime/ops_workdir/identity-scoped-fixtures-20261104T045249144244Z/report.json)确认两个真实 bot 进程中的同进程重复提交和跨进程重放后，每份样本的新增 messageUid 始终只有一份，原消息一致；默认会话根无影子目录，父会话及会话树未变。未修改四份已删除父会话的存量样本或删除登记。

两进程均验证根目录与代码 EROFS、网络 ENETUNREACH、两条源浏览器 socket ENOENT、135条执行链接映射。130个异常原文件、133个选定生产文件及前批沙箱 state 哈希未变。此结果证明固定目标代码的新建 scoped 会话持久化与消息去重，不证明存量 scoped 恢复、插件业务执行或真实消费者投递。

本轮[相关回归](../workspace/admin/runtime/ops_workdir/message-identity-scoped-regression-20261104.log) **11/11**，失败、取消、跳过均0，覆盖 scoped 仓库及 outbox 尝试/确认事务；测试中的确认去重不代替真实消费者投递验收。[质量门禁](../workspace/admin/runtime/ops_workdir/message-identity-scoped-quality-20261104.log) **49/49**。未修改生产实现、基线或豁免，未重跑全仓测试。存量可写 scoped 样本、真实投递、生产停写完整恢复、源部署、全部写者及外置资源仍待验收，V05、O01–O03 保持开放。

## 2026-11-02 历史核查

## 范围与方法

扫描脚本见 [v05-readonly-audit.mjs](../workspace/admin/runtime/ops_workdir/v05-readonly-audit.mjs)，逐会话结果见 [v05-readonly-audit.json](../workspace/admin/runtime/ops_workdir/v05-readonly-audit.json)。扫描覆盖仓库 workspace 下具有 runtime 的 admin、admin1、system、xiayu 目录；不扫描备份、隔离目录和归档。

根目录由 `WORKSPACE_LAYOUT.SESSION_DIR` 与 `resolveScopedSessionRoots` 结合当前仓库插件 manifest 声明取得：`runtime/session`、`runtime/agent/session`、`runtime/plugin-data/workflow/session`。该范围不包含运行环境中仓库外的插件安装目录，也不把旧 `runtime/subagent` 自动当作当前权威根。

会话使用生产 `readSessionArtifact` 读取 manifest、checkpoint 和 journal，随后调用公开 `assertSessionMessageRecordIdentity`。outbox 直接读取字节，经 `assertAuthorityOutboxJournalRecord`、`projectAuthorityOutboxJournal` 和 `parseAuthorityOutboxCheckpoint` 校验，避免调用取得 mutation 锁的读取入口。摘要详情通过生产 `hydrateSessionSummaryDetails` 检查引用与内容哈希。

扫描复用仓库 `shared/testing/runtime-params.js` 初始化运行参数；这仅为离线核查提供可执行环境，不宣称使用了生产运行参数。注入的 storage 写方法明确拒绝执行；扫描各根前后比较全部常规文件的 SHA-256。报告中的文件不含会话正文。

## 结果与处置

- 共核查 **59** 份会话；所有会话读取及消息身份校验通过。
- **7** 份 xiayu 会话的 outbox 被拒绝，直接原因是 attempt 记录缺少 `consumerId`。具体路径见 JSON 报告；不能由后续 ack 的消费者反推 attempt 归属。
- 扫描未触发 storage 写入，扫描前后文件变化为 **0**。这是本次观察范围的结果，不保证跨文件原子快照。
- 布局标记：admin 为 **30**，xiayu 为 **29**，admin1/system 未发现标记。标记不代替内容校验。
- 本次“summary 与 colocated manifest 缺失”候选为 **0**。这不是所有孤儿缓存类型的数量，也未验证每份缓存的 revision 新鲜度、无引用 detail、跨目录读取关系或可重建性。

当前 outbox 写者在 append 前执行协议断言，`authorityOutboxRecordsFromOutbox` 明确写入每个消费者身份。尚无证据证明这七份存量由哪个历史写者产生，不据当前代码推断历史成因。

核查暴露了升级阶段的漏校验：`migrateOutboxRecord` 原先直接返回非 commit 记录，最终验证重复同一入口，因而不能拒绝缺消费者身份的 attempt。本轮改为所有记录均经公开 outbox 协议断言；commit 在完成身份迁移后校验，其余记录原样校验。协议拒绝进入既有逐会话隔离，保留 cause，不猜测或补写身份。回归覆盖坏记录隔离、源 outbox 字节不变和健康 scoped 会话继续升级，专项 **10/10**。

摘要缓存有生产读取依赖：`ensureSessionDisplaySummary` 先读取当前缓存，失效后从会话事实重建；`hydrateSessionSummaryDetails` 从 summary 的引用读取详情并验证哈希，写入者清理未引用详情。不能按文件名或历史“20 份”登记直接删除缓存。

## 当前工作树复验

升级漏校验修复后的当前工作树全仓测试通过，`PASSED exit=0`，见[全仓复验](../workspace/admin/runtime/ops_workdir/v05-all-current.log)。当前质量门禁 **48/48**，见[质量复验](../workspace/admin/runtime/ops_workdir/v05-quality-current.log)，rawTypeof **432**、unusedExports **91** 均等于既有基线，未放宽门禁或新增豁免。model-proxy 工作区专项 **18/18**。

这些验证证明当前代码和测试通过，不会改写七份损坏 outbox。历史档案仍只有“8 条空 identity.messageId 复核”的登记，未提供原始八条数据路径与版本；七份 outbox 消费者身份缺失不能代替八条消息身份样本。

## 剩余边界

以上为2026-11-02时的剩余边界；2026-11-03 已补充八条候选、重新扫描及限定副本演练，并修复当前 schema 的升级隔离路径，最新状态见本报告首节与任务清单。生产操作边界不变。
