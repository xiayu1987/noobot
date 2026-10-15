# 回退链收敛清单

本文档跟踪生产源码中尚未收敛的字段回退链。逐文件计数的唯一事实源是 `scripts/quality/fallback-chain-baseline.json`，守卫是 `scripts/check-fallback-chain-baseline.mjs`（已挂入 `npm run check:quality`）。下方模块表由守卫脚本生成，不手工编辑。

## 1. 判定口径

一条回退链是值位置上的 `||` 或 `??` 链，且至少有两个操作数读取运行时数据的属性，例如 `ctx.runConfig.executionId || ctx.executionId`、`identity.sessionId || envelope.sessionId`。

不计入：

- 条件位置：`if`/`while`/`for` 条件、三元条件、`!`、`&&` 的操作数。
- 常量表默认值：根对象为全大写标识符，例如 `error?.message || AGENT_PROXY_ERROR.X`。
- 单字段默认值：`value || ""`、`options.limit ?? 20`。
- 测试、vendor、workspace 等 `scripts/quality/source-inventory.mjs` 排除的路径；`.vue` 只统计 `<script>`，模板表达式不在统计内。

## 2. 收敛流程

每一批按模块推进，顺序固定：

1. 查写入方：找到字段的所有写入点，确认协议保证写的是哪一个字段。
2. 改协议：写入方不唯一或不保证时，先在写入方或协议包里定下唯一字段，缺失直接报错。
3. 删读取兜底：读取方只读协议字段，删掉别名、跨来源回退和随机生成。
4. 补用例：新用例在新代码通过，换回旧代码失败。
5. 门禁：prettier、eslint、`npm test`、`npm run check:quality`、`npm run build` 全部为 0。
6. 下调基线：运行 `node scripts/check-fallback-chain-baseline.mjs --update`，同步更新本文档的批次记录后提交。

守卫规则：任何文件的计数上升直接失败；计数下降但未 `--update` 也失败，保证基线和文档始终等于现状。

## 3. 模块现状

<!-- fallback-chain-modules:start -->

总计：1111 条，385 个文件。

| 模块                             | 文件数 | 回退链 |
| -------------------------------- | ------ | ------ |
| `client/noobot-chat`             | 103    | 386    |
| `agent`                          | 92     | 206    |
| `plugin/noobot-plugin-workflow`  | 36     | 117    |
| `plugin/noobot-plugin-harness`   | 30     | 90     |
| `service`                        | 30     | 81     |
| `authoritative-state`            | 5      | 31     |
| `client/shared`                  | 12     | 31     |
| `model-runtime`                  | 7      | 31     |
| `agent-proxy`                    | 10     | 23     |
| `context-protocol`               | 8      | 20     |
| `path-resolver`                  | 4      | 15     |
| `shared`                         | 3      | 11     |
| `event-protocol`                 | 3      | 10     |
| `scripts`                        | 6      | 8      |
| `session-protocol`               | 4      | 7      |
| `plugin/noobot-plugin-character` | 6      | 6      |
| `session-repair`                 | 1      | 5      |
| `client/startup`                 | 1      | 4      |
| `connector-instances`            | 2      | 4      |
| `user-template`                  | 2      | 4      |
| `agent-config-protocol`          | 3      | 3      |
| `i18n`                           | 2      | 3      |
| `model-protocol`                 | 3      | 3      |
| `memory-protocol`                | 2      | 2      |
| `model-proxy`                    | 2      | 2      |
| `workflow`                       | 2      | 2      |
| `connector-protocol`             | 1      | 1      |
| `platform-compatibility`         | 1      | 1      |
| `plugin-protocol`                | 1      | 1      |
| `runtime-events`                 | 1      | 1      |
| `sanitize`                       | 1      | 1      |
| `semantic-transfer-protocol`     | 1      | 1      |

<!-- fallback-chain-modules:end -->

## 4. 待决项

| 项                                | 现状                                                                                                               | 需要的决定                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `createFailedNodeAgentResult`     | 子会话超时或抛错且无 lifecycle 时走该分支，节点记为失败、workflow 继续                                             | 是否改为节点失败即终止整个 workflow            |
| `commandId`                       | `turn-command`、`agent-transport-consumption`、`current-user-turn`、workflow `authority-event-commit` 四处各自回退 | 以 `turnCommand.commandId` 为唯一来源（建议）  |
| `userId`                          | `runtime.userId` 来自 `identity.userId`，`ctx.userId` 来自 hook meta，同源未确认                                   | 确认后只保留一层                               |
| `NODE_AGENT_EXECUTE` failure 结构 | 公开 hook 未定义 `stepFailure` 形状，`normalizeFailure` 读 `message \|\| reason \|\| code`                         | 协议固定为 `{ source, code, message }`（建议） |

## 5. 批次记录

| 提交        | 模块     | 内容                                                   |
| ----------- | -------- | ------------------------------------------------------ |
| `3d9f986d3` | workflow | 运行身份只从 `ctx.runConfig` 读一次，删除 ctx 回写     |
| `716593609` | workflow | 删除 `nodeAgentExecutor`，DSL 只读 `task`、`stateType` |
| `74c3842c1` | workflow | abort 判定改用 session-protocol 执行中止协议           |
