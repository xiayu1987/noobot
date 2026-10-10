/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import { resolveTimeMs } from "../../config/index.js";
import { BOT_MANAGE_LOG_EVENT, BOT_MANAGE_LOG_SOURCE } from "../config/constants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isAbortError } from "../../shared/utils/error-utils.js";

const DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS = TIME_THRESHOLDS.memory.summaryTimeoutMs;

export class MemoryPostProcessService {
  constructor({ globalConfig = {}, memory = null, errorLogger = null } = {}) {
    this.globalConfig = globalConfig;
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

  resolveMemorySummaryAsyncEnabled(userConfig = {}) {
    return true;
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

  async runMemorySummarizeFlow({
    userId,
    sessionId,
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    const memorySummaryTimeoutMs = this.resolveMemorySummaryTimeoutMs(userConfig);
    let memorySummaryTimedOut = false;
    const memorySummaryAbortController = new AbortController();
    const memorySummaryTimer = setTimeout(() => {
      memorySummaryTimedOut = true;
      memorySummaryAbortController.abort();
    }, memorySummaryTimeoutMs);
    try {
      await this.memory.maybeSummarize({
        userId,
        sessionId,
        userConfig,
        abortSignal: memorySummaryAbortController.signal,
        eventListener: runtimeEventListener,
        onStageError: ({ stage, error }) =>
          this.recordMemorySummaryFailure({
            userId,
            sessionId,
            mode,
            stage,
            error,
            runtimeEventListener,
          }),
      });
    } catch (error) {
      if (!isAbortError(error) || !memorySummaryTimedOut) {
        await this.recordMemorySummaryFailure({
          userId,
          sessionId,
          mode,
          stage: "",
          error,
          runtimeEventListener,
        });
        throw error;
      }
    } finally {
      clearTimeout(memorySummaryTimer);
    }
    if (memorySummaryTimedOut) {
      emitEvent(runtimeEventListener, "memory_summary_timeout", {
        sessionId,
        mode,
        timeoutMs: memorySummaryTimeoutMs,
      });
    }
    emitEvent(runtimeEventListener, "memory_summary_checked", {
      sessionId,
      mode,
    });
  }

  scheduleMemorySummarizeFlow(payload = {}) {
    void runBestEffort(() => this.runMemorySummarizeFlow(payload), {
      operationName: "memoryPostprocess.runScheduledSummary",
      context: { sessionId: payload.sessionId },
    });
  }

  async runMemoryPostProcessFlow({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    try {
      await this.memory.captureSessionToShortMemory({
        userId,
        sessionId,
        parentSessionId,
        userConfig,
      });
      emitEvent(runtimeEventListener, "short_memory_captured", {
        sessionId,
        mode,
      });
      emitEvent(runtimeEventListener, "memory_summary_scheduled", {
        sessionId,
        mode: "async",
      });
      this.scheduleMemorySummarizeFlow({
        userId,
        sessionId,
        userConfig,
        runtimeEventListener,
        mode: "async",
      });
      return;
    } catch (error) {
      emitEvent(runtimeEventListener, "memory_postprocess_failed", {
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
      throw error;
    }
  }
}
