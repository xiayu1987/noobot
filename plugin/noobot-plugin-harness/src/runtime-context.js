/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

import { safeId } from "./data/record-builders.js";
import { DEFAULT_OPTIONS } from "./options.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";

export function extractRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
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
  return safeId(
    ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || ctx.sessionId || "run",
  );
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
