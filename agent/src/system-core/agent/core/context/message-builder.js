/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tEngine } from "../i18n-adapter.js";
import { MESSAGE_ROLE } from "../../../bot-manage/config/constants.js";
import { resolveModelContextMessages } from "../../../session/utils/context-window-normalizer.js";
import { mergeConfig } from "../../../config/index.js";
import { compactToolResultTextForModel } from "../../../semantic-transfer/index.js";
import {
  resolveDialogProcessIdFromContext,
  resolveDialogProcessId,
  resolveMessageDialogProcessId,
} from "../../../context/session/dialog-process-id-resolver.js";


const TASK_SUMMARY_TOOL_NAME = "task_summary";

function resolveToolNameFromToolCallLike(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function hasTaskSummaryToolCallMessage(msg = {}) {
  return (Array.isArray(msg?.tool_calls) ? msg.tool_calls : []).some(
    (toolCall) => resolveToolNameFromToolCallLike(toolCall) === TASK_SUMMARY_TOOL_NAME,
  );
}

function isTaskSummaryToolResultMessage(msg = {}) {
  const explicitToolName = String(msg?.toolName || msg?.tool_name || "").trim();
  if (explicitToolName === TASK_SUMMARY_TOOL_NAME) return true;
  try {
    const parsed = JSON.parse(String(msg?.content || ""));
    return String(parsed?.toolName || "").trim() === TASK_SUMMARY_TOOL_NAME;
  } catch {
    return false;
  }
}


function extractTaskSummaryTextFromToolResult(msg = {}) {
  const rawContent = String(msg?.content || "").trim();
  if (!rawContent) return "";
  try {
    const parsed = JSON.parse(rawContent);
    const phaseSummary = String(parsed?.phaseSummary || parsed?.phase_summary || "").trim();
    if (phaseSummary) return phaseSummary;
    const summaryContent = String(parsed?.summaryContent || parsed?.summary_content || "").trim();
    if (summaryContent) return summaryContent;
    const summary = typeof parsed?.summary === "string"
      ? String(parsed.summary || "").trim()
      : "";
    if (summary) return summary;
  } catch {
    // fall through to raw content
  }
  return rawContent;
}

function buildTaskSummaryFallbackHumanMessage(msg = {}) {
  const summaryText = extractTaskSummaryTextFromToolResult(msg);
  if (!summaryText) return null;
  return new HumanMessage({
    content: `[阶段小结]
${summaryText}`,
    additional_kwargs: {
      noobotInternalMessageType: "phase_summary_memory",
      recoveredFromUnpairedTaskSummary: true,
    },
  });
}

function shouldSkipSummarizedHistoryMessage(msg = {}) {
  if (msg?.summarized !== true) return false;
  return !hasTaskSummaryToolCallMessage(msg) && !isTaskSummaryToolResultMessage(msg);
}

function toLangChainToolCalls(toolCalls = []) {
  return (toolCalls || [])
    .map((tc) => {
      if (!tc) return null;
      if (tc.name) {
        return {
          id: tc.id || "",
          name: tc.name,
          args: tc.args || {},
          type: "tool_call",
        };
      }
      const fn = tc.function || {};
      let args = {};
      try {
        args =
          typeof fn.arguments === "string"
            ? JSON.parse(fn.arguments || "{}")
            : fn.arguments || {};
      } catch {
        args = {};
      }
      if (!fn.name) return null;
      return {
        id: tc.id || "",
        name: fn.name,
        args,
        type: "tool_call",
      };
    })
    .filter(Boolean);
}

function resolveAttachmentMetas(msg = {}, fallbackAttachmentMetas = []) {
  if (Array.isArray(msg?.attachmentMetas)) return msg.attachmentMetas;
  return Array.isArray(fallbackAttachmentMetas) ? fallbackAttachmentMetas : [];
}

function buildHumanMessageContent(msg = {}, fallbackAttachmentMetas = []) {
  const textContent = String(msg?.content || "");
  void fallbackAttachmentMetas;
  return textContent;
}

function buildUserMetaInfoContent(runtime = {}, msg = {}, fallbackMeta = {}) {
  const attachmentMetas = resolveAttachmentMetas(msg, fallbackMeta?.attachmentMetas || []);
  const payload = {
    userName: String(msg?.userName || fallbackMeta?.userName || "").trim(),
    sessionId: String(msg?.sessionId || fallbackMeta?.sessionId || "").trim(),
    parentSessionId: String(
      msg?.parentSessionId || fallbackMeta?.parentSessionId || "",
    ).trim(),
    dialogProcessId:
      resolveMessageDialogProcessId(msg) ||
      resolveDialogProcessIdFromContext({
        dialogProcessId: fallbackMeta?.dialogProcessId,
      }),
    parentDialogProcessId: String(
      msg?.parentDialogProcessId || fallbackMeta?.parentDialogProcessId || "",
    ).trim(),
    attachments: attachmentMetas.map((attachmentItem) => ({
      attachmentId: String(attachmentItem?.attachmentId || "").trim(),
      name: String(attachmentItem?.name || "").trim(),
      path: String(attachmentItem?.path || "").trim(),
      relativePath: String(attachmentItem?.relativePath || "").trim(),
      parsedResultAttachmentId: String(
        attachmentItem?.parsedResultAttachmentId || "",
      ).trim(),
      parsedResultPath: String(attachmentItem?.parsedResultPath || "").trim(),
      parsedResultRelativePath: String(
        attachmentItem?.parsedResultRelativePath || "",
      ).trim(),
      parsedResultTool: String(attachmentItem?.parsedResultTool || "").trim(),
      parsedResultUpdatedAt: String(
        attachmentItem?.parsedResultUpdatedAt || "",
      ).trim(),
    })),
  };
  const userMetaTag = tEngine(runtime, "agent.userMetaTag");
  return `[${userMetaTag}]\n${JSON.stringify(payload, null, 2)}\n[/${userMetaTag}]`;
}

function buildHumanMessagesForUser(runtime = {}, msg = {}, fallbackMeta = {}) {
  const contentText = buildHumanMessageContent(msg, fallbackMeta?.attachmentMetas || []);
  const isFrontendUserMessage = msg?.frontendUserMessage === true;
  const contentMessage = isFrontendUserMessage
    ? new HumanMessage({
        content: contentText,
        additional_kwargs: { frontendUserMessage: true },
      })
    : new HumanMessage(contentText);
  const metaMessage = new HumanMessage(
    buildUserMetaInfoContent(runtime, msg, fallbackMeta),
  );
  return [contentMessage, metaMessage];
}

function resolveMainModelWindowConfig(runtime = {}) {
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const contextConfig =
    effectiveConfig?.context && typeof effectiveConfig.context === "object"
      ? effectiveConfig.context
      : {};
  const harnessConfig =
    effectiveConfig?.plugins?.harness && typeof effectiveConfig.plugins.harness === "object"
      ? effectiveConfig.plugins.harness
      : {};
  const harnessEnabled = harnessConfig.enabled === true;
  const harnessMode = String(harnessConfig.mode || "").trim().toLowerCase();
  const harnessActive = harnessEnabled && harnessMode !== "off" && harnessMode !== "disabled";
  const mainModelRecentWindow = contextConfig.mainModelRecentWindow !== false;
  const parsedMainModelRecentLimit = Number(contextConfig.mainModelRecentLimit);
  const mainModelRecentLimit =
    Number.isFinite(parsedMainModelRecentLimit) && parsedMainModelRecentLimit > 0
      ? Math.floor(parsedMainModelRecentLimit)
      : 15;
  const parsedHarnessRecentLimit = Number(harnessConfig.contextWindowRecentMessageLimit);
  const harnessRecentLimit =
    Number.isFinite(parsedHarnessRecentLimit) && parsedHarnessRecentLimit > 0
      ? Math.floor(parsedHarnessRecentLimit)
      : 20;
  return {
    mainModelRecentWindow,
    mainModelRecentLimit,
    harnessActive,
    harnessRecentLimit,
  };
}


function normalizeUnpairedTaskSummaryToolResults(historyMessages = []) {
  const source = Array.isArray(historyMessages) ? historyMessages : [];
  const knownToolCallIds = new Set();
  for (const msg of source) {
    if ((msg?.role || "") !== MESSAGE_ROLE.ASSISTANT) continue;
    const toolCalls = toLangChainToolCalls(msg?.tool_calls || []);
    for (const toolCall of toolCalls) {
      const id = String(toolCall?.id || "").trim();
      if (id) knownToolCallIds.add(id);
    }
  }

  return source.map((msg) => {
    if ((msg?.role || "") !== MESSAGE_ROLE.TOOL) return msg;
    if (!isTaskSummaryToolResultMessage(msg)) return msg;
    const toolCallId = String(msg?.tool_call_id || "").trim();
    if (toolCallId && knownToolCallIds.has(toolCallId)) return msg;
    const summaryText = extractTaskSummaryTextFromToolResult(msg);
    if (!summaryText) return msg;
    return {
      role: MESSAGE_ROLE.USER,
      content: `[阶段小结]
${summaryText}`,
      summarized: false,
      phaseSummaryMemory: true,
    };
  });
}

function buildHistoryMessages({
  effectiveHistoryMessages = [],
  runtime = {},
  fallbackUserMeta = {},
} = {}) {
  const history = [];
  const knownHistoryToolCallIds = new Set();
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    if ((msg?.role || "") !== MESSAGE_ROLE.ASSISTANT) continue;
    const normalizedToolCalls = toLangChainToolCalls(msg.tool_calls || []);
    for (const toolCall of normalizedToolCalls) {
      const toolCallId = String(toolCall?.id || "").trim();
      if (toolCallId) knownHistoryToolCallIds.add(toolCallId);
    }
  }
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    const role = msg.role || "";
    if (role === MESSAGE_ROLE.SYSTEM) {
      history.push(new SystemMessage(msg.content || ""));
      continue;
    }
    if (role === MESSAGE_ROLE.ASSISTANT) {
      const toolCalls = toLangChainToolCalls(msg.tool_calls || []);
      const resolvedAssistantContent =
        typeof msg?.rawModelContent === "string" || Array.isArray(msg?.rawModelContent)
          ? msg.rawModelContent
          : msg.content || "";
      history.push(
        new AIMessage({
          content: resolvedAssistantContent,
          tool_calls: toolCalls,
        }),
      );
      continue;
    }
    if (role === MESSAGE_ROLE.TOOL) {
      const toolCallId = String(msg?.tool_call_id || "").trim();
      if (toolCallId && !knownHistoryToolCallIds.has(toolCallId)) {
        if (isTaskSummaryToolResultMessage(msg)) {
          const fallbackSummaryMessage = buildTaskSummaryFallbackHumanMessage(msg);
          if (fallbackSummaryMessage) history.push(fallbackSummaryMessage);
        }
        continue;
      }
      history.push(
        new ToolMessage({
          tool_call_id: toolCallId,
          content: compactToolResultTextForModel(msg.content || ""),
        }),
      );
      continue;
    }
    if (msg?.phaseSummaryMemory === true) {
      history.push(
        new HumanMessage({
          content: String(msg?.content || ""),
          additional_kwargs: {
            noobotInternalMessageType: "phase_summary_memory",
          },
        }),
      );
      continue;
    }
    history.push(...buildHumanMessagesForUser(runtime, msg, fallbackUserMeta));
  }
  return history;
}

export function buildContextMessageBlocks(
  agentContext,
  { currentUserMessage = "" } = {},
) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const {
    mainModelRecentWindow,
    mainModelRecentLimit,
    harnessActive,
    harnessRecentLimit,
  } = resolveMainModelWindowConfig(runtime);
  const systemRuntime = runtime?.systemRuntime || {};
  const fallbackUserMeta = {
    userName: String(runtime?.userId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || "").trim(),
    parentSessionId: String(systemRuntime?.parentSessionId || "").trim(),
    dialogProcessId: "",
    parentDialogProcessId: String(
      systemRuntime?.parentDialogProcessId || "",
    ).trim(),
    attachmentMetas: Array.isArray(runtime?.attachmentMetas)
      ? runtime.attachmentMetas
      : [],
  };
  const systemMessages = Array.isArray(agentContext?.payload?.messages?.system)
    ? agentContext.payload.messages.system
    : [];
  const rawHistoryMessages = Array.isArray(agentContext?.payload?.messages?.history)
    ? agentContext.payload.messages.history
    : [];
  const historyMessages = normalizeUnpairedTaskSummaryToolResults(rawHistoryMessages);
  const resolvedDialogProcessId = resolveDialogProcessId({
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: systemRuntime?.dialogProcessId,
          controllers: { runtime: { systemRuntime } },
        },
      },
    },
    messages: historyMessages,
  });
  fallbackUserMeta.dialogProcessId = resolvedDialogProcessId;
  const effectiveHistoryMessages = resolveModelContextMessages({
    sourceMessages: historyMessages,
    currentDialogProcessId: resolvedDialogProcessId,
    mode: "agent",
    useRecentWindow: mainModelRecentWindow,
    recentLimit: harnessActive ? harnessRecentLimit : mainModelRecentLimit,
  });
  const system = [];
  for (const content of systemMessages) {
    system.push(
      new SystemMessage({
        content,
        additional_kwargs: {
          noobotInternalMessageType: "system_context",
        },
      }),
    );
  }
  const history = buildHistoryMessages({
    effectiveHistoryMessages,
    runtime,
    fallbackUserMeta,
  });
  const incremental = [];
  const normalizedCurrentUserMessage = String(currentUserMessage || "").trim();
  if (normalizedCurrentUserMessage) {
    incremental.push(
      ...buildHumanMessagesForUser(
        runtime,
        {
          role: MESSAGE_ROLE.USER,
          content: normalizedCurrentUserMessage,
          frontendUserMessage: true,
          userName: fallbackUserMeta.userName,
          attachmentMetas: fallbackUserMeta.attachmentMetas,
          sessionId: fallbackUserMeta.sessionId,
          parentSessionId: fallbackUserMeta.parentSessionId,
          dialogProcessId: fallbackUserMeta.dialogProcessId,
          parentDialogProcessId: fallbackUserMeta.parentDialogProcessId,
        },
        fallbackUserMeta,
      ),
    );
  }
  return {
    system,
    history,
    incremental,
    messages: [...system, ...history, ...incremental],
    resolvedDialogProcessId,
  };
}

export function buildContextMessages(
  agentContext,
  { currentUserMessage = "" } = {},
) {
  return buildContextMessageBlocks(agentContext, {
    currentUserMessage,
  }).messages;
}
