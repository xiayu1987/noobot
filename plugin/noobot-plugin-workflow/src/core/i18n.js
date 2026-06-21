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
    ATTACHMENT_ID_REQUIRED: "workflowDslErrorAttachmentIdRequired",
    ATTACHMENT_ID_DUPLICATE: "workflowDslErrorAttachmentIdDuplicate",
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
  ATTACHMENT: Object.freeze({
    DEFAULT_LABEL: "workflowAttachmentDefaultLabel",
    USER_RAW_ATTACHMENTS_TITLE: "workflowUserRawAttachmentsTitle",
    INPUT_SYSTEM_HINT: "workflowInputAttachmentsSystemHint",
    INPUT_HEADER: "workflowInputAttachmentsHeader",
    INPUT_PLAN_HINT_1: "workflowInputAttachmentsPlanHint1",
    INPUT_PLAN_HINT_2: "workflowInputAttachmentsPlanHint2",
    INPUT_PLAN_HINT_3: "workflowInputAttachmentsPlanHint3",
    INPUT_PLAN_HINT_4: "workflowInputAttachmentsPlanHint4",
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
    workflowToolCallSemanticLine: "语义执行 {name}脚本,参数{args}",
    workflowSemanticPlanByContext: "请基于以上会话上下文和以下当前用户消息规划工作流。",
    workflowSemanticCurrentUserMessage: "当前用户消息:\n{message}",
    workflowSemanticSourceInput: "主模型回复/工作流源输入:\n{source}",
    workflowSemanticEmpty: "(empty)",
    workflowAttachmentDefaultLabel: "附件{index}",
    workflowNodeResultAttachmentTitle: "## 工作流节点结果附件",
    workflowInputAttachmentsHeader: "用户附件:",
    workflowInputAttachmentsPlanHint1:
      "规划工作流时，如果某个 action 节点需要使用用户附件，请先在 DSL 中输出 ATTACHMENT 映射行，再在该 NODE 上添加 attachments 字段引用附件 id。",
    workflowInputAttachmentsPlanHint2:
      "ATTACHMENT 格式：ATTACHMENT id=\"attachmentId\" name=\"附件名\" path=\"可读路径\" mimeType=\"MIME\"。",
    workflowInputAttachmentsPlanHint3:
      "可用格式：attachments=\"user:*\" 表示使用全部用户附件；attachments=\"attachmentId1,attachmentId2\" 表示使用指定附件。",
    workflowInputAttachmentsPlanHint4:
      "不要把附件路径硬编码进 task；task 只描述任务，附件 id/path 映射写 ATTACHMENT，节点依赖只写 attachments。",
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
    workflowDslErrorAttachmentIdRequired: "ATTACHMENT 必须包含 id=<id>",
    workflowDslErrorAttachmentIdDuplicate: "重复的 ATTACHMENT id: {id}",
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
    workflowToolCallSemanticLine: "Semantic execution: run {name} script with arguments {args}",
    workflowSemanticPlanByContext:
      "Please plan the workflow based on the above conversation context and the following current user message.",
    workflowSemanticCurrentUserMessage: "Current user message:\n{message}",
    workflowSemanticSourceInput: "Primary model response/workflow source input:\n{source}",
    workflowSemanticEmpty: "(empty)",
    workflowAttachmentDefaultLabel: "Attachment {index}",
    workflowNodeResultAttachmentTitle: "## Workflow node result attachments",
    workflowInputAttachmentsHeader: "User attachments:",
    workflowInputAttachmentsPlanHint1:
      "When planning workflow, if an action node needs user attachments, output ATTACHMENT mapping lines in DSL first, then reference attachment ids in the NODE attachments field.",
    workflowInputAttachmentsPlanHint2:
      "ATTACHMENT format: ATTACHMENT id=\"attachmentId\" name=\"Attachment Name\" path=\"Readable Path\" mimeType=\"MIME\".",
    workflowInputAttachmentsPlanHint3:
      "Supported formats: attachments=\"user:*\" means all user attachments; attachments=\"attachmentId1,attachmentId2\" means specific attachments.",
    workflowInputAttachmentsPlanHint4:
      "Do not hardcode attachment paths into task; task should describe work only, use ATTACHMENT for id/path mapping and attachments for node dependencies.",
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
    workflowDslErrorAttachmentIdRequired: "ATTACHMENT requires id=<id>",
    workflowDslErrorAttachmentIdDuplicate: "duplicate ATTACHMENT id: {id}",
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
    "- ATTACHMENT id=\"...\" name=\"...\" path=\"...\" [mimeType=\"...\"]",
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
  ].join("\n"),
  [WORKFLOW_LOCALE.EN_US]: [
    "You are a workflow semantic compiler.",
    "Convert user requirements into WORKFLOW_DSL/1 plain text.",
    "Output DSL only. No JSON, no markdown, no explanation.",
    "",
    "DSL directives:",
    "- ATTACHMENT id=\"...\" name=\"...\" path=\"...\" [mimeType=\"...\"]",
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
    "- If input includes a user attachment list and an action needs attachments, output ATTACHMENT mapping lines first, then put attachments on NODE.",
    "- ATTACHMENT declares id/path mapping; prefer attachmentId and readable path from user attachment list.",
    "- attachments=\"user:*\" means all user attachments.",
    "- attachments=\"attachmentId1,attachmentId2\" means specific attachments; prefer ATTACHMENT ids.",
    "- Do not put attachment paths into task; task describes work only, use ATTACHMENT for id/path mapping and attachments for dependencies.",
    "",
    "Example:",
    "WORKFLOW_DSL/1",
    "ATTACHMENT id=\"att_001\" name=\"user-attachment.pdf\" path=\"/workspace/attachments/user-attachment.pdf\" mimeType=\"application/pdf\"",
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
