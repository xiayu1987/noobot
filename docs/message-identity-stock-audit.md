# 会话存量只读核查

本报告记录 2026-11-02 的仓库工作区核查，不代表生产全量合规或已完成升级。历史八条空身份原始样本仍缺失，V05 保持开放。

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

V05 仍缺历史八条样本或其可追溯来源。O01 需要在正式部署准备时针对实际安装插件范围复核，并处理上述七份拒绝；O02 仍需同一时点备份和隔离副本升级演练；O03 仍需建立完整读取依赖和可重建证据后形成准确删除清单。本轮未升级、删除、停服或重启生产存量。
