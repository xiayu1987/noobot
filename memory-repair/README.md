# `@noobot/memory-repair`

这个包是唯一允许解释历史记忆文档格式的地方，职责与 `@noobot/session-repair` 相同：把旧文件显式、确定性地迁移到 `@noobot/memory-protocol` 的当前协议。运行时读取方只校验当前协议，不做任何兼容解析。

## 入口

- `migrateMemoryDocument({ kind, text })`：迁移单个文档，返回 `{ status, text }`。
  - `canonical`：已符合当前协议，不需要写入。
  - `migrated`：命中确定性的旧格式规则。经验模型和元数据去掉旧标题行后补协议头；日/周/月/年小结直接补协议头。
  - `reset`：没有确定性规则（例如旧格式长期记忆），返回 `@noobot/memory-protocol/defaults` 生成的默认文档。
- `repairMemoryWorkspace({ layout, io })`：修复一个工作区的全部记忆文档，返回修复报告。
  - 缺失的文件按协议默认值生成，状态为 `created`。默认内容只来自 memory-protocol，不读取任何模板文件。
  - 符合协议的文件从不写入，修复是幂等的。
  - 任何改写或删除之前，原文先经 `io.writeBackup` 备份。
  - `layout.obsoleteFiles` 列出的废弃文件（如 `long-memory-model.md`）备份后删除。

本包只依赖 `@noobot/memory-protocol`，不做任何 IO；`io` 由调用方注入。

## 调用位置

唯一调用方是 Agent 的工作区生命周期：`agent/src/workspace-lifecycle/sections.js` 的 `repairMemorySection` 经 `agent/src/memory/storage/repair.js` 注入 IO，备份写到 `runtime/memory-repair-backups/<时间>/`。创建、修复、同步、重置四个操作都会执行这一步；客户端用户工作区（`userData/workspace/<user>/`）同样在初始化时修复。

运行测试：`npm run -w @noobot/memory-repair test`
