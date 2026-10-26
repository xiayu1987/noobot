/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import {
  isSummarizedSessionMessageRecord,
  requireDialogProcessKey,
} from "@noobot/session-protocol";
import { summarizeExecutionLogs } from "../../observability/execution-log/execution-log-summary.js";
import {
  buildExecutionReport,
  EXECUTION_REPORT_STATUS,
} from "@noobot/session-protocol/execution-report";
import { emitContextIdentityDebug } from "../../observability/context-identity-debug.js";
import { projectGeneratedArtifactsToFinalAssistant } from "../../runtime/turn/final-assistant-artifact-projection.js";
import { text } from "@noobot/shared/value";

function summarizedMessageUids(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message = {}) => isSummarizedSessionMessageRecord(message))
    .map((message = {}) => text(message.messageUid))
    .filter(Boolean);
}

export class SessionExecutionFinalizer {
  constructor({ session, turnPersister, memoryPostProcessService, now }) {
    this.session = session;
    this.turnPersister = turnPersister;
    this.memoryPostProcessService = memoryPostProcessService;
    this.now = now;
  }

  async finalizeRunSession({
    userId,
    sessionId,
    parentSessionId,
    parentDialogProcessId = "",
    caller,
    dialogProcessId,
    turnScopeId = "",
    thinkingStartedAt = "",
    agentResult = {},
    persistedTurnMessageUids,
    persistedTurnMessages,
    durableTurnMessages,
    summaryCheckpointPromotionSources,
    runtimeEventListener = null,
    userConfig = {},
    lifecycle = null,
    persistenceScope,
  }) {
    requireDialogProcessKey(dialogProcessId);
    const activeTurnMessages = agentResult.turnMessages;
    if (!Array.isArray(activeTurnMessages) || activeTurnMessages.length === 0) {
      throw new Error("finalizeRunSession requires accepted canonical turn messages");
    }
    const persistedUidSet = new Set(persistedTurnMessageUids);
    const persistedMessagesByUid = new Map(
      durableTurnMessages.map((message) => [text(message.messageUid), message]),
    );
    for (const messageUid of persistedUidSet) {
      if (!persistedMessagesByUid.has(messageUid)) {
        throw new Error(
          `persisted turn message is missing from the durable journal: ${messageUid}`,
        );
      }
    }
    const activeMessageUids = new Set(
      activeTurnMessages.map((message) => text(message.messageUid)),
    );
    const rawTurnMessages = [
      ...persistedTurnMessages.filter(
        (message) => !activeMessageUids.has(text(message.messageUid)),
      ),
      ...activeTurnMessages,
    ];
    const promotionSourceCount = summaryCheckpointPromotionSources.length;
    const turnMessages = projectGeneratedArtifactsToFinalAssistant([
      ...summaryCheckpointPromotionSources,
      ...rawTurnMessages,
    ]).slice(promotionSourceCount);
    const messagesToPersist = turnMessages.filter((message) => {
      const messageUid = text(message.messageUid);
      if (!persistedUidSet.has(messageUid)) return true;
      return JSON.stringify(persistedMessagesByUid.get(messageUid)) !== JSON.stringify(message);
    });
    emitContextIdentityDebug(runtimeEventListener, "completedTurnSummaryPersistencePlanned", {
      activeMessageCount: activeTurnMessages.length,
      durableMessageCount: persistedMessagesByUid.size,
      persistedUidCount: persistedUidSet.size,
      messageToPersistCount: messagesToPersist.length,
      activeSummarizedMessageUids: summarizedMessageUids(activeTurnMessages),
      durableSummarizedMessageUids: summarizedMessageUids(durableTurnMessages),
      persistedSummarizedMessageUids: summarizedMessageUids(messagesToPersist),
    });
    const thinkingFinishedAt = this.now();
    lifecycle?.enterPersisting?.();
    await this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      messages: messagesToPersist,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId: text(turnScopeId),
      eventListener: runtimeEventListener,
      persistenceScope,
    });
    await this.session.upsertTurnTiming({
      userId,
      sessionId,
      turnScopeId,
      dialogProcessId,
      thinkingFinishedAt,
      modelLoopRound: agentResult?.modelLoopRound,
      persistenceScope,
    });
    await this.session.saveCurrentTurnTasks({
      userId,
      sessionId,
      currentTurnTasks: agentResult?.turnTasks || [],
      persistenceScope,
    });

    lifecycle?.enterMemory?.();
    const memoryPostProcessAsyncEnabled =
      this.memoryPostProcessService.resolveMemoryPostProcessAsyncEnabled(userConfig);
    const memoryPostProcessInput = {
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
      persistenceScope,
      userConfig,
    };
    if (memoryPostProcessAsyncEnabled) {
      emitEvent(runtimeEventListener, "memory_postprocess_scheduled", {
        sessionId,
        mode: "async",
      });
      void runBestEffort(
        () =>
          this.memoryPostProcessService.runMemoryPostProcessFlow({
            ...memoryPostProcessInput,
            mode: "async",
          }),
        { operationName: "executionFinalizer.runAsyncMemoryPostProcess", context: { sessionId } },
      );
    } else {
      await this.memoryPostProcessService.runMemoryPostProcessFlow({
        ...memoryPostProcessInput,
        mode: "sync",
      });
    }

    await runtimeEventListener?.flush();

    const executionLogs = await this.session.getExecutionTurnLogs({
      userId,
      sessionId,
      dialogProcessId,
      persistenceScope,
    });
    const executionSummary = summarizeExecutionLogs(executionLogs);
    await this.saveCompletedReport({
      userId,
      sessionId,
      parentSessionId,
      persistenceScope,
      dialogProcessId,
      turnScopeId,
      caller,
      startedAt: thinkingStartedAt,
      executionSummary,
    });
    return {
      sessionId,
      parentSessionId,
      parentDialogProcessId: parentDialogProcessId || "",
      caller,
      answer: agentResult.output,
      traces: agentResult.traces,
      messages: turnMessages,
      turnTasks: agentResult?.turnTasks || [],
      dialogProcessId,
      turnScopeId: text(turnScopeId),
    };
  }

  async saveCompletedReport({ userId, persistenceScope, ...reportFields }) {
    const report = buildExecutionReport({
      ...reportFields,
      status: EXECUTION_REPORT_STATUS.COMPLETED,
      finishedAt: this.now(),
    });
    await this.session.saveExecutionReport({
      userId,
      sessionId: reportFields.sessionId,
      persistenceScope,
      report,
    });
  }
}
