# 单调消息后端真源改造计划

## 1. 问题定义

“用户孤儿消息”指：前端已经从目标单调消息起执行级联删除，但后端会话持久化仍保留该用户消息及其后续消息；刷新或重新请求 session 后，已被前端删除的历史尾段又从后端回流。

当前责任边界应调整为：

- 前端负责交互、按钮状态、本地乐观态与错误提示。
- 后端负责会话真源一致性，删除和重发必须最终落到后端持久化 session。

## 2. 现状证据

已核对当前实现：

- 前端 `deleteMonotonicMessage` / `resendMonotonicMessage` 通过 `cascadeDeleteMessagesFrom` 裁剪 `activeSession.messages`、`activeSession.rawMessages` 等内存态。
- 后端 `SessionMessageService.appendTurn` 是追加模型：`session.messages.push(turn)` 后 `sessionRepo.save(...)`。
- `service/routes/session-routes.js` 当前只有会话级查询和整会话删除路由，未提供消息级“从目标到末尾”裁剪接口。

因此，“后端也保存了用户孤儿消息”的原因不是后端主动恢复已删除消息，而是前端删除没有同步到后端真源；后端仍按追加持久化模型保留历史消息。

## 3. 后端新增能力

### 3.1 级联删除接口

建议新增内部接口：

```http
POST /internal/session/:userId/:sessionId/messages/delete-from
```

请求体：

```json
{
  "anchor": {
    "messageId": "optional",
    "dialogProcessId": "optional",
    "ts": "optional"
  },
  "parentSessionId": "optional",
  "expectedVersion": 12,
  "idempotencyKey": "uuid"
}
```

语义：

1. 定位 anchor，优先级：`messageId > dialogProcessId > ts`。
2. 找到 anchor 在 `session.messages` 中的位置。
3. 删除 `[anchorIndex, messages.length)`，即目标消息及其后续全部消息。
4. 更新 `updatedAt`、消息计数/摘要字段，保存 session。
5. 返回最新 session 快照或至少返回 `version/updatedAt/messages` 摘要供前端回填。

### 3.2 编辑后重发接口

建议新增内部接口：

```http
POST /internal/session/:userId/:sessionId/messages/resend-from
```

请求体：

```json
{
  "anchor": {
    "messageId": "optional",
    "dialogProcessId": "optional",
    "ts": "optional"
  },
  "content": "edited user content",
  "parentSessionId": "optional",
  "expectedVersion": 12,
  "idempotencyKey": "uuid"
}
```

语义：

1. 校验会话仍允许从 anchor 重发。
2. 必要时先停止当前运行中的 dialog/task，并等待状态收敛。
3. 在同一后端操作语义中执行级联删除。
4. 写入新的用户消息并触发后续生成流程，或返回一个可由现有 chat 入口继续发送的规范化请求。
5. 失败时不能留下“已删旧尾段但新消息未写入且不可恢复”的半状态；应返回明确错误和可重试状态。

## 4. 并发、幂等与失败补偿

- `expectedVersion`：前端提交操作时携带当前 session 版本；后端保存前比对，不一致返回 `409 Conflict`，要求前端刷新会话。
- `idempotencyKey`：同一用户、同一 session、同一操作 key 重放时返回相同结果，避免双击或重试导致重复删除/重复发送。
- 原子性：删除与重发应尽量放入同一服务方法；如果存储层不支持事务，也要用版本检查 + 操作日志保证可恢复。
- anchor 不存在：返回 `404` 或业务错误，不应按近似位置删除。
- anchor 已被删除：若命中相同幂等 key，返回上次结果；若不是同 key，返回冲突并要求刷新。

## 5. 前端协同改造

- `deleteMonotonicMessage` 不再只做本地裁剪，应调用后端 `delete-from`，成功后以后端返回 session 快照回填。
- `resendMonotonicMessage` 不再只做“本地删 -> send”，应调用后端 `resend-from` 或“后端删成功 -> 使用后端确认后的会话版本重发”。优先采用后端原子重发。
- 前端仍可保留乐观态，但必须在失败时以后端快照为准恢复。
- 停止运行前置逻辑应前后端统一：前端负责触发停止和禁用按钮，后端负责最终校验当前会话状态，防止并发脏写。

## 6. 验收矩阵

| 场景 | 操作 | 期望 |
| --- | --- | --- |
| 删除单调消息 | 点击删除并确认 | 后端 session 中 anchor 及之后消息被删除，刷新后不回流 |
| 编辑后重发 | 编辑内容后重发 | 后端不保留旧尾段，新用户消息进入 session，刷新后只看到新分支 |
| 删除期间仍在运行 | 点击删除 | 先停止运行，停止失败则不删除；停止成功才进入后端删除 |
| 重发期间仍在运行 | 点击重发 | 先停止运行，失败不删不发；成功后删除旧尾段并发送新内容 |
| 并发版本冲突 | 两端同时操作同一 session | 后端返回 409，前端刷新，不覆盖新状态 |
| 重复点击/请求重试 | 同一 idempotencyKey 重放 | 返回同一结果，不重复发送、不重复追加 |
| anchor 不存在 | 删除或重发不存在消息 | 不执行近似删除，返回明确错误 |
| 发送失败 | 旧尾段已删但新发送失败 | 返回可恢复状态；前端按后端快照恢复或提示重试 |

## 7. 推荐落地顺序

1. 在 `SessionMessageService` 增加纯服务方法：`deleteFromMessage`，先覆盖单元测试。
2. 在 session repo 或 session entity 层补 `version` / `revision` 字段，支持并发检查。
3. 增加路由 `delete-from`，前端删除改为调用该接口并回填快照。
4. 增加 `resend-from` 服务方法和路由，重发改为后端原子语义。
5. 补集成测试：删除后刷新、重发后刷新、并发冲突、幂等重放。
