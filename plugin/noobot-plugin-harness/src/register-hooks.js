/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { flushAllManifests, flushAllJsonlBuffers } from "./lib/store.js";
import { HARNESS_FLUSH_POINTS, HARNESS_TRACE_POINTS, shouldInjectPromptAtPoint } from "./hook-points.js";
import { emitHarnessHookProgress, isPrimaryExecutionScope } from "./runtime-context.js";
import { injectPrompt, traceHook } from "./tracing/buffer-manager.js";
import { createRunTraceSink } from "./tracing/run-trace-sink.js";
import { safeError } from "./data/record-builders.js";

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
                  capabilityToolAllowlist: options.capabilityToolAllowlist,
                  capabilityToolAllowlistByPurpose: options.capabilityToolAllowlistByPurpose,
                  acceptance: options.acceptance,
                  review: options.review,
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
            priority: 5,
            timeoutMs: 2000,
          },
        ),
      );
    }

    return disposers;
  };
}

export const registerHarnessHooks = createRegisterHarnessHooks();
