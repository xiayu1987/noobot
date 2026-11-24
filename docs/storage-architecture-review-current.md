# 当前存储架构复核：2026-11-24

本次以现有工作树为准，保留其已有存储重构改动。本文补充 `storage-architecture-audit.md` 的后续证据，不代表全架构完成、生产数据验收或部署结果。

## 已复现并修复：Outbox 读写完整性校验不一致

读取端 `readPartitionOutboxEvent` 经 `requireCommittedEventPosition` 核对事件 ordinal 不超过已提交 outbox tail，并要求 `eventOrder[ordinal]` 指向该事件。写入端 `readDeliveryTargets` 原先只检查事件记录、归属、轮次和投递可见性，没有检查已提交位置。位置索引已经指向其他事件时，投递尝试与确认仍可发布，连带发布同批标题修改。

新增两项回归分别覆盖 attempt 与 acknowledge，修复前均因“未拒绝提交”失败。写入口现复用已有位置校验函数；没有新增兼容入口、重建索引或忽略损坏数据。修复后两项均通过，同时验证混合事务不发布、journal head 不变、关闭报告损坏、冷重启仍保留原 head 和损坏事实。已有快照隔离及冷重放用例一并通过。

- 实现：`agent/src/session/partition-storage/partition-outbox.js`。
- 回归：`agent/__tests__/session/partition-outbox-event-reader.test.js`。
- 格式及持久化布局不变；发现已损坏的位置索引时，现在拒绝投递写入并报告 `SESSION_STORAGE_CORRUPT`。

## 已量化但未修复：执行查询随无关会话增长

`ExecutionReadService._query` 调用 `listExecutionSessionScopes`，逐个打开所有发现的会话；`readPartitionExecutionSource` 读取该会话完整 lifecycle 键集。单页限制约束每批读取，不限制查询总工作量。

使用现有 `partitionRepositoryPerformanceFixture`、`observeStorageIo` 和隔离测试入口，对同一已接受执行查询；额外会话为空，每次查询前关闭并重新创建 Session runtime，驻留 journal 上限为 1。此处“冷读”指应用 runtime 重开，不代表清空操作系统页缓存。

| 总会话数 | 打开的会话读取器 | 文件打开调用 | 读取字节 | 同步调用 | 写入字节 |
| -------- | ---------------- | ------------ | -------- | -------- | -------- |
| 1        | 1                | 29           | 7,700    | 13       | 1,403    |
| 8        | 8                | 218          | 62,133   | 104      | 10,706   |
| 32       | 32               | 866          | 421,350  | 416      | 42,624   |

全部查询均找到同一目标执行。测量包括读取快照的保留与释放开销，不能将写入量解释为业务执行状态写入，也不能据此推断设备耗时或掉电保证。测量用临时工作区在 finally 中关闭并删除。

完成这一目标需要 Session 协议明确执行 ID、直接父执行和根执行的定位事实，以及创建、替换、删除、升级和中断恢复的发布契约。定位不能复制执行状态；定位未就绪必须显式返回，不能回退到全扫描。当前尚未实现该契约与查询切换。

## 其他尚未闭环的目标

- 聊天详情：`client/noobot-chat/src/modules/session/model/list/sessionDetailRequests.js` 仍调用完整详情 API；协议分页端口存在不等于首屏分页消费已完成。
- 物理回收与组合容量：现有 Outbox 压缩处理逻辑投递可见性，不能证明物理分区回收。跨 journal、维护临时空间和恢复余量的工作区组合准入尚未验收。
- 多消费者投递范围：当前协议将某消费者缺少 delivery 记录解释为 pending，压缩资格则根据事件已有 deliveries 判定。是否需要为尚未投递的消费者保留事件，取决于未明确声明的投递范围和消费者生命周期，属于待验证的协议需求，不能据此声称已发生投递丢失或在实现中猜测消费者集合。
- 删除恢复：本轮未扩大掉电、所有类别写入者、删除记录保留和容量上限的验收范围。

## 本轮验证

- 修复前新增两项回归均失败，修复后所在文件 5 项全部通过。
- Session 协议、Event 协议、Agent Session 和相关 Authority 服务回归共 2,411 项通过，0 失败、0 跳过。命令：`node scripts/run-with-isolated-tmp.mjs node --test 'session-protocol/__tests__/*.test.js' 'event-protocol/__tests__/*.test.js' 'agent/__tests__/session/*.test.js' 'service/__tests__/routes/authority*.test.js' service/__tests__/partition-execution-authority.integration.test.js`。日志：`/tmp/noobot-storage-review-regression.log`。
- 分区服务集成补验 52 项通过，0 失败、0 跳过，包含执行读取、工作区维护及删除中断续跑。命令：`node scripts/run-with-isolated-tmp.mjs node --test 'service/__tests__/partition-*.test.js'`。日志：`/tmp/noobot-storage-review-service.log`；其中 Authority 集成与前述回归集合有重叠，不相加为独立测试总数。
- 完整质量门禁通过 49/49。第一次运行发现深层嵌套实测 215 低于基线 216，按门禁要求收紧 `scripts/check-complexity-baseline.mjs` 到 215 后复验通过；未将该下降归因于本轮 Outbox 修复。日志：`/tmp/noobot-storage-review-quality-final.log`。
- 独立测量首次未使用测试参数初始化入口而失败；改用仓库隔离入口后，获得上述三组真实数据。

未运行生产迁移、正式数据修复、部署或 Git 提交。执行定位、详情分页、持续物理回收及组合容量目标仍未完成。
