/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_PLUGIN_DEFAULTS,
} from "./constants.js";

const DEFAULT_SEMANTIC_PROMPT = [
  "你是工作流语义编译器。",
  "请输出纯文本 DSL 协议，不要 JSON，不要 markdown。",
  "协议头必须为：WORKFLOW_DSL/1",
  "每行一条指令，仅允许 NODE/EDGE/AUTO/END。",
  "节点类型说明：",
  "- state: 状态节点（可配 stateType=start/end/branch/merge/normal）",
  "- action: 动作节点（需要 agent 执行任务，必须提供 task 字段描述可直接执行的任务）",
  "- composite: 复合节点（当前版本可输出，但建议先用 state/action）",
  "流转条件说明：EDGE 可带 when 条件，示例 when=\"eq(order.amount,100)\"。",
  "支持条件函数：always/never/exists(path)/eq(path,v)/ne(path,v)/gt/gte/lt/lte(path,v)/in(path,v1,v2,...)。",
  "示例:",
  "WORKFLOW_DSL/1",
  "NODE id=start type=state stateType=start name=\"开始\"",
  "NODE id=audit type=action name=\"审批\" task=\"审核订单并给出审批结论\"",
  "NODE id=end type=state stateType=end name=\"结束\"",
  "EDGE from=start to=audit name=\"开始到审批\" when=\"gte(order.amount,100)\"",
  "EDGE from=audit to=end name=\"审批到结束\" when=\"always\"",
  "AUTO type=submit stepIndex=0",
  "END",
  "规则:",
  "- NODE 必须包含 id/type，state 节点可带 stateType；action 节点必须包含 task。",
  "- EDGE 必须包含 from/to，且节点 id 必须存在；可选 when 条件。",
  "- AUTO type 仅允许 submit|audit|back|stop。",
].join("\n");

function normalizePriority(input = null) {
  const value = Number(input);
  if (!Number.isFinite(value)) return WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY;
  return Math.max(0, Math.floor(value));
}

function normalizeTimeoutMs(input = null) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS;
  return Math.floor(value);
}

function normalizeNodeAgentTimeoutMs(input = null) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    return WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
  }
  return Math.floor(value);
}

export function normalizeOptions(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const mode = String(source?.mode ?? WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF).trim().toLowerCase();
  const maxAutoTransitions = Number(source?.maxAutoTransitions);
  const maxParallelNodeAgents = Number(source?.maxParallelNodeAgents);

  return {
    enabled: source?.enabled !== false,
    mode:
      mode === WORKFLOW_PLUGIN_DEFAULTS.MODE_ON
        ? WORKFLOW_PLUGIN_DEFAULTS.MODE_ON
        : WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF,
    semanticPrompt:
      typeof source?.semanticPrompt === "string" && source.semanticPrompt.trim()
        ? source.semanticPrompt.trim()
        : DEFAULT_SEMANTIC_PROMPT,
    semanticModel: String(source?.semanticModel || "").trim(),
    maxAutoTransitions:
      Number.isFinite(maxAutoTransitions) && maxAutoTransitions > 0
        ? Math.floor(maxAutoTransitions)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    parallelNodeExecution: source?.parallelNodeExecution === true,
    maxParallelNodeAgents:
      Number.isFinite(maxParallelNodeAgents) && maxParallelNodeAgents > 0
        ? Math.floor(maxParallelNodeAgents)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
    nodeAgentTimeoutMs: normalizeNodeAgentTimeoutMs(source?.nodeAgentTimeoutMs),
    priority: normalizePriority(source?.priority),
    timeoutMs: normalizeTimeoutMs(source?.timeoutMs),
    capabilityModelInvoker:
      typeof source?.capabilityModelInvoker === "function" ? source.capabilityModelInvoker : null,
    nodeAgentExecutor:
      typeof source?.nodeAgentExecutor === "function" ? source.nodeAgentExecutor : null,
    subSessionRunner:
      typeof source?.subSessionRunner === "function" ? source.subSessionRunner : null,
    workflowDialogPersister:
      typeof source?.workflowDialogPersister === "function" ? source.workflowDialogPersister : null,
    workflowEventLogger:
      typeof source?.workflowEventLogger === "function" ? source.workflowEventLogger : null,
  };
}
