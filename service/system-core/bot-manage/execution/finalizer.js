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
    const turnMessages =
      Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
        ? agentResult.turnMessages
        : [
            this.turnPersister.buildDefaultAssistantTurn({
              agentResult,
              dialogProcessId,
            }),
          ];

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
