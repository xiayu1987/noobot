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
import { resolveMainModelFinalMessages } from "../../../session/utils/context-window-normalizer.js";
import { compactToolResultTextForModel } from "../../../semantic-transfer/core/compact.js";
import { getTransferAttachmentMetas } from "../../../semantic-transfer/storage/consumer.js";
import {
  resolveDialogProcessIdFromContext,
  resolveDialogProcessId,
  resolveMessageDialogProcessId,
} from "../../../context/session/dialog-process-id-resolver.js";
import {
  normalizeParentSessionId,
  resolveParentSessionId,
} from "../../../context/parent-session-id-resolver.js";
import {
  normalizeAttachmentParsedResultMeta,
  resolveRuntimeUserMessageAttachments,
} from "../../../attach/index.js";


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

function resolveMessageRole(msg = {}) {
  const explicitType = String(msg?.type || msg?.lc_kwargs?.type || "").trim().toLowerCase();
  const langChainType = typeof msg?._getType === "function"
    ? String(msg._getType() || "").trim().toLowerCase()
    : "";
  const type = explicitType || langChainType;
  if (type === "human") return MESSAGE_ROLE.USER;
  if (type === "ai") return MESSAGE_ROLE.ASSISTANT;
  if (type === "tool" || type === "tool_result") return MESSAGE_ROLE.TOOL;
  if (type === "system") return MESSAGE_ROLE.SYSTEM;
  const explicitRole = String(msg?.role || "").trim().toLowerCase();
  if (explicitRole) return explicitRole;
  return "";
}

function resolveMessageToolCalls(msg = {}) {
  if (Array.isArray(msg?.tool_calls)) return msg.tool_calls;
  if (Array.isArray(msg?.lc_kwargs?.tool_calls)) return msg.lc_kwargs.tool_calls;
  if (Array.isArray(msg?.additional_kwargs?.tool_calls)) return msg.additional_kwargs.tool_calls;
  return [];
}

function resolveMessageToolCallId(msg = {}) {
  return String(
    msg?.tool_call_id ||
      msg?.toolCallId ||
      msg?.lc_kwargs?.tool_call_id ||
      msg?.lc_kwargs?.toolCallId ||
      msg?.additional_kwargs?.tool_call_id ||
      "",
  ).trim();
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

function resolveAttachments(msg = {}, fallbackAttachments = []) {
  const transferAttachments = getTransferAttachmentMetas(
    [
      ...(Array.isArray(msg?.transferEnvelopes) ? msg.transferEnvelopes : []),
      ...(Array.isArray(msg?.lc_kwargs?.transferEnvelopes) ? msg.lc_kwargs.transferEnvelopes : []),
    ].filter(Boolean),
  );
  if (transferAttachments.length) return transferAttachments;
  if (Array.isArray(msg?.attachments)) return msg.attachments;
  return Array.isArray(fallbackAttachments) ? fallbackAttachments : [];
}

function resolveFallbackAttachments(meta = {}) {
  if (Array.isArray(meta?.userMessageAttachments)) return meta.userMessageAttachments;
  return [];
}

function buildHumanMessageContent(msg = {}, fallbackAttachments = []) {
  const textContent = String(msg?.content || "");
  void fallbackAttachments;
  return textContent;
}

function buildUserMetaAttachmentInfo(attachmentItem = {}) {
  const parsedResult = normalizeAttachmentParsedResultMeta(attachmentItem);
  const size = Number(attachmentItem?.size);
  return {
    attachmentId: String(attachmentItem?.attachmentId || "").trim(),
    name: String(attachmentItem?.name || "").trim(),
    mimeType: String(attachmentItem?.mimeType || "").trim(),
    attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
    sessionId: String(attachmentItem?.sessionId || "").trim(),
    path: String(attachmentItem?.path || "").trim(),
    relativePath: String(attachmentItem?.relativePath || "").trim(),
    sandboxPath: String(attachmentItem?.sandboxPath || "").trim(),
    downloadUrl: String(attachmentItem?.downloadUrl || "").trim(),
    previewUrl: String(attachmentItem?.previewUrl || "").trim(),
    parsedResultUrl: String(attachmentItem?.parsedResultUrl || "").trim(),
    parsedResultName: String(attachmentItem?.parsedResultName || "").trim(),
    parsedResultAttachmentId: String(attachmentItem?.parsedResultAttachmentId || "").trim(),
    transferFilePath: String(attachmentItem?.transferFilePath || "").trim(),
    ...(Number.isFinite(size) ? { size } : {}),
    ...(typeof attachmentItem?.isSandbox === "boolean" ? { isSandbox: attachmentItem.isSandbox } : {}),
    ...(parsedResult ? { parsedResult } : {}),
  };
}

function buildUserMetaInfoContent(
  runtime = {},
  msg = {},
  fallbackMeta = {},
  {
    allowFallbackAttachments = true,
    allowFallbackIdentity = true,
  } = {},
) {
  const identityFallback = allowFallbackIdentity ? fallbackMeta : {};
  const fallbackAttachments = allowFallbackAttachments
    ? resolveFallbackAttachments(fallbackMeta)
    : [];
  const attachments = resolveAttachments(msg, fallbackAttachments);
  const fallbackParentSessionId = resolveParentSessionId({
    runtime,
    parentSessionId: identityFallback?.parentSessionId,
  });
  const messageParentSessionId = normalizeParentSessionId(msg?.parentSessionId);
  const payload = {
    userName: String(msg?.userName || identityFallback?.userName || "").trim(),
    sessionId: String(msg?.sessionId || identityFallback?.sessionId || "").trim(),
    parentSessionId: messageParentSessionId
      ? messageParentSessionId
      : fallbackParentSessionId,
    dialogProcessId:
      resolveMessageDialogProcessId(msg) ||
      resolveDialogProcessIdFromContext({
        dialogProcessId: identityFallback?.dialogProcessId,
      }),
    parentDialogProcessId: String(
      msg?.parentDialogProcessId || identityFallback?.parentDialogProcessId || "",
    ).trim(),
    turnScopeId: String(msg?.turnScopeId || identityFallback?.turnScopeId || "").trim(),
    attachments: attachments.map((attachmentItem) => buildUserMetaAttachmentInfo(attachmentItem)),
  };
  const userMetaTag = tEngine(runtime, "agent.userMetaTag");
  return `[${userMetaTag}]\n${JSON.stringify(payload, null, 2)}\n[/${userMetaTag}]`;
}

export function buildHumanMessagesForUser(
  runtime = {},
  msg = {},
  fallbackMeta = {},
  {
    allowFallbackAttachments = true,
    allowFallbackIdentity = true,
  } = {},
) {
  const contentText = buildHumanMessageContent(
    msg,
    resolveFallbackAttachments(fallbackMeta),
  );
  const isFrontendUserMessage = msg?.frontendUserMessage === true;
  const identityKwargs = buildModelMessageIdentityKwargs(msg, fallbackMeta);
  const contentMessage = isFrontendUserMessage
    ? new HumanMessage({
        content: contentText,
        additional_kwargs: {
          ...identityKwargs,
          frontendUserMessage: true,
        },
      })
    : new HumanMessage({
        content: contentText,
        additional_kwargs: identityKwargs,
      });
  const metaMessage = new HumanMessage({
    content: buildUserMetaInfoContent(runtime, msg, fallbackMeta, {
      allowFallbackAttachments,
      allowFallbackIdentity,
    }),
    additional_kwargs: {
      ...identityKwargs,
      noobotInternalMessageType: "user_meta",
    },
  });
  return [contentMessage, metaMessage];
}

function shouldBuildUserMetaForHistoryMessage(msg = {}) {
  if (resolveMessageRole(msg) !== MESSAGE_ROLE.USER) return false;
  if (msg?.phaseSummaryMemory === true) return false;
  if (msg?.injectedMessage === true || msg?.pluginMessage === true) return false;
  if (String(msg?.injectedMessageType || msg?.injected_message_type || "").trim()) return false;
  // Older persisted frontend messages predate frontendUserMessage. A durable
  // turn identity is sufficient to recognize those messages without treating
  // internal Agent user messages as frontend input.
  return (
    msg?.frontendUserMessage === true ||
    Boolean(String(msg?.turnScopeId || "").trim()) ||
    Boolean(resolveMessageDialogProcessId(msg)) ||
    resolveAttachments(msg, []).length > 0
  );
}

function buildModelMessageIdentityKwargs(msg = {}, fallbackMeta = {}) {
  const dialogProcessId = String(
    msg?.dialogProcessId || fallbackMeta?.dialogProcessId || "",
  ).trim();
  const parentDialogProcessId = String(
    msg?.parentDialogProcessId || fallbackMeta?.parentDialogProcessId || "",
  ).trim();
  const turnScopeId = String(msg?.turnScopeId || fallbackMeta?.turnScopeId || "").trim();
  return {
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(parentDialogProcessId ? { parentDialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    ...(msg?.frontendUserMessage === true ? { frontendUserMessage: true } : {}),
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
      dialogProcessId: msg?.dialogProcessId,
      parentDialogProcessId: msg?.parentDialogProcessId,
      turnScopeId: msg?.turnScopeId,
      summarized: false,
      phaseSummaryMemory: true,
    };
  });
}

function filterCurrentTurnUserMessageFromHistory(
  historyMessages = [],
  { turnScopeId = "", currentDialogProcessId = "" } = {},
) {
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const normalizedDialogProcessId = String(currentDialogProcessId || "").trim();
  if (!normalizedTurnScopeId && !normalizedDialogProcessId) return historyMessages;
  const source = Array.isArray(historyMessages) ? historyMessages : [];
  const blockedDialogProcessIds = new Set();
  const blockedTurnScopeIds = new Set();
  for (const msg of source) {
    if ((msg?.role || "") !== MESSAGE_ROLE.USER) continue;
    const messageTurnScopeId = String(msg?.turnScopeId || "").trim();
    const messageDialogProcessId = String(msg?.dialogProcessId || "").trim();
    const sameTurn = normalizedTurnScopeId && messageTurnScopeId === normalizedTurnScopeId;
    const sameDialog =
      normalizedDialogProcessId && messageDialogProcessId === normalizedDialogProcessId;
    if (!sameTurn && !sameDialog) continue;
    if (messageTurnScopeId) blockedTurnScopeIds.add(messageTurnScopeId);
    if (messageDialogProcessId) blockedDialogProcessIds.add(messageDialogProcessId);
  }
  if (!blockedTurnScopeIds.size && !blockedDialogProcessIds.size) return source;
  return source.filter((msg = {}) => {
    const messageTurnScopeId = String(msg?.turnScopeId || "").trim();
    const messageDialogProcessId = String(msg?.dialogProcessId || "").trim();
    if (messageTurnScopeId && blockedTurnScopeIds.has(messageTurnScopeId)) return false;
    if (messageDialogProcessId && blockedDialogProcessIds.has(messageDialogProcessId)) return false;
    return true;
  });
}

function buildHistoryMessages({
  effectiveHistoryMessages = [],
  runtime = {},
  fallbackUserMeta = {},
  includeUserMeta = true,
} = {}) {
  const history = [];
  const knownHistoryToolCallIds = new Set();
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    if (resolveMessageRole(msg) !== MESSAGE_ROLE.ASSISTANT) continue;
    const normalizedToolCalls = toLangChainToolCalls(resolveMessageToolCalls(msg));
    for (const toolCall of normalizedToolCalls) {
      const toolCallId = String(toolCall?.id || "").trim();
      if (toolCallId) knownHistoryToolCallIds.add(toolCallId);
    }
  }
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    const role = resolveMessageRole(msg);
    if (role === MESSAGE_ROLE.SYSTEM) {
      history.push(new SystemMessage({
        content: msg.content || "",
        additional_kwargs: buildModelMessageIdentityKwargs(msg, fallbackUserMeta),
      }));
      continue;
    }
    if (role === MESSAGE_ROLE.ASSISTANT) {
      const toolCalls = toLangChainToolCalls(resolveMessageToolCalls(msg));
      const resolvedAssistantContent =
        typeof msg?.rawModelContent === "string" || Array.isArray(msg?.rawModelContent)
          ? msg.rawModelContent
          : msg.content || "";
      history.push(
        new AIMessage({
          content: resolvedAssistantContent,
          tool_calls: toolCalls,
          additional_kwargs: buildModelMessageIdentityKwargs(msg, fallbackUserMeta),
        }),
      );
      continue;
    }
    if (role === MESSAGE_ROLE.TOOL) {
      const toolCallId = resolveMessageToolCallId(msg);
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
          additional_kwargs: buildModelMessageIdentityKwargs(msg, fallbackUserMeta),
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
    if (
      includeUserMeta ||
      msg?.frontendUserMessage === true ||
      shouldBuildUserMetaForHistoryMessage(msg)
    ) {
      history.push(...buildHumanMessagesForUser(runtime, msg, fallbackUserMeta, {
        // Historical metadata is message-scoped. Never fill a historical
        // message with the current request's identity or attachments.
        allowFallbackAttachments: false,
        allowFallbackIdentity: false,
      }));
    } else {
      history.push(
        new HumanMessage({
          content: buildHumanMessageContent(
            msg,
            resolveFallbackAttachments(fallbackUserMeta),
          ),
          additional_kwargs: buildModelMessageIdentityKwargs(msg, fallbackUserMeta),
        }),
      );
    }
  }
  return history;
}

export function buildContextMessageBlocks(
  agentContext,
  { currentUserMessage = "" } = {},
) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const systemRuntime = runtime?.systemRuntime || {};
  const runtimeParentSessionId = resolveParentSessionId({ runtime });
  const currentUserMessageAttachments = resolveRuntimeUserMessageAttachments(runtime);
  const fallbackUserMeta = {
    userName: String(runtime?.userId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || "").trim(),
    parentSessionId: runtimeParentSessionId,
    dialogProcessId: "",
    parentDialogProcessId: String(
      systemRuntime?.parentDialogProcessId || "",
    ).trim(),
    attachments: currentUserMessageAttachments,
    userMessageAttachments: currentUserMessageAttachments,
  };
  const systemMessages = Array.isArray(agentContext?.payload?.messages?.system)
    ? agentContext.payload.messages.system
    : [];
  const resumedStoppedSnapshotMessageBlocks =
    runtime?.resumeFromStoppedSnapshot === true &&
    runtime?.resumedStoppedSnapshotMessageBlocks &&
    typeof runtime.resumedStoppedSnapshotMessageBlocks === "object" &&
    !Array.isArray(runtime.resumedStoppedSnapshotMessageBlocks)
      ? runtime.resumedStoppedSnapshotMessageBlocks
      : null;
  const rawHistoryMessages = Array.isArray(agentContext?.payload?.messages?.history)
    ? agentContext.payload.messages.history
    : [];
  const rawResumedSnapshotIncrementalMessages = Array.isArray(
    resumedStoppedSnapshotMessageBlocks?.incremental,
  )
    ? resumedStoppedSnapshotMessageBlocks.incremental
    : [];
  const currentTurnScopeId = String(
    systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || "",
  ).trim();
  fallbackUserMeta.turnScopeId = currentTurnScopeId;
  const historyMessages = filterCurrentTurnUserMessageFromHistory(
    normalizeUnpairedTaskSummaryToolResults(rawHistoryMessages),
    {
      turnScopeId: currentTurnScopeId,
      currentDialogProcessId: systemRuntime?.dialogProcessId,
    },
  );
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
  const rawIncrementalMessages = [];
  const normalizedCurrentUserMessage = String(currentUserMessage || "").trim();
  if (normalizedCurrentUserMessage) {
    rawIncrementalMessages.push({
      role: MESSAGE_ROLE.USER,
      content: normalizedCurrentUserMessage,
      frontendUserMessage: true,
      userName: fallbackUserMeta.userName,
      attachments: fallbackUserMeta.attachments,
      sessionId: fallbackUserMeta.sessionId,
      parentSessionId: fallbackUserMeta.parentSessionId,
      dialogProcessId: fallbackUserMeta.dialogProcessId,
      parentDialogProcessId: fallbackUserMeta.parentDialogProcessId,
      turnScopeId: currentTurnScopeId,
    });
  }

  const resolvedMainBlocks = resolveMainModelFinalMessages({
    systemMessages,
    historyMessages,
    incrementalMessages: [
      ...rawResumedSnapshotIncrementalMessages,
      ...rawIncrementalMessages,
    ],
  });

  const system = [];
  for (const content of resolvedMainBlocks.system) {
    system.push(
      new SystemMessage({
        content: typeof content === "string" ? content : String(content?.content || ""),
        additional_kwargs: {
          noobotInternalMessageType: "system_context",
        },
      }),
    );
  }
  const history = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.history,
    runtime,
    fallbackUserMeta,
    includeUserMeta: false,
  });
  const incremental = [];
  const restoredSnapshotIncrementalMessages = resolvedMainBlocks.incremental.filter((msg) =>
    rawResumedSnapshotIncrementalMessages.includes(msg),
  );
  if (restoredSnapshotIncrementalMessages.length) {
    incremental.push(
      ...buildHistoryMessages({
        effectiveHistoryMessages: restoredSnapshotIncrementalMessages,
        runtime,
        fallbackUserMeta,
        includeUserMeta: false,
      }),
    );
  }
  for (const msg of resolvedMainBlocks.incremental) {
    if (rawResumedSnapshotIncrementalMessages.includes(msg)) continue;
    const role = resolveMessageRole(msg);
    if (role === MESSAGE_ROLE.USER || msg?.frontendUserMessage === true) {
      incremental.push(...buildHumanMessagesForUser(runtime, msg, fallbackUserMeta));
    } else {
      incremental.push(
        ...buildHistoryMessages({
          effectiveHistoryMessages: [msg],
          runtime,
          fallbackUserMeta,
          includeUserMeta: true,
        }),
      );
    }
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
