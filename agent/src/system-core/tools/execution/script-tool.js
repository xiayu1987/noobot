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
import { mergeConfig } from "../../config/index.js";
import { normalizeSandboxProvider } from "../../config/index.js";
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

const EXECUTE_SCRIPT_TOOL_NAME = TOOL_NAME.EXECUTE_SCRIPT;
const DEFAULT_TIMEOUT = 120000;
const MAX_SCRIPT_COMMAND_CHARS = 8000;
const DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS = 15000;
const SANDBOX_PROVIDER_NAME = SANDBOX_CONFIG.PROVIDERS;
const DOCKER_SANDBOX_DEFAULT = SANDBOX_CONFIG.DOCKER;
const SANDBOX_COMMAND = SANDBOX_CONFIG.COMMANDS;
const dockerContainerQueueMap = new Map();

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
  lockWaitTimeoutMs = DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
} = {}) {
  const key = String(containerName || "").trim() || "__default__";
  const previousTail = dockerContainerQueueMap.get(key) || Promise.resolve();
  const queueDepthBefore = dockerContainerQueueMap.has(key) ? 1 : 0;
  const waitStartedAt = Date.now();
  const waitForPrevious = previousTail.catch(() => undefined);
  const waitTimeout = Number.isFinite(Number(lockWaitTimeoutMs))
    ? toSafePositiveInt(lockWaitTimeoutMs, DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS, 100)
    : DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS;
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
  const tailPromise = runPromise.finally(() => {
    if (dockerContainerQueueMap.get(key) === tailPromise) {
      dockerContainerQueueMap.delete(key);
    }
  });
  dockerContainerQueueMap.set(key, tailPromise);
  return runPromise;
}


function resolveSandboxProviderConfig(scriptConfig = {}) {
  const providerConfig = scriptConfig?.sandboxProvider;
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
    dockerLockWaitTimeoutMs:
      providerDetail?.dockerLockWaitTimeoutMs ||
      providerDetail?.docker_lock_wait_timeout_ms ||
      DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  };
}

function toSafePositiveInt(value, fallback = 0, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

function resolveScriptOutputPolicy(toolsConfig = {}) {
  const toolsCfg =
    toolsConfig && typeof toolsConfig === "object" && !Array.isArray(toolsConfig)
      ? toolsConfig
      : {};
  const configured = Number(toolsCfg?.maxOutputChars);
  const maxOutputChars = Number.isFinite(configured) && configured > 0
    ? toSafePositiveInt(configured, 0, 256)
    : undefined;
  return {
    maxOutputChars,
  };
}

function toolExecResult(mode, r = {}, extra = {}, outputPolicy = {}) {
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    ...(Number.isFinite(outputPolicy?.maxOutputChars)
      ? { __max_output_chars: outputPolicy.maxOutputChars }
      : {}),
    ...extra,
    ...r,
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
        scriptConfig?.docker_lock_wait_timeout_ms ||
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
  outputPolicy = {},
  fallbackFrom,
  warning,
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
      containerName: docker?.containerName || "",
      containerScope: docker?.scope || "",
      containerImage: docker?.image || "",
      containerMountSource: docker?.mountSource || "",
      containerMountTarget: docker?.mountTarget || "",
      containerExtraMounts: Array.isArray(docker?.dockerMounts)
        ? docker.dockerMounts
        : [],
      containerProjectMountSource:
        Array.isArray(docker?.dockerMounts) && docker.dockerMounts[0]
          ? String(docker.dockerMounts[0].source || "")
          : "",
      containerProjectMountTarget:
        Array.isArray(docker?.dockerMounts) && docker.dockerMounts[0]
          ? String(docker.dockerMounts[0].target || "")
          : "",
      containerWorkdir: docker?.workdir || "",
    },
    outputPolicy,
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
  const sandboxEnabled = !!scriptConfig?.sandboxMode;
  const { provider: sandboxProvider, providerDetail } =
    resolveSandboxProviderConfig(scriptConfig);
  const dockerConfig = resolveDockerScriptConfig(scriptConfig, providerDetail);
  const scriptOutputPolicy = resolveScriptOutputPolicy(effectiveConfig?.tools);
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
    }),
    func: async ({ command }) => {
      await mkdir(workspace, { recursive: true });
      const normalizedCommand = String(command || "");
      if (normalizedCommand.length > MAX_SCRIPT_COMMAND_CHARS) {
        return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
          ok: false,
          message: tTool(runtime, "tools.script.commandTooLong"),
        });
      }
      const timeout = Number(scriptConfig?.scriptTimeoutMs || DEFAULT_TIMEOUT);

      if (!sandboxEnabled) {
        const runResult = await run(normalizedCommand, workspace, timeout);
        return toolExecResult("local", runResult, {}, scriptOutputPolicy);
      }

      let sandboxCmd = "";
      let mode = SANDBOX_PROVIDER_NAME.DOCKER;
      let extra = {};
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
            outputPolicy: scriptOutputPolicy,
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
        extra = {
          sandboxRoot: built.sandboxRoot,
          overlayUpper: built.overlayUpper,
          overlayWork: built.overlayWork,
          persistDir: built.persistDir,
        };
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
        extra = { sandboxHome: built.homeDir, persistDir: built.persistDir };
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
          containerName: built.containerName,
          containerScope: built.scope,
          containerImage: built.image,
          containerMountSource: built.mountSource,
          containerMountTarget: built.mountTarget,
          containerExtraMounts: Array.isArray(built?.dockerMounts)
            ? built.dockerMounts
            : [],
          containerProjectMountSource:
            Array.isArray(built?.dockerMounts) && built.dockerMounts[0]
              ? String(built.dockerMounts[0].source || "")
              : "",
          containerProjectMountTarget:
            Array.isArray(built?.dockerMounts) && built.dockerMounts[0]
              ? String(built.dockerMounts[0].target || "")
              : "",
          containerWorkdir: built.workdir,
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
          outputPolicy: scriptOutputPolicy,
          fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
          warning: tScript(runtime, "fallbackUserxattr"),
        });
        if (fallbackResult) return fallbackResult;
        runResult = {
          ...runResult,
          stderr: tScript(runtime, "userxattrUnsupported", {
            stderr: String(runResult?.stderr || ""),
          }),
        };
      }
      return toolExecResult(mode, runResult, extra, scriptOutputPolicy);
    },
  });

  return [execute_script];
}
