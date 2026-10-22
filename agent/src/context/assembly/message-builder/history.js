/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { resolveLocaleFromRuntime } from "noobot-i18n/shared";
import {
  projectContextMessageModelMetadata,
  readContextMessageField,
  readContextMessageValue,
  resolveContextMessageRole,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { MESSAGE_ROLE } from "../../../bot/config/constants.js";
import { compactToolResultTextForModel } from "../../../transfer-adapter/core/compact.js";
import { toLangChainToolCalls } from "../../../models/adapters/langchain/context-message-adapter.js";
import {
  isCheckpointBoundaryToolResultMessage,
  buildTaskSummaryFallbackHumanMessage,
  shouldSkipSummarizedHistoryMessage,
} from "./task-summary.js";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "@noobot/context-protocol/message/internal-types";
import {
  buildHumanMessageContent,
  buildHumanMessagesForUser,
  shouldBuildUserMetaForHistoryMessage,
  isDerivedUserMetaMessage,
} from "./user-meta.js";
import { text } from "@noobot/shared/value";

function buildAssistantAdditionalKwargs(msg = {}) {
  const metadata = projectContextMessageModelMetadata(msg);
  const reasoning = readContextMessageValue(msg, "modelAdditionalKwargs")?.reasoning;
  return reasoning && typeof reasoning === "object" ? { ...metadata, reasoning } : metadata;
}

function resolveAssistantModelContent(msg = {}) {
  const rawModelContent = readContextMessageValue(msg, "rawModelContent");
  return typeof rawModelContent === "string" || Array.isArray(rawModelContent)
    ? rawModelContent
    : msg.content || "";
}

function isPhaseSummaryMemoryMessage(msg = {}) {
  return (
    readContextMessageField(msg, "noobotInternalMessageType") ===
    CONTEXT_INTERNAL_MESSAGE_TYPE.PHASE_SUMMARY_MEMORY
  );
}

export function buildHistoryMessages({ effectiveHistoryMessages = [], runtime = {} } = {}) {
  const history = [];
  const knownHistoryToolCallIds = new Set();
  const historyToolCallsById = new Map();
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    if (resolveContextMessageRole(msg) !== MESSAGE_ROLE.ASSISTANT) continue;
    const normalizedToolCalls = toLangChainToolCalls(resolveContextToolCalls(msg));
    for (const toolCall of normalizedToolCalls) {
      const toolCallId = text(toolCall?.id);
      if (toolCallId) {
        knownHistoryToolCallIds.add(toolCallId);
        historyToolCallsById.set(toolCallId, toolCall);
      }
    }
  }
  for (const msg of effectiveHistoryMessages) {
    if (shouldSkipSummarizedHistoryMessage(msg)) continue;
    if (isDerivedUserMetaMessage(msg)) continue;
    const role = resolveContextMessageRole(msg);
    if (role === MESSAGE_ROLE.SYSTEM) {
      history.push(
        new SystemMessage({
          content: msg.content || "",
          additional_kwargs: projectContextMessageModelMetadata(msg),
        }),
      );
      continue;
    }
    if (role === MESSAGE_ROLE.ASSISTANT) {
      const toolCalls = toLangChainToolCalls(resolveContextToolCalls(msg));
      const modelResponseMetadata = readContextMessageValue(msg, "modelResponseMetadata");
      const responseMetadata = Array.isArray(modelResponseMetadata?.output)
        ? { output: modelResponseMetadata.output }
        : {};
      history.push(
        new AIMessage({
          content: resolveAssistantModelContent(msg),
          tool_calls: toolCalls,
          additional_kwargs: buildAssistantAdditionalKwargs(msg),
          response_metadata: responseMetadata,
        }),
      );
      continue;
    }
    if (role === MESSAGE_ROLE.TOOL) {
      const toolCallId = resolveContextToolResultCallId(msg);
      if (toolCallId && !knownHistoryToolCallIds.has(toolCallId)) {
        if (isCheckpointBoundaryToolResultMessage(msg)) {
          const fallbackSummaryMessage = buildTaskSummaryFallbackHumanMessage(msg, {
            locale: resolveLocaleFromRuntime(runtime),
          });
          if (fallbackSummaryMessage) history.push(fallbackSummaryMessage);
        }
        continue;
      }

      const declaredContextPolicy = resolveToolContextPolicy(historyToolCallsById.get(toolCallId));
      history.push(
        new ToolMessage({
          tool_call_id: toolCallId,
          content: compactToolResultTextForModel(msg.content || ""),
          additional_kwargs: {
            ...projectContextMessageModelMetadata(msg),
            ...(declaredContextPolicy ? { contextPolicy: declaredContextPolicy } : {}),
          },
        }),
      );
      continue;
    }
    if (isPhaseSummaryMemoryMessage(msg)) {
      history.push(
        new HumanMessage({
          content: String(msg?.content || ""),
          additional_kwargs: projectContextMessageModelMetadata(msg),
        }),
      );
      continue;
    }
    if (shouldBuildUserMetaForHistoryMessage(msg)) {
      history.push(...buildHumanMessagesForUser(runtime, msg));
    } else {
      history.push(
        new HumanMessage({
          content: buildHumanMessageContent(msg),
          additional_kwargs: projectContextMessageModelMetadata(msg),
        }),
      );
    }
  }
  return history;
}
