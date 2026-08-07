# `@noobot/attachment-protocol`

附件协议的唯一规范入口，负责定义跨 Agent、Service、传输和 Client 的附件事实契约。

## 设计边界

- 业务身份唯一由 `attachmentId + sessionId + attachmentSource` 构成，三者缺一不可。
- `path`、`relativePath`、沙箱路径、名称、MIME 和大小不是身份字段，也不能在新链路中推测身份。
- 持久化记录、Agent 运行态引用、访问引用和 UI 视图是不同对象，不能通过对象展开互相覆盖。
- `attachments === undefined` 表示 unchanged；`attachments = []` 表示显式 replace/delete-all。
- 生命周期事件必须携带版本、稳定 `messageId` 和完整附件身份；传输层只能校验和无损透传。

## 迁移顺序

1. Agent 持久化/解析入口改为创建并校验 canonical identity、descriptor 和 persisted record。
2. Service 与事件生产入口改用 `createAttachmentLifecycleEvent`，通用事件层只做注册、校验和透传。
3. Client 与 Workflow 只消费 runtime/access/UI 视图，不再实现独立 identity/path 匹配。
4. 历史 snake_case 和路径匹配仅保留在一个显式 legacy adapter，迁移完成后删除。

运行测试：`npm run -w @noobot/attachment-protocol test`
