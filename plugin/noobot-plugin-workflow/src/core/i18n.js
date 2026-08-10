/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowAgentContext, resolveWorkflowRuntimeFromContext } from "./hooks/runtime.js";

export const WORKFLOW_LOCALE = Object.freeze({
  ZH_CN: "zh-CN",
  EN_US: "en-US",
});

export const WORKFLOW_I18N_KEYSET = Object.freeze({
  COMMON: Object.freeze({
    CURRENT_NODE_FALLBACK: "workflowCurrentNodeFallback",
    CURRENT_NODE_LINE: "workflowCurrentNodeLine",
  }),
  SEMANTIC: Object.freeze({
    PLAN_BY_CONTEXT: "workflowSemanticPlanByContext",
    CURRENT_USER_MESSAGE: "workflowSemanticCurrentUserMessage",
    SOURCE_INPUT: "workflowSemanticSourceInput",
    EMPTY: "workflowSemanticEmpty",
  }),
  DSL_ERROR: Object.freeze({
    PREFIX: "workflowDslErrorPrefix",
    EMPTY_TEXT: "workflowDslErrorEmptyText",
    JSON_NOT_ALLOWED: "workflowDslErrorJsonNotAllowed",
    MISSING_HEADER: "workflowDslErrorMissingHeader",
    NO_NODE: "workflowDslErrorNoNode",
    NO_EDGE: "workflowDslErrorNoEdge",
    NODE_ID_REQUIRED: "workflowDslErrorNodeIdRequired",
    NODE_ID_DUPLICATE: "workflowDslErrorNodeIdDuplicate",
    NODE_TYPE_INVALID: "workflowDslErrorNodeTypeInvalid",
    EDGE_FROM_TO_REQUIRED: "workflowDslErrorEdgeFromToRequired",
    EDGE_CONDITION_UNSUPPORTED: "workflowDslErrorEdgeConditionUnsupported",
    EDGE_UNDEFINED_NODE: "workflowDslErrorEdgeUndefinedNode",
    AUTO_TYPE_INVALID: "workflowDslErrorAutoTypeInvalid",
    UNKNOWN_COMMAND: "workflowDslErrorUnknownCommand",
    LINE_LABEL: "workflowDslLineLabel",
  }),
  DSL_DEFAULT_NODE: Object.freeze({
    START_NAME: "workflowDslDefaultStartNodeName",
    END_NAME: "workflowDslDefaultEndNodeName",
  }),
  INPUT: Object.freeze({
    DEFAULT_LABEL: "workflowInputDefaultLabel",
    USER_RAW_TITLE: "workflowUserRawAttachmentsTitle",
    SYSTEM_HINT: "workflowInputAttachmentsSystemHint",
    HEADER: "workflowInputAttachmentsHeader",
    PLAN_HINT_1: "workflowInputAttachmentsPlanHint1",
    PLAN_HINT_2: "workflowInputAttachmentsPlanHint2",
    PLAN_HINT_3: "workflowInputAttachmentsPlanHint3",
    PLAN_HINT_4: "workflowInputAttachmentsPlanHint4",
  }),
  NODE_AGENT: Object.freeze({
    UPSTREAM_NODE_FALLBACK: "workflowUpstreamNodeFallback",
    SUB_AGENT_FAILURE_FALLBACK: "workflowSubAgentFailureFallback",
    FAILURE_LINE_WITH_TASK: "workflowFailureLineWithTask",
    FAILURE_LINE_WITHOUT_TASK: "workflowFailureLineWithoutTask",
    UPSTREAM_ATTACHMENTS_TITLE: "workflowUpstreamAttachmentsTitle",
    UPSTREAM_HINT: "workflowUpstreamHint",
    UPSTREAM_FAILURE_TITLE: "workflowUpstreamFailureTitle",
    UPSTREAM_RESULT_TITLE: "workflowUpstreamResultTitle",
    NODE_INSTRUCTION_BY_NAME: "workflowNodeInstructionByName",
    NODE_INSTRUCTION_BY_ID: "workflowNodeInstructionById",
    NODE_INSTRUCTION_DEFAULT: "workflowNodeInstructionDefault",
  }),
  PERSISTENCE: Object.freeze({
    NODE_RESULT_ATTACHMENT_TITLE: "workflowNodeResultAttachmentTitle",
    NODE_RESULT_TITLE: "workflowNodeResultTitle",
    NODE_UNNAMED_FALLBACK: "workflowNodeUnnamedFallback",
    NODE_LINE: "workflowNodeLine",
    NODE_ID_LINE: "workflowNodeIdLine",
    SUB_SESSION_LINE: "workflowSubSessionLine",
    DIALOG_LINE: "workflowDialogLine",
    FINAL_OUTPUT_TITLE: "workflowFinalOutputTitle",
  }),
  MESSAGES: Object.freeze({
    NO_DESCRIPTION: "workflowNoDescription",
    AVAILABLE_TOOLS_HEADER: "workflowAvailableToolsHeader",
    AVAILABLE_TOOLS_TASK_HINT: "workflowAvailableToolsTaskHint",
    TOOL_CALL_UNKNOWN_SCRIPT: "workflowToolCallUnknownScript",
    TOOL_CALL_NO_ARGUMENTS: "workflowToolCallNoArguments",
    TOOL_CALL_SEMANTIC_LINE: "workflowToolCallSemanticLine",
  }),
});

const WORKFLOW_I18N_TEXT = Object.freeze({
  [WORKFLOW_LOCALE.ZH_CN]: Object.freeze({
    workflowNoDescription: "（无说明）",
    workflowAvailableToolsHeader: "当前可用工具（name/description），规划工作流 action 节点时必须参考：",
    workflowAvailableToolsTaskHint:
      "如果某个 action 节点应使用工具，请把合适的工具名写进该 NODE 的 task。不要臆造工具名；如果没有相关工具，就按普通任务描述。",
    workflowToolCallUnknownScript: "未知脚本",
    workflowToolCallNoArguments: "无参数",
    workflowToolCallSemanticLine: "工具调用记录：{name}脚本被调用,参数{args}",
    workflowSemanticPlanByContext: "请基于以上会话上下文和以下当前用户消息规划工作流。",
    workflowSemanticCurrentUserMessage: "当前用户消息:\n{message}",
    workflowSemanticSourceInput: "主模型回复/工作流源输入:\n{source}",
    workflowSemanticEmpty: "(empty)",
    workflowInputDefaultLabel: "附件{index}",
    workflowNodeResultAttachmentTitle: "## 工作流节点结果附件",
    workflowInputAttachmentsHeader: "用户附件（节点通过 canonical attachmentId 引用）:",
    workflowInputAttachmentsPlanHint1:
      "规划工作流时，节点如需使用用户附件，只在 NODE 的 attachments 字段填写运行时提供的 canonical attachmentId。",
    workflowInputAttachmentsPlanHint2:
      "节点附件引用只传递 attachmentId；sessionId 和 attachmentSource 由运行时附件事实源校验，不在 DSL 中重复声明。",
    workflowInputAttachmentsPlanHint3:
      "attachments=\"user:*\" 表示使用全部用户附件；attachments=\"attachmentId1,attachmentId2\" 表示使用指定 canonical attachmentId。",
    workflowInputAttachmentsPlanHint4:
      "不要把附件路径写入 task 或 DSL；路径只能由附件服务根据 canonical attachmentId 解析。",
    workflowCurrentNodeFallback: "当前节点",
    workflowUserRawAttachmentsTitle: "# 用户原始附件",
    workflowCurrentNodeLine: "当前节点：{name}",
    workflowInputAttachmentsSystemHint:
      "以下附件由工作流规划绑定到当前节点，来自本轮用户输入。执行任务时请按需读取/参考这些附件。",
    workflowUpstreamNodeFallback: "上游节点",
    workflowSubAgentFailureFallback: "子 agent 执行失败",
    workflowFailureLineWithTask: "- {nodeLabel}（任务：{task}）: {message}",
    workflowFailureLineWithoutTask: "- {nodeLabel}: {message}",
    workflowUpstreamAttachmentsTitle: "# 上游工作流节点结果附件",
    workflowUpstreamHint:
      "以下信息来自直接上游动作节点。请在执行当前任务前先读取/参考可用附件；如果上游节点失败且无附件，请基于失败信息继续完成当前节点可完成的部分，并明确说明受影响范围。",
    workflowUpstreamFailureTitle: "## 上游失败节点",
    workflowUpstreamResultTitle: "## 上游结果附件",
    workflowNodeResultTitle: "# 工作流节点执行结果",
    workflowNodeUnnamedFallback: "未命名节点",
    workflowNodeLine: "- 节点: {name}",
    workflowNodeIdLine: "- 节点ID: {id}",
    workflowSubSessionLine: "- 子会话: {id}",
    workflowDialogLine: "- 对话: {id}",
    workflowFinalOutputTitle: "## 最终输出",
    workflowNodeInstructionByName: "请处理任务：{name}",
    workflowNodeInstructionById: "请处理节点任务：{id}",
    workflowNodeInstructionDefault: "请处理当前任务。",
    workflowDslErrorPrefix: "工作流 DSL 解析错误",
    workflowDslErrorEmptyText: "文本为空",
    workflowDslErrorJsonNotAllowed: "不支持 JSON 输入",
    workflowDslErrorMissingHeader: "缺少协议头 '{header}'",
    workflowDslErrorNoNode: "未找到 NODE",
    workflowDslErrorNoEdge: "未找到 EDGE",
    workflowDslErrorNodeIdRequired: "NODE 必须包含 id=<id>",
    workflowDslErrorNodeIdDuplicate: "重复的 NODE id: {id}",
    workflowDslErrorNodeTypeInvalid: "NODE type 必须是 state/action，当前: {type}",
    workflowDslErrorEdgeFromToRequired: "EDGE 必须包含 from=<id> 和 to=<id>",
    workflowDslErrorEdgeConditionUnsupported: "EDGE 暂不支持条件",
    workflowDslErrorEdgeUndefinedNode: "EDGE 引用了未定义节点 ({from} -> {to})",
    workflowDslErrorAutoTypeInvalid: "AUTO type 无效: {type}",
    workflowDslErrorUnknownCommand: "未知命令: {command}",
    workflowDslLineLabel: "第{lineNo}行",
    workflowDslDefaultStartNodeName: "开始",
    workflowDslDefaultEndNodeName: "结束",
  }),
  [WORKFLOW_LOCALE.EN_US]: Object.freeze({
    workflowNoDescription: "(no description)",
    workflowAvailableToolsHeader:
      "Available tools (name/description), must be considered when planning workflow action nodes:",
    workflowAvailableToolsTaskHint:
      "When a workflow action should use tools, write the suitable tool name(s) into that NODE task. Do not invent tool names; if no listed tool is relevant, describe the task normally.",
    workflowToolCallUnknownScript: "unknown_script",
    workflowToolCallNoArguments: "none",
    workflowToolCallSemanticLine: "Observed tool call: {name} script was called with arguments {args}",
    workflowSemanticPlanByContext:
      "Please plan the workflow based on the above conversation context and the following current user message.",
    workflowSemanticCurrentUserMessage: "Current user message:\n{message}",
    workflowSemanticSourceInput: "Primary model response/workflow source input:\n{source}",
    workflowSemanticEmpty: "(empty)",
    workflowInputDefaultLabel: "Attachment {index}",
    workflowNodeResultAttachmentTitle: "## Workflow node result attachments",
    workflowInputAttachmentsHeader: "User attachments (nodes reference canonical attachmentId):",
    workflowInputAttachmentsPlanHint1:
      "When planning a workflow, put runtime-provided canonical attachmentId values directly in the NODE attachments field when an action needs user attachments.",
    workflowInputAttachmentsPlanHint2:
      "Node attachment references contain attachmentId only; the runtime attachment fact source validates sessionId and attachmentSource. Do not redeclare them in DSL.",
    workflowInputAttachmentsPlanHint3:
      "attachments=\"user:*\" means all user attachments; attachments=\"attachmentId1,attachmentId2\" means specific canonical attachmentId values.",
    workflowInputAttachmentsPlanHint4:
      "Do not put attachment paths in task or DSL; paths are resolved by the attachment service from canonical attachmentId.",
    workflowCurrentNodeFallback: "Current node",
    workflowUserRawAttachmentsTitle: "# Original user attachments",
    workflowCurrentNodeLine: "Current node: {name}",
    workflowInputAttachmentsSystemHint:
      "The following attachments are bound to the current node by workflow planning and come from this turn's user input. Read/reference them as needed before execution.",
    workflowUpstreamNodeFallback: "Upstream node",
    workflowSubAgentFailureFallback: "Sub-agent execution failed",
    workflowFailureLineWithTask: "- {nodeLabel} (task: {task}): {message}",
    workflowFailureLineWithoutTask: "- {nodeLabel}: {message}",
    workflowUpstreamAttachmentsTitle: "# Upstream workflow node result attachments",
    workflowUpstreamHint:
      "The following information comes from direct upstream action nodes. Read/reference available attachments before executing the current task; if upstream failed and no attachments are available, continue the completable part and clearly state impact scope.",
    workflowUpstreamFailureTitle: "## Upstream failed nodes",
    workflowUpstreamResultTitle: "## Upstream result attachments",
    workflowNodeResultTitle: "# Workflow node execution result",
    workflowNodeUnnamedFallback: "Unnamed node",
    workflowNodeLine: "- Node: {name}",
    workflowNodeIdLine: "- Node ID: {id}",
    workflowSubSessionLine: "- Sub-session: {id}",
    workflowDialogLine: "- Dialog: {id}",
    workflowFinalOutputTitle: "## Final output",
    workflowNodeInstructionByName: "Please process task: {name}",
    workflowNodeInstructionById: "Please process node task: {id}",
    workflowNodeInstructionDefault: "Please process the current task.",
    workflowDslErrorPrefix: "workflow dsl parse error",
    workflowDslErrorEmptyText: "empty text",
    workflowDslErrorJsonNotAllowed: "JSON is not allowed",
    workflowDslErrorMissingHeader: "missing protocol header '{header}'",
    workflowDslErrorNoNode: "no NODE",
    workflowDslErrorNoEdge: "no EDGE",
    workflowDslErrorNodeIdRequired: "NODE requires id=<id>",
    workflowDslErrorNodeIdDuplicate: "duplicate NODE id: {id}",
    workflowDslErrorNodeTypeInvalid: "NODE type must be state/action, got: {type}",
    workflowDslErrorEdgeFromToRequired: "EDGE requires from=<id> to=<id>",
    workflowDslErrorEdgeConditionUnsupported: "EDGE condition is not supported",
    workflowDslErrorEdgeUndefinedNode: "EDGE references undefined node ({from} -> {to})",
    workflowDslErrorAutoTypeInvalid: "AUTO type invalid: {type}",
    workflowDslErrorUnknownCommand: "unknown command: {command}",
    workflowDslLineLabel: "line {lineNo}",
    workflowDslDefaultStartNodeName: "Start",
    workflowDslDefaultEndNodeName: "End",
  }),
});

const DEFAULT_SEMANTIC_PROMPT_BY_LOCALE = Object.freeze({
  [WORKFLOW_LOCALE.ZH_CN]: [
    "你是工作流语义编译器。",
    "将用户需求转换为 WORKFLOW_DSL/1 纯文本。",
    "只输出 DSL，不要 JSON，不要 markdown，不要解释。",
    "",
    "DSL 指令：",
    "- NODE id=... type=state|action name=\"...\" [stateType=start|end|branch|merge] [task=\"...\"] [attachments=\"...\"]",
    "- EDGE from=... to=...",
    "- AUTO type=submit stepIndex=0",
    "- END",
    "",
    "语义：",
    "- 串行：action 按 EDGE 顺序依次执行。",
    "- 结构约束：流程边界与并发控制状态节点必须形成闭合结构。每个工作流应包含 stateType=start 与 stateType=end 作为起止边界；引入 stateType=branch 并发分叉时，必须在各分支完成后通过对应的 stateType=merge 汇聚，形成 branch -> actions -> merge 的闭合并发段，避免悬空 branch 或 merge。",
    "- 并发：使用 stateType=branch 分出多个 action，使用 stateType=merge 汇聚。",
    "- action 必须写 task，task 是子 agent 可直接执行的任务描述。",
    "- 如果输入里包含“用户附件”列表，且某个 action 需要读取/参考附件，直接在该 NODE 的 attachments 中填写运行时提供的 canonical attachmentId。",
    "- DSL 不得声明附件路径、sessionId 或 attachmentSource；这些事实由运行时附件协议校验。",
    "- attachments=\"user:*\" 表示该节点使用全部用户附件。",
    "- attachments=\"attachmentId1,attachmentId2\" 表示该节点只使用指定 canonical attachmentId。",
    "- 不要把附件路径拼进 task；路径只能由附件服务根据 canonical attachmentId 解析。",
    "",
    "示例：",
    "WORKFLOW_DSL/1",
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
  ].join("\n"),
  [WORKFLOW_LOCALE.EN_US]: [
    "You are a workflow semantic compiler.",
    "Convert user requirements into WORKFLOW_DSL/1 plain text.",
    "Output DSL only. No JSON, no markdown, no explanation.",
    "",
    "DSL directives:",
    "- NODE id=... type=state|action name=\"...\" [stateType=start|end|branch|merge] [task=\"...\"] [attachments=\"...\"]",
    "- EDGE from=... to=...",
    "- AUTO type=submit stepIndex=0",
    "- END",
    "",
    "Semantics:",
    "- Sequential: action nodes execute by EDGE order.",
    "- Structural constraints: workflow boundary and concurrency-control state nodes must form closed constructs. Each workflow should include stateType=start and stateType=end as start/end boundaries; when introducing a stateType=branch parallel split, join all branches with the corresponding stateType=merge after branch actions complete, forming a closed branch -> actions -> merge segment; avoid dangling branch or merge nodes.",
    "- Parallel: split via stateType=branch and merge via stateType=merge.",
    "- action must have task; task should be directly executable by sub-agent.",
    "- If input includes a user attachment list and an action needs attachments, put the runtime-provided canonical attachmentId values directly in NODE attachments.",
    "- DSL must not declare attachment paths, sessionId, or attachmentSource; the runtime attachment protocol validates those facts.",
    "- attachments=\"user:*\" means all user attachments.",
    "- attachments=\"attachmentId1,attachmentId2\" means specific canonical attachmentId values.",
    "- Do not put attachment paths into task; paths are resolved by the attachment service from canonical attachmentId.",
    "",
    "Example:",
    "WORKFLOW_DSL/1",
    "NODE id=start type=state stateType=start name=\"Start\"",
    "NODE id=branch type=state stateType=branch name=\"Branch\"",
    "NODE id=a type=action name=\"Task A\" task=\"Read user attachment and finish task A\" attachments=\"att_001\"",
    "NODE id=b type=action name=\"Task B\" task=\"Finish task B and output result\"",
    "NODE id=merge type=state stateType=merge name=\"Merge\"",
    "NODE id=end type=state stateType=end name=\"End\"",
    "EDGE from=start to=branch",
    "EDGE from=branch to=a",
    "EDGE from=branch to=b",
    "EDGE from=a to=merge",
    "EDGE from=b to=merge",
    "EDGE from=merge to=end",
    "AUTO type=submit stepIndex=0",
    "END",
  ].join("\n"),
});

export function normalizeWorkflowLocale(locale = "") {
  const value = String(locale || "").trim().toLowerCase();
  return value.startsWith("en") ? WORKFLOW_LOCALE.EN_US : WORKFLOW_LOCALE.ZH_CN;
}

export function resolveWorkflowLocaleFromContext(ctx = {}, fallbackLocale = WORKFLOW_LOCALE.ZH_CN) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = resolveWorkflowRuntimeFromContext({
    ...ctx,
    agentContext: agentContext || ctx?.agentContext || null,
  }) || {};
  const localeCandidates = [
    ctx?.runConfig?.locale,
    ctx?.locale,
    agentContext?.runConfig?.locale,
    runtime?.systemRuntime?.config?.locale,
    runtime?.userConfig?.locale,
    runtime?.globalConfig?.locale,
    fallbackLocale,
  ];
  const first = localeCandidates
    .map((item) => String(item || "").trim())
    .find(Boolean);
  return normalizeWorkflowLocale(first || fallbackLocale);
}

export function tWorkflow(locale = WORKFLOW_LOCALE.ZH_CN, key = "", params = {}) {
  const normalizedLocale = normalizeWorkflowLocale(locale);
  const dict = WORKFLOW_I18N_TEXT[normalizedLocale] || WORKFLOW_I18N_TEXT[WORKFLOW_LOCALE.ZH_CN];
  const template = String(dict?.[key] || WORKFLOW_I18N_TEXT[WORKFLOW_LOCALE.ZH_CN]?.[key] || "").trim();
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_all, token) => String(params?.[token] ?? ""));
}

export function getWorkflowDefaultSemanticPrompt(locale = WORKFLOW_LOCALE.ZH_CN) {
  const normalizedLocale = normalizeWorkflowLocale(locale);
  return String(
    DEFAULT_SEMANTIC_PROMPT_BY_LOCALE[normalizedLocale] ||
      DEFAULT_SEMANTIC_PROMPT_BY_LOCALE[WORKFLOW_LOCALE.ZH_CN] ||
      "",
  ).trim();
}

export function getWorkflowDslDefaultNodeNames(locale = WORKFLOW_LOCALE.ZH_CN) {
  const normalizedLocale = normalizeWorkflowLocale(locale);
  const startName =
    tWorkflow(normalizedLocale, WORKFLOW_I18N_KEYSET.DSL_DEFAULT_NODE.START_NAME) ||
    tWorkflow(WORKFLOW_LOCALE.EN_US, WORKFLOW_I18N_KEYSET.DSL_DEFAULT_NODE.START_NAME) ||
    "Start";
  const endName =
    tWorkflow(normalizedLocale, WORKFLOW_I18N_KEYSET.DSL_DEFAULT_NODE.END_NAME) ||
    tWorkflow(WORKFLOW_LOCALE.EN_US, WORKFLOW_I18N_KEYSET.DSL_DEFAULT_NODE.END_NAME) ||
    "End";
  return {
    startName: String(startName || "").trim(),
    endName: String(endName || "").trim(),
  };
}
