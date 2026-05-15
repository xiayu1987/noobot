# useReconnectReplay 测试用例矩阵（对照版）

更新时间：2026-05-15  
对应测试文件：`tests/unit/composables/chat/useReconnectReplay.spec.js`

## 阶段 1：入口路由（applyReconnectData / applyReconnectEvent）

| 用例 ID | 目标 | 当前状态 | 对应用例 |
|---|---|---|---|
| RT-01 | 批量历史按 session/dp 路由（活跃 apply，非活跃缓存） | ✅ 已覆盖 | `RT-01: applyReconnectData routes active to replay and non-active to replayCache` |
| RT-02 | 单条实时事件到达（活跃会话）直接 apply 不走 cache | ✅ 已覆盖 | `RT-02: active realtime event applies directly and does not write replayCache` |
| RT-03 | 单条实时事件到达（非活跃会话）仅写 cache，不更新 UI | ✅ 已覆盖 | `RT-03: non-active realtime event writes cache only` |
| RT-04 | 会话切换后消费缓存，且不重复 apply | ✅ 已覆盖 | `RT-04: cached events are consumed after session switch without duplicate apply` |

## 阶段 2：序列去重与过滤（Sequence）

| 用例 ID | 目标 | 当前状态 | 对应用例 |
|---|---|---|---|
| SQ-01 | 正常递增序列 [1,2,3] 全部 apply，记录 3 | ✅ 已覆盖 | `SQ-01: increasing sequence applies in order and records max sequence` |
| SQ-02 | 乱序 [3,1,2] 只应用 >lastApplied | ✅ 已覆盖 | `SQ-02/SQ-03: out-of-order and duplicate sequence are deduplicated` |
| SQ-03 | 重复重放 [1,2] 第二次全部跳过 | ✅ 已覆盖 | `SQ-02/SQ-03: out-of-order and duplicate sequence are deduplicated` |
| SQ-04 | 断层 last=2 收到 [5,6] 允许推进 | ✅ 已覆盖 | `SQ-04: sequence gap is allowed and progresses watermark` |

## 阶段 3：事件分发与 UI 更新

| 用例 ID | 目标 | 当前状态 | 对应用例 |
|---|---|---|---|
| EV-01 | DELTA 追加 content，不改 pending | ✅ 已覆盖 | `EV-01: DELTA appends content and keeps pending unchanged` |
| EV-02 | THINKING 更新日志并保持 pending=true | ✅ 已覆盖 | `EV-02: THINKING updates logs and keeps pending true` |
| EV-03 | INTERACTION_REQUEST 触发交互请求态 | ✅ 已覆盖（当前实现语义） | `EV-03: INTERACTION_REQUEST sets pending interaction without terminal cleanup` |
| EV-04 | DONE：pending=false、statusLabel、终态清理 | ✅ 已覆盖 | `EV-04: DONE sets terminal ui fields and finalizes state` |
| EV-05 | STOPPED：同 DONE 但 stopped | ✅ 已覆盖 | `EV-05: STOPPED sets stopped status and finalizes state` |
| EV-06 | ERROR：pending=false、写 error、清理 sending | ✅ 已覆盖 | `EV-06/FN-01: ERROR finalizes terminal state` |

## 阶段 4：终态处理与资源清理

| 用例 ID | 目标 | 当前状态 | 对应用例 |
|---|---|---|---|
| FN-01 | DONE/STOPPED/ERROR 终态清理只执行一次 | ✅ 已覆盖 | `FN-01: %s duplicate replay finalizes only once` |
| FN-02 | cacheExpired 定时器触发后清空 replayCache | ✅ 已覆盖 | `FN-02: cacheExpired timer refreshes sessions and clears replayCache` |
| FN-03 | 组件卸载/会话关闭清理 timer，无泄漏 | ✅ 已覆盖 | `FN-03: timer is cleaned on scope dispose` |

## 边界/竞态（重点防御）

| 用例 ID | 目标 | 当前状态 | 对应用例 |
|---|---|---|---|
| RC-01 | 快速切会话，不 apply 到错误 session | ✅ 已覆盖 | `RC-01: rapid session switching does not apply replay to wrong session` |
| RC-02 | 断线重连+历史并发，同 seq 不重复 apply | ✅ 已覆盖 | `RC-02: applyReconnectData + realtime event mixed replay still deduplicates by sequence` |
| RC-03 | 超大包（>1000）不卡死（分帧/idle） | ✅ 已覆盖（基础稳定性） | `RC-03: large reconnect batch (>1000 envelopes) can be applied without crash` |
| RC-04 | 终态后继续 DELTA 必须拦截 | ✅ 已覆盖 | `RC-04: terminal event blocks subsequent DELTA mutation` |
| RC-05 | dialogProcessId 缺失时安全处理 | ✅ 已覆盖 | `RC-05: missing dialogProcessId does not throw and uses safe cache key` |

## Checklist 对照（现状）

- [x] replayCache 读写一致性（跨会话）  
- [x] Sequence 去重（乱序/重复/断层）  
- [x] 终态拦截（DONE 后 DELTA）  
- [x] fakeTimers 测缓存过期  
- [x] 副作用调用顺序断言（`appendMessage -> finalize -> scrollBottom`）  
- [ ] “19 个依赖分组 Mock”结构化（当前已有分组，但未到 19 颗粒度）  

## 建议下一个最小补充包（可选增强）

1. EV-03 若后续产品要求“设置 `interactionSubmitting=true` 并暂停渲染”，可补强状态级断言。  
2. RC-03 若后续引入分帧/`requestIdleCallback`，再补性能基准与帧率相关用例。  
3. Mock 分层进一步模板化（依赖大于 19 时便于维护）。  
