# parentSessionId 全项目收敛方案（先文档后执行）

> 状态：Draft（待执行）  
> 创建日期：2026-06-08  
> 适用范围：agent / service / model-proxy / workflow 相关链路

---

## 1. 背景与问题

当前 `parentSessionId` 在项目中存在多来源、多命名、多层 fallback：

- `runtime.systemRuntime.parentSessionId`
- `runtime.parentSessionId`
- `agentContext.parentSessionId`
- `agentContext.session.parent.id`
- 请求头里也存在多个命名兼容（如 `parentsessionid`、`x-parent-session-id` 等）

这会带来：

1. 语义不一致（谁是“真值”不明确）
2. 调试困难（链路断点难定位）
3. 改造风险高（每次都怕漏兼容）

---

## 2. 收敛目标

### 2.1 单一真源（Single Source of Truth）

- **运行时真源字段**：`runtime.systemRuntime.parentSessionId`
- 其余位置只作为过渡兼容读取，不再作为主写入目标。

### 2.2 对外协议（Header）统一

- 模型访问 header 主键固定为：`parentSessionid`
- `model-proxy` 目录归档规则固定：
  - `parentSessionid` 为空 => root session
  - `parentSessionid` 非空 => child session 归档到 parent 下

### 2.3 兼容策略（渐进式）

- 第一阶段：读兼容 + 写收敛
- 第二阶段：日志告警 legacy 来源
- 第三阶段：移除 legacy fallback（破兼容窗口前明确公告）

---

## 3. 边界与非目标

### In scope

- 模型请求 header 的 `parentSessionid` 注入链路
- model-proxy 的 parent/child 树形归档
- 与 session 运行时上下文有关的字段读取/写入规范

### Out of scope（本轮不做）

- session tree 持久化格式重构
- 历史日志目录迁移脚本（可后续单开）
- 非 parentSessionId 的其他 header 命名清理

---

## 4. 统一规范（执行后必须满足）

1. **写入规范**  
   新代码只允许写入 `runtime.systemRuntime.parentSessionId`。

2. **读取规范（阶段化）**  
   - Phase A：允许兼容读取，但封装到统一 resolver
   - Phase B：默认只读真源；legacy 读取触发 warning
   - Phase C：删除 legacy 读取

3. **Header 规范**  
   - 发出：`parentSessionid`
   - 接收：Phase A 可兼容别名，Phase C 仅保留主键（或仅保留主键 + 明确白名单）

4. **日志路径规范**  
   - root: `<model>/<flow>/<sessionId>/...`
   - child: `<model>/<flow>/<parentSessionId>/children/<sessionId>/...`

---

## 5. 分阶段执行计划（一步一步）

## Phase 0：盘点与基线（只读，不改行为）

- [ ] 统计全仓 `parentSessionId` 读写点位（文件+用途）
- [ ] 标注三类点位：主链路 / 适配层 / 历史兼容
- [ ] 补充基线测试清单（模型请求头、proxy 归档、子会话链路）

交付物：

- 点位清单（可附在本文件末尾）
- 基线测试结果（通过/失败）

---

## Phase 1：提取统一 resolver（行为不变）

- [ ] 新增统一读取函数（例如 `resolveParentSessionId(...)`）
- [ ] 现有分散 fallback 全部改为调用 resolver
- [ ] 保持外部行为不变（仍兼容 legacy 输入）

验收：

- [ ] 现有测试全绿
- [ ] 新增 resolver 单测覆盖多输入来源

---

## Phase 2：写路径收敛（开始控增量）

- [ ] 新代码禁止写 legacy 字段（仅写 `runtime.systemRuntime.parentSessionId`）
- [ ] 关键构造器/工厂处统一回填真源
- [ ] 在 CI 增加规则：阻止新增分散 fallback 模式

验收：

- [ ] 新增/修改代码不再出现新的“多重 fallback 拼接”
- [ ] 模型 header 仍稳定带出 `parentSessionid`

---

## Phase 3：兼容读取告警（可观测）

- [ ] 当 resolver 命中 legacy 来源时，打结构化 warning 日志
- [ ] 日志包含：来源字段、sessionId、调用点
- [ ] 连续观察一段时间，评估是否可去兼容

验收：

- [ ] 可统计 legacy 命中率
- [ ] 命中率达标后进入 Phase 4

---

## Phase 4：去兼容（行为变更）

- [ ] 删除 legacy fallback
- [ ] 删除别名 header 读取（按最终白名单）
- [ ] 文档更新 + 发布说明

验收：

- [ ] 全量回归通过
- [ ] 没有 legacy 命中日志（因为已移除）

---

## 6. 回归测试清单（每阶段都跑）

1. 主 agent 请求模型：header 含 `parentSessionid`
2. root session 请求：proxy 归档到 root 路径
3. child session 请求：proxy 归档到 `parent/children/child` 路径
4. workflow 子任务链路：parentSessionId 不丢失
5. multimodal tool 请求：header 同步规则一致

---

## 7. 风险与回滚

### 风险

- 某些旧入口仍只提供 legacy 字段，去兼容过早会断链。

### 回滚策略

- 每个 Phase 独立提交（可单独回滚）
- Phase 4 前必须有 Phase 3 观测数据支撑

---

## 8. 执行记录（按步骤更新）

- 2026-06-08：创建本方案文档（Draft）
- 2026-06-08：完成初步代码盘点，`parentSessionId/parentSessionid` 相关命中约 **449** 处（agent 为主）。
- 2026-06-08：Phase 1（部分）已开始：新增统一 resolver `agent/src/system-core/context/parent-session-id-resolver.js`，并接入 `chat-model` header 注入链路；新增 resolver 单测。
- 2026-06-08：Phase 1（继续）：`tools/index.js` 与 `multimodal-generate-tool.js` 已改为统一调用 resolver（行为不变，仅读取收口）。
- 2026-06-08：Phase 1（继续）：`capability-mini-runner` 与 `model/tool/compatibility-log` 的 parentSessionId 读取已收口到统一 resolver。
- 2026-06-08：Phase 1（继续）：`agent/core` 关键链路（`llm-invoker`、`turn/response-processor`、`turn/orchestrator`、`context/message-builder`）已改为统一 resolver 读取。
- 2026-06-08：Phase 1（继续）：`context` 映射层（`agent-context-accessor`、`agent-context-mapper`）已改为统一 resolver 读取 parentSessionId。
- 2026-06-08：Phase 1（继续）：`bot-manage / event / hook` 关键读取点（`execution/runner`、`session-execution-engine`、`event/execution-listener`、`hook/index`）已收口到统一 resolver；相关测试通过。
- 2026-06-08：Phase 1 收官复扫：`agent/src/system-core` 仍有约 **51** 处 `parentSessionId` 相关归一/回填代码，主要集中在 `session/*` 持久化与实体规范化层（属于 in-scope 保留）；未发现新的“模型/header 主链路分散 fallback”新增点。
- 2026-06-08：Phase 2（起步）：新增 `normalizeParentSessionId`（统一写入归一化函数），并接入关键写路径：`context/providers/environment-provider.buildDynamicInfo`、`context/index._buildSystemRuntime`（含 patch 后再归一）、`bot-manage/hook.resolveBotHookRuntimeMeta`、`agent/core/context/agent-context-factory._buildContextHookBase`。
- 2026-06-08：Phase 2（继续）：补齐写路径归一化到 `normalizeParentSessionId`：`bot-manage/async/session-runner`、`bot-manage/execution/finalizer`、`tracking/core/log-writer`、`tracking/execution-log/execution-log-repository`、`tools/workflow/agent-collab/*`（artifact persist/task summary/wait/container store）、`context/index` 的工具构建入参。复扫后相关命中由约 **51** 降至约 **43**（剩余主要为 `session/*` 存储与必要业务 fallback）。
- 2026-06-08：Phase 2（继续）：补齐 `parent-async-task-manager`、`agent/core/context/message-builder`、`tools/core/check-tool-input`、`agent/core/execution/tool-runner` 等点位的归一化。新增守护脚本 `scripts/check-parent-sessionid-unification.mjs`（并接入 `npm run check:parent-sessionid-unification`），用于阻止非白名单区域新增分散写法。
- 2026-06-08：Phase 2（继续）：对剩余点位再收敛一轮后，扫描命中降至约 **28**（`session/*` 约 21、`bot-manage/*` 约 4、`tools/*` 约 3）。其中多数为：
  - `session/*`：仓储/实体/路径层的持久化归一（保留）
  - `bot-manage/session-execution-engine`：业务语义 fallback（`strategy.parentSessionId -> sourceContext.sessionId`，保留）
  - `tools/index` / `tool-json-result`：非写路径 fallback 或字段白名单（保留）
- 2026-06-08：Phase 3（起步）：在 `context/parent-session-id-resolver` 增加来源元信息解析与 legacy 来源告警事件 `parent_sessionid_legacy_source_warning`（按 `source+value` 去重发出），用于兼容读取命中观测；新增对应单测。
- 2026-06-08：按“去兼容”要求执行收敛：`resolveParentSessionId` 已移除 legacy 读取来源（`runtime.parentSessionId`、`agentContext.parentSessionId`、`agentContext.session.parent.id` 等），仅保留 canonical 来源（`context/option.parentSessionId` 与 `runtime.systemRuntime.parentSessionId`）；对应测试已更新并通过。

### 8.1 Phase 1 收官结论

- 读取收口（主链路）已完成：model/tool/agent-core/context/bot-manage/event/hook。
- 现存命中主要是：
  1) session 仓储与实体规范化（`String(parentSessionId || \"\")`）  
  2) 业务语义 fallback（如子会话策略 `strategy.parentSessionId || sourceContext.sessionId`）  
  3) 序列化输出字段规范化（非多源读取）

以上不作为 Phase 1 阻塞项，进入 Phase 2（写路径收敛）。

### 8.2 Phase 2 收官清单（剩余点位与保留理由）

当前扫描剩余约 **28** 处（按文件归并后 11 个文件）：

1. `agent/src/system-core/session/session-path-resolver.js`  
2. `agent/src/system-core/session/repositories/file-system-session-tree-repository.js`  
3. `agent/src/system-core/session/repositories/file-system-session-repository.js`  
4. `agent/src/system-core/session/services/session-tree-service.js`  
5. `agent/src/system-core/session/services/session-crud-service.js`  
6. `agent/src/system-core/session/entities/session-entity.js`  
7. `agent/src/system-core/bot-manage/session/session-execution-engine.js`  
8. `agent/src/system-core/bot-manage/async/session-runner.js`  
9. `agent/src/system-core/tools/index.js`  
10. `agent/src/system-core/tools/workflow/agent-collab/collab-artifact-persist.js`  
11. `agent/src/system-core/tools/core/tool-json-result.js`  

保留分类：

- **A. session 存储/实体层（保留）**  
  用于仓储回填、树遍历、实体规范化，属于数据层 canonicalization，不是模型/header 主链路 fallback。

- **B. 业务语义 fallback（保留）**  
  `session-execution-engine` 中 `strategy.parentSessionId -> sourceContext.sessionId` 为业务策略兜底。

- **C. 非写路径或白名单判断（保留）**  
  如 `tools/index` 的 `depthTargetSessionId = sessionId || parentSessionId`、`tool-json-result` 的字段名白名单判断。

- **D. 已收敛但被规则命中（可接受）**  
  `session-runner` 中 `normalizeParentSessionId(parentSessionId)` 所在行因同一行包含 `sessionId || ""` 被简单规则命中。

结论：

- **Phase 2 目标已达成**：主链路写入已统一到 `normalizeParentSessionId`，并新增守护脚本阻止新增散落写法。  
- 下一阶段可进入 **Phase 3（兼容读取命中观测）**。
