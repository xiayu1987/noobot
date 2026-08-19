/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

import { resolveHookClientEmitter } from "@noobot/context-protocol/assembly/hook-context";

import { createCapabilityRuntime } from "../capabilities/runtime.js";
import { resolveDialogProcessIdFromContext } from "../capabilities/handlers/shared/runtime/dialog-process-id.js";
import { safeId } from "../data/record-builders.js";
import { DEFAULT_OPTIONS, normalizeOptions } from "./options.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { formatHarnessCoreError, HARNESS_CORE_ERROR } from "./error-messages.js";

export function normalizePlanningGuidance(options = {}) {
  if (options.planningGuidanceMode === "separate_model" && !options.capabilityModelInvoker) {
    options.planningGuidanceMode = "inject";
  }
}

export function extractBasePath(ctx = {}, options = {}) {
  return String(
    options.basePath ||
      ctx.basePath ||
      ctx?.agentContext?.context?.environment?.workspace?.basePath ||
      "",
  ).trim();
}

export function extractRunId(ctx = {}) {
  return safeId(resolveDialogProcessIdFromContext(ctx) || ctx.sessionId || "run");
}

export function createRunPaths(ctx = {}, options = {}) {
  const basePath = extractBasePath(ctx, options);
  if (!basePath) return null;
  const runId = extractRunId(ctx);
  const runDir = path.join(
    basePath,
    options.runtimeDirName || DEFAULT_OPTIONS.runtimeDirName,
    options.harnessDirName || DEFAULT_OPTIONS.harnessDirName,
    "runs",
    runId,
  );
  return {
    basePath,
    runId,
    runDir,
    manifest: path.join(runDir, "harness-run.json"),
    contextSnapshot: path.join(runDir, "context-snapshot.json"),
    events: path.join(runDir, "events.jsonl"),
    prompts: path.join(runDir, "prompts.jsonl"),
    policyChecks: path.join(runDir, "policy-checks.json"),
    capabilityTraces: path.join(runDir, "capability-traces.jsonl"),
  };
}

export async function ensureRunDir(paths) {
  if (!paths?.runDir) return false;
  await fs.mkdir(paths.runDir, { recursive: true });
  return true;
}

export { resolveHookClientEmitter };

export function isPrimaryExecutionScope(ctx = {}) {
  const scope = String(ctx?.executionScope || "")
    .trim()
    .toLowerCase();
  return !scope || scope === "primary";
}

export function emitHarnessHookProgress(ctx = {}, event = "", data = {}) {
  const emit = resolveHookClientEmitter(ctx);
  if (!emit) return;
  try {
    emit(`harness.${String(event || "").trim() || "progress"}`, {
      plugin: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      ...(data && typeof data === "object" ? data : {}),
    });
  } catch (error) {
    console.warn(`[harness] Failed to emit hook progress ${event}:`, error);
  }
}

export function resolveHookManager(api = {}) {
  return api.hookManager || null;
}

export function createPluginRuntimeContextFactory(deps = {}) {
  const normalizeOptionsFn = deps.normalizeOptions || normalizeOptions;
  const resolveHookManagerFn = deps.resolveHookManager || resolveHookManager;
  const createCapabilityRuntimeFn = deps.createCapabilityRuntime || createCapabilityRuntime;

  return function createPluginRuntimeContext(api = {}, userOptions = {}) {
    const options = normalizeOptionsFn(userOptions, api);
    normalizePlanningGuidance(options);

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
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error(
      formatHarnessCoreError(HARNESS_CORE_ERROR.HOOK_MANAGER_REQUIRED, {
        locale,
        params: { pluginName: PLUGIN_NAME },
      }),
    );
  }
}

export const createPluginRuntimeContext = createPluginRuntimeContextFactory();
