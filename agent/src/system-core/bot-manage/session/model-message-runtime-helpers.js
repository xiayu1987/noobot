/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveMainModelFinalMessages,
} from "../../session/utils/context-window-normalizer.js";
import {
  collectLatestTaskSummaryMessageIndexes,
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedMessageInScope,
} from "../../context/session/summarized-message-policy.js";
import {
  collectLatestInjectedMessageIndexes,
  filterForModelContext,
  filterInjectedMessagesForDialog,
} from "../../context/session/message-context-policy.js";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import { normalizeMessageForModelRuntime } from "./session-execution-engine-utils.js";
import { emitModelContextTrace, summarizeDiagnosticBlocks, summarizeDiagnosticMessages } from "../../agent/core/message-context/context-diagnostics.js";

const PLUGIN_DEEP_MERGE_KEYS = new Set([
  "stepModels",
  "capabilityModelByPurpose",
  "capabilityToolAllowlistByPurpose",
  "acceptance",
  "review",
]);

function shouldUsePayloadMessageBlocks(purpose = "") {
  const normalizedPurpose = String(purpose || "").trim().toLowerCase();
  return Boolean(normalizedPurpose && normalizedPurpose !== "main_agent");
}


function resolveContextMessageBlocksSource(ctx = {}, { includePayloadBlocks = false } = {}) {
  if (ctx?.messageBlocks && typeof ctx.messageBlocks === "object" && !Array.isArray(ctx.messageBlocks)) {
    return "ctx.messageBlocks";
  }
  if (!includePayloadBlocks) return "none";
  const agentPayloadMessages = ctx?.agentContext?.payload?.messages;
  if (agentPayloadMessages && typeof agentPayloadMessages === "object" && !Array.isArray(agentPayloadMessages)) {
    return "agentContext.payload.messages";
  }
  const runtimePayloadMessages = ctx?.runtimeAgentContext?.payload?.messages;
  if (runtimePayloadMessages && typeof runtimePayloadMessages === "object" && !Array.isArray(runtimePayloadMessages)) {
    return "runtimeAgentContext.payload.messages";
  }
  return "none";
}

function resolveContextMessageBlocks(ctx = {}, { includePayloadBlocks = false } = {}) {
  if (ctx?.messageBlocks && typeof ctx.messageBlocks === "object" && !Array.isArray(ctx.messageBlocks)) {
    return ctx.messageBlocks;
  }
  if (!includePayloadBlocks) return null;
  const agentPayloadMessages = ctx?.agentContext?.payload?.messages;
  if (agentPayloadMessages && typeof agentPayloadMessages === "object" && !Array.isArray(agentPayloadMessages)) {
    return agentPayloadMessages;
  }
  const runtimePayloadMessages = ctx?.runtimeAgentContext?.payload?.messages;
  if (runtimePayloadMessages && typeof runtimePayloadMessages === "object" && !Array.isArray(runtimePayloadMessages)) {
    return runtimePayloadMessages;
  }
  return null;
}

function resolveBlockMessages(ctx = {}, blocks = null, blockName = "") {
  void ctx;
  if (Array.isArray(blocks?.[blockName])) return blocks[blockName];
  return [];
}

function normalizeMessagesForModelRuntime(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((item) => normalizeMessageForModelRuntime(item))
    .filter(Boolean);
}

function resolveRuntimeDialogProcessId(ctx = {}) {
  return String(
    ctx?.dialogProcessId ||
      ctx?.agentContext?.execution?.dialogProcessId ||
      ctx?.runtimeAgentContext?.execution?.dialogProcessId ||
      "",
  ).trim();
}

export class ModelMessageRuntimeHelpers {
  constructor({ session = null } = {}) {
    this.session = session;
  }

  mergePluginOptions(...items) {
    return items.reduce((acc, item) => {
      if (!item || typeof item !== "object") return acc;
      const next = { ...acc };
      for (const [key, value] of Object.entries(item)) {
        if (
          PLUGIN_DEEP_MERGE_KEYS.has(key) &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          next[key] = {
            ...(next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
              ? next[key]
              : {}),
            ...value,
          };
          continue;
        }
        next[key] = value;
      }
      return next;
    }, {});
  }

  createResolveModelMessages({
    agentPluginOptions = {},
    botPluginOptions = {},
  } = {}) {
    void agentPluginOptions;
    void botPluginOptions;
    return ({ messages = [], ctx = {}, purpose = "" } = {}) => {
      const includePayloadBlocks = shouldUsePayloadMessageBlocks(purpose);
      const blockSource = resolveContextMessageBlocksSource(ctx, { includePayloadBlocks });
      const blocks = resolveContextMessageBlocks(ctx, { includePayloadBlocks });
      const explicitMessages = Array.isArray(messages) ? messages : [];
      const source = explicitMessages;
      const normalizedSource = source
        .map((item) => normalizeMessageForModelRuntime(item))
        .filter(Boolean);
      if (blocks) {
        const resolved = resolveMainModelFinalMessages({
          systemMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(ctx, blocks, "system")),
          historyMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(ctx, blocks, "history")),
          incrementalMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(ctx, blocks, "incremental")),
        });
        emitModelContextTrace(getRuntimeFromAgentContext(ctx?.agentContext || ctx?.runtimeAgentContext || {}), "resolve_model_messages", {
          purpose: String(purpose || "").trim(),
          includePayloadBlocks,
          blockSource,
          blocks: summarizeDiagnosticBlocks(blocks),
          resolvedMessages: summarizeDiagnosticMessages(resolved.messages),
        });
        return resolved.messages;
      }
      const dialogProcessId = resolveRuntimeDialogProcessId(ctx);
      const fallbackSource = dialogProcessId
        ? filterInjectedMessagesForDialog(normalizedSource, dialogProcessId)
        : normalizedSource;
      const resolvedMessages = filterForModelContext(fallbackSource, {
        keepLatestInjectedOnly: true,
      });
      emitModelContextTrace(getRuntimeFromAgentContext(ctx?.agentContext || ctx?.runtimeAgentContext || {}), "resolve_model_messages", {
        purpose: String(purpose || "").trim(),
        includePayloadBlocks,
        blockSource,
        fallback: true,
        sourceMessages: summarizeDiagnosticMessages(normalizedSource),
        resolvedMessages: summarizeDiagnosticMessages(resolvedMessages),
      });
      return resolvedMessages;
    };
  }

  createMarkMessagesSummarized() {
    const shouldMark = (messageItem = {}, taskSummaryToolName = "task_summary") =>
      shouldMarkCurrentTurnSummarizedMessage(messageItem, { taskSummaryToolName });
    const isSummarized = (messageItem = {}) =>
      messageItem?.summarized === true || messageItem?.lc_kwargs?.summarized === true;
    const markMessage = (messageItem = null) => {
      if (!messageItem || typeof messageItem !== "object") return false;
      if (isSummarized(messageItem)) return false;
      messageItem.summarized = true;
      if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
        messageItem.lc_kwargs.summarized = true;
      }
      return true;
    };
    return async ({
      messages = [],
      ctx = {},
      taskSummaryToolName = "task_summary",
      summaryScope = null,
    } = {}) => {
      const source = Array.isArray(messages) ? messages : [];
      const normalizedTaskSummaryToolName =
        String(taskSummaryToolName || "").trim() || "task_summary";
      const normalizedScope =
        summaryScope && typeof summaryScope === "object" ? summaryScope : {};
      const maxMessagesRaw = Number(normalizedScope?.maxMessages);
      const hasScopedSourceLimit =
        Number.isFinite(maxMessagesRaw) && maxMessagesRaw >= 0;
      const scopedSourceLimit = hasScopedSourceLimit
        ? Math.min(source.length, Math.floor(maxMessagesRaw))
        : source.length;
      const limitToProvidedMessagesOnly =
        hasScopedSourceLimit &&
        (normalizedScope?.limitToProvidedMessagesOnly === true ||
          normalizedScope?.applyToStores === false ||
          normalizedScope?.applyToSession === false);
      const latestSourceInjectedIndexes = collectLatestInjectedMessageIndexes(source);
      const latestSourceTaskSummaryIndexes = collectLatestTaskSummaryMessageIndexes(source, {
        taskSummaryToolName: normalizedTaskSummaryToolName,
      });
      let changedCount = 0;
      for (let index = 0; index < scopedSourceLimit; index += 1) {
        const messageItem = source[index];
        if (!shouldMarkCurrentTurnSummarizedMessageInScope(messageItem, {
          messages: source,
          index,
          latestInjectedIndexes: latestSourceInjectedIndexes,
          latestTaskSummaryIndexes: latestSourceTaskSummaryIndexes,
          taskSummaryToolName: normalizedTaskSummaryToolName,
        })) continue;
        if (markMessage(messageItem)) changedCount += 1;
      }
      const runtime = getRuntimeFromAgentContext(ctx?.agentContext || {});
      const currentTurnMessages = runtime?.currentTurnMessages;
      if (
        !limitToProvidedMessagesOnly &&
        currentTurnMessages &&
        typeof currentTurnMessages.updateWhere === "function"
      ) {
        const currentTurnScope =
          typeof currentTurnMessages.toArray === "function" ? currentTurnMessages.toArray() : [];
        const latestCurrentTurnInjectedIndexes = collectLatestInjectedMessageIndexes(currentTurnScope);
        const latestCurrentTurnTaskSummaryIndexes = collectLatestTaskSummaryMessageIndexes(
          currentTurnScope,
          { taskSummaryToolName: normalizedTaskSummaryToolName },
        );
        changedCount += currentTurnMessages.updateWhere(
          { summarized: true },
          (messageItem, index) =>
            !isSummarized(messageItem) &&
            shouldMarkCurrentTurnSummarizedMessageInScope(messageItem, {
              messages: currentTurnScope,
              index,
              latestInjectedIndexes: latestCurrentTurnInjectedIndexes,
              latestTaskSummaryIndexes: latestCurrentTurnTaskSummaryIndexes,
              taskSummaryToolName: normalizedTaskSummaryToolName,
            }),
        );
      }
      const sessionIds = getSessionIdsFromAgentContext(ctx?.agentContext || {}, runtime);
      const userId = String(ctx?.userId || sessionIds.userId || "").trim();
      const sessionId = String(ctx?.sessionId || sessionIds.sessionId || "").trim();
      if (
        !limitToProvidedMessagesOnly &&
        userId &&
        sessionId &&
        this.session?.markSessionMessagesSummarized
      ) {
        const resolvedParentSessionId = resolveParentSessionId({
          context: ctx,
          parentSessionId: sessionIds.parentSessionId,
        });
        try {
          changedCount += await this.session.markSessionMessagesSummarized({
            userId,
            sessionId,
            parentSessionId: resolvedParentSessionId,
            shouldMark: (messageItem) => shouldMark(messageItem, normalizedTaskSummaryToolName),
          });
        } catch {
          // In-memory marking above is enough for the active turn; persistence
          // failures should not break the model loop.
        }
      }
      return changedCount;
    };
  }
}
