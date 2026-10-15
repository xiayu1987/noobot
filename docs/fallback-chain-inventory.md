# 回退链收敛清单

本文档跟踪尚未收敛的字段回退写法。逐文件、按规则分组的计数唯一事实源是 `scripts/quality/fallback-chain-baseline.json`，守卫是 `scripts/check-fallback-chain-baseline.mjs`（已挂入 `npm run check:quality`）。下方模块表由守卫脚本生成，不手工编辑。

## 1. 判定口径

### 1.1 回退链（`fallbackChain`）

值位置上的 `||` 或 `??` 链，且至少有两个操作数读取运行时数据的属性，例如 `ctx.runConfig.executionId || ctx.executionId`、`identity.sessionId || envelope.sessionId`。

不计入：

- 条件位置：`if`/`while`/`for` 条件、三元条件、`!`、`&&` 的操作数。
- 常量表默认值：根对象为全大写标识符，例如 `error?.message || AGENT_PROXY_ERROR.X`。
- 单字段默认值：`value || ""`、`options.limit ?? 20`。
- 非生产路径：以 `source-inventory.mjs` 的 `isFirstPartyProductionPath` 为准（排除测试文件、`__tests__`/`__mocks__`/`tests`、vendor、workspace 等）。

### 1.2 内联 trim 兜底（`inlineTrim`）

`String(x || d).trim()`、`String(x ?? d).trim()`：重复实现了 `@noobot/shared/value` 的 `text()`。改写为 `text(x)` 或 `text(x) || d`。

- 范围：除测试文件（`isTestFilePath`）外的全部第一方代码，包含 `__tests__/helpers` 等夹具，因为夹具按同一协议构造数据。
- 改写不是机械替换：`String(x || "").trim()` → `text(x)` 时，`0`/`false` 会从 `""` 变为 `"0"`/`"false"`；`String(x || "d").trim()` → `text(x) || "d"` 时，纯空白会从 `""` 变为 `"d"`。逐处确认写入方类型后再改。
- 依赖边界：`shared` 内部用本地 `text`；`workspace-protocol` 零依赖；`scripts`、`user-template` 无 `package.json`。这些位置照常计数，清零时按各自边界处理。

两条规则都只统计 `.vue` 的 `<script>`，模板表达式不在统计内。

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

总计：回退链 1103 处 / 382 个文件；内联 trim 兜底 460 处 / 212 个文件。

| 模块                             | 回退链 | 内联 trim 兜底 |
| -------------------------------- | ------ | -------------- |
| `client/noobot-chat`             | 386    | 110            |
| `agent`                          | 200    | 81             |
| `plugin/noobot-plugin-workflow`  | 115    | 50             |
| `plugin/noobot-plugin-harness`   | 90     | 74             |
| `service`                        | 81     | 31             |
| `agent-proxy`                    | 23     | 23             |
| `model-runtime`                  | 31     | 7              |
| `client/shared`                  | 31     | 1              |
| `authoritative-state`            | 31     | 0              |
| `shared`                         | 11     | 17             |
| `context-protocol`               | 20     | 2              |
| `path-resolver`                  | 15     | 3              |
| `user-template`                  | 4      | 12             |
| `workflow`                       | 2      | 11             |
| `scripts`                        | 8      | 4              |
| `connector-instances`            | 4      | 7              |
| `event-protocol`                 | 10     | 1              |
| `model-protocol`                 | 3      | 7              |
| `session-protocol`               | 7      | 2              |
| `plugin/noobot-plugin-character` | 6      | 1              |
| `session-repair`                 | 5      | 0              |
| `agent-config-protocol`          | 3      | 1              |
| `client/startup`                 | 4      | 0              |
| `i18n`                           | 3      | 1              |
| `memory-protocol`                | 2      | 2              |
| `model-proxy`                    | 2      | 2              |
| `connector-protocol`             | 1      | 2              |
| `runtime-events`                 | 1      | 2              |
| `workspace-protocol`             | 0      | 3              |
| `platform-compatibility`         | 1      | 1              |
| `sanitize`                       | 1      | 1              |
| `execution-isolation-protocol`   | 0      | 1              |
| `plugin-protocol`                | 1      | 0              |
| `semantic-transfer-protocol`     | 1      | 0              |

<!-- fallback-chain-modules:end -->

## 4. 待决项

| 项                                | 现状                                                                                                             | 需要的决定                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `createFailedNodeAgentResult`     | 子会话超时或抛错且无 lifecycle 时走该分支，节点记为失败、workflow 继续                                           | 是否改为节点失败即终止整个 workflow              |
| `userId`                          | workflow 已只读 `ctx.userId`；`runtime.userId` 与 hook meta 是否传同一入参尚未逐行确认                           | 确认后删除 `runtime.userId` 读取                 |
| turn lifecycle 输入事件           | `turn-state.js:177` 读 `causationId \|\| commandId`；`commit-turn-lifecycle.js:23-53` 一组 `event.X \|\| turn.X` | lifecycle 协议批次：定输入事件必带字段后删除回退 |
| `NODE_AGENT_EXECUTE` failure 结构 | 公开 hook 未定义 `stepFailure` 形状，`normalizeFailure` 读 `message \|\| reason \|\| code`                       | 协议固定为 `{ source, code, message }`（建议）   |

## 5. 批次记录

| 提交        | 模块            | 内容                                                                                                                        |
| ----------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `3d9f986d3` | workflow        | 运行身份只从 `ctx.runConfig` 读一次，删除 ctx 回写                                                                          |
| `716593609` | workflow        | 删除 `nodeAgentExecutor`，DSL 只读 `task`、`stateType`                                                                      |
| `74c3842c1` | workflow        | abort 判定改用 session-protocol 执行中止协议                                                                                |
| `08148dccd` | scripts         | 回退链守卫与本清单                                                                                                          |
| `b62dfd769` | agent、workflow | `commandId` 由 `applyCanonicalRunMessageIdentity` 和 detached strategy 唯一写入，四处读取回退删除；删除 `commandIdConsumed` |
| 守卫分组    | scripts         | 守卫增加 `inlineTrim` 规则，基线按规则分组；测试路径判定统一到 `source-inventory`                                           |
