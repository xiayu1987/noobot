/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { mergeConfig } from "../../config/index.js";
import { normalizeTimeMs, resolveTimeMs } from "../../config/index.js";
import {
  BOT_MANAGE_LOG_EVENT,
  BOT_MANAGE_LOG_SOURCE,
} from "../config/constants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS = TIME_THRESHOLDS.memory.summaryTimeoutMs;
const DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS = TIME_THRESHOLDS.memory.executionBundleTimeoutMs;

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
    const userMemoryTimeout = resolveTimeMs(userConfig?.memory, {
      key: "summarizeTimeoutMs",
      legacyKeys: ["summarize_timeout_ms"],
      sourceTag: "agent.memory.summary.user",
      warnLegacy: true,
      fallback: 0,
      min: 1,
    });
    if (userMemoryTimeout > 0) return userMemoryTimeout;

    const userFlatTimeout = normalizeTimeMs(userConfig?.memorySummarizeTimeoutMs, {
      fallback: 0,
      min: 1,
    });
    if (userFlatTimeout > 0) return userFlatTimeout;

    const globalMemoryTimeout = resolveTimeMs(this.globalConfig?.memory, {
      key: "summarizeTimeoutMs",
      legacyKeys: ["summarize_timeout_ms"],
      sourceTag: "agent.memory.summary.global",
      warnLegacy: true,
      fallback: 0,
      min: 1,
    });
    if (globalMemoryTimeout > 0) return globalMemoryTimeout;

    const globalFlatTimeout = normalizeTimeMs(this.globalConfig?.memorySummarizeTimeoutMs, {
      fallback: 0,
      min: 1,
    });
    if (globalFlatTimeout > 0) return globalFlatTimeout;

    return DEFAULT_MEMORY_SUMMARY_TIMEOUT_MS;
  }

  resolveMemorySummaryAsyncEnabled(userConfig = {}) {
    return true;
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
    return resolveTimeMs(effectiveConfig?.session, {
      key: "executionBundleTimeoutMs",
      legacyKeys: ["execution_bundle_timeout_ms"],
      sourceTag: "agent.memory.execution-bundle",
      warnLegacy: true,
      fallback: DEFAULT_EXECUTION_BUNDLE_TIMEOUT_MS,
      min: 1,
    });
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
            source: BOT_MANAGE_LOG_SOURCE.MEMORY_SUMMARIZE,
            event: BOT_MANAGE_LOG_EVENT.MEMORY_SUMMARY_FAILED,
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

  scheduleMemorySummarizeFlow(payload = {}) {
    Promise.resolve()
      .then(() => this.runMemorySummarizeFlow(payload))
      .catch(() => {
        // runMemorySummarizeFlow already emits/logs failures; keep background
        // long-memory and experience processing from surfacing unhandled rejections.
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
