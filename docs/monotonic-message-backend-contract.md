# 单调消息后端真源契约基线

## 目标

以后端持久化 session 为真源，解决前端本地裁剪后刷新又回流的用户孤儿消息问题。

## 单调消息判定标准

单调消息只允许来自两类来源，前后端必须使用同一口径识别：

1. **前端停止来源**：用户点击停止后，前端在当前运行消息上形成的停止态标记。
2. **后端快照来源**：后端 session 返回的消息已进入执行完成态，完成态包含 `completed`、`done`、`stopped`。

字段归一化与优先级固定如下：

1. `isMonotonic === true` 或 `monotonic === true` 时，直接判定为单调消息。
2. `monotonicState` 归一化后等于 `monotonic` 时，判定为单调消息。
3. `stopState` 归一化后等于 `stopped` 时，判定为单调消息。
4. 按顺序读取 `state || status || channelState`，归一化后命中 `completed/done/stopped` 时，判定为单调消息。
5. `statusLabel` 仅作为展示兼容兜底，归一化后命中 `generated/已生成/stopped/已停止` 时，判定为单调消息。

归一化规则：字段值转字符串、去首尾空白、转小写；空值或未知值不得判定为单调消息。

禁止在不同入口维护第二套判定逻辑；列表、消息卡片、插件按钮显隐都必须复用上述标准。

## 单调操作锚点归一标准

单调消息用于识别“哪一轮对话可以执行删除/编辑后重发”，但为消除用户消息孤儿风险，所有单调操作的执行锚点必须统一归一到该轮对应的**用户消息**。

1. 按钮展示规则：命中单调判定的消息可以触发“删除/编辑后重发”能力，但最终传给删除/重发流程的目标必须是对应用户消息。
2. 删除起点规则：删除必须从归一后的用户消息开始，删除 `[userMessageIndex, messages.length)`，即删除该用户消息和之后全部消息。
3. 编辑后重发起点规则：编辑后重发必须先从归一后的用户消息开始完成同语义级联删除，删除成功后才发送编辑后的新用户消息。
4. 后端 anchor 规则：`delete-from` 的 `anchor` 一律由归一后的用户消息构造，不允许直接使用 assistant/tool/status 完成态消息作为持久化删除锚点。

归一查找规则固定如下：

1. 若目标单调消息本身是用户消息，直接作为执行锚点。
2. 否则优先查找同 `dialogProcessId/dialogId` 的用户消息。
3. 若无同轮次标识命中，则按消息顺序从目标单调消息向前回溯最近一条用户消息。
4. 仍无法解析到用户消息时，操作必须失败返回，不允许近似删除或从 assistant/tool/status 消息起删。

## 消息级删除契约

接口：`POST /internal/session/:userId/:sessionId/messages/delete-from`

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

1. 前端必须先按“单调操作锚点归一标准”将目标归一为对应用户消息，再用该用户消息构造 anchor。
2. 精确定位 anchor，优先级为 `messageId > dialogProcessId > ts`。
3. anchor 命中后删除 `[anchorIndex, messages.length)`，即目标用户消息和之后消息全部删除。
4. anchor 不存在时返回业务错误，不允许近似删除。
5. 保存后返回最新 session 快照，前端必须以后端快照回填。

## dialogId 与 dialogProcessId 映射口径封板

1. 后端 `delete-from` 不接收顶层 `dialogId`；唯一定位入口是 `anchor`。
2. 跨端标准字段固定为 `anchor.dialogProcessId`。
3. 前端若目标消息只有 `dialogId`，必须映射为 `anchor.dialogProcessId` 后再调用后端。
4. 后端匹配消息时兼容历史字段：消息对象上的 `dialogProcessId` 与 `dialogId` 均视为同一个会话轮次标识。
5. anchor 构造和匹配优先级封板为：`messageId > dialogProcessId(兼容 dialogId) > ts`。
6. 禁止新增或依赖 `anchor.dialogId` / 顶层 `dialogId`；避免跨端出现双字段分叉。
7. 若 `messageId` 与 `dialogProcessId` 同时存在，以 `messageId` 为准；若高优字段未命中，不降级近似删除。

## 编辑后重发契约

阶段一采用两阶段方案：

1. 前端先停止运行并等待 `sending` 收敛。
2. 将目标单调消息归一为对应用户消息，调用后端 `delete-from`，以后端真源删除目标用户消息及后续消息。
3. 前端用后端返回 session 快照回填。
4. 前端基于新快照调用现有 `send()` 发送编辑后的内容。

阶段二再升级为单接口 `resend-from` 原子语义：后端完成停止校验、级联删除、写入新用户消息并触发生成。

## 并发与幂等

- `expectedVersion`：第一阶段允许为空；若传入，后端与当前 session `version/revision` 比对，不一致返回 `409`。
- `idempotencyKey`：第一阶段接口接收并透传；持久幂等日志在版本字段稳定后补齐。
- 所有失败分支不得执行本地继续删除或继续发送。

## 响应基线

成功：

```json
{
  "ok": true,
  "session": {},
  "deletedCount": 1,
  "anchorIndex": 3,
  "version": 13
}
```

失败：

- `404`：anchor 不存在。
- `409`：版本冲突。
- `400`：请求缺少必要字段。

## 前端协同

- 删除：`deleteMonotonicMessage` 必须先将目标单调消息归一为对应用户消息，再调用 `delete-from`，成功后以后端快照回填。
- 重发：`resendMonotonicMessage` 改为“停止运行 -> 归一到对应用户消息 -> 后端 delete-from -> 快照回填 -> send 编辑内容”。
- 本地 `cascadeDeleteMessagesFrom` 只能作为快照处理辅助，不再代表持久化成功。
- UI 可在单调消息入口触发能力，但删除/重发入参与持久化 anchor 必须使用归一后的用户消息。

## 验收基线

1. 前端删除使用 `dialogId` 目标消息时，请求体必须是 `anchor.dialogProcessId`，不得出现顶层 `dialogId`。
2. 后端可用 `anchor.dialogProcessId` 命中仅含历史 `dialogId` 字段的消息。
3. 删除成功后必须以后端返回 session 快照回填；刷新会话不得回流被删尾段。
4. `404/409/400` 失败分支不得继续执行本地删除或编辑后发送。
5. assistant/tool/status 完成态消息命中单调判定时，删除/重发最终 anchor 必须回落到对应用户消息。
6. 无法解析对应用户消息时必须失败返回，禁止从非用户消息起删。
