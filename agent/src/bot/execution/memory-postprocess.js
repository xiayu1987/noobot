/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createExecutionEventListener, emitEvent } from "../../events/index.js";
import { createMemoryPostprocessIdentity } from "@noobot/session-protocol/turn-scope-identity";
import { runBestEffort } from "@noobot/shared/best-effort";
import { resolveTimeMs } from "../../config/index.js";
import { BOT_MANAGE_LOG_EVENT, BOT_MANAGE_LOG_SOURCE } from "../config/constants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isAbortError } from "../../shared/utils/error-utils.js";
import { isFunction } from "@noobot/shared/value";
import { PendingOperations } from "../../shared/pending-operations.js";

async function flushMemoryFailure(listener, error) {
  try {
    await listener.flush();
  } catch (flushError) {
    throw new AggregateError([error, flushError], "memory operation and log persistence failed", {
      cause: error,
    });
  }
  throw error;
}

async function handleSummaryFailure(error, timedOut, recordFailure) {
  if (isAbortError(error) && timedOut) return;
  await recordFailure("", error);
  throw error;
}

export class MemoryPostProcessService {
  constructor({ globalConfig, session, memory, errorLogger, workspaceAdmission, now }) {
    if (!isFunction(workspaceAdmission?.run)) {
      throw new TypeError("MemoryPostProcessService requires workspace admission");
    }
    if (!isFunction(now)) {
      throw new TypeError("MemoryPostProcessService requires now function");
    }
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.errorLogger = errorLogger;
    this.workspaceAdmission = workspaceAdmission;
    this.now = now;
    this.operations = new PendingOperations();
  }

  resolveMemorySummaryTimeoutMs(userConfig = {}) {
    const userMemoryTimeout = resolveTimeMs(userConfig?.memory, {
      key: "summarizeTimeoutMs",
      fallback: 0,
      min: 1,
    });
    if (userMemoryTimeout > 0) return userMemoryTimeout;
    return resolveTimeMs(this.globalConfig?.memory, {
      key: "summarizeTimeoutMs",
      fallback: TIME_THRESHOLDS.memory.summaryTimeoutMs,
      min: 1,
    });
  }

  resolveMemoryPostProcessAsyncEnabled(userConfig = {}) {
    const configured =
      userConfig?.memory?.postprocess_async ?? this.globalConfig?.memory?.postprocess_async;
    if (configured === undefined || configured === null) return true;
    return configured !== false;
  }

  async recordMemorySummaryFailure({
    userId,
    sessionId,
    mode,
    stage,
    error,
    runtimeEventListener,
  }) {
    emitEvent(runtimeEventListener, BOT_MANAGE_LOG_EVENT.MEMORY_SUMMARY_FAILED, {
      sessionId,
      mode,
      stage,
      error: error?.message || String(error),
    });
    if (this.errorLogger?.log) {
      await this.errorLogger.log({
        userId,
        sessionId,
        source: BOT_MANAGE_LOG_SOURCE.MEMORY_SUMMARIZE,
        event: BOT_MANAGE_LOG_EVENT.MEMORY_SUMMARY_FAILED,
        error,
        extra: { stage },
      });
    }
  }

  createMemoryEventListener({ userId, sessionId, parentSessionId, identity, persistenceScope }) {
    return createExecutionEventListener({
      sessionManager: this.session,
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: identity.turnScopeId,
      persistenceScope,
      now: this.now,
    });
  }

  runMemorySummarizeFlow(payload) {
    return this.runInWorkspace(payload.userId, () => this.summarize(payload));
  }

  async drain() {
    await this.operations.drain();
    await this.operations.close();
  }

  async summarize({
    userId,
    sessionId,
    parentSessionId,
    userConfig = {},
    identity,
    memoryEventListener,
    mode,
  }) {
    const memorySummaryTimeoutMs = this.resolveMemorySummaryTimeoutMs(userConfig);
    let memorySummaryTimedOut = false;
    const memorySummaryAbortController = new AbortController();
    const memorySummaryTimer = setTimeout(() => {
      memorySummaryTimedOut = true;
      memorySummaryAbortController.abort();
    }, memorySummaryTimeoutMs);
    const recordFailure = (stage, error) =>
      this.recordMemorySummaryFailure({
        userId,
        sessionId,
        mode,
        stage,
        error,
        runtimeEventListener: memoryEventListener,
      });
    try {
      try {
        await this.memory.maybeSummarize({
          userId,
          sessionId,
          parentSessionId,
          userConfig,
          abortSignal: memorySummaryAbortController.signal,
          invocationIdentity: identity,
          eventListener: memoryEventListener,
          onStageError: ({ stage, error }) => recordFailure(stage, error),
        });
      } catch (error) {
        await handleSummaryFailure(error, memorySummaryTimedOut, recordFailure);
      } finally {
        clearTimeout(memorySummaryTimer);
      }
      if (memorySummaryTimedOut) {
        emitEvent(memoryEventListener, "memory_summary_timeout", {
          sessionId,
          mode,
          timeoutMs: memorySummaryTimeoutMs,
        });
      }
      emitEvent(memoryEventListener, "memory_summary_checked", { sessionId, mode });
    } catch (error) {
      await flushMemoryFailure(memoryEventListener, error);
    }
    await memoryEventListener.flush();
  }

  scheduleMemorySummarizeFlow(payload) {
    void runBestEffort(() => this.runMemorySummarizeFlow(payload), {
      operationName: "memoryPostprocess.runScheduledSummary",
      context: { sessionId: payload.sessionId },
    });
  }

  runMemoryPostProcessFlow(payload) {
    return this.runInWorkspace(payload.userId, () => this.capture(payload));
  }

  runInWorkspace(userId, operation) {
    return this.operations.run(() => this.workspaceAdmission.run(userId, operation));
  }

  async capture({
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    persistenceScope,
    userConfig,
    mode,
  }) {
    const identity = createMemoryPostprocessIdentity({
      sessionId,
      sourceDialogProcessId: dialogProcessId,
    });
    const memoryEventListener = this.createMemoryEventListener({
      userId,
      sessionId,
      parentSessionId,
      identity,
      persistenceScope,
    });
    try {
      await this.session.withSessionDialogMessageRecords(
        { userId, sessionId, dialogProcessId, persistenceScope },
        (messageRecords) =>
          this.memory.captureDialogToShortMemory({
            userId,
            sessionId,
            parentSessionId,
            dialogProcessId,
            messageRecords,
          }),
      );
      emitEvent(memoryEventListener, "short_memory_captured", { sessionId, mode });
      emitEvent(memoryEventListener, "memory_summary_scheduled", { sessionId, mode: "async" });
    } catch (error) {
      emitEvent(memoryEventListener, "memory_postprocess_failed", {
        sessionId,
        mode,
        error: error?.message || String(error),
      });
      if (this.errorLogger?.log) {
        await this.errorLogger.log({
          userId,
          sessionId,
          parentSessionId,
          source: BOT_MANAGE_LOG_SOURCE.MEMORY_POSTPROCESS,
          event: BOT_MANAGE_LOG_EVENT.MEMORY_POSTPROCESS_FAILED,
          error,
        });
      }
      await flushMemoryFailure(memoryEventListener, error);
    }
    await memoryEventListener.flush();
    this.scheduleMemorySummarizeFlow({
      userId,
      sessionId,
      parentSessionId,
      userConfig,
      identity,
      memoryEventListener,
      mode: "async",
    });
  }
}
