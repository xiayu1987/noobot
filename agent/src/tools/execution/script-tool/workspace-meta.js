/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import {
  assertToolExecutionPolicy,
  projectToolExecutionMeta,
} from "@noobot/execution-isolation-protocol";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { persistTransferArtifacts } from "../../../transfer-adapter/index.js";
import { EXECUTE_SCRIPT_TOOL_NAME, SCRIPT_EXECUTION_MODE } from "./constants.js";

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === "object") return Object.keys(item).length > 0;
      return item !== undefined && item !== null && String(item || "").trim() !== "";
    }),
  );
}

export function buildExecutionWorkspaceMeta({
  executionPolicy = {},
  workspace = "",
  runtime = {},
  agentContext = null,
  docker = {},
  pathContext = {},
} = {}) {
  void runtime;
  void agentContext;
  assertToolExecutionPolicy(executionPolicy);
  void workspace;
  void docker;
  void pathContext;
  return {
    view: "workspace",
    path: ".",
  };
}

function buildExecutionMeta({ executionPolicy = {}, docker = {} } = {}) {
  void docker;
  return compactObject(projectToolExecutionMeta({ policy: executionPolicy }));
}

export function buildScriptExecutionMeta({
  executionPolicy = {},
  workspace = "",
  runtime = {},
  agentContext = null,
  docker = {},
  pathContext = {},
} = {}) {
  return compactObject({
    execution: buildExecutionMeta({ executionPolicy, docker }),
    workspace: buildExecutionWorkspaceMeta({
      executionPolicy,
      workspace,
      runtime,
      agentContext,
      docker,
      pathContext,
    }),
  });
}

function resolveRuntimeUserId(runtime = {}, agentContext = null) {
  return String(
    runtime?.systemRuntime?.userId ||
      runtime?.userId ||
      agentContext?.context?.identity?.userId ||
      "",
  ).trim();
}

function resolveRuntimeSessionId(runtime = {}, agentContext = null) {
  return String(
    runtime?.systemRuntime?.sessionId ||
      runtime?.sessionId ||
      agentContext?.context?.identity?.sessionId ||
      "",
  ).trim();
}

async function buildBackgroundOutputArtifact({ filePath = "", name = "", role = "" } = {}) {
  const bytes = await readFile(filePath).catch(() => Buffer.alloc(0));
  if (!bytes.length) return null;
  return {
    name,
    mimeType: "text/plain",
    contentBase64: bytes.toString("base64"),
    meta: { role },
  };
}

async function persistBackgroundScriptOutput({
  runtime = {},
  agentContext = null,
  result = {},
  identity = null,
} = {}) {
  const userId = resolveRuntimeUserId(runtime, agentContext);
  const artifacts = [
    await buildBackgroundOutputArtifact({
      filePath: result.stdoutPath,
      name: "execute-script-stdout.txt",
      role: "stdout",
    }),
    await buildBackgroundOutputArtifact({
      filePath: result.stderrPath,
      name: "execute-script-stderr.txt",
      role: "stderr",
    }),
  ].filter(Boolean);
  if (!artifacts.length) return null;
  return persistTransferArtifacts({
    runtime,
    agentContext,
    userId,
    artifacts,
    attachmentSource: "model",
    generationSource: "execute_script_background",
    source: "tool",
    reason: "execute_script_background",
    identity,
    intent: {
      source: "tool",
      reason: "execute_script_background",
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: { contentOmitted: true },
  });
}

export async function toolFileBackedExecResult(mode, r = {}, extra = {}, options = {}) {
  const runtime = options?.runtime || {};
  const agentContext = options?.agentContext || null;
  const persisted = await persistBackgroundScriptOutput({
    runtime,
    agentContext,
    result: r,
    identity: options?.identity,
  });
  const transferEnvelopes = persisted?.transferEnvelopes || [];
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    executionMode: SCRIPT_EXECUTION_MODE.BACKGROUND,
    ...extra,
    code: Number(r?.code || 0),
    ...(r?.signal ? { signal: r.signal } : {}),
    transferEnvelopes,
  });
}
