# Chat Turn 状态机

前端 Turn 状态机只消费 `@noobot/session-protocol` 的权威 lifecycle envelope 和 snapshot。

- Session 身份：`sessionId`
- Turn 身份：`(sessionId, turnScopeId)`
- Turn 并发：`revision`
- 事件顺序：`sequence`
- 聚合并发：`aggregateVersion`
- 命令幂等：`commandId`

`channel_state` 是 Agent Proxy 的传输通知，不是业务状态事实，不能完成、停止或恢复 Turn。完整协议与浏览器验收以 [Session Protocol](../../../session-protocol/README.md) 和 [浏览器协议 E2E 方案](../../../docs/browser-protocol-e2e-test-plan.zh-CN.md) 为准。
