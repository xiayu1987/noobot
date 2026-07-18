/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SystemMessage } from "@langchain/core/messages";
import { MESSAGE_ROLE } from "../../../../bot-manage/config/constants.js";
import { resolveMainModelFinalMessages } from "../../../../session/utils/context-window-normalizer.js";
import { resolveDialogProcessId, resolveMessageDialogProcessId } from "../../../../context/session/dialog-process-id-resolver.js";
import { resolveParentSessionId } from "../../../../context/parent-session-id-resolver.js";
import { resolveRuntimeUserMessageAttachments } from "../../../../attach/index.js";
import { resolveMessageRole } from "./message-utils.js";
import { resolveMessageTurnScopeId } from "./user-meta.js";
import { normalizeUnpairedTaskSummaryToolResults } from "./task-summary.js";
import { buildHistoryMessages, filterCurrentTurnUserMessageFromHistory } from "./history.js";

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
  const rawHistoryMessages = Array.isArray(agentContext?.payload?.messages?.history)
    ? agentContext.payload.messages.history
    : [];
  const restoredIncrementalMessages = Array.isArray(agentContext?.payload?.messages?.incremental)
    ? agentContext.payload.messages.incremental
    : [];
  const currentTurnScopeId = String(
    systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || "",
  ).trim();
  fallbackUserMeta.turnScopeId = currentTurnScopeId;
  const normalizedCurrentUserMessage = String(currentUserMessage || "").trim();
  const normalizedHistoryMessages = normalizeUnpairedTaskSummaryToolResults(rawHistoryMessages);
  const historyMessages = normalizedCurrentUserMessage
    ? filterCurrentTurnUserMessageFromHistory(
        normalizedHistoryMessages,
        {
          turnScopeId: currentTurnScopeId,
          currentDialogProcessId: systemRuntime?.dialogProcessId,
        },
      )
    : normalizedHistoryMessages;
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
  const rawIncrementalMessages = [...restoredIncrementalMessages];
  if (normalizedCurrentUserMessage) {
    const currentMessageOrigin = String(systemRuntime?.caller || "user").trim().toLowerCase() === "bot"
      ? "internal"
      : "user";
    const currentAlreadyInIncremental = rawIncrementalMessages.some((msg = {}) =>
      resolveMessageRole(msg) === MESSAGE_ROLE.USER &&
        resolveMessageDialogProcessId(msg) === fallbackUserMeta.dialogProcessId &&
        resolveMessageTurnScopeId(msg) === currentTurnScopeId
    );
    if (!currentAlreadyInIncremental) {
      rawIncrementalMessages.push({
        role: MESSAGE_ROLE.USER,
        content: normalizedCurrentUserMessage,
        frontendUserMessage: currentMessageOrigin === "user",
        messageOrigin: currentMessageOrigin,
        userName: fallbackUserMeta.userName,
        attachments: fallbackUserMeta.attachments,
        sessionId: fallbackUserMeta.sessionId,
        parentSessionId: fallbackUserMeta.parentSessionId,
        dialogProcessId: fallbackUserMeta.dialogProcessId,
        parentDialogProcessId: fallbackUserMeta.parentDialogProcessId,
        turnScopeId: currentTurnScopeId,
      });
    }
  }

  const resolvedMainBlocks = resolveMainModelFinalMessages({
    systemMessages,
    historyMessages,
    incrementalMessages: rawIncrementalMessages,
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
  // Process the complete incremental block together. Building each message in
  // isolation prevented a ToolMessage from seeing its preceding
  // AIMessage.tool_calls, so restored tool results were discarded.
  const incremental = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.incremental,
    runtime,
    fallbackUserMeta,
    includeUserMeta: false,
    allowMessageAttachments: true,
  });
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
