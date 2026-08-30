# `@noobot/attachment-protocol`

附件协议的唯一规范入口，负责定义跨 Agent、Service、传输和 Client 的附件事实契约。

## 设计边界

- 业务身份唯一由 `attachmentId + sessionId + attachmentSource` 构成，三者缺一不可。
- `path`、`relativePath`、沙箱路径、名称、MIME 和大小不是身份字段，也不能在新链路中推测身份。
- 持久化记录、Agent 运行态引用、访问引用和 UI 视图是不同对象，不能通过对象展开互相覆盖。
- `attachments === undefined` 表示 unchanged；`attachments = []` 表示显式 replace/delete-all。
- 生命周期事件必须携带版本、稳定 `messageId` 和完整附件身份；传输层只能校验和无损透传。

## 历史数据迁移

运行时只接受 canonical identity、descriptor 和 persisted record，不从 snake_case 字段、路径或文件特征推断身份。历史 `attachments.json` 必须在启动当前版本前离线转换：

```bash
node scripts/migrate-attachment-record-v1.mjs --workspace=/path/to/workspace
node scripts/migrate-attachment-record-v1.mjs \
  --workspace=/path/to/workspace \
  --write \
  --backup=/path/to/attachment-backup
```

第一条命令只扫描并报告；写入模式必须指定独立备份目录。迁移脚本是历史记录转换的唯一入口，运行时协议不会降级解析旧结构。

运行测试：`npm run -w @noobot/attachment-protocol test`
