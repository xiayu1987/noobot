/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { isCanonicalDialogProcessKey } from "@noobot/session-protocol";
import { isWorkspacePathSegment } from "@noobot/workspace-protocol";
import { harnessRunsDirectory } from "../store/run-mutation.js";

import { resolveHookClientEmitter } from "@noobot/context-protocol/assembly/hook-context";

import { createCapabilityRuntime } from "../capabilities/runtime.js";
import { normalizeOptions } from "./options.js";
import { HARNESS_FILES, PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { formatHarnessCoreError, HARNESS_CORE_ERROR } from "./error-messages.js";
import { text, isFunction } from "@noobot/shared/value";

export function createRunPaths(ctx, options) {
  const basePath = text(options.basePath);
  if (!basePath) throw new TypeError("harness run paths require options.basePath");
  const { dialogProcessId: runId, sessionId, parentSessionId } = ctx;
  if (
    !isCanonicalDialogProcessKey(runId) ||
    !isWorkspacePathSegment(sessionId) ||
    (parentSessionId && !isWorkspacePathSegment(parentSessionId))
  ) {
    throw new TypeError("harness run requires valid dialog and session ownership");
  }
  const runDir = path.join(harnessRunsDirectory(basePath), runId);
  return {
    basePath,
    runId,
    sessionId,
    parentSessionId: parentSessionId || null,
    runDir,
    manifest: path.join(runDir, HARNESS_FILES.RUN_MANIFEST),
    contextSnapshot: path.join(runDir, "context-snapshot.json"),
    events: path.join(runDir, "events.jsonl"),
    prompts: path.join(runDir, "prompts.jsonl"),
    policyChecks: path.join(runDir, "policy-checks.json"),
    capabilityTraces: path.join(runDir, "capability-traces.jsonl"),
  };
}

export function isPrimaryExecutionScope(ctx = {}) {
  const scope = text(ctx?.executionScope).toLowerCase();
  return !scope || scope === "primary";
}

export function emitHarnessHookProgress(ctx = {}, event = "", data = {}) {
  const emit = resolveHookClientEmitter(ctx);
  if (!emit) return;
  try {
    emit(`harness.${text(event) || "progress"}`, {
      plugin: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      ...(data && typeof data === "object" ? data : {}),
    });
  } catch (error) {
    console.warn(`[harness] Failed to emit hook progress ${event}:`, error);
  }
}

function resolveHookManager(api = {}) {
  return api.hookManager || null;
}

export function createPluginRuntimeContextFactory(deps = {}) {
  const normalizeOptionsFn = deps.normalizeOptions || normalizeOptions;
  const resolveHookManagerFn = deps.resolveHookManager || resolveHookManager;
  const createCapabilityRuntimeFn = deps.createCapabilityRuntime || createCapabilityRuntime;

  return function createPluginRuntimeContext(api = {}, userOptions = {}) {
    const options = normalizeOptionsFn(userOptions, api);

    const hookManager = resolveHookManagerFn(api);
    const capabilityRuntime = createCapabilityRuntimeFn({
      profile: options.capabilityProfile,
      handlers: options.capabilityHandlers,
    });
    options.capabilityRuntime = capabilityRuntime;

    return { options, hookManager, capabilityRuntime };
  };
}

export function assertHookManager(hookManager, { locale = "en-US" } = {}) {
  if (!hookManager || !isFunction(hookManager.on)) {
    throw new Error(
      formatHarnessCoreError(HARNESS_CORE_ERROR.HOOK_MANAGER_REQUIRED, {
        locale,
        params: { pluginName: PLUGIN_NAME },
      }),
    );
  }
}

export const createPluginRuntimeContext = createPluginRuntimeContextFactory();
