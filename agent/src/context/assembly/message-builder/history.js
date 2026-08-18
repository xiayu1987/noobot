/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { filterCurrentTurnMessagesFromHistory } from "@noobot/context-protocol/policy/block";
import {
  projectContextMessageIdentityMetadata,
  resolveContextMessageRole,
  resolveContextToolCallId,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { MESSAGE_ROLE } from "../../../bot/config/constants.js";
import { compactToolResultTextForModel } from "../../../transfer-adapter/core/compact.js";
import { toLangChainToolCalls } from "../../../models/adapters/langchain/context-message-adapter.js";
import {
  isTaskSummaryToolResultMessage,
  buildTaskSummaryFallbackHumanMessage,
  shouldSkipSummarizedHistoryMessage,
} from "./task-summary.js";
import {
  resolveFallbackAttachments,
  buildHumanMessageContent,
  buildHumanMessagesForUser,
  shouldBuildUserMetaForHistoryMessage,
  isDerivedUserMetaMessage,
  buildRestoredUserMetaIndex,
  buildRestorableUserMetaKeys,
  normalizeRestoredUserSource,
} from "./user-meta.js";

export function filterCurrentTurnUserMessageFromHistory(
  historyMessages = [],
  { turnScopeId = "", currentDialogProcessId = "" } = {},
) {
  return filterCurrentTurnMessagesFromHistory(historyMessages, {
    currentTurnScopeId: turnScopeId,
    currentDialogProcessId,
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
    if (resolveContextMessageRole(msg) !== MESSAGE_ROLE.ASSISTANT) continue;
    const normalizedToolCalls = toLangChainToolCalls(resolveContextToolCalls(msg));
    for (const toolCall of normalizedToolCalls) {
      const toolCallId = String(toolCall?.id || "").trim();
      if (toolCallId) knownHistoryToolCallIds.add(toolCallId);
    }
  }
  for (const sourceMessage of effectiveHistoryMessages) {
    const msg = normalizeRestoredUserSource(sourceMessage, restoredUserMetaIndex);
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    if (isDerivedUserMetaMessage(msg, runtime)) continue;
    const role = resolveContextMessageRole(msg);
    if (role === MESSAGE_ROLE.SYSTEM) {
      history.push(
        new SystemMessage({
          content: msg.content || "",
          additional_kwargs: projectContextMessageIdentityMetadata(msg),
        }),
      );
      continue;
    }
    if (role === MESSAGE_ROLE.ASSISTANT) {
      const toolCalls = toLangChainToolCalls(resolveContextToolCalls(msg));
      const resolvedAssistantContent =
        typeof msg?.rawModelContent === "string" || Array.isArray(msg?.rawModelContent)
          ? msg.rawModelContent
          : msg.content || "";
      history.push(
        new AIMessage({
          content: resolvedAssistantContent,
          tool_calls: toolCalls,
          additional_kwargs: projectContextMessageIdentityMetadata(msg),
        }),
      );
      continue;
    }
    if (role === MESSAGE_ROLE.TOOL) {
      const toolCallId = resolveContextToolCallId(msg);
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
          additional_kwargs: projectContextMessageIdentityMetadata(msg),
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
      history.push(
        ...buildHumanMessagesForUser(runtime, msg, fallbackUserMeta, {
          allowFallbackAttachments: false,
          allowFallbackIdentity: false,
          allowMessageAttachments,
          allowFallbackRoundIdentity: false,
        }),
      );
    } else {
      history.push(
        new HumanMessage({
          content: buildHumanMessageContent(msg, resolveFallbackAttachments(fallbackUserMeta)),
          additional_kwargs: projectContextMessageIdentityMetadata(msg),
        }),
      );
    }
  }
  return history;
}
