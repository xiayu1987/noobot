# 消息身份 / Message identity

本文说明消息身份的职责边界。字段、角色约束、生成和迁移规则以
[身份 schema](../session-protocol/src/identity/message-identity-schema.js) 和
[身份工厂与断言](../session-protocol/src/identity/message-identity.js) 为准。

This guide describes message identity ownership. The linked schema and identity
factory define field constraints, generation, and migration rules.

## 身份职责 / Identity ownership

| 字段 / Field                | 职责 / Purpose                                                         |
| --------------------------- | ---------------------------------------------------------------------- |
| `messageUid`                | 会话消息主键 / Session message key                                     |
| `modelMessageId`            | assistant 模型消息关联 / Assistant model-message correlation           |
| `presentationMessageId`     | assistant、tool 展示关联 / Assistant and tool presentation correlation |
| `userMessageId`             | 用户输入关联 / User-input correlation                                  |
| `contextMessageId`          | 临时上下文消息主键 / Temporary context-message key                     |
| `sourceMessageUid`          | 来源会话消息引用 / Source Session-message reference                    |
| `userMetaSourceMessageUid`  | 用户元信息来源引用 / User metadata source reference                    |
| `replacementUserMessageUid` | 替换轮次的用户消息引用 / Replacement-turn user-message reference       |

生成前缀属于 schema；校验和存量迁移不能靠前缀猜测身份。调用、工具、活动、附件、执行轮次和
会话身份各自归属领域协议，不能用消息身份代替。附件的完整身份见
[附件协议](../attachment-protocol/README.md)。上下文中的会话消息、临时消息及来源投影见
[上下文协议](../context-protocol/README.md)。

Prefixes belong to the schema. Do not infer or repair identities from prefixes.
Tool calls, activities, attachments, executions, and Sessions retain their own
domain identities; message identities cannot substitute for them.

## 生产与消费 / Production and consumption

身份由明确生产入口分配，经协议断言后持久化，再由事件、模型上下文和前端消费。
展示层消费投影，不另建身份来源；模型绑定名称也不改变内部工具身份。
事件信封和生命周期分别见[事件协议](../event-protocol/README.md)与
[会话协议](../session-protocol/README.md)。

Producers allocate identity, protocol boundaries validate it, storage persists it,
and events, model context, and UI projections consume it. Display projections do
not create another identity source.

## 迁移与存储边界 / Migration and storage boundaries

旧 `messageId`、`noobotMessageId` 及其他退役字段只由显式迁移规则处理。
重建的 `session-summary`、`session-summary-details` 是投影；schema 将 `events`、
`execution-events` 和 `debug-*` 声明为冻结记录，不对它们执行消息字段改名。
迁移入口见[会话修复](../session-repair/README.md)，存储维护见
[不可变会话维护](../agent/docs/immutable-session-maintenance.md)。

Legacy fields are handled by explicit migration rules. Summary artifacts are
rebuilt projections; frozen event and debug records are not renamed in place.
Missing identity must not be invented during reads. Development tests and layout
versions do not establish production-data compliance or successful deployment.

存量异常须以实际来源和当前协议诊断，不能猜填缺失身份。代码测试或布局版本不能证明生产存量
已全部合规、完成升级或可以清理；此类操作仍需针对实际部署验证。
