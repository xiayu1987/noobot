/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import {
  CALLER_ROLE,
  SESSION_ASYNC_STATUS,
} from "../config/constants.js";
import { mergeAttachmentMetas } from "../../attach/meta-ops.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([
  "doc_to_data_tool",
  "media_to_data_tool",
  "tool_result_overflow",
]);

function shouldPromoteAttachmentToAssistant(attachmentItem = {}) {
  if (!attachmentItem || typeof attachmentItem !== "object" || Array.isArray(attachmentItem)) {
    return false;
  }
  const generationSource = String(attachmentItem?.generationSource || "").trim();
  if (HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource)) return false;
  const attachmentSource = String(attachmentItem?.attachmentSource || "").trim();
  return (
    attachmentItem?.generatedByModel === true ||
    attachmentSource === "model" ||
    attachmentSource === "model_generated" ||
    Boolean(generationSource)
  );
}

function promoteGeneratedAttachmentsToFinalAssistant(messages = []) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  if (!sourceMessages.length) return sourceMessages;
  const generatedAttachmentMetas = sourceMessages.flatMap((messageItem = {}) =>
    (Array.isArray(messageItem?.attachmentMetas) ? messageItem.attachmentMetas : [])
      .filter(shouldPromoteAttachmentToAssistant),
  );
  if (!generatedAttachmentMetas.length) return sourceMessages;

  const finalAssistantIndex = (() => {
    for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
      const item = sourceMessages[index] || {};
      if (
        String(item?.role || "") === "assistant" &&
        String(item?.type || "message") !== "tool_call"
      ) {
        return index;
      }
    }
    return -1;
  })();
  if (finalAssistantIndex < 0) return sourceMessages;

  const outputMessages = [...sourceMessages];
  const finalAssistant = outputMessages[finalAssistantIndex] || {};
  outputMessages[finalAssistantIndex] = {
    ...finalAssistant,
    attachmentMetas: mergeAttachmentMetas(
      Array.isArray(finalAssistant?.attachmentMetas) ? finalAssistant.attachmentMetas : [],
      generatedAttachmentMetas,
    ),
  };
  return outputMessages;
}

/**
 * Session execution finalizer.
 */
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
    agentResult = {},
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
  }) {
    const rawTurnMessages =
      Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
        ? agentResult.turnMessages
        : [
            this.turnPersister.buildDefaultAssistantTurn({
              agentResult,
              dialogProcessId,
            }),
          ];
    const turnMessages = promoteGeneratedAttachmentsToFinalAssistant(rawTurnMessages);

    await this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages: turnMessages,
      dialogProcessId,
      parentDialogProcessId,
      eventListener: runtimeEventListener,
    });
    await this.session.saveCurrentTurnTasks({
      userId,
      sessionId,
      parentSessionId,
      currentTurnTasks: agentResult?.turnTasks || [],
    });

    const memoryPostProcessAsyncEnabled =
      this.resolveMemoryPostProcessAsyncEnabled(userConfig);
    if (memoryPostProcessAsyncEnabled) {
      emitEvent(runtimeEventListener, "memory_postprocess_scheduled", {
        sessionId,
        mode: "async",
      });
      Promise.resolve()
        .then(() =>
          this.runMemoryPostProcessFlow({
            userId,
            sessionId,
            parentSessionId,
            userConfig,
            runtimeEventListener,
            mode: "async",
          }),
        )
        .catch(() => {
          // error already handled in _runMemorySummarizeFlow or error logger
        });
    } else {
      await this.runMemoryPostProcessFlow({
        userId,
        sessionId,
        parentSessionId,
        userConfig,
        runtimeEventListener,
        mode: "sync",
      });
    }

    const executionBundleTimeoutMs = this.resolveExecutionBundleTimeoutMs(userConfig);
    let executionLogs = [];
    try {
      const execution = await Promise.race([
        this.session.getExecutionBundle({
          userId,
          sessionId,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `execution bundle timeout after ${executionBundleTimeoutMs}ms`,
                ),
              ),
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
    this.upsertParentAsyncTask({
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      sessionId,
      parentSessionId,
      patch: {
        status: SESSION_ASYNC_STATUS.COMPLETED,
        endedAt: this.now(),
        error: "",
        result: {
          sessionId,
          parentSessionId: parentSessionId || "",
          parentDialogProcessId: parentDialogProcessId || "",
          caller: String(caller || CALLER_ROLE.USER),
          answer: agentResult.output,
          traces: agentResult.traces,
          messages: turnMessages,
          turnTasks: agentResult?.turnTasks || [],
          executionLogs,
          dialogProcessId,
        },
      },
    });

    return {
      sessionId,
      parentSessionId: parentSessionId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      caller: String(caller || CALLER_ROLE.USER),
      answer: agentResult.output,
      traces: agentResult.traces,
      messages: turnMessages,
      turnTasks: agentResult?.turnTasks || [],
      executionLogs,
      dialogProcessId,
      ...(resolvedParentAsyncResultContainer
        ? { parentAsyncResultContainer: resolvedParentAsyncResultContainer }
        : {}),
    };
  }
}
