# `@noobot/workspace-protocol`

用户工作区结构的唯一事实源：目录布局、区段与负责方、四个生命周期操作、资产同步规则和布局迁移。只有纯数据和纯函数，不做 IO；IO 和编排只在 `agent/src/workspace-lifecycle`。

## 布局（`./layout`）

`WORKSPACE_LAYOUT` 定义所有相对路径，`WORKSPACE_LAYOUT_VERSION` 当前为 `2`。主系统、service 和插件都引用这里的常量，不再手写 `runtime/...` 字面量（由 `scripts/check-workspace-protocol-boundary.mjs` 守卫）。

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

`planWorkspaceLayoutUpgrades({ installedVersion })` 返回 `WORKSPACE_LAYOUT_UPGRADES` 中高于已安装版本的步骤。本包只记录步骤和负责方标识，处理函数在 lifecycle 中绑定。每个操作（含 service 启动时对每个用户执行的 `ensureUserWorkspace`）都会在工作区锁内执行升级，全部成功后写入当前版本。

| 步骤                 | 目标版本 | 负责方            | 内容                                                                                                                                                                          |
| -------------------- | -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-storage-v2` | `2`      | `session-storage` | 会话树以各节点的 `parentSessionId` 为唯一事实源，映射为 parent-only 结构（丢弃 `roots`/`children`）；index 不是 v2 的 `execution-events` 和版本不是当前协议的执行报告整体退役 |

升级不修复历史执行记录：原件按原相对路径移入 `runtime/workspace-backups/<时间>/`，与同一操作的其他备份共用时间戳目录。

运行测试：`npm run -w @noobot/workspace-protocol test`
