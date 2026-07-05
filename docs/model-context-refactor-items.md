# 模型上下文规则重构项

> 每完成一项，必须回写本文件状态。

## 状态

- [x] 1. 删除旧的上下文/模型消息流文档，新增统一规则文档 `docs/model-context-message-rules.md`。
- [x] 2. 在 agent 侧沉淀主流程上下文筛选/裁剪方法：system 无裁剪、history 按 dialog 构造最近 5 个 dialog 组并保留组内所有未小结非 system 消息、incremental 未小结且无裁剪。
- [x] 3. 主流程 `message-builder` 复用新规则生成最终模型消息，避免 harness 未启用时依赖插件压缩。
- [x] 4. 注入给 harness 的 `resolveModelMessages/resolveMessageBlock` 复用主流程规则；插件只调用，不自行裁剪 agent 上下文。
- [x] 5. harness capability 消息转换规则保持不变，但移除插件侧 agent 上下文裁剪路径。
- [x] 6. 更新/新增测试覆盖主流程规则、harness 注入 resolver、非主流程 capability 上下文不再固定条数裁剪。
- [x] 7. 运行相关测试并回写结果。

## 测试记录

- 2026-06-13：`npm -w agent test -- --test __tests__/system-core/session/context-window-normalizer.test.js __tests__/system-core/session/harness-resolve-model-messages.test.js` 通过（实际 agent test 脚本执行 system-core 测试集，77 tests，0 failed）。
- 2026-06-13：`npm -w plugin/noobot-plugin-harness test` 通过（30 tests，0 failed）。


## 追加收敛

- [x] 8. 收敛 harness 插件侧遗留 fallback：`resolveCapabilityModelMessages` fallback 不再过滤 summarized，不再裁剪；resolver 返回结果保持原样。
- [x] 9. 收敛 capability invoker：`invokeWithReasoningRetry` 调用前不再额外过滤 summarized 消息。
- [x] 10. 收敛 planning context summary fallback：移除插件侧 summarized/dialog/tool-pair 筛选和固定条数裁剪，仅做 role/content 格式转换卫生。
- [x] 11. 删除/停止导出 harness 插件侧 agent 上下文裁剪 helper 与 `capabilityModelRecentMessageLimit` 遗留配置。

## 追加测试记录

- 2026-06-13：`npm -w plugin/noobot-plugin-harness test` 通过（30 tests，0 failed），覆盖插件侧不再额外过滤/裁剪 agent 上下文。

## 配置面收敛

- [x] 12. 删除已失效的 harness/window 配置面及对应 override 白名单/测试断言。

## 配置面测试记录

- 2026-06-13：`npm -w plugin/noobot-plugin-harness test` 通过（30 tests，0 failed）。
- 2026-06-13：`node src/system-core/bot-manage/session/__tests__/session-execution-engine-plugin.test.js` 通过（22 tests，0 failed）。
- 2026-06-13：`npm -w agent test -- --test __tests__/system-core/session/context-window-normalizer.test.js __tests__/system-core/session/harness-resolve-model-messages.test.js` 通过（实际 agent test 脚本执行 system-core 测试集，77 tests，0 failed）。

## harness 阈值模式化

- [x] 13. harness planning 阈值按场景模式区分：全能/full 默认 `turnsThreshold=8`、`triggerTurnsThreshold=4`；编程/programming 使用 `turnsThreshold=12`、`triggerTurnsThreshold=8`。
- [x] 14. 工具爆发小结阈值复用同一套模式化 `turnsThreshold`，避免 full/programming 行为不一致。

## harness 阈值测试记录

- 2026-06-13：`node __tests__/guidance-plan-update-threshold.test.js` 通过（26 tests，0 failed），覆盖 full 与 programming 阈值差异。
- 2026-06-13：`npm -w plugin/noobot-plugin-harness test` 通过（30 tests，0 failed）。

## harness 阈值配置结构收敛

- [x] 15. 将 harness mode thresholds 从平铺字段改为按流程/能力分层，避免未来不同流程复用相同参数名时语义冲突：`modeThresholds.<mode>.summary.turnsThreshold`、`modeThresholds.<mode>.planUpdate.triggerTurnsThreshold`。

## harness 阈值配置结构测试记录

- 2026-06-13：`node __tests__/guidance-plan-update-threshold.test.js` 通过（26 tests，0 failed）。
- 2026-06-13：`npm -w plugin/noobot-plugin-harness test` 通过（30 tests，0 failed）。

## harness 阈值配置层级调整

- [x] 16. 将 `modeThresholds` 从 `planning` 内部上移到与 `planning` 平级，结构为 `modeThresholds.<mode>.<flow>.<param>`，当前使用 `modeThresholds.full.planning.*` 与 `modeThresholds.programming.planning.*`。

## harness 阈值配置层级测试记录

- 2026-06-13：`node __tests__/guidance-plan-update-threshold.test.js` 通过（26 tests，0 failed）。
- 2026-06-13：`npm -w plugin/noobot-plugin-harness test` 通过（30 tests，0 failed）。

## 上下文源数据不可变性测试

- [x] 17. 增加不开 harness 的主流程 resolver 不可变性测试：无小结时，上下文解析不会改变源 `system/history/incremental` 消息数组的顺序和数量。
- [x] 18. 增加开启 harness 的注入 resolver 不可变性测试：无小结时，`resolveModelMessages` 不会改变源 `ctx.messages` 或 `ctx.messageBlocks` 的顺序和数量。

## 上下文源数据不可变性测试记录

- 2026-06-13：`npm -w agent test -- --test __tests__/system-core/session/context-window-normalizer.test.js __tests__/system-core/session/harness-resolve-model-messages.test.js` 通过（实际 agent test 脚本执行 system-core 测试集，77 tests，0 failed）。

## 增量消息顺序测试

- [x] 19. 增加增量消息顺序测试：工具调用增量、插件注入增量、主流程注入增量在未小结时按实际顺序输出，且源增量数组顺序不变。

## 增量消息顺序测试记录

- 2026-06-13：`npm -w agent test -- --test __tests__/system-core/session/context-window-normalizer.test.js` 通过（实际 agent test 脚本执行 system-core 测试集，77 tests，0 failed）。

## history / incremental 边界收敛

- [x] 20. 明确 harness 主流程 `messageBlocks.history` 不进入 `conversation` 二次裁剪；`conversation` final compact 只处理 current/incremental 与 prompt 注入。
- [x] 21. 补充 history 轮次规则：最近 5 个 dialog 组，组内保留所有 `summarized:false` 非 system 消息。

## history / incremental 边界测试记录

- 2026-06-24：`cd plugin/noobot-plugin-harness && node --test __tests__/register-hooks-factory.test.js __tests__/runtime-message-blocks.test.js` 通过（16 tests，0 failed）。
- 2026-06-24：`cd plugin/noobot-plugin-harness && npm test` 通过（276 tests，0 failed）。
