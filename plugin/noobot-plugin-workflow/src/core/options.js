/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_PLUGIN_DEFAULTS,
} from "./constants.js";

export const DEFAULT_WORKFLOW_DENY_TOOL_NAMES = Object.freeze([
  "delegate_task_async",
  "wait_async_task_result",
  "plan_multi_task_collaboration",
]);

function normalizeToolNameList(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

export function resolveWorkflowDenyToolNames(input = null) {
  const normalized = normalizeToolNameList(input);
  if (normalized.length) return Array.from(new Set(normalized));
  return [...DEFAULT_WORKFLOW_DENY_TOOL_NAMES];
}

const DEFAULT_SEMANTIC_PROMPT = [
  "你是工作流语义编译器。",
  "将用户需求转换为 WORKFLOW_DSL/1 纯文本。",
  "只输出 DSL，不要 JSON，不要 markdown，不要解释。",
  "",
  "DSL 指令：",
  "- ATTACHMENT id=\"...\" name=\"...\" path=\"...\" [mimeType=\"...\"]",
  "- NODE id=... type=state|action name=\"...\" [stateType=start|end|branch|merge] [task=\"...\"] [attachments=\"...\"]",
  "- EDGE from=... to=...",
  "- AUTO type=submit stepIndex=0",
  "- END",
  "",
  "语义：",
  "- 串行：action 按 EDGE 顺序依次执行。",
  "- 并发：使用 stateType=branch 分出多个 action，使用 stateType=merge 汇聚。",
  "- action 必须写 task，task 是子 agent 可直接执行的任务描述。",
  "- 如果输入里包含“用户附件”列表，且某个 action 需要读取/参考附件，先输出 ATTACHMENT 映射行，再在该 NODE 上写 attachments。",
  "- ATTACHMENT 用于声明附件 id 与路径映射；id 优先使用用户附件列表里的 attachmentId，path 使用用户附件列表里的可读路径。",
  "- attachments=\"user:*\" 表示该节点使用全部用户附件。",
  "- attachments=\"attachmentId1,attachmentId2\" 表示该节点只使用指定附件；优先引用 ATTACHMENT 的 id。",
  "- 不要把附件路径拼进 task；task 只描述任务，id/path 映射写 ATTACHMENT，节点依赖只写 attachments。",
  "",
  "示例：",
  "WORKFLOW_DSL/1",
  "ATTACHMENT id=\"att_001\" name=\"用户附件.pdf\" path=\"/workspace/attachments/用户附件.pdf\" mimeType=\"application/pdf\"",
  "NODE id=start type=state stateType=start name=\"开始\"",
  "NODE id=branch type=state stateType=branch name=\"并发分叉\"",
  "NODE id=a type=action name=\"任务A\" task=\"读取用户附件并完成任务A\" attachments=\"att_001\"",
  "NODE id=b type=action name=\"任务B\" task=\"完成任务B并输出结果\"",
  "NODE id=merge type=state stateType=merge name=\"汇聚\"",
  "NODE id=end type=state stateType=end name=\"结束\"",
  "EDGE from=start to=branch",
  "EDGE from=branch to=a",
  "EDGE from=branch to=b",
  "EDGE from=a to=merge",
  "EDGE from=b to=merge",
  "EDGE from=merge to=end",
  "AUTO type=submit stepIndex=0",
  "END",
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

function normalizeWorkflowExtensions(input = null) {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => typeof item === "function");
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
    generatedArtifactPersister:
      typeof source?.generatedArtifactPersister === "function"
        ? source.generatedArtifactPersister
        : null,
    workflowDialogPersister:
      typeof source?.workflowDialogPersister === "function" ? source.workflowDialogPersister : null,
    workflowEventLogger:
      typeof source?.workflowEventLogger === "function" ? source.workflowEventLogger : null,
    workflowNodeSystemMessageBuilder:
      typeof source?.workflowNodeSystemMessageBuilder === "function"
        ? source.workflowNodeSystemMessageBuilder
        : null,
    workflowExtensionMounter:
      typeof source?.workflowExtensionMounter === "function" ? source.workflowExtensionMounter : null,
    workflowExtensions: normalizeWorkflowExtensions(source?.workflowExtensions),
    denyToolNames: resolveWorkflowDenyToolNames(source?.denyToolNames),
  };
}
