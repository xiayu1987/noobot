/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { filePath as path, resolveAttachmentDisplayPath } from "../../utils/path-resolver.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  BUILTIN_THRESHOLDS,
  mergeConfig,
  normalizeSandboxProvider,
  normalizeTimeMs,
  resolveTimeMs,
} from "../../config/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { recoverableToolError } from "../../error/index.js";
import {
  buildBubblewrapCommand,
  bwrapSupportsOption,
  ensureBubblewrapOverlayReady,
} from "../../sandbox/bubblewrap-sandbox.js";
import {
  buildDockerCommand,
  normalizeDockerMounts,
  normalizeDockerContainerScope,
} from "../../sandbox/docker-sandbox.js";
import { buildFirejailCommand } from "../../sandbox/firejail-sandbox.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import { SANDBOX_CONFIG, TOOL_NAME } from "../constants/index.js";
import { logDebug, logWarn } from "../../tracking/console/logger.js";
import { formatLinesWithNumbers, splitLines } from "./file-utils.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const EXECUTE_SCRIPT_TOOL_NAME = TOOL_NAME.EXECUTE_SCRIPT;
const DEFAULT_TIMEOUT = TIME_THRESHOLDS.tools.executeScriptTimeoutMs;
const DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS = TIME_THRESHOLDS.tools.dockerLockWaitTimeoutMs;
const SANDBOX_PROVIDER_NAME = SANDBOX_CONFIG.PROVIDERS;
const DOCKER_SANDBOX_DEFAULT = SANDBOX_CONFIG.DOCKER;
const SANDBOX_COMMAND = SANDBOX_CONFIG.COMMANDS;
const dockerContainerQueueMap = new Map();
const SCRIPT_WORKDIR_RELATIVE_PATH = "runtime/ops_workdir";
const SCRIPT_EXECUTION_MODE = Object.freeze({
  FOREGROUND: "foreground",
  BACKGROUND: "background",
});
const ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS = normalizeTimeMs(
  process.env.NOOBOT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  {
    fallback: DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    min: 100,
  },
);

function run(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    // cross-platform-allow: preserve previous exec(command) shell semantics for this tool
    const child = spawn(cmd, {
      cwd,
      shell: true,
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let spawnError = null;
    let timedOut = false;
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => {
        timedOut = true;
        // cross-platform-allow: Node child.kill handles Windows direct-child termination
        child.kill("SIGTERM");
      }, Number(timeoutMs))
      : null;

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf8");
      const fallbackStderr = spawnError?.message || (timedOut ? `command timed out after ${Number(timeoutMs)}ms` : "");
      const resultCode = Number.isFinite(Number(code))
        ? Number(code)
        : timedOut
          ? 124
          : Number(spawnError?.code || 0) || 0;
      resolve({
        code: resultCode,
        stdout,
        stderr: rawStderr || fallbackStderr,
        ...(signal ? { signal } : {}),
      });
    });
  });
}

function normalizeExecutionMode(value = "") {
  return String(value || "").trim().toLowerCase() === SCRIPT_EXECUTION_MODE.BACKGROUND
    ? SCRIPT_EXECUTION_MODE.BACKGROUND
    : SCRIPT_EXECUTION_MODE.FOREGROUND;
}

function waitForWritableFinished(stream) {
  return new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });
}

function pipeReadableToWritable(readable, writable) {
  if (!readable) {
    writable.end();
    return;
  }
  readable.on("data", (chunk) => {
    if (writable.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) === false) {
      readable.pause();
    }
  });
  writable.on("drain", () => readable.resume());
  readable.on("end", () => writable.end());
  readable.on("error", (error) => writable.destroy(error));
}

function terminateChild(child) {
  if (!child) return;
  if (process.platform !== "win32" && Number.isFinite(Number(child.pid))) {
    try {
      process.kill(-Number(child.pid), "SIGTERM");
      return;
    } catch {
      // Fall back to killing the direct shell process.
    }
  }
  // cross-platform-allow: fallback direct-child termination uses Node's cross-platform kill shim
  child.kill("SIGTERM");
}

async function runFileBacked(cmd, cwd, timeoutMs) {
  const outputDir = path.join(cwd, ".execute-script-background", `${Date.now()}-${randomUUID()}`);
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);
  const stdoutFinished = waitForWritableFinished(stdoutStream);
  const stderrFinished = waitForWritableFinished(stderrStream);

  return await new Promise((resolve) => {
    // cross-platform-allow: background mode also preserves shell command semantics
    const child = spawn(cmd, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError = null;
    let timedOut = false;
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => {
        timedOut = true;
        terminateChild(child);
      }, Number(timeoutMs))
      : null;

    pipeReadableToWritable(child.stdout, stdoutStream);
    pipeReadableToWritable(child.stderr, stderrStream);
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", async (code, signal) => {
      if (timeout) clearTimeout(timeout);
      try {
        await Promise.all([stdoutFinished, stderrFinished]);
      } catch {
        // Keep script results recoverable; stderr fallback below carries process-level failures.
      }
      if (spawnError || timedOut) {
        const fallbackMessage = spawnError?.message || `command timed out after ${Number(timeoutMs)}ms`;
        const existingStderr = await readFile(stderrPath, "utf8").catch(() => "");
        if (!existingStderr) await writeFile(stderrPath, fallbackMessage, "utf8");
      }
      const stdoutStat = await stat(stdoutPath).catch(() => ({ size: 0 }));
      const stderrStat = await stat(stderrPath).catch(() => ({ size: 0 }));
      const resultCode = Number.isFinite(Number(code))
        ? Number(code)
        : timedOut
          ? 124
          : Number(spawnError?.code || 0) || 0;
      resolve({
        code: resultCode,
        ...(signal ? { signal } : {}),
        stdoutPath,
        stderrPath,
        stdoutBytes: Number(stdoutStat?.size || 0),
        stderrBytes: Number(stderrStat?.size || 0),
      });
    });
  });
}

function tScript(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.script.${String(key || "").trim()}`, params);
}

function hasCommand(commandName = "") {
  return new Promise((resolve) => {
    const normalizedCommandName = String(commandName || "").trim();
    if (!normalizedCommandName) {
      resolve(false);
      return;
    }
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    execFile(lookupCommand, [normalizedCommandName], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

function enqueueDockerContainerTask({
  containerName = "",
  task = async () => ({}),
  lockWaitTimeoutMs = ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
} = {}) {
  const key = String(containerName || "").trim() || "__default__";
  const previousTail = dockerContainerQueueMap.get(key) || Promise.resolve();
  const queueDepthBefore = dockerContainerQueueMap.has(key) ? 1 : 0;
  const waitStartedAt = Date.now();
  const waitForPrevious = previousTail.catch(() => undefined);
  const waitTimeout = normalizeTimeMs(lockWaitTimeoutMs, {
    fallback: DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    min: 100,
  });
  const waitPromise = Promise.race([
    waitForPrevious,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(new Error("docker container queue lock wait timeout"), {
            code: "DOCKER_CONTAINER_QUEUE_LOCK_TIMEOUT",
            details: {
              containerName: key,
              lockWaitTimeoutMs: waitTimeout,
            },
          }),
        );
      }, waitTimeout);
      waitForPrevious.finally(() => clearTimeout(timer));
    }),
  ]);
  if (queueDepthBefore > 0) {
    logDebug("[execute_script][docker_queue_waiting]", {
      containerName: key,
      lockWaitTimeoutMs: waitTimeout,
    });
  }
  const runPromise = waitPromise.then(async () => {
    const waitedMs = Date.now() - waitStartedAt;
    if (waitedMs > 0) {
      logDebug("[execute_script][docker_queue_acquired]", {
        containerName: key,
        waitedMs,
      });
    }
    return task();
  });
  const tailPromise = runPromise
    .catch(() => undefined)
    .finally(() => {
    if (dockerContainerQueueMap.get(key) === tailPromise) {
      dockerContainerQueueMap.delete(key);
    }
    });
  dockerContainerQueueMap.set(key, tailPromise);
  return runPromise;
}


function resolveSandboxProviderConfig(scriptConfig = {}) {
  const providerConfig =
    scriptConfig?.sandboxProvider && typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : scriptConfig?.sandbox_provider && typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : null;
  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return { provider: SANDBOX_PROVIDER_NAME.DOCKER, providerDetail: {} };
  }
  const provider = normalizeSandboxProvider(
    providerConfig?.default || SANDBOX_PROVIDER_NAME.DOCKER,
  );
  const detail =
    providerConfig?.[provider] &&
    typeof providerConfig?.[provider] === "object" &&
    !Array.isArray(providerConfig?.[provider])
      ? providerConfig?.[provider]
      : {};
  return { provider, providerDetail: detail };
}

function resolveDockerScriptConfig(scriptConfig = {}, providerDetail = {}) {
  void scriptConfig;
  return {
    dockerContainerScope:
      providerDetail?.dockerContainerScope ||
      DOCKER_SANDBOX_DEFAULT.DEFAULT_CONTAINER_SCOPE,
    dockerContainerName:
      providerDetail?.dockerContainerName ||
      DOCKER_SANDBOX_DEFAULT.DEFAULT_CONTAINER_NAME,
    dockerImage: providerDetail?.dockerImage || DOCKER_SANDBOX_DEFAULT.DEFAULT_IMAGE,
    dockerMounts: Array.isArray(providerDetail?.dockerMounts)
      ? providerDetail.dockerMounts
      : [],
    dockerProjectMountSource: String(
      providerDetail?.dockerProjectMountSource || "",
    ).trim(),
    dockerProjectMountTarget:
      String(providerDetail?.dockerProjectMountTarget || "").trim() || "/project",
    dockerLockWaitTimeoutMs: resolveTimeMs(providerDetail, {
      key: "dockerLockWaitTimeoutMs",
      legacyKeys: ["docker_lock_wait_timeout_ms"],
      sourceTag: "tools.execute_script",
      warnLegacy: true,
      fallback: ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
      min: 100,
    }),
  };
}

function formatCommandOutputWithLineNumbers(value = "") {
  const text = String(value || "");
  if (!text) return "";
  const lines = splitLines(text);
  if (text.endsWith("\n")) lines.pop();
  return formatLinesWithNumbers(lines, 1);
}

function normalizeExecOutput(r = {}, { includeLineNumbers = false } = {}) {
  if (includeLineNumbers !== true) return r;
  return {
    ...r,
    stdout: formatCommandOutputWithLineNumbers(r?.stdout || ""),
    stderr: formatCommandOutputWithLineNumbers(r?.stderr || ""),
  };
}

function toolExecResult(mode, r = {}, extra = {}, options = {}) {
  const includeLineNumbers = options?.includeLineNumbers === true;
  const normalizedResult = normalizeExecOutput(r, { includeLineNumbers });
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    ...extra,
    ...normalizedResult,
    includeLineNumbers,
  });
}

function resolveSandboxPathView({
  runtime = {},
  agentContext = null,
  hostPath = "",
  relativePath = "",
} = {}) {
  const normalizedHostPath = String(hostPath || "").trim();
  if (!normalizedHostPath && !String(relativePath || "").trim()) return "";
  const payload = {
    path: normalizedHostPath,
    hostPath: normalizedHostPath,
    relativePath: String(relativePath || "").trim(),
    runtime,
    agentContext,
  };
  const resolverCandidates = [
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];
  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = String(resolver(payload) || "").trim();
      if (resolved) return resolved;
    } catch {
      // Keep tool output deterministic: ignore resolver failures and fallback.
    }
  }
  return "";
}

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

function resolveSandboxRuntimePathDefaults({
  sandboxProvider = SANDBOX_PROVIDER_NAME.DOCKER,
  dockerConfig = {},
  docker = {},
  runtime = {},
  agentContext = null,
  workspace = "",
} = {}) {
  const normalizedProvider = normalizeSandboxProvider(sandboxProvider || SANDBOX_PROVIDER_NAME.DOCKER);
  const workspaceHost = normalizePathForTool(workspace);
  const sandboxDefaultWorkdir = normalizePathForTool(
    docker?.workdir ||
      resolveSandboxPathView({
        runtime,
        agentContext,
        hostPath: workspaceHost,
        relativePath: SCRIPT_WORKDIR_RELATIVE_PATH,
      }),
  );
  const fallbackWorkdirMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: "/workspace/runtime/sandbox/persist",
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: "$HOME/runtime/sandbox/persist",
    [SANDBOX_PROVIDER_NAME.DOCKER]: sandboxDefaultWorkdir,
  };
  const sandboxRootMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: "/workspace",
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: "$HOME",
    [SANDBOX_PROVIDER_NAME.DOCKER]: "/workspace",
  };
  const extraMountTargets = normalizedProvider === SANDBOX_PROVIDER_NAME.DOCKER
    ? Array.from(
        new Set(
          [
            ...(Array.isArray(docker?.dockerMounts) ? docker.dockerMounts : []),
            ...normalizeDockerMounts(dockerConfig),
          ]
            .map((item = {}) => normalizePathForTool(item?.target || item?.mountTarget || ""))
            .filter(Boolean),
        ),
      )
    : [];
  const sandboxRoot = sandboxRootMap[normalizedProvider] || sandboxRootMap[SANDBOX_PROVIDER_NAME.DOCKER];
  const defaultWorkdir = sandboxDefaultWorkdir || fallbackWorkdirMap[normalizedProvider] || "";
  const allowedRoots = Array.from(new Set([sandboxRoot, ...extraMountTargets].filter(Boolean)));
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

async function toolFileBackedExecResult(mode, r = {}, extra = {}, options = {}) {
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

function missingCommandError(mode, commandName = "", runtime = {}) {
  return recoverableToolError(
    tScript(runtime, "commandNotInstalled", { commandName }),
    {
      code: ERROR_CODE.RECOVERABLE_COMMAND_NOT_INSTALLED,
      details: {
        mode,
        commandName,
        code: 127,
      },
    },
  );
}

function scriptRuntimeError(message = "", options = {}) {
  return recoverableToolError(String(message || "").trim(), {
    code: String(options?.code || ERROR_CODE.RECOVERABLE_SCRIPT_RUNTIME_ERROR),
    details:
      options?.details && typeof options.details === "object"
        ? options.details
        : {},
  });
}

async function runDockerCommand({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  scriptConfig = {},
  runner = run,
}) {
  const built = buildDockerCommand({ userRoot, userId, command, scriptConfig });
  let result = null;
  try {
    result = await enqueueDockerContainerTask({
      containerName: built.containerName,
      task: async () => runner(built.cmd, workspace, timeout),
      lockWaitTimeoutMs:
        scriptConfig?.dockerLockWaitTimeoutMs ||
        DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (String(error?.code || "") === "DOCKER_CONTAINER_QUEUE_LOCK_TIMEOUT") {
      logWarn("[execute_script][docker_queue_timeout]", {
        containerName: built.containerName,
        lockWaitTimeoutMs:
          error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
      });
      throw scriptRuntimeError(
        `Docker container lock wait timeout (${error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS}ms): ${built.containerName}`,
        {
          code: ERROR_CODE.RECOVERABLE_SCRIPT_RUNTIME_ERROR,
          details: {
            mode: SANDBOX_PROVIDER_NAME.DOCKER,
            reason: "container_lock_wait_timeout",
            containerName: built.containerName,
            lockWaitTimeoutMs:
              error?.details?.lockWaitTimeoutMs || DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
          },
        },
      );
    }
    throw error;
  }
  return { result, docker: built };
}

async function tryDockerFallback({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  scriptConfig = {},
  runtime = {},
  agentContext = null,
  fallbackFrom,
  warning,
  includeLineNumbers = false,
  executionMode = SCRIPT_EXECUTION_MODE.FOREGROUND,
}) {
  const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
  if (!dockerInstalled) return null;
  const { result: dr, docker } = await runDockerCommand({
    userRoot,
    userId,
    command,
    workspace,
    timeout,
    scriptConfig,
    runner: executionMode === SCRIPT_EXECUTION_MODE.BACKGROUND ? runFileBacked : run,
  });
  const meta = {
    fallbackFrom,
    warning,
    ...buildScriptExecutionMeta({
      sandboxEnabled: true,
      sandboxProvider: SANDBOX_PROVIDER_NAME.DOCKER,
      dockerConfig: scriptConfig,
      docker,
      workspace,
      runtime,
      agentContext,
    }),
  };
  if (executionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
    return toolFileBackedExecResult(SANDBOX_PROVIDER_NAME.DOCKER, dr, meta, {
      runtime,
      agentContext,
      basePath: runtime?.basePath || "",
    });
  }
  return toolExecResult(SANDBOX_PROVIDER_NAME.DOCKER, dr, meta, { includeLineNumbers });
}

function buildScriptToolDescription({
  runtime,
  sandboxEnabled,
  sandboxProvider,
  workspace,
  dockerConfig = {},
  userId = "",
}) {
  if (!sandboxEnabled) {
    return [
      tTool(runtime, "tools.script.localModeTitle"),
      tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: workspace }),
      tTool(runtime, "tools.script.localModePathHint"),
    ].join("\n");
  }

  const dockerScope = normalizeDockerContainerScope(dockerConfig);
  const normalizedUserId = String(userId || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "-") || "<userId>";
  const sandboxWorkdirMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: "/workspace/runtime/sandbox/persist",
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: "$HOME/runtime/sandbox/persist",
    [SANDBOX_PROVIDER_NAME.DOCKER]:
      dockerScope === "user"
        ? "/workspace/runtime/ops_workdir"
        : `/workspace/${normalizedUserId}/runtime/ops_workdir`,
  };
  const sandboxRootMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: "/workspace",
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: "$HOME",
    [SANDBOX_PROVIDER_NAME.DOCKER]: "/workspace",
  };
  const sandboxWorkdir =
    sandboxWorkdirMap[sandboxProvider] || sandboxWorkdirMap[SANDBOX_PROVIDER_NAME.DOCKER];
  const sandboxRoot =
    sandboxRootMap[sandboxProvider] || sandboxRootMap[SANDBOX_PROVIDER_NAME.DOCKER];
  const extraMountRoots =
    sandboxProvider === SANDBOX_PROVIDER_NAME.DOCKER
      ? Array.from(
          new Set(
            normalizeDockerMounts(dockerConfig)
              .map((item) => String(item?.target || "").trim())
              .filter(Boolean)
              .filter((target) => target !== sandboxRoot),
          ),
        )
      : [];
  const allowedRoots = Array.from(new Set([sandboxRoot, ...extraMountRoots]));

  return [
    `${tTool(runtime, "tools.script.sandboxModeTitlePrefix")}${sandboxProvider}${tTool(runtime, "tools.script.sandboxModeTitleSuffix")}`,
    tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: sandboxWorkdir }),
    tTool(runtime, "tools.script.concise.lineRelativeBase", { workdir: sandboxWorkdir }),
    tTool(runtime, "tools.script.concise.linePaths", { root: sandboxRoot }),
    ...(extraMountRoots.length
      ? [
          tTool(runtime, "tools.script.concise.lineExtraRoots", {
            roots: allowedRoots.join(", "),
          }),
        ]
      : []),
  ].join("\n");
}

export function createScriptTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, runtime.userConfig || {});
  if (!basePath) return [];

  const workspace = path.join(basePath, "runtime/ops_workdir");
  const userRoot = basePath;
  const userId = String(runtime?.userId || "").trim();
  const scriptConfig =
    effectiveConfig?.tools?.[EXECUTE_SCRIPT_TOOL_NAME] &&
    typeof effectiveConfig.tools[EXECUTE_SCRIPT_TOOL_NAME] === "object" &&
    !Array.isArray(effectiveConfig.tools[EXECUTE_SCRIPT_TOOL_NAME])
      ? effectiveConfig.tools[EXECUTE_SCRIPT_TOOL_NAME]
      : {};
  const sandboxEnabled = scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
  const { provider: sandboxProvider, providerDetail } =
    resolveSandboxProviderConfig(scriptConfig);
  const dockerConfig = resolveDockerScriptConfig(scriptConfig, providerDetail);
  const description = buildScriptToolDescription({
    runtime,
    sandboxEnabled,
    sandboxProvider,
    workspace,
    dockerConfig,
    userId,
  });

  const execute_script = new DynamicStructuredTool({
    name: EXECUTE_SCRIPT_TOOL_NAME,
    description,
    schema: z.object({
      command: z.string().describe(tTool(runtime, "tools.script.fieldCommand")),
      executionMode: z.enum([SCRIPT_EXECUTION_MODE.FOREGROUND, SCRIPT_EXECUTION_MODE.BACKGROUND])
        .optional()
        .default(SCRIPT_EXECUTION_MODE.FOREGROUND)
        .describe(tTool(runtime, "tools.script.fieldExecutionMode")),
      includeLineNumbers: z.boolean().optional().default(false).describe(tTool(runtime, "tools.script.fieldIncludeLineNumbers")),
    }),
    func: async ({ command, executionMode = SCRIPT_EXECUTION_MODE.FOREGROUND, includeLineNumbers = false }) => {
      await mkdir(workspace, { recursive: true });
      const normalizedCommand = String(command || "");
      const requestedExecutionMode = normalizeExecutionMode(executionMode);
      const shouldIncludeLineNumbers = includeLineNumbers === true;
      const timeout = BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs;

      if (!sandboxEnabled) {
        const runResult = requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
          ? await runFileBacked(normalizedCommand, workspace, timeout)
          : await run(normalizedCommand, workspace, timeout);
        if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
          return toolFileBackedExecResult(
            "local",
            runResult,
            buildScriptExecutionMeta({
              sandboxEnabled: false,
              workspace,
              runtime,
              agentContext,
            }),
            { runtime, agentContext, basePath },
          );
        }
        return toolExecResult(
          "local",
          runResult,
          buildScriptExecutionMeta({
            sandboxEnabled: false,
            workspace,
            runtime,
            agentContext,
          }),
          { includeLineNumbers: shouldIncludeLineNumbers },
        );
      }

      let sandboxCmd = "";
      let mode = SANDBOX_PROVIDER_NAME.DOCKER;
      let extra = buildScriptExecutionMeta({
        sandboxEnabled: true,
        sandboxProvider,
        workspace,
        runtime,
        agentContext,
        dockerConfig,
      });
      let dockerRunInput = null;

      if (sandboxProvider === SANDBOX_PROVIDER_NAME.BUBBLEWRAP) {
        const bwrapInstalled = await hasCommand(SANDBOX_COMMAND.BUBBLEWRAP);
        if (!bwrapInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
            SANDBOX_COMMAND.BUBBLEWRAP,
            runtime,
          );
        }

        const supportsOverlaySrc = await bwrapSupportsOption("--overlay-src");
        if (!supportsOverlaySrc) {
          const fallbackResult = await tryDockerFallback({
            userRoot,
            userId,
            command: normalizedCommand,
            workspace,
            timeout,
            scriptConfig: dockerConfig,
            runtime,
            agentContext,
            fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
            warning: tScript(runtime, "fallbackOverlaySrc"),
            executionMode: requestedExecutionMode,
          });
          if (fallbackResult) return fallbackResult;
          throw scriptRuntimeError(tScript(runtime, "overlaySrcUnsupported"), {
            code: ERROR_CODE.RECOVERABLE_BWRAP_OVERLAY_SRC_UNSUPPORTED,
            details: {
              mode: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
              code: 2,
            },
          });
        }

        const built = buildBubblewrapCommand({ userRoot, command: normalizedCommand });
        try {
          await ensureBubblewrapOverlayReady({
            overlayUpper: built.overlayUpper,
            overlayWork: built.overlayWork,
          });
        } catch (err) {
          throw scriptRuntimeError(
            tScript(runtime, "overlayDirNotWritable", {
              sandboxRoot: built.sandboxRoot,
              reason: err?.message || String(err),
            }),
            {
              code: ERROR_CODE.RECOVERABLE_BWRAP_OVERLAY_NOT_WRITABLE,
              details: {
                mode: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
                code: 13,
                sandboxRoot: built.sandboxRoot,
                overlayUpper: built.overlayUpper,
                overlayWork: built.overlayWork,
              },
            },
          );
        }
        sandboxCmd = built.cmd;
        mode = SANDBOX_PROVIDER_NAME.BUBBLEWRAP;
        extra = buildScriptExecutionMeta({
          sandboxEnabled: true,
          sandboxProvider: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
          workspace,
          runtime,
          agentContext,
          dockerConfig,
        });
      } else if (sandboxProvider === SANDBOX_PROVIDER_NAME.FIREJAIL) {
        const firejailInstalled = await hasCommand(SANDBOX_COMMAND.FIREJAIL);
        if (!firejailInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.FIREJAIL,
            SANDBOX_COMMAND.FIREJAIL,
            runtime,
          );
        }

        const built = buildFirejailCommand({ userRoot, command: normalizedCommand });
        sandboxCmd = built.cmd;
        mode = SANDBOX_PROVIDER_NAME.FIREJAIL;
        extra = buildScriptExecutionMeta({
          sandboxEnabled: true,
          sandboxProvider: SANDBOX_PROVIDER_NAME.FIREJAIL,
          workspace,
          runtime,
          agentContext,
          dockerConfig,
        });
      } else {
        const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
        if (!dockerInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.DOCKER,
            SANDBOX_COMMAND.DOCKER,
            runtime,
          );
        }
        dockerRunInput = {
          userRoot,
          userId,
          command: normalizedCommand,
          workspace,
          timeout,
          scriptConfig: dockerConfig,
        };
      }

      let runResult = null;
      if (mode === SANDBOX_PROVIDER_NAME.DOCKER && dockerRunInput) {
        const { result: dockerResult, docker: built } = await runDockerCommand(
          {
            ...dockerRunInput,
            runner: requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
              ? runFileBacked
              : run,
          },
        );
        runResult = dockerResult;
        extra = {
          ...extra,
          ...buildScriptExecutionMeta({
            sandboxEnabled: true,
            sandboxProvider: SANDBOX_PROVIDER_NAME.DOCKER,
            dockerConfig,
            docker: built,
            workspace,
            runtime,
            agentContext,
          }),
        };
      } else {
        runResult = requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
          ? await runFileBacked(sandboxCmd, workspace, timeout)
          : await run(sandboxCmd, workspace, timeout);
      }
      if (
        mode === SANDBOX_PROVIDER_NAME.BUBBLEWRAP &&
        Number(runResult?.code || 0) !== 0 &&
        /Can't make overlay mount|userxattr:\s*Invalid argument/i.test(
          String(runResult?.stderr || ""),
        )
      ) {
        const fallbackResult = await tryDockerFallback({
          userRoot,
          userId,
          command: normalizedCommand,
          workspace,
          timeout,
          scriptConfig: dockerConfig,
          runtime,
          agentContext,
          fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
          warning: tScript(runtime, "fallbackUserxattr"),
          includeLineNumbers: shouldIncludeLineNumbers,
          executionMode: requestedExecutionMode,
        });
        if (fallbackResult) return fallbackResult;
        runResult = {
          ...runResult,
          stderr: tScript(runtime, "userxattrUnsupported", {
            stderr: String(runResult?.stderr || ""),
          }),
        };
      }
      if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
        return toolFileBackedExecResult(mode, runResult, extra, {
          runtime,
          agentContext,
          basePath,
        });
      }
      return toolExecResult(mode, runResult, extra, {
        includeLineNumbers: shouldIncludeLineNumbers,
      });
    },
  });

  return [execute_script];
}
