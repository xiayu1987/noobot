/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import {
  filePath as path,
  resolveRuntimePathContext,
} from "@noobot/path-resolver";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import {
  persistTransferArtifacts,
} from "../../../transfer-adapter/index.js";
import {
  EXECUTE_SCRIPT_TOOL_NAME,
  SANDBOX_PROVIDER_NAME,
  SCRIPT_EXECUTION_MODE,
  SCRIPT_WORKDIR_RELATIVE_PATH,
} from "./constants.js";

function normalizePathForTool(value = "") {
  return String(value || "").trim().replaceAll("\\", "/");
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {})
      .filter(([, item]) => {
        if (Array.isArray(item)) return item.length > 0;
        if (item && typeof item === "object") return Object.keys(item).length > 0;
        return item !== undefined && item !== null && String(item || "").trim() !== "";
      }),
  );
}

function buildSandboxPathContext({
  sandboxProvider = SANDBOX_PROVIDER_NAME.DOCKER,
  dockerConfig = {},
  docker = {},
  runtime = {},
  agentContext = null,
  workspace = "",
  pathContext = {},
} = {}) {
  if (pathContext?.view === "sandbox") return pathContext;
  const runtimeBasePath = normalizePathForTool(
    runtime?.basePath ||
      agentContext?.context?.environment?.workspace?.basePath ||
      workspace.replace(/\/runtime\/ops_workdir\/?$/, ""),
  );
  return resolveRuntimePathContext({
    runtime,
    agentContext,
    runtimeBasePath,
    workspacePath: runtimeBasePath,
    userId: runtime?.userId || "",
    effectiveConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: sandboxProvider || SANDBOX_PROVIDER_NAME.DOCKER,
            [sandboxProvider || SANDBOX_PROVIDER_NAME.DOCKER]: dockerConfig,
          },
        },
      },
    },
  });
}

function resolveSandboxRuntimePathDefaults(options = {}) {
  const pathContext = buildSandboxPathContext(options);
  const directories = pathContext?.directories || {};
  const sandboxRoot = pathContext?.sandboxRoot || "";
  const defaultWorkdir = normalizePathForTool(
    options?.docker?.workdir ||
      directories.opsWorkdir ||
      pathContext?.opsWorkdir ||
      "",
  );
  const extraMountTargets = Array.isArray(directories.extraMountTargets)
    ? directories.extraMountTargets
    : Array.isArray(pathContext?.extraMountTargets)
      ? pathContext.extraMountTargets
      : [];
  const allowedRoots = Array.from(new Set((Array.isArray(directories.allowedRoots)
    ? directories.allowedRoots
    : Array.isArray(pathContext?.allowedRoots)
      ? pathContext.allowedRoots
      : [sandboxRoot].filter(Boolean)).filter(Boolean)));
  return compactObject({
    defaultWorkdir,
    sandboxRoot,
    relativePathBase: "defaultWorkdir",
    allowedRoots,
    extraMountTargets,
  });
}

export function buildExecutionWorkspaceMeta({
  sandboxEnabled = false,
  sandboxProvider = SANDBOX_PROVIDER_NAME.DOCKER,
  workspace = "",
  runtime = {},
  agentContext = null,
  dockerConfig = {},
  docker = {},
  pathContext = {},
} = {}) {
  const workspaceHost = normalizePathForTool(workspace);
  if (!sandboxEnabled) {
    return {
      relativePath: SCRIPT_WORKDIR_RELATIVE_PATH,
      absolutePath: workspaceHost,
      view: "non_sandbox",
    };
  }
  const sandboxDefaults = resolveSandboxRuntimePathDefaults({
    sandboxProvider,
    dockerConfig,
    docker,
    runtime,
    agentContext,
    workspace: workspaceHost,
    pathContext,
  });
  return {
    relativePath: SCRIPT_WORKDIR_RELATIVE_PATH,
    absolutePath: String(sandboxDefaults.defaultWorkdir || "").trim(),
    view: "sandbox",
    ...sandboxDefaults,
  };
}

export function buildScriptExecutionMeta({
  sandboxEnabled = false,
  sandboxProvider = SANDBOX_PROVIDER_NAME.DOCKER,
  workspace = "",
  runtime = {},
  agentContext = null,
  dockerConfig = {},
  docker = {},
  pathContext = {},
} = {}) {
  return compactObject({
    runtime: compactObject({
      image: String(docker?.image || "").trim(),
    }),
    workspace: buildExecutionWorkspaceMeta({
      sandboxEnabled,
      sandboxProvider,
      workspace,
      runtime,
      agentContext,
      dockerConfig,
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
