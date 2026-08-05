# Chat Session Replay

Replay 使用 Event Protocol 的 replay batch：一个 Session lifecycle snapshot 加同一 `sessionId` 下连续的 event tail。

缓存、去重和 watermark 只按 `(sessionId, turnScopeId)` 建立 Turn key。不得使用 Session-only、dialog-only、本地临时 ID 或身份提升作为替代键。Session 列表、详情、活动 Session 和运行时 Registry 均只使用预分配的最终 `sessionId`。

字段和策略的唯一规范见 [Session Protocol](../../../session-protocol/README.md)，自动化验收见 [浏览器协议 E2E 方案](../../../docs/browser-protocol-e2e-test-plan.zh-CN.md)。
