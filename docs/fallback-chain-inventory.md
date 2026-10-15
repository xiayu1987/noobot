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

`String(x || d).trim()`、`String(x ?? d).trim()`：重复实现了 `@noobot/shared/value` 的 `text()`。改写为 `text(x)` 或 `text(x) || d`。`text(x || d)`、`text(a ?? b)` 同样计数：兜底不能藏进 `text()` 参数里。

- 范围：除测试文件（`isTestFilePath`）外的全部第一方代码，包含 `__tests__/helpers` 等夹具，因为夹具按同一协议构造数据。
- 改写不是机械替换：`String(x || "").trim()` → `text(x)` 时，`0`/`false` 会从 `""` 变为 `"0"`/`"false"`；`String(x || "d").trim()` → `text(x) || "d"` 时，纯空白会从 `""` 变为 `"d"`。逐处确认写入方类型后再改。
- 依赖边界：`shared` 内部用本地 `text`；`workspace-protocol` 零依赖；`scripts`、`user-template` 无 `package.json`。这些位置照常计数，清零时按各自边界处理。

### 1.3 遮蔽 `text()`（`textShadow`）

导入了 `text` 的文件，不允许在局部作用域重新绑定 `text`（参数、解构、`const`/`let`）。被遮蔽后，作用域内的 `text(x)` 会在运行时报 `text is not a function`。改名为 `inputText` 等；对外字段名用 `text: inputText` 保持不变。

- 判定：对导入了 `text` 的文件跑 ESLint `no-shadow`，只取 `'text'` 的命中。
- 基线为 0，任何命中都会失败。
- 其他名字的遮蔽（51 处）不在本规则内，仅作信息记录。

三条规则都只统计 `.vue` 的 `<script>`，模板表达式不在统计内。

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

总计：回退链 1100 处 / 381 个文件；内联 trim 兜底 614 处 / 267 个文件；遮蔽 text() 0 处 / 0 个文件。

| 模块                             | 回退链 | 内联 trim 兜底 | 遮蔽 text() |
| -------------------------------- | ------ | -------------- | ----------- |
| `client/noobot-chat`             | 386    | 178            | 0           |
| `agent`                          | 199    | 131            | 0           |
| `plugin/noobot-plugin-workflow`  | 113    | 87             | 0           |
| `plugin/noobot-plugin-harness`   | 90     | 67             | 0           |
| `service`                        | 81     | 39             | 0           |
| `authoritative-state`            | 31     | 11             | 0           |
| `model-runtime`                  | 31     | 10             | 0           |
| `client/shared`                  | 31     | 5              | 0           |
| `context-protocol`               | 20     | 12             | 0           |
| `agent-proxy`                    | 23     | 8              | 0           |
| `path-resolver`                  | 15     | 7              | 0           |
| `shared`                         | 11     | 6              | 0           |
| `user-template`                  | 4      | 12             | 0           |
| `event-protocol`                 | 10     | 4              | 0           |
| `scripts`                        | 8      | 3              | 0           |
| `session-repair`                 | 5      | 4              | 0           |
| `plugin/noobot-plugin-character` | 6      | 2              | 0           |
| `connector-instances`            | 4      | 3              | 0           |
| `session-protocol`               | 7      | 0              | 0           |
| `workflow`                       | 2      | 4              | 0           |
| `agent-config-protocol`          | 3      | 2              | 0           |
| `i18n`                           | 3      | 2              | 0           |
| `client/startup`                 | 4      | 0              | 0           |
| `connector-protocol`             | 1      | 3              | 0           |
| `memory-protocol`                | 2      | 2              | 0           |
| `model-protocol`                 | 3      | 1              | 0           |
| `model-proxy`                    | 2      | 2              | 0           |
| `semantic-transfer-protocol`     | 1      | 2              | 0           |
| `workspace-protocol`             | 0      | 3              | 0           |
| `platform-compatibility`         | 1      | 1              | 0           |
| `plugin-protocol`                | 1      | 1              | 0           |
| `runtime-events`                 | 1      | 1              | 0           |
| `sanitize`                       | 1      | 1              | 0           |

<!-- fallback-chain-modules:end -->

## 4. 待决项

| 项                                | 现状                                                                                                                                             | 需要的决定                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `createFailedNodeAgentResult`     | 子会话超时或抛错且无 lifecycle 时走该分支，节点记为失败、workflow 继续                                                                           | 是否改为节点失败即终止整个 workflow                                                  |
| `userId`                          | workflow 已只读 `ctx.userId`；`runtime.userId` 与 hook meta 是否传同一入参尚未逐行确认                                                           | 确认后删除 `runtime.userId` 读取                                                     |
| turn lifecycle 输入事件           | `turn-state.js:177` 读 `causationId \|\| commandId`；`commit-turn-lifecycle.js:23-53` 一组 `event.X \|\| turn.X`                                 | lifecycle 协议批次：定输入事件必带字段后删除回退                                     |
| `NODE_AGENT_EXECUTE` failure 结构 | 公开 hook 未定义 `stepFailure` 形状，`normalizeFailure` 读 `message \|\| reason \|\| code`                                                       | 协议固定为 `{ source, code, message }`（建议）                                       |
| detached 终态回执                 | `detached-subsession-runner.js:453/551` 读 `terminalLifecycle?.turn \|\| lifecycle`；`createDetachedTerminalReceipt` 读 `state \|\| branchState` | 确认 `applyTurnLifecycleEvent` applied/deduplicated/provision 三路必带 `turn` 后删除 |

## 5. 批次记录

| 提交        | 模块                  | 内容                                                                                                                                                                                                                               |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3d9f986d3` | workflow              | 运行身份只从 `ctx.runConfig` 读一次，删除 ctx 回写                                                                                                                                                                                 |
| `716593609` | workflow              | 删除 `nodeAgentExecutor`，DSL 只读 `task`、`stateType`                                                                                                                                                                             |
| `74c3842c1` | workflow              | abort 判定改用 session-protocol 执行中止协议                                                                                                                                                                                       |
| `08148dccd` | scripts               | 回退链守卫与本清单                                                                                                                                                                                                                 |
| `b62dfd769` | agent、workflow       | `commandId` 由 `applyCanonicalRunMessageIdentity` 和 detached strategy 唯一写入，四处读取回退删除；删除 `commandIdConsumed`                                                                                                        |
| `5e8207f13` | scripts               | 守卫增加 `inlineTrim` 规则，基线按规则分组；测试路径判定统一到 `source-inventory`                                                                                                                                                  |
| `acec6da42` | 全仓                  | 单字段 `String(x \|\| d).trim()` 301 处改为 `text(x)`/`(text(x) \|\| d)`；82 处 `text` 遮蔽改名；守卫增加 `textShadow` 规则                                                                                                        |
| `38885d5be` | shared、model-runtime | `message-diagnostics` 单字段 trim 改用 `text()`；`response-normalizer` 本地内容提取器改名 `extractContentText`，消除与 `text()` 同名                                                                                               |
| 待回填      | agent、workflow       | detached 子会话投影只读 finalizer 的 `answer`/`messages`（缺陷修正：`messages` 与 `transferEnvelopes` 此前恒为空）；删除恒空的 `persisted`/`nodeSessionPersistedPath`；workflow agent 结果只读 `output`、session 结果只读 `answer` |
