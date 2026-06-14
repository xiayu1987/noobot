/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { exec } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
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
import { TRANSFER_REASON, TRANSFER_SOURCE } from "../../semantic-transfer/core/constants.js";
import { formatLinesWithNumbers, splitLines } from "./file-utils.js";

const EXECUTE_SCRIPT_TOOL_NAME = TOOL_NAME.EXECUTE_SCRIPT;
const DEFAULT_TIMEOUT = 300000;
const MAX_SCRIPT_COMMAND_CHARS = 8000;
const DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS = 3600000;
const SANDBOX_PROVIDER_NAME = SANDBOX_CONFIG.PROVIDERS;
const DOCKER_SANDBOX_DEFAULT = SANDBOX_CONFIG.DOCKER;
const SANDBOX_COMMAND = SANDBOX_CONFIG.COMMANDS;
const dockerContainerQueueMap = new Map();
const SCRIPT_WORKDIR_RELATIVE_PATH = "runtime/ops_workdir";
const ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS = normalizeTimeMs(
  process.env.NOOBOT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  {
    fallback: DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    min: 100,
  },
);

function run(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        code: error?.code || 0,
        stdout,
        stderr: stderr || error?.message || "",
      });
    });
  });
}

function tScript(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.script.${String(key || "").trim()}`, params);
}

function hasCommand(commandName = "") {
  return new Promise((resolve) => {
    exec(`command -v ${JSON.stringify(String(commandName || ""))}`, (error) => {
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
}) {
  const built = buildDockerCommand({ userRoot, userId, command, scriptConfig });
  let result = null;
  try {
    result = await enqueueDockerContainerTask({
      containerName: built.containerName,
      task: async () => run(built.cmd, workspace, timeout),
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
  });
  return toolExecResult(
    SANDBOX_PROVIDER_NAME.DOCKER,
    dr,
    {
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
    },
    { includeLineNumbers },
  );
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
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
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
      includeLineNumbers: z.boolean().optional().default(false).describe(tTool(runtime, "tools.script.fieldIncludeLineNumbers")),
    }),
    func: async ({ command, includeLineNumbers = false }) => {
      await mkdir(workspace, { recursive: true });
      const normalizedCommand = String(command || "");
      const shouldIncludeLineNumbers = includeLineNumbers === true;
      if (normalizedCommand.length > MAX_SCRIPT_COMMAND_CHARS) {
        let transferPayload = {};
        if (typeof transferSemanticContent === "function") {
          try {
            const transferred = await transferSemanticContent({
              scenario: "tool",
              strategy: "tool_input",
              text: normalizedCommand,
              inlineMaxChars: MAX_SCRIPT_COMMAND_CHARS,
              name: "execute-script-command.tool-input.sh",
              mimeType: "text/plain",
              source: TRANSFER_SOURCE.TOOL,
              reason: TRANSFER_REASON.EXECUTE_SCRIPT_INPUT_TOO_LONG,
              meta: {
                toolName: EXECUTE_SCRIPT_TOOL_NAME,
                field: "command",
              },
            });
            transferPayload =
              transferred?.compactToolPayload &&
              typeof transferred.compactToolPayload === "object"
                ? transferred.compactToolPayload
                : {};
          } catch {
            transferPayload = {};
          }
        }
        return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
          ok: false,
          message: tTool(runtime, "tools.script.commandTooLong"),
          ...transferPayload,
        });
      }
      const timeout = BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs;

      if (!sandboxEnabled) {
        const runResult = await run(normalizedCommand, workspace, timeout);
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
          dockerRunInput,
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
        runResult = await run(sandboxCmd, workspace, timeout);
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
        });
        if (fallbackResult) return fallbackResult;
        runResult = {
          ...runResult,
          stderr: tScript(runtime, "userxattrUnsupported", {
            stderr: String(runResult?.stderr || ""),
          }),
        };
      }
      return toolExecResult(mode, runResult, extra, {
        includeLineNumbers: shouldIncludeLineNumbers,
      });
    },
  });

  return [execute_script];
}
