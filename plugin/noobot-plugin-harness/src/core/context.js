/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

import { createCapabilityRuntime } from "../capabilities/runtime.js";
import { resolveDialogProcessIdFromContext } from "../capabilities/handlers/shared/dialog-process-id.js";
import { safeId } from "../data/record-builders.js";
import { DEFAULT_OPTIONS, normalizeOptions } from "./options.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";

export function normalizePlanningGuidance(options = {}) {
  if (options.planningGuidanceMode === "separate_model" && !options.capabilityModelInvoker) {
    options.planningGuidanceMode = "inject";
  }
}

export function extractRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

function resolveUnifiedMessages(ctx = {}) {
  if (Array.isArray(ctx?.messages)) return ctx.messages;
  if (Array.isArray(ctx?.result?.modelMessages)) return ctx.result.modelMessages;
  if (Array.isArray(ctx?.result?.turnMessages)) return ctx.result.turnMessages;
  return null;
}

function resolveUnifiedCalls(ctx = {}) {
  if (Array.isArray(ctx?.calls)) return ctx.calls;
  if (Array.isArray(ctx?.call)) return ctx.call;
  return null;
}

function resolveUnifiedCall(ctx = {}) {
  if (ctx?.call && typeof ctx.call === "object" && !Array.isArray(ctx.call)) return ctx.call;
  if (Array.isArray(ctx?.calls) && ctx.calls.length) {
    const first = ctx.calls[0];
    if (first && typeof first === "object" && !Array.isArray(first)) return first;
  }
  return null;
}

export function normalizeHookContextProtocol(point = "", ctx = {}) {
  if (!ctx || typeof ctx !== "object") return ctx;
  const normalizedPoint = String(point || ctx?.point || "").trim();
  if (normalizedPoint && !ctx.point) ctx.point = normalizedPoint;

  const unifiedMessages = resolveUnifiedMessages(ctx);
  if (unifiedMessages && !Array.isArray(ctx.messages)) {
    ctx.messages = unifiedMessages;
  }

  const unifiedCalls = resolveUnifiedCalls(ctx);
  if (unifiedCalls && !Array.isArray(ctx.calls)) {
    ctx.calls = unifiedCalls;
  }

  const unifiedCall = resolveUnifiedCall(ctx);
  if (unifiedCall && (!ctx.call || typeof ctx.call !== "object" || Array.isArray(ctx.call))) {
    ctx.call = unifiedCall;
  }

  if (!ctx.toolName && ctx?.call?.name) {
    ctx.toolName = String(ctx.call.name || "").trim();
  }

  return ctx;
}

export function extractBasePath(ctx = {}, options = {}) {
  return String(
    options.basePath ||
      ctx.basePath ||
      extractRuntime(ctx)?.basePath ||
      ctx?.agentContext?.environment?.workspace?.basePath ||
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
    toolCalls: path.join(runDir, "tool-calls.jsonl"),
    stateCommits: path.join(runDir, "state-commits.jsonl"),
    policyChecks: path.join(runDir, "policy-checks.json"),
    capabilityTraces: path.join(runDir, "capability-traces.jsonl"),
  };
}

export async function ensureRunDir(paths) {
  if (!paths?.runDir) return false;
  await fs.mkdir(paths.runDir, { recursive: true });
  return true;
}

export function resolveHookClientEmitter(ctx = {}) {
  if (typeof ctx?.emitHookClientEvent === "function") {
    return (event, data) => ctx.emitHookClientEvent(event, data);
  }
  if (ctx?.hookClientChannel && typeof ctx.hookClientChannel.emit === "function") {
    return (event, data) => ctx.hookClientChannel.emit(event, data);
  }
  return null;
}

export function isPrimaryExecutionScope(ctx = {}) {
  const scope = String(ctx?.executionScope || "").trim().toLowerCase();
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
  } catch {
    // client channel failures should not interrupt main flow
  }
}

export function resolveHookManager(api = {}) {
  return api.hookManager || api.hooks || api.manager || api?.runtime?.hookManager || api?.runConfig?.hookManager || null;
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

export function assertHookManager(hookManager) {
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error(`${PLUGIN_NAME}: hookManager with .on(point, handler, options) is required`);
  }
}

export const createPluginRuntimeContext = createPluginRuntimeContextFactory();
