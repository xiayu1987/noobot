/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { flushAllManifests, flushAllJsonlBuffers } from "../store/store.js";
import { cleanupRunsBySessionIds } from "../utils/cleanup.js";
import { injectPrompt, traceHook } from "../tracing/buffer-manager.js";
import { createRunTraceSink } from "../tracing/run-trace-sink.js";
import { safeError } from "../data/record-builders.js";
import { emitHarnessHookProgress, extractBasePath, isPrimaryExecutionScope } from "./context.js";
import { HARNESS_HOOK_POINTS } from "./constants.js";

export const HARNESS_TRACE_POINTS = Object.freeze([
  HARNESS_HOOK_POINTS.BEFORE_CONTEXT_BUILD,
  HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD,
  HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
  HARNESS_HOOK_POINTS.BEFORE_TURN,
  HARNESS_HOOK_POINTS.AFTER_TURN,
  HARNESS_HOOK_POINTS.ON_ABORT,
  HARNESS_HOOK_POINTS.ON_ERROR,
  HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
  HARNESS_HOOK_POINTS.LLM_CALL_ERROR,
  HARNESS_HOOK_POINTS.BEFORE_TOOL_CALLS,
  HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL,
  HARNESS_HOOK_POINTS.AFTER_TOOL_CALL,
  HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
  HARNESS_HOOK_POINTS.BEFORE_STATE_COMMIT,
  HARNESS_HOOK_POINTS.AFTER_STATE_COMMIT,
  HARNESS_HOOK_POINTS.BEFORE_LLM_CALL,
  HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
]);

export const HARNESS_FLUSH_POINTS = Object.freeze([
  HARNESS_HOOK_POINTS.AFTER_TURN,
  HARNESS_HOOK_POINTS.ON_ABORT,
  HARNESS_HOOK_POINTS.ON_ERROR,
  HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
]);

export const HARNESS_SESSION_CLEANUP_POINTS = Object.freeze([
  HARNESS_HOOK_POINTS.AFTER_SESSION_DELETE,
]);

export function shouldInjectPromptAtPoint(point = "", options = {}) {
  return (
    point === HARNESS_HOOK_POINTS.BEFORE_LLM_CALL ||
    (point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT && options.finalResponseGuard !== false)
  );
}

export function createRegisterHarnessHooks(deps = {}) {
  const tracePoints = deps.tracePoints || HARNESS_TRACE_POINTS;
  const flushPoints = deps.flushPoints || HARNESS_FLUSH_POINTS;
  const emitHarnessHookProgressFn = deps.emitHarnessHookProgress || emitHarnessHookProgress;
  const isPrimaryExecutionScopeFn = deps.isPrimaryExecutionScope || isPrimaryExecutionScope;
  const shouldInjectPromptAtPointFn = deps.shouldInjectPromptAtPoint || shouldInjectPromptAtPoint;
  const injectPromptFn = deps.injectPrompt || injectPrompt;
  const traceHookFn = deps.traceHook || traceHook;
  const createRunTraceSinkFn = deps.createRunTraceSink || createRunTraceSink;
  const safeErrorFn = deps.safeError || safeError;
  const flushAllManifestsFn = deps.flushAllManifests || flushAllManifests;
  const flushAllJsonlBuffersFn = deps.flushAllJsonlBuffers || flushAllJsonlBuffers;
  const sessionCleanupPoints = deps.sessionCleanupPoints || HARNESS_SESSION_CLEANUP_POINTS;
  const cleanupRunsBySessionIdsFn = deps.cleanupRunsBySessionIds || cleanupRunsBySessionIds;
  const extractBasePathFn = deps.extractBasePath || extractBasePath;

  return function registerHarnessHooks({ hookManager, options, capabilityRuntime, plugin }) {
    const disposers = [];

    for (const point of tracePoints) {
      disposers.push(
        hookManager.on(
          point,
          async (ctx = {}) => {
            if (!isPrimaryExecutionScopeFn(ctx)) return;
            emitHarnessHookProgressFn(ctx, "hook_start", { point });
            try {
              await capabilityRuntime.runHook(point, ctx, {
                pluginName: plugin.name,
                pluginVersion: plugin.version,
                harness: {
                  planningGuidanceMode: options.planningGuidanceMode,
                  capabilityModelInvoker: options.capabilityModelInvoker,
                  capabilityModelByPurpose: options.capabilityModelByPurpose,
                  stepModels: options.stepModels,
                  resolveModelMessages: options.resolveModelMessages,
                  markMessagesSummarized: options.markMessagesSummarized,
                  capabilityToolAllowlist: options.capabilityToolAllowlist,
                  capabilityToolAllowlistByPurpose: options.capabilityToolAllowlistByPurpose,
                  acceptance: options.acceptance,
                  review: options.review,
                  pendingTtlHookTurns: options.pendingTtlHookTurns,
                  runTraceSink: createRunTraceSinkFn(ctx, options),
                },
              });
              emitHarnessHookProgressFn(ctx, "capability_runtime_done", { point });

              if (shouldInjectPromptAtPointFn(point, options)) {
                await injectPromptFn(point, ctx, options, plugin);
                emitHarnessHookProgressFn(ctx, "prompt_injected", { point });
              }

              const traceResult = await traceHookFn(point, ctx, options, plugin);
              emitHarnessHookProgressFn(ctx, "hook_end", {
                point,
                fsmState: traceResult?.fsmState,
                fsmRejected: traceResult?.fsmRejected === true,
              });
            } catch (error) {
              emitHarnessHookProgressFn(ctx, "hook_error", { point, error: safeErrorFn(error) });
              throw error;
            }
          },
          {
            id: `${plugin.name}.trace.${point}`,
            priority: options.tracePriority,
            timeoutMs: options.timeoutMs,
          },
        ),
      );
    }

    for (const point of flushPoints) {
      disposers.push(
        hookManager.on(
          point,
          async () => {
            await flushAllManifestsFn();
            await flushAllJsonlBuffersFn();
          },
          {
            id: `${plugin.name}.flush.${point}`,
            priority: Number.isFinite(Number(options?.flushHookPriority))
              ? Number(options.flushHookPriority)
              : 5,
            timeoutMs: Number.isFinite(Number(options?.flushHookTimeoutMs))
              ? Math.max(1, Number(options.flushHookTimeoutMs))
              : 2000,
          },
        ),
      );
    }

    for (const point of sessionCleanupPoints) {
      disposers.push(
        hookManager.on(
          point,
          async (ctx = {}) => {
            const deletedSessionIds = Array.isArray(ctx?.deletedSessionIds)
              ? ctx.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
              : [];
            const fallbackSessionId = String(ctx?.sessionId || "").trim();
            const sessionIds = deletedSessionIds.length
              ? deletedSessionIds
              : fallbackSessionId
                ? [fallbackSessionId]
                : [];
            if (!sessionIds.length) return;

            await flushAllManifestsFn();
            await flushAllJsonlBuffersFn();

            const basePath = extractBasePathFn(ctx, options);
            if (!basePath) return;
            const cleanup = await cleanupRunsBySessionIdsFn(basePath, sessionIds, options);
            emitHarnessHookProgressFn(ctx, "session_cleanup_done", {
              point,
              deleted: cleanup?.deleted || 0,
              matchedRuns: cleanup?.matchedRuns || 0,
              errors: cleanup?.errors || 0,
            });
          },
          {
            id: `${plugin.name}.cleanup.${point}`,
            priority: 10,
            timeoutMs: Math.max(2000, Number(options?.timeoutMs) || 0),
          },
        ),
      );
    }

    return disposers;
  };
}

export const registerHarnessHooks = createRegisterHarnessHooks();
