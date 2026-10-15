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

总计：回退链 1055 处 / 377 个文件；内联 trim 兜底 552 处 / 259 个文件；遮蔽 text() 0 处 / 0 个文件。

| 模块                             | 回退链 | 内联 trim 兜底 | 遮蔽 text() |
| -------------------------------- | ------ | -------------- | ----------- |
| `client/noobot-chat`             | 365    | 158            | 0           |
| `agent`                          | 177    | 110            | 0           |
| `plugin/noobot-plugin-workflow`  | 112    | 86             | 0           |
| `plugin/noobot-plugin-harness`   | 89     | 47             | 0           |
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

本轮逐项处理，处理完即从表中删除并写入批次记录。

| 项                                         | 现状                                                                                                                                                                                                                | 需要的决定                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 引擎 `stepFailure`                         | `workflow/src/lib/runtime.js` 的 `markStepStateFailure` 只由 `action.stepFailure` 触发，插件已不再下发                                                                                                              | 引擎批次删除                                                                  |
| 工具身份 `payloadRuntime` 覆盖             | `resolveSharedToolRuntime` 让 `payload.runtime.systemRuntime` 覆盖已绑定 runtime，可改写 `userId` 等身份字段（同 `systemRuntimePatch` 类）；`semanticTransfer` 在 src 无字面调用方，插件可能经 sharedTools 动态调用 | 核实调用方后按缺陷切片修正：身份字段只取绑定 runtime                          |
| `agentContext.identity` 回退层             | `resource-broker`、`workspace-meta`、`native-script-tool` 等在 `systemRuntime.userId` 之后仍回退 `context.identity.userId` / `agentContext.userId`                                                                  | 确认 identity 与 `systemRuntime` 恒等后，择一为事实源删除另一层               |
| turn lifecycle 输入事件                    | `turn-state.js:177` 读 `causationId \|\| commandId`；`commit-turn-lifecycle.js:23-53` 一组 `event.X \|\| turn.X`                                                                                                    | lifecycle 协议批次：定输入事件必带字段后删除回退                              |
| 子会话投影 `turnScopeId`/`dialogProcessId` | 后端 `message-event-stream` 已只读 `systemRuntime.dialogProcessId`/`turnScopeId`；`validateMessageEnvelope` 仍不强制 `identity.turnScopeId`                                                                         | 在协议中强制后，再删 `subSessionEventProjection` 中的 `\|\| currentSession.X` |
| `SESSION_RUN_EVENT.LOCAL_FAILURE`          | src 中只有 `eventNormalization`、`turnReducer` 两个消费方，没有构造方，仅测试发送                                                                                                                                   | 确认无外部扩展发送后，连同消费分支和测试一并删除                              |
| registry `canonicalTimingObserved`         | 只剩 `applyTurnTimingUpdate` 自身去重比较在读，不影响投影值                                                                                                                                                         | 确认快照重放的 `applied` 语义不依赖它后删除                                   |

## 5. 挂起项

| 项                                | 现状                                                                                                                                                  | 重启条件                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 前端 `failure`→`stepFailure` 投影 | `workflowRuntimeSessions`、`workflowRuntimeStatus` 与 agent `pickPayloadStepFailure` 仍读取历史会话中的 `stepFailure`；现在删除会让旧会话丢失失败信息 | 下次 session 存储版本升级时，按事实源重建 `failure` 后一并删除 |

## 6. 已定结论

| 项                                     | 结论                                                                         | 依据                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `user-template/default-user/services`  | 保持计数，不排除、不引入共享包；回退按边界代码对待                           | handler 复制到用户工作区后由 `integrations/services` 动态加载，须自包含，不能依赖 `@noobot/shared`           |
| 守卫第四条规则 `字段 \|\| 字面量`      | 不加计数规则；改由协议必带字段校验拦截（同 `turn_failure_incomplete`）       | 非测试源码命中 316 处（字符串 267、数字 49），抽样 30 处多为 HTTP 状态、外部错误文案、配置与 i18n 参数默认值 |
| 剩余 `fallbackChain`/`inlineTrim` 命中 | 不追求清零；由 CI 守卫（`quality-checks.yml` → `check:quality`）保证只降不升 | 抽样以边界默认值为主；掩盖协议缺字段的写法并入协议批次处理                                                   |

## 7. 批次记录

| 提交        | 模块                          | 内容                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3d9f986d3` | workflow                      | 运行身份只从 `ctx.runConfig` 读一次，删除 ctx 回写                                                                                                                                                                                                                                                                                                                                 |
| `716593609` | workflow                      | 删除 `nodeAgentExecutor`，DSL 只读 `task`、`stateType`                                                                                                                                                                                                                                                                                                                             |
| `74c3842c1` | workflow                      | abort 判定改用 session-protocol 执行中止协议                                                                                                                                                                                                                                                                                                                                       |
| `08148dccd` | scripts                       | 回退链守卫与本清单                                                                                                                                                                                                                                                                                                                                                                 |
| `b62dfd769` | agent、workflow               | `commandId` 由 `applyCanonicalRunMessageIdentity` 和 detached strategy 唯一写入，四处读取回退删除；删除 `commandIdConsumed`                                                                                                                                                                                                                                                        |
| `5e8207f13` | scripts                       | 守卫增加 `inlineTrim` 规则，基线按规则分组；测试路径判定统一到 `source-inventory`                                                                                                                                                                                                                                                                                                  |
| `acec6da42` | 全仓                          | 单字段 `String(x \|\| d).trim()` 301 处改为 `text(x)`/`(text(x) \|\| d)`；82 处 `text` 遮蔽改名；守卫增加 `textShadow` 规则                                                                                                                                                                                                                                                        |
| `38885d5be` | shared、model-runtime         | `message-diagnostics` 单字段 trim 改用 `text()`；`response-normalizer` 本地内容提取器改名 `extractContentText`，消除与 `text()` 同名                                                                                                                                                                                                                                               |
| `6734c9dbe` | agent、workflow               | detached 子会话投影只读 finalizer 的 `answer`/`messages`（缺陷修正：`messages` 与 `transferEnvelopes` 此前恒为空）；删除恒空的 `persisted`/`nodeSessionPersistedPath`；workflow agent 结果只读 `output`、session 结果只读 `answer`                                                                                                                                                 |
| `94aad6f80` | agent                         | detached 终态回执直接投影已提交的 turn（applied/deduplicated/provision 三路必带 `turn`）；删除 `result/error.lifecycle`、`state \|\| branchState`、外部 `executionId`、`code/error` 回退与死状态映射；失败回执 `failure` 为完整 turn failure                                                                                                                                       |
| `179238e65` | authoritative-state、workflow | FAILED 转移在 transition 层强制 `failure.code`/`message`（`turn_failure_incomplete`，唯一守卫入口）；workflow 子会话失败直接透传已提交 turn 的 failure，删除默认文案/默认 code 与 `executionKind \|\| "agent"` 回退                                                                                                                                                                |
| `5c5887b71` | 测试夹具                      | 测试 helper/fixture 单字段 `String(x \|\| d).trim()` 28 处改为 `text()`；`raw`/`outputText` 改名消除 `text` 遮蔽；`inlineTrim` 保留 helper 计数口径（不放宽）                                                                                                                                                                                                                      |
| `dad7809e9` | client                        | 子会话投影 `parentSessionId`/`workflowRunId`/`nodeExecutionId` 只读事件 payload（gate 与协议已强制三元组）；删除 `buildNextSubSessionState`、`applySubSessionMessageOrdering` 5 处回退；新增前提用例固定行为等价依据                                                                                                                                                               |
| `ffc6a2d88` | client、i18n                  | 终态失败以 `failure` 为唯一事实源（缺陷修正：`turn.error` 此前被投影成 `"[object Object]"`）；删除终态提示中无写入方的 `reason`/`terminalReason`/`description`/`error` 死链路及 `turnTerminalReason`、`turnTerminalErrorDetail` 两个键；删除 `source`/`authority` 死回退                                                                                                           |
| `d6e96d374` | client                        | 计时字段统一为 `startedAt`/`finishedAt`：后端持久化的 `turnTimings.thinking*` 只在 `applyTurnTimingSnapshot` 入口映射一次；`sendFlow` 改发 `startedAt`；删除 reducer、selectors、snapshot projection、messageRuntime、`SharedChatMessageItem` 的双名兜底，以及 reducer 中无写入方的 `rawEvent.canonicalTimingObserved` 分支                                                        |
| `2b3e9e56a` | agent                         | 消息事件 payload 身份只取已绑定的 stream 与 `systemRuntime`：删除 `parentSessionId`、`dialogProcessId`（含无独立写入方的 `currentDialogProcessId`）、`workflowRunId`、`nodeExecutionId` 的 `data`/`state` 回退，commit input 的 `sessionId`、`turnScopeId` 收敛为 `systemRuntime` 单一来源；删除 `agent-dispatch` 重复字面量兜底；新增反向用例（旧代码中 `data` 可覆盖已绑定身份） |
| `a166ef0a5` | workflow                      | 节点失败一律终止并提交 FAILED（缺陷修正：子会话抛出无 lifecycle 的错误时，节点此前停在 RUNNING）；删除 `createFailedNodeAgentResult`、`createWorkflowNodeFailure` 与 `stepFailure` 透传、上游失败行链路及 4 个 i18n 键；节点 failure 固定为 `{ source, code, message }`，`normalizeFailure` 缺字段即拒绝                                                                           |
| `2f30eae41` | client、i18n                  | 终态 `error` 且 `failure.message` 非空时，在标签下追加 `turnTerminalErrorDetail`（`user_stopped` 不显示）；恢复该键（中英）                                                                                                                                                                                                                                                        |
| `acbe3bb9a` | agent                         | `turnScopeId` 只取 `systemRuntime.turnScopeId`：删除 `buildDynamicInfo` 与 `runtime-binding` 对 `systemRuntime.config.turnScopeId` 的同值重复写入；删除 accessor、hooks、`plugin-artifact-committer` 的 `config` 层读取、accessor 的 `runConfig` 回退（`getRuntimeRunConfig`）与 hooks 中无写入方的 `runtime.turnScopeId`；删除 `system-prompt-formatter` 重复字面量 `\|\| "user"` |
| `ed5200e4d` | agent                         | 删除无写入方的 `runConfig.systemRuntimePatch` 合并分支（缺陷修正：旧代码允许 runConfig 覆盖 `userId` 等身份字段）；`context-builder-normalization` 用例改为断言身份不被覆盖                                                                                                                                                                                                        |
| `b77aad00b` | workflow                      | 子会话终态收据被拒时提交节点 FAILED（缺陷修正：此前 `nodeTerminalReceiptRejected` 使 `commitWaveNodeFailure` 跳过提交，节点停在 RUNNING）；拒收 failure 为 `{ source: "workflow", code: WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID, message }`；删除 `nodeTerminalReceiptRejected` 标记                                                                                               |

| 待回填 | agent、path-resolver、harness | `userId` 只取 `systemRuntime.userId`：删除 `createRuntimeContext` 与 memory 对 `runtime.userId` 的同值写入、`build-system-context` 的 `dynamicInfo.userId \|\| userId` 回退；全部 `runtime.userId` 读取改为 `systemRuntime`（accessor 新增 `resolveRuntimeUserId`）；删除 `execution-identity` 无写入方的 `runtime.sessionId`；hooks 与 sandbox-mapping 补反向用例；测试夹具改写 `systemRuntime.userId` |
