# Plan Mutation 引擎归一化重构方案（执行中）

> 目标：统一 planning capture / revision / refinement 的“解析 → 分类 → 应用 → 校验”链路，消除计划文本被异常收缩（如 `2. 主计划 2` 占位坍缩）问题。

## 1. 背景与问题

历史问题表现：

- revision 阶段收到子计划 patch（如 `UPDATE 2.8`）时，旧回退链路可能把全量计划误替换为占位主计划。
- planning capture 对“非空文本”过于宽松，可能把非计划文本当成功捕获。
- 解析/回退逻辑分散在多个文件，阶段语义不一致，回归难度高。

## 2. 目标状态（统一语义）

- `planning_capture`：仅接受“可解析主计划文本”。
- `revision`：
  - 主计划 patch 正常应用；
  - 子计划 patch 兼容路径：**直接按 refinement 语义本地应用，不额外调用模型**。
- `refinement`：允许主计划 patch + 子计划 patch（可混合），统一本地应用。
- 全阶段统一不变量校验：禁止出现“多主计划坍缩为单占位主计划”。

## 3. 分步执行计划

### Step 1 - 抽象统一策略层（已完成）

- 新增 `mutation-policy.js`
- 统一 stage 归一、兼容策略、占位主计划识别策略。

涉及文件：

- `src/capabilities/handlers/shared/plan/mutation-policy.js`

---

### Step 2 - 抽象统一引擎层（已完成）

- 新增 `mutation-engine.js`，提供统一入口：
  - `parsePlanMutation`
  - `classifyPlanMutation`
  - `applyPlanMutation`
  - `validatePlanInvariants`
- 在引擎中固化 revision 子计划 patch 的本地兼容应用逻辑（无额外模型调用）。

涉及文件：

- `src/capabilities/handlers/shared/plan/mutation-engine.js`

---

### Step 3 - 接入 revision 主链路（已完成）

- `revision-helpers.js` 的 `applyRevisedPlanFromText` 改为走统一引擎。
- 保留必要兼容回退，仅在非 patch 且非主计划时才允许 raw append。

涉及文件：

- `src/capabilities/handlers/shared/plan/revision-helpers.js`

---

### Step 4 - 接入 planning capture 主链路（已完成）

- `result-pipeline.js` 的 `applyPlanText` 改为走统一引擎 `planning_capture` stage。
- capture 不再“非空即成功”，必须是可解析主计划。

涉及文件：

- `src/capabilities/handlers/planning/result-pipeline.js`

---

### Step 5 - 同类回归测试补强（已完成）

- 新增/更新测试覆盖：
  - 子计划 patch 不再生成占位主计划
  - revision 中子计划 patch 可本地应用且不坍缩
  - capture 对无主计划文本拒绝并走 retry

涉及文件：

- `__tests__/plan-protocol-refinement-id.test.js`
- `__tests__/plan-revision-subplan-preserve.test.js`
- `__tests__/planning-result-pipeline.test.js`
- `__tests__/harness-planning.test.js`
- `__tests__/harness-review-acceptance.test.js`

---

### Step 6 - 可观测性统一（已完成）

已完成内容：

- 新增 `mutation-observability.js`，统一 mutation 生命周期日志发射：
  - parsed / applied / rejected / invariant_blocked / stage_mismatch_autocoerced
- `revision-helpers.js` 与 `result-pipeline.js` 均改为调用统一日志发射器，避免各处硬编码事件名与 detail 字段不一致。
- 事件名统一来自 `WORKFLOW_PARAMS.logging.events.planning`。

---

### Step 7 - 继续迁移 refinement / acceptance 读路径（已完成首轮归一与排查）

- 将 refinement 入口与 acceptance 计划读取路径逐步统一到同一引擎/渲染约束。
- 目标是彻底消除跨模块解析差异。

首轮结果：

- refinement 写路径：统一经 `applyRevisedPlanFromText -> applyPlanMutation`。
- acceptance 读路径：统一基于 `parsePlanDocumentFromText/renderPlanDocument` 读取，不再存在独立 patch 应用分支。
- 未再发现会把全量计划“缩成单主计划占位”的同类入口。

## 4. 当前执行结果

- 已完成 Step 1 ~ Step 7（Step 7 为首轮归一/排查完成）。
- 已新增 Step 8（单一 facade API 收敛）并完成：
  - 新增 `mutation-facade.js`，对外统一 `executePlanMutation(...)`；
  - `revision-helpers.js` / `result-pipeline.js` 均改为通过 facade 调用引擎与可观测性逻辑。
- 已新增 Step 9（公开 API 边界收口）并完成：
  - `mutation-engine.js` 仅保留 `runPlanMutationEngine` 导出，解析/分类/校验函数改为内部私有；
  - 增加边界测试，限制仅 facade 可直接 import mutation-engine。
- 已验证全量测试通过（`173 pass, 0 fail`）。

执行命令（2026-06-01 最近一次）：

```bash
cd plugin/noobot-plugin-harness
node --test __tests__/*.test.js
```

## 5. 风险与回滚

- 风险：capture 变严格后，历史“容错接收非计划文本”的行为会被拒绝并重试。
- 回滚：可临时在策略层放宽 `planning_capture`，但不建议恢复到“非空即成功”。
