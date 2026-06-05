/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_ACTION,
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_HOOKS,
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PHASES,
  WORKFLOW_PLUGIN_DEFAULTS,
  WORKFLOW_RETRY,
  WORKFLOW_SEMANTIC,
  WORKFLOW_TRACE,
} from "./constants.js";
import { cleanupWorkflowBySessionIds } from "../utils/cleanup.js";
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  executeWorkflowText,
  releaseWorkflowInstance,
  resolveWorkflowUpstreamActionSteps,
} from "../workflow/adapter.js";
import { buildWorkflowOrchestrationPayload } from "./orchestration-payload.js";

function resolveAssistantOutput(agentResult = {}) {
  const direct = String(agentResult?.output || agentResult?.answer || "").trim();
  if (direct) return direct;
  const messages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index] || {};
    const content = String(messageItem?.content || "").trim();
    if (content) return content;
  }
  return "";
}

function resolveWorkflowSourceText(ctx = {}, agentResult = {}, hookPoint = "") {
  const normalizedHookPoint = String(hookPoint || "").trim();
  const outputFromAgent = resolveAssistantOutput(agentResult);
  if (outputFromAgent) return outputFromAgent;
  if (normalizedHookPoint === WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH) {
    return String(ctx?.userMessage || "").trim();
  }
  return String(ctx?.userMessage || "").trim();
}

function ensureTurnMessages(agentResult = {}) {
  const turnMessages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  agentResult.turnMessages = turnMessages;
  return turnMessages;
}

function mergeAttachmentMetas(existing = [], incoming = []) {
  const merged = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(
    merged
      .map((item = {}) => String(item?.attachmentId || item?.path || item?.relativePath || "").trim())
      .filter(Boolean),
  );
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== "object") continue;
    const key = String(item?.attachmentId || item?.path || item?.relativePath || "").trim();
    if (key && seen.has(key)) continue;
    merged.push(item);
    if (key) seen.add(key);
  }
  return merged;
}

function resolveWorkflowInputAttachmentMetas(ctx = {}) {
  const candidates = [
    ctx?.attachmentMetas,
    ctx?.userMessageAttachmentMetas,
    ctx?.agentContext?.session?.current?.attachments,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

function normalizeAttachmentRefs(input = []) {
  const source = Array.isArray(input) ? input : String(input || "").split(/[,;，；]/);
  return source.map((item) => String(item || "").trim()).filter(Boolean);
}

function isAllUserAttachmentRef(ref = "") {
  const normalized = String(ref || "").trim().toLowerCase();
  return ["*", "all", "user:*", "user:all", "用户:*", "用户:全部"].includes(normalized);
}

function resolveSemanticAttachmentDeclarationMap(semantic = {}) {
  if (semantic?.attachmentMap && typeof semantic.attachmentMap === "object") {
    return semantic.attachmentMap;
  }
  const map = {};
  for (const item of Array.isArray(semantic?.attachments) ? semantic.attachments : []) {
    const id = String(item?.id || item?.attachmentId || "").trim();
    if (!id) continue;
    map[id] = item;
  }
  return map;
}

function resolveNodeInputAttachmentMetas({ ctx = {}, semanticNode = {}, semantic = {} } = {}) {
  const userAttachmentMetas = resolveWorkflowInputAttachmentMetas(ctx);
  if (!userAttachmentMetas.length) return [];
  const refs = normalizeAttachmentRefs(
    semanticNode?.attachments || semanticNode?.inputAttachments || semanticNode?.attachmentIds || [],
  );
  if (!refs.length) return [];
  if (refs.some(isAllUserAttachmentRef)) return userAttachmentMetas;
  const semanticAttachmentMap = resolveSemanticAttachmentDeclarationMap(semantic);
  const expandedRefs = refs.flatMap((ref) => {
    const normalizedRef = String(ref || "").trim();
    const declared = semanticAttachmentMap[normalizedRef] || null;
    if (!declared || typeof declared !== "object") return [normalizedRef];
    return [
      normalizedRef,
      declared?.id,
      declared?.attachmentId,
      declared?.name,
      declared?.fileName,
      declared?.path,
      declared?.relativePath,
    ];
  });
  const refSet = new Set(expandedRefs.map((item) => String(item || "").trim()).filter(Boolean));
  if (!refSet.size) return [];
  return userAttachmentMetas.filter((meta = {}) => {
    const keys = [
      meta?.attachmentId,
      meta?.id,
      meta?.name,
      meta?.fileName,
      meta?.path,
      meta?.relativePath,
      resolveAttachmentDisplayPath(meta, ctx),
      meta?.parsedResultAttachmentId,
      meta?.parsedResultPath,
      meta?.parsedResultRelativePath,
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return keys.some((key) => refSet.has(key));
  });
}

function sanitizeArtifactFileNamePart(input = "", fallback = "result") {
  const normalized = String(input || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function resolveSubSessionFinalOutput(subSession = {}) {
  const result = subSession?.result && typeof subSession.result === "object" ? subSession.result : {};
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index] || {};
    const role = String(messageItem?.role || "").trim().toLowerCase();
    if (role && role !== "assistant") continue;
    const content = String(messageItem?.content || "").trim();
    if (content) return content;
  }
  const direct = String(result?.answer || result?.output || "").trim();
  if (direct) return direct;
  return "";
}

function stripHarnessReviewAppendix(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const markerIndex = raw.search(/(?:^|\n)\s*\[Harness-Review\]\s*(?:\n|$)/);
  if (markerIndex < 0) return raw;
  return raw.slice(0, markerIndex).trim();
}

function resolveAttachmentDisplayPath(meta = {}, ctx = {}) {
  const metaSandboxPath = String(
    meta?.sandboxPath || meta?.sandboxViewPath || meta?.sandbox_file_path || "",
  ).trim();
  if (metaSandboxPath) return metaSandboxPath;
  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  const hostPath = String(meta?.path || "").trim();
  const relativePath = String(meta?.relativePath || "").trim();
  const resolverCandidates = [
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];
  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = String(
        resolver({
          path: hostPath,
          hostPath,
          relativePath,
          runtime,
          agentContext: ctx?.agentContext || null,
          purpose: "workflow_attachment_display_path",
        }) || "",
      ).trim();
      if (resolved) return resolved;
    } catch {
      // Fallback to meta path below.
    }
  }
  return String(relativePath || hostPath || meta?.name || "").trim();
}

function buildWorkflowAttachmentPathBlockWithContext(attachmentMetas = [], ctx = {}) {
  const lines = (Array.isArray(attachmentMetas) ? attachmentMetas : [])
    .map((item = {}, index) => {
      const label = String(item?.name || `附件${index + 1}`).trim();
      const path = resolveAttachmentDisplayPath(item, ctx);
      if (!path) return "";
      return `- ${label}: ${path}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return ["", "## 工作流节点结果附件", "", ...lines].join("\n");
}

function buildWorkflowInputAttachmentPlanningBlock(attachmentMetas = [], ctx = {}) {
  const lines = (Array.isArray(attachmentMetas) ? attachmentMetas : [])
    .map((item = {}, index) => {
      const attachmentId = String(item?.attachmentId || item?.id || "").trim();
      const name = String(item?.name || item?.fileName || `附件${index + 1}`).trim();
      const mimeType = String(item?.mimeType || "").trim();
      const path = resolveAttachmentDisplayPath(item, ctx);
      const parts = [
        attachmentId ? `attachmentId=${attachmentId}` : "",
        name ? `name=${name}` : "",
        mimeType ? `mimeType=${mimeType}` : "",
        path ? `path=${path}` : "",
      ].filter(Boolean);
      return parts.length ? `- ${parts.join("; ")}` : "";
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return [
    "用户附件:",
    ...lines,
    "",
    "规划工作流时，如果某个 action 节点需要使用用户附件，请先在 DSL 中输出 ATTACHMENT 映射行，再在该 NODE 上添加 attachments 字段引用附件 id。",
    "ATTACHMENT 格式：ATTACHMENT id=\"attachmentId\" name=\"附件名\" path=\"可读路径\" mimeType=\"MIME\"。",
    "可用格式：attachments=\"user:*\" 表示使用全部用户附件；attachments=\"attachmentId1,attachmentId2\" 表示使用指定附件。",
    "不要把附件路径硬编码进 task；task 只描述任务，附件 id/path 映射写 ATTACHMENT，节点依赖只写 attachments。",
  ].join("\n");
}

function buildWorkflowInputAttachmentSystemMessage({
  ctx = {},
  attachmentMetas = [],
  semanticNode = {},
} = {}) {
  const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  const lines = metas
    .map((item = {}, index) => {
      const label = String(item?.name || item?.fileName || `附件${index + 1}`).trim();
      const attachmentId = String(item?.attachmentId || item?.id || "").trim();
      const path = resolveAttachmentDisplayPath(item, ctx);
      if (!path && !attachmentId) return "";
      return `- ${label}${attachmentId ? ` (${attachmentId})` : ""}: ${path || attachmentId}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  const nodeName = String(semanticNode?.name || semanticNode?.id || "当前节点").trim();
  return [
    "# 用户原始附件",
    "",
    `当前节点：${nodeName}`,
    "",
    "以下附件由工作流规划绑定到当前节点，来自本轮用户输入。执行任务时请按需读取/参考这些附件。",
    "",
    ...lines,
  ].join("\n");
}

function buildWorkflowUpstreamAttachmentResults({
  upstreamActionSteps = [],
  completedStepResults = new Map(),
} = {}) {
  return (Array.isArray(upstreamActionSteps) ? upstreamActionSteps : [])
    .map((upstreamStep = {}) => {
      const upstreamNodeId = String(upstreamStep?.nodeId || "").trim();
      if (!upstreamNodeId) return null;
      const upstreamStepId = String(upstreamStep?.stepId || "").trim();
      const completed = completedStepResults.get(upstreamStepId) || {};
      const attachmentMetas = Array.isArray(completed?.attachmentMetas)
        ? completed.attachmentMetas
        : [];
      const stepStatus = String(completed?.stepStatus || upstreamStep?.stepStatus || "").trim();
      const stepFailure =
        completed?.stepFailure && typeof completed.stepFailure === "object"
          ? completed.stepFailure
          : upstreamStep?.stepFailure && typeof upstreamStep.stepFailure === "object"
            ? upstreamStep.stepFailure
          : null;
      if (!attachmentMetas.length && stepStatus !== "failed" && !stepFailure) return null;
      return {
        nodeId: upstreamNodeId,
        nodeName: String(completed?.nodeName || upstreamStep?.nodeName || upstreamNodeId).trim(),
        actionNodeStateId: String(
          completed?.actionNodeStateId || upstreamStep?.actionNodeStateId || "",
        ).trim(),
        stepId: upstreamStepId,
        stepIndex: Number.isFinite(Number(completed?.stepIndex ?? upstreamStep?.stepIndex))
          ? Number(completed?.stepIndex ?? upstreamStep?.stepIndex)
          : -1,
        transition: Number(completed?.transition || 0),
        nodeDialogId: String(completed?.nodeDialogId || "").trim(),
        nodeSessionId: String(completed?.nodeSessionId || "").trim(),
        stepStatus,
        stepFailure,
        attachmentMetas,
      };
    })
    .filter(Boolean);
}

function buildWorkflowUpstreamAttachmentSystemMessage({
  options = {},
  ctx = {},
  pendingStep = {},
  upstreamNodeResults = [],
} = {}) {
  const normalizedResults = Array.isArray(upstreamNodeResults) ? upstreamNodeResults : [];
  const allAttachmentMetas = normalizedResults.reduce(
    (acc, item = {}) => mergeAttachmentMetas(acc, item?.attachmentMetas || []),
    [],
  );
  const failedResults = normalizedResults.filter((item = {}) => {
    const status = String(item?.stepStatus || "").trim();
    return status === "failed" || (item?.stepFailure && typeof item.stepFailure === "object");
  });
  if (!allAttachmentMetas.length && !failedResults.length) return "";
  if (typeof options?.workflowNodeSystemMessageBuilder === "function") {
    try {
      const customMessage = String(
        options.workflowNodeSystemMessageBuilder({
          ctx,
          pendingStep,
          upstreamNodeResults: normalizedResults,
          attachmentMetas: allAttachmentMetas,
        }) || "",
      ).trim();
      if (customMessage) return customMessage;
    } catch {
      // Fall back to the built-in message.
    }
  }

  const lines = [];
  const failureLines = [];
  for (const result of normalizedResults) {
    const nodeLabel = String(result?.nodeName || result?.nodeId || "上游节点").trim();
    if (
      String(result?.stepStatus || "").trim() === "failed" ||
      (result?.stepFailure && typeof result.stepFailure === "object")
    ) {
      const failureMessage = String(result?.stepFailure?.message || "子 agent 执行失败").trim();
      failureLines.push(`- ${nodeLabel}: ${failureMessage}`);
    }
    const metas = Array.isArray(result?.attachmentMetas) ? result.attachmentMetas : [];
    for (const [index, meta] of metas.entries()) {
      const attachmentLabel = String(meta?.name || `附件${index + 1}`).trim();
      const path = resolveAttachmentDisplayPath(meta, ctx);
      if (!path) continue;
      lines.push(`- ${nodeLabel} / ${attachmentLabel}: ${path}`);
    }
  }
  if (!lines.length && !failureLines.length) return "";
  const pendingName = String(pendingStep?.nodeName || pendingStep?.nodeId || "当前节点").trim();
  return [
    "# 上游工作流节点结果附件",
    "",
    `当前节点：${pendingName}`,
    "",
    "以下信息来自直接上游动作节点。请在执行当前任务前先读取/参考可用附件；如果上游节点失败且无附件，请基于失败信息继续完成当前节点可完成的部分，并明确说明受影响范围。",
    "",
    failureLines.length ? "## 上游失败节点" : "",
    ...failureLines,
    failureLines.length && lines.length ? "" : "",
    lines.length ? "## 上游结果附件" : "",
    ...lines,
  ].join("\n");
}

function truncateWorkflowResultText(text = "", maxLength = 1800) {
  const raw = String(text || "").trim();
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(200, Number(maxLength)) : 1800;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit).trim()}\n\n...`;
}

function sanitizeWorkflowPayloadForSessionMessage(workflowPayload = null) {
  if (!workflowPayload || typeof workflowPayload !== "object") return null;
  let payload = null;
  try {
    payload = JSON.parse(JSON.stringify(workflowPayload));
  } catch {
    return null;
  }
  const nodeAgentRuns = Array.isArray(payload?.execution?.nodeAgentRuns)
    ? payload.execution.nodeAgentRuns
    : [];
  for (const item of nodeAgentRuns) {
    if (!item || typeof item !== "object") continue;
    // 子 agent 的执行消息/结果正文不落到主 session，只保留附件元信息与会话定位信息。
    delete item.nodeResultText;
  }
  return payload;
}

async function persistWorkflowNodeResultAttachment({
  options = {},
  ctx = {},
  subSession = null,
  pendingStep = {},
  transition = 0,
} = {}) {
  const persister = typeof options?.generatedArtifactPersister === "function"
    ? options.generatedArtifactPersister
    : null;
  if (!persister || !subSession) return [];
  const output = resolveSubSessionFinalOutput(subSession);
  const cleanOutput = stripHarnessReviewAppendix(output);
  if (!cleanOutput) return [];
  const userId = String(ctx?.userId || "").trim();
  const sessionId = String(ctx?.sessionId || "").trim();
  if (!userId || !sessionId) return [];
  const nodeName = String(pendingStep?.nodeName || pendingStep?.nodeId || "workflow-node").trim();
  const nodeId = String(pendingStep?.nodeId || "").trim();
  const normalizedTransition = Number.isFinite(Number(transition)) ? Math.floor(Number(transition)) : 0;
  const artifactName = [
    "workflow-node",
    normalizedTransition > 0 ? String(normalizedTransition) : "",
    sanitizeArtifactFileNamePart(nodeName, "node"),
    "result.md",
  ]
    .filter(Boolean)
    .join("-");
  const body = [
    "# 工作流节点执行结果",
    "",
    `- 节点: ${nodeName || "未命名节点"}`,
    `- 节点ID: ${nodeId || "-"}`,
    `- 子会话: ${String(subSession?.sessionId || "").trim() || "-"}`,
    `- 对话: ${String(subSession?.dialogProcessId || "").trim() || "-"}`,
    "",
    "## 最终输出",
    "",
    cleanOutput,
    "",
  ].join("\n");
  try {
    const attachmentMetas = await persister({
      userId,
      sessionId,
      attachmentSource: "model",
      generationSource: "workflow_node_agent_result",
      fallbackMimeType: "text/markdown",
      artifacts: [
        {
          name: artifactName,
          mimeType: "text/markdown",
          contentBase64: Buffer.from(body, "utf8").toString("base64"),
        },
      ],
    });
    const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
    if (!metas.length) return [];
    if (subSession.result && typeof subSession.result === "object") {
      subSession.result.attachmentMetas = mergeAttachmentMetas(
        Array.isArray(subSession.result.attachmentMetas) ? subSession.result.attachmentMetas : [],
        metas,
      );
      if (Array.isArray(subSession.result.messages) && subSession.result.messages.length) {
        const lastIndex = subSession.result.messages.length - 1;
        const lastMessage = subSession.result.messages[lastIndex] || {};
        subSession.result.messages[lastIndex] = {
          ...lastMessage,
          attachmentMetas: mergeAttachmentMetas(
            Array.isArray(lastMessage?.attachmentMetas) ? lastMessage.attachmentMetas : [],
            metas,
          ),
        };
      }
    }
    return metas;
  } catch {
    return [];
  }
}

function appendWorkflowPlanningMessage({
  options = {},
  agentResult = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
  workflowPayload = null,
  attachmentMetas = [],
} = {}) {
  const turnMessages = ensureTurnMessages(agentResult);
  const attachmentPathBlock = buildWorkflowAttachmentPathBlockWithContext(attachmentMetas, ctx);
  const content = [semanticText || sourceText || "", attachmentPathBlock]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const sessionWorkflowPayload = sanitizeWorkflowPayloadForSessionMessage(workflowPayload);
  turnMessages.push({
    role: "assistant",
    type: "workflow",
    content,
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    modelAlias: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    modelName: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    summarized: false,
    attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
    workflowMessage: true,
    workflowMeta: {
      source: "workflow-plugin",
      phase: "planning",
      semanticInvokerUsed: semanticResolution?.invoked === true,
      sourceTextPreview: String(sourceText || "").slice(0, 800),
      semanticTextPreview: String(semanticText || "").slice(0, 2000),
      payload: sessionWorkflowPayload,
    },
  });
}

function buildWorkflowDialogRelativeDir({
  ctx = {},
  dialogProcessId = "",
  scope = "auto",
} = {}) {
  const sessionId = String(ctx?.sessionId || "").trim();
  const dialogId = String(dialogProcessId || ctx?.dialogProcessId || "").trim();
  if (!sessionId || !dialogId) return "";
  const normalizedScope = String(scope || "auto").trim().toLowerCase();
  if (normalizedScope === "planning") {
    return `runtime/workflow/planning/${sessionId}/${dialogId}`;
  }
  if (normalizedScope === "node") {
    return `runtime/workflow/session/${sessionId}/${dialogId}`;
  }
  const isNodeDialog = dialogId.startsWith("wf_node_");
  return isNodeDialog
    ? `runtime/workflow/session/${sessionId}/${dialogId}`
    : `runtime/workflow/planning/${sessionId}/${dialogId}`;
}

function buildWorkflowNodeInstruction(step = {}) {
  const taskText = String(
    step?.nodeTask ||
      step?.task ||
      step?.instruction ||
      step?.mission ||
      "",
  ).trim();
  if (taskText) return taskText;
  const nodeName = String(step?.nodeName || "").trim();
  if (nodeName) return `请处理任务：${nodeName}`;
  const nodeId = String(step?.nodeId || "").trim();
  if (nodeId) return `请处理节点任务：${nodeId}`;
  return "请处理当前任务。";
}

function resolveNodeTaskForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
  const pendingNodeId = String(pendingStep?.nodeId || "").trim();
  const pendingNodeName = String(pendingStep?.nodeName || "").trim();
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const matchedNode = nodes.find((node = {}) => {
    const nodeId = String(node?.id || "").trim();
    const nodeName = String(node?.name || "").trim();
    if (pendingNodeId && nodeId && pendingNodeId === nodeId) return true;
    if (pendingNodeName && nodeName && pendingNodeName === nodeName) return true;
    return false;
  });
  if (!matchedNode) return "";
  return String(
    matchedNode?.task ||
      matchedNode?.taskText ||
      matchedNode?.instruction ||
      matchedNode?.mission ||
      "",
  ).trim();
}

function resolveSemanticNodeForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
  const pendingNodeId = String(pendingStep?.nodeId || "").trim();
  const pendingNodeName = String(pendingStep?.nodeName || "").trim();
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  return (
    nodes.find((node = {}) => {
      const nodeId = String(node?.id || "").trim();
      const nodeName = String(node?.name || "").trim();
      if (pendingNodeId && nodeId && pendingNodeId === nodeId) return true;
      if (pendingNodeName && nodeName && pendingNodeName === nodeName) return true;
      return false;
    }) || null
  );
}

function withTimeout(promise, timeoutMs, message = "") {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message || `workflow node timeout (${ms}ms)`);
        err.code = "WORKFLOW_NODE_TIMEOUT";
        reject(err);
      }, ms);
    }),
  ]);
}

async function emitWorkflowRuntimeEvent({
  options = {},
  ctx = {},
  dialogId = "",
  event = "",
  level = "info",
  data = {},
} = {}) {
  if (typeof options?.workflowEventLogger !== "function") return null;
  const userId = String(ctx?.userId || "").trim();
  if (!userId) return null;
  const resolvedDialogId = String(dialogId || ctx?.dialogProcessId || "").trim();
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: resolvedDialogId,
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowEventLogger({
      userId,
      relativeDir,
      fileName: "events.jsonl",
      event: {
        source: "workflow-plugin",
        level: String(level || "info").trim(),
        event: String(event || "").trim(),
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogId: resolvedDialogId,
        ...(data && typeof data === "object" ? data : {}),
      },
    });
  } catch {
    return null;
  }
}

async function persistWorkflowPlanningDialog({
  options = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
} = {}) {
  if (typeof options?.workflowDialogPersister !== "function") return null;
  const userId = String(ctx?.userId || "").trim();
  if (!userId) return null;
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    scope: "planning",
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowDialogPersister({
      userId,
      relativeDir,
      fileName: "planning.json",
      payload: {
        scope: "workflow_planning",
        userId,
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogId: String(ctx?.dialogProcessId || "").trim(),
        timestamp: new Date().toISOString(),
        sourceText,
        semanticText,
        semanticModel: String(options?.semanticModel || "").trim(),
        semanticPrompt: String(options?.semanticPrompt || "").trim(),
        semanticResolution: {
          invoked: semanticResolution?.invoked === true,
          traceCount: Number(semanticResolution?.traceCount || 0),
          requestMessages: Array.isArray(semanticResolution?.requestMessages)
            ? semanticResolution.requestMessages
            : [],
        },
      },
    });
  } catch {
    return null;
  }
}

async function resolveSemanticText({ options = {}, ctx = {}, sourceText = "" } = {}) {
  if (typeof options?.capabilityModelInvoker !== "function") {
    return {
      text: sourceText,
      invoked: false,
      model: "",
      traceCount: 0,
    };
  }
  const userMessage = String(ctx?.userMessage || "").trim();
  const locale = String(ctx?.runConfig?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE).trim();
  const userAttachmentMetas = resolveWorkflowInputAttachmentMetas(ctx);
  const attachmentPlanningBlock = buildWorkflowInputAttachmentPlanningBlock(userAttachmentMetas, ctx);
  const semanticMessages = [
    {
      role: "user",
      content: [
        `用户输入:\n${userMessage || "(empty)"}`,
        attachmentPlanningBlock,
        `主模型回复:\n${sourceText || "(empty)"}`,
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const result = await options.capabilityModelInvoker({
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
    domain: WORKFLOW_SEMANTIC.DOMAIN,
    model: options?.semanticModel || "",
    locale,
    prompt: options?.semanticPrompt || "",
    messages: semanticMessages,
    ctx,
  });
  const resolvedText = String(result?.content || result?.output || "").trim() || sourceText;
  return {
    text: resolvedText,
    invoked: true,
    model: String(options?.semanticModel || "").trim(),
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
    requestMessages: semanticMessages,
  };
}

function appendWorkflowTrace(agentResult = {}, payload = {}) {
  const traces = Array.isArray(agentResult?.traces) ? agentResult.traces : [];
  traces.push({
    type: WORKFLOW_TRACE.TYPE,
    ...payload,
  });
  agentResult.traces = traces;
}

function createPhaseTracker() {
  const phases = [];
  return {
    start(name = "", meta = {}) {
      phases.push({
        phase: String(name || "").trim(),
        status: WORKFLOW_PHASE_STATUS.STARTED,
        startedAt: new Date().toISOString(),
        ...meta,
      });
    },
    end(name = "", status = WORKFLOW_PHASE_STATUS.SUCCEEDED, meta = {}) {
      const phaseName = String(name || "").trim();
      const now = new Date().toISOString();
      const openIdx = [...phases]
        .reverse()
        .findIndex(
          (item) =>
            item.phase === phaseName &&
            item.status === WORKFLOW_PHASE_STATUS.STARTED &&
            !item.endedAt,
        );
      if (openIdx >= 0) {
        const realIdx = phases.length - 1 - openIdx;
        phases[realIdx] = {
          ...phases[realIdx],
          status,
          endedAt: now,
          ...meta,
        };
      } else {
        phases.push({
          phase: phaseName,
          status,
          endedAt: now,
          ...meta,
        });
      }
    },
    list() {
      return phases.slice();
    },
  };
}

function resolveWorkflowInstanceId(ctx = {}) {
  const provided = String(
    ctx?.workflowInstanceId ||
      ctx?.runConfig?.workflowInstanceId ||
      "",
  ).trim();
  if (provided) return provided;
  const base = String(ctx?.dialogProcessId || ctx?.sessionId || "session").trim() || "session";
  return `wf_inst_${base}_${Date.now()}`;
}

async function runNodeAgent({
  hookManager,
  options = {},
  ctx = {},
  instanceId = "",
  pendingStep = {},
  semantic = {},
  transition = 0,
  upstreamNodeResults = [],
} = {}) {
  const nodeDialogId = `wf_node_${String(instanceId || "inst").replaceAll(/[^a-zA-Z0-9_-]/g, "_")}_${String(transition || 0)}`;
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    dialogId: nodeDialogId,
    event: "workflow_node_subsession_started",
    data: {
      instanceId: String(instanceId || "").trim(),
      transition: Number(transition || 0),
      nodeId: String(pendingStep?.nodeId || "").trim(),
      nodeName: String(pendingStep?.nodeName || "").trim(),
    },
  });
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep }) || {};
  const nodeInputAttachmentMetas = resolveNodeInputAttachmentMetas({
    ctx,
    semanticNode,
    semantic,
  });
  const hookPayload = {
    ...ctx,
    workflow: {
      instanceId,
      pendingStep,
      transition,
      semantic,
      semanticNode,
    },
    agentInstruction: buildWorkflowNodeInstruction({
      ...pendingStep,
      nodeTask: resolveNodeTaskForPendingStep({ semantic, pendingStep }),
    }),
    proposedAction: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
  };
  const inputAttachmentSystemMessage = buildWorkflowInputAttachmentSystemMessage({
    ctx,
    attachmentMetas: nodeInputAttachmentMetas,
    semanticNode,
  });
  const upstreamAttachmentSystemMessage = buildWorkflowUpstreamAttachmentSystemMessage({
    options,
    ctx,
    pendingStep,
    upstreamNodeResults,
  });
  const subSessionSystemMessages = [
    inputAttachmentSystemMessage,
    upstreamAttachmentSystemMessage,
  ].filter(Boolean);
  hookPayload.workflow.upstreamNodeResults = upstreamNodeResults;
  hookPayload.workflow.upstreamAttachmentMetas = upstreamNodeResults.reduce(
    (acc, item = {}) => mergeAttachmentMetas(acc, item?.attachmentMetas || []),
    [],
  );
  hookPayload.workflow.inputAttachmentMetas = nodeInputAttachmentMetas;
  hookPayload.workflow.inputAttachmentSystemMessage = inputAttachmentSystemMessage;
  hookPayload.workflow.upstreamAttachmentSystemMessage = upstreamAttachmentSystemMessage;
  let subSession = null;
  let subSessionFailure = null;
  if (typeof options?.subSessionRunner === "function") {
    const parentRunConfig =
      ctx?.runConfig && typeof ctx.runConfig === "object" ? ctx.runConfig : {};
    const parentSelectedPlugins = Array.isArray(parentRunConfig?.selectedPlugins)
      ? parentRunConfig.selectedPlugins.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const parentHarness =
      parentRunConfig?.plugins?.harness && typeof parentRunConfig.plugins.harness === "object"
        ? parentRunConfig.plugins.harness
        : {};
    const parentHarnessMode = String(parentHarness?.mode || "").trim().toLowerCase();
    const parentHarnessEnabled =
      parentSelectedPlugins.includes("harness") ||
      parentHarness?.enabled === true ||
      parentHarnessMode === "on";
    const subSessionRunConfigPatch = parentHarnessEnabled
      ? {
          selectedPlugins: Array.from(new Set([...parentSelectedPlugins, "harness"])),
          plugins: {
            harness: {
              ...(parentHarness && typeof parentHarness === "object" ? parentHarness : {}),
              enabled: true,
              mode: "on",
            },
          },
        }
      : {};
    const relativeDir = buildWorkflowDialogRelativeDir({
      ctx,
      dialogProcessId: nodeDialogId,
      scope: "node",
    });
    try {
      const nodeAgentTimeoutMs = Number.isFinite(Number(options?.nodeAgentTimeoutMs))
        ? Math.max(1000, Math.floor(Number(options.nodeAgentTimeoutMs)))
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
      subSession = await withTimeout(
        options.subSessionRunner({
          parentContext: ctx,
          message: hookPayload.agentInstruction,
          attachmentMetas: nodeInputAttachmentMetas,
          runConfigPatch: subSessionRunConfigPatch,
          systemMessages: subSessionSystemMessages,
          eventListener:
            ctx?.eventListener && typeof ctx.eventListener?.onEvent === "function"
              ? ctx.eventListener
              : null,
          strategy: {
            parentSessionId: String(ctx?.sessionId || "").trim(),
            parentDialogProcessId: String(ctx?.dialogProcessId || "").trim(),
            dialogProcessId: nodeDialogId,
            disabledPlugins: ["workflow"],
            relativeDir,
          },
          metadata: {
            scope: "workflow_node",
            instanceId: String(instanceId || "").trim(),
            nodeId: String(pendingStep?.nodeId || "").trim(),
            nodeName: String(pendingStep?.nodeName || "").trim(),
            transition: Number(transition || 0),
            workflowSessionId: String(ctx?.sessionId || "").trim(),
            workflowDialogId: nodeDialogId,
            inputAttachmentRefs: normalizeAttachmentRefs(
              semanticNode?.attachments || semanticNode?.inputAttachments || semanticNode?.attachmentIds || [],
            ),
            inputAttachmentMetas: nodeInputAttachmentMetas,
            upstreamWorkflowNodeResults: upstreamNodeResults,
          },
        }),
        nodeAgentTimeoutMs,
        `workflow node sub-session timeout (${nodeAgentTimeoutMs}ms)`,
      );
      await emitWorkflowRuntimeEvent({
        options,
        ctx,
        dialogId: nodeDialogId,
        event: "workflow_node_subsession_succeeded",
        data: {
          instanceId: String(instanceId || "").trim(),
          nodeSessionId: String(subSession?.sessionId || "").trim(),
          persistedDir: String(subSession?.persisted?.outputDir || "").trim(),
        },
      });
    } catch (error) {
      const failureMessage = String(error?.message || error || "workflow node sub-session failed").trim();
      subSessionFailure = {
        source: "workflow_node_agent",
        code: String(error?.code || "WORKFLOW_NODE_SUBSESSION_FAILED").trim(),
        message: failureMessage,
      };
      await emitWorkflowRuntimeEvent({
        options,
        ctx,
        dialogId: nodeDialogId,
        event: "workflow_node_subsession_failed",
        level: "error",
        data: {
          instanceId: String(instanceId || "").trim(),
          nodeId: String(pendingStep?.nodeId || "").trim(),
          message: failureMessage,
        },
      });
      subSession = null;
    }
    if (subSession) {
      await persistWorkflowNodeResultAttachment({
        options,
        ctx,
        subSession,
        pendingStep,
        transition,
      });
    }
  }
  if (subSessionFailure) {
    return {
      action: {
        type: WORKFLOW_ACTION.SUBMIT,
        stepIndex: Number(pendingStep?.index || 0),
        stepFailure: subSessionFailure,
      },
      subSession,
      nodeDialogId,
      stepStatus: "failed",
      stepFailure: subSessionFailure,
    };
  }
  if (typeof options?.nodeAgentExecutor === "function") {
    const directAction = await options.nodeAgentExecutor(hookPayload);
    if (directAction && typeof directAction === "object") {
      return {
        action: directAction,
        subSession,
        nodeDialogId,
      };
    }
  }
  const emitResult = await hookManager.emit(WORKFLOW_BOT_HOOK_POINTS.NODE_AGENT_EXECUTE, hookPayload);
  const results = Array.isArray(emitResult?.results) ? emitResult.results : [];
  for (const item of results) {
    if (!item?.ok) continue;
    const action = item?.result?.action;
    if (action && typeof action === "object") {
      return {
        action,
        subSession,
        nodeDialogId,
      };
    }
  }
  return {
    action: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
    subSession,
    nodeDialogId,
  };
}

function buildPendingStepKey(step = {}) {
  return `${String(step?.nodeName || "").trim()}::${Number(step?.nodeType || 0)}`;
}

function resolveStepIndexForAction({
  snapshot = {},
  preferredIndex = 0,
  pendingStep = {},
} = {}) {
  const pendingSteps = Array.isArray(snapshot?.pendingSteps) ? snapshot.pendingSteps : [];
  if (!pendingSteps.length) return 0;
  const key = buildPendingStepKey(pendingStep);
  const matchedIndex = pendingSteps.findIndex((item) => buildPendingStepKey(item) === key);
  if (matchedIndex >= 0) return matchedIndex;
  const index = Number.isFinite(Number(preferredIndex)) ? Math.max(0, Math.floor(Number(preferredIndex))) : 0;
  return Math.min(index, Math.max(0, pendingSteps.length - 1));
}

export function createRegisterWorkflowHooks() {
  return function registerWorkflowHooks({ hookManager, options }) {
    const disposers = [];
    const hookPoint = WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;
    const sessionCleanupPoint = WORKFLOW_BOT_HOOK_POINTS.AFTER_SESSION_DELETE;

    disposers.push(
      hookManager.on(
        hookPoint,
        async (ctx = {}) => {
          const beforeDispatchMode =
            String(hookPoint || "").trim() === WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;
          const sourceAgentResult =
            ctx?.agentResult && typeof ctx.agentResult === "object" ? ctx.agentResult : {};
          const agentResult = beforeDispatchMode
            ? { output: "", traces: [], turnMessages: [] }
            : sourceAgentResult;
          const phaseTracker = createPhaseTracker();
          const retryMeta = {
            maxAttempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
            attempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
            history: [],
          };
          phaseTracker.start(WORKFLOW_PHASES.HOOK_RECEIVED);
          await emitWorkflowRuntimeEvent({
            options,
            ctx,
            event: "workflow_hook_received_started",
          });
          const sourceText = resolveWorkflowSourceText(ctx, sourceAgentResult, hookPoint);
          if (!sourceText) {
            phaseTracker.end(WORKFLOW_PHASES.HOOK_RECEIVED, WORKFLOW_PHASE_STATUS.SKIPPED, {
              reason: "empty_source_text",
            });
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_hook_received_skipped",
              data: { reason: "empty_source_text" },
            });
            return;
          }
          phaseTracker.end(WORKFLOW_PHASES.HOOK_RECEIVED, WORKFLOW_PHASE_STATUS.SUCCEEDED, {
            sourceTextLength: sourceText.length,
          });
          await emitWorkflowRuntimeEvent({
            options,
            ctx,
            event: "workflow_hook_received_succeeded",
            data: { sourceTextLength: sourceText.length },
          });

          try {
            phaseTracker.start(WORKFLOW_PHASES.SEMANTIC_RESOLUTION);
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_semantic_resolution_started",
            });
            const semanticResolution = await resolveSemanticText({ options, ctx, sourceText });
            phaseTracker.end(
              WORKFLOW_PHASES.SEMANTIC_RESOLUTION,
              WORKFLOW_PHASE_STATUS.SUCCEEDED,
              {
              invoked: semanticResolution?.invoked === true,
              traceCount: Number(semanticResolution?.traceCount || 0),
              },
            );
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_semantic_resolution_succeeded",
              data: {
                invoked: semanticResolution?.invoked === true,
                traceCount: Number(semanticResolution?.traceCount || 0),
              },
            });
            const semanticText = String(semanticResolution?.text || "").trim();
            const planningPersistResult = await persistWorkflowPlanningDialog({
              options,
              ctx,
              sourceText,
              semanticText,
              semanticResolution,
            });
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: planningPersistResult ? "workflow_planning_persist_succeeded" : "workflow_planning_persist_skipped",
              data: {
                outputDir: String(planningPersistResult?.outputDir || "").trim(),
                outputFile: String(planningPersistResult?.outputFile || "").trim(),
              },
            });
            phaseTracker.start(WORKFLOW_PHASES.WORKFLOW_EXECUTION);
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_execution_started",
            });
            const { semantic } = executeWorkflowText({
              semanticText,
              options,
            });
            const instanceId = resolveWorkflowInstanceId(ctx);
            let snapshot = createWorkflowInstance({
              instanceId,
              semantic,
              options,
              meta: {
                userId: String(ctx?.userId || "").trim(),
                sessionId: String(ctx?.sessionId || "").trim(),
                dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
              },
            });
            const maxTransitions = Number.isFinite(Number(options?.maxAutoTransitions))
              ? Math.max(1, Math.floor(Number(options.maxAutoTransitions)))
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS;
            const maxParallelNodeAgents = Number.isFinite(Number(options?.maxParallelNodeAgents))
              ? Math.max(1, Math.floor(Number(options.maxParallelNodeAgents)))
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS;
            const parallelEnabled = options?.parallelNodeExecution === true;
            const nodeAgentRuns = [];
            const completedStepResults = new Map();
            let transitions = 0;
            while (snapshot && snapshot.completed !== true && transitions < maxTransitions) {
              const pending = Array.isArray(snapshot.pendingSteps) ? snapshot.pendingSteps : [];
              if (!pending.length) break;
              const waveSize = parallelEnabled ? Math.min(maxParallelNodeAgents, pending.length) : 1;
              const waveSteps = pending.slice(0, waveSize);
              const waveResults = await Promise.all(
                waveSteps.map(async (step, idx) => {
                  const upstreamActionSteps = resolveWorkflowUpstreamActionSteps({
                    instanceId,
                    pendingStep: step,
                  });
                  const upstreamNodeResults = buildWorkflowUpstreamAttachmentResults({
                    upstreamActionSteps,
                    completedStepResults,
                  });
                  const action = await runNodeAgent({
                    hookManager,
                    options,
                    ctx,
                    instanceId,
                    pendingStep: step,
                    semantic,
                    transition: transitions + idx + 1,
                    upstreamNodeResults,
                  });
                  return {
                    step,
                    action: action?.action || null,
                    subSession: action?.subSession || null,
                    nodeDialogId: String(action?.nodeDialogId || "").trim(),
                    upstreamNodeResults,
                    order: idx,
                  };
                }),
              );
              // 先执行高 index，尽量保持并发批次中的原始 stepIndex 语义。
              const actionQueue = waveResults
                .slice()
                .sort((a, b) => Number(b?.step?.index || 0) - Number(a?.step?.index || 0));
              for (const item of actionQueue) {
                if (!snapshot || snapshot.completed === true || transitions >= maxTransitions) break;
                const resolvedStepIndex = resolveStepIndexForAction({
                  snapshot,
                  preferredIndex: item?.action?.stepIndex ?? item?.step?.index ?? 0,
                  pendingStep: item?.step || {},
                });
                const effectiveAction = {
                  type: String(item?.action?.type || WORKFLOW_ACTION.SUBMIT).trim().toLowerCase(),
                  stepIndex: resolvedStepIndex,
                  ...(item?.action?.stepFailure && typeof item.action.stepFailure === "object"
                    ? { stepFailure: item.action.stepFailure }
                    : {}),
                };
                snapshot = advanceWorkflowInstance({
                  instanceId,
                  action: effectiveAction,
                });
                transitions += 1;
                nodeAgentRuns.push({
                  transition: transitions,
                  step: item?.step || null,
                  action: effectiveAction,
                  nodeDialogId: String(item?.nodeDialogId || "").trim(),
                  nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
                  nodeSessionPersistedPath: String(item?.subSession?.persisted?.outputDir || "").trim(),
                  actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
                  stepId: String(item?.step?.stepId || "").trim(),
                  stepIndex: Number.isFinite(Number(item?.step?.stepIndex))
                    ? Number(item.step.stepIndex)
                    : -1,
                  nodeResultText: truncateWorkflowResultText(
                    stripHarnessReviewAppendix(
                      resolveSubSessionFinalOutput(item?.subSession || {}),
                    ),
                    4000,
                  ),
                  nodeResultAttachmentMetas: Array.isArray(item?.subSession?.result?.attachmentMetas)
                    ? item.subSession.result.attachmentMetas
                    : [],
                  stepStatus: item?.action?.stepFailure ? "failed" : "",
                  stepFailure:
                    item?.action?.stepFailure && typeof item.action.stepFailure === "object"
                      ? item.action.stepFailure
                      : null,
                  upstreamNodeResults: Array.isArray(item?.upstreamNodeResults)
                    ? item.upstreamNodeResults
                    : [],
                  parallelWave: parallelEnabled ? Math.floor((transitions - 1) / Math.max(1, waveSize)) + 1 : 0,
                  waveOrder: Number(item?.order ?? 0),
                  pendingStepCount: Number(snapshot?.pendingStepCount || 0),
                });
                const completedSemanticNode = resolveSemanticNodeForPendingStep({
                  semantic,
                  pendingStep: item?.step || {},
                });
                const completedStepId = String(item?.step?.stepId || "").trim();
                const completedNodeId = String(
                  item?.step?.nodeId || completedSemanticNode?.id || "",
                ).trim();
                if (completedStepId) {
                  completedStepResults.set(completedStepId, {
                    transition: transitions,
                    nodeId: completedNodeId,
                    nodeName: String(
                      item?.step?.nodeName || completedSemanticNode?.name || completedNodeId,
                    ).trim(),
                    actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
                    stepId: completedStepId,
                    stepIndex: Number.isFinite(Number(item?.step?.stepIndex))
                      ? Number(item.step.stepIndex)
                      : -1,
                    nodeDialogId: String(item?.nodeDialogId || "").trim(),
                    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
                    stepStatus: item?.action?.stepFailure ? "failed" : "",
                    stepFailure:
                      item?.action?.stepFailure && typeof item.action.stepFailure === "object"
                        ? item.action.stepFailure
                        : null,
                    attachmentMetas: Array.isArray(item?.subSession?.result?.attachmentMetas)
                      ? item.subSession.result.attachmentMetas
                      : [],
                  });
                }
              }
            }
            const execution = {
              started: true,
              instanceId,
              autoTransitions: transitions,
              completed: snapshot?.completed === true,
              pendingStepCount: Number(snapshot?.pendingStepCount || 0),
              actionRecords: Array.isArray(snapshot?.actionRecords) ? snapshot.actionRecords : [],
              nodeAgentRuns,
            };
            if (execution.completed) {
              releaseWorkflowInstance({ instanceId });
            }
            phaseTracker.end(WORKFLOW_PHASES.WORKFLOW_EXECUTION, WORKFLOW_PHASE_STATUS.SUCCEEDED, {
              completed: execution.completed,
              pendingStepCount: execution.pendingStepCount,
              instanceId,
            });
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_execution_succeeded",
              data: {
                instanceId,
                completed: execution.completed,
                pendingStepCount: execution.pendingStepCount,
                autoTransitions: execution.autoTransitions,
              },
            });
            retryMeta.history.push({
              attempt: 1,
              status: WORKFLOW_PHASE_STATUS.SUCCEEDED,
              timestamp: new Date().toISOString(),
            });
            phaseTracker.start(WORKFLOW_PHASES.PAYLOAD_BUILD);

            const workflowPayload = buildWorkflowOrchestrationPayload({
              ctx,
              options,
              sourceText,
              semanticText,
              semantic,
              execution,
              semanticResolution,
              phaseTimeline: phaseTracker.list(),
              retryMeta,
            });
            phaseTracker.end(WORKFLOW_PHASES.PAYLOAD_BUILD, WORKFLOW_PHASE_STATUS.SUCCEEDED);
            workflowPayload.phaseTimeline = phaseTracker.list();
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_payload_build_succeeded",
              data: {
                interactionId: String(workflowPayload?.interactionId || "").trim(),
              },
            });
            workflowPayload.planningDialog = {
              dialogId: String(ctx?.dialogProcessId || "").trim(),
              sessionId: String(ctx?.sessionId || "").trim(),
              storagePath: String(planningPersistResult?.outputDir || "").trim(),
              storageFile: String(planningPersistResult?.outputFile || "").trim(),
            };
            workflowPayload.nodeSessions = nodeAgentRuns
              .map((item = {}) => {
                const semanticNode = resolveSemanticNodeForPendingStep({
                  semantic,
                  pendingStep: item?.step || {},
                });
                return {
                  transition: Number(item?.transition || 0),
                  nodeName: String(item?.step?.nodeName || semanticNode?.name || "").trim(),
                  nodeId: String(item?.step?.nodeId || semanticNode?.id || "").trim(),
                  nodeType: Number.isFinite(Number(item?.step?.nodeType))
                    ? Number(item.step.nodeType)
                    : undefined,
                  actionNodeStateId: String(item?.actionNodeStateId || item?.step?.actionNodeStateId || "").trim(),
                  stepId: String(item?.stepId || item?.step?.stepId || "").trim(),
                  stepIndex: Number.isFinite(Number(item?.stepIndex ?? item?.step?.stepIndex))
                    ? Number(item?.stepIndex ?? item?.step?.stepIndex)
                    : undefined,
                  type: String(semanticNode?.type || "").trim(),
                  stateType:
                    semanticNode && Number.isFinite(Number(semanticNode?.stateType))
                      ? Number(semanticNode.stateType)
                      : undefined,
                  rootSessionId: String(ctx?.sessionId || "").trim(),
                  dialogId: String(item?.nodeDialogId || "").trim(),
                  sessionId: String(item?.nodeSessionId || "").trim(),
                  attachmentMetas: Array.isArray(item?.nodeResultAttachmentMetas)
                    ? item.nodeResultAttachmentMetas
                    : [],
                  stepStatus: String(item?.stepStatus || "").trim(),
                  stepFailure:
                    item?.stepFailure && typeof item.stepFailure === "object"
                      ? item.stepFailure
                      : null,
                  parallelWave: Number(item?.parallelWave || 0),
                  waveOrder: Number(item?.waveOrder || 0),
                };
              })
              .filter((item) => item.dialogId || item.sessionId);
            const workflowAttachmentMetas = nodeAgentRuns.reduce(
              (acc, item = {}) =>
                mergeAttachmentMetas(
                  acc,
                  Array.isArray(item?.nodeResultAttachmentMetas)
                    ? item.nodeResultAttachmentMetas
                    : [],
                ),
              [],
            );
            workflowPayload.attachmentMetas = workflowAttachmentMetas;

            agentResult.workflow = workflowPayload;
            appendWorkflowPlanningMessage({
              options,
              agentResult,
              ctx,
              sourceText,
              semanticText,
              semanticResolution,
              workflowPayload,
              attachmentMetas: workflowAttachmentMetas,
            });
            appendWorkflowTrace(agentResult, {
              stage: WORKFLOW_TRACE.STAGE_EXECUTED,
              interactionId: workflowPayload.interactionId,
              protocolVersion: workflowPayload.protocolVersion,
              completed: execution?.completed === true,
              pendingStepCount: execution?.pendingStepCount ?? 0,
              autoTransitions: execution?.autoTransitions ?? 0,
            });
            if (beforeDispatchMode) {
              ctx.skipAgentDispatch = true;
              ctx.overrideAgentResult = agentResult;
            }
          } catch (error) {
            retryMeta.history.push({
              attempt: 1,
              status: WORKFLOW_PHASE_STATUS.FAILED,
              timestamp: new Date().toISOString(),
              message: String(error?.message || error || ""),
            });
            phaseTracker.end(WORKFLOW_PHASES.SEMANTIC_RESOLUTION, WORKFLOW_PHASE_STATUS.FAILED, {
              message: String(error?.message || error || ""),
            });
            phaseTracker.end(WORKFLOW_PHASES.WORKFLOW_EXECUTION, WORKFLOW_PHASE_STATUS.FAILED, {
              message: String(error?.message || error || ""),
            });
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_execution_failed",
              level: "error",
              data: {
                message: String(error?.message || error || ""),
              },
            });
            const workflowPayload = buildWorkflowOrchestrationPayload({
              ctx,
              options,
              sourceText,
              semanticText: sourceText,
              semantic: null,
              execution: null,
              semanticResolution: { invoked: typeof options?.capabilityModelInvoker === "function" },
              phaseTimeline: phaseTracker.list(),
              retryMeta,
              error,
            });
            agentResult.workflow = workflowPayload;
            appendWorkflowTrace(agentResult, {
              stage: WORKFLOW_TRACE.STAGE_FAILED,
              interactionId: workflowPayload.interactionId,
              protocolVersion: workflowPayload.protocolVersion,
              message: String(error?.message || error || ""),
            });
            if (beforeDispatchMode) {
              ctx.skipAgentDispatch = false;
              ctx.overrideAgentResult = null;
              ctx.workflowFallbackToMainAgent = true;
              await emitWorkflowRuntimeEvent({
                options,
                ctx,
                event: "workflow_fallback_to_main_agent",
                level: "warn",
                data: {
                  reason: "workflow_execution_failed",
                  message: String(error?.message || error || ""),
                },
              });
            }
          }
        },
        {
          id: WORKFLOW_HOOKS.AFTER_AGENT_DISPATCH_LISTENER_ID,
          priority: Number(options?.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
          timeoutMs:
            Number(options?.timeoutMs) > 0
              ? Number(options.timeoutMs)
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
        },
      ),
    );

    disposers.push(
      hookManager.on(
        sessionCleanupPoint,
        async (ctx = {}) => {
          const deletedSessionIds = Array.isArray(ctx?.deletedSessionIds)
            ? ctx.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
            : [];
          const fallbackSessionId = String(ctx?.sessionId || "").trim();
          const sessionIds = deletedSessionIds.length
            ? deletedSessionIds
            : fallbackSessionId
              ? [fallbackSessionId]
              : [];
          if (!sessionIds.length) return;
          const basePath = String(ctx?.basePath || "").trim();
          if (!basePath) return;
          await cleanupWorkflowBySessionIds(basePath, sessionIds);
        },
        {
          id: WORKFLOW_HOOKS.AFTER_SESSION_DELETE_LISTENER_ID,
          priority: Number(options?.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
          timeoutMs:
            Number(options?.timeoutMs) > 0
              ? Number(options.timeoutMs)
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
        },
      ),
    );

    return disposers;
  };
}

export const registerWorkflowHooks = createRegisterWorkflowHooks();
