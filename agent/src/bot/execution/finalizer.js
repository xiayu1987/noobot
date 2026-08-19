/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import { CALLER_ROLE, SESSION_ASYNC_STATUS } from "../config/constants.js";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { summarizeExecutionLogs } from "../../observability/execution-log/execution-log-summary.js";
import {
  canonicalMessageId,
  emitContextIdentityDebug,
} from "../../observability/context-identity-debug.js";
import { projectGeneratedArtifactsToFinalAssistant } from "../../runtime/turn/final-assistant-artifact-projection.js";

function summarizedMessageIds(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message = {}) => message?.summarized === true)
    .map((message = {}) => canonicalMessageId(message))
    .filter(Boolean);
}

export class SessionExecutionFinalizer {
  constructor({
    session = null,
    turnPersister = null,
    resolveMemoryPostProcessAsyncEnabled = () => true,
    runMemoryPostProcessFlow = async () => {},
    resolveExecutionBundleTimeoutMs = () => 5000,
    upsertParentAsyncTask = () => {},
    now = () => new Date().toISOString(),
  } = {}) {
    this.session = session;
    this.turnPersister = turnPersister;
    this.resolveMemoryPostProcessAsyncEnabled = resolveMemoryPostProcessAsyncEnabled;
    this.runMemoryPostProcessFlow = runMemoryPostProcessFlow;
    this.resolveExecutionBundleTimeoutMs = resolveExecutionBundleTimeoutMs;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.now = now;
  }

  async finalizeRunSession({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    caller = CALLER_ROLE.USER,
    dialogProcessId = "",
    turnScopeId = "",
    thinkingStartedAt = "",
    agentResult = {},
    alreadyPersistedTurnMessageCount = 0,
    persistedTurnMessageUids = [],
    persistedTurnMessages = null,
    durableTurnMessages = null,
    summaryCheckpointPromotionSources = [],
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
    lifecycle = null,
    persistenceContext = null,
  }) {
    const activeTurnMessages =
      Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
        ? agentResult.turnMessages
        : [
            this.turnPersister.buildDefaultAssistantTurn({
              agentResult,
              dialogProcessId,
            }),
          ];
    const persistedActivePrefixCount = Math.min(
      activeTurnMessages.length,
      Math.max(0, Number(alreadyPersistedTurnMessageCount) || 0),
    );
    const hasRecoveredPersistedPrefix = Array.isArray(persistedTurnMessages);
    const durableMessages = Array.isArray(durableTurnMessages)
      ? durableTurnMessages
      : Array.isArray(persistedTurnMessages)
        ? persistedTurnMessages
        : [];
    const durableMessageUids = new Set(
      durableMessages
        .map((message = {}) => String(message.messageUid || "").trim())
        .filter(Boolean),
    );
    const persistedUidSet = new Set(
      [
        ...(Array.isArray(persistedTurnMessageUids) ? persistedTurnMessageUids : []),
        ...durableMessageUids,
      ]
        .map((uid) => String(uid || "").trim())
        .filter(Boolean),
    );
    const activeMessageUids = new Set(
      activeTurnMessages
        .map((message = {}) => String(message.messageUid || "").trim())
        .filter(Boolean),
    );
    const rawTurnMessages = hasRecoveredPersistedPrefix
      ? persistedUidSet.size > 0
        ? [
            ...persistedTurnMessages.filter((message = {}) => {
              const messageUid = String(message.messageUid || "").trim();
              return !messageUid || !activeMessageUids.has(messageUid);
            }),
            ...activeTurnMessages,
          ]
        : [...persistedTurnMessages, ...activeTurnMessages.slice(persistedActivePrefixCount)]
      : activeTurnMessages;
    const promotionSourceCount = Array.isArray(summaryCheckpointPromotionSources)
      ? summaryCheckpointPromotionSources.length
      : 0;
    const promotedMessages = projectGeneratedArtifactsToFinalAssistant([
      ...(Array.isArray(summaryCheckpointPromotionSources)
        ? summaryCheckpointPromotionSources
        : []),
      ...rawTurnMessages,
    ]);
    const turnMessages = promotedMessages.slice(promotionSourceCount);
    const persistedResultPrefixCount = hasRecoveredPersistedPrefix
      ? persistedTurnMessages.length
      : persistedActivePrefixCount;
    const promotedTurnMessages = promotedMessages.slice(promotionSourceCount);
    const persistedMessagesByUid = new Map(
      (Array.isArray(durableMessages) ? durableMessages : [])
        .map((message = {}) => [String(message.messageUid || "").trim(), message])
        .filter(([messageUid]) => messageUid),
    );
    for (const messageUid of persistedUidSet) {
      if (!persistedMessagesByUid.has(messageUid)) {
        throw new Error(
          `persisted turn message is missing from the durable journal: ${messageUid}`,
        );
      }
    }
    const messagesToPersist =
      persistedUidSet.size > 0
        ? promotedTurnMessages.filter((message = {}) => {
            const messageUid = String(message.messageUid || "").trim();
            if (!messageUid || !persistedUidSet.has(messageUid)) return true;
            const persistedMessage = persistedMessagesByUid.get(messageUid);
            return JSON.stringify(persistedMessage) !== JSON.stringify(message);
          })
        : promotedMessages.slice(promotionSourceCount + persistedResultPrefixCount);
    emitContextIdentityDebug(
      runtimeEventListener,
      "completedTurnSummaryPersistencePlanned",
      {
        userId,
        sessionId,
        parentSessionId,
        dialogProcessId,
        turnScopeId,
      },
      {
        activeMessageCount: activeTurnMessages.length,
        durableMessageCount: persistedMessagesByUid.size,
        persistedUidCount: persistedUidSet.size,
        messageToPersistCount: messagesToPersist.length,
        activeSummarizedMessageIds: summarizedMessageIds(activeTurnMessages),
        durableSummarizedMessageIds: summarizedMessageIds(durableMessages),
        persistedSummarizedMessageIds: summarizedMessageIds(messagesToPersist),
      },
    );
    const thinkingFinishedAt = this.now();

    lifecycle?.enterPersisting?.();
    await this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages: messagesToPersist,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId: String(turnScopeId || "").trim(),
      thinkingStartedAt,
      thinkingFinishedAt,
      eventListener: runtimeEventListener,
      persistenceContext,
    });
    await this.session.upsertTurnTiming?.({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId,
      dialogProcessId,
      thinkingFinishedAt,
      persistenceContext,
    });
    await this.session.saveCurrentTurnTasks({
      userId,
      sessionId,
      parentSessionId,
      currentTurnTasks: agentResult?.turnTasks || [],
      persistenceContext,
    });

    lifecycle?.enterMemory?.();
    const memoryPostProcessAsyncEnabled = this.resolveMemoryPostProcessAsyncEnabled(userConfig);
    if (memoryPostProcessAsyncEnabled) {
      emitEvent(runtimeEventListener, "memory_postprocess_scheduled", {
        sessionId,
        mode: "async",
      });
      void runBestEffort(
        () =>
          this.runMemoryPostProcessFlow({
            userId,
            sessionId,
            parentSessionId,
            userConfig,
            runtimeEventListener,
            mode: "async",
            persistenceContext,
          }),
        { operationName: "executionFinalizer.runAsyncMemoryPostProcess", context: { sessionId } },
      );
    } else {
      await this.runMemoryPostProcessFlow({
        userId,
        sessionId,
        parentSessionId,
        userConfig,
        runtimeEventListener,
        mode: "sync",
        persistenceContext,
      });
    }

    lifecycle?.complete?.();
    await runtimeEventListener?.flushDelivery?.();
    await runtimeEventListener?.flushPersistence?.();

    const executionBundleTimeoutMs = this.resolveExecutionBundleTimeoutMs(userConfig);
    let executionLogs = [];
    try {
      const execution = await Promise.race([
        this.session.getExecutionBundle({
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`execution bundle timeout after ${executionBundleTimeoutMs}ms`)),
            executionBundleTimeoutMs,
          ),
        ),
      ]);
      executionLogs = (execution?.logs || []).slice(executionStartIndex);
    } catch (error) {
      emitEvent(runtimeEventListener, "execution_bundle_unavailable", {
        sessionId,
        timeoutMs: executionBundleTimeoutMs,
        error: error?.message || String(error),
      });
      executionLogs = [];
    }
    const executionSummary = summarizeExecutionLogs(executionLogs, { dialogProcessId });
    const completionResult = {
      sessionId,
      parentSessionId: normalizeParentSessionId(parentSessionId),
      parentDialogProcessId: parentDialogProcessId || "",
      caller: String(caller || CALLER_ROLE.USER),
      answer: agentResult.output,
      traces: agentResult.traces,
      messages: turnMessages,
      turnTasks: agentResult?.turnTasks || [],
      executionLogs,
      executionSummary,
      dialogProcessId,
      turnScopeId: String(turnScopeId || "").trim(),
    };
    this.upsertParentAsyncTask({
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      sessionId,
      parentSessionId,
      patch: {
        status: SESSION_ASYNC_STATUS.COMPLETED,
        endedAt: this.now(),
        error: "",
        result: completionResult,
      },
    });

    return {
      ...completionResult,
      lifecycle: lifecycle?.snapshot || null,
      ...(resolvedParentAsyncResultContainer
        ? { parentAsyncResultContainer: resolvedParentAsyncResultContainer }
        : {}),
    };
  }
}
