/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { mergeConfig } from "../../config/index.js";

const DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS = 300000;
const DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS = 5000;

function isAbortLikeError(error = {}) {
  const name = String(error?.name || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name.includes("abort") ||
    code === "abort_err" ||
    code === "aborted" ||
    message.includes("abort")
  );
}

/**
 * Memory post-process configuration + flow.
 */
export class MemoryPostProcessService {
  constructor({
    globalConfig = {},
    memory = null,
    errorLogger = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.memory = memory;
    this.errorLogger = errorLogger;
  }

  resolveMemorySummaryTimeoutMs(userConfig = {}) {
    const configured = Number(
      userConfig?.memory?.summarize_timeout_ms ??
        userConfig?.memory?.summarizeTimeoutMs ??
        userConfig?.memorySummarizeTimeoutMs ??
        this.globalConfig?.memory?.summarize_timeout_ms ??
        this.globalConfig?.memory?.summarizeTimeoutMs ??
        this.globalConfig?.memorySummarizeTimeoutMs ??
        DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS,
    );
    if (!Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS;
    }
    return Math.floor(configured);
  }

  resolveMemorySummaryAsyncEnabled(userConfig = {}) {
    const configured =
      userConfig?.memory?.summarize_async ??
      userConfig?.memory?.summarizeAsync ??
      userConfig?.memorySummarizeAsync ??
      this.globalConfig?.memory?.summarize_async ??
      this.globalConfig?.memory?.summarizeAsync ??
      this.globalConfig?.memorySummarizeAsync;
    if (configured === undefined || configured === null) return true;
    return configured !== false;
  }

  resolveMemoryPostProcessAsyncEnabled(userConfig = {}) {
    const configured =
      userConfig?.memory?.postprocess_async ??
      userConfig?.memory?.postprocessAsync ??
      userConfig?.memoryPostprocessAsync ??
      this.globalConfig?.memory?.postprocess_async ??
      this.globalConfig?.memory?.postprocessAsync ??
      this.globalConfig?.memoryPostprocessAsync;
    if (configured === undefined || configured === null) return true;
    return configured !== false;
  }

  resolveExecutionBundleTimeoutMs(userConfig = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig || {}, userConfig || {});
    const configured = Number(
      effectiveConfig?.session?.execution_bundle_timeout_ms ??
        effectiveConfig?.session?.executionBundleTimeoutMs ??
        DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS,
    );
    if (!Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS;
    }
    return Math.floor(configured);
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
        userConfig,
        abortSignal: memorySummaryAbortController.signal,
      });
    } catch (error) {
      if (!isAbortLikeError(error) || !memorySummaryTimedOut) {
        emitEvent(runtimeEventListener, "memory_summary_failed", {
          sessionId,
          mode,
          error: error?.message || String(error),
        });
        if (this.errorLogger?.log) {
          await this.errorLogger.log({
            userId,
            sessionId,
            source: "SessionExecutionEngine._runMemorySummarizeFlow",
            event: "memory_summary_failed",
            error,
          });
        }
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
      const memorySummaryAsyncEnabled =
        this.resolveMemorySummaryAsyncEnabled(userConfig);
      if (memorySummaryAsyncEnabled) {
        emitEvent(runtimeEventListener, "memory_summary_scheduled", {
          sessionId,
          mode: "async",
        });
      }
      await this.runMemorySummarizeFlow({
        userId,
        sessionId,
        userConfig,
        runtimeEventListener,
        mode: memorySummaryAsyncEnabled ? "async" : "sync",
      });
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
          source: "SessionExecutionEngine._runMemoryPostProcessFlow",
          event: "memory_postprocess_failed",
          error,
        });
      }
      throw error;
    }
  }
}
