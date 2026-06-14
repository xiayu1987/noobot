/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveMainModelFinalMessages,
  resolveMainModelHistoryMessages,
  resolveMainModelIncrementalMessages,
  resolveMainModelSystemMessages,
} from "../../session/utils/context-window-normalizer.js";
import {
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedModelMessage,
} from "../../context/session/summarized-message-policy.js";
import {
  collectLatestInjectedMessageIndexes,
  isInjectedMessage,
  resolveMessageRole,
} from "../../context/session/message-context-policy.js";
import { resolveDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  normalizeMessageForModelRuntime,
  resolveMessageBlockDialogProcessId,
} from "./session-execution-engine-utils.js";

const PLUGIN_DEEP_MERGE_KEYS = new Set([
  "stepModels",
  "capabilityModelByPurpose",
  "capabilityToolAllowlistByPurpose",
  "acceptance",
  "review",
]);

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
    void (agentPluginOptions || botPluginOptions);
    return ({ messages = [], ctx = {} } = {}) => {
      const blocks = ctx?.messageBlocks && typeof ctx.messageBlocks === "object"
        ? ctx.messageBlocks
        : null;
      const explicitMessages = Array.isArray(messages) ? messages : [];
      const source = explicitMessages.length
        ? explicitMessages
        : Array.isArray(ctx?.messages)
          ? ctx.messages
          : [];
      const currentDialogProcessId = resolveDialogProcessId({
        ctx,
        messages: source,
      });
      const normalizedSource = source
        .map((item) => normalizeMessageForModelRuntime(item))
        .filter(Boolean);
      if (blocks) {
        const resolved = resolveMainModelFinalMessages({
          systemMessages: (Array.isArray(blocks.system) ? blocks.system : [])
            .map((item) => normalizeMessageForModelRuntime(item))
            .filter(Boolean),
          historyMessages: (Array.isArray(blocks.history) ? blocks.history : [])
            .map((item) => normalizeMessageForModelRuntime(item))
            .filter(Boolean),
          incrementalMessages: (Array.isArray(blocks.incremental) ? blocks.incremental : [])
            .map((item) => normalizeMessageForModelRuntime(item))
            .filter(Boolean),
          currentDialogProcessId,
        });
        return resolved.messages;
      }
      const system = resolveMainModelSystemMessages({
        sourceMessages: normalizedSource.filter((item) => resolveMessageRole(item) === "system"),
        currentDialogProcessId,
      });
      const conversation = resolveMainModelIncrementalMessages({
        sourceMessages: normalizedSource.filter((item) => resolveMessageRole(item) !== "system"),
        currentDialogProcessId,
      });
      return [...system, ...conversation];
    };
  }

  createResolveMessageBlock({
    agentPluginOptions = {},
  } = {}) {
    void agentPluginOptions;
    return ({ scope = "history", messages = [], ctx = {} } = {}) => {
      const source = Array.isArray(messages) ? messages : [];
      const normalizedScope = String(scope || "history").trim().toLowerCase();
      const currentDialogProcessId = resolveMessageBlockDialogProcessId({
        scope: normalizedScope,
        ctx,
        messages: source,
      });
      if (normalizedScope === "system") {
        return resolveMainModelSystemMessages({
          sourceMessages: source,
          currentDialogProcessId,
        });
      }
      if (normalizedScope === "incremental") {
        return resolveMainModelIncrementalMessages({
          sourceMessages: source,
          currentDialogProcessId,
        });
      }
      if (normalizedScope === "conversation" || normalizedScope === "non_system") {
        return resolveMainModelIncrementalMessages({
          sourceMessages: source,
          currentDialogProcessId,
        });
      }
      return resolveMainModelHistoryMessages({
        sourceMessages: source,
      });
    };
  }

  createMarkMessagesSummarized() {
    const shouldMark = (messageItem = {}, taskSummaryToolName = "task_summary") =>
      shouldMarkCurrentTurnSummarizedMessage(messageItem, { taskSummaryToolName }) ||
      shouldMarkCurrentTurnSummarizedModelMessage(messageItem, { taskSummaryToolName });
    const shouldPreserveInjectedAtIndex = (messages = [], index = -1, latestInjectedIndexes = null) => {
      if (!Array.isArray(messages) || index < 0) return false;
      if (!isInjectedMessage(messages[index])) return false;
      const latestIndexes = latestInjectedIndexes instanceof Set
        ? latestInjectedIndexes
        : collectLatestInjectedMessageIndexes(messages);
      return latestIndexes.has(index);
    };
    const shouldMarkInScope = (messageItem = {}, {
      messages = [],
      index = -1,
      latestInjectedIndexes = null,
      taskSummaryToolName = "task_summary",
    } = {}) => {
      if (shouldPreserveInjectedAtIndex(messages, index, latestInjectedIndexes)) return false;
      if (isInjectedMessage(messageItem)) return true;
      return shouldMark(messageItem, taskSummaryToolName);
    };
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
      let changedCount = 0;
      for (let index = 0; index < scopedSourceLimit; index += 1) {
        const messageItem = source[index];
        if (!shouldMarkInScope(messageItem, {
          messages: source,
          index,
          latestInjectedIndexes: latestSourceInjectedIndexes,
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
        changedCount += currentTurnMessages.updateWhere(
          { summarized: true },
          (messageItem, index) =>
            !isSummarized(messageItem) &&
            shouldMarkInScope(messageItem, {
              messages: currentTurnScope,
              index,
              latestInjectedIndexes: latestCurrentTurnInjectedIndexes,
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
