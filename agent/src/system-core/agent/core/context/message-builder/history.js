/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { MESSAGE_ROLE } from "../../../../bot-manage/config/constants.js";
import { compactToolResultTextForModel } from "../../../../semantic-transfer/core/compact.js";
import { resolveMessageRole, resolveMessageToolCalls, resolveMessageToolCallId, toLangChainToolCalls, buildModelMessageIdentityKwargs } from "./message-utils.js";
import { isTaskSummaryToolResultMessage, buildTaskSummaryFallbackHumanMessage, shouldSkipSummarizedHistoryMessage } from "./task-summary.js";
import { resolveFallbackAttachments, buildHumanMessageContent, buildHumanMessagesForUser, shouldBuildUserMetaForHistoryMessage, isDerivedUserMetaMessage, buildRestoredUserMetaIndex, buildRestorableUserMetaKeys, normalizeRestoredUserSource } from "./user-meta.js";

export function filterCurrentTurnUserMessageFromHistory(
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

export function buildHistoryMessages({
  effectiveHistoryMessages = [],
  runtime = {},
  fallbackUserMeta = {},
  includeUserMeta = true,
  allowMessageAttachments = true,
} = {}) {
  const history = [];
  const knownHistoryToolCallIds = new Set();
  const restoredUserMetaIndex = buildRestoredUserMetaIndex(effectiveHistoryMessages, runtime);
  const restorableUserMetaKeys = buildRestorableUserMetaKeys(effectiveHistoryMessages, runtime);
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    if (resolveMessageRole(msg) !== MESSAGE_ROLE.ASSISTANT) continue;
    const normalizedToolCalls = toLangChainToolCalls(resolveMessageToolCalls(msg));
    for (const toolCall of normalizedToolCalls) {
      const toolCallId = String(toolCall?.id || "").trim();
      if (toolCallId) knownHistoryToolCallIds.add(toolCallId);
    }
  }
  for (const sourceMessage of effectiveHistoryMessages) {
    const msg = normalizeRestoredUserSource(sourceMessage, restoredUserMetaIndex);
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    // Metadata is derived from a real user message. Restored snapshots may
    // contain an older projection, which must not become a new user source.
    if (isDerivedUserMetaMessage(msg, runtime)) continue;
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
    if (shouldBuildUserMetaForHistoryMessage(msg, runtime, { restorableUserMetaKeys })) {
      history.push(...buildHumanMessagesForUser(runtime, msg, fallbackUserMeta, {
        // Historical metadata is message-scoped. Never fill a historical
        // message with the current request's identity or attachments.
        allowFallbackAttachments: false,
        allowFallbackIdentity: false,
        allowMessageAttachments,
        allowFallbackRoundIdentity: false,
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
