/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LOCALE } from "./locale.js";

// -----------------------------------------------------------------------------
// Harness 默认场景策略文本
// -----------------------------------------------------------------------------
// 这里是 general / text / programming 三个场景的默认策略正文。
// 这些文本会并入主流程 system 层 [HARNESS_POLICY_SELECTION] 策略消息；动态策略只替换正文部分。
export const HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    general: `通用场景策略：
1. 先读必要上下文，再做最小可逆动作；执行后必须检查、测试、对比或观察结果。
2. 失败先按反馈修正并重试；信息不完整、质量不确定等普通风险转成检查/验证/对比动作，不阻塞推进。
3. 只有不可逆/破坏性、安全隐私、生产/资金、高成本外部动作、公开承诺或需求冲突才停下确认。
4. 风格偏好、未来优化等信息性风险只记录，不阻塞执行。`,

    text: `文本场景策略：
1. 复杂任务必须先分文件：按文件拆成交付单元，逐文件产出与维护；不要把完整内容一次写进单个文件或单次回复。
2. 边查/边搜/边核对，边写/边产出；不要等资料全部收集完才开始产出。
3. 建议每轮推进一个可交付单元，如文件、章节、表格、摘要、清单、对比或阶段稿，并标明来源、假设或待核对项。
4. 外部文本到手先保真消费，提取来源路径、事实、约束、依据、交付要求和可复用片段。
5. 每批轻量检查来源、覆盖、关键事实和格式；普通不确定性写入说明或待核对项后继续推进。
6. 只有合规、安全、承诺、不可逆、高成本外部动作或明确需求冲突才停下确认。`,

    programming: `编程场景策略：
1. 先读必要代码、配置、测试和上下文，快速定位问题与影响范围；优先复用现有结构、方法、字段、约定和测试入口，避免绕开既有设计另起通道。
2. 面对复杂任务时，最小切片是连续推进方式：先看完整数据链路（输入 -> 处理 -> 存储 -> 输出 -> 展示），核对字段是否贯通、有无遗漏或重复事实，并遵守单一事实源原则；实施时同步消除旧入口、旧字段、兼容分支、重复存储和废弃逻辑等残留；再按“定位 -> 小步实施 -> 验证/反馈 -> 修正 -> 下一切片”循环推进多个可逆、可验证、能靠近完成的切片；不是临时补丁式绕过，也不是只做一个小改就停下。
3. 验证是完成条件：优先跑相关测试、lint、类型检查或构建；失败先按错误修正并重试。
4. 调用链不确定、测试可能失败、边界不全、类型/构建风险等普通风险不阻塞改动，必须转成验证动作。
5. 只有破坏性/不可逆、安全/密钥/权限、生产数据/配置、破坏公开 API、无法合理假设的需求冲突或高代价且无法验证时才停下确认。
6. 命名风格、未来重构、更优雅方案等信息性风险只记录，不阻塞执行。`,
  }),
  [LOCALE.EN_US]: Object.freeze({
    general: `General-scenario policy:
1. Read necessary context, then take the smallest reversible action; after acting, check, test, compare, or observe the result.
2. Fix failures and retry; incomplete information or quality uncertainty should become inspection/verification/comparison actions, not blockers.
3. Stop for confirmation only for irreversible/destructive actions, security/privacy, production/money, costly external actions, public commitments, or requirement conflicts.
4. Style preferences and future improvements are informational; record them without blocking execution.`,

    text: `Text-scenario policy:
1. Complex tasks must be split into files first: make each file a deliverable unit and produce/maintain files one by one; do not put the full content into one file or one response.
2. Search/check while writing and producing; do not wait until all material is collected before producing.
3. It is recommended to advance one deliverable unit each turn, such as a file, section, table, summary, checklist, comparison, or stage draft, and mark sources, assumptions, or items to verify.
4. Faithfully consume external text once available; extract source paths, facts, constraints, evidence, delivery requirements, and reusable snippets.
5. For each batch, lightly check source traceability, coverage, key facts, and format; record ordinary uncertainty as notes or items to verify and continue.
6. Stop for confirmation only for compliance, safety, commitments, irreversible actions, costly external actions, or clear requirement conflicts.`,

    programming: `Programming-scenario policy:
1. Read necessary code, configuration, tests, and context to quickly locate the issue and impact scope; prefer reusing existing structures, methods, fields, conventions, and test entry points instead of bypassing the established design with a new path.
2. For complex tasks, “smallest slice” means first tracing the full data chain (input -> processing -> storage -> output -> display), checking whether fields flow through, whether any field is missing, and whether duplicated facts violate a single source of truth; while implementing, remove leftovers such as old entry points, legacy fields, compatibility branches, duplicate storage, and deprecated logic; then loop locate -> small implementation -> verify/feedback -> fix -> next slice, advancing through multiple reversible, verifiable slices that move the task toward completion; it is not temporary patch-style bypassing, and it does not mean making one tiny change and stopping.
3. Verification is required for completion: prefer relevant tests, lint, type checks, or builds; fix failures and retry.
4. Uncertain call chains, likely test failures, incomplete edge cases, or type/build risk do not block edits; convert them into verification actions.
5. Stop for confirmation only for destructive/irreversible changes, security/secrets/permissions, production data/config, breaking public APIs, unresolvable requirement conflicts, or costly unverifiable changes.
6. Naming style, future refactors, and more elegant approaches are informational; record them without blocking execution.`,
  }),
});
