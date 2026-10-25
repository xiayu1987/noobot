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

const DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS = TIME_THRESHOLDS.memory.summaryTimeoutMs;

export class MemoryPostProcessService {
  constructor({ globalConfig, session, memory, errorLogger }) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.errorLogger = errorLogger;
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
      fallback: DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS,
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
    });
  }

  async runMemorySummarizeFlow({
    userId,
    sessionId,
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
          userConfig,
          abortSignal: memorySummaryAbortController.signal,
          invocationIdentity: identity,
          eventListener: memoryEventListener,
          onStageError: ({ stage, error }) => recordFailure(stage, error),
        });
      } catch (error) {
        if (!isAbortError(error) || !memorySummaryTimedOut) {
          await recordFailure("", error);
          throw error;
        }
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
    } finally {
      await memoryEventListener.flush();
    }
  }

  scheduleMemorySummarizeFlow(payload) {
    void runBestEffort(() => this.runMemorySummarizeFlow(payload), {
      operationName: "memoryPostprocess.runScheduledSummary",
      context: { sessionId: payload.sessionId },
    });
  }

  async runMemoryPostProcessFlow({
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
      const messages = await this.session.getSessionTurns({
        userId,
        sessionId,
        persistenceScope,
      });
      await this.memory.captureDialogToShortMemory({
        userId,
        sessionId,
        parentSessionId,
        dialogProcessId,
        messages,
      });
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
      try {
        await memoryEventListener.flush();
      } catch (flushError) {
        throw new AggregateError([error, flushError], "memory postprocess failed", {
          cause: error,
        });
      }
      throw error;
    }
    this.scheduleMemorySummarizeFlow({
      userId,
      sessionId,
      userConfig,
      identity,
      memoryEventListener,
      mode: "async",
    });
  }
}
