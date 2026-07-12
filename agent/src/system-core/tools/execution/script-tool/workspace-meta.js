/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import {
  filePath as path,
  resolveAttachmentDisplayPath,
  resolveRuntimePathContext,
} from "../../../utils/path-resolver.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
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
      agentContext?.environment?.workspace?.basePath ||
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
      agentContext?.environment?.identity?.userId ||
      "",
  ).trim();
}

function resolveRuntimeSessionId(runtime = {}, agentContext = null) {
  return String(
    runtime?.systemRuntime?.sessionId ||
      runtime?.sessionId ||
      agentContext?.session?.current?.id ||
      agentContext?.session?.id ||
      "",
  ).trim();
}

function buildScriptOutputFileView({
  runtime = {},
  agentContext = null,
  basePath = "",
  filePath = "",
  bytes = 0,
  role = "",
} = {}) {
  const relativePath = basePath && filePath.startsWith(basePath)
    ? path.relative(basePath, filePath).split(path.sep).join("/")
    : "";
  return compactObject({
    role,
    filePath,
    relativePath,
    displayPath: resolveAttachmentDisplayPath({
      path: filePath,
      hostPath: filePath,
      relativePath,
      runtime,
      agentContext,
      purpose: "execute_script_output_file",
    }),
    bytes: Number(bytes || 0),
  });
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

function buildAttachmentView({
  record = {},
  runtime = {},
  agentContext = null,
} = {}) {
  return compactObject({
    attachmentId: record.attachmentId,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    path: record.path,
    relativePath: record.relativePath,
    displayPath: resolveAttachmentDisplayPath({
      meta: record,
      runtime,
      agentContext,
      purpose: "execute_script_output_attachment",
    }),
  });
}

async function persistBackgroundScriptOutput({
  runtime = {},
  agentContext = null,
  result = {},
} = {}) {
  const service = runtime?.attachmentService || null;
  const userId = resolveRuntimeUserId(runtime, agentContext);
  const sessionId = resolveRuntimeSessionId(runtime, agentContext);
  if (!service || typeof service.ingestGeneratedArtifacts !== "function" || !userId || !sessionId) {
    return [];
  }
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
  if (!artifacts.length) return [];
  return service.ingestGeneratedArtifacts({
    userId,
    sessionId,
    attachmentSource: "model",
    generationSource: "execute_script_background",
    artifacts,
  });
}

export async function toolFileBackedExecResult(mode, r = {}, extra = {}, options = {}) {
  const runtime = options?.runtime || {};
  const agentContext = options?.agentContext || null;
  const basePath = String(options?.basePath || "").trim();
  const records = await persistBackgroundScriptOutput({ runtime, agentContext, result: r });
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    executionMode: SCRIPT_EXECUTION_MODE.BACKGROUND,
    ...extra,
    code: Number(r?.code || 0),
    ...(r?.signal ? { signal: r.signal } : {}),
    outputFiles: {
      stdout: buildScriptOutputFileView({
        runtime,
        agentContext,
        basePath,
        filePath: r.stdoutPath,
        bytes: r.stdoutBytes,
        role: "stdout",
      }),
      stderr: buildScriptOutputFileView({
        runtime,
        agentContext,
        basePath,
        filePath: r.stderrPath,
        bytes: r.stderrBytes,
        role: "stderr",
      }),
    },
    attachments: records.map((record) => buildAttachmentView({ record, runtime, agentContext })),
  });
}
