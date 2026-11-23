# `@noobot/workspace-protocol`

用户工作区结构的唯一事实源：目录布局、区段与负责方、四个生命周期操作、资产同步规则和布局迁移。只有纯数据和纯函数，不做 IO；IO 和编排只在 `agent/src/workspace-lifecycle`。

## 布局（`./layout`）

`WORKSPACE_LAYOUT` 定义所有相对路径，`WORKSPACE_LAYOUT_VERSION` 统一定义工作区布局版本。主系统、service 和插件都引用这里的常量，不再手写 `runtime/...` 字面量（由 `scripts/check-workspace-protocol-boundary.mjs` 守卫）。

- `WORKSPACE_RUNTIME_DIRECTORIES`：创建和修复时保证存在的 runtime 目录。
- `resolvePluginDataRelativePath(pluginId, ...segments)`：插件数据统一放在 `runtime/plugin-data/<pluginId>/`。
- `resolvePluginAssetsRelativePath(pluginId, ...segments)`：插件资产统一放在 `runtime/plugin-assets/<pluginId>/`。
- `isWorkspaceRuntimeRelativePath(value)`：校验路径位于 `runtime/` 下且不含 `..`。

## 区段与负责方（`./sections`）

| 区段      | 路径          | 负责方                                              | 重置前备份 |
| --------- | ------------- | --------------------------------------------------- | ---------- |
| `memory`  | `memory/`     | `@noobot/memory-protocol` + `@noobot/memory-repair` | 是         |
| `config`  | `config.json` | `@noobot/agent-config-protocol`                     | 是         |
| `runtime` | `runtime/`    | 本包布局                                            | 否         |
| `service` | `services/`   | 资产包 `user-template/default-user`                 | 是         |
| `skill`   | `skills/`     | 资产包 `user-template/default-user`                 | 是         |

`config.example.json` 已下线，作为 `config` 区段的 `retiredPaths`，存在时备份后删除。`runtime` 重置时保留 `runtime/memory-repair-backups`、`runtime/workspace-backups`、`runtime/workspace-asset-state.json` 和 `runtime/workspace-layout-state.json`。

本包只记录负责方标识，不依赖其他协议包；负责方的绑定写在 lifecycle 里。

## 四个操作

`WORKSPACE_OPERATION`：`create`、`repair`、`sync`、`reset`。lifecycle 对外入口：`ensureUserWorkspace`（修复，工作区不存在时为创建）、`syncUserWorkspace`、`resetUserWorkspace({ sections })`。

| 区段          | 创建             | 修复（每轮初始化）           | 同步（升级后）         | 重置                     |
| ------------- | ---------------- | ---------------------------- | ---------------------- | ------------------------ |
| runtime       | 建目录           | 补缺失目录                   | 同修复                 | 清空（保留项除外）后重建 |
| memory        | 协议默认值       | 校验协议头，备份后迁移或重置 | 同修复                 | 备份后按协议默认值重建   |
| config        | 协议从空文档生成 | 只修复无效项                 | 按协议完整修复         | 备份后按协议从空文档生成 |
| service/skill | 从资产包安装     | 只安装从未安装过的文件       | 按哈希规则升级（见下） | 备份后从资产包重装       |

重置备份写到 `runtime/workspace-backups/<时间>/`，每个操作内所有区段共用同一个时间戳目录。

## 资产同步（`./asset-sync`）

没有静态清单文件：lifecycle 在运行时对资产包内容计算哈希，资产包本身就是唯一事实源。上次安装的哈希记录在 `runtime/workspace-asset-state.json`（`parseWorkspaceAssetState` / `renderWorkspaceAssetState`）。

`planWorkspaceAssetSync({ operation, packageFiles, installedState, userFiles })` 返回 `{ actions, nextState }`，同步时的规则：

- 用户目录缺失：`install`（`missing`）。
- 用户文件与资产包一致：`keep`（`up_to_date`）。
- 用户文件与上次安装一致但资产包已更新：`update`（`pristine_outdated`）。
- 用户改过：`keep`（`user_modified`），不覆盖。
- 资产包里已删除、且用户没改过的文件：`remove`（`retired`）。

修复只安装从未安装过的文件；装过但被用户删除的文件不会补回，需要同步或重置。

## 布局迁移（`./layout-migration`）

`WORKSPACE_LAYOUT_MIGRATIONS` 记录布局 v0 到 v1 的目录迁移：

- `runtime/workflow` → `runtime/plugin-data/workflow`
- `runtime/harness` → `runtime/plugin-data/harness`

`planWorkspaceLayoutMigrations({ exists })` 在每个操作开始时执行：源存在、目标不存在则移动；源和目标同时存在时抛 `WORKSPACE_LAYOUT_MIGRATION_CONFLICT`，需要人工合并。

## 布局升级（`./layout-migration`）

已安装的布局版本记录在 `runtime/workspace-layout-state.json`（`parseWorkspaceLayoutState` / `renderWorkspaceLayoutState`）。没有该文件的已有工作区视为 `WORKSPACE_LAYOUT_UNMARKED_VERSION`（`1`）；新建工作区直接写入当前版本，不执行升级。

`planWorkspaceLayoutUpgrades({ installedVersion })` 返回 `WORKSPACE_LAYOUT_UPGRADES` 中高于已安装版本的步骤。本包记录步骤和负责方标识，处理函数由工作区生命周期绑定。服务启动和离线工作区命令共用升级入口。已有工作区在存储独占锁内重新读取布局版本，每成功执行一步就持久化该步的版本。v45 发布附件目录，v46 完成分区会话的权威切换。

| 步骤                 | 目标版本 | 负责方            | 内容                                                                                                                                                                          |
| -------------------- | -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-storage-v2` | `2`      | `session-storage` | 会话树以各节点的 `parentSessionId` 为唯一事实源，映射为 parent-only 结构（丢弃 `roots`/`children`）；index 不是 v2 的 `execution-events` 和版本不是当前协议的执行报告整体退役 |

升级不修复历史执行记录：原件按原相对路径移入 `runtime/workspace-backups/<时间>/`，与同一操作的其他备份共用时间戳目录。

## 迁移隔离回执（`./migration-quarantine`）

`assertWorkspaceMigrationQuarantineRecord` 统一校验隔离写入、枚举和恢复读取的回执。回执记录负责方、原路径、是否移动、隔离时间和错误；只有已经恢复的回执携带 `restored: true`。移动前必须持久化原对象的 `moveIdentity`（设备与 inode），恢复仅核对该身份，不从当前隔离对象补造缺失身份。缺字段、非法状态或身份冲突必须保留隔离对象和回执并拒绝恢复，不得据此推进布局版本。历史缺失身份的回执需要可信原始证据，在线恢复不提供兼容分支。

隔离恢复的对象可以是会话目录或独立产物文件。负责方按原对象完成验证和迁移；编排器只对实际目录检查旧会话格式，不把文件交给目录读取器。仍不合法的对象重新隔离，成功对象的恢复回执在依赖迁移完成后才清除。

## 分支删除状态（`./session-tombstone`）

会话删除标记、删除目标、插件处理器清单和下一阶段由工作区删除状态统一持久化。会话标记拒绝迟到写入；操作记录负责恢复和相同请求的完成回执，两者不能互相替代。

阶段确认只携带删除请求键和实际完成的阶段，不回传目标或处理器清单。仓储在删除状态独占锁内读取权威操作，调用 `advanceSessionBranchDeletion(operation, completedStage)` 校验并推进，再持久发布。操作缺失报 `SESSION_TOMBSTONE_INVALID`；阶段与持久记录不符报 HTTP 409 `SESSION_BRANCH_DELETION_CONFLICT`，不回退、不跳阶段。分支锁覆盖清理副作用及阶段确认；未确认的副作用由原阶段按原清单重放。

完成操作目前仍保留以响应相同请求；尚无记录退役、保留期和容量准入协议。不得直接清除会话标记或完成记录作为回收措施，否则会改变迟到写入拒绝或删除重试契约。

运行测试：`npm run -w @noobot/workspace-protocol test`
